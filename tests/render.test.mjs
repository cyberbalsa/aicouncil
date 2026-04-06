import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderSummary, renderTranscript, renderSetupReport, renderConsultResult, renderChainResult } from '../scripts/lib/render.mjs';

describe('renderSummary', () => {
  it('renders consensus outcome', () => {
    const session = {
      outcome: 'consensus',
      rounds: [{
        outcome: { winner: 'round-1-claude', method: 'ranked-choice', margins: { 'round-1-claude': 4, 'round-1-codex': 1 }, dissent: [] },
        proposals: [
          { id: 'round-1-claude', agentId: 'claude', content: 'Use JWT tokens', summary: 'JWT approach' },
          { id: 'round-1-codex', agentId: 'codex', content: 'Use sessions', summary: 'Session approach' },
        ],
        amendments: [],
      }],
    };
    const output = renderSummary(session);
    assert.ok(output.includes('Council Decision: consensus'));
    assert.ok(output.includes('Claude'));
    assert.ok(output.includes('ranked-choice'));
    assert.ok(output.includes('JWT'));
  });

  it('renders irreconcilable outcome', () => {
    const session = {
      outcome: 'irreconcilable',
      rounds: [{
        outcome: { winner: null, method: 'exhausted', margins: {}, dissent: [] },
        proposals: [],
        amendments: [],
      }],
    };
    const output = renderSummary(session);
    assert.ok(output.includes('irreconcilable'));
    assert.ok(output.includes('No consensus'));
  });

  it('renders plurality outcome with dissenting views', () => {
    const session = {
      outcome: 'plurality',
      rounds: [{
        outcome: {
          winner: 'round-1-gemini',
          method: 'simple-majority',
          margins: { 'round-1-gemini': 3, 'round-1-claude': 2 },
          dissent: [{ agentId: 'claude', reason: 'Insufficient security analysis' }],
        },
        proposals: [
          { id: 'round-1-gemini', agentId: 'gemini', content: 'Use OAuth2', summary: 'OAuth2 approach' },
        ],
        amendments: ['Added rate limiting'],
      }],
    };
    const output = renderSummary(session);
    assert.ok(output.includes('Council Decision: plurality'));
    assert.ok(output.includes('Gemini'));
    assert.ok(output.includes('Claude'));
    assert.ok(output.includes('Insufficient security analysis'));
    assert.ok(output.includes('Added rate limiting'));
  });
});

describe('renderTranscript', () => {
  it('renders entries with timestamp, agent, type, and content', () => {
    const entries = [
      { timestamp: '2024-01-01T10:00:00Z', agentId: 'claude', type: 'proposal', duration: 1200, content: 'My proposal here' },
      { timestamp: '2024-01-01T10:01:00Z', agentId: 'codex', type: 'critique', duration: 800, content: 'I disagree because...' },
    ];
    const output = renderTranscript(entries);
    assert.ok(output.includes('claude') || output.includes('Claude'));
    assert.ok(output.includes('proposal'));
    assert.ok(output.includes('My proposal here'));
    assert.ok(output.includes('---'));
    assert.ok(output.includes('critique'));
    assert.ok(output.includes('I disagree because'));
  });

  it('handles empty entries', () => {
    const output = renderTranscript([]);
    assert.equal(typeof output, 'string');
  });
});

describe('renderSetupReport', () => {
  it('renders agent availability table', () => {
    const report = [
      { id: 'claude', available: true, version: '2.1.92', authenticated: true },
      { id: 'codex', available: true, version: '1.0.2', authenticated: true },
      { id: 'gemini', available: false, version: null, authenticated: false },
    ];
    const output = renderSetupReport(report);
    assert.ok(output.includes('claude') || output.includes('Claude'));
    assert.ok(output.includes('2.1.92'));
    assert.ok(output.includes('missing'));
  });

  it('renders installed and auth status', () => {
    const report = [
      { id: 'kimi', available: true, version: '0.9.0', authenticated: false },
    ];
    const output = renderSetupReport(report);
    assert.ok(output.includes('installed'));
    assert.ok(output.includes('not authenticated') || output.includes('not auth'));
  });
});

describe('renderConsultResult', () => {
  it('renders each agent response under its heading', () => {
    const responses = [
      { agentId: 'claude', content: 'My analysis of the problem' },
      { agentId: 'gemini', content: 'A different perspective' },
    ];
    const output = renderConsultResult(responses);
    assert.ok(output.includes('Claude'));
    assert.ok(output.includes('Gemini'));
    assert.ok(output.includes('My analysis of the problem'));
    assert.ok(output.includes('A different perspective'));
  });

  it('shows error for failed agents', () => {
    const responses = [
      { agentId: 'codex', error: 'CLI not found' },
    ];
    const output = renderConsultResult(responses);
    assert.ok(output.includes('Codex'));
    assert.ok(output.includes('CLI not found'));
  });
});

describe('renderChainResult', () => {
  it('renders numbered steps with agent names', () => {
    const steps = [
      { agentId: 'claude', content: 'First step output' },
      { agentId: 'codex', content: 'Second step output' },
    ];
    const output = renderChainResult(steps);
    assert.ok(output.includes('Step 1'));
    assert.ok(output.includes('Step 2'));
    assert.ok(output.includes('Claude'));
    assert.ok(output.includes('Codex'));
    assert.ok(output.includes('First step output'));
    assert.ok(output.includes('Second step output'));
  });

  it('shows error for failed steps', () => {
    const steps = [
      { agentId: 'minimax', error: 'Timeout exceeded' },
    ];
    const output = renderChainResult(steps);
    assert.ok(output.includes('MiniMax'));
    assert.ok(output.includes('Timeout exceeded'));
  });
});
