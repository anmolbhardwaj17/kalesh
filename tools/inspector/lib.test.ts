import { describe, expect, it } from 'vitest';
import { encodeT1 } from '../bake/tile/codec.ts';
import type { TileContent } from '../bake/tile/codec.ts';
import { HIGH_IMPACT, buildPatch, filterIssues, inboxText, isHigh, isNodeId, mergePatch, nextPatchId, overrideFileName, sortIssues, worldTile } from './lib.ts';
import type { IssueRecord, Proposal } from './lib.ts';
import { readKtl1 } from './ktl1.ts';

const prop = (action: Proposal['action'], confidence = 0.5): Proposal => ({ action, params: { to: 'way/2' }, confidence, reasoning: `because ${action}`, preview: [{ x: 1, z: 2 }, { x: 3, z: 4 }] });
const issue = (id: string, impact: number, status: IssueRecord['status'] = 'open', x = 10, z = -20): IssueRecord => ({
  id, rule: 'R-ROAD-01', block: 'centre', district: 'cp', tile: worldTile(x, z), lat: 28.63, lon: 77.22, x, z, features: ['way/1', 'w7.0', 'n9'],
  impact, confidence: 0.7, status, proposals: [prop('connect', 0.5), prop('terminate', 0.6)],
});

describe('queue order', () => {
  it('puts high impact first, open before repaired, then by impact', () => {
    const list = [issue('a', 0.3), issue('b', 0.9, 'auto_repaired'), issue('c', 0.7), issue('d', 0.95), issue('e', 0.5), issue('f', 0.8, 'auto_repaired')];
    expect(sortIssues(list).map((i) => i.id)).toEqual(['d', 'c', 'e', 'a', 'b', 'f']);
  });
  it('is stable on ties (by id)', () => {
    expect(sortIssues([issue('z', 0.4), issue('m', 0.4)]).map((i) => i.id)).toEqual(['m', 'z']);
  });
  it('only an open issue is high impact: repaired, explained and overridden ones are not', () => {
    expect(isHigh(issue('x', HIGH_IMPACT))).toBe(true);
    for (const s of ['auto_repaired', 'explained', 'overridden'] as const) expect(isHigh(issue('x', 0.99, s))).toBe(false);
  });
  it('an issue a bake settled with a patch counts as picked, an explained one as left alone', () => {
    const list = [issue('a', 0.3), issue('b', 0.4, 'overridden'), issue('c', 0.5, 'explained')];
    expect(filterIssues(list, 'picked', new Set()).map((i) => i.id)).toEqual(['b']);
    expect(filterIssues(list, 'auto', new Set()).map((i) => i.id)).toEqual(['c']);
    expect(filterIssues(list, 'needs', new Set()).map((i) => i.id)).toEqual(['a']);
  });
  it('knows which ids are graph nodes', () => {
    expect(['n123', 'm4.0', 'xn1_n2'].every(isNodeId)).toBe(true);
    expect(['w123.0', 'way/9', 'overture/ab', 'node/5'].some(isNodeId)).toBe(false);
  });
  it('filters', () => {
    const list = [issue('a', 0.3), issue('b', 0.9, 'auto_repaired'), issue('c', 0.7)];
    const picked = new Set(['c']);
    expect(filterIssues(list, 'needs', picked).map((i) => i.id)).toEqual(['a']);
    expect(filterIssues(list, 'auto', picked).map((i) => i.id)).toEqual(['b']);
    expect(filterIssues(list, 'picked', picked).map((i) => i.id)).toEqual(['c']);
    expect(filterIssues(list, 'all', picked)).toHaveLength(3);
  });
});

describe('world tiles and overrides', () => {
  it('uses the 250 m grid with north as -Z and no mirroring', () => {
    expect(worldTile(0, 0)).toEqual([0, 0]);
    expect(worldTile(249.9, -0.1)).toEqual([0, -1]);
    expect(worldTile(-0.1, 250)).toEqual([-1, 1]);
    expect(worldTile(1127.7, -4727.3)).toEqual([4, -19]);
    expect(overrideFileName([4, -19])).toBe('4_-19.json');
  });
  it('builds a patch in the Overrides format', () => {
    const p = buildPatch(issue('R-ROAD-01:way/1:w7.0:n9', 0.8), prop('connect'), { note: ' joins here ', date: '2026-11-12', id: 'ov_0_-1_0001' });
    expect(p).toMatchObject({ id: 'ov_0_-1_0001', issue: 'R-ROAD-01:way/1:w7.0:n9', action: 'connect', why: 'joins here', by: 'owner', source: 'inspector', date: '2026-11-12' });
    expect(p.target).toEqual({ ids: ['way/1', 'w7.0'], anchor: { lat: 28.63, lon: 77.22 }, tolerance_m: 15 });
  });
  it('uses the reasoning when there is no note', () => {
    expect(buildPatch(issue('i', 0.8), prop('remove'), { date: 'd', id: 'x' }).why).toBe('because remove');
  });
  it('keeps one patch per issue and numbers new ones', () => {
    const base = { action: 'connect' as const, target: { ids: [], anchor: { lat: 0, lon: 0 }, tolerance_m: 15 }, params: {}, why: '', by: 'owner', source: 'inspector', date: 'd' };
    const a = mergePatch([], [0, -1], { ...base, issue: 'one' });
    expect(a.patch.id).toBe('ov_0_-1_0001');
    const b = mergePatch(a.patches, [0, -1], { ...base, issue: 'two' });
    expect(b.patch.id).toBe('ov_0_-1_0002');
    const c = mergePatch(b.patches, [0, -1], { ...base, issue: 'one', action: 'terminate' });
    expect(c.replaced).toBe(true);
    expect(c.patches).toHaveLength(2);
    expect(c.patches[0]).toMatchObject({ id: 'ov_0_-1_0001', action: 'terminate' });
    expect(nextPatchId([{ id: 'ov_cp_0012' }], [0, 0])).toBe('ov_0_0_0001');
  });
  it('writes the inbox line in plain English without em dashes', () => {
    const i = issue('R-ROAD-01:way/1', 0.8);
    const t = inboxText(i, prop('connect'), 'checked a photo', 'ov_0_-1_0001', 'overrides/0_-1.json');
    expect(t).toContain('Join the roads');
    expect(t).toContain('ov_0_-1_0001');
    expect(t).not.toContain('—');
    expect(inboxText(i, null, 'just a note', null, null)).toContain('just a note');
  });
});

describe('KTL1 reader', () => {
  it('reads what the bake writes', () => {
    const t: TileContent = {
      district: 'x', tx: 2, tz: -3, size: 250, origin: [500, 12, -750],
      meshes: [{ name: 'road', material: 'road', pos: [0, 0, 0, 1, 0, 0, 0, 0, 1], nrm: [0, 1, 0, 0, 1, 0, 0, 1, 0], idx: [0, 2, 1] }],
      colliders: [], placements: [],
    };
    const bytes = encodeT1(t);
    const copy = new Uint8Array(bytes).buffer;
    const r = readKtl1(copy);
    expect(r.header.tile).toMatchObject({ x: 2, z: -3, size: 250 });
    expect(r.header.origin).toEqual([500, 12, -750]);
    expect(r.meshes).toHaveLength(1);
    expect([...(r.meshes[0] as { pos: Float32Array }).pos]).toEqual([0, 0, 0, 1, 0, 0, 0, 0, 1]);
    expect([...(r.meshes[0] as { idx: Uint32Array }).idx]).toEqual([0, 2, 1]);
  });
  it('rejects a wrong file and a wrong version', () => {
    expect(() => readKtl1(new ArrayBuffer(16))).toThrow('not a KTL1 tile');
    const bytes = new Uint8Array([0x4b, 0x54, 0x4c, 0x31, 9, 0, 0, 0, 0, 0, 0, 0]);
    expect(() => readKtl1(bytes.buffer)).toThrow('version 9');
  });
});

describe('page helpers (P1-039)', () => {
  it('searches title, note, district and id with every word', async () => {
    const { searchIssues } = await import('./lib.ts');
    const list = [{ ...issue('a', 0.3), note: 'gap 10 m', district: 'ito' }, { ...issue('b', 0.4), note: 'kerb', district: 'cp' }];
    expect(searchIssues(list, '').map((i) => i.id)).toEqual(['a', 'b']);
    expect(searchIssues(list, 'GAP ito').map((i) => i.id)).toEqual(['a']);
    expect(searchIssues(list, 'dangling', () => 'Dangling end').map((i) => i.id)).toEqual(['a', 'b']);
    expect(searchIssues(list, 'gap cp')).toEqual([]);
  });
  it('picks a round scale bar length', async () => {
    const { niceScale } = await import('./lib.ts');
    expect(niceScale(1)).toMatchObject({ metres: 100, label: '100 m' });
    expect(niceScale(0.5)).toMatchObject({ metres: 50, px: 100 });
    expect(niceScale(20)).toMatchObject({ metres: 2000, label: '2 km' });
    expect(niceScale(0).label).toBe('');
  });
  it('paints a centre line between opposite drive lanes and a lane line between same direction ones', async () => {
    const { laneBorder } = await import('./lib.ts');
    expect(laneBorder(['drive', -1], ['drive', 1])).toBe('centre');
    expect(laneBorder(['drive', 1], ['drive', 1])).toBe('lane');
    expect(laneBorder(['drive', 0], ['drive', 0])).toBe('lane');
    expect(laneBorder(['kerb', 0], ['drive', 1])).toBeNull();
    expect(laneBorder(undefined, ['drive', 1])).toBeNull();
  });
});
