import { BaseAdapter } from './base.mjs';
import { spawnAgent, extractJson } from '../process.mjs';

export class MiniMaxAdapter extends BaseAdapter {
  constructor(config) {
    super({ ...config, cli: 'opencode' });
    this.model = config.model || 'minimax/MiniMax-M2.7-highspeed';
    this.sessionId = null;
  }
  get minVersion() { return '0.1.0'; }

  _dataDir() { return `/tmp/council-${this.id}-${this.sessionId || 'default'}`; }

  async *execute(prompt, opts = {}) {
    const cliPath = this.cliPath || await this.resolveCli();
    if (!cliPath) throw new Error('OpenCode CLI not found');
    const args = ['run', '-m', this.model, '--format', 'default', prompt];
    yield { type: 'started', agentId: this.id, timestamp: new Date().toISOString() };
    const result = await spawnAgent(cliPath, args, {
      timeout: opts.timeout || this.timeout, maxOutput: opts.maxOutput || 51200,
      stalenessTimeout: opts.stalenessTimeout || 30000, cwd: opts.cwd,
      env: { XDG_DATA_HOME: this._dataDir() },
    });
    if (result.timedOut) { yield { type: 'timed_out', agentId: this.id, timeoutMs: opts.timeout || this.timeout }; return; }
    const hasError = result.stdout.toLowerCase().includes('error') && result.stdout.trim().length < 200;
    if (hasError || !result.stdout.trim()) {
      yield { type: 'failed', agentId: this.id, error: result.stdout.trim() || result.stderr.trim() || 'Empty output', exitCode: result.exitCode };
      return;
    }
    yield { type: 'completed', agentId: this.id, content: result.stdout, durationMs: result.durationMs, exitCode: result.exitCode };
  }

  parseResponse(raw) { return { content: raw, structured: extractJson(raw), error: null }; }

  async install() {
    const result = await spawnAgent('bash', ['-c', 'curl -fsSL https://opencode.ai/install | bash'], { timeout: 120000 });
    return { success: result.exitCode === 0, error: result.stderr || null };
  }

  async pulseCheck() {
    const cliPath = this.cliPath || await this.resolveCli();
    if (!cliPath) return false;
    const result = await spawnAgent(cliPath, ['run', '-m', this.model, 'reply with OK'], {
      timeout: 20000, maxOutput: 1024, env: { XDG_DATA_HOME: this._dataDir() },
    });
    return result.stdout.trim().length > 0 && !result.timedOut;
  }
}
