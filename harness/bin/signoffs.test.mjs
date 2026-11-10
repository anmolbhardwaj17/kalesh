// Tests for the three Phase 0 sign-offs: the pure table (signoffs.mjs) and the task.mjs commands, run on a scratch copy
// of the harness (HARNESS_ROOT) so the real state is never touched.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Each test spawns task.mjs several times; under load (Godot running) that passes 5 s. Flake seen 2026-11-10.
vi.setConfig({ testTimeout: 30000 });
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { signoffStates, statusLines, phaseReasons, finalReasons, DESIGN_EXIT } from './signoffs.mjs';

const TASK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'task.mjs');

describe('signoffs table', () => {
  it('lists style, architecture and game design, signed or not', () => {
    const rows = signoffStates({ styleSignoff: { at: 't', quote: 'yes toon B' } });
    expect(rows.map((r) => [r.key, r.signed])).toEqual([['style', true], ['architecture', false], ['design', false]]);
    expect(rows[0]).toMatchObject({ quote: 'yes toon B', at: 't' });
  });
  it('status names each missing sign-off with its command', () => {
    const lines = statusLines({});
    expect(lines).toHaveLength(3);
    expect(lines.join('\n')).toContain('game design sign-off: not yet');
    expect(lines.join('\n')).toContain('task.mjs designsignoff');
    expect(statusLines({ styleSignoff: {}, archSignoff: {}, designSignoff: {} })).toEqual([]);
  });
  it('a phase gate lists only the sign-offs the phase asks for', () => {
    expect(phaseReasons({ id: 'P0', signoff: true, archSignoff: true, designSignoff: true }, {}).join('\n')).toContain('No game design sign-off');
    expect(phaseReasons({ id: 'P0', signoff: true }, {})).toHaveLength(1);
    expect(phaseReasons({ id: 'P0', designSignoff: true }, { designSignoff: { at: 't', quote: 'q' } })).toEqual([]);
  });
  it('the final gate always wants style, and design once any phase asks for it', () => {
    expect(finalReasons([{ id: 'P0' }], {})).toHaveLength(1);
    const r = finalReasons([{ id: 'P0', archSignoff: true, designSignoff: true }], { styleSignoff: {} });
    expect(r).toHaveLength(2);
    expect(r.join('\n')).toContain('No game design sign-off');
  });
});

describe('task.mjs designsignoff and gates', () => {
  let root;
  const run = (...a) => spawnSync(process.execPath, [TASK, ...a], { env: { ...process.env, HARNESS_ROOT: root }, encoding: 'utf8' });
  const json = (f) => JSON.parse(fs.readFileSync(path.join(root, 'harness', f), 'utf8'));
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'signoff-'));
    for (const d of ['state', 'data', 'reports', 'requests']) fs.mkdirSync(path.join(root, 'harness', d), { recursive: true });
    fs.writeFileSync(path.join(root, 'harness', 'kit.config.json'), JSON.stringify({ game: 'T', owner: 'Anmol' }));
    fs.writeFileSync(path.join(root, 'harness', 'data', 'milestones.json'), JSON.stringify({ milestones: [] }));
    fs.writeFileSync(path.join(root, 'harness', 'state', 'backlog.json'), JSON.stringify({ phases: [{ id: 'P0', name: 'Adopt', goal: '', exit: ['x'], milestones: [], status: 'active', planned: true, signoff: true, archSignoff: true, playtest: [] }], tasks: [] }));
    fs.writeFileSync(path.join(root, 'harness', 'state', 'state.json'), '{}');
    fs.writeFileSync(path.join(root, 'harness', 'state', 'decisions.md'), '# Decisions\n');
    fs.writeFileSync(path.join(root, 'harness', 'state', 'journal.md'), '');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('designsignoff writes state.json, a decisions.md entry with the quote and a journal line', () => {
    const r = run('designsignoff', 'Yes, go with the Delhi cab driver game');
    expect(r.status).toBe(0);
    expect(json('state/state.json').designSignoff).toMatchObject({ quote: 'Yes, go with the Delhi cab driver game' });
    expect(json('state/state.json').designSignoff.at).toMatch(/^\d{4}-/);
    const dec = fs.readFileSync(path.join(root, 'harness', 'state', 'decisions.md'), 'utf8');
    expect(dec).toContain('game design signed off by Anmol');
    expect(dec).toContain('Quote: "Yes, go with the Delhi cab driver game"');
    expect(fs.readFileSync(path.join(root, 'harness', 'state', 'journal.md'), 'utf8')).toContain('game design sign-off recorded: Yes, go with');
  });
  it('designsignoff without words exits 2 and records nothing', () => {
    expect(run('designsignoff').status).toBe(2);
    expect(json('state/state.json').designSignoff).toBeUndefined();
  });
  it('phase-flag turns the design sign-off on for P0 and adds its exit line once', () => {
    expect(run('phase-flag', 'P0', 'designSignoff').status).toBe(0);
    expect(run('phase-flag', 'P0', 'designSignoff').status).toBe(0);
    const p = json('state/backlog.json').phases[0];
    expect(p.designSignoff).toBe(true);
    expect(p.exit.filter((e) => e === DESIGN_EXIT)).toHaveLength(1);
    expect(run('phase-flag', 'P0', 'nonsense').status).toBe(2);
    expect(run('phase-flag', 'P9', 'designSignoff').status).toBe(2);
  });
  it('gate P0 lists the missing design sign-off until it is recorded', () => {
    run('phase-flag', 'P0', 'designSignoff');
    run('signoff', 'toon B');
    run('archsignoff', 'arch ok');
    let g = run('gate', 'P0');
    expect(g.status).toBe(1);
    expect(g.stdout).toContain('No game design sign-off');
    expect(g.stdout).not.toContain('style sign-off');
    run('designsignoff', 'design ok');
    g = run('gate', 'P0');
    expect(g.stdout).not.toContain('No game design sign-off');
  });
  it('gate --final fails without the design sign-off', () => {
    run('phase-flag', 'P0', 'designSignoff');
    const g = run('gate', '--final');
    expect(g.status).toBe(1);
    expect(g.stdout).toContain('No game design sign-off recorded');
  });
  it('status prints the game design sign-off line until recorded', () => {
    expect(run('status').stdout).toContain('game design sign-off: not yet');
    run('designsignoff', 'design ok');
    expect(run('status').stdout).not.toContain('game design sign-off: not yet');
  });
});
