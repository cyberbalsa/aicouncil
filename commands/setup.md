---
name: setup
description: Detect, install, and authenticate all 5 AI Council agent CLIs (Claude, Codex, Gemini, MiniMax, Kimi)
user-invocable: true
allowed-tools: Bash(node:*,npm:*,which:*,curl:*), AskUserQuestion
---
# Setup
Run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/council-companion.mjs" setup --json`
Parse JSON output. For each agent: if available+authenticated=ready, if available but not auth=guide auth, if not available=offer install.
Auth guidance: Claude=ANTHROPIC_API_KEY, Codex=codex login --with-api-key, Gemini=GEMINI_API_KEY, OpenCode=opencode providers. Warn about OAuth unreliability.
