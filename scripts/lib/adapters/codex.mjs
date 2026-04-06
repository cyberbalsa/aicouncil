import { BaseAdapter } from './base.mjs';
import { spawnAgent, extractJson } from '../process.mjs';

export class CodexAdapter extends BaseAdapter {
  constructor(config) { super({ ...config, cli: 'codex' }); }
  get minVersion() { return '1.0.0'; }

  async *execute(prompt, opts = {}) {
    const cliPath = this.cliPath || await this.resolveCli();
    if (!cliPath) throw new Error('Codex CLI not found');
    const args = ['exec', prompt, '--json', '--full-auto', '--ephemeral'];
    yield { type: 'started', agentId: this.id, timestamp: new Date().toISOString() };
    const result = await spawnAgent(cliPath, args, {
      timeout: opts.timeout || this.timeout, maxOutput: opts.maxOutput || 51200,
      stalenessTimeout: opts.stalenessTimeout || 30000, cwd: opts.cwd,
    });
    if (result.timedOut) { yield { type: 'timed_out', agentId: this.id, timeoutMs: opts.timeout || this.timeout }; return; }
    if (!result.stdout.trim()) { yield { type: 'failed', agentId: this.id, error: 'Empty output', exitCode: result.exitCode }; return; }
    yield { type: 'completed', agentId: this.id, content: result.stdout, durationMs: result.durationMs, exitCode: result.exitCode };
  }

  parseResponse(raw) {
    const lines = raw.split('\n').filter(l => l.trim());
    let lastMessage = '';
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'message' && event.content) lastMessage = event.content;
        else if (event.message) lastMessage = typeof event.message === 'string' ? event.message : JSON.stringify(event.message);
      } catch { lastMessage += line + '\n'; }
    }
    return { content: lastMessage || raw, structured: extractJson(lastMessage || raw), error: null };
  }

  async install() {
    const result = await spawnAgent('npm', ['install', '-g', '@openai/codex'], { timeout: 120000 });
    return { success: result.exitCode === 0, error: result.stderr || null };
  }

  async pulseCheck() {
    const cliPath = this.cliPath || await this.resolveCli();
    if (!cliPath) return false;
    const result = await spawnAgent(cliPath, ['exec', 'reply with OK', '--ephemeral'], { timeout: 15000, maxOutput: 1024 });
    return result.stdout.trim().length > 0;
  }
}
