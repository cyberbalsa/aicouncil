import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSession, saveSession, loadSession, listSessions, saveCheckpoint, loadCheckpoint, pruneOldSessions } from '../scripts/lib/state.mjs';

describe('state', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = mkdtempSync(join(tmpdir(), 'council-test-')); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it('creates a new session', () => {
    const session = createSession({ mode: 'council', originalQuestion: 'Design auth system', workspaceRoot: tmpDir });
    assert.ok(session.id);
    assert.equal(session.mode, 'council');
    assert.ok(session.createdAt);
    assert.equal(session.completedAt, null);
  });
  it('saves and loads a session', () => {
    const session = createSession({ mode: 'consult', originalQuestion: 'Test', workspaceRoot: tmpDir });
    saveSession(tmpDir, session);
    const loaded = loadSession(tmpDir, session.id);
    assert.equal(loaded.id, session.id);
    assert.equal(loaded.mode, 'consult');
  });
  it('lists sessions sorted newest first', async () => {
    const s1 = createSession({ mode: 'ask', originalQuestion: 'Q1', workspaceRoot: tmpDir });
    saveSession(tmpDir, s1);
    // Ensure different timestamp
    await new Promise(r => setTimeout(r, 10));
    const s2 = createSession({ mode: 'ask', originalQuestion: 'Q2', workspaceRoot: tmpDir });
    saveSession(tmpDir, s2);
    const list = listSessions(tmpDir);
    assert.equal(list.length, 2);
    assert.equal(list[0].id, s2.id);
  });
  it('saves and loads checkpoints', () => {
    const session = createSession({ mode: 'council', originalQuestion: 'Q', workspaceRoot: tmpDir });
    saveSession(tmpDir, session);
    saveCheckpoint(tmpDir, session.id, 'round1-generate', { proposals: ['p1'] });
    const cp = loadCheckpoint(tmpDir, session.id, 'round1-generate');
    assert.deepEqual(cp.proposals, ['p1']);
  });
  it('prunes old sessions beyond max', () => {
    for (let i = 0; i < 25; i++) {
      const s = createSession({ mode: 'ask', originalQuestion: `Q${i}`, workspaceRoot: tmpDir });
      saveSession(tmpDir, s);
    }
    pruneOldSessions(tmpDir, 20);
    const list = listSessions(tmpDir);
    assert.equal(list.length, 20);
  });
});
