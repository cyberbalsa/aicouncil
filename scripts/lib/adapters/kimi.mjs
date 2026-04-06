import { MiniMaxAdapter } from './minimax.mjs';

export class KimiAdapter extends MiniMaxAdapter {
  constructor(config) {
    super({ ...config, model: config.model || 'kimi-for-coding/k2p5' });
    this.id = 'kimi';
    this.displayName = config.displayName || 'Kimi';
  }
  _dataDir() { return `/tmp/council-kimi-${this.sessionId || 'default'}`; }
}
