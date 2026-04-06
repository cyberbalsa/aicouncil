#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { appendFileSync, rmSync, existsSync } from 'node:fs';

const event = process.argv[2];

if (event === 'SessionStart') {
  const sessionId = randomUUID();
  const envFile = process.env.CLAUDE_ENV_FILE;
  if (envFile) appendFileSync(envFile, `export COUNCIL_SESSION_ID="${sessionId}"\n`);
}

if (event === 'SessionEnd') {
  const sessionId = process.env.COUNCIL_SESSION_ID;
  if (sessionId) {
    for (const agent of ['minimax', 'kimi']) {
      const dir = `/tmp/council-${agent}-${sessionId}`;
      if (existsSync(dir)) try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }
}
