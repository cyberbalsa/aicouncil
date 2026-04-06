import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkQuorum, runParallelAgents } from '../scripts/lib/orchestrator.mjs';

class MockAdapter {
  constructor(id, response, delay = 10) {
    this.id = id; this.displayName = id; this.response = response; this.delay = delay; this.sessionId = null;
  }
  async *execute(prompt) {
    yield { type: 'started', agentId: this.id, timestamp: new Date().toISOString() };
    await new Promise(r => setTimeout(r, this.delay));
    yield { type: 'completed', agentId: this.id, content: this.response, durationMs: this.delay, exitCode: 0 };
  }
  parseResponse(raw) { return { content: raw, structured: null, error: null }; }
  async pulseCheck() { return true; }
}

class FailAdapter extends MockAdapter {
  async *execute(prompt) {
    yield { type: 'started', agentId: this.id, timestamp: new Date().toISOString() };
    yield { type: 'failed', agentId: this.id, error: 'test failure', exitCode: 1 };
  }
}

describe('checkQuorum', () => {
  it('returns true when enough agents respond', () => {
    assert.equal(checkQuorum([
      { agentId: 'a', status: 'completed' },
      { agentId: 'b', status: 'completed' },
      { agentId: 'c', status: 'completed' },
    ], 3), true);
  });
  it('returns false when too few agents respond', () => {
    assert.equal(checkQuorum([
      { agentId: 'a', status: 'completed' },
      { agentId: 'b', status: 'failed' },
      { agentId: 'c', status: 'failed' },
    ], 3), false);
  });
});

describe('runParallelAgents', () => {
  it('collects responses from all agents', async () => {
    const adapters = [new MockAdapter('a', 'response A'), new MockAdapter('b', 'response B'), new MockAdapter('c', 'response C')];
    const results = await runParallelAgents(adapters, 'test prompt', {});
    assert.equal(results.length, 3);
    assert.ok(results.every(r => r.status === 'completed'));
  });
  it('handles mixed success and failure', async () => {
    const adapters = [new MockAdapter('a', 'response A'), new FailAdapter('b', ''), new MockAdapter('c', 'response C')];
    const results = await runParallelAgents(adapters, 'test prompt', {});
    assert.equal(results.filter(r => r.status === 'completed').length, 2);
    assert.equal(results.filter(r => r.status === 'failed').length, 1);
  });
});
