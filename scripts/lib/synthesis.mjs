/**
 * Generate a final outcome object from vote results and proposals.
 *
 * @param {{ winner: string|null, method: string, margins: Object, outcome: string }} voteResult
 * @param {Array<{ agentId: string, content: string }>} proposals
 * @param {Array<{ agentId: string, content: string }>} critiques
 * @returns {{ outcome: string, winner: string|null, winnerAgent: string|null, winnerContent: string|null, method: string, margins: Object, dissent: string[], converged: boolean }}
 */
export function synthesizeOutcome(voteResult, proposals, critiques) {
  const { winner, method, margins = {}, outcome: voteOutcome } = voteResult;

  const winnerProposal = proposals.find((p) => p.agentId === winner);
  const winnerContent = winnerProposal ? winnerProposal.content : null;

  // Collect dissenting views: critiques from agents who didn't win
  const dissent = (critiques ?? [])
    .filter((c) => c.agentId !== winner)
    .map((c) => c.agentId);

  const converged = !!winner && voteOutcome !== 'irreconcilable' && voteOutcome !== 'needs-tiebreak';

  return {
    outcome: voteOutcome ?? (winner ? 'resolved' : 'unresolved'),
    winner,
    winnerAgent: winner,
    winnerContent,
    method: method ?? null,
    margins,
    dissent,
    converged,
  };
}

/**
 * Distill content for chain-mode summarization.
 * Returns content as-is if within maxLength, otherwise extracts a summary section,
 * or truncates with a notice.
 *
 * @param {string} content
 * @param {number} maxLength
 * @returns {string}
 */
export function extractSummary(content, maxLength = 5120) {
  if (!content) return '';
  if (content.length <= maxLength) return content;

  // Try to find a ## Summary or ## Conclusion section
  const sectionRe = /^#{1,3}\s+(Summary|Conclusion)\s*\n([\s\S]*?)(?=^#{1,3}\s|\Z)/im;
  const match = content.match(sectionRe);
  if (match) {
    const section = match[0].trim();
    if (section.length <= maxLength) return section;
  }

  // Fall back to hard truncation
  return content.slice(0, maxLength) + '\n[Truncated — see full transcript]';
}

/**
 * Return true if the same winner appears in consecutive rounds.
 *
 * @param {{ winner: string|null }} currentOutcome
 * @param {{ winner: string|null }} previousOutcome
 * @returns {boolean}
 */
export function checkConvergence(currentOutcome, previousOutcome) {
  if (!currentOutcome || !previousOutcome) return false;
  if (!currentOutcome.winner || !previousOutcome.winner) return false;
  return currentOutcome.winner === previousOutcome.winner;
}
