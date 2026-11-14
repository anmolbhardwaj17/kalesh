// The area profile generator (P2-009; DELHI_WORLD.md "The generator (Fable tier)" and section 10 AG1, EB1). It runs
// in the bake in two parts and replaces the plain shells of P1:
//
//   planParcels   before the ground is built. Parcels are the repaired footprints (off the roads, landmark zones
//                 already taken out), with the area blueprints laid over them (blueprints.ts), odd outlines flagged
//                 or regularised (oddshapes.ts) and the holes in street rows cut into lots (infill.ts). The ground is
//                 then cut round these parcels like any footprint.
//   generateCity  after the ground. Every parcel gets its building (plan.ts: profile by the blend weights of
//                 blend.ts, floors, type, roof, colour, wear, then the variety rule), a shell (shellgen.ts) and the
//                 facade module placements of its visible walls (facade.ts), held to the placement budget of a tile.
//
// Precedence on any square metre: road, landmark zone, blueprint, generator. Every pick is seeded from the world tile
// of the parcel and its id; nothing reads another tile's picks, so a rebake gives the same city and a change to one
// parcel changes only the tiles it touches. Pure: files are read and written by tools/bake/sources/areastage.ts.
import type { P2 } from '../geom.ts';
import { ringArea, ringCentroid } from '../geom.ts';
import type { GraphFootprint } from '../graph/build.ts';
import { TILE_M, tileId, tileOf } from '../layout/grid.ts';
import { PLACEMENT_BYTES } from '../tile/tilesout.ts';
import { clearFootprints, faceIndex, onRoadM2, roadFace } from '../repair/clear.ts';
import { AreaSampler, transect } from './blend.ts';
import type { Transect, Weight } from './blend.ts';
import { applyBlueprints } from './blueprints.ts';
import type { Blueprint, BlueprintLine } from './blueprints.ts';
import { facadeOf } from './facade.ts';
import type { Exposure, FacadeInstance } from './facade.ts';
import { infillLots } from './infill.ts';
import type { InfillResult } from './infill.ts';
import { checkFootprints } from './oddshapes.ts';
import type { OddResult } from './oddshapes.ts';
import { FLOOR_M, TYPES, applyVariety, draftParcel, finishParcel, shareFloors, signature } from './plan.ts';
import type { BuildingPlan, Draft, PlanFootprint } from './plan.ts';
import { buildIndex } from './profiles.ts';
import type { AreaData } from './profiles.ts';
import { buildShell } from './shellgen.ts';
import type { GenShell, Wall } from './shellgen.ts';
import { F_DECK, F_OPEN, F_OUT, F_ROAD, F_WALK, F_WATER, F_ZONE, FlagRaster, RingIndex, ringBox, ringGap } from './space.ts';
import { allViews } from './views.ts';
import type { ProfileView } from './views.ts';

/** Placement bytes of one tile at most (TECH.md: about 0.6 MB per dense tile; tile/tilesout.ts checks the written arrays). */
export const PLACEMENT_BUDGET_BYTES = PLACEMENT_BYTES;
/** Bytes of one instance in a tile: twelve float32 and one uint32. */
export const INSTANCE_BYTES = 52;
/** Header bytes a module's entry costs, about. */
export const MODULE_HEADER_BYTES = 96;

export interface ParcelInput {
  footprints: readonly GraphFootprint[];
  data: AreaData;
  /** [lon, lat] to block metres (the frame of the footprints). */
  project: (lon: number, lat: number) => P2;
  blueprints: readonly Blueprint[];
  /** Footprint ids checked against photos (never regularised). */
  keep: ReadonlySet<string>;
  /** Road faces the ground meets, and every road face (also the decks). */
  roadFaces: readonly (readonly P2[])[];
  allFaces: readonly (readonly P2[])[];
  edges: readonly { id: string; pts: readonly P2[]; width: number; cls: string }[];
  rail: readonly (readonly P2[])[];
  water: readonly (readonly P2[])[];
  open: readonly (readonly P2[])[];
  walk: readonly (readonly P2[])[];
  /** Footways, paths and steps drawn as lines, with their width; and drains and canals drawn as lines. No lot stands on them. */
  walkLines: readonly { pts: readonly P2[]; width: number }[];
  waterLines: readonly (readonly P2[])[];
  /** Landmark zones and pads: left out. */
  zones: readonly (readonly P2[])[];
  outline: readonly P2[];
  /** Block metres to world metres. */
  offset: P2;
}

export interface ParcelLine {
  id: string;
  action: 'lot' | 'not_a_shape';
  detail: string;
  x: number;
  z: number;
}

export interface ParcelPlan {
  input: ParcelInput;
  footprints: GraphFootprint[];
  sampler: AreaSampler;
  views: Map<string, ProfileView>;
  raster: FlagRaster;
  odd: OddResult<GraphFootprint>;
  blueprint: { lines: BlueprintLine[]; blocks: number; replaced: number };
  infill: InfillResult;
  counts: { in: number; out: number; blueprintBlocks: number; replacedByBlueprint: number; dropped: number; regularised: number; flagged: number; lots: number };
  ms: Record<string, number>;
}

/** Road classes that make a seam for the blend band. */
const SEAM_CLASS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);
const now = (): number => (globalThis as unknown as { performance: { now(): number } }).performance.now();

/** Part one: the parcels. */
export function planParcels(input: ParcelInput): ParcelPlan {
  const ms: Record<string, number> = {};
  let t = now();
  const lap = (k: string): void => {
    const n = now();
    ms[k] = Math.round(n - t);
    t = n;
  };
  const index = buildIndex(input.data, input.project);
  const sampler = new AreaSampler(index, [...input.edges.filter((e) => SEAM_CLASS.has(e.cls) || e.width >= 9).map((e) => e.pts), ...input.rail]);
  const views = allViews(input.data);
  // the flag raster of the stage
  let box = ringBox(input.outline);
  box = { minX: box.minX - 60, minZ: box.minZ - 60, maxX: box.maxX + 60, maxZ: box.maxZ + 60 };
  const raster = new FlagRaster(box, 1);
  for (const r of input.allFaces) raster.fill(r, F_DECK);
  for (const r of input.roadFaces) raster.fill(r, F_ROAD);
  for (const r of input.water) raster.fill(r, F_WATER);
  for (const r of input.open) raster.fill(r, F_OPEN);
  for (const r of input.walk) raster.fill(r, F_WALK);
  for (const r of input.zones) raster.fill(r, F_ZONE);
  // lines with a width: a footway between two houses stays open, a lot keeps off the rail and off a drain
  const strip = (pts: readonly P2[], half: number, flag: number): void => {
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k] as P2;
      const b = pts[k + 1] as P2;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len < 1e-6) continue;
      const nx = ((b.z - a.z) / len) * half;
      const nz = (-(b.x - a.x) / len) * half;
      raster.fill([{ x: a.x + nx, z: a.z + nz }, { x: b.x + nx, z: b.z + nz }, { x: b.x - nx, z: b.z - nz }, { x: a.x - nx, z: a.z - nz }], flag);
    }
  };
  for (const w of input.walkLines) strip(w.pts, Math.max(1, w.width / 2 + 0.5), F_WALK);
  for (const r of input.rail) strip(r, 3, F_OPEN);
  for (const w of input.waterLines) strip(w, 3, F_WATER);
  raster.outside(input.outline, F_OUT);
  const faces = faceIndex(input.roadFaces.map((r) => roadFace(r)));
  const onRoad = (ring: readonly P2[]): number => onRoadM2(ring, faces);
  lap('index');

  // blueprints over the map footprints
  const bp = applyBlueprints<GraphFootprint>({
    footprints: input.footprints, blueprints: input.blueprints, project: input.project, inZone: (x, z) => (raster.at(x, z) & F_ZONE) !== 0,
    offRoad: (f) => clearFootprints([f as GraphFootprint], faces).footprints,
  });
  lap('blueprints');

  // odd outlines
  const before = new RingIndex();
  for (const f of bp.footprints) before.add({ id: f.id, ring: f.ring, box: ringBox(f.ring) });
  const dominant = (x: number, z: number): ProfileView | null => {
    let best: Weight | null = null;
    for (const w of sampler.weightsAt(x, z)) if (!best || w.w > best.w) best = w;
    return best ? (views.get(best.key) ?? null) : null;
  };
  const odd = checkFootprints<GraphFootprint>({ footprints: bp.footprints as GraphFootprint[], keep: input.keep, onRoad, tallFloors: (x, z) => dominant(x, z)?.floors.p90 ?? 8, index: before });
  lap('odd');

  // lots in the holes of street rows
  const after = new RingIndex();
  for (const f of odd.footprints) after.add({ id: f.id, ring: f.ring, box: ringBox(f.ring) });
  const cache = new Map<number, ProfileView | null>();
  const viewAt = (x: number, z: number): ProfileView | null => {
    const k = (Math.floor(x / 8) + 32768) * 65536 + (Math.floor(z / 8) + 32768);
    let v = cache.get(k);
    if (v === undefined) cache.set(k, (v = dominant((Math.floor(x / 8) + 0.5) * 8, (Math.floor(z / 8) + 0.5) * 8)));
    return v;
  };
  const infill = infillLots({ edges: input.edges.filter((e) => e.cls !== 'footway' && e.cls !== 'path' && e.cls !== 'steps' && e.cls !== 'cycleway'), raster, index: after, viewAt, onRoad, tileOf: (x, z) => tileOf(x + input.offset.x, z + input.offset.z) });
  lap('infill');
  const lots: GraphFootprint[] = infill.lots.map((l) => ({ id: l.id, source: 'generator', ring: l.ring, area: l.area, height: null, levels: null, tags: { building: 'yes', 'gen:origin': 'infill', 'gen:profile': l.profile } }));
  const footprints = [...odd.footprints, ...lots].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    input, footprints, sampler, views, raster, odd, blueprint: { lines: bp.lines, blocks: bp.blocks, replaced: bp.replaced }, infill,
    counts: { in: input.footprints.length, out: footprints.length, blueprintBlocks: bp.blocks, replacedByBlueprint: bp.replaced, dropped: odd.counts.dropped, regularised: odd.counts.regularised, flagged: odd.counts.flagged, lots: lots.length },
    ms,
  };
}

// ------------------------------------------------------------------ part two

export interface TilePlacements {
  /** Module id, the transforms (twelve numbers per instance, world metres) and the custom data (one per instance). */
  list: { module: string; xforms: number[]; data: number[] }[];
  instances: number;
  bytes: number;
  /** Instances left out to stay inside the budget, by class. */
  trimmed: number;
}

export interface ProfileStats {
  key: string;
  /** Shells that follow the profile. */
  shells: number;
  /** Shells whose footprint can carry the profile's tallest draw, and their histogram's distance to the profile (bigger footprints lean taller, so this one is not the check). */
  free: number;
  distance: number;
  /** Shells the profile drew floors for, their histogram (index = floors) and its distance to the profile: half the sum of the absolute differences of shares (0 the same). */
  drawn: number;
  histogram: number[];
  distanceAll: number;
  /**
   * The histogram in the profile's own classes (up to p10, up to p50, up to p90, over p90): the largest difference
   * between a class's share and the profile's (0 to 1). This is the check: each class within 10 points.
   */
  classDiff: number;
  classes: { drawn: number[]; profile: number[] };
  /** Draws held down by a footprint too small to carry them. */
  capped: number;
  p10: number;
  p50: number;
  p90: number;
  /** Types with their shares, the largest first. */
  types: [string, number][];
  topType: string;
  topShare: number;
  /** The largest share the profile's own mix asks for. */
  mixTop: number;
  entropyBits: number;
}

export interface CityStats {
  parcels: number;
  shells: number;
  notAShape: number;
  byFrom: Record<string, number>;
  byRoof: Record<string, number>;
  byProfileKind: Record<string, number>;
  /** OSM tagged buildings: how many, and the largest difference between the shell and the tag in floors. */
  tagged: number;
  tagMaxFloorDiff: number;
  tagOverOne: number;
  profiles: ProfileStats[];
  variety: { pairs: number; sameInTile: number; sameAcrossTiles: number; varied: number; stuck: number };
  placements: { instances: number; tiles: number; bytes: number; largest: { id: string; bytes: number; instances: number } | null; trimmed: number; overBudget: string[]; modules: number; byClass: [number, number, number]; exposure: Record<Exposure, number> };
  triangles: number;
  ms: Record<string, number>;
}

export interface CityResult {
  shells: GenShell[];
  plans: Map<string, BuildingPlan>;
  placements: Map<string, TilePlacements>;
  lines: ParcelLine[];
  stats: CityStats;
}

const r2 = (v: number): number => Math.round(v * 100) / 100 + 0;

/** Part two: buildings, shells and facade placements on the solved ground. */
export function generateCity(plan: ParcelPlan, ground: (x: number, z: number) => number, fallback: (x: number, z: number) => number): CityResult {
  const ms: Record<string, number> = {};
  let t = now();
  const lap = (k: string): void => {
    const n = now();
    ms[k] = Math.round(n - t);
    t = n;
  };
  const { sampler, views, raster } = plan;
  const off = plan.input.offset;
  const fallbackView = views.get('rule:mixed_midrise') ?? ([...views.values()].find((v) => v.mix.length > 0) as ProfileView);
  // parcels with their tile
  const parcels: (PlanFootprint & { box: ReturnType<typeof ringBox> })[] = plan.footprints.map((f) => {
    const centre = ringCentroid(f.ring);
    const w = tileOf(centre.x + off.x, centre.z + off.z);
    return { id: f.id, source: f.source, ring: f.ring, area: Math.abs(ringArea(f.ring)), centre, height: f.height, levels: f.levels, tags: f.tags, tx: w.tx, tz: w.tz, box: ringBox(f.ring) };
  });
  const index = new RingIndex<(typeof parcels)[number]>();
  for (const p of parcels) index.add(p);
  // plans: the profile of each parcel, the floor draws shared out tile by tile, then the rest
  const draftsBy = new Map<string, { tx: number; tz: number; list: Draft[] }>();
  const drafts: Draft[] = [];
  for (const p of parcels) {
    const d = draftParcel(p, sampler.weightsAt(p.centre.x, p.centre.z), views, fallbackView);
    drafts.push(d);
    const id = tileId(p.tx, p.tz);
    let g = draftsBy.get(id);
    if (!g) draftsBy.set(id, (g = { tx: p.tx, tz: p.tz, list: [] }));
    g.list.push(d);
  }
  for (const g of draftsBy.values()) shareFloors(g, g.list);
  const plans = new Map<string, BuildingPlan>();
  for (const d of drafts) plans.set(d.f.id, finishParcel(d));
  lap('plan');
  // who stands beside whom (walls within a metre)
  const beside = new Map<string, string[]>();
  const pairs: [string, string, boolean][] = [];
  for (const p of parcels) {
    for (const q of index.near(p.box, 1)) {
      if (q.id <= p.id) continue;
      if (ringGap(p.ring, q.ring, 1) > 1) continue;
      const same = p.tx === q.tx && p.tz === q.tz;
      pairs.push([p.id, q.id, same]);
      if (!same) continue;
      let a = beside.get(p.id);
      if (!a) beside.set(p.id, (a = []));
      a.push(q.id);
      let b = beside.get(q.id);
      if (!b) beside.set(q.id, (b = []));
      b.push(p.id);
    }
  }
  const byTile = new Map<string, { tx: number; tz: number; list: BuildingPlan[] }>();
  for (const p of parcels) {
    const id = tileId(p.tx, p.tz);
    let g = byTile.get(id);
    if (!g) byTile.set(id, (g = { tx: p.tx, tz: p.tz, list: [] }));
    g.list.push(plans.get(p.id) as BuildingPlan);
  }
  const variety = { pairs: pairs.length, sameInTile: 0, sameAcrossTiles: 0, varied: 0, stuck: 0 };
  for (const g of byTile.values()) {
    const v = applyVariety(g, g.list, beside, views);
    variety.varied += v.varied;
    variety.stuck += v.stuck;
  }
  for (const [a, b, same] of pairs) {
    if (signature(plans.get(a) as BuildingPlan) !== signature(plans.get(b) as BuildingPlan)) continue;
    if (same) variety.sameInTile++;
    else variety.sameAcrossTiles++;
  }
  lap('variety');

  // shells
  const shells: GenShell[] = [];
  const lines: ParcelLine[] = [];
  const shellOf = new Map<string, GenShell>();
  let triangles = 0;
  for (const p of parcels) {
    const bp = plans.get(p.id) as BuildingPlan;
    const sh = buildShell(p.id, p.ring, bp, TYPES[bp.type].bayM, ground, fallback);
    if (!sh) {
      lines.push({ id: p.id, action: 'not_a_shape', detail: 'under three corners or under 1 m2: no shell', x: r2(p.centre.x), z: r2(p.centre.z) });
      continue;
    }
    shells.push(sh);
    shellOf.set(p.id, sh);
    triangles += sh.tris.length / 9;
  }
  lap('shells');

  // facade placements: what each wall looks on
  const exposureCount: Record<Exposure, number> = { street: 0, open: 0, hidden: 0 };
  const perTile = new Map<string, FacadeInstance[]>();
  for (const p of parcels) {
    const sh = shellOf.get(p.id);
    if (!sh) continue;
    const bp = plans.get(p.id) as BuildingPlan;
    const look = (w: Wall): Exposure => {
      let best: Exposure = 'hidden';
      for (const s of w.len > 10 ? [0.5, 0.2, 0.8] : [0.5]) {
        const mx = w.ax + (w.bx - w.ax) * s;
        const mz = w.az + (w.bz - w.az) * s;
        let got: Exposure = 'open';
        for (let d = 1; d <= 28; d += 1.5) {
          const x = mx + w.nx * d;
          const z = mz + w.nz * d;
          const flags = raster.at(x, z);
          if (flags & F_ROAD) {
            got = 'street';
            break;
          }
          if (flags & F_OUT) break;
          if (index.hit(x, z)) {
            got = d >= 6 ? 'open' : 'hidden';
            break;
          }
        }
        if (got === 'street') {
          best = 'street';
          break;
        }
        if (got === 'open') best = 'open';
      }
      exposureCount[best]++;
      return best;
    };
    const inst = facadeOf(sh, bp, views.get(bp.profile), TYPES[bp.type], look, p);
    for (const i of inst) {
      // an instance goes to the tile it stands in; where that tile holds no building (the stage's edge), to its building's
      const w = tileOf((i.xform[3] as number) + off.x, (i.xform[11] as number) + off.z);
      const id = byTile.has(tileId(w.tx, w.tz)) ? tileId(w.tx, w.tz) : tileId(p.tx, p.tz);
      let list = perTile.get(id);
      if (!list) perTile.set(id, (list = []));
      list.push(i);
    }
  }
  lap('facade');
  // the budget of a tile, then the packed lists
  const placements = new Map<string, TilePlacements>();
  const pstats: CityStats['placements'] = { instances: 0, tiles: 0, bytes: 0, largest: null, trimmed: 0, overBudget: [], modules: 0, byClass: [0, 0, 0], exposure: exposureCount };
  const modulesSeen = new Set<string>();
  for (const id of [...perTile.keys()].sort()) {
    let list = perTile.get(id) as FacadeInstance[];
    const bytesOf = (l: readonly FacadeInstance[]): number => l.length * INSTANCE_BYTES + new Set(l.map((i) => i.module)).size * MODULE_HEADER_BYTES;
    let trimmed = 0;
    // over the budget: the upper floors on open ground go first, then the parapets, then upper floors from the top
    if (bytesOf(list) > PLACEMENT_BUDGET_BYTES) {
      const keep = list.filter((i) => i.cls !== 2);
      trimmed += list.length - keep.length;
      list = keep;
    }
    if (bytesOf(list) > PLACEMENT_BUDGET_BYTES) {
      const keep = list.filter((i) => !i.module.endsWith('.roof_parapet'));
      trimmed += list.length - keep.length;
      list = keep;
    }
    if (bytesOf(list) > PLACEMENT_BUDGET_BYTES) {
      // the highest instances first, until it fits
      const order = list.map((i, k) => ({ i, k })).sort((a, b) => a.i.cls - b.i.cls || (a.i.xform[7] as number) - (b.i.xform[7] as number) || a.k - b.k);
      const room = Math.floor((PLACEMENT_BUDGET_BYTES - new Set(list.map((i) => i.module)).size * MODULE_HEADER_BYTES) / INSTANCE_BYTES);
      const kept = order.slice(0, Math.max(0, room)).sort((a, b) => a.k - b.k).map((o) => o.i);
      trimmed += list.length - kept.length;
      list = kept;
    }
    const by = new Map<string, { module: string; xforms: number[]; data: number[] }>();
    for (const i of list) {
      let m = by.get(i.module);
      if (!m) by.set(i.module, (m = { module: i.module, xforms: [], data: [] }));
      for (let k = 0; k < 12; k++) m.xforms.push((i.xform[k] as number) + (k === 3 ? off.x : k === 11 ? off.z : 0));
      m.data.push(i.data);
      pstats.byClass[i.cls]++;
      modulesSeen.add(i.module);
    }
    const packed = [...by.values()].sort((a, b) => (a.module < b.module ? -1 : 1));
    const bytes = bytesOf(list);
    placements.set(id, { list: packed, instances: list.length, bytes, trimmed });
    pstats.instances += list.length;
    pstats.tiles++;
    pstats.bytes += bytes;
    pstats.trimmed += trimmed;
    if (bytes > PLACEMENT_BUDGET_BYTES) pstats.overBudget.push(id);
    if (!pstats.largest || bytes > pstats.largest.bytes) pstats.largest = { id, bytes, instances: list.length };
  }
  pstats.modules = modulesSeen.size;
  lap('budget');

  // statistics
  const byFrom: Record<string, number> = {};
  const byRoof: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  let tagged = 0;
  let tagMax = 0;
  let tagOver = 0;
  const per = new Map<string, { shells: number; free: number[]; all: number[]; capped: number; types: Map<string, number> }>();
  for (const p of parcels) {
    const sh = shellOf.get(p.id);
    if (!sh) continue;
    const bp = plans.get(p.id) as BuildingPlan;
    byFrom[bp.from] = (byFrom[bp.from] ?? 0) + 1;
    byRoof[bp.roof] = (byRoof[bp.roof] ?? 0) + 1;
    byKind[bp.profile.split(':')[0] as string] = (byKind[bp.profile.split(':')[0] as string] ?? 0) + 1;
    if (bp.from === 'height' || bp.from === 'levels') {
      tagged++;
      const tagFloors = (bp.from === 'levels' ? (p.levels as number) * FLOOR_M : Math.min(200, p.height as number)) / FLOOR_M;
      const diff = Math.abs((sh.roofY - sh.groundY) / FLOOR_M - tagFloors);
      tagMax = Math.max(tagMax, diff);
      if (diff > 1) tagOver++;
    }
    let s = per.get(bp.profile);
    if (!s) per.set(bp.profile, (s = { shells: 0, free: [], all: [], capped: 0, types: new Map() }));
    s.shells++;
    s.types.set(bp.type, (s.types.get(bp.type) ?? 0) + 1);
    if (bp.from === 'profile') {
      const view = views.get(bp.profile) as ProfileView;
      s.all.push(bp.floors);
      if (bp.capped) s.capped++;
      if (bp.cap >= view.pmf.length - 1) s.free.push(bp.floors);
    }
  }
  const profiles: ProfileStats[] = [];
  for (const key of [...per.keys()].sort()) {
    const s = per.get(key) as { shells: number; free: number[]; all: number[]; capped: number; types: Map<string, number> };
    const view = views.get(key) as ProfileView;
    const hist = (list: readonly number[]): number[] => {
      const h: number[] = [];
      for (const f of list) {
        while (h.length <= f) h.push(0);
        h[f]!++;
      }
      return h;
    };
    const dist = (list: readonly number[]): number => {
      if (!list.length) return 0;
      const h = hist(list);
      let d = 0;
      for (let k = 0; k < Math.max(h.length, view.pmf.length); k++) d += Math.abs((h[k] ?? 0) / list.length - (view.pmf[k] ?? 0));
      return Math.round((d / 2) * 1000) / 1000;
    };
    const cls = (f: number): number => (f <= view.floors.p10 ? 0 : f <= view.floors.p50 ? 1 : f <= view.floors.p90 ? 2 : 3);
    const drawnCls = [0, 0, 0, 0];
    for (const f of s.all) drawnCls[cls(f)]!++;
    const profCls = [0, 0, 0, 0];
    view.pmf.forEach((w, f) => {
      if (f > 0) profCls[cls(f)]! += w;
    });
    const r3 = (v: number): number => Math.round(v * 1000) / 1000;
    const classes = { drawn: drawnCls.map((n) => r3(s.all.length ? n / s.all.length : 0)), profile: profCls.map(r3) };
    const classDiff = s.all.length ? Math.max(...classes.drawn.map((v, k) => Math.abs(v - (classes.profile[k] as number)))) : 0;
    const sorted = s.all.slice().sort((a, b) => a - b);
    const q = (u: number): number => (sorted.length ? (sorted[Math.min(sorted.length - 1, Math.floor(u * sorted.length))] as number) : 0);
    const types = [...s.types.entries()].map(([k, n]) => [k, Math.round((n / s.shells) * 1000) / 1000] as [string, number]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    let entropy = 0;
    for (const n of s.types.values()) entropy -= (n / s.shells) * Math.log2(n / s.shells);
    profiles.push({
      key, shells: s.shells, free: s.free.length, distance: dist(s.free), drawn: s.all.length, histogram: hist(s.all), distanceAll: dist(s.all), classDiff: r3(classDiff), classes, capped: s.capped, p10: q(0.1), p50: q(0.5), p90: q(0.9),
      types, topType: types[0]?.[0] ?? '', topShare: types[0]?.[1] ?? 0, mixTop: view.mix.reduce((m, [, w]) => Math.max(m, w), 0), entropyBits: Math.round(entropy * 100) / 100,
    });
  }
  lap('stats');
  return {
    shells, plans, placements, lines,
    stats: { parcels: parcels.length, shells: shells.length, notAShape: lines.length, byFrom, byRoof, byProfileKind: byKind, tagged, tagMaxFloorDiff: Math.round(tagMax * 100) / 100, tagOverOne: tagOver, profiles, variety, placements: pstats, triangles, ms },
  };
}

/** Transects for the edge blend test: from `inside` (a point well inside a drawn area) to `outside`. */
export function blendTransects(plan: ParcelPlan, lines: readonly { id: string; name: string; area: string; a: P2; b: P2 }[]): Transect[] {
  return lines.map((l) => transect(plan.sampler, l.id, l.name, l.area, l.a, l.b));
}

export { TILE_M };
