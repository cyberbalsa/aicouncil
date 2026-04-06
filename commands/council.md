---
name: council
description: Run a full multi-round debate with all 5 AI agents using ranked-choice voting
user-invocable: true
argument-hint: '<prompt>'
allowed-tools: Bash(node:*), AskUserQuestion
skills:
  - council-runtime
  - result-handling
---
# Council
Run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/council-companion.mjs" council "$PROMPT"`
Present structured summary verbatim. Do NOT summarize or add commentary. Suggest /council:transcript for details.
