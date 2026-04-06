import { BaseAdapter } from './base.mjs';
import { spawnAgent, extractJson } from '../process.mjs';

export class ClaudeAdapter extends BaseAdapter {
  constructor(config) { super({ ...config, cli: 'claude' }); }
  get minVersion() { return '2.0.0'; }

  async *execute(prompt, opts = {}) {
    const cliPath = this.cliPath || await this.resolveCli();
    if (!cliPath) throw new Error('Claude CLI not found');
    const args = ['-p', prompt, '--output-format', 'stream-json'];
    if (this.model) args.push('--model', this.model);
    args.push('--max-turns', '3');

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
    let lastContent = '';
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'result' && event.result) lastContent = event.result;
        else if (event.type === 'assistant' && event.message?.content) {
          lastContent = event.message.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
        }
      } catch { lastContent += line + '\n'; }
    }
    return { content: lastContent || raw, structured: extractJson(lastContent || raw), error: null };
  }

  async install() {
    const result = await spawnAgent('npm', ['install', '-g', '@anthropic-ai/claude-code'], { timeout: 120000 });
    return { success: result.exitCode === 0, error: result.stderr || null };
  }

  async pulseCheck() {
    const cliPath = this.cliPath || await this.resolveCli();
    if (!cliPath) return false;
    const result = await spawnAgent(cliPath, ['-p', 'reply with OK', '--max-turns', '1', '--model', 'haiku'], { timeout: 15000, maxOutput: 1024 });
    return result.exitCode === 0 && result.stdout.trim().length > 0;
  }
}
