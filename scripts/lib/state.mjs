import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Resolve per-workspace state directory using a hash of workspaceRoot
export function resolveStateDir(workspaceRoot) {
  const hash = createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 12);
  const base = process.env.CLAUDE_PLUGIN_DATA
    ? join(process.env.CLAUDE_PLUGIN_DATA, 'aicouncil')
    : join(homedir(), '.claude', 'plugins', 'data', 'aicouncil');
  return join(base, 'state', hash);
}

// Create a new session object (not persisted)
export function createSession({ mode, originalQuestion, workspaceRoot, agents = [], config = {}, cliVersions = {} } = {}) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    mode,
    workspaceRoot,
    originalQuestion,
    workingQuestion: originalQuestion,
    agents,
    rounds: [],
    outcome: null,
    summary: null,
    transcript: [],
    config,
    cliVersions,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

function sessionDir(stateRoot, sessionId) {
  return join(stateRoot, 'sessions', sessionId);
}

// Persist session to disk, updating updatedAt
export function saveSession(stateRoot, session) {
  const dir = sessionDir(stateRoot, session.id);
  mkdirSync(dir, { recursive: true });
  const updated = { ...session, updatedAt: new Date().toISOString() };
  writeFileSync(join(dir, 'session.json'), JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

// Load session by id; return null if not found
export function loadSession(stateRoot, sessionId) {
  const file = join(sessionDir(stateRoot, sessionId), 'session.json');
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

// List all sessions sorted newest first by createdAt
export function listSessions(stateRoot) {
  const sessionsDir = join(stateRoot, 'sessions');
  if (!existsSync(sessionsDir)) return [];
  const entries = readdirSync(sessionsDir, { withFileTypes: true });
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const session = loadSession(stateRoot, entry.name);
    if (session) sessions.push(session);
  }
  sessions.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  return sessions;
}

// Save a named checkpoint for a session
export function saveCheckpoint(stateRoot, sessionId, name, data) {
  const dir = sessionDir(stateRoot, sessionId);
  mkdirSync(dir, { recursive: true });
  const payload = { ...data, _checkpointAt: new Date().toISOString() };
  writeFileSync(join(dir, `checkpoint-${name}.json`), JSON.stringify(payload, null, 2), 'utf8');
}

// Load a named checkpoint; return null if not found
export function loadCheckpoint(stateRoot, sessionId, name) {
  const file = join(sessionDir(stateRoot, sessionId), `checkpoint-${name}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

// Write transcript entries to disk
export function saveTranscript(stateRoot, sessionId, entries) {
  const dir = sessionDir(stateRoot, sessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'transcript.json'), JSON.stringify(entries, null, 2), 'utf8');
}

// Load transcript; return [] if not found
export function loadTranscript(stateRoot, sessionId) {
  const file = join(sessionDir(stateRoot, sessionId), 'transcript.json');
  if (!existsSync(file)) return [];
  return JSON.parse(readFileSync(file, 'utf8'));
}

// Delete oldest sessions beyond max, keeping newest max sessions
export function pruneOldSessions(stateRoot, max = 20) {
  const sessions = listSessions(stateRoot);
  if (sessions.length <= max) return;
  const toDelete = sessions.slice(max);
  for (const session of toDelete) {
    const dir = sessionDir(stateRoot, session.id);
    rmSync(dir, { recursive: true, force: true });
  }
}
