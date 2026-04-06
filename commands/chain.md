---
name: chain
description: Run a sequential pipeline through multiple agents (e.g., gemini,codex,claude)
user-invocable: true
argument-hint: '<agent1,agent2,...> <prompt>'
allowed-tools: Bash(node:*)
skills:
  - result-handling
---
# Chain
Parse agents as comma-separated list. Run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/council-companion.mjs" chain "$AGENTS" "$PROMPT"`
Present chain results verbatim.
