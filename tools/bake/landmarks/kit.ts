// What the landmark parts kit needs from the bake (P2-007). The kit itself is procedural GDScript in the game
// (game/world/landmarks/, STYLE_BIBLE.md "Procedural vs file": stand-ins are procedural GDScript): domes, chhatris,
// arches, colonnades, minarets, shikharas and slabs, put together by one recipe per landmark. A landmark the kit
// builds leaves the tile massing (its body, its wall line and the parts the recipe rebuilds), and the landmark file
// gives the recipe its inputs in metres from the landmark's position (x east, z south, y up from its foot):
// - the footprint, the body rings, their main axis and the pad;
// - a fort's wall line as runs on the ground, open where a road passes (the same 20 m pieces as the massing);
// - the parts the kit rebuilds (a fort's gates: footprints tagged historic=city_gate);
// - the Connaught Place blocks as ring sectors (DELHI_WORLD.md "Area blueprints": the uniform two storey white
//   Georgian colonnade ring whatever OSM draws): the parts' angles and radii read as blocks, split where a radial
//   road crosses, kept off every road face.
// Pure.
import type { P2 } from '../geom.ts';
import { pointInRing, ringArea, ringCentroid } from '../geom.ts';
import { mainAxis } from './orient.ts';
import type { PlaceFootprint, Placement } from './place.ts';
import { partHeight, simplifyRing } from './massing.ts';

export type KitRecipe = 'india_gate' | 'canopy' | 'red_fort' | 'cp_circle' | 'jama_masjid';

/** The landmarks the kit builds, by registry id (the pilot heroes, Jama Masjid as a signature, the India Gate canopy). */
export const KIT_RECIPES: Readonly<Record<string, KitRecipe>> = {
  india_gate: 'india_gate',
  netaji_subhash_chandra_bose_s_canopy_q113258441: 'canopy',
  red_fort: 'red_fort',
  cp_circle: 'cp_circle',
  jama_masjid: 'jama_masjid',
};

export const kitRecipe = (id: string): KitRecipe | null => KIT_RECIPES[id] ?? null;

type XZ = [number, number];

export interface KitWallRun {
  /** Points of the wall line: x, ground y, z (m from the landmark's foot). */
  pts: [number, number, number][];
  /** Wall height above the ground at each point (m). */
  h: number[];
}

export interface KitPart {
  id: string;
  ring: XZ[];
  /** Lowest and highest ground under the ring (m from the landmark's foot). */
  base: number;
  top: number;
  name: string | null;
  /** Its height above the ground (the part's data, else its class default), for a part built as a block. */
  height?: number;
}

export interface KitSector {
  /** Inner and outer radius (m) and the compass bearings it spans, clockwise from a0 to a1 (a1 > a0, may pass 360). */
  r0: number;
  r1: number;
  a0: number;
  a1: number;
  /** Lowest ground under it (m from the landmark's foot). */
  base: number;
  band: 'inner' | 'outer';
}

export interface KitInput {
  recipe: KitRecipe;
  footprint: XZ[] | null;
  body: XZ[][];
  /** Main axis of the body (else the footprint): compass bearing of the long side, its size and middle. */
  axis: { deg: number; lengthM: number; widthM: number; c: XZ } | null;
  pad: { ring: XZ[]; level: number } | null;
  walls: KitWallRun[];
  /** The gates of a fort (parts tagged historic=city_gate, and gate landmarks inside its zone). */
  gates: KitPart[];
  /** A fort's buildings near its gates (the barbican, the guard rooms): built as rampart blocks in its stone. */
  blocks: KitPart[];
  sectors: KitSector[];
}

export interface KitBuild {
  inputs: Map<string, KitInput>;
  /** Footprints the kit rebuilds: they leave the tile massing. */
  takenParts: Set<string>;
  /** Landmarks another landmark's kit builds (a fort's gate placed on its own): id to the builder's id. */
  builtBy: Map<string, string>;
}

const r2 = (v: number): number => Math.round(v * 100) / 100;
/** A fort's buildings this near a gate (m, centre to centre) are its barbican and guard rooms. */
const FORT_GATE_REACH_M = 110;
/** A fort's building outside its wall line and this near it (m) is part of the fortification (an outwork, a bastion). */
const FORT_OUTWORK_M = 70;

/** Whether a point lies outside a fort's wall line (further from the middle than the wall) and within FORT_OUTWORK_M of it. */
export function outsideWall(c: P2, p: Pick<Placement, 'x' | 'z' | 'walls'>): boolean {
  let best = Infinity;
  let foot: P2 | null = null;
  for (const w of p.walls) {
    const n = w.pts.length;
    for (let k = 0; k < (w.closed ? n : n - 1); k++) {
      const a = w.pts[k] as P2;
      const b = w.pts[(k + 1) % n] as P2;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.z - a.z) * dz) / len2));
      const q = { x: a.x + dx * t, z: a.z + dz * t };
      const d = Math.hypot(c.x - q.x, c.z - q.z);
      if (d < best) {
        best = d;
        foot = q;
      }
    }
  }
  if (!foot || best > FORT_OUTWORK_M) return false;
  return Math.hypot(c.x - p.x, c.z - p.z) > Math.hypot(foot.x - p.x, foot.z - p.z);
}
const WALL_PIECE_M = 20;

/** Compass bearing (0 north = -z, 90 east) of a point around an origin. */
export const compassOf = (dx: number, dz: number): number => ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;

/**
 * The kit inputs of every placed landmark with a recipe. `ground` is the solved ground (NaN under a road), `fallback`
 * the ground model, `yOf` the foot of a landmark (its pad level, else the ground at its position).
 */
export function buildKitInputs(placements: readonly Placement[], footprints: ReadonlyMap<string, PlaceFootprint>, ground: (x: number, z: number) => number, fallback: (x: number, z: number) => number, yOf: (p: Placement) => number): KitBuild {
  const inputs = new Map<string, KitInput>();
  const takenParts = new Set<string>();
  const builtBy = new Map<string, string>();
  const at = (x: number, z: number): number => {
    const y = ground(x, z);
    return Number.isFinite(y) ? y : fallback(x, z);
  };
  for (const p of placements) {
    const recipe = kitRecipe(p.id);
    if (!recipe || p.mode === 'point') continue;
    const y0 = yOf(p);
    const loc = (q: P2): XZ => [r2(q.x - p.x), r2(q.z - p.z)];
    const ring = (rg: readonly P2[]): XZ[] => simplifyRing(rg, 0.15).map(loc);
    const axisRing = p.body[0] ?? p.footprint;
    const ax = axisRing ? mainAxis(axisRing) : null;
    const parts = p.partIds.map((id) => footprints.get(id)).filter((f): f is PlaceFootprint => !!f);
    const partOf = (f: PlaceFootprint): KitPart => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const q of f.ring) {
        const y = at(q.x, q.z);
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
      return { id: f.id, ring: ring(f.ring), base: r2(lo - y0), top: r2(hi - y0), name: f.tags['name'] ?? null };
    };
    const gates = parts.filter((f) => f.tags['historic'] === 'city_gate').map(partOf);
    for (const g of gates) takenParts.add(g.id);
    if (recipe === 'red_fort' && p.zone) {
      // a gate of the fort placed as a landmark of its own (the Lahori Gate): the fort's kit builds it
      for (const q of placements) {
        if (q === p || q.mode !== 'structure' || q.shape !== 'gate' || !q.body[0] || kitRecipe(q.id)) continue;
        if (!pointInRing({ x: q.x, z: q.z }, p.zone.ring)) continue;
        const qy = q.pad ? q.pad.level : at(q.x, q.z);
        const g: KitPart = { id: q.id, ring: ring(q.body[0]), base: r2(qy - y0), top: r2(qy - y0), name: q.name };
        // the same gate as a part of the fort and as a landmark of its own: the landmark wins
        const qc = { x: q.x - p.x, z: q.z - p.z };
        const dup = gates.findIndex((o) => {
          const c = ringCentroid(o.ring.map(([x, z]) => ({ x, z })));
          return Math.hypot(c.x - qc.x, c.z - qc.z) < 40;
        });
        if (dup >= 0) gates.splice(dup, 1, g);
        else gates.push(g);
        builtBy.set(q.id, p.id);
      }
    }
    // a fort's buildings round its gates (the barbican in front of the Lahori Gate) are rampart, not plain prisms
    const blocks: KitPart[] = [];
    if (recipe === 'red_fort') {
      const centres = gates.map((g) => ringCentroid(g.ring.map(([x, z]) => ({ x, z }))));
      for (const f of parts) {
        if (takenParts.has(f.id) || f.tags['historic'] === 'city_gate') continue;
        const c = ringCentroid(f.ring as P2[]);
        const nearGate = centres.some((g) => Math.hypot(c.x - p.x - g.x, c.z - p.z - g.z) < FORT_GATE_REACH_M);
        if (!nearGate && !outsideWall(c, p)) continue;
        blocks.push({ ...partOf(f), height: r2(partHeight(f)) });
        takenParts.add(f.id);
      }
    }
    let sectors: KitSector[] = [];
    if (recipe === 'cp_circle') {
      const res = cpSectors(p, parts, ground, at, y0);
      sectors = res.sectors;
      for (const id of res.used) takenParts.add(id);
    }
    inputs.set(p.id, {
      recipe,
      footprint: p.footprint ? ring(p.footprint) : null,
      body: p.body.map(ring),
      axis: ax ? { deg: r2(ax.axisDeg), lengthM: r2(ax.lengthM), widthM: r2(ax.widthM), c: loc(ax.centre) } : null,
      pad: p.pad ? { ring: ring(p.pad.ring), level: r2(p.pad.level - y0) } : null,
      walls: wallRuns(p, ground, y0),
      gates,
      blocks,
      sectors,
    });
  }
  return { inputs, takenParts, builtBy };
}

/** A fort's wall line as runs on the solved ground: the 20 m pieces of the massing, a run ends where a road passes. */
export function wallRuns(p: Pick<Placement, 'walls' | 'x' | 'z'>, ground: (x: number, z: number) => number, y0: number): KitWallRun[] {
  const runs: KitWallRun[] = [];
  for (const w of p.walls) {
    const n = w.pts.length;
    let cur: KitWallRun | null = null;
    const close = (): void => {
      if (cur && cur.pts.length >= 2) runs.push(cur);
      cur = null;
    };
    for (let k = 0; k < (w.closed ? n : n - 1); k++) {
      const a = w.pts[k] as P2;
      const b = w.pts[(k + 1) % n] as P2;
      const ha = w.heights[k] as number;
      const hb = w.heights[(k + 1) % n] as number;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const steps = Math.max(1, Math.ceil(len / WALL_PIECE_M));
      for (let i = 0; i < steps; i++) {
        const t0 = i / steps;
        const t1 = (i + 1) / steps;
        const s: P2 = { x: a.x + (b.x - a.x) * t0, z: a.z + (b.z - a.z) * t0 };
        const e: P2 = { x: a.x + (b.x - a.x) * t1, z: a.z + (b.z - a.z) * t1 };
        const gs = ground(s.x, s.z);
        const ge = ground(e.x, e.z);
        const gm = ground((s.x + e.x) / 2, (s.z + e.z) / 2);
        if (!Number.isFinite(gs) || !Number.isFinite(ge) || !Number.isFinite(gm)) {
          close();
          continue;
        }
        const c: KitWallRun = cur ?? { pts: [[r2(s.x - p.x), r2(gs - y0), r2(s.z - p.z)]], h: [r2(ha + (hb - ha) * t0)] };
        cur = c;
        c.pts.push([r2(e.x - p.x), r2(ge - y0), r2(e.z - p.z)]);
        c.h.push(r2(ha + (hb - ha) * t1));
      }
    }
    close();
  }
  return runs;
}

/** A merged angular interval of a band, in compass degrees (a1 > a0, may pass 360). */
interface Span {
  a0: number;
  a1: number;
  ids: string[];
  radii: number[];
}

/** Parts whose centre lies nearer the middle than this are not ring blocks (park kiosks, the metro entrances). */
const CP_MIN_R = 90;
/** A ring block is a part of at least this area (m2): the many small parts round them are kiosks and back sheds. */
const CP_SEED_M2 = 1000;
/** Two seeds of one block are this close in angle at most (deg); a radial road opens a wider gap. */
const CP_MERGE_DEG = 2.5;
/** A block narrower than this (deg) or shallower than CP_MIN_DEPTH_M is not built. */
const CP_MIN_SPAN_DEG = 3;
const CP_MIN_DEPTH_M = 8;
/** The kit keeps this far off a road face (m). */
const CP_ROAD_CLEAR_M = 1;
const STEP_DEG = 0.25;
/** A gap between two blocks wider than this (deg) is filled with a block (a radial road is narrower). */
const CP_FILL_GAP_DEG = 8;

/**
 * The Connaught Place blocks as ring sectors around the landmark's position (the middle of the rings). The large
 * parts are the blocks: split into the inner and the outer ring at the widest gap of their centre radii (the Middle
 * Circle), merged by angle into blocks. Within a block's angles and radii the sectors are the road free ground: the
 * radii no road crosses at any angle of the block (a service lane along the ring splits a block in two), then the
 * angles where that band meets no road (a radial road splits it), each pulled off the roads by CP_ROAD_CLEAR_M.
 */
export function cpSectors(p: Pick<Placement, 'x' | 'z' | 'zone'>, parts: readonly PlaceFootprint[], ground: (x: number, z: number) => number, at: (x: number, z: number) => number, y0: number): { sectors: KitSector[]; used: string[] } {
  const all = parts
    .map((f) => {
      const c = ringCentroid(f.ring as P2[]);
      return { f, rc: Math.hypot(c.x - p.x, c.z - p.z), ac: compassOf(c.x - p.x, c.z - p.z), area: Math.abs(ringArea(f.ring as P2[])) };
    })
    .filter((c) => c.rc >= CP_MIN_R);
  const seeds = all.filter((c) => c.area >= CP_SEED_M2);
  if (seeds.length < 2) return { sectors: [], used: [] };
  const rs = seeds.map((c) => c.rc).sort((a, b) => a - b);
  let split = (rs[0] as number) + 1;
  let gap = -1;
  for (let i = 1; i < rs.length; i++) {
    const d = (rs[i] as number) - (rs[i - 1] as number);
    if (d > gap) {
      gap = d;
      split = ((rs[i] as number) + (rs[i - 1] as number)) / 2;
    }
  }
  const pt = (r: number, a: number): P2 => ({ x: p.x + r * Math.sin((a * Math.PI) / 180), z: p.z - r * Math.cos((a * Math.PI) / 180) });
  const road = (r: number, a: number): boolean => {
    const q = pt(r, a);
    return !Number.isFinite(ground(q.x, q.z));
  };
  const sectors: KitSector[] = [];
  const used: string[] = [];
  for (const band of ['inner', 'outer'] as const) {
    const inBand = (rc: number): boolean => (band === 'inner' ? rc < split : rc >= split);
    const spans: Span[] = seeds.filter((c) => inBand(c.rc)).map((c) => {
      let lo = Infinity;
      let hi = -Infinity;
      const radii: number[] = [];
      for (const q of c.f.ring) {
        const dx = q.x - p.x;
        const dz = q.z - p.z;
        const d = ((compassOf(dx, dz) - c.ac + 540) % 360) - 180;
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
        radii.push(Math.hypot(dx, dz));
      }
      let a0 = c.ac + lo;
      let a1 = c.ac + hi;
      while (a0 < 0) {
        a0 += 360;
        a1 += 360;
      }
      return { a0, a1, ids: [c.f.id], radii };
    });
    spans.sort((a, b) => a.a0 - b.a0);
    const merged: Span[] = [];
    for (const s of spans) {
      const last = merged[merged.length - 1];
      if (last && s.a0 <= last.a1 + CP_MERGE_DEG) {
        last.a1 = Math.max(last.a1, s.a1);
        last.ids.push(...s.ids);
        last.radii.push(...s.radii);
      } else merged.push({ ...s, ids: [...s.ids], radii: [...s.radii] });
    }
    if (merged.length > 1) {
      const first = merged[0] as Span;
      const last = merged[merged.length - 1] as Span;
      if (first.a0 + 360 <= last.a1 + CP_MERGE_DEG) {
        last.a1 = Math.max(last.a1, first.a1 + 360);
        last.ids.push(...first.ids);
        last.radii.push(...first.radii);
        merged.shift();
      }
    }
    // the ring is uniform whatever OSM draws (the owner's blueprint rule): where the map has no large part between
    // two blocks, a block of the band's depth fills the gap, and the road test below leaves the radial roads open
    if (merged.length) {
      const all = merged.flatMap((m) => m.radii).sort((a, b) => a - b);
      const q = (t: number): number => all[Math.min(all.length - 1, Math.max(0, Math.round(t * (all.length - 1))))] as number;
      const lo = q(0.05);
      const hi = q(0.95);
      const fill: Span[] = [];
      for (let i = 0; i < merged.length; i++) {
        const a = merged[i] as Span;
        const b = merged[(i + 1) % merged.length] as Span;
        const b0 = i + 1 < merged.length ? b.a0 : b.a0 + 360;
        if (b0 - a.a1 > CP_FILL_GAP_DEG) fill.push({ a0: a.a1 + STEP_DEG, a1: b0 - STEP_DEG, ids: [], radii: [lo, hi] });
      }
      merged.push(...fill);
    }
    for (const m of merged) {
      const sorted = m.radii.slice().sort((a, b) => a - b);
      const pick = (q: number): number => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))] as number;
      const rLo = Math.floor(pick(0.03));
      const rHi = Math.ceil(pick(0.97));
      // first split the block where a road crosses its middle radius (a radial road or a lane through it), then in
      // each piece take the radii no road crosses at any of its angles, then the angles clear at all those radii
      const rmid = (rLo + rHi) / 2;
      for (const [b0, b1] of angleRuns(m.a0, m.a1, (a) => !road(rmid, a))) {
        if (b1 - b0 < CP_MIN_SPAN_DEG) continue;
        for (const [fr0, fr1] of radialRuns(rLo, rHi, (r) => {
          for (let a = b0 + 0.5; a <= b1 - 0.5 + 1e-9; a += STEP_DEG * 2) if (road(r, a)) return false;
          return true;
        })) {
          const r0 = fr0 + CP_ROAD_CLEAR_M;
          const r1 = fr1 - CP_ROAD_CLEAR_M;
          if (r1 - r0 < CP_MIN_DEPTH_M) continue;
          const rm = (r0 + r1) / 2;
          const clearDeg = (CP_ROAD_CLEAR_M / rm) * (180 / Math.PI);
          const clearAt = (a: number): boolean => {
            for (let r = r0 - CP_ROAD_CLEAR_M; r <= r1 + CP_ROAD_CLEAR_M + 1e-9; r += 1) if (road(r, a)) return false;
            return true;
          };
          for (const [x0, x1] of angleRuns(b0, b1, clearAt)) {
            const a0 = x0 + clearDeg;
            const a1 = x1 - clearDeg;
            if (a1 - a0 < CP_MIN_SPAN_DEG) continue;
            let base = Infinity;
            for (let a = a0; a <= a1 + 1e-9; a += 1) for (const r of [r0, rm, r1]) base = Math.min(base, at(pt(r, a).x, pt(r, a).z));
            sectors.push({ r0: r2(r0), r1: r2(r1), a0: r2(a0), a1: r2(a1), base: r2(base - y0), band });
          }
        }
      }
    }
  }
  // every part (seed or small) whose centre lies in a sector is rebuilt by the kit
  for (const c of all) {
    if (sectors.some((s) => c.rc >= s.r0 - 2 && c.rc <= s.r1 + 2 && angleIn(c.ac, s.a0 - 0.5, s.a1 + 0.5))) used.push(c.f.id);
  }
  return { sectors, used };
}

/** Runs of bearings from a0 to a1 (STEP_DEG apart) where `ok` holds: [first, last] of each. */
function angleRuns(a0: number, a1: number, ok: (a: number) => boolean): [number, number][] {
  const runs: [number, number][] = [];
  let s0: number | null = null;
  for (let a = a0; a <= a1 + 1e-9; a += STEP_DEG) {
    const good = ok(a);
    if (good && s0 === null) s0 = a;
    if ((!good || a + STEP_DEG > a1 + 1e-9) && s0 !== null) {
      runs.push([s0, good ? a : a - STEP_DEG]);
      s0 = null;
    }
  }
  return runs;
}

/** Runs of whole metres from r0 to r1 where `ok` holds. */
function radialRuns(r0: number, r1: number, ok: (r: number) => boolean): [number, number][] {
  const runs: [number, number][] = [];
  let s0: number | null = null;
  for (let r = r0; r <= r1; r += 1) {
    const good = ok(r);
    if (good && s0 === null) s0 = r;
    if ((!good || r === r1) && s0 !== null) {
      runs.push([s0, good ? r : r - 1]);
      s0 = null;
    }
  }
  return runs;
}

/** Whether compass bearing a lies in [a0, a1] (a1 > a0, possibly past 360). */
export function angleIn(a: number, a0: number, a1: number): boolean {
  let x = a;
  while (x < a0) x += 360;
  while (x - 360 >= a0) x -= 360;
  return x <= a1;
}

