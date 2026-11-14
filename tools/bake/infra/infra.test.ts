// The infrastructure kits on the bake side (P2-034): variants, rail heights and masts, the metro deck pairing and
// its piers, the pier shapes, and the per-tile file.
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { pierColumns } from '../mesh/structures.ts';
import type { Strip } from '../roads/model.ts';
import { buildInfra, clipSlab, densify } from './build.ts';
import { footDecks, metroDecks } from './elevated.ts';
import { F_BALLAST, F_BRIDGE, F_CROSSING, MAST_CLEAR_M, RAIL_APPROACH_GRADE, RAIL_OVER_SLEEPER_BASE_M, buildTracks } from './rails.ts';
import { VARIANTS, footBridgeVariant, railVariant, readRules, stripVariants } from './variants.ts';
import { readInfraRules } from '../sources/meshstage.ts';
import type { VariantRules } from './variants.ts';
import { buildTunnels, tunnelInvariant, tunnelVariants } from './tunnels.ts';
import { TUNNEL_MAX_GRADE, tunnelGradeCaps } from '../elevation/limits.ts';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const rules = (): VariantRules => readInfraRules(ROOT);

const strip = (id: string, ways: string[], cls = 'secondary', n = 3): Strip => ({
  id, edge: id, kind: 'road', cls, link: false, name: id, ways, lanes: [{ type: 'drive', dir: 1, width: 3.5, raise: 0 }], hero: null,
  st: Array.from({ length: n }, (_, i) => ({ x: i * 10, z: 0, nx: 0, nz: 1, h: 0, g: 0, b: [1.75, -1.75] }) as unknown as Strip['st'][number]),
});

describe('infrastructure variants', () => {
  it('the rules file names only variants that have a kit, and an unknown one is refused', () => {
    const r = rules();
    expect(Object.keys(r.road).length).toBeGreaterThan(20);
    expect(() => readRules({ ...r, metro: { viaduct: 'MET-XX', ramp: 'MET-RAMP' } })).toThrow(/no kit/);
    for (const v of Object.values(r.road)) expect(VARIANTS[v]).toBeDefined();
  });

  it('a listed way takes its variant, a strip joined to a raised one inherits it, the rest take the defaults', () => {
    const r = rules();
    const strips = [strip('ito', ['way/1510242193'], 'trunk'), strip('approach', ['way/999'], 'trunk'), strip('ramp', ['way/998'], 'primary'), strip('grade', ['way/997'])];
    const kinds = [Uint8Array.from([2, 2, 2]), Uint8Array.from([0, 1, 2]), Uint8Array.from([0, 1, 1]), Uint8Array.from([0, 0, 0])];
    const joints = [{ a: { strip: 0, end: 'start' as const }, b: { strip: 1, end: 'end' as const }, lanes: [], kind: 'section' as const }];
    const v = stripVariants(strips, joints, kinds, r);
    expect(v[0]).toBe('FLY-T1');
    expect(v[1]).toBe('FLY-T1');
    expect(v[2]).toBe(r.roadDefaults.fill);
    expect(v[3]).toBeNull();
  });

  it('rail and foot bridge variants: listed ids, then tags and names', () => {
    const r = rules();
    expect(railVariant({ id: 'way/77603110', name: 'Old Iron Bridge (Loha Pul)', bridge: true, tunnel: false }, r)).toBe('RBR-Y1');
    expect(railVariant({ id: 'way/1#2', name: '', bridge: true, tunnel: false }, r)).toBe('RBR-U1');
    expect(railVariant({ id: 'way/2', name: 'Delhi Ring Railway', bridge: false, tunnel: false }, r)).toBe('RAIL-RING');
    expect(railVariant({ id: 'way/3', name: '', bridge: false, tunnel: false }, r)).toBe('RAIL-BG');
    expect(footBridgeVariant({ id: 'way/854903774', ways: [] }, r)).toBe('FOB-B3');
    expect(footBridgeVariant({ id: 'way/5', ways: [] }, r)).toBe(r.footBridgeDefault);
  });
});

describe('rail track', () => {
  const flat = (): number => 100;
  it('an approach climbs to its bridge at the approach grade, a road is a level crossing, masts keep off other tracks', () => {
    const bridge = { id: 'b', name: '', kind: 'rail', pts: [{ x: 0, z: 0 }, { x: 20, z: 0 }], bridge: true, tunnel: false, variant: 'RBR-U1' };
    const west = { id: 'w', name: '', kind: 'rail', pts: [{ x: -600, z: 0 }, { x: 0, z: 0 }], bridge: false, tunnel: false, variant: 'RAIL-BG' };
    const side = { id: 's', name: '', kind: 'rail', pts: [{ x: -600, z: 4.3 }, { x: -100, z: 4.3 }], bridge: false, tunnel: false, variant: 'RAIL-BG' };
    const res = buildTracks({
      lines: [bridge, west, side], railEmbankment: 4.5, groundModel: flat,
      ground: (x, z) => (x > -330 && x < -320 && z > 2 ? NaN : 100), roadAt: (x, z) => (x > -330 && x < -320 && z > 2 ? 100.1 : NaN), blocked: () => false,
    });
    const b = res.tracks.find((t) => t.id === 'b')!;
    expect(b.pts.every((p) => p.f === F_BRIDGE && Math.abs(p.y - (104.5 - RAIL_OVER_SLEEPER_BASE_M)) < 1e-9)).toBe(true);
    const w = res.tracks.find((t) => t.id === 'w')!;
    const end = w.pts[w.pts.length - 1]!;
    expect(end.y).toBeCloseTo(104.5 - RAIL_OVER_SLEEPER_BASE_M, 6);
    const at100 = w.pts.find((p) => Math.abs(p.x + 100) < 0.01)!;
    expect(at100.y).toBeCloseTo(104.5 - RAIL_OVER_SLEEPER_BASE_M - 100 * RAIL_APPROACH_GRADE, 6);
    expect(w.pts[0]!.f).toBe(F_BALLAST);
    expect(w.pts[0]!.y).toBeCloseTo(100.3, 6);
    const s = res.tracks.find((t) => t.id === 's')!;
    expect(s.pts.some((p) => p.f === F_CROSSING)).toBe(true);
    expect(res.stats.crossings).toBeGreaterThan(0);
    for (const m of res.masts) {
      for (const t of res.tracks) for (const p of t.pts) expect(Math.hypot(p.x - m.x, p.z - m.z)).toBeGreaterThan(MAST_CLEAR_M - 1e-6);
    }
    expect(res.masts.length).toBeGreaterThan(5);
  });
});

describe('metro and foot bridges', () => {
  it('two parallel viaducts are one twin deck; its piers keep off a blocked road', () => {
    const prof = (z: number): [number, number, number, number][] => Array.from({ length: 30 }, (_, i) => [i * 10, z, 112, 100]);
    const v = (id: string, z: number) => ({ id, name: 'Blue Line', ways: [id], lenM: 290, minAboveM: 12, maxAboveM: 12, ends: [], crossings: [], minClearanceM: null, shortM: 0, profile: prof(z) });
    const blocked = (x: number): boolean => x > 40 && x < 50;
    const res = metroDecks([v('a', 0), v('b', 4)], 'MET-VB1', blocked);
    expect(res.decks).toHaveLength(1);
    expect(res.decks[0]!.twin).toBe(true);
    expect(res.decks[0]!.pts[5]![1]).toBeCloseTo(2, 6);
    expect(res.piers.length).toBeGreaterThan(5);
    for (const p of res.piers) expect(p.x > 40 && p.x < 50).toBe(false);
    expect(res.piers.every((p) => p.y1 < 112 - 2.5 + 1e-6)).toBe(true);
  });

  it('a foot bridge off the road graph gets columns off the road and its stairs run on from its ends', () => {
    const res = footDecks(
      [{ id: 'way/1', ways: ['way/1'], pts: [[{ x: 0, z: 0 }, { x: 40, z: 0 }]] }],
      [{ id: 'way/1', ways: ['way/1'], lenM: 40, solved: false, deckH: 106.5, maxAboveM: 6.5, crossings: [], minClearanceM: 5.5, shortM: 0, stairs: [{ x: 0, z: 0, riseM: 6.5 }, { x: 40, z: 0, riseM: 6.5 }] }],
      () => 'FOB-B4', (x) => x > 10 && x < 30, () => 100,
    );
    expect(res.decks).toHaveLength(1);
    expect(res.decks[0]!.stairs.map((s) => Math.sign(s.dx))).toEqual([-1, 1]);
    expect(res.columns.length).toBeGreaterThanOrEqual(2);
    for (const c of res.columns) expect(c.x > 10 && c.x < 30).toBe(false);
  });
});

describe('pier shapes', () => {
  it('every shape lies inside the ring the pier checks measure (half across, 0.5 m along)', () => {
    for (const shape of ['twin', 'single', 'wall', 'round'] as const) {
      for (const [x, z] of pierColumns(shape, 10, 20, 0.6, 0.8, 3).flat()) {
        const across = (x - 10) * 0.6 + (z - 20) * 0.8;
        const along = (x - 10) * -0.8 + (z - 20) * 0.6;
        expect(Math.abs(across)).toBeLessThanOrEqual(3 + 1e-9);
        expect(Math.abs(along)).toBeLessThanOrEqual(0.5 + 1e-9);
      }
    }
    expect(pierColumns('twin', 0, 0, 1, 0, 3)).toHaveLength(2);
    expect(pierColumns('twin', 0, 0, 1, 0, 1)).toHaveLength(1);
  });
});

describe('platform envelope pieces', () => {
  it('a long ring is cut into slabs across its axis and densified, so no piece reaches far', () => {
    const ring = [{ x: 0, z: 0 }, { x: 600, z: 0 }, { x: 600, z: 8 }, { x: 0, z: 8 }];
    const piece = clipSlab(ring, (q) => q.x, 30, 60);
    expect(Math.min(...piece.map((q) => q.x))).toBeCloseTo(30, 6);
    expect(Math.max(...piece.map((q) => q.x))).toBeCloseTo(60, 6);
    const fine = densify(ring, 20);
    for (let k = 0; k < fine.length; k++) {
      const a = fine[k]!;
      const b = fine[(k + 1) % fine.length]!;
      expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeLessThanOrEqual(20 + 1e-9);
    }
  });
});

describe('the infra file', () => {
  it('cuts a track into tile pieces that share their end points, in world metres, with its collider bed', () => {
    const res = buildInfra({
      strips: [], variants: [], kit: { edges: [], soffits: [], beams: [], faces: [], walls: [], ceilings: [] }, piers: [],
      rails: [{ id: 'way/7', kind: 'rail', name: '', pts: [{ x: 200, z: 10 }, { x: 320, z: 10 }], bridge: false, tunnel: false, layer: 0 }],
      viaducts: [], footBridges: [], footHeights: [], ground: () => 50, groundModel: () => 50, roadAt: () => NaN, blocked: () => false,
      railEmbankment: 4.5, rules: rules(), offset: { x: 10, z: 0 }, stage: 't', block: 'b',
    });
    const file = res.file as { tiles: Record<string, { tracks?: { p: number[] }[] }> };
    expect(Object.keys(file.tiles).sort()).toEqual(['0_0', '1_0']);
    const a = file.tiles['0_0']!.tracks![0]!.p;
    const b = file.tiles['1_0']!.tracks![0]!.p;
    expect(a.slice(-5)).toEqual(b.slice(0, 5));
    expect(a[0]).toBe(210);
    expect(res.meshes.find((m) => m.material === 'railbed')).toBeDefined();
    expect(res.record.withoutKit).toEqual([]);
    expect(res.record.variants['RAIL-BG']).toBe(1);
  });
});

describe('tunnels (P2-032)', () => {
  const lowered = (id: string, cls: string, name: string, n = 6): Strip => ({ ...strip(id, [`way/${id}`], cls, n), name });

  it('variants: the Pragati Maidan main tunnel, its underpasses, service tunnels, subways, the rest UND-U1', () => {
    const strips = [lowered('main', 'secondary', 'Pragati Maidan Tunnel'), lowered('link', 'primary', 'Pragati Maidan Tunnel'), lowered('approach', 'secondary', ''), lowered('basement', 'service', ''), lowered('subway', 'pedestrian', ''), lowered('ring', 'tertiary', ''), lowered('grade', 'secondary', '')];
    const k = (v: number): Uint8Array => Uint8Array.from([0, v, v, v, v, 0]);
    const kinds = [k(4), k(4), k(3), k(4), k(4), k(3), k(0)];
    const joints = [{ a: { strip: 0, end: 'start' as const }, b: { strip: 2, end: 'end' as const }, lanes: [], kind: 'section' as const }];
    expect(tunnelVariants(strips, joints, kinds)).toEqual(['TUN-T1', 'TUN-T2', 'TUN-T1', 'TUN-T3', 'SUB-S4', 'UND-U1', null]);
    for (const v of ['TUN-T1', 'TUN-T2', 'TUN-T3', 'UND-U1', 'SUB-S4']) expect(VARIANTS[v]).toBeDefined();
  });

  it('a roofed stretch is checked for headroom over the road and cover over the ceiling; runs, mouths and drains', () => {
    const s = lowered('t', 'secondary', 'Pragati Maidan Tunnel', 8);
    s.st.forEach((st, i) => { st.h = 100 - (i === 3 ? 0.2 : 0); st.g = 107; });
    const walls = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ strip: 0, station: i, side: 'L' as const, a: [i * 10, 100, 1.75] as [number, number, number], b: [i * 10 + 10, 100, 1.75] as [number, number, number], top: [105.5, 105.5] as [number, number], ground: [107, 107] as [number, number], roofed: i >= 2, parapet: false, out: [0, 1] as [number, number] }));
    const ceilings = [2, 3, 4, 5, 6].map((i) => ({ strip: 0, station: i, l0: [i * 10, 105.5, 1.75] as [number, number, number], r0: [i * 10, 105.5, -1.75] as [number, number, number], l1: [i * 10 + 10, 105.5, 1.75] as [number, number, number], r1: [i * 10 + 10, 105.5, -1.75] as [number, number, number] }));
    const headwalls = [{ strip: 0, station: 2, ax: 20, az: 1.75, bx: 20, bz: -1.75, bottom: 105.5, top: 107.9, nx: -1, nz: 0, underRoad: false }];
    const base = { strips: [s], kinds: [Uint8Array.from([3, 3, 4, 4, 4, 4, 4, 4])], variants: ['TUN-T1'], walls, ceilings, headwalls };
    const good = buildTunnels({ ...base, ground: () => 107, roadAt: () => 100 });
    expect(good.record.segments).toBe(5);
    expect(good.record.minHeadroomM).toBeCloseTo(5.5, 6);
    expect(good.record.minCoverM).toBeCloseTo(1.5, 6);
    expect(tunnelInvariant(good.record).ok).toBe(true);
    // one open run and one roofed run on the left side, one ceiling run, the mouth with its name, drains at the sag and the mouth
    expect(good.walls.map((w) => w.roofed)).toEqual([false, true]);
    expect(good.ceilings.length).toBe(1);
    expect(good.record.portals[0]).toMatchObject({ name: 'Pragati Maidan Tunnel', variant: 'TUN-T1', facesDeg: 270 });
    expect(good.drains.length).toBe(2);
    // a pond bed under the ceiling, and a low ceiling: both fail
    const wet = buildTunnels({ ...base, ground: (x) => (x > 40 ? 105.2 : 107), roadAt: () => 100 });
    expect(wet.record.noCoverCount).toBeGreaterThan(0);
    expect(tunnelInvariant(wet.record).ok).toBe(false);
    const low = buildTunnels({ ...base, ground: () => 107, roadAt: () => 100.8 });
    expect(low.record.lowHeadroomCount).toBe(15);
    expect(tunnelInvariant(low.record).ok).toBe(false);
  });

  it('the grade cap of a tunnel: 6 percent on a public road and its joined approach, none on a service way', () => {
    const strips = [{ cls: 'tertiary' }, { cls: 'tertiary' }, { cls: 'service' }, { cls: 'primary' }];
    const tunnels = [Uint8Array.from([0, 1, 1]), undefined, Uint8Array.from([1, 1]), undefined];
    const joints = [{ a: { strip: 0 }, b: { strip: 1 } }, { a: { strip: 2 }, b: { strip: 3 } }];
    const caps = tunnelGradeCaps(strips, joints, tunnels);
    expect([...caps]).toEqual([TUNNEL_MAX_GRADE, TUNNEL_MAX_GRADE, Infinity, TUNNEL_MAX_GRADE]);
  });
});
