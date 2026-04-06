---
name: transcript
description: View the full transcript of the last or specified council session
user-invocable: true
argument-hint: '[session-id]'
allowed-tools: Bash(node:*)
---
# Transcript
Run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/council-companion.mjs" transcript "$SESSION_ID"`
If no session ID, shows most recent.
