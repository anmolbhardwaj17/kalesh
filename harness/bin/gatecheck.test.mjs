import { describe, expect, it } from 'vitest';
import { decideRetry, failedItems, fullRunReasons, matchesShared, sharedTouched, loadSharedPaths, FLAKE_RUNS } from './gatecheck.mjs';

// P4-101: the phase gate's retry path (accept a saved --all plus a targeted rerun of what it failed).
const SHARED = ['src/main.ts', 'src/physics/', 'src/ui/hud/', 'src/actors/player'];

const all = () => ({
  mode: 'all', ok: false, commit: 'aaaa1111', startedAt: '2026-10-29T06:00:00.000Z', finishedAt: '2026-10-29T08:00:00.000Z',
  failReason: 'scenario fight_feedback: stamina', boot: { ok: true }, consoleErrors: [],
  checks: { typecheck: { ran: true, ok: true }, test: { ran: true, ok: true }, build: { ran: true, ok: true } },
  scenarios: { title: { ok: true }, fight_feedback: { ok: false, errors: ['stamina cost 0.3'] } },
  milestones: { M01: { ok: true }, TEST: { ok: false, reason: 'absent speaker' } },
  milestonesExpected: ['M01', 'TEST'],
});

const retry = (over = {}) => ({
  mode: 'gateretry', phase: 'P4', commit: 'bbbb2222', tree: 'tree1', startedAt: '2026-10-29T09:00:00.000Z', finishedAt: '2026-10-29T09:30:00.000Z',
  allCommit: 'aaaa1111', allStartedAt: '2026-10-29T06:00:00.000Z',
  items: {
    'scenario:fight_feedback': { kind: 'run', ok: true },
    'milestone:TEST': { kind: 'run', ok: true },
  },
  quick: { ok: true, checks: { typecheck: { ok: true }, test: { ok: true }, build: { ok: true } } },
  milestones: { ids: ['M01', 'TEST'], ok: true, results: { M01: { ok: true }, TEST: { ok: true } } },
  consoleErrors: { quick: 0, only: 0, milestones: 0 },
  ...over,
});

const NARROW = ['src/milestones/defs/TEST.ts', 'src/data/dialogue/TEST.json', 'harness/state/backlog.json'];

describe('gate retry path (P4-101)', () => {
  it('accepts when every failed item passes, quick is ok, every milestone is ok and no shared file changed', () => {
    const d = decideRetry({ all: all(), retry: retry(), changed: NARROW, shared: SHARED, tree: 'tree1' });
    expect(d.reasons).toEqual([]);
    expect(d.ok).toBe(true);
    expect(d.retried.join(' ')).toContain('scenario:fight_feedback');
    expect(d.retried.join(' ')).toContain('milestone:TEST');
  });

  it('needs the full --all when the diff touches a shared path, and names the files', () => {
    const d = decideRetry({ all: all(), retry: retry(), changed: [...NARROW, 'src/ui/hud/hud.ts', 'src/main.ts'], shared: SHARED, tree: 'tree1' });
    expect(d.ok).toBe(false);
    expect(d.sharedFiles).toEqual(['src/main.ts', 'src/ui/hud/hud.ts']);
    expect(d.reasons.some((r) => r.startsWith('(c)') && r.includes('verify --all') && r.includes('src/ui/hud/hud.ts'))).toBe(true);
  });

  it('rejects when a failed item is missing from the retry', () => {
    const r = retry();
    delete r.items['scenario:fight_feedback'];
    const d = decideRetry({ all: all(), retry: r, changed: NARROW, shared: SHARED, tree: 'tree1' });
    expect(d.ok).toBe(false);
    expect(d.reasons.some((x) => x.includes('scenario:fight_feedback') && x.includes('missing'))).toBe(true);
  });

  it('rejects a failed item that still fails in its own run', () => {
    const d = decideRetry({ all: all(), retry: retry({ items: { 'scenario:fight_feedback': { kind: 'run', ok: true }, 'milestone:TEST': { kind: 'run', ok: false, reason: 'absent speaker' } } }), changed: NARROW, shared: SHARED, tree: 'tree1' });
    expect(d.ok).toBe(false);
    expect(d.reasons.some((x) => x.includes('milestone:TEST') && x.includes('--milestone'))).toBe(true);
  });

  it(`a flaky item needs ${FLAKE_RUNS} of ${FLAKE_RUNS} in a flakecheck`, () => {
    const mk = (runs, pass) => retry({ items: { 'scenario:fight_feedback': { kind: 'flake', runs, pass, ok: runs === pass }, 'milestone:TEST': { kind: 'run', ok: true } } });
    expect(decideRetry({ all: all(), retry: mk(5, 5), changed: NARROW, shared: SHARED }).reasons.join(' ')).toContain(`flakecheck of ${FLAKE_RUNS} runs`);
    expect(decideRetry({ all: all(), retry: mk(10, 9), changed: NARROW, shared: SHARED }).reasons.join(' ')).toContain('flakecheck 9/10');
    expect(decideRetry({ all: all(), retry: mk(10, 10), changed: NARROW, shared: SHARED }).ok).toBe(true);
  });

  it('rejects a failed quick, a failing milestone, console errors, a missing retry, another tree or another full run', () => {
    const base = { all: all(), changed: NARROW, shared: SHARED, tree: 'tree1' };
    expect(decideRetry({ ...base, retry: retry({ quick: { ok: false, failReason: 'boot', checks: {} } }) }).reasons.join(' ')).toContain('verify --quick failed');
    expect(decideRetry({ ...base, retry: retry({ milestones: { ids: ['M01', 'TEST'], results: { M01: { ok: false }, TEST: { ok: true } } } }) }).reasons.join(' ')).toContain('milestones failing in the retry: M01');
    expect(decideRetry({ ...base, retry: retry({ consoleErrors: { quick: 0, only: 2, milestones: 0 } }) }).reasons.join(' ')).toContain('2 console error(s)');
    expect(decideRetry({ ...base, retry: null, phase: 'P4' }).reasons.join(' ')).toContain('gateretry.mjs P4');
    expect(decideRetry({ ...base, tree: 'tree2', retry: retry() }).reasons.join(' ')).toContain('another tree');
    expect(decideRetry({ ...base, retry: retry({ allCommit: 'cccc3333' }) }).reasons.join(' ')).toContain('another full run');
    expect(decideRetry({ ...base, retry: retry({ finishedAt: '2026-10-29T07:00:00.000Z', startedAt: '2026-10-29T07:00:00.000Z' }) }).reasons.join(' ')).toContain('not newer');
  });

  it("applies the phase's milestone rule to the retry's milestones", () => {
    const milestoneReasonsFn = (res) => (res.M02 ? [] : ['P4: milestones not in report: M02']);
    const d = decideRetry({ all: all(), retry: retry(), changed: NARROW, shared: SHARED, tree: 'tree1', milestoneReasonsFn });
    expect(d.ok).toBe(false);
    expect(d.reasons).toContain('(b) P4: milestones not in report: M02');
  });

  it('a boot failure or an unnamed failure blocks the retry path', () => {
    const a = { ...all(), boot: { ok: false, reason: 'ready never became true' }, scenarios: {}, milestones: {}, milestonesExpected: [] };
    expect(failedItems(a).blockers[0]).toContain('boot failed');
    expect(decideRetry({ all: a, retry: retry(), changed: NARROW, shared: SHARED }).ok).toBe(false);
    const b = { ...all(), scenarios: {}, milestones: {}, milestonesExpected: [], failReason: 'browser crashed' };
    expect(failedItems(b).blockers[0]).toContain('no named item');
  });

  it('lists failed checks, light check fails and milestones that never ran as items', () => {
    const a = { ...all(), checks: { test: { ran: true, ok: false } }, visibility: { 'harness/reports/shots/m05_x.png': { verdict: 'FAIL', from: 'M05' }, 'shots/den.png': { verdict: 'FAIL', from: 'den_night_views' } }, milestonesExpected: ['M01', 'TEST', 'M30'] };
    const ids = failedItems(a).items.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(['check:test', 'scenario:fight_feedback', 'milestone:TEST', 'milestone:M05', 'scenario:den_night_views', 'milestone:M30']));
    const r = retry({ quick: { ok: true, checks: { test: { ok: false } } } });
    expect(decideRetry({ all: a, retry: r, changed: NARROW, shared: SHARED }).reasons.join(' ')).toContain('check:test');
  });

  it('a passing fresh full run needs no retry; an old or failed one gives reasons', () => {
    const ok = { ...all(), ok: true, failReason: null };
    expect(fullRunReasons(ok, { srcCommitMs: Date.parse('2026-10-29T05:00:00.000Z') })).toEqual([]);
    expect(fullRunReasons(ok, { srcCommitMs: Date.parse('2026-10-29T09:00:00.000Z') }).join(' ')).toContain('older than the last commit');
    expect(fullRunReasons(all()).join(' ')).toContain('not ok');
    expect(fullRunReasons(null)[0]).toContain('verify.mjs --all');
  });

  it('matches folders and files, not name prefixes', () => {
    expect(matchesShared('src/physics/world.ts', SHARED)).toBe(true);
    expect(matchesShared('src/actors/player/cameraRig.ts', SHARED)).toBe(true);
    expect(matchesShared('src/actors/playerX.ts', SHARED)).toBe(false);
    expect(matchesShared('src/main.ts', SHARED)).toBe(true);
    expect(matchesShared('src/main.tsx', SHARED)).toBe(false);
    expect(sharedTouched(['src/ui/hud/hud.ts', 'src/ui/hud/hud.ts', 'src/ui/menu/x.ts'], SHARED)).toEqual(['src/ui/hud/hud.ts']);
  });

  it('the shared_paths.json lists the entry, the debug hooks and the verify harness', () => {
    const real = loadSharedPaths();
    for (const f of ['game/project.godot', 'game/debug/debug_server.gd', 'game/core/sim_clock.gd', 'harness/bin/verify.mjs', 'harness/bin/godotdriver.mjs', 'harness/bin/godotshim.mjs', 'package.json']) expect(matchesShared(f, real), f).toBe(true);
    expect(matchesShared('src/data/dialogue/L01.json', real)).toBe(false);
    expect(matchesShared('game/tests/test_car.gd', real)).toBe(false);
  });
});
