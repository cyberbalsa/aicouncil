---
name: ask
description: Query a single AI agent directly (claude, codex, gemini, minimax, kimi)
user-invocable: true
argument-hint: '<agent> <prompt>'
allowed-tools: Bash(node:*)
---
# Ask
Parse first argument as agent name. Run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/council-companion.mjs" ask "$AGENT" "$PROMPT"`
Present response verbatim.
