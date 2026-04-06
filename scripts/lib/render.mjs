// Output rendering module for council decisions, transcripts, and setup reports

const AGENT_NAMES = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  minimax: 'MiniMax',
  kimi: 'Kimi',
};

function agentName(id) {
  return AGENT_NAMES[id] || id;
}

/**
 * Render a structured summary of a council decision.
 * @param {Object} session - Session object with outcome and rounds
 * @returns {string}
 */
export function renderSummary(session) {
  const lines = [];
  lines.push(`## Council Decision: ${session.outcome}`);

  const lastRound = session.rounds && session.rounds[session.rounds.length - 1];
  if (!lastRound) return lines.join('\n');

  const { outcome, proposals = [], amendments = [] } = lastRound;

  if (outcome.winner) {
    const winnerProposal = proposals.find(p => p.id === outcome.winner);
    lines.push('### Winning Proposal');
    if (winnerProposal) {
      lines.push(`**Author:** ${agentName(winnerProposal.agentId)}`);
    }
    lines.push(`**Method:** ${outcome.method}`);
    lines.push(`**Margin:** ${JSON.stringify(outcome.margins)}`);
    if (winnerProposal) {
      lines.push(winnerProposal.content);
    }
  } else {
    lines.push('### No consensus reached');
  }

  const dissent = outcome.dissent || [];
  if (dissent.length > 0) {
    lines.push('### Dissenting Views');
    for (const d of dissent) {
      lines.push(`- **${agentName(d.agentId)}**: ${d.reason}`);
    }
  }

  if (amendments.length > 0) {
    lines.push('### Amendments Applied');
    for (const a of amendments) {
      lines.push(`- ${a}`);
    }
  }

  return lines.join('\n');
}

/**
 * Render a full transcript of session entries.
 * @param {Array} entries - Array of { timestamp, agentId, type, duration, content }
 * @returns {string}
 */
export function renderTranscript(entries) {
  if (!entries || entries.length === 0) return '';

  return entries.map(entry => {
    const parts = [];
    parts.push(`**${agentName(entry.agentId)}** | ${entry.type} | ${entry.timestamp} | ${entry.duration}ms`);
    parts.push(entry.content);
    return parts.join('\n');
  }).join('\n---\n');
}

/**
 * Render a setup report table showing agent status.
 * @param {Array} agents - Array of { id, available, version, authenticated }
 * @returns {string}
 */
export function renderSetupReport(agents) {
  const header = '| Agent | Status | Version | Auth |';
  const divider = '|-------|--------|---------|------|';
  const rows = agents.map(a => {
    const name = agentName(a.id);
    const status = a.available ? 'installed' : 'missing';
    const version = a.version || '-';
    const auth = a.authenticated ? 'ok' : 'not authenticated';
    return `| ${name} | ${status} | ${version} | ${auth} |`;
  });
  return [header, divider, ...rows].join('\n');
}

/**
 * Render consult results — each agent response under its own heading.
 * @param {Array} responses - Array of { agentId, content?, error? }
 * @returns {string}
 */
export function renderConsultResult(responses) {
  return responses.map(r => {
    const lines = [`### ${agentName(r.agentId)}`];
    if (r.error) {
      lines.push(`**Error:** ${r.error}`);
    } else {
      lines.push(r.content || '');
    }
    return lines.join('\n');
  }).join('\n\n');
}

/**
 * Render chain result — each step numbered under its heading.
 * @param {Array} steps - Array of { agentId, content?, error? }
 * @returns {string}
 */
export function renderChainResult(steps) {
  return steps.map((step, i) => {
    const lines = [`### Step ${i + 1}: ${agentName(step.agentId)}`];
    if (step.error) {
      lines.push(`**Error:** ${step.error}`);
    } else {
      lines.push(step.content || '');
    }
    return lines.join('\n');
  }).join('\n\n');
}
