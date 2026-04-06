import { sanitizeAgentOutput } from './sanitize.mjs';

// ── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Return true if the number of completed results meets or exceeds required.
 *
 * @param {Array<{ agentId: string, status: string }>} results
 * @param {number} required
 * @returns {boolean}
 */
export function checkQuorum(results, required) {
  const completed = results.filter((r) => r.status === 'completed').length;
  return completed >= required;
}

/**
 * Run all adapters concurrently via Promise.all.
 * Iterates execute() events for each adapter, collects the last event,
 * and parses the response when status is 'completed'.
 *
 * @param {Array} adapters
 * @param {string} prompt
 * @param {Object} opts
 * @returns {Promise<Array<{ agentId: string, status: string, content: string|null, error: string|null, events: Array }>>}
 */
export async function runParallelAgents(adapters, prompt, opts = {}) {
  return Promise.all(
    adapters.map(async (adapter) => {
      const events = [];
      let lastEvent = null;

      try {
        for await (const event of adapter.execute(prompt, opts)) {
          events.push(event);
          lastEvent = event;
        }
      } catch (err) {
        return {
          agentId: adapter.id,
          status: 'failed',
          content: null,
          error: err.message,
          events,
        };
      }

      if (!lastEvent) {
        return {
          agentId: adapter.id,
          status: 'failed',
          content: null,
          error: 'no events emitted',
          events,
        };
      }

      const status = lastEvent.type === 'completed' ? 'completed' : lastEvent.type ?? 'failed';

      let content = null;
      let error = lastEvent.error ?? null;

      if (status === 'completed') {
        const raw = lastEvent.content ?? '';
        const parsed = adapter.parseResponse(raw);
        content = parsed.content ?? raw;
        error = parsed.error ?? null;
      }

      return { agentId: adapter.id, status, content, error, events };
    }),
  );
}

/**
 * Filter completed results and sanitize each agent's output.
 *
 * @param {Array<{ agentId: string, status: string, content: string }>} results
 * @returns {Array<{ agentId: string, sanitized: Object }>}
 */
export function prepareForCritique(results) {
  return results
    .filter((r) => r.status === 'completed')
    .map((r) => ({
      agentId: r.agentId,
      sanitized: sanitizeAgentOutput(r.content ?? '', r.agentId),
    }));
}

/**
 * Build a critique prompt for targetAgentId, including all other agents' proposals.
 *
 * @param {string} originalQuestion
 * @param {Array<{ agentId: string, content: string }>} proposals
 * @param {string} targetAgentId
 * @returns {string}
 */
export function buildCritiquePrompt(originalQuestion, proposals, targetAgentId) {
  const others = proposals.filter((p) => p.agentId !== targetAgentId);
  const ownProposal = proposals.find((p) => p.agentId === targetAgentId);

  const proposalBlocks = others
    .map(
      (p) => `<proposal agent="${p.agentId}">
${p.content}
</proposal>`,
    )
    .join('\n\n');

  const ownBlock = ownProposal
    ? `\n\nYour own proposal:\n<proposal agent="${targetAgentId}">\n${ownProposal.content}\n</proposal>`
    : '';

  return `Original question: ${originalQuestion}

You are reviewing proposals from other AI agents. Critique each proposal below, noting strengths and weaknesses. You may also optionally revise your own proposal based on insights from the critiques.

${proposalBlocks}${ownBlock}

Please provide your critique of each proposal and, if you wish, a revised version of your own proposal.`;
}

/**
 * Build a voting prompt asking for JSON-formatted rankings.
 *
 * @param {string} originalQuestion
 * @param {Array<{ agentId: string, content: string }>} proposals
 * @returns {string}
 */
export function buildVotePrompt(originalQuestion, proposals) {
  const proposalBlocks = proposals
    .map(
      (p) => `<proposal agent="${p.agentId}">
${p.content}
</proposal>`,
    )
    .join('\n\n');

  const agentIds = proposals.map((p) => p.agentId);

  return `Original question: ${originalQuestion}

Review the following proposals and vote by ranking them. You may abstain if you cannot determine a preference.

${proposalBlocks}

Respond with JSON only (no other text):
{
  "rankings": ${JSON.stringify(agentIds)},
  "confidence": <number 1-10>,
  "rationale": "<brief explanation>"
}

To abstain, return: { "rankings": [], "confidence": 0, "rationale": "abstain" }`;
}

/**
 * Build a merge-check prompt asking to identify substantially similar proposals.
 *
 * @param {Array<{ agentId: string, content: string }>} proposals
 * @returns {string}
 */
export function buildMergeCheckPrompt(proposals) {
  const proposalBlocks = proposals
    .map(
      (p) => `<proposal agent="${p.agentId}">
${p.content}
</proposal>`,
    )
    .join('\n\n');

  return `Review the following proposals and identify any that are substantially similar in approach.

${proposalBlocks}

Respond with JSON only:
{
  "merges": [
    {
      "ids": ["<agentId1>", "<agentId2>"],
      "sharedApproach": "<brief description of common approach>",
      "differences": "<notable differences>"
    }
  ]
}

If no proposals are substantially similar, return: { "merges": [] }`;
}

/**
 * Check if multiple agents have hit rate-limit / quota errors.
 * Trips the circuit breaker when 3 or more agents are rate-limited.
 *
 * @param {Array<{ agentId: string, error: string|null }>} results
 * @returns {{ tripped: boolean, rateLimitedAgents: string[], count: number }}
 */
export function checkCircuitBreaker(results) {
  const rateLimitPatterns = [/429/i, /rate.?limit/i, /quota/i];

  const rateLimitedAgents = results
    .filter((r) => {
      if (!r.error) return false;
      return rateLimitPatterns.some((pat) => pat.test(r.error));
    })
    .map((r) => r.agentId);

  const count = rateLimitedAgents.length;
  return { tripped: count >= 3, rateLimitedAgents, count };
}

// ── Orchestrator class ───────────────────────────────────────────────────────

export class Orchestrator {
  /**
   * @param {{ adapters: Array, config: Object, stateRoot: string, sessionId: string }} opts
   */
  constructor({ adapters, config = {}, stateRoot, sessionId }) {
    this.adapters = adapters;
    this.config = config;
    this.stateRoot = stateRoot;
    this.sessionId = sessionId;
    this._transcript = [];

    // Inject sessionId into all adapters
    for (const adapter of this.adapters) {
      adapter.sessionId = sessionId;
    }
  }

  /**
   * Append one or more entries to the in-memory transcript.
   *
   * @param {Object|Object[]} entry
   */
  addTranscript(entry) {
    if (Array.isArray(entry)) {
      this._transcript.push(...entry);
    } else {
      this._transcript.push(entry);
    }
  }

  /**
   * Run pulseCheck on all adapters in parallel.
   *
   * @returns {Promise<Array<{ agentId: string, alive: boolean }>>}
   */
  async pulseCheckAll() {
    return Promise.all(
      this.adapters.map(async (adapter) => {
        let alive = false;
        try {
          alive = await adapter.pulseCheck();
        } catch {
          alive = false;
        }
        return { agentId: adapter.id, alive };
      }),
    );
  }

  /**
   * Run the generate phase: prompt all agents in parallel.
   *
   * @param {string} question
   * @param {Object} opts
   * @returns {Promise<Array>}
   */
  async runGenerate(question, opts = {}) {
    const results = await runParallelAgents(this.adapters, question, opts);
    this.addTranscript(
      results.map((r) => ({
        timestamp: new Date().toISOString(),
        agentId: r.agentId,
        phase: 'generate',
        type: r.status,
        content: r.content,
        metadata: { error: r.error },
      })),
    );
    return results;
  }

  /**
   * Run the critique phase: send critique prompts to all agents in parallel.
   *
   * @param {string} question
   * @param {Array<{ agentId: string, content: string }>} proposals
   * @param {Object} opts
   * @returns {Promise<Array>}
   */
  async runCritique(question, proposals, opts = {}) {
    const critiqueAdapters = this.adapters.map((adapter) => ({
      ...adapter,
      _critiquePrompt: buildCritiquePrompt(question, proposals, adapter.id),
    }));

    const results = await Promise.all(
      this.adapters.map(async (adapter) => {
        const prompt = buildCritiquePrompt(question, proposals, adapter.id);
        const events = [];
        let lastEvent = null;

        try {
          for await (const event of adapter.execute(prompt, opts)) {
            events.push(event);
            lastEvent = event;
          }
        } catch (err) {
          return { agentId: adapter.id, status: 'failed', content: null, error: err.message, events };
        }

        if (!lastEvent) {
          return { agentId: adapter.id, status: 'failed', content: null, error: 'no events', events };
        }

        const status = lastEvent.type === 'completed' ? 'completed' : lastEvent.type ?? 'failed';
        let content = null;
        let error = lastEvent.error ?? null;

        if (status === 'completed') {
          const raw = lastEvent.content ?? '';
          const parsed = adapter.parseResponse(raw);
          content = parsed.content ?? raw;
          error = parsed.error ?? null;
        }

        return { agentId: adapter.id, status, content, error, events };
      }),
    );

    this.addTranscript(
      results.map((r) => ({
        timestamp: new Date().toISOString(),
        agentId: r.agentId,
        phase: 'critique',
        type: r.status,
        content: r.content,
        metadata: { error: r.error },
      })),
    );

    // Suppress unused variable warning
    void critiqueAdapters;

    return results;
  }

  /**
   * Run the vote phase: send vote prompts to all agents in parallel.
   *
   * @param {string} question
   * @param {Array<{ agentId: string, content: string }>} proposals
   * @param {Object} opts
   * @returns {Promise<Array>}
   */
  async runVote(question, proposals, opts = {}) {
    const votePrompt = buildVotePrompt(question, proposals);

    const results = await runParallelAgents(
      this.adapters.map((adapter) => ({
        ...adapter,
        execute: (p, o) => adapter.execute(votePrompt, o),
        parseResponse: (raw) => adapter.parseResponse(raw),
        pulseCheck: () => adapter.pulseCheck(),
      })),
      votePrompt,
      opts,
    );

    this.addTranscript(
      results.map((r) => ({
        timestamp: new Date().toISOString(),
        agentId: r.agentId,
        phase: 'vote',
        type: r.status,
        content: r.content,
        metadata: { error: r.error },
      })),
    );

    return results;
  }

  /**
   * Return a copy of the in-memory transcript.
   *
   * @returns {Array}
   */
  getTranscript() {
    return [...this._transcript];
  }
}
