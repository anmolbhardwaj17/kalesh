import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setAgent, clearAgent, parseArgs, readAgents } from './agents.mjs';

describe('agents now (P2-050)', () => {
  it('adds an agent with a since stamp and folds whitespace', () => {
    const { list, agent } = setAgent([], 'builder-main', { lane: 'main', role: 'builder', task: 'P2-010', what: '  building   kits\nspeed fix ' }, '2026-11-14T10:00:00Z');
    expect(agent).toEqual({ name: 'builder-main', lane: 'main', role: 'builder', task: 'P2-010', what: 'building kits speed fix', since: '2026-11-14T10:00:00Z' });
    expect(list).toHaveLength(1);
  });
  it('replaces in place and keeps since for the same task, restarts it for a new task', () => {
    let { list } = setAgent([], 'a', { task: 'T1', what: 'one' }, '2026-11-14T10:00:00Z');
    ({ list } = setAgent(list, 'b', { lane: 'map', task: 'T9', what: 'x' }, '2026-11-14T10:05:00Z'));
    ({ list } = setAgent(list, 'a', { task: 'T1', what: 'two' }, '2026-11-14T11:00:00Z'));
    expect(list.map((x) => x.name)).toEqual(['a', 'b']);
    expect(list[0]).toMatchObject({ what: 'two', since: '2026-11-14T10:00:00Z' });
    ({ list } = setAgent(list, 'a', { task: 'T2', what: 'three' }, '2026-11-14T12:00:00Z'));
    expect(list[0].since).toBe('2026-11-14T12:00:00Z');
  });
  it('rejects unknown lanes and roles and empty names', () => {
    expect(() => setAgent([], 'a', { lane: 'moon' })).toThrow();
    expect(() => setAgent([], 'a', { role: 'boss' })).toThrow();
    expect(() => setAgent([], '  ', {})).toThrow();
  });
  it('clears by name and throws when missing', () => {
    const { list } = setAgent([], 'a', { task: 'T1' });
    expect(clearAgent(list, 'a')).toEqual([]);
    expect(() => clearAgent(list, 'z')).toThrow();
  });
  it('parses positional words and --options', () => {
    expect(parseArgs(['set', 'x', '--lane', 'map', '--what', 'a b'])).toEqual({ pos: ['set', 'x'], opts: { lane: 'map', what: 'a b' } });
  });
  it('the command writes harness/state/agents.json under the repo root and list reads it back', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-test-'));
    const script = path.resolve(import.meta.dirname, 'agents.mjs');
    const run = (...a) => execFileSync('node', [script, ...a], { env: { ...process.env, HARNESS_ROOT: root }, encoding: 'utf8' });
    run('set', 'verifier-1', '--lane', 'verify', '--role', 'verifier', '--task', 'P2-009', '--what', 'checking kits');
    const file = path.join(root, 'harness', 'state', 'agents.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(Object.keys(data)).toEqual(['agents']);
    expect(data.agents[0]).toMatchObject({ name: 'verifier-1', lane: 'verify', role: 'verifier', task: 'P2-009', what: 'checking kits' });
    expect(Date.parse(data.agents[0].since)).toBeGreaterThan(0);
    expect(readAgents(file)).toHaveLength(1);
    expect(run('list')).toContain('verifier-1');
    run('clear', 'verifier-1');
    expect(readAgents(file)).toEqual([]);
    expect(run('list')).toContain('no agents running');
    fs.rmSync(root, { recursive: true, force: true });
  });
});
