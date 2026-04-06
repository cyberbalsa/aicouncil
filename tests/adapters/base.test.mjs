import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BaseAdapter } from '../../scripts/lib/adapters/base.mjs';

describe('BaseAdapter', () => {
  it('throws if execute is not implemented', async () => {
    const adapter = new BaseAdapter({ id: 'test', cli: 'node', timeout: 5 });
    await assert.rejects(
      async () => { for await (const _ of adapter.execute('hi')) {} },
      /must implement execute/
    );
  });
  it('resolves CLI path via which', async () => {
    const adapter = new BaseAdapter({ id: 'test', cli: 'node', timeout: 5 });
    const result = await adapter.resolveCli();
    assert.ok(result);
    assert.ok(result.includes('node'));
  });
  it('returns unavailable for missing CLI', async () => {
    const adapter = new BaseAdapter({ id: 'test', cli: 'nonexistent-cli-xyz', timeout: 5 });
    const result = await adapter.checkAvailable();
    assert.equal(result.available, false);
    assert.equal(result.cliPath, null);
  });
  it('compares versions correctly', () => {
    const adapter = new BaseAdapter({ id: 'test', cli: 'node', timeout: 5 });
    assert.equal(adapter.isVersionSufficient('2.0.0', '1.0.0'), true);
    assert.equal(adapter.isVersionSufficient('1.0.0', '2.0.0'), false);
    assert.equal(adapter.isVersionSufficient('1.0.0', '1.0.0'), true);
  });
});
