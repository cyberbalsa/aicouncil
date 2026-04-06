# AI Council Plugin for Claude Code — Design Spec

## Overview

A Claude Code plugin that orchestrates 5 AI agents (Claude, Codex, Gemini, MiniMax, Kimi) via their official CLIs to collaborate on plans, code reviews, and problem-solving. ToS-compliant by design — all agent interaction goes through each provider's official CLI tooling, never raw API calls.

## Agents

| Agent | CLI | Install | Non-interactive | JSON Output | Default Model |
|-------|-----|---------|-----------------|-------------|---------------|
| Claude | `claude` | `npm i -g @anthropic-ai/claude-code` | `claude -p "prompt"` | `--output-format stream-json` | `opus` |
| Codex | `codex` | `npm i -g @openai/codex` | `codex exec "prompt"` | `--json` | default |
| Gemini | `gemini` | `npm i -g @google/gemini-cli` | `gemini -p "prompt"` | `-o json` | default |
| MiniMax | `opencode` | `curl -fsSL https://opencode.ai/install | bash` | `opencode run -m minimax/MiniMax-M2.7-highspeed "prompt"` | `--format json` | `minimax/MiniMax-M2.7-highspeed` |
| Kimi | `opencode` | (same as MiniMax) | `opencode run -m kimi-for-coding/k2p5 "prompt"` | `--format json` | `kimi-for-coding/k2p5` |

Note: MiniMax and Kimi both use the `opencode` CLI as a multi-model gateway.

### OpenCode CLI Reliability Warnings

Known issues that adapters MUST handle defensively:

| Issue | Impact | Mitigation |
|-------|--------|------------|
| Exit code always 0 even on errors (#14551) | Cannot detect failures via exit code | Parse JSON output for error events instead |
| Hangs after tool calls (#17516) | Process never exits | Hard timeout wrapper (SIGTERM after timeout) |
| Hangs on rate limits (429) (#8203) | Process blocks indefinitely | Hard timeout + circuit breaker |
| Permission restrictions (#13851) | Tools blocked unless configured | Require `"*": "allow"` in opencode config during setup |

All opencode-based adapters (MiniMax, Kimi) must wrap execution with hard timeouts and detect errors via JSON output parsing, never exit codes.

## Modes

### 1. Council (Full Multi-Round Debate)

The primary mode. All 5 agents participate in a structured debate with ranked-choice voting.

**Invocation:** `/council:council "Design an auth system for this app"`

**Flow:**

```
QUESTION PHASE ──► GENERATE PHASE ──► CRITIQUE PHASE ──► VOTE PHASE ──► SYNTHESIS
     │                                                        │              │
     │ (amendments)                                   (no consensus)         │
     ▼                                                        │              ▼
  User approval ◄── task redefinition                  Loop (max 3) ──► DECISION MEMO
  Auto-resolve  ◄── clarification/assumption/scope
```

**Round structure:**

1. **Question Phase** — Present the working question to all agents. Agents may propose amendments (depth limit: 1). Amendment types:
   - `clarification` — auto-resolve, merged into question
   - `assumption` — auto-resolve, stated explicitly in question
   - `scope-split` — auto-resolve, question decomposed
   - `task-redefinition` — requires user approval
   - After amendments resolve: **FREEZE the working question** (no further changes)

2. **Generate Phase** — All agents receive the frozen question and generate proposals in parallel.
   - Quorum-based: proceed when 3/5 agents respond (don't wait for all)
   - Per-agent timeout: 120s (configurable)
   - Global round timeout: 300s (configurable)
   - Degraded mode: if 2+ agents fail, continue with remaining agents + log warning

3. **Critique Phase** — Proposals are swapped between agents. Each agent critiques the others' proposals.
   - **Diff-critique**: pass diffs/summaries of proposals, not full content, to stay within context limits
   - **XML-tag delimiters**: `<proposal id="agent_name">...</proposal>` to prevent context bleed
   - Each agent may revise their own proposal based on critiques received
   - 50KB output cap per agent response (bounded capture)

4. **Vote Phase** — Proposals are frozen (no new proposals or revisions).
   - **Merge compatible**: if two proposals are substantially similar, merge before voting
   - **Ranked-choice voting**: each agent ranks all proposals in order of preference
   - **Elimination rounds**: lowest-ranked proposal eliminated, votes redistributed, repeat until majority
   - **Fallback chain** (if ranked-choice is inconclusive):
     1. Weighted scoring (confidence * rank position)
     2. Simple majority
     3. Tie-break: Claude as procedural moderator (not a voter in tie-break)
   - **Consistency check**: if an agent ranks Proposal A first but their critique of A was negative, penalize their vote weight

5. **Synthesis** — Three possible outcomes:
   - `consensus` — all agents agree on a winner, or ranked-choice produces clear majority
   - `plurality-with-dissent` — winner exists, but with noted disagreements preserved
   - `irreconcilable` — no convergence after max rounds; output a decision memo with all positions, user decides

**Termination criteria (any triggers exit):**
- Max 3 rounds reached
- Unanimous agreement (all agents rank the same proposal first)
- Stable winner: same proposal wins ranked-choice in 2 consecutive rounds
- No material change: proposals/votes haven't shifted meaningfully between rounds

### 2. Consult (Fan-Out + Synthesis)

Quick mode for when you want multiple perspectives without the full debate process.

**Invocation:** `/council:consult "Is this migration strategy safe?"`

**Flow:**
1. Send the same prompt to all 5 agents in parallel
2. Collect responses (same quorum/timeout rules as Council)
3. A synthesis step (run by Claude as the host instance) reads all responses and produces:
   - Areas of agreement
   - Areas of disagreement
   - Recommended action
4. No voting, no rounds — single pass

**Auto-escalation:** If the synthesis detects >2 agents fundamentally disagree, suggest escalating to Council mode.

### 3. Ask (Single Agent)

Direct query to one specific agent.

**Invocation:** `/council:ask codex "Why is this test flaking?"`

**Routing options:**
- Explicit: user names the agent
- Auto-route: plugin picks based on task type (configurable mapping):
  - `debug` → Codex
  - `research` → Gemini
  - `review` → Claude
  - `alternative-perspective` → MiniMax or Kimi

### 4. Chain (Sequential Pipeline)

Pass output from one agent to the next in sequence.

**Invocation:** `/council:chain gemini,codex,claude "Analyze this architecture"`

**Flow:**
1. Agent A receives the original prompt, generates a response
2. **Pipeline distillation**: Agent A's output is split into `RESULT` (full, stored in transcript) and `SUMMARY` (compact, passed to next agent)
3. Agent B receives: original prompt + Agent A's `SUMMARY` + instruction to build on/critique it
4. Repeat for each agent in the chain
5. Final agent's output is the result

**Summary extraction:** Each adapter produces a `SUMMARY` block (max 5KB) alongside the full response. If the agent doesn't naturally produce one, the plugin extracts key points programmatically.

## Data Model

```javascript
// Session — top-level container for any council interaction
Session {
  id: string,              // UUID
  mode: "council" | "consult" | "ask" | "chain",
  workspaceRoot: string,   // absolute path
  originalQuestion: string,
  workingQuestion: string,  // after amendments, frozen
  agents: AgentConfig[],
  rounds: Round[],
  outcome: "consensus" | "plurality-with-dissent" | "irreconcilable" | null,
  summary: string | null,  // structured summary for user
  transcript: TranscriptEntry[],  // full log
  config: SessionConfig,
  createdAt: string,       // ISO
  updatedAt: string,
  completedAt: string | null
}

// Round — one iteration of the debate cycle
Round {
  id: number,              // 1-indexed
  phase: "question" | "generate" | "critique" | "vote" | "synthesize",
  workingQuestion: string,
  proposals: Proposal[],
  amendments: Amendment[],
  votes: Vote[],
  outcome: RoundOutcome | null,
  startedAt: string,
  completedAt: string | null
}

// Proposal — an agent's response/solution
Proposal {
  id: string,              // "round-1-claude" etc.
  agentId: string,
  content: string,         // full proposal text
  summary: string,         // distilled version for passing to other agents
  type: "solution" | "critique" | "revision",
  parentId: string | null, // if this is a revision of a prior proposal
  round: number,
  createdAt: string
}

// Amendment — a proposed change to the question itself
Amendment {
  id: string,
  agentId: string,
  type: "clarification" | "assumption" | "scope-split" | "task-redefinition",
  content: string,         // the proposed change
  resolution: "auto-applied" | "user-approved" | "user-rejected" | "pending",
  createdAt: string
}

// Vote — an agent's ranked preference
Vote {
  agentId: string,
  rankings: string[],      // ordered proposal IDs, most preferred first
  confidence: number,      // 1-10 (used as tiebreaker weight)
  rationale: string,       // brief explanation of ranking
  round: number,
  consistencyScore: number | null  // computed: cross-checked against critique content
}

// Round outcome
RoundOutcome {
  winner: string | null,   // proposal ID
  method: "unanimous" | "ranked-choice" | "weighted" | "majority" | "tiebreak",
  margins: { [proposalId]: number },  // vote share per proposal
  dissent: { agentId: string, reason: string }[],
  converged: boolean       // true if stable winner detected
}

// Transcript entry — raw log of everything
TranscriptEntry {
  timestamp: string,
  agentId: string | "system",
  phase: string,
  type: "prompt-sent" | "response-received" | "amendment" | "vote" | "synthesis" | "error",
  content: string,
  metadata: {
    durationMs: number,
    estimatedTokens: number | null,
    exitCode: number | null
  }
}

// Agent config
AgentConfig {
  id: string,              // "claude", "codex", "gemini", "minimax", "kimi"
  displayName: string,
  cli: string,             // absolute path to CLI binary
  model: string | null,
  enabled: boolean,
  timeout: number,         // per-agent timeout in seconds
  priority: number         // for quorum selection: higher = more important
}

// Session config
SessionConfig {
  maxRounds: number,           // default 3
  quorum: number,              // default 3 (out of 5)
  perAgentTimeout: number,     // default 120s
  globalRoundTimeout: number,  // default 300s
  maxOutputSize: number,       // default 50KB per agent
  tokenBudget: number | null,  // optional cost cap
  autoEscalate: boolean,       // consult → council on disagreement
  moderator: string            // agent ID used for tiebreak, default "claude"
}
```

## Adapter Contract

Each agent adapter (`scripts/lib/adapters/*.mjs`) implements:

```javascript
class BaseAdapter {
  constructor(config) { /* AgentConfig */ }

  // Check if CLI is installed, correct version, authenticated
  async checkAvailable(): Promise<{
    available: boolean,
    version: string | null,
    authenticated: boolean,
    cliPath: string | null,  // absolute path via `which`
    error: string | null
  }>

  // Execute a prompt and stream events
  async *execute(prompt: string, opts?: {
    timeout?: number,
    maxOutput?: number,
    cwd?: string
  }): AsyncGenerator<AdapterEvent>

  // Parse raw CLI output into normalized response
  parseResponse(raw: string): {
    content: string,
    structured: object | null,
    error: string | null
  }

  // Install the CLI (npm/curl)
  async install(): Promise<{ success: boolean, error?: string }>

  // Quick auth check before a round
  async pulseCheck(): Promise<boolean>

  // Min supported version
  get minVersion(): string
}

// Adapter events
type AdapterEvent =
  | { type: "started", agentId: string, timestamp: string }
  | { type: "progress", agentId: string, chunk: string }
  | { type: "completed", agentId: string, content: string, durationMs: number, exitCode: number }
  | { type: "failed", agentId: string, error: string, exitCode: number | null }
  | { type: "timed_out", agentId: string, timeoutMs: number }
```

### Adapter-Specific Notes

**Claude adapter:**
- Use `claude -p "prompt" --model opus --output-format stream-json`
- Parse stream-json for incremental progress events
- Exit code 0 does NOT guarantee valid response (check for non-empty content)

**Codex adapter:**
- Use `codex exec "prompt" --json`
- JSONL output, parse line by line
- Supports `--full-auto` for sandboxed execution

**Gemini adapter:**
- Use `gemini -p "prompt" -o json`
- Map specific exit codes: 41=auth failure, 53=turn limit, 0=success (but validate content)
- Stateless: must inject prior round context into each prompt manually
- Use `--yolo` for auto-approval in non-interactive mode (required for tool-using tasks)
- May output "Keychain initialization" warnings to stderr — ignore these

**MiniMax adapter (via opencode):**
- Use `opencode run -m minimax/MiniMax-M2.7-highspeed --format json "prompt"`
- Set `OPENCODE_DATA_DIR=/tmp/council-minimax-SESSION_ID` for SQLite isolation
- **Exit code unreliable** (always 0) — detect errors via JSON output parsing
- **May hang indefinitely** — always wrap with hard timeout (SIGTERM after per-agent timeout)
- Require permission config during setup: `opencode` must have `"*": "allow"` or equivalent

**Kimi adapter (via opencode):**
- Use `opencode run -m kimi-for-coding/k2p5 --format json "prompt"`
- Set `OPENCODE_DATA_DIR=/tmp/council-kimi-SESSION_ID` for SQLite isolation
- Same reliability concerns as MiniMax — exit code unreliable, may hang
- Same hard timeout and JSON error parsing requirements

### Stdout Sanitization

All adapters must handle "dirty stdout":
- Strip ANSI escape codes
- Strip "Thinking...", progress indicators, spinner text
- Use JSON output modes where available
- For opencode: regex buffer to extract valid JSON blocks from potential terminal noise
- Validate that `completed` events contain non-whitespace content

## Process Supervisor

The orchestrator (`scripts/lib/orchestrator.mjs`) manages all concurrent agent processes:

```
┌─────────────────────────────────────────┐
│            Process Supervisor            │
├─────────────────────────────────────────┤
│ Per-agent timeout        │ 120s default │
│ Global round timeout     │ 300s default │
│ Quorum                   │ 3/5 agents   │
│ Max output per agent     │ 50KB         │
│ Cancellation             │ SIGTERM → SIGKILL after 5s │
│ Late arrivals            │ Include if before round close │
│ OpenCode isolation       │ OPENCODE_DATA_DIR per agent      │
│ Circuit breaker          │ Pause 60s if 3+ agents rate-limited │
└─────────────────────────────────────────┘
```

### OpenCode Concurrency Strategy

The `--dir` flag only works for `opencode attach`, NOT `opencode run`. Instead, use `OPENCODE_DATA_DIR` env var to give each opencode-based agent its own SQLite database:

```javascript
// MiniMax adapter
spawn('opencode', ['run', '-m', 'minimax/MiniMax-M2.7-highspeed', prompt], {
  env: { ...process.env, OPENCODE_DATA_DIR: '/tmp/council-minimax-SESSION_ID' }
});

// Kimi adapter
spawn('opencode', ['run', '-m', 'kimi-for-coding/k2p5', prompt], {
  env: { ...process.env, OPENCODE_DATA_DIR: '/tmp/council-kimi-SESSION_ID' }
});
```

This allows true parallel execution of MiniMax and Kimi without SQLite `SQLITE_BUSY` conflicts. Temp dirs are cleaned up on session end.

**Fallback:** If `OPENCODE_DATA_DIR` isolation fails, fall back to sequential batching (MiniMax then Kimi).

### Circuit Breaker

If 3+ agents fail with rate limit errors (429 or equivalent) within a single round:
- Pause the entire council for 60s
- Retry the round once
- If rate limits persist, degrade to available agents only

**Quorum logic:**
- Start all 5 agents in parallel (MiniMax/Kimi isolated via OPENCODE_DATA_DIR)
- When 3 responses arrive, start a 30s grace period for remaining agents
- After grace period, close the round with whatever has arrived
- Log which agents timed out or failed

**Auth pulse check:**
- Before each round, run `adapter.pulseCheck()` for all agents
- If an agent fails the pulse check, mark it as unavailable for this round
- If fewer than quorum agents pass, abort and tell the user which CLIs need re-auth

## Voting Engine

`scripts/lib/voting.mjs` implements ranked-choice with fallbacks:

### Ranked-Choice Algorithm

```
1. Each agent submits rankings: [1st choice, 2nd choice, ...]
2. Count first-choice votes
3. If any proposal has >50% of first-choice votes → WINNER
4. Otherwise, eliminate the proposal with fewest first-choice votes
5. Redistribute eliminated proposal's votes to each voter's next choice
6. Repeat from step 2
7. If tie persists after all eliminations → fall through to weighted scoring
```

### Fallback Chain

```
Ranked-choice (majority) 
  → Weighted scoring (confidence * rank-position inverse)
    → Simple majority (most first-place votes, ignore rankings)
      → Tie-break (moderator agent decides, default Claude)
```

### Abstain Option

Agents may abstain from voting if they believe no proposal is adequate:
- `abstain` is a valid vote — counts as non-participation for that round
- Abstaining agent's rationale is recorded in transcript
- Abstentions reduce the effective voter pool for quorum calculation
- If 3+ agents abstain, round outcome is automatically `irreconcilable`

### Consistency Scoring

After votes are collected, cross-reference each agent's vote with their critique:
- If agent ranked Proposal A first but critiqued A negatively → penalize vote weight by 0.5x
- If agent ranked Proposal B last but critiqued B positively → flag inconsistency in transcript
- Consistency score: 0.0 (contradictory) to 1.0 (fully consistent)

**Concrete algorithm:**
- Extract sentiment from critique text using keyword analysis (positive: "strong", "well-designed", "correct"; negative: "flawed", "missing", "incorrect", "vulnerability")
- Compare sentiment polarity against vote ranking position
- Mismatch (negative critique + top rank, or positive critique + bottom rank) → score = 0.5
- Match → score = 1.0
- Ambiguous → score = 0.75

### Coalition Detection

Monitor for strategic voting patterns across rounds:
- If two agents consistently rank each other's proposals 1st/2nd across 2+ rounds → flag as potential coalition
- Flagged coalitions: reduce combined vote weight by 0.7x
- Log coalition detection in transcript for user visibility

### Proposal Merging

Before voting, detect substantially similar proposals:
- Synthesis agent identifies proposals that agree on core approach but differ in details
- **Semantic diff required**: before merging, output exactly what differs between the proposals
- **User approval required for merges** — the 20% difference could be critical (e.g., one includes a security fix)
- If user approves merge: credit both agents as co-authors
- If user rejects merge: keep as separate proposals on the ballot

## Output Format

### Structured Summary (Default)

```markdown
## Council Decision: [consensus | plurality | irreconcilable]

### Winning Proposal
**Author:** [agent name(s)]
**Method:** [ranked-choice | weighted | majority | tiebreak]
**Margin:** [vote breakdown]

[Proposal content]

### Dissenting Views
- **[agent]**: [brief disagreement and why]

### Key Discussion Points
- [Point 1 that emerged during critique]
- [Point 2]

### Amendments Applied
- [Question was clarified to include X]

### Action Items
- [ ] [Specific next step 1]
- [ ] [Specific next step 2]
```

### Full Transcript (On Demand)

Available via `/council:transcript` or `/council:transcript <session-id>`.

Shows every prompt sent, every response received, every vote, every amendment — with timestamps and token estimates. Stored in `state/WORKSPACE-HASH/sessions/SESSION-ID/transcript.json`.

## Plugin Structure

```
aicouncil/
├── .claude-plugin/
│   └── plugin.json                       # name, version, author, description
├── agents/
│   └── council-agent.md                  # Subagent definition for orchestration
├── commands/
│   ├── setup.md                          # Detect/install all 5 CLIs
│   ├── council.md                        # Full multi-round debate
│   ├── consult.md                        # Fan-out + synthesis
│   ├── ask.md                            # Single agent query
│   ├── chain.md                          # Sequential pipeline
│   ├── transcript.md                     # View session transcript
│   └── config.md                         # View/edit agent configuration
├── hooks/
│   └── hooks.json                        # SessionStart, SessionEnd
├── scripts/
│   ├── council-companion.mjs             # Main CLI entry point, subcommand dispatcher
│   ├── session-lifecycle-hook.mjs        # Session start/end, cleanup
│   └── lib/
│       ├── orchestrator.mjs              # Core round management, quorum, timeouts
│       ├── voting.mjs                    # Ranked-choice + fallbacks
│       ├── synthesis.mjs                 # Summary generation, merge detection
│       ├── transcript.mjs               # Transcript storage and retrieval
│       ├── state.mjs                     # Session/workspace state persistence
│       ├── config.mjs                    # Config loading, defaults, overrides
│       ├── process.mjs                   # CLI spawning, stdout sanitization
│       ├── render.mjs                    # Output formatting (summary + transcript)
│       └── adapters/
│           ├── base.mjs                  # Base adapter class
│           ├── claude.mjs                # claude -p --model opus --output-format stream-json
│           ├── codex.mjs                 # codex exec --json
│           ├── gemini.mjs                # gemini -p -o json
│           ├── minimax.mjs              # opencode run -m minimax/MiniMax-M2.7-highspeed
│           └── kimi.mjs                 # opencode run -m kimi-for-coding/k2p5
├── skills/
│   ├── council-runtime/
│   │   └── SKILL.md                      # Internal: how to invoke council-companion
│   └── result-handling/
│       └── SKILL.md                      # Internal: how to present results to user
├── config/
│   └── defaults.json                     # Default models, timeouts, quorum, budgets
└── CHANGELOG.md
```

## Known CLI Automation Issues

Critical real-world issues discovered through research of GitHub issues and user reports. Every adapter MUST account for these.

### Universal Issues (All CLIs)

1. **Hanging processes** — Every CLI has documented indefinite hangs in non-interactive mode. External hard timeout wrappers are **mandatory**, never trust internal timeouts.
2. **Auth breaks in headless mode** — OAuth flows fail without browsers. Use API keys or service accounts for automation, never user OAuth.
3. **Runaway token consumption** — All tools burn tokens at alarming rates in agentic loops. Always set turn limits and spend caps.

### Claude (`claude -p`)

| Issue | Severity | Mitigation |
|-------|----------|------------|
| OAuth expires in ~15min headless (#28827) | Critical | Use `claude setup-token` (1yr token) or `ANTHROPIC_API_KEY` |
| OAuth race condition with concurrent sessions (#24317) | High | Use API keys for parallel automation |
| Zombie/fork-bomb processes — thousands of `pgrep` spawned (#10078) | Critical | Wrap in process supervisor with cgroup limits |
| stream-json hangs after completion (#25629) | High | Parse for result event, kill process externally |
| ANSI codes leak into output (#32632) | Medium | Use `--output-format json`, set `NO_COLOR=1` |
| `-p` ignores tool permissions (#581) | Medium | Use `--allowedTools` explicitly |
| 10-100x token burn vs chat mode | High | Use `--max-turns` to cap iterations |

### Codex (`codex exec`)

| Issue | Severity | Mitigation |
|-------|----------|------------|
| Orphaned child processes on timeout (#4337) | Critical | Use process groups (`setsid`), kill entire group |
| `exec --json` hangs with `--image` (#5773) | High | Avoid `--image` in automation |
| Resume hangs 10+ hours (#14470) | Critical | Avoid resume in automation, start fresh |
| Shell commands return empty stdout on Linux (#7317) | High | Wrap in `bash -lc '...'` |
| No internal timeout in unified exec (#5948) | High | External timeout mandatory |
| Rate limits hit in 1-2 hours on Pro (#5182) | High | Use API keys with spend caps |

### Gemini (`gemini -p`)

| Issue | Severity | Mitigation |
|-------|----------|------------|
| Infinite rate-limit loop (#1626) | Critical | Pin to single model, external timeout |
| OAuth refresh token lost after ~1hr (#21691) | Critical | Use `GEMINI_API_KEY` or service account |
| `--output-format json` may not work (#9009) | High | Verify on your version, fall back to text parsing |
| Auto-downgrades model after 1 query | High | Always specify `--model` explicitly |
| 500K token burn in minutes from loops (#13198) | Critical | Pin to known-good version, set turn limits |
| Free tier: 60 RPM / 1000 RPD limit | Medium | Use Vertex AI for higher limits |

### OpenCode (`opencode run`)

| Issue | Severity | Mitigation |
|-------|----------|------------|
| Hangs forever on 429 errors (#8203) | Critical | External timeout wrapper mandatory |
| Hangs after tool calls (#17516) | Critical | Monitor output staleness, kill after threshold |
| Timeout config broken (undefined default) (#8203) | Critical | Always set explicit timeout + external backup |
| No `--non-interactive` flag (#10411) | High | Pipe to stdin, use permissive config |
| CI processes hang indefinitely (#5888) | High | Never run without external timeout |
| Stricter rate limits than native apps | Medium | Budget 2-3x rate limit vs native usage |

### Adapter Design Requirements (derived from above)

Every adapter MUST implement:
1. **External hard timeout** via `setTimeout` + `SIGTERM` → `SIGKILL` after 5s
2. **Process group killing** via `setsid` + `kill(-pid)` to catch orphaned children
3. **Output staleness detection** — if no new output for 30s, consider process hung
4. **Error detection via output parsing**, not exit codes (especially OpenCode)
5. **Auth pre-flight check** before every round, not just at session start
6. **Token/turn limiting** via CLI flags where available
7. **ANSI stripping** + `NO_COLOR=1` env var for all spawned processes

## Setup & Auto-Install

`/council:setup` detects and optionally installs all 5 CLIs.

### Detection Flow

```
For each agent:
  1. Resolve absolute CLI path via `which <cli>`
  2. Check version: `<cli> --version`
  3. Check auth status (agent-specific):
     - Claude: `claude -p "ping" --max-budget-usd 0.01` (quick test)
     - Codex: `codex exec "ping" --ephemeral` (quick test)
     - Gemini: `gemini -p "ping"` (check exit code, 41 = auth fail)
     - OpenCode: `opencode run "ping"` (check exit code)
  4. Report: { available, version, authenticated, cliPath }
```

### Installation

```
If CLI missing and npm available:
  - Claude: npm install -g @anthropic-ai/claude-code
  - Codex: npm install -g @openai/codex
  - Gemini: npm install -g @google/gemini-cli
  - OpenCode: curl -fsSL https://opencode.ai/install | bash

If npm not available:
  - Report error, suggest user install npm first
  - Exception: OpenCode uses curl, so it can install without npm
```

### Auth Guidance

Each CLI has different auth flows. **For automation, always prefer API keys over OAuth.**

| CLI | Recommended Auth | Fallback | Avoid |
|-----|-----------------|----------|-------|
| Claude | `ANTHROPIC_API_KEY` env var | `claude setup-token` (1yr) | OAuth (expires in ~15min headless) |
| Codex | `codex login --with-api-key` | `codex login --device-auth` | Default browser OAuth in headless |
| Gemini | `GEMINI_API_KEY` env var | Service account JSON | User OAuth (refresh token lost after 1hr) |
| OpenCode | API keys via `opencode providers` | Provider-specific env vars | OAuth (re-auth after every rate limit) |

Setup command should:
1. Check current auth status for each CLI
2. If using OAuth, **warn** that it's unreliable for automation
3. Guide user to switch to API key auth
4. Verify auth works with a quick ping test

### Version Enforcement

Each adapter declares a `minVersion`. During setup:
- If installed version < minVersion, warn and suggest upgrade
- Don't block — just warn, since older versions may still work

## Configuration

### Defaults (`config/defaults.json`)

```json
{
  "agents": {
    "claude": { "model": "opus", "enabled": true, "timeout": 120, "priority": 5 },
    "codex": { "model": null, "enabled": true, "timeout": 120, "priority": 4 },
    "gemini": { "model": null, "enabled": true, "timeout": 120, "priority": 3 },
    "minimax": { "model": "minimax/MiniMax-M2.7-highspeed", "enabled": true, "timeout": 120, "priority": 2 },
    "kimi": { "model": "kimi-for-coding/k2p5", "enabled": true, "timeout": 120, "priority": 1 }
  },
  "council": {
    "maxRounds": 3,
    "quorum": 3,
    "globalRoundTimeout": 300,
    "maxOutputSize": 51200,
    "autoEscalate": true,
    "moderator": "claude"
  },
  "routing": {
    "debug": "codex",
    "research": "gemini",
    "review": "claude",
    "alternative": ["minimax", "kimi"]
  }
}
```

### Override Hierarchy

1. Command-line flags (highest priority)
2. Project-level config: `.council/config.json` in workspace root
3. User-level config: `~/.config/aicouncil/config.json`
4. Plugin defaults: `config/defaults.json` (lowest priority)

## State Persistence

Follows the codex plugin pattern:

```
~/.claude/plugins/data/state/WORKSPACE-HASH/
├── state.json              # Current config, recent session list
└── sessions/
    ├── SESSION-UUID-1/
    │   ├── session.json    # Session metadata + summary
    │   └── transcript.json # Full transcript
    ├── SESSION-UUID-2/
    │   └── ...
    └── ...
```

- Max 20 sessions retained per workspace (prune oldest)
- Session data is written incrementally (after each round completes)
- Crash recovery: if a session has rounds but no `completedAt`, it was interrupted

## Safety & Governance

### Cross-Agent Prompt Injection

Multi-layered defense when passing Agent A's output to Agent B:

**Layer 1 — Pattern filtering:**
- Strip instruction-like patterns and common variations: `ignore previous instructions`, `disregard prior`, `forget earlier`, `system:`, unicode homoglyphs of these phrases
- Strip shell/code injection attempts in non-code contexts

**Layer 2 — Structural validation:**
- Validate output matches expected format (JSON schema for structured responses)
- Reject malformed outputs rather than attempting to parse them

**Layer 3 — Quarantine wrapping:**
- Wrap in clearly delimited blocks: `<agent-output source="claude" role="data">...</agent-output>`
- Escape any `</agent-output>` sequences within the content to prevent delimiter breakout
- Agents are instructed to treat these blocks as data, not instructions

**Layer 4 — Content risk scoring:**
- Score each agent output for injection risk (0.0-1.0) based on instruction-like content density
- Outputs scoring > 0.7 are flagged in transcript and presented to user before being passed to other agents
- Code blocks are exempt from instruction pattern scanning (code legitimately contains these strings)

### Token/Cost Budget

- Optional per-session budget (`tokenBudget` in config)
- Track estimated tokens per agent call (from CLI output metadata where available)
- Warn at 80% budget, hard-stop at 100%
- Budget tracking is best-effort (not all CLIs report token usage)

### Resource Limits

- 50KB max output capture per agent per call
- 300s max per round
- Max 3 rounds per council session
- Max 5 concurrent CLI processes (all parallel with OPENCODE_DATA_DIR isolation)

### Incremental Checkpoints

After each phase completes (question → generate → critique → vote → synthesize), write a checkpoint to disk:

```
sessions/SESSION-ID/
├── session.json          # Updated after each phase
├── checkpoint-round1-generate.json
├── checkpoint-round1-critique.json
├── checkpoint-round1-vote.json
└── transcript.json       # Appended incrementally
```

**Crash recovery:** On session resume, detect incomplete sessions (has rounds but no `completedAt`). Offer user: resume from last checkpoint or start fresh. Resuming replays from the last completed phase.

### CLI Version Pinning

Record CLI versions in session metadata for reproducibility:

```json
{
  "cliVersions": {
    "claude": "2.1.92",
    "codex": "1.2.3",
    "gemini": "0.36.0",
    "opencode": "0.5.1"
  }
}
```

Warn if CLI versions drift between sessions on the same project.

## Observability

Each round produces a structured log entry:

```json
{
  "round": 1,
  "phase": "generate",
  "agents": {
    "claude": { "status": "completed", "durationMs": 8500, "outputSize": 12400, "exitCode": 0 },
    "codex": { "status": "completed", "durationMs": 15200, "outputSize": 8900, "exitCode": 0 },
    "gemini": { "status": "timed_out", "durationMs": 120000, "outputSize": 0, "exitCode": null },
    "minimax": { "status": "completed", "durationMs": 6300, "outputSize": 10200, "exitCode": 0 },
    "kimi": { "status": "completed", "durationMs": 9100, "outputSize": 11000, "exitCode": 0 }
  },
  "quorumMet": true,
  "quorumSize": 4,
  "timestamp": "2026-04-06T00:30:00Z"
}
```

## Commands Summary

| Command | Skill Name | Description |
|---------|-----------|-------------|
| `/council:setup` | `council:setup` | Detect, install, and authenticate all 5 CLIs |
| `/council:council` | `council:council` | Full multi-round debate with ranked-choice voting |
| `/council:consult` | `council:consult` | Quick fan-out to all agents + synthesis |
| `/council:ask <agent>` | `council:ask` | Query a single agent directly |
| `/council:chain <agents>` | `council:chain` | Sequential pipeline through specified agents |
| `/council:transcript` | `council:transcript` | View full transcript of last/specified session |
| `/council:config` | `council:config` | View or edit agent configuration |

## Prior Art Considered

- [claude-council](https://github.com/hex/claude-council) — Multi-provider consultation with debate mode. Lacks ranked-choice voting, question amendments, and ToS-compliant CLI-only approach.
- [claude-octopus](https://github.com/nyldn/claude-octopus) — 8-provider orchestration with consensus gate. Uses API keys directly (ToS risk). No structured debate protocol.
- [karpathy/llm-council](https://github.com/karpathy/llm-council) — Original council concept with anonymized peer review. Web app, not a CLI plugin.
- [duh](https://github.com/msitarzewski/duh) — Multi-model consensus with Debate/Fan-Out/Decompose protocols. Standalone tool, not Claude Code integrated.
- [OpenClaw](https://github.com/Enderfga/openclaw-claude-code) — Council with git worktree isolation. Different scope — full headless coding engine.

### Key Differentiators

1. **ToS-compliant**: Official CLIs only, no raw API calls
2. **Structured debate protocol**: Question amendments, critique swap, ranked-choice voting with fallbacks
3. **5 diverse agents**: Claude, Codex, Gemini, MiniMax, Kimi — covering Anthropic, OpenAI, Google, and open-source models
4. **Multiple modes**: Council, Consult, Ask, Chain — right tool for the job
5. **Decision transparency**: Full transcript + structured summary with dissenting views preserved
