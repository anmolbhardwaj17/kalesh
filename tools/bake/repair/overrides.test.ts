// Overrides in the repair layer (OV1, P1-011): a patch is found by id, then by its anchor inside the tolerance; a patch
// whose target is gone is reported stale and its entry is left as it was; disable_repair switches off a repair by
// its issue id; a patch takes the place of the repair of its issue. Reading the files is in overrides_files.test.mjs.
import { describe, expect, it } from 'vitest';
import type { Issue, Patch } from '../rules/types';
import { patchOf } from '../rules/types';
import { Sketch, flat, testEnv } from '../testmap';
import { repairGraph } from './engine';
import type { RepairResult } from './engine';
import { overrideMatches, resolveOverrides } from './overrides';
import type { OverrideEntry } from './overrides';

/** A road along north 0 and a side road that stops `gap` metres short of it, on ways numbered from `base`. */
function nearMiss(gap: number, shift = 0): Sketch {
  const s = new Sketch();
  s.way([[0, 0], [100, 0]], { highway: 'residential' });
  s.way([[50, 60], [50, gap]], { highway: 'residential' });
  for (const e of s.elements) if (e.type === 'way') e.id += shift;
  return s;
}

const env = (s: Sketch) => testEnv({ nodeTags: s.nodeTags() });
const run = (s: Sketch, entries: readonly OverrideEntry[] = [], applied = false): RepairResult => repairGraph(s.graph(), env(s), { overrides: { entries, project: flat, applied } });
const dangling = (r: RepairResult): Issue => r.issues.find((i) => i.rule === 'R-ROAD-01') as Issue;
const entry = (patch: Patch, file = '0_0.json'): OverrideEntry => ({ file, patch });
const owner = (i: Issue, proposal: number, tolerance = 15): Patch => ({ ...patchOf(i, i.proposals[proposal]!, 'owner', tolerance), id: 'ov_0_0_0001', source: 'inspector', date: '2026-11-12' });

describe('overrides: finding the target', () => {
  it('a patch applies by id and takes the place of the repair of its issue', () => {
    const base = run(nearMiss(12));
    const issue = dangling(base);
    expect(issue.status).toBe('open');
    expect(issue.provisional).toBe(true);
    expect(base.graph.edges).toHaveLength(3); // the provisional join cut the road: this is the map without the owner's pick
    // the owner picks the second proposal: a real dead end
    const patch = owner(issue, 1);
    expect(patch.action).toBe('terminate');
    const r = run(nearMiss(12), [entry(patch)]);
    const got = dangling(r);
    expect(got.status).toBe('overridden');
    expect(got.provisional).toBeUndefined();
    expect(r.provisional.some((p) => p.issue === got.id)).toBe(false);
    expect(r.graph.edges).toHaveLength(2); // no join
    expect(r.overrides).toMatchObject([{ id: 'ov_0_0_0001', file: '0_0.json', resolution: 'by_id', outcome: 'fixed', issues: [got.id] }]);
    expect(r.overrideCounts).toMatchObject({ patches: 1, byId: 1, byAnchor: 0, stale: 0, applied: 1, issuesSettled: 1 });
    expect(r.summary).toMatchObject({ overridden: 1, queued: 0 });
    expect(r.repairs.filter((l) => l.override)).toHaveLength(1);
    expect(r.repairs.find((l) => l.override)).toMatchObject({ rule: 'R-ROAD-01', issue: got.id, patch: { by: 'owner' } });
  });

  it('with the id gone it applies by the anchor inside the tolerance', () => {
    const patch = owner(dangling(run(nearMiss(12))), 1);
    // a new extract: every way has a new id
    const s = nearMiss(12, 5000);
    const r = run(s, [entry(patch)]);
    expect(r.overrides[0]).toMatchObject({ resolution: 'by_anchor', outcome: 'fixed' });
    expect(r.overrides[0]!.targets).toEqual(expect.arrayContaining(['w5100.0', 'w5101.0']));
    expect(r.overrides[0]!.note).toMatch(/w100\.0 is gone; w5100\.0 lies/);
    expect(dangling(r).status).toBe('overridden');
    expect(r.graph.edges).toHaveLength(2);
  });

  it('and not outside it: a stale patch is reported, the entry is left as it was, the repair runs as usual', () => {
    const patch = owner(dangling(run(nearMiss(12))), 1);
    const far: Patch = { ...patch, target: { ...patch.target, anchor: { lat: patch.target.anchor.lat, lon: patch.target.anchor.lon + 40 } } };
    const entries = [entry(far)];
    const before = JSON.stringify(entries);
    const r = run(nearMiss(12, 5000), entries);
    expect(r.overrides[0]).toMatchObject({ resolution: 'stale', outcome: 'stale' });
    expect(r.overrides[0]!.note).toMatch(/not in this extract and no edge lies within 15 m of the anchor/);
    expect(r.overrideCounts).toMatchObject({ stale: 1, applied: 0, issuesSettled: 0 });
    expect(dangling(r).status).toBe('open');
    expect(r.graph.edges).toHaveLength(3); // the provisional join of the rule, as without any override
    expect(JSON.stringify(entries)).toBe(before);
    // the tolerance is the patch's own: a wider one finds it again
    const wide = entry({ ...far, target: { ...far.target, tolerance_m: 60 } });
    expect(run(nearMiss(12, 5000), [wide]).overrides[0]!.resolution).toBe('by_anchor');
  });

  it('a patch whose params name the old id gets the new one', () => {
    const s = nearMiss(12);
    const g = s.graph();
    const p: Patch = { id: 'p', issue: 'R-LANE-FIT-03:w100.0', action: 'set_lanes', target: { ids: ['w100.0'], anchor: { lat: 0, lon: 50 }, tolerance_m: 10 }, params: { on: 'w100.0', lanes: 3 }, why: '', by: 'owner', source: 'inspector', date: '' };
    const gone = nearMiss(12, 700).graph();
    const [res] = resolveOverrides(gone, [entry(p)], flat);
    expect(res!.resolution).toBe('by_anchor');
    expect(res!.patch.params['on']).toBe('w800.0');
    expect(res!.patch.target.ids).toEqual(['w800.0']);
    expect(resolveOverrides(g, [entry(p)], flat)[0]!.resolution).toBe('by_id');
  });

  it('a road named by its source id (way/<id>, as the bench samples do) is the edge cut from that way', () => {
    const g = nearMiss(12).graph();
    const p: Patch = { id: 'p', issue: 'R-ROAD-01:way/101:way/100', action: 'terminate', target: { ids: ['way/101'], anchor: { lat: 40, lon: 50 }, tolerance_m: 15 }, params: { node: 'way/101', with: 'gate' }, why: '', by: 'owner', source: 'hand', date: '' };
    const [res] = resolveOverrides(g, [entry(p)], flat);
    expect(res).toMatchObject({ resolution: 'by_id', targets: ['w101.0'] });
    expect(res!.patch.params['node']).toBe('w101.0');
    // gone: the kind comes from params.kinds, else the nearest road or footprint wins
    const [far] = resolveOverrides(nearMiss(12, 900).graph(), [entry({ ...p, params: { ...p.params, kinds: 'road' } })], flat);
    expect(far).toMatchObject({ resolution: 'by_anchor', targets: ['w1001.0'] });
  });

  it('an issue is matched by its id, or by the same rule with the patch targets among its features', () => {
    const [res] = resolveOverrides(nearMiss(12, 5000).graph(), [entry({ ...owner(dangling(run(nearMiss(12))), 1) })], flat);
    expect(res!.resolution).toBe('by_anchor');
    expect(overrideMatches(res!, { id: 'x', rule: 'R-ROAD-01', features: ['w5100.0', 'w5101.0', 'n3'] })).toBe(true);
    expect(overrideMatches(res!, { id: 'x', rule: 'R-ROAD-02', features: ['w5100.0', 'w5101.0'] })).toBe(false);
    expect(overrideMatches(res!, { id: 'x', rule: 'R-ROAD-01', features: ['w9.0'] })).toBe(false);
    expect(overrideMatches(res!, { id: res!.entry.patch.issue, rule: 'R-ROAD-01', features: [] })).toBe(true);
  });
});

describe('overrides: switching a repair off', () => {
  it('disable_repair keeps the map as drawn, and the fixed point still holds', () => {
    const plain = run(nearMiss(4));
    const issue = dangling(plain);
    expect(issue.status).toBe('auto_repaired');
    expect(plain.graph.edges).toHaveLength(3);
    const patch: Patch = { id: 'ov_0_0_0002', issue: issue.id, action: 'disable_repair', target: { ids: issue.features.filter((f) => !f.startsWith('n')), anchor: { lat: issue.lat, lon: issue.lon }, tolerance_m: 15 }, params: { keep: 'as_drawn' }, why: 'a real gap in the kerb', by: 'owner', source: 'inspector', date: '2026-11-12' };
    const r = run(nearMiss(4), [entry(patch)]);
    expect(r.repairs.filter((l) => l.rule === 'R-ROAD-01')).toHaveLength(0);
    expect(dangling(r).status).toBe('overridden');
    expect(r.graph.edges).toHaveLength(2);
    expect(r.overrides[0]).toMatchObject({ outcome: 'kept', issues: [issue.id] });
    expect(r.overrideCounts).toMatchObject({ switchedOff: 1, applied: 0 });
    expect(r.summary.unconverged).toBe(0);
    // the bake's second run on the result (the patches already in) applies nothing
    const again = repairGraph(r.graph, env(nearMiss(4)), { overrides: { entries: [entry(patch)], project: flat, applied: true } });
    expect(again.repairs).toHaveLength(0);
    expect(again.summary.unconverged).toBe(0);
  });

  it('a switch off with no issue to switch is idle, not stale', () => {
    const patch: Patch = { id: 'ov_0_0_0003', issue: 'R-ROAD-01:w100.0:w101.0:n3', action: 'disable_repair', target: { ids: ['w100.0'], anchor: { lat: 0, lon: 50 }, tolerance_m: 15 }, params: {}, why: '', by: 'owner', source: 'inspector', date: '' };
    const r = run(nearMiss(80), [entry(patch)]);
    expect(r.overrides[0]).toMatchObject({ resolution: 'by_id', outcome: 'idle' });
  });

  it('a hand written patch for a place no rule flags still applies (a decision mark here)', () => {
    const patch: Patch = { id: 'ov_0_0_0004', issue: 'R-ROAD-01:w100.0:w101.0:n3', action: 'terminate', target: { ids: ['w101.0'], anchor: { lat: 40, lon: 50 }, tolerance_m: 15 }, params: { node: 'w101.0', with: 'gate' }, why: 'a gate', by: 'builder', source: 'hand', date: '' };
    const r = run(nearMiss(80), [entry(patch)]);
    expect(r.overrides[0]).toMatchObject({ outcome: 'fixed', issues: [] });
    expect(r.graph.marks['w101.0']).toMatchObject({ closure: 'gate' });
  });
});
