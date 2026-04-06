#!/usr/bin/env node
// Main CLI entry point for council-companion — dispatches subcommands

import { loadConfig, resolveAgentConfig } from './lib/config.mjs';
import { resolveStateDir, createSession, saveSession, listSessions, loadSession } from './lib/state.mjs';
import { Orchestrator, runParallelAgents, checkQuorum, checkCircuitBreaker } from './lib/orchestrator.mjs';
import { resolveVotes } from './lib/voting.mjs';
import { synthesizeOutcome, extractSummary, checkConvergence } from './lib/synthesis.mjs';
import { renderSummary, renderSetupReport, renderConsultResult, renderChainResult, renderTranscript } from './lib/render.mjs';
import { extractJson } from './lib/process.mjs';
import { ClaudeAdapter } from './lib/adapters/claude.mjs';
import { CodexAdapter } from './lib/adapters/codex.mjs';
import { GeminiAdapter } from './lib/adapters/gemini.mjs';
import { MiniMaxAdapter } from './lib/adapters/minimax.mjs';
import { KimiAdapter } from './lib/adapters/kimi.mjs';

const ADAPTER_MAP = {
  claude: ClaudeAdapter,
  codex: CodexAdapter,
  gemini: GeminiAdapter,
  minimax: MiniMaxAdapter,
  kimi: KimiAdapter,
};

/**
 * Build adapter instances from config.
 * @param {Object} config
 * @returns {Array}
 */
function createAdapters(config) {
  return resolveAgentConfig(config).map((agentCfg) => {
    const AdapterClass = ADAPTER_MAP[agentCfg.id];
    if (!AdapterClass) {
      throw new Error(`No adapter for agent: ${agentCfg.id}`);
    }
    return new AdapterClass(agentCfg);
  });
}

/**
 * Check all adapters and render a setup report.
 * @param {string} cwd
 * @param {{ json?: boolean }} opts
 */
async function handleSetup(cwd, opts = {}) {
  const config = loadConfig(cwd);
  const adapters = createAdapters(config);

  console.error('Checking agent availability...');

  const results = await Promise.all(
    adapters.map(async (adapter) => {
      const check = await adapter.checkAvailable();
      return {
        id: adapter.id,
        available: check.available,
        version: check.version,
        authenticated: check.authenticated,
        error: check.error,
      };
    }),
  );

  if (opts.json) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(renderSetupReport(results));
  }
}

/**
 * Full council debate flow.
 * @param {string} cwd
 * @param {string} prompt
 */
async function handleCouncil(cwd, prompt) {
  if (!prompt) {
    console.error('Error: council requires a prompt');
    process.exit(1);
  }

  const config = loadConfig(cwd);
  const adapters = createAdapters(config);
  const stateRoot = resolveStateDir(cwd);
  const maxRounds = config.council?.maxRounds ?? 3;
  const quorum = config.council?.quorum ?? 3;

  // Collect CLI versions
  const cliVersions = {};
  await Promise.all(
    adapters.map(async (adapter) => {
      try {
        cliVersions[adapter.id] = await adapter.getVersion();
      } catch {
        cliVersions[adapter.id] = null;
      }
    }),
  );

  const session = createSession({
    mode: 'council',
    originalQuestion: prompt,
    workspaceRoot: cwd,
    agents: adapters.map((a) => a.id),
    config,
    cliVersions,
  });

  const orchestrator = new Orchestrator({
    adapters,
    config,
    stateRoot,
    sessionId: session.id,
  });

  console.error(`Starting council session ${session.id}`);
  console.error(`Question: ${prompt}`);

  let previousOutcome = null;

  for (let round = 0; round < maxRounds; round++) {
    console.error(`\nRound ${round + 1}/${maxRounds}`);

    // Generate phase
    console.error('  [generate] Querying all agents...');
    const generateResults = await orchestrator.runGenerate(prompt);

    // Check quorum
    if (!checkQuorum(generateResults, quorum)) {
      console.error(`  [quorum] Not enough agents responded (need ${quorum}). Aborting.`);
      break;
    }

    // Check circuit breaker
    const cb = checkCircuitBreaker(generateResults);
    if (cb.tripped) {
      console.error(`  [circuit-breaker] Too many rate-limit errors (${cb.count}). Aborting.`);
      break;
    }

    const proposals = generateResults
      .filter((r) => r.status === 'completed')
      .map((r) => ({ agentId: r.agentId, content: r.content }));

    // Critique phase
    console.error('  [critique] Agents critiquing proposals...');
    const critiqueResults = await orchestrator.runCritique(prompt, proposals);
    const critiques = critiqueResults
      .filter((r) => r.status === 'completed')
      .map((r) => ({ agentId: r.agentId, content: r.content }));

    // Vote phase
    console.error('  [vote] Agents casting votes...');
    const voteResults = await orchestrator.runVote(prompt, proposals);

    // Parse JSON votes from responses
    const votes = voteResults
      .filter((r) => r.status === 'completed')
      .map((r) => {
        const parsed = extractJson(r.content);
        return {
          agentId: r.agentId,
          rankings: parsed?.rankings ?? [],
          confidence: parsed?.confidence ?? 0,
          rationale: parsed?.rationale ?? '',
        };
      });

    const proposalIds = proposals.map((p) => p.agentId);
    const voteResult = resolveVotes(votes, proposalIds);
    const outcome = synthesizeOutcome(voteResult, proposals, critiques);

    session.rounds.push({
      round: round + 1,
      proposals,
      critiques,
      votes,
      outcome,
    });

    console.error(`  [outcome] ${outcome.outcome} — winner: ${outcome.winner ?? 'none'}`);

    // Check termination conditions
    if (outcome.outcome === 'resolved' && outcome.converged) {
      if (previousOutcome && checkConvergence(outcome, previousOutcome)) {
        console.error('  [converged] Same winner in consecutive rounds. Stopping early.');
        break;
      }
    }

    if (round + 1 >= maxRounds) {
      console.error('  [max-rounds] Reached maximum rounds.');
    }

    previousOutcome = outcome;
  }

  // Store final outcome and summary
  session.outcome = previousOutcome?.outcome ?? 'unresolved';
  session.summary = previousOutcome
    ? `Winner: ${previousOutcome.winner ?? 'none'} via ${previousOutcome.method ?? 'unknown'}`
    : 'No rounds completed';
  session.transcript = orchestrator.getTranscript();
  session.completedAt = new Date().toISOString();

  const saved = saveSession(stateRoot, session);
  console.error(`\nSession saved: ${saved.id}`);

  console.log(renderSummary(session));
}

/**
 * Fan-out to all agents and render results.
 * @param {string} cwd
 * @param {string} prompt
 */
async function handleConsult(cwd, prompt) {
  if (!prompt) {
    console.error('Error: consult requires a prompt');
    process.exit(1);
  }

  const config = loadConfig(cwd);
  const adapters = createAdapters(config);

  console.error(`Consulting all agents: ${prompt.slice(0, 80)}...`);

  const results = await runParallelAgents(adapters, prompt);

  const responses = results.map((r) => ({
    agentId: r.agentId,
    content: r.content,
    error: r.error,
  }));

  console.log(renderConsultResult(responses));
}

/**
 * Query a single agent.
 * @param {string} cwd
 * @param {string} agentId
 * @param {string} prompt
 */
async function handleAsk(cwd, agentId, prompt) {
  if (!agentId) {
    console.error('Error: ask requires an agent ID');
    process.exit(1);
  }
  if (!prompt) {
    console.error('Error: ask requires a prompt');
    process.exit(1);
  }

  const config = loadConfig(cwd);
  const adapters = createAdapters(config);
  const adapter = adapters.find((a) => a.id === agentId);

  if (!adapter) {
    console.error(`Error: unknown agent "${agentId}". Available: ${adapters.map((a) => a.id).join(', ')}`);
    process.exit(1);
  }

  console.error(`Asking ${agentId}: ${prompt.slice(0, 80)}...`);

  const results = await runParallelAgents([adapter], prompt);
  const r = results[0];

  if (r.error) {
    console.error(`Error from ${agentId}: ${r.error}`);
    process.exit(1);
  }

  console.log(r.content ?? '');
}

/**
 * Sequential chain pipeline with distillation between steps.
 * @param {string} cwd
 * @param {string[]} agentIds
 * @param {string} prompt
 */
async function handleChain(cwd, agentIds, prompt) {
  if (!agentIds || agentIds.length === 0) {
    console.error('Error: chain requires a comma-separated list of agent IDs');
    process.exit(1);
  }
  if (!prompt) {
    console.error('Error: chain requires a prompt');
    process.exit(1);
  }

  const config = loadConfig(cwd);
  const adapters = createAdapters(config);
  const adapterMap = Object.fromEntries(adapters.map((a) => [a.id, a]));

  const steps = [];
  let currentPrompt = prompt;

  for (const agentId of agentIds) {
    const adapter = adapterMap[agentId];
    if (!adapter) {
      console.error(`Warning: unknown agent "${agentId}", skipping`);
      steps.push({ agentId, content: null, error: `Unknown agent: ${agentId}` });
      continue;
    }

    console.error(`Chain step: ${agentId}`);
    const results = await runParallelAgents([adapter], currentPrompt);
    const r = results[0];

    steps.push({
      agentId,
      content: r.content,
      error: r.error,
    });

    if (r.status === 'completed' && r.content) {
      // Distill for next step
      currentPrompt = extractSummary(r.content);
    }
  }

  console.log(renderChainResult(steps));
}

/**
 * Load and render a session transcript.
 * @param {string} cwd
 * @param {string|undefined} sessionId
 */
async function handleTranscript(cwd, sessionId) {
  const stateRoot = resolveStateDir(cwd);

  let session;
  if (sessionId) {
    session = loadSession(stateRoot, sessionId);
    if (!session) {
      console.error(`Error: session not found: ${sessionId}`);
      process.exit(1);
    }
  } else {
    const sessions = listSessions(stateRoot);
    if (sessions.length === 0) {
      console.error('No sessions found');
      process.exit(1);
    }
    session = sessions[0];
    console.error(`Using most recent session: ${session.id}`);
  }

  const entries = session.transcript ?? [];
  if (entries.length === 0) {
    console.error('No transcript entries for this session');
    process.exit(0);
  }

  console.log(renderTranscript(entries));
}

function printHelp() {
  console.log(`council-companion — AI council CLI

Commands:
  setup [--json]              Check all agent adapters and show availability table
  council <prompt>            Run full council debate (generate → critique → vote)
  consult <prompt>            Fan-out prompt to all agents and show all responses
  ask <agentId> <prompt>      Query a single agent
  chain <agents> <prompt>     Sequential pipeline (comma-separated agent IDs)
  transcript [sessionId]      Show transcript for a session (default: most recent)

Environment:
  CLAUDE_PROJECT_DIR          Override working directory for config/state resolution

Examples:
  council-companion setup
  council-companion council "How should we handle rate limiting?"
  council-companion consult "What is the best sorting algorithm?"
  council-companion ask claude "Explain monads"
  council-companion chain claude,codex,gemini "Review this architecture"
  council-companion transcript
`);
}

// ── Main dispatch ────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const subcommand = args[0];
const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();

switch (subcommand) {
  case 'setup':
    handleSetup(cwd, { json: args.includes('--json') });
    break;
  case 'council':
    handleCouncil(cwd, args.slice(1).join(' '));
    break;
  case 'consult':
    handleConsult(cwd, args.slice(1).join(' '));
    break;
  case 'ask':
    handleAsk(cwd, args[1], args.slice(2).join(' '));
    break;
  case 'chain':
    handleChain(cwd, args[1]?.split(',') || [], args.slice(2).join(' '));
    break;
  case 'transcript':
    handleTranscript(cwd, args[1]);
    break;
  default:
    printHelp();
    break;
}
