import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rankedChoice, weightedScoring, simpleMajority, computeConsistencyScore, detectCoalitions, resolveVotes } from '../scripts/lib/voting.mjs';

describe('rankedChoice', () => {
  it('returns winner with >50% first-choice votes', () => {
    const votes = [
      { agentId: 'claude', rankings: ['A', 'B', 'C'], confidence: 8 },
      { agentId: 'codex', rankings: ['A', 'C', 'B'], confidence: 7 },
      { agentId: 'gemini', rankings: ['A', 'B', 'C'], confidence: 9 },
      { agentId: 'minimax', rankings: ['B', 'A', 'C'], confidence: 6 },
      { agentId: 'kimi', rankings: ['C', 'A', 'B'], confidence: 5 },
    ];
    const result = rankedChoice(votes, ['A', 'B', 'C']);
    assert.equal(result.winner, 'A');
    assert.equal(result.method, 'ranked-choice');
  });
  it('eliminates lowest and redistributes', () => {
    const votes = [
      { agentId: 'claude', rankings: ['A', 'B'], confidence: 8 },
      { agentId: 'codex', rankings: ['B', 'A'], confidence: 7 },
      { agentId: 'gemini', rankings: ['C', 'A'], confidence: 9 },
      { agentId: 'minimax', rankings: ['A', 'B'], confidence: 6 },
      { agentId: 'kimi', rankings: ['B', 'C'], confidence: 5 },
    ];
    const result = rankedChoice(votes, ['A', 'B', 'C']);
    assert.equal(result.winner, 'A');
  });
  it('returns null if tie persists', () => {
    const votes = [
      { agentId: 'claude', rankings: ['A'], confidence: 8 },
      { agentId: 'codex', rankings: ['B'], confidence: 8 },
    ];
    const result = rankedChoice(votes, ['A', 'B']);
    assert.equal(result.winner, null);
  });
  it('handles abstain votes', () => {
    const votes = [
      { agentId: 'claude', rankings: ['A', 'B'], confidence: 8 },
      { agentId: 'codex', rankings: ['A', 'B'], confidence: 7 },
      { agentId: 'gemini', rankings: [], confidence: 0 },
      { agentId: 'minimax', rankings: ['B', 'A'], confidence: 6 },
    ];
    const result = rankedChoice(votes, ['A', 'B']);
    assert.equal(result.winner, 'A');
  });
});

describe('weightedScoring', () => {
  it('scores based on confidence * inverse rank', () => {
    const votes = [
      { agentId: 'claude', rankings: ['A', 'B'], confidence: 10 },
      { agentId: 'codex', rankings: ['B', 'A'], confidence: 10 },
      { agentId: 'gemini', rankings: ['A', 'B'], confidence: 8 },
    ];
    const result = weightedScoring(votes, ['A', 'B']);
    assert.equal(result.winner, 'A');
  });
});

describe('simpleMajority', () => {
  it('returns proposal with most first-place votes', () => {
    const votes = [
      { agentId: 'claude', rankings: ['A', 'B'], confidence: 8 },
      { agentId: 'codex', rankings: ['B', 'A'], confidence: 7 },
      { agentId: 'gemini', rankings: ['A', 'B'], confidence: 9 },
    ];
    const result = simpleMajority(votes, ['A', 'B']);
    assert.equal(result.winner, 'A');
  });
});

describe('computeConsistencyScore', () => {
  it('returns 1.0 for consistent vote/critique', () => {
    const score = computeConsistencyScore({ rankings: ['A', 'B'], confidence: 8 }, 'A', 'Proposal A is strong and well-designed');
    assert.equal(score, 1.0);
  });
  it('returns 0.5 for contradictory vote/critique', () => {
    const score = computeConsistencyScore({ rankings: ['A', 'B'], confidence: 8 }, 'A', 'Proposal A is flawed and has missing security checks');
    assert.equal(score, 0.5);
  });
  it('returns 0.75 for ambiguous', () => {
    const score = computeConsistencyScore({ rankings: ['A', 'B'], confidence: 8 }, 'A', 'Proposal A has some interesting ideas');
    assert.equal(score, 0.75);
  });
});

describe('detectCoalitions', () => {
  it('detects agents that consistently rank each other first', () => {
    const voteHistory = [
      [
        { agentId: 'claude', rankings: ['claude-prop', 'codex-prop'] },
        { agentId: 'codex', rankings: ['codex-prop', 'claude-prop'] },
      ],
      [
        { agentId: 'claude', rankings: ['claude-prop', 'codex-prop'] },
        { agentId: 'codex', rankings: ['codex-prop', 'claude-prop'] },
      ],
    ];
    const coalitions = detectCoalitions(voteHistory);
    assert.equal(coalitions.length, 1);
    assert.deepEqual(coalitions[0].agents.sort(), ['claude', 'codex']);
  });
  it('returns empty for no coalitions', () => {
    const voteHistory = [[
      { agentId: 'claude', rankings: ['A', 'B'] },
      { agentId: 'codex', rankings: ['B', 'A'] },
    ]];
    const coalitions = detectCoalitions(voteHistory);
    assert.equal(coalitions.length, 0);
  });
});

describe('resolveVotes', () => {
  it('returns irreconcilable when 3+ agents abstain', () => {
    const votes = [
      { agentId: 'claude', rankings: [], confidence: 0 },
      { agentId: 'codex', rankings: [], confidence: 0 },
      { agentId: 'gemini', rankings: [], confidence: 0 },
      { agentId: 'minimax', rankings: ['A'], confidence: 5 },
    ];
    const result = resolveVotes(votes, ['A'], {});
    assert.equal(result.outcome, 'irreconcilable');
  });
});
