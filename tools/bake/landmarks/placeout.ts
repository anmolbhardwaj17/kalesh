// What the landmark placement hands on (P2-006): the pad check on the built ground, the pins, the landmark file of
// the tile folder (the LOD slots and far silhouettes the streaming system reads), the record for the health report,
// the log lines and the invariants. Pure; tools/bake/sources/landmarkstage.ts writes the files.
import type { P2 } from '../geom.ts';
import { pointInRing, ringCentroid } from '../geom.ts';
import { tileIdAt } from '../layout/grid.ts';
import type { InvariantResult } from '../report/health.ts';
import type { Ground } from '../terrain/build.ts';
import type { WorldPin } from '../tile/write.ts';
import type { KitInput } from './kit.ts';
import type { MassingRecord, Silhouette } from './massing.ts';
import type { FarPlacement, PlaceResult, Placement } from './place.ts';

/** A pad is flat within this (m) and meets the ground around it within the gap limit (the task's acceptance). */
export const PAD_FLAT_M = 0.05;
export const PAD_GAP_M = 0.02;

export interface PadCheck {
  landmark: string;
  level: number;
  triangles: number;
  areaM2: number;
  /** Share of the pad ring's area that the pad triangles cover. */
  covered: number;
  /** Largest distance of a pad corner from the level (m). */
  offLevelM: number;
  /** Largest height difference between the triangles that meet at a vertex of the pad (m): the gap to the ground around it. */
  gapM: number;
}

/** Every pad of the built ground: how flat it is and how it meets the ground around it. */
export function checkPads(g: Pick<Ground, 'tg' | 'surface'>): PadCheck[] {
  const s = g.surface;
  const { vx, vz } = g.tg;
  const nv = vx.length;
  const ne = s.cls.length;
  const lo = new Float64Array(nv).fill(Infinity);
  const hi = new Float64Array(nv).fill(-Infinity);
  for (let e = 0; e < ne; e++) {
    for (let i = 0; i < 3; i++) {
      const v = s.tri[e * 3 + i] as number;
      const y = s.cy[e * 3 + i] as number;
      if (y < (lo[v] as number)) lo[v] = y;
      if (y > (hi[v] as number)) hi[v] = y;
    }
  }
  const by = new Map<number, PadCheck>();
  s.pieces.forEach((p, gi) => {
    if (p.cls === 'pad') by.set(gi, { landmark: p.landmark, level: p.level as number, triangles: 0, areaM2: 0, covered: 0, offLevelM: 0, gapM: 0 });
  });
  for (let e = 0; e < ne; e++) {
    const c = by.get(s.over[e] as number);
    if (!c) continue;
    const [a, b, d] = [s.tri[e * 3] as number, s.tri[e * 3 + 1] as number, s.tri[e * 3 + 2] as number];
    c.triangles++;
    c.areaM2 += Math.abs(((vx[b] as number) - (vx[a] as number)) * ((vz[d] as number) - (vz[a] as number)) - ((vz[b] as number) - (vz[a] as number)) * ((vx[d] as number) - (vx[a] as number))) / 2;
    for (let i = 0; i < 3; i++) {
      const v = s.tri[e * 3 + i] as number;
      c.offLevelM = Math.max(c.offLevelM, Math.abs((s.cy[e * 3 + i] as number) - c.level));
      c.gapM = Math.max(c.gapM, (hi[v] as number) - (lo[v] as number));
    }
  }
  const out: PadCheck[] = [];
  s.pieces.forEach((p, gi) => {
    const c = by.get(gi);
    if (!c) return;
    let ring = 0;
    for (let k = 0; k < p.ring.length; k++) {
      const a = p.ring[k] as P2;
      const b = p.ring[(k + 1) % p.ring.length] as P2;
      ring += a.x * b.z - b.x * a.z;
    }
    c.covered = Math.round((c.areaM2 / Math.max(1e-6, Math.abs(ring) / 2)) * 1000) / 1000;
    c.areaM2 = Math.round(c.areaM2 * 10) / 10;
    c.offLevelM = Math.round(c.offLevelM * 10000) / 10000;
    c.gapM = Math.round(c.gapM * 10000) / 10000;
    out.push(c);
  });
  return out;
}

/** Plain buildings (the footprints that stay) whose centre lies in a landmark zone: must be none. */
export function buildingsInZones(placements: readonly Placement[], footprints: readonly { id: string; ring: readonly P2[] }[]): { id: string; landmark: string }[] {
  const zones = placements.filter((p) => p.zone).map((p) => {
    const ring = (p.zone as NonNullable<Placement['zone']>).ring;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const q of ring) {
      x0 = Math.min(x0, q.x);
      x1 = Math.max(x1, q.x);
      z0 = Math.min(z0, q.z);
      z1 = Math.max(z1, q.z);
    }
    return { id: p.id, ring, x0, x1, z0, z1 };
  });
  const out: { id: string; landmark: string }[] = [];
  for (const f of footprints) {
    if (f.ring.length < 3) continue;
    const c = ringCentroid(f.ring as P2[]);
    for (const z of zones) {
      if (c.x < z.x0 || c.x > z.x1 || c.z < z.z0 || c.z > z.z1 || !pointInRing(c, z.ring)) continue;
      out.push({ id: f.id, landmark: z.id });
      break;
    }
  }
  return out;
}

/** The pins of the placed landmarks: world metres, on the pad or the solved ground. */
export function landmarkPins(placements: readonly Placement[], yOf: (p: Placement) => number): WorldPin[] {
  return placements.map((p) => ({
    id: `lm:${p.id}`, name: p.name, kind: 'landmark', x: p.wx, y: yOf(p), z: p.wz,
    extra: { tier: p.tier, mode: p.mode, ...(p.yawDeg !== null ? { yaw: p.yawDeg } : {}), ...(p.heightM !== null ? { height: p.heightM } : {}), ...(p.underground ? { underground: true } : {}), ...(p.worship ? { worship: true } : {}) },
  }));
}

export interface LandmarkFile {
  _doc: string;
  version: 1;
  stage: string;
  block: string;
  limits: { heroesAtFullDetailInView: number; farSilhouetteTriangles: number; heroLods: number };
  landmarks: {
    id: string; name: string; tier: string; mode: string; pos: [number, number, number]; yaw: number | null; height: number | null; tile: string; underground: boolean; worship: boolean;
    lod: Placement['lod']; massing: { triangles: number; heightM: number } | null; silhouette: number | null;
    /** The parts kit's inputs (P2-007, kit.ts): metres from pos; null when the tile massing is its build. */
    kit: KitInput | null;
    /** The landmark whose kit builds this one too (a fort's gate placed on its own), else null. */
    builtBy: string | null;
  }[];
  far: { id: string; name: string; tier: string; pos: [number, number, number]; bearing: number; distance: number; realDistance: number; height: number | null; reachable: false; nav: false; silhouette: number }[];
  silhouettes: Silhouette[];
}

export function landmarkFile(stage: string, block: string, res: PlaceResult, heroLods: number, yOf: (p: Placement) => number, farY: number, massing: readonly MassingRecord[], silhouettes: readonly Silhouette[], kit: ReadonlyMap<string, KitInput> = new Map(), builtBy: ReadonlyMap<string, string> = new Map()): LandmarkFile {
  const mass = new Map(massing.map((m) => [m.id, m]));
  const sil = new Map(silhouettes.map((s, i) => [s.id, i]));
  return {
    _doc: 'Landmarks of the tile folder (P2-006, tools/bake/landmarks/): where each one stands (world metres, yaw is the compass bearing its front faces), its LOD slots and, for a hero and a far landmark, the index of its far silhouette. limits.heroesAtFullDetailInView is the cap the streaming system keeps (game/world/landmark_slots.gd). A far landmark stands on the backdrop on its real bearing: never reachable, never a map destination. Stand-in massing fills LOD 0 in the tiles (material `landmark`) for every landmark without a kit recipe; one with `kit` is built by the parts kit in the game (game/world/landmarks/, P2-007) from those inputs (metres from pos), and a delivered hero model replaces it by id.',
    version: 1, stage, block, limits: { ...res.limits, heroLods },
    landmarks: res.placements.map((p) => {
      const m = mass.get(p.id);
      return {
        id: p.id, name: p.name, tier: p.tier, mode: p.mode, pos: [p.wx, yOf(p), p.wz], yaw: p.yawDeg, height: p.heightM, tile: tileIdAt(p.wx, p.wz), underground: p.underground, worship: p.worship,
        lod: p.lod, massing: m ? { triangles: m.triangles, heightM: m.heightM } : null, silhouette: sil.get(p.id) ?? null,
        kit: kit.get(p.id) ?? null,
        builtBy: builtBy.get(p.id) ?? null,
      };
    }),
    far: res.far.map((f: FarPlacement) => ({ id: f.id, name: f.name, tier: f.tier, pos: [f.wx, farY, f.wz], bearing: f.worldBearingDeg, distance: f.worldDistanceM, realDistance: f.distanceM, height: f.heightM, reachable: false as const, nav: false as const, silhouette: sil.get(f.id) as number })),
    silhouettes: [...silhouettes],
  };
}

export interface LandmarksRecord {
  registryStage: string;
  entries: number;
  stats: PlaceResult['stats'];
  heroes: { id: string; mode: string; x: number; z: number; yawDeg: number | null; yawSource: string; pad: { areaM2: number; level: number; cutFillM: number; clipped: boolean } | null; zoneM2: number; replaced: number; parts: number; surroundings: Record<string, number>; massingHeightM: number }[];
  skipped: PlaceResult['skipped'];
  far: { id: string; bearingDeg: number; worldBearingDeg: number; worldDistanceM: number; distanceM: number; blockPlanned: string; movedOutM: number }[];
  buildingsInZones: number;
  pads?: { count: number; maxOffLevelM: number; maxGapM: number; minCovered: number; worst: PadCheck[]; pinnedByRoad: number };
  ground?: Record<string, number>;
  massing?: { triangles: number; landmarks: number; largest: { id: string; triangles: number } | null; overBudget: string[] };
  silhouettes?: { count: number; maxTriangles: number; budget: number };
  pins?: number;
  files: Record<string, string | string[]>;
  ms: number;
}

export function placeRecord(registryStage: string, entries: number, res: PlaceResult, inZones: number, files: LandmarksRecord['files'], ms: number): LandmarksRecord {
  return {
    registryStage, entries, stats: res.stats,
    heroes: res.placements.filter((p) => p.tier === 'hero').map((p) => {
      const sur: Record<string, number> = {};
      for (const s of p.surroundings) sur[s.kind] = (sur[s.kind] ?? 0) + 1;
      return { id: p.id, mode: p.mode, x: p.wx, z: p.wz, yawDeg: p.yawDeg, yawSource: p.yawSource, pad: p.pad ? { areaM2: p.pad.areaM2, level: p.pad.level, cutFillM: p.pad.cutFillM, clipped: p.pad.clipped } : null, zoneM2: p.zone?.areaM2 ?? 0, replaced: p.replaced, parts: p.parts, surroundings: sur, massingHeightM: p.massingHeightM };
    }),
    skipped: res.skipped,
    far: res.far.map((f) => ({ id: f.id, bearingDeg: f.bearingDeg, worldBearingDeg: f.worldBearingDeg, worldDistanceM: f.worldDistanceM, distanceM: f.distanceM, blockPlanned: f.blockPlanned, movedOutM: f.movedOutM })),
    buildingsInZones: inZones, files, ms,
  };
}

export function placeLog(r: LandmarksRecord): string[] {
  const s = r.stats;
  const out = [
    `placed ${s.placed} of ${r.entries} registry entries (hero ${s.byTier.hero}, signature ${s.byTier.signature}, marker ${s.byTier.marker}): ${s.byMode.structure} structures, ${s.byMode.site} sites, ${s.byMode.point} pins only (no footprint, or underground: no shell, no pad); ${s.skipped} not placed (held or no OSM object); ${s.far} far`,
    `pads ${s.pads} (${s.padM2} m2, ${s.clippedPads} cut back from a road or water, largest cut or fill ${s.maxCutFillM} m); zones ${s.zones} (${s.zoneM2} m2); buildings replaced ${s.replaced}, taken as parts ${s.parts}; plain buildings left in a zone ${r.buildingsInZones}; roads under a footprint ${s.roadCrossings}`,
    `surroundings: ${Object.entries(s.surroundings).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
  ];
  for (const h of r.heroes) out.push(`hero ${h.id}: ${h.mode} at world ${h.x}, ${h.z}, front ${h.yawDeg ?? 'unknown'} deg (${h.yawSource}); pad ${h.pad ? `${h.pad.areaM2} m2 at ${h.pad.level} m (cut or fill ${h.pad.cutFillM} m${h.pad.clipped ? ', cut back' : ''})` : 'none'}; zone ${Math.round(h.zoneM2)} m2; ${h.replaced} buildings replaced, ${h.parts} parts; ${Object.entries(h.surroundings).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  for (const f of r.far) out.push(`far ${f.id}: real bearing ${f.bearingDeg} deg at ${f.distanceM} m; on the backdrop at ${f.worldBearingDeg} deg, ${f.worldDistanceM} m (frame of ${f.blockPlanned}${f.movedOutM ? `, moved out ${f.movedOutM} m off the reachable tiles` : ''})`);
  return out;
}

export function massingLog(r: LandmarksRecord): string[] {
  const out: string[] = [];
  if (r.pads) out.push(`pads on the built ground: ${r.pads.count}, flat within ${r.pads.maxOffLevelM} m (limit ${PAD_FLAT_M}), largest gap to the ground around ${r.pads.maxGapM} m (limit ${PAD_GAP_M}), least covered ${r.pads.minCovered}; pad corners a road pin holds ${r.pads.pinnedByRoad}; ground triangles ${Object.entries(r.ground ?? {}).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  if (r.massing) out.push(`stand-in massing: ${r.massing.triangles} triangles for ${r.massing.landmarks} landmarks (largest ${r.massing.largest?.id ?? 'none'} ${r.massing.largest?.triangles ?? 0})${r.massing.overBudget.length ? `; over their LOD 0 slot: ${r.massing.overBudget.join(', ')}` : ''}; far silhouettes ${r.silhouettes?.count ?? 0}, at most ${r.silhouettes?.maxTriangles ?? 0} triangles (budget ${r.silhouettes?.budget ?? 0}); pins ${r.pins ?? 0}`);
  return out;
}

export function placeInvariants(r: LandmarksRecord, farInReach: string[]): InvariantResult[] {
  return [
    { id: 'LM-01.zones_clear', ok: r.buildingsInZones === 0, detail: `${r.buildingsInZones} plain buildings left inside a landmark zone (${r.stats.replaced} replaced and ${r.stats.parts} taken as parts, each in the log)` },
    { id: 'LM-03.far_unreachable', ok: farInReach.length === 0, detail: farInReach.length === 0 ? `${r.stats.far} far landmarks, none in or near a reachable tile (${r.stats.farMoved} moved outward)` : `far landmarks in a reachable tile: ${farInReach.join(', ')}` },
  ];
}

export function massingInvariants(r: LandmarksRecord): InvariantResult[] {
  const p = r.pads ?? { count: 0, maxOffLevelM: 0, maxGapM: 0, minCovered: 1, worst: [], pinnedByRoad: 0 };
  // a pad that holds smaller pads shares its ring with them: half of its ring is the least its own triangles cover
  const flat = p.maxOffLevelM <= PAD_FLAT_M && p.maxGapM <= PAD_GAP_M && p.count === r.stats.pads && p.minCovered >= 0.5;
  const sil = r.silhouettes ?? { count: 0, maxTriangles: 0, budget: 0 };
  return [
    { id: 'LM-02.pads_flat', ok: flat, detail: flat ? `${p.count} pads flat within ${p.maxOffLevelM} m and meeting the ground within ${p.maxGapM} m (limits ${PAD_FLAT_M} and ${PAD_GAP_M}), each covered ${p.minCovered} or more` : `${p.count} of ${r.stats.pads} pads on the ground; off level by up to ${p.maxOffLevelM} m, gap up to ${p.maxGapM} m, least covered ${p.minCovered}: ${p.worst.slice(0, 3).map((w) => `${w.landmark} off ${w.offLevelM} gap ${w.gapM} covered ${w.covered}`).join(', ')}` },
    { id: 'LM-04.lod_budgets', ok: sil.maxTriangles <= sil.budget, detail: `${sil.count} far silhouettes of at most ${sil.maxTriangles} triangles (budget ${sil.budget})` },
  ];
}
