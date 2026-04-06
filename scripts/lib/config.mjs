import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Read and return config/defaults.json.
 */
export function loadDefaults() {
  const defaultsPath = resolve(__dirname, '../../config/defaults.json');
  return JSON.parse(readFileSync(defaultsPath, 'utf8'));
}

/**
 * Deep merge source into target. Objects merge recursively; arrays and
 * primitives replace. Returns a new object (target is not mutated).
 */
export function mergeConfigs(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return source === undefined ? target : source;
  }
  if (!target || typeof target !== 'object' || Array.isArray(target)) {
    return structuredClone(source);
  }

  const result = Object.assign({}, target);
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];
    if (
      srcVal !== null &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = mergeConfigs(tgtVal, srcVal);
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}

/**
 * Load config with hierarchy: defaults < user < project < cliOverrides.
 * Missing files are silently skipped.
 */
export function loadConfig(cwd, cliOverrides = {}) {
  let config = loadDefaults();

  // User config
  const userConfigPath = resolve(homedir(), '.config/aicouncil/config.json');
  if (existsSync(userConfigPath)) {
    try {
      config = mergeConfigs(config, JSON.parse(readFileSync(userConfigPath, 'utf8')));
    } catch {
      // skip malformed file
    }
  }

  // Project config
  const projectConfigPath = resolve(cwd, '.council/config.json');
  if (existsSync(projectConfigPath)) {
    try {
      config = mergeConfigs(config, JSON.parse(readFileSync(projectConfigPath, 'utf8')));
    } catch {
      // skip malformed file
    }
  }

  // CLI overrides
  if (cliOverrides && typeof cliOverrides === 'object') {
    config = mergeConfigs(config, cliOverrides);
  }

  return config;
}

/**
 * Return array of enabled agents sorted by priority descending.
 */
export function resolveAgentConfig(config) {
  return Object.values(config.agents)
    .filter((agent) => agent.enabled)
    .sort((a, b) => b.priority - a.priority);
}
