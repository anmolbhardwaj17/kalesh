import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { areasFor, changedScenarioNames, describePick, isMappable, pickQuick, useCommitFiles } from './quickset.mjs';

// P2-167: verify --quick picks the core set plus at most maxExtras scenarios mapped to the changed files.
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const quick = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness/verify/quick.json'), 'utf8'));
const all = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness/verify/scenarios.json'), 'utf8')).scenarios;
const list = all.filter((s) => !s.allOnly);
const pick = (changed, extra = {}) => pickQuick({ quick, all, list, changed, ...extra });

describe('quickset rules (synthetic config)', () => {
  const sc = (...names) => names.map((name) => ({ name, steps: [] }));
  const q = {
    core: ['a'],
    maxExtras: 3,
    areas: [
      { path: 'src/ui/', scenarios: ['ui_*'] },
      { path: 'src/ui/hud/', scenarios: ['hud_one', 'hud_two'] },
      { path: 'src/x', scenarios: ['x1', 'x2', 'x3', 'x4', 'a'] },
    ],
  };
  const L = sc('a', 'ui_one', 'ui_two', 'hud_one', 'hud_two', 'x1', 'x2', 'x3', 'x4', 's1', 's2');
  L[9].steps = [{ script: 'harness/verify/scripts/foo.js' }];
  L[10].steps = [{ script: 'harness/verify/scripts/other_foo.js' }];

  it('a file uses only its most specific area', () => {
    expect(areasFor('src/ui/hud/eyes.ts', q.areas).map((a) => a.path)).toEqual(['src/ui/hud/']);
    const r = pickQuick({ quick: q, all: L, list: L, changed: ['src/ui/hud/eyes.ts'] });
    expect(r.extras.map((e) => e.name)).toEqual(['hud_one', 'hud_two']);
  });
  it('core names are never extras and the cap holds, skipped ones are reported', () => {
    const r = pickQuick({ quick: q, all: L, list: L, changed: ['src/x.ts'] });
    expect(r.core).toEqual(['a']);
    expect(r.extras.map((e) => e.name)).toEqual(['x1', 'x2', 'x3']);
    expect(r.capped).toEqual(['x4']);
    expect(r.picked.map((s) => s.name)).toEqual(['a', 'x1', 'x2', 'x3']);
  });
  it('a changed script ranks first and matches only its own name', () => {
    const r = pickQuick({ quick: q, all: L, list: L, changed: ['src/x.ts', 'harness/verify/scripts/foo.js'] });
    expect(r.extras[0].name).toBe('s1');
    expect(r.extras.map((e) => e.name)).not.toContain('s2');
  });
  it('more specific paths outrank broad ones; test files and harness state map to nothing', () => {
    const r = pickQuick({ quick: q, all: L, list: L, changed: ['src/ui/menu.ts', 'src/ui/hud/a.ts', 'src/x.test.ts', 'harness/state/backlog.json'] });
    expect(r.extras.map((e) => e.name)).toEqual(['hud_one', 'hud_two', 'ui_one']);
    expect(r.mappedFiles).toBe(2);
    expect(isMappable('src/a.test.ts')).toBe(false);
  });
  it('a changed scenarios.json entry adds that scenario', () => {
    const head = sc('a', 'x1');
    const now = [{ name: 'a', steps: [] }, { name: 'x1', steps: [{ wait: 1 }] }, { name: 'new1', steps: [] }];
    expect(changedScenarioNames(head, now)).toEqual(['x1', 'new1']);
  });
  it('estimates the pool time and describes the pick', () => {
    const r = pickQuick({ quick: q, all: L, list: L, changed: ['src/ui/hud/a.ts'], timings: { a: 40000, hud_one: 8000, hud_two: 8000 }, jobs: 4 });
    expect(r.estSec).toBe(40);
    const lines = describePick(r, { of: L.length, changedCount: 1 });
    expect(lines[0]).toMatch(/quick set: 3 of 11 scenarios: core 1, plus 2 mapped/);
    expect(lines.some((l) => l.includes('+ src/ui/hud/a.ts (area src/ui/hud/): hud_one hud_two'))).toBe(true);
  });
});

describe('harness/verify/quick.json', () => {
  const names = new Set(all.map((s) => s.name));
  it('every core name is a real scenario and none is allOnly', () => {
    for (const c of quick.core) {
      const s = all.find((x) => x.name === c);
      expect(s, c).toBeTruthy();
      expect(s.allOnly, c).toBeFalsy();
    }
  });
  it('every area names real scenarios', () => {
    for (const a of quick.areas) for (const p of a.scenarios) {
      if (p.endsWith('*')) expect(all.some((s) => s.name.startsWith(p.slice(0, -1))), `${a.path}: ${p}`).toBe(true);
      else expect(names.has(p), `${a.path}: ${p}`).toBe(true);
    }
  });
  it('no catch all: the broad fallbacks name at most 10 scenarios', () => {
    for (const a of quick.areas.filter((x) => x.path.split('/').filter(Boolean).length <= 1)) expect(a.scenarios.length, a.path).toBeLessThanOrEqual(10);
  });
  it('a big change stays under the cap', () => {
    const r = pick(quick.areas.map((a) => `${a.path}x.ts`));
    expect(r.extras.length).toBeLessThanOrEqual(quick.maxExtras ?? 12);
  });
});

describe('P5-042: a clean tree maps its last commit', () => {
  it('uses the commit only when nothing mappable changed (a verifier snapshot, or only harness state edits)', () => {
    expect(useCommitFiles([])).toBe(true);
    expect(useCommitFiles(['harness/state/journal.md', 'harness/reports/latest.json', 'src/ui/hud/hud.test.ts'])).toBe(true);
    expect(useCommitFiles(['harness/state/journal.md', 'src/missions/defs/M02.ts'])).toBe(false);
    // P5-042 attempt 2: a snapshot with stale untracked look proof outputs still maps the last commit.
    const stale = Array.from({ length: 59 }, (_, i) => `harness/look_proof/after${i}/shot_${i}.png`);
    expect(stale.some(isMappable)).toBe(false);
    expect(useCommitFiles([...stale, 'harness/look_proof/atmoscheck.json'])).toBe(true);
  });
});
