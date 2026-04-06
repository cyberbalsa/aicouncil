import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawnAgent } from '../process.mjs';

const execFileAsync = promisify(execFile);

export class BaseAdapter {
  constructor({ id, displayName, cli, model, timeout }) {
    this.id = id;
    this.displayName = displayName ?? id;
    this.cli = cli;
    this.model = model ?? null;
    this.timeout = (timeout ?? 120) * 1000;
    this.cliPath = null;
  }

  get minVersion() {
    return '0.0.0';
  }

  async resolveCli() {
    const { stdout } = await execFileAsync('which', [this.cli]);
    this.cliPath = stdout.trim();
    return this.cliPath;
  }

  async getVersion() {
    const result = await spawnAgent(this.cli, ['--version'], { timeout: 10000 });
    const combined = result.stdout + result.stderr;
    const match = combined.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  }

  isVersionSufficient(actual, minimum) {
    const parse = (v) => v.split('.').map(Number);
    const [aMaj, aMin, aPat] = parse(actual);
    const [mMaj, mMin, mPat] = parse(minimum);
    if (aMaj !== mMaj) return aMaj > mMaj;
    if (aMin !== mMin) return aMin > mMin;
    return aPat >= mPat;
  }

  async checkAvailable() {
    let cliPath = null;
    let version = null;
    let authenticated = false;
    let error = null;

    try {
      cliPath = await this.resolveCli();
    } catch (err) {
      return { available: false, version: null, authenticated: false, cliPath: null, error: err.message };
    }

    try {
      version = await this.getVersion();
    } catch (err) {
      error = err.message;
    }

    return { available: true, version, authenticated, cliPath, error };
  }

  // eslint-disable-next-line require-yield
  async * execute(_prompt, _opts) {
    throw new Error(`${this.id}: must implement execute()`);
  }

  parseResponse(raw) {
    return { content: raw, structured: null, error: null };
  }

  async install() {
    throw new Error(`${this.id}: must implement install()`);
  }

  async pulseCheck() {
    const result = await this.checkAvailable();
    return result.available;
  }

  buildEnv(extraEnv = {}) {
    return { ...process.env, NO_COLOR: '1', TERM: 'dumb', ...extraEnv };
  }
}
