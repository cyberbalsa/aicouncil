import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stripAnsi, spawnAgent, extractJson } from '../scripts/lib/process.mjs';

describe('stripAnsi', () => {
  it('removes ANSI escape codes', () => {
    assert.equal(stripAnsi('\x1b[31mred\x1b[0m'), 'red');
  });
  it('removes unicode-escaped ANSI', () => {
    assert.equal(stripAnsi('\u001b[34mblue\u001b[0m'), 'blue');
  });
  it('passes through clean text', () => {
    assert.equal(stripAnsi('hello world'), 'hello world');
  });
  it('strips spinner and progress text', () => {
    assert.equal(stripAnsi('⠋ Thinking...\nActual output'), 'Actual output');
  });
});

describe('extractJson', () => {
  it('extracts JSON from dirty output', () => {
    const dirty = 'some noise\n{"result": "ok"}\nmore noise';
    assert.deepEqual(extractJson(dirty), { result: 'ok' });
  });
  it('extracts JSON from markdown code blocks', () => {
    const dirty = '```json\n{"result": "ok"}\n```';
    assert.deepEqual(extractJson(dirty), { result: 'ok' });
  });
  it('returns null for no JSON', () => {
    assert.equal(extractJson('just text'), null);
  });
  it('extracts first valid JSON object', () => {
    const dirty = 'noise {"a":1} more {"b":2}';
    assert.deepEqual(extractJson(dirty), { a: 1 });
  });
});

describe('spawnAgent', () => {
  it('captures stdout from a simple command', async () => {
    const result = await spawnAgent('node', ['-e', 'console.log("hello")'], { timeout: 5000 });
    assert.equal(result.stdout.trim(), 'hello');
    assert.equal(result.exitCode, 0);
    assert.equal(result.timedOut, false);
  });
  it('times out and kills long-running process', async () => {
    const result = await spawnAgent('node', ['-e', 'setTimeout(()=>{},60000)'], { timeout: 500 });
    assert.equal(result.timedOut, true);
  });
  it('respects maxOutput cap', async () => {
    const result = await spawnAgent('node', ['-e', 'console.log("x".repeat(1000))'], { timeout: 5000, maxOutput: 100 });
    assert.ok(result.stdout.length <= 110);
    assert.equal(result.truncated, true);
  });
  it('sets NO_COLOR=1 in env', async () => {
    const result = await spawnAgent('node', ['-e', 'console.log(process.env.NO_COLOR)'], { timeout: 5000 });
    assert.equal(result.stdout.trim(), '1');
  });
  it('detects staleness', async () => {
    const script = 'console.log("start"); setTimeout(()=>{}, 60000)';
    const result = await spawnAgent('node', ['-e', script], { timeout: 10000, stalenessTimeout: 1000 });
    assert.equal(result.timedOut, true);
  });
});
