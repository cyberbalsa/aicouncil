import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadDefaults, mergeConfigs, resolveAgentConfig } from '../scripts/lib/config.mjs';

describe('loadDefaults', () => {
  it('returns default config with all 5 agents', () => {
    const config = loadDefaults();
    assert.ok(config.agents.claude);
    assert.ok(config.agents.codex);
    assert.ok(config.agents.gemini);
    assert.ok(config.agents.minimax);
    assert.ok(config.agents.kimi);
    assert.equal(config.agents.claude.model, 'opus');
    assert.equal(config.council.maxRounds, 3);
    assert.equal(config.council.quorum, 3);
  });
});

describe('mergeConfigs', () => {
  it('overrides defaults with user config', () => {
    const defaults = loadDefaults();
    const userOverrides = { agents: { claude: { timeout: 60 } } };
    const merged = mergeConfigs(defaults, userOverrides);
    assert.equal(merged.agents.claude.timeout, 60);
    assert.equal(merged.agents.claude.model, 'opus');
  });
  it('overrides user config with project config', () => {
    const defaults = loadDefaults();
    const user = { council: { maxRounds: 5 } };
    const project = { council: { maxRounds: 2 } };
    const merged = mergeConfigs(mergeConfigs(defaults, user), project);
    assert.equal(merged.council.maxRounds, 2);
  });
  it('handles empty overrides gracefully', () => {
    const defaults = loadDefaults();
    const merged = mergeConfigs(defaults, {});
    assert.deepEqual(merged, defaults);
  });
});

describe('resolveAgentConfig', () => {
  it('returns only enabled agents', () => {
    const config = loadDefaults();
    config.agents.kimi.enabled = false;
    const agents = resolveAgentConfig(config);
    assert.equal(agents.length, 4);
    assert.ok(!agents.find(a => a.id === 'kimi'));
  });
  it('sorts agents by priority descending', () => {
    const config = loadDefaults();
    const agents = resolveAgentConfig(config);
    assert.equal(agents[0].id, 'claude');
    assert.equal(agents[agents.length - 1].id, 'kimi');
  });
});
