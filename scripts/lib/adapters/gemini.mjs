import { BaseAdapter } from './base.mjs';
import { spawnAgent, extractJson } from '../process.mjs';

export class GeminiAdapter extends BaseAdapter {
  constructor(config) { super({ ...config, cli: 'gemini' }); }
  get minVersion() { return '0.30.0'; }

  async *execute(prompt, opts = {}) {
    const cliPath = this.cliPath || await this.resolveCli();
    if (!cliPath) throw new Error('Gemini CLI not found');
    const args = ['-p', prompt, '-o', 'text', '--yolo'];
    if (this.model) args.push('-m', this.model);
    yield { type: 'started', agentId: this.id, timestamp: new Date().toISOString() };
    const result = await spawnAgent(cliPath, args, {
      timeout: opts.timeout || this.timeout, maxOutput: opts.maxOutput || 51200,
      stalenessTimeout: opts.stalenessTimeout || 30000, cwd: opts.cwd,
    });
    if (result.exitCode === 41) { yield { type: 'failed', agentId: this.id, error: 'Gemini auth failure (exit 41)', exitCode: 41 }; return; }
    if (result.exitCode === 53) { yield { type: 'failed', agentId: this.id, error: 'Gemini turn limit reached (exit 53)', exitCode: 53 }; return; }
    if (result.timedOut) { yield { type: 'timed_out', agentId: this.id, timeoutMs: opts.timeout || this.timeout }; return; }
    if (!result.stdout.trim()) { yield { type: 'failed', agentId: this.id, error: 'Empty output', exitCode: result.exitCode }; return; }
    yield { type: 'completed', agentId: this.id, content: result.stdout, durationMs: result.durationMs, exitCode: result.exitCode };
  }

  parseResponse(raw) {
    const cleaned = raw.split('\n').filter(l => !l.includes('Keychain initialization') && !l.includes('FileKeychain fallback')).join('\n');
    return { content: cleaned, structured: extractJson(cleaned), error: null };
  }

  async install() {
    const result = await spawnAgent('npm', ['install', '-g', '@google/gemini-cli'], { timeout: 120000 });
    return { success: result.exitCode === 0, error: result.stderr || null };
  }

  async pulseCheck() {
    const cliPath = this.cliPath || await this.resolveCli();
    if (!cliPath) return false;
    const result = await spawnAgent(cliPath, ['-p', 'reply with OK', '-o', 'text'], { timeout: 15000, maxOutput: 1024 });
    if (result.exitCode === 41) return false;
    return result.stdout.trim().length > 0;
  }
}
