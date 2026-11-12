// Metro viaducts and foot over bridges (P1-035, MAP_REPAIR.md "Elevation solver"): their heights and the clearance
// under them, read from the solved roads. Neither is part of the road solve: a viaduct or a foot bridge stands clear
// of whatever lies under it, so it takes its height from what is there and never moves a road. A foot bridge the
// road graph carries (a pedestrian way with a bridge tag) was solved with the roads: its heights are its strips'.
//   Viaduct: the rail level along every chain of metro ways with a bridge tag is the lowest profile that keeps a
//   road at grade under it everywhere (METRO_VIADUCT_M), keeps the headroom over every road, junction, railway line
//   and water it passes over, and climbs at 4 percent at most; where the chain meets a metro way in a tunnel or at
//   grade the rail comes down to the ground (the portal), and nothing that needs more than that ramp allows is hidden
//   (shortM). The viaduct itself (piers, girders, stations) is built later (P2-019).
//   Foot bridge: one flat walking level, the highest any crossing needs, with stairs down to the ground at its ends.
// Pure.
import { Grid, pointInRing, polylineLength, resample } from '../geom.ts';
import type { Box2, P2 } from '../geom.ts';
import { segCross } from '../roads/curve.ts';
import type { Station, Strip } from '../roads/model.ts';
import type { ElevationJunction, RailLine, WaterArea } from './crossings.ts';
import { FOOT_BRIDGE_DEPTH_M, FOOT_BRIDGE_HALF_WIDTH_M, HEADROOM, METRO_DECK_DEPTH_M, METRO_MAX_GRADE, METRO_VIADUCT_M, RAIL_HEADROOM_M, STRUCTURE_M, WATER_CLEARANCE_M } from './limits.ts';

export interface OverheadInput {
  /** The solved lane model (station heights set). */
  strips: readonly Strip[];
  junctions: readonly (ElevationJunction & { id?: string })[];
  junctionHeights: readonly number[];
  /** Railway lines (not metro): a viaduct or a foot bridge keeps the wires' headroom over them. */
  rails: readonly RailLine[];
  /** Every metro line of the stage: the ones with a bridge tag are the viaducts, the others are where they land. */
  metro: readonly RailLine[];
  footBridges: readonly { id: string; ways: readonly string[]; pts: readonly (readonly P2[])[] }[];
  water: readonly WaterArea[];
  ground: (x: number, z: number) => number;
  /** Height of a railway bridge above the ground model (crossings.ts). */
  railEmbankment: number;
}

export type UnderKind = 'road' | 'junction' | 'railway' | 'water';

/** One thing under a viaduct or a foot bridge, at the place it has the least clearance. */
export interface OverCrossing {
  kind: UnderKind;
  /** Strip id, junction id, railway way id or water id. */
  id: string;
  name: string;
  x: number;
  z: number;
  /** Height of its surface there (rail top, water level). */
  underH: number;
  /** Clear height from that surface to the underside of the deck above it. */
  clearanceM: number;
  /** The headroom it needs. */
  needM: number;
}

export interface ViaductEnd {
  x: number;
  z: number;
  /** portal: it meets a metro tunnel; grade: a metro line at grade; open: the stage edge or a metro line the stage does not hold. */
  kind: 'portal' | 'grade' | 'open';
  h: number;
  g: number;
}

export interface Viaduct {
  id: string;
  name: string;
  ways: string[];
  lenM: number;
  /** Rail level above the ground model, least and most. */
  minAboveM: number;
  maxAboveM: number;
  ends: ViaductEnd[];
  crossings: OverCrossing[];
  /** Least clearance over a road or junction (Infinity written as null when it crosses none). */
  minClearanceM: number | null;
  /** Largest headroom the profile could not give (0: every one kept). */
  shortM: number;
  /** Every 10 m: x, z, rail level, ground model. */
  profile: [number, number, number, number][];
}

export interface FootBridgeHeights {
  id: string;
  ways: string[];
  lenM: number;
  /** Its heights are its strips' (a pedestrian way of the road graph, solved with the roads). */
  solved: boolean;
  /** Walking level: the highest point of the deck. */
  deckH: number;
  maxAboveM: number;
  crossings: OverCrossing[];
  minClearanceM: number | null;
  shortM: number;
  /** Ends that come down to the ground by stairs: the rise. */
  stairs: { x: number; z: number; riseM: number }[];
}

export interface OverheadResult {
  viaducts: Viaduct[];
  footBridges: FootBridgeHeights[];
}

const r2 = (v: number): number => Math.round(v * 100) / 100 + 0;
const r3 = (v: number): number => Math.round(v * 1000) / 1000 + 0;
const SAMPLE_M = 2.5;
const FOOT_SAMPLE_M = 2;
/** Two metro ways meet when their ends are this close. */
const MEET_M = 2;
/** A junction counts as under a deck only near its centre (some cluster rings span hundreds of metres, P1-036). */
const JUNCTION_NEAR_M = 40;

interface Under {
  kind: UnderKind;
  id: string;
  name: string;
  h: number;
  need: number;
}

type UnderAt = (p: P2, dir: P2, half: number, step: number, skip: (strip: number) => boolean, low?: boolean) => Under[];

/**
 * What lies under a deck: road surfaces, junction centres, railway lines and water, at any point. `low`: only what lies
 * near the ground (a foot bridge crosses streets and tracks; a road deck or a railway bridge beside it is not under it,
 * it shares the bridge's level or stands over it).
 */
function underFinder(input: OverheadInput): UnderAt {
  const { strips } = input;
  const grid = new Grid<number>(60);
  const quads: { si: number; i: number; ring: P2[] }[] = [];
  const corner = (st: Station, k: number): P2 => ({ x: st.x + st.nx * (st.b[k] as number), z: st.z + st.nz * (st.b[k] as number) });
  strips.forEach((s, si) => {
    for (let i = 0; i + 1 < s.st.length; i++) {
      const p = s.st[i] as Station;
      const q = s.st[i + 1] as Station;
      const ring = [corner(p, 0), corner(p, p.b.length - 1), corner(q, q.b.length - 1), corner(q, 0)];
      const box: Box2 = { minX: Math.min(...ring.map((c) => c.x)), maxX: Math.max(...ring.map((c) => c.x)), minZ: Math.min(...ring.map((c) => c.z)), maxZ: Math.max(...ring.map((c) => c.z)) };
      grid.insert(box, quads.length);
      quads.push({ si, i, ring });
    }
  });
  const railSegs = new Grid<[number, number]>(60);
  input.rails.forEach((r, ri) => {
    if (r.tunnel) return;
    for (let k = 0; k + 1 < r.pts.length; k++) {
      const a = r.pts[k] as P2;
      const b = r.pts[k + 1] as P2;
      railSegs.insert({ minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) }, [ri, k]);
    }
  });
  const railBridgeH = input.rails.map((r) => {
    const a = r.pts[0] as P2;
    const b = r.pts[r.pts.length - 1] as P2;
    return Math.max(input.ground(a.x, a.z), input.ground(b.x, b.z)) + input.railEmbankment;
  });
  const nameOf = (s: Strip): string => s.name || `${s.cls} road`;
  return (p, dir, half, step, skip, low = false) => {
    const nx = -dir.z;
    const nz = dir.x;
    const best = new Map<string, Under>();
    const add = (u: Under): void => {
      const key = `${u.kind}:${u.id}`;
      const was = best.get(key);
      if (!was || u.h + u.need > was.h + was.need) best.set(key, u);
    };
    for (const k of half > 0 ? [-half, 0, half] : [0]) {
      const q = { x: p.x + nx * k, z: p.z + nz * k };
      for (const r of grid.query({ minX: q.x, maxX: q.x, minZ: q.z, maxZ: q.z }).sort((a, b) => a - b)) {
        const quad = quads[r] as (typeof quads)[number];
        if (skip(quad.si) || !pointInRing(q, quad.ring)) continue;
        const s = strips[quad.si] as Strip;
        const a = s.st[quad.i] as Station;
        const b = s.st[quad.i + 1] as Station;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.z - a.z) * dz) / Math.max(1e-9, dx * dx + dz * dz)));
        if (low && Math.abs(a.h + (b.h - a.h) * t - (a.g + (b.g - a.g) * t)) > STRUCTURE_M) continue;
        add({ kind: 'road', id: s.id, name: nameOf(s), h: a.h + (b.h - a.h) * t, need: HEADROOM });
      }
    }
    input.junctions.forEach((jn, ji) => {
      if (Math.hypot(jn.centre.x - p.x, jn.centre.z - p.z) > JUNCTION_NEAR_M || jn.ring.length < 3 || !pointInRing(p, jn.ring)) return;
      if (low && Math.abs((input.junctionHeights[ji] as number) - input.ground(jn.centre.x, jn.centre.z)) > STRUCTURE_M) return;
      const arm = strips[(jn.arms[0] as { strip: number }).strip] as Strip;
      add({ kind: 'junction', id: jn.id ?? `junction ${ji}`, name: nameOf(arm), h: input.junctionHeights[ji] as number, need: HEADROOM });
    });
    const a = { x: p.x - (dir.x * step) / 2, z: p.z - (dir.z * step) / 2 };
    const b = { x: p.x + (dir.x * step) / 2, z: p.z + (dir.z * step) / 2 };
    for (const [ri, k] of railSegs.query({ minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) })) {
      const line = input.rails[ri] as RailLine;
      if (low && line.bridge) continue;
      const x = segCross(a, b, line.pts[k] as P2, line.pts[k + 1] as P2);
      if (!x || x.t >= 1 - 1e-9) continue;
      add({ kind: 'railway', id: line.id, name: line.name || 'railway', h: line.bridge ? (railBridgeH[ri] as number) : input.ground(x.x, x.z), need: RAIL_HEADROOM_M });
    }
    for (const w of input.water) {
      let n = 0;
      for (const ring of w.rings) if (pointInRing(p, ring)) n++;
      if (n % 2 === 1) add({ kind: 'water', id: w.id, name: w.name || 'water', h: input.ground(p.x, p.z), need: WATER_CLEARANCE_M });
    }
    return [...best.values()];
  };
}

/** Keeps, per thing under the deck, the place with the least clearance. */
function crossingList(found: { u: Under; x: number; z: number; deckUnderside: number }[]): OverCrossing[] {
  const best = new Map<string, OverCrossing>();
  for (const f of found) {
    const c: OverCrossing = { kind: f.u.kind, id: f.u.id, name: f.u.name, x: r2(f.x), z: r2(f.z), underH: r3(f.u.h), clearanceM: r2(f.deckUnderside - f.u.h), needM: f.u.need };
    const key = `${c.kind}:${c.id}`;
    const was = best.get(key);
    if (!was || c.clearanceM - c.needM < was.clearanceM - was.needM) best.set(key, c);
  }
  return [...best.values()].sort((p, q) => p.clearanceM - q.clearanceM || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
}

const leastRoadClearance = (cs: readonly OverCrossing[]): number | null => {
  const roads = cs.filter((c) => c.kind === 'road' || c.kind === 'junction');
  return roads.length ? Math.min(...roads.map((c) => c.clearanceM)) : null;
};

/** Chains of metro ways with a bridge tag, joined end to end; each as one polyline with the ways in order. */
function viaductChains(metro: readonly RailLine[]): { ways: RailLine[]; pts: P2[] }[] {
  const decks = metro.filter((m) => m.bridge && !m.tunnel && m.pts.length >= 2);
  const meet = (a: P2, b: P2): boolean => Math.hypot(a.x - b.x, a.z - b.z) < MEET_M;
  const used = new Set<number>();
  const out: { ways: RailLine[]; pts: P2[] }[] = [];
  const endsOf = (m: RailLine): [P2, P2] => [m.pts[0] as P2, m.pts[m.pts.length - 1] as P2];
  decks.forEach((_, mi) => {
    if (used.has(mi)) return;
    // walk back to the first way of the chain, then forward
    let first = mi;
    for (let guard = 0; guard < decks.length; guard++) {
      const start = endsOf(decks[first] as RailLine)[0];
      const prev = decks.findIndex((o, oi) => oi !== first && !used.has(oi) && meet(endsOf(o)[1], start));
      if (prev < 0 || prev === mi) break;
      first = prev;
    }
    const ways: RailLine[] = [];
    const pts: P2[] = [];
    let at = first;
    for (let guard = 0; guard <= decks.length && at >= 0 && !used.has(at); guard++) {
      used.add(at);
      const w = decks[at] as RailLine;
      ways.push(w);
      pts.push(...(pts.length ? w.pts.slice(1) : w.pts));
      const end = endsOf(w)[1];
      at = decks.findIndex((o, oi) => !used.has(oi) && meet(endsOf(o)[0], end));
    }
    out.push({ ways, pts });
  });
  return out;
}

export function overheadHeights(input: OverheadInput): OverheadResult {
  const under = underFinder(input);
  const atGrade = input.metro.filter((m) => !m.bridge && m.pts.length >= 2);
  const viaducts: Viaduct[] = viaductChains(input.metro).map((chain) => {
    const samples = resample(chain.pts, SAMPLE_M);
    const n = samples.length;
    const s = new Float64Array(n);
    for (let i = 1; i < n; i++) s[i] = (s[i - 1] as number) + Math.hypot((samples[i] as P2).x - (samples[i - 1] as P2).x, (samples[i] as P2).z - (samples[i - 1] as P2).z);
    const g = samples.map((p) => input.ground(p.x, p.z));
    const dirAt = (i: number): P2 => {
      const a = samples[Math.max(0, i - 1)] as P2;
      const b = samples[Math.min(n - 1, i + 1)] as P2;
      const d = Math.max(1e-9, Math.hypot(b.x - a.x, b.z - a.z));
      return { x: (b.x - a.x) / d, z: (b.z - a.z) / d };
    };
    // under the track itself: a viaduct runs along street medians, and the road beside its ramp is not under it
    const found = samples.map((p, i) => under(p, dirAt(i), 0, SAMPLE_M, () => false));
    const need = found.map((us) => Math.max(-Infinity, ...us.map((u) => u.h + u.need + METRO_DECK_DEPTH_M)));
    const want = need.map((v, i) => Math.max(v, (g[i] as number) + METRO_VIADUCT_M));
    // where the chain lands: a metro way in a tunnel (a portal) or at grade
    const endKind = (p: P2): ViaductEnd['kind'] => {
      const other = atGrade.find((m) => [m.pts[0] as P2, m.pts[m.pts.length - 1] as P2].some((q) => Math.hypot(q.x - p.x, q.z - p.z) < MEET_M));
      return other ? (other.tunnel ? 'portal' : 'grade') : 'open';
    };
    const kinds = [endKind(samples[0] as P2), endKind(samples[n - 1] as P2)];
    const anchors = kinds.map((k, e) => (k === 'open' ? null : e === 0 ? 0 : n - 1)).filter((a): a is number => a !== null);
    const h = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let up = -Infinity;
      for (let j = 0; j < n; j++) up = Math.max(up, (want[j] as number) - METRO_MAX_GRADE * Math.abs((s[i] as number) - (s[j] as number)));
      let cap = Infinity;
      for (const a of anchors) cap = Math.min(cap, (g[a] as number) + METRO_MAX_GRADE * Math.abs((s[i] as number) - (s[a] as number)));
      h[i] = Math.min(up, cap);
    }
    let shortM = 0;
    const list: { u: Under; x: number; z: number; deckUnderside: number }[] = [];
    samples.forEach((p, i) => {
      shortM = Math.max(shortM, (need[i] as number) - (h[i] as number));
      for (const u of found[i] as Under[]) list.push({ u, x: p.x, z: p.z, deckUnderside: (h[i] as number) - METRO_DECK_DEPTH_M });
    });
    const above = samples.map((_, i) => (h[i] as number) - (g[i] as number));
    const crossings = crossingList(list);
    const profile: Viaduct['profile'] = [];
    for (let i = 0; i < n; i += 4) profile.push([r2((samples[i] as P2).x), r2((samples[i] as P2).z), r3(h[i] as number), r3(g[i] as number)]);
    if ((n - 1) % 4 !== 0) profile.push([r2((samples[n - 1] as P2).x), r2((samples[n - 1] as P2).z), r3(h[n - 1] as number), r3(g[n - 1] as number)]);
    const end = (i: number, k: ViaductEnd['kind']): ViaductEnd => ({ x: r2((samples[i] as P2).x), z: r2((samples[i] as P2).z), kind: k, h: r3(h[i] as number), g: r3(g[i] as number) });
    return {
      id: (chain.ways[0] as RailLine).id, name: (chain.ways[0] as RailLine).name, ways: chain.ways.map((w) => w.id), lenM: r2(polylineLength(chain.pts)),
      minAboveM: r2(Math.min(...above)), maxAboveM: r2(Math.max(...above)), ends: [end(0, kinds[0] as ViaductEnd['kind']), end(n - 1, kinds[1] as ViaductEnd['kind'])],
      crossings, minClearanceM: leastRoadClearance(crossings), shortM: r2(Math.max(0, shortM)), profile,
    };
  });

  const footBridges: FootBridgeHeights[] = input.footBridges.map((fb) => {
    const ways = new Set(fb.ways);
    const carrying = new Set<number>();
    input.strips.forEach((s, si) => s.ways.some((w) => ways.has(w)) && carrying.add(si));
    const lines = fb.pts.filter((l) => l.length >= 2).map((l) => resample(l, FOOT_SAMPLE_M));
    // the heights the road solve gave the stretches the road graph carries
    const solvedAt = (p: P2): number | null => {
      let best: number | null = null;
      let bd = 3;
      for (const si of carrying) {
        for (const st of (input.strips[si] as Strip).st) {
          const d = Math.hypot(st.x - p.x, st.z - p.z);
          if (d < bd) {
            bd = d;
            best = st.h;
          }
        }
      }
      return best;
    };
    const samples = lines.map((l) => l.map((p, i) => {
      const a = l[Math.max(0, i - 1)] as P2;
      const b = l[Math.min(l.length - 1, i + 1)] as P2;
      const d = Math.max(1e-9, Math.hypot(b.x - a.x, b.z - a.z));
      const us = under(p, { x: (b.x - a.x) / d, z: (b.z - a.z) / d }, FOOT_BRIDGE_HALF_WIDTH_M, FOOT_SAMPLE_M, (si) => carrying.has(si), true);
      return { p, g: input.ground(p.x, p.z), solved: solvedAt(p), us };
    }));
    const flat = samples.flat();
    const needs = flat.flatMap((q) => q.us.map((u) => u.h + u.need + FOOT_BRIDGE_DEPTH_M));
    // one walking level for the stretches the road graph does not carry: the highest any crossing needs
    const deck = needs.length ? Math.max(...needs) : Math.max(...flat.map((q) => q.g)) + HEADROOM + FOOT_BRIDGE_DEPTH_M;
    const hOf = (q: (typeof flat)[number]): number => q.solved ?? deck;
    let shortM = 0;
    const list: { u: Under; x: number; z: number; deckUnderside: number }[] = [];
    for (const q of flat) {
      for (const u of q.us) {
        list.push({ u, x: q.p.x, z: q.p.z, deckUnderside: hOf(q) - FOOT_BRIDGE_DEPTH_M });
        shortM = Math.max(shortM, u.h + u.need + FOOT_BRIDGE_DEPTH_M - hOf(q));
      }
    }
    // stairs where a line ends on its own (not on another line of the same bridge) and not on the road graph
    const stairs: FootBridgeHeights['stairs'] = [];
    samples.forEach((l, li) => {
      for (const q of [l[0], l[l.length - 1]]) {
        if (!q || q.solved !== null) continue;
        const joined = lines.some((o, oi) => oi !== li && o.some((p) => Math.hypot(p.x - q.p.x, p.z - q.p.z) < 1.5));
        if (!joined) stairs.push({ x: r2(q.p.x), z: r2(q.p.z), riseM: r2(hOf(q) - q.g) });
      }
    });
    const crossings = crossingList(list);
    return {
      id: fb.id, ways: [...fb.ways], lenM: r2(fb.pts.reduce((a, l) => a + polylineLength(l), 0)), solved: flat.some((q) => q.solved !== null),
      deckH: r3(Math.max(...flat.map(hOf))), maxAboveM: r2(Math.max(...flat.map((q) => hOf(q) - q.g))), crossings, minClearanceM: leastRoadClearance(crossings),
      shortM: r2(Math.max(0, shortM)), stairs,
    };
  });
  return { viaducts, footBridges };
}

/** The numbers the health report keeps. */
export function overheadRecord(res: OverheadResult): {
  viaducts: number; viaductM: number; viaductCrossings: number; viaductMinClearanceM: number | null; viaductShortM: number; railAboveGroundM: { min: number; max: number } | null;
  footBridges: number; solvedFootBridges: number; footCrossings: number; footMinClearanceM: number | null; footShortM: number; stairs: number;
  /** Every crossing under a viaduct or a foot bridge that has less than its headroom, with what is over it. */
  short: { over: string; name: string; under: string; kind: UnderKind; x: number; z: number; clearanceM: number; needM: number }[];
} {
  const least = (v: (number | null)[]): number | null => {
    const xs = v.filter((x): x is number => x !== null);
    return xs.length ? Math.min(...xs) : null;
  };
  const vs = res.viaducts;
  const fs = res.footBridges;
  return {
    viaducts: vs.length, viaductM: Math.round(vs.reduce((a, v) => a + v.lenM, 0)), viaductCrossings: vs.reduce((a, v) => a + v.crossings.length, 0),
    viaductMinClearanceM: least(vs.map((v) => v.minClearanceM)), viaductShortM: r2(Math.max(0, ...vs.map((v) => v.shortM))),
    railAboveGroundM: vs.length ? { min: r2(Math.min(...vs.map((v) => v.minAboveM))), max: r2(Math.max(...vs.map((v) => v.maxAboveM))) } : null,
    footBridges: fs.length, solvedFootBridges: fs.filter((f) => f.solved).length, footCrossings: fs.reduce((a, f) => a + f.crossings.length, 0),
    footMinClearanceM: least(fs.map((f) => f.minClearanceM)), footShortM: r2(Math.max(0, ...fs.map((f) => f.shortM))), stairs: fs.reduce((a, f) => a + f.stairs.length, 0),
    short: [...vs.map((v) => ({ over: v.id, name: v.name || 'metro viaduct', cs: v.crossings })), ...fs.map((f) => ({ over: f.id, name: 'foot bridge', cs: f.crossings }))].flatMap((o) =>
      o.cs.filter((c) => c.clearanceM < c.needM - 0.02).map((c) => ({ over: o.over, name: o.name, under: c.name, kind: c.kind, x: c.x, z: c.z, clearanceM: c.clearanceM, needM: c.needM }))),
  };
}
