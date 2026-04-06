// Voting engine for AI council debate mode

const POSITIVE_WORDS = ['strong', 'well-designed', 'correct', 'solid', 'excellent', 'good', 'robust'];
const NEGATIVE_WORDS = ['flawed', 'missing', 'incorrect', 'vulnerability', 'weak', 'broken', 'wrong', 'dangerous'];

/**
 * Ranked-choice voting with elimination rounds.
 * @param {Array} votes - Array of { agentId, rankings, confidence }
 * @param {string[]} proposalIds
 * @returns {{ winner: string|null, method: string, margins: Object }}
 */
export function rankedChoice(votes, proposalIds) {
  // Filter out abstains
  const active = votes.filter(v => v.rankings && v.rankings.length > 0);
  const total = active.length;

  if (total === 0) {
    return { winner: null, method: 'ranked-choice', margins: {} };
  }

  let ballots = active.map(v => [...v.rankings]);
  let remaining = new Set(proposalIds);

  while (remaining.size > 1) {
    const counts = {};
    for (const id of remaining) counts[id] = 0;

    for (const ballot of ballots) {
      const top = ballot.find(p => remaining.has(p));
      if (top) counts[top]++;
    }

    // Check for majority
    for (const [id, count] of Object.entries(counts)) {
      if (count / total > 0.5) {
        const margins = buildMargins(counts, total);
        return { winner: id, method: 'ranked-choice', margins };
      }
    }

    // Find minimum votes
    const minVotes = Math.min(...Object.values(counts));
    const losers = Object.entries(counts)
      .filter(([, c]) => c === minVotes)
      .map(([id]) => id);

    // Tie among all remaining — no winner
    if (losers.length === remaining.size) {
      return { winner: null, method: 'ranked-choice', margins: buildMargins(counts, total) };
    }

    // Eliminate all tied losers
    for (const loser of losers) remaining.delete(loser);
  }

  const winner = remaining.size === 1 ? [...remaining][0] : null;
  return { winner, method: 'ranked-choice', margins: {} };
}

/**
 * Weighted scoring: confidence * (numProposals - rankPosition) per proposal.
 * @param {Array} votes
 * @param {string[]} proposalIds
 * @returns {{ winner: string|null, method: string, margins: Object }}
 */
export function weightedScoring(votes, proposalIds) {
  const n = proposalIds.length;
  const scores = {};
  for (const id of proposalIds) scores[id] = 0;

  for (const vote of votes) {
    if (!vote.rankings || vote.rankings.length === 0) continue;
    vote.rankings.forEach((id, idx) => {
      if (id in scores) {
        scores[id] += vote.confidence * (n - idx);
      }
    });
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const winner = sorted.length > 0 ? sorted[0][0] : null;
  const margins = buildScoreMargins(scores);
  return { winner, method: 'weighted', margins };
}

/**
 * Simple majority: most first-place votes wins.
 * @param {Array} votes
 * @param {string[]} proposalIds
 * @returns {{ winner: string|null, method: string, margins: Object }}
 */
export function simpleMajority(votes, proposalIds) {
  const counts = {};
  for (const id of proposalIds) counts[id] = 0;

  for (const vote of votes) {
    if (!vote.rankings || vote.rankings.length === 0) continue;
    const top = vote.rankings[0];
    if (top in counts) counts[top]++;
  }

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const winner = sorted.length > 0 ? sorted[0][0] : null;
  const total = votes.length;
  const margins = buildMargins(counts, total);
  return { winner, method: 'majority', margins };
}

/**
 * Keyword sentiment analysis for vote/critique consistency.
 * @param {Object} vote - { rankings, confidence }
 * @param {string} proposalId
 * @param {string} critiqueText
 * @returns {number} 0.5 | 0.75 | 1.0
 */
export function computeConsistencyScore(vote, proposalId, critiqueText) {
  const isTopRanked = vote.rankings && vote.rankings[0] === proposalId;
  if (!isTopRanked) return 0.75;

  const lower = critiqueText.toLowerCase();
  const hasPositive = POSITIVE_WORDS.some(w => lower.includes(w));
  const hasNegative = NEGATIVE_WORDS.some(w => lower.includes(w));

  if (hasNegative && !hasPositive) return 0.5;
  if (hasPositive && !hasNegative) return 1.0;
  return 0.75;
}

/**
 * Detect voting coalitions across rounds.
 * Two agents that consistently rank each other's proposals 1st/2nd across 2+ rounds.
 * @param {Array[]} voteHistory - Array of rounds, each round is array of votes
 * @returns {Array} [{ agents: [id1, id2], strength }]
 */
export function detectCoalitions(voteHistory) {
  // Track per pair how many rounds they mutually rank each other's props 1st or 2nd
  const pairCounts = {};

  for (const round of voteHistory) {
    // Build a map: agentId -> their top-2 ranked proposals
    const agentTop2 = {};
    for (const vote of round) {
      agentTop2[vote.agentId] = (vote.rankings || []).slice(0, 2);
    }

    const agents = round.map(v => v.agentId);
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const a = agents[i];
        const b = agents[j];
        const aTop2 = agentTop2[a] || [];
        const bTop2 = agentTop2[b] || [];

        // Check if a ranks b's proposal (identified by containing agentId in prop name)
        // and b ranks a's proposal
        // The convention in the test: agent 'claude' has proposal 'claude-prop'
        // We detect mutual ranking: a has b in their top2, b has a in their top2
        const aRanksB = aTop2.some(p => p.includes(b));
        const bRanksA = bTop2.some(p => p.includes(a));

        if (aRanksB && bRanksA) {
          const key = [a, b].sort().join('|');
          pairCounts[key] = (pairCounts[key] || 0) + 1;
        }
      }
    }
  }

  const coalitions = [];
  for (const [key, count] of Object.entries(pairCounts)) {
    if (count >= 2) {
      coalitions.push({ agents: key.split('|'), strength: count / voteHistory.length });
    }
  }

  return coalitions;
}

/**
 * Full fallback chain for vote resolution.
 * @param {Array} votes
 * @param {string[]} proposalIds
 * @param {Object} opts
 * @returns {{ outcome, winner, method, margins, dissent, converged }}
 */
export function resolveVotes(votes, proposalIds, opts = {}) {
  const abstains = votes.filter(v => !v.rankings || v.rankings.length === 0);
  if (abstains.length >= 3) {
    return { outcome: 'irreconcilable', winner: null, method: null, margins: {}, dissent: abstains.map(v => v.agentId), converged: false };
  }

  // Try ranked-choice
  const rc = rankedChoice(votes, proposalIds);
  if (rc.winner) {
    return { outcome: 'resolved', winner: rc.winner, method: rc.method, margins: rc.margins, dissent: [], converged: true };
  }

  // Try weighted scoring
  const ws = weightedScoring(votes, proposalIds);
  if (ws.winner) {
    return { outcome: 'resolved', winner: ws.winner, method: ws.method, margins: ws.margins, dissent: [], converged: true };
  }

  // Try simple majority
  const sm = simpleMajority(votes, proposalIds);
  if (sm.winner) {
    return { outcome: 'resolved', winner: sm.winner, method: sm.method, margins: sm.margins, dissent: [], converged: true };
  }

  return { outcome: 'needs-tiebreak', winner: null, method: null, margins: {}, dissent: [], converged: false };
}

// --- Helpers ---

function buildMargins(counts, total) {
  const margins = {};
  for (const [id, count] of Object.entries(counts)) {
    margins[id] = total > 0 ? count / total : 0;
  }
  return margins;
}

function buildScoreMargins(scores) {
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  const margins = {};
  for (const [id, score] of Object.entries(scores)) {
    margins[id] = total > 0 ? score / total : 0;
  }
  return margins;
}
