---
name: consult
description: Quick fan-out query to all 5 AI agents with synthesis
user-invocable: true
argument-hint: '<prompt>'
allowed-tools: Bash(node:*)
skills:
  - result-handling
---
# Consult
Run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/council-companion.mjs" consult "$PROMPT"`
Present results verbatim.
