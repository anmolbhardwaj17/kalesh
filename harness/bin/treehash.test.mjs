import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { treeHash } from './lib.mjs';

// P4-068: the verifier reuses the builder's quick run when the snapshot's tree hash matches. The hash covers only the
// game and the verify scripts, so state, docs and report commits, and junk a verifier leaves untracked in its snapshot
// (look proof shots, the node_modules symlink), never make it STALE; any game or verify change still does.

const FRESHREPORT = path.join(path.dirname(new URL(import.meta.url).pathname), 'freshreport.mjs');
let dir;
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...a], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const put = (root, f, text) => { fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.writeFileSync(path.join(root, f), text); };
const commit = (root, msg) => { git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', msg); };

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-treehash-'));
  git(dir, 'init', '-q');
  put(dir, '.gitignore', 'node_modules/\ndist/\nharness/reports/*\n!harness/reports/.gitkeep\n.worktrees/\n');
  for (const [f, t] of Object.entries({
    'src/main.ts': 'export const a = 1;\n', 'public/assets/manifest.json': '{}\n', 'index.html': '<html></html>\n',
    'package.json': '{"name":"x"}\n', 'vite.config.ts': 'export default {};\n', 'harness/verify/scenarios.json': '[]\n',
    'harness/bin/verify.mjs': '// v\n', 'harness/data/missions.json': '[]\n', 'harness/look_proof/poses.json': '{}\n',
    'harness/state/backlog.json': '{}\n', 'harness/state/knowledge.md': '- a\n', 'docs/ARCHITECTURE.md': '# A\n',
    'harness/reports/.gitkeep': '', 'CLAUDE.md': '# c\n', 'harness/requests/assets.json': '{}\n',
  })) put(dir, f, t);
  commit(dir, 'base');
});
afterEach(() => { try { execFileSync('git', ['worktree', 'prune'], { cwd: dir, stdio: 'ignore' }); } catch { /* none */ } fs.rmSync(dir, { recursive: true, force: true }); });

describe('treeHash (P4-068)', () => {
  it('stays the same after a commit that only changes harness/state, docs or harness/reports', () => {
    const before = treeHash(dir);
    expect(before).toMatch(/^[0-9a-f]{40}$/);
    put(dir, 'harness/state/backlog.json', '{"tasks":[1]}\n');
    put(dir, 'harness/state/journal.md', '- new\n');
    put(dir, 'docs/ARCHITECTURE.md', '# A\nmore\n');
    put(dir, 'docs/READ_MAP.md', '# map\n');
    put(dir, 'harness/reports/history/x-quick.json', '{}\n');
    put(dir, 'CLAUDE.md', '# c\nrule\n');
    commit(dir, 'state only');
    expect(treeHash(dir)).toBe(before);
  });

  it('ignores untracked junk a verifier leaves in its snapshot', () => {
    const before = treeHash(dir);
    put(dir, 'harness/look_proof/v2/inari_shrine_gate.png', 'png');
    put(dir, 'harness/look_proof/perf_ab_after.json', '{}');
    fs.symlinkSync(os.tmpdir(), path.join(dir, 'node_modules'), 'dir');
    expect(treeHash(dir)).toBe(before);
  });

  for (const f of ['src/main.ts', 'src/new/file.ts', 'public/assets/manifest.json', 'harness/verify/scenarios.json',
    'harness/verify/scripts/new.js', 'index.html', 'package.json', 'vite.config.ts', 'harness/bin/verify.mjs',
    'harness/data/missions.json', 'harness/look_proof/poses.json']) {
    it(`goes STALE when ${f} changes (committed or not)`, () => {
      const before = treeHash(dir);
      put(dir, f, 'changed\n');
      const dirty = treeHash(dir);
      expect(dirty).not.toBe(before);
      commit(dir, 'change');
      expect(treeHash(dir)).toBe(dirty);
    });
  }

  it('goes STALE when a game file is deleted', () => {
    const before = treeHash(dir);
    fs.rmSync(path.join(dir, 'src/main.ts'));
    expect(treeHash(dir)).not.toBe(before);
  });

  it('replays the P4-034 flow: builder quick run, verifying commit, snapshot with junk prints FRESH', () => {
    // The builder works uncommitted, registers a voice line, notes knowledge, and runs --quick (recorded in history).
    put(dir, 'src/missions/M30.ts', 'export const boss = true;\n');
    put(dir, 'harness/verify/scripts/m30_boss.js', '// boss\n');
    put(dir, 'harness/requests/assets.json', '{"requests":[]}\n');
    put(dir, 'harness/state/knowledge.md', '- a\n- b\n');
    const builderTree = treeHash(dir);
    put(dir, `harness/reports/history/2026-10-27T11-09-17-893Z-quick.json`, JSON.stringify({ mode: 'quick', ok: true, tree: builderTree, finishedAt: '2026-10-27T11:09:17Z' }));
    // The builder adds docs after the run; the orchestrator commits "(verifying)", then a state-only commit, then snapshots.
    put(dir, 'docs/ARCHITECTURE.md', '# A\nM30 boss\n');
    commit(dir, '[P4-034] M30 (verifying)');
    put(dir, 'harness/state/backlog.json', '{"verifying":"P4-034"}\n');
    commit(dir, 'P4-034 verifying, P4-055 start');
    const snap = path.join(dir, '.worktrees', 'verify');
    git(dir, 'worktree', 'add', '-q', '--detach', snap, 'HEAD');
    fs.symlinkSync(os.tmpdir(), path.join(snap, 'node_modules'), 'dir');
    put(snap, 'harness/look_proof/ver021/den_hub_clan_row.png', 'png');
    const run = () => spawnSync(process.execPath, [FRESHREPORT, '--tree', dir], { env: { ...process.env, HARNESS_ROOT: snap }, encoding: 'utf8' });
    const fresh = run();
    expect(fresh.stdout).toContain('FRESH');
    expect(fresh.status).toBe(0);
    // Any game change in the snapshot still makes it STALE.
    put(snap, 'src/missions/M30.ts', 'export const boss = false;\n');
    const stale = run();
    expect(stale.stdout).toContain('STALE');
    expect(stale.status).toBe(1);
  });
});
