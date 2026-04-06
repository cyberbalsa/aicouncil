import { saveTranscript, loadTranscript } from './state.mjs';

/**
 * Create a single transcript entry with defaults.
 */
export function createTranscriptEntry({ agentId, phase, type, content, metadata = {} }) {
  return {
    timestamp: new Date().toISOString(),
    agentId,
    phase,
    type,
    content,
    metadata: {
      durationMs: 0,
      estimatedTokens: null,
      exitCode: null,
      ...metadata,
    },
  };
}

/**
 * Load existing transcript, append new entries, and save.
 */
export async function appendToTranscript(stateRoot, sessionId, entries) {
  const existing = loadTranscript(stateRoot, sessionId);
  const updated = [...existing, ...entries];
  saveTranscript(stateRoot, sessionId, updated);
  return updated;
}

/**
 * Load and return transcript entries for a session.
 */
export function getTranscript(stateRoot, sessionId) {
  return loadTranscript(stateRoot, sessionId);
}

/**
 * Rough token estimate: ~4 characters per token.
 */
export function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  return Math.ceil(text.length / 4);
}
