// What the terrain step hands on (P1-015): the record for the health report with the acceptance numbers, the log
// lines and the invariants of the step, a hash of the tile meshes (the same input must give the same ground), the
// ground of a site box for the road bench scene with the camera poses that look at it, and a north-up picture. Pure.
import { hashText } from '../graph/checks.ts';
import type { SitePose } from '../mesh/meshout.ts';
import type { InvariantResult } from '../report/health.ts';
import type { MeshData } from '../tile.ts';
import { emitGround } from './build.ts';
import type { Ground } from './build.ts';
import type { TerrainChecks } from './checks.ts';
import { toUnits } from './predicates.ts';
import { C_GROUND, C_LAWN, C_PLOT, C_WATER } from './triangulate.ts';

/** The limits of the task (perf_budgets.json world.ground). */
export const GAP_LIMIT_M = 0.02;
export const NEEDLE_LIMIT = 0.02;
export const SEAM_LIMIT_M = 0.0001;
export const HOLE_LIMIT = 0.001;
export const BUILD_LIMIT_MS = 120000;

export interface TerrainRecord {
  hash: string;
  /** Wall time of one ground build and of its parts, and of the checks (ms). */
  buildMs: number;
  checksMs: number;
  ms: Record<string, number>;
  options: Ground['options'];
  counts: {
    points: number; vertices: number; triangles: number; emitted: number; byClass: Record<string, number>; tiles: number; drawTriangles: Record<string, number>;
    roadVertices: number; freeEdges: number; wallEdges: number; ringEdges: number; splitPoints: number; gridPoints: number; latticePoints: number; welded: number;
    pinned: number; wallVertices: number; stepVertices: number; stepCorners: number; unresolvedSteps: number; skirts: number; waters: number;
  };
  triangulation: Ground['tg']['stats'];
  heights: { maxOffsetM: number; wallClamped: number; underDeck: number; loweredUnderDeck: number; overTunnel: number; raisedOverTunnel: number };
  /** The gate counts of MAP_REPAIR.md "Verification" this step measures. */
  gates: { groundGapMaxM: number; groundAboveRoad: number; needleShare: number; seamMismatches: number; holeShare: number };
  gap: TerrainChecks['gap'];
  above: TerrainChecks['above'];
  needles: TerrainChecks['needles'];
  seams: TerrainChecks['seams'];
  area: TerrainChecks['area'];
  classes: TerrainChecks['classes'];
  /** Water bodies over 500 m2 (world metres), largest first. */
  waters: { level: number; areaM2: number; bankMinM: number; bankMaxM: number; x: number; z: number }[];
  files: Record<string, string | string[]>;
}

/** A hash of every tile mesh: positions to a tenth of a millimetre, normals to a thousandth, the indices. */
export function groundHash(g: Ground): string {
  let a = 0;
  let b = 0;
  let n = 0;
  const mix = (v: number): void => {
    n++;
    a = (a + v * ((n % 1000) + 1)) % 2147483647;
    b = (b * 31 + v) % 2147483629;
  };
  for (const t of g.tiles) {
    mix(t.tx * 1000 + t.tz);
    for (const m of t.meshes) {
      mix(m.material.length * 7 + m.material.charCodeAt(0));
      for (const p of m.pos) mix(Math.round(p * 10000));
      for (const p of m.nrm) mix(Math.round(p * 1000));
      for (const i of m.idx) mix(i);
    }
  }
  return hashText(`${g.tiles.length}:${n}:${a}:${b}`);
}

export function terrainRecord(g: Ground, checks: TerrainChecks, checksMs: number, hash: string, files: TerrainRecord['files']): TerrainRecord {
  const s = g.surface.stats;
  const c = g.collected.counts;
  const draw: Record<string, number> = {};
  for (const t of g.tiles) for (const m of t.meshes) draw[m.material] = (draw[m.material] ?? 0) + m.idx.length / 3;
  const { x: ox, z: oz } = g.input.offset;
  return {
    hash, buildMs: g.ms['total'] ?? 0, checksMs, ms: g.ms, options: g.options,
    counts: {
      points: g.tg.stats.points, vertices: g.tg.stats.vertices, triangles: g.tg.stats.triangles, emitted: s.emitted, byClass: s.byClass, tiles: g.tiles.length, drawTriangles: draw,
      ...c, pinned: s.pinned, wallVertices: s.wallVertices, stepVertices: s.stepVertices, stepCorners: s.stepCorners, unresolvedSteps: s.unresolvedSteps, skirts: s.skirts, waters: g.surface.waters.length,
    },
    triangulation: g.tg.stats,
    heights: { maxOffsetM: s.maxOffsetM, wallClamped: s.wallClamped, underDeck: s.underDeck, loweredUnderDeck: s.loweredUnderDeck, overTunnel: s.overTunnel, raisedOverTunnel: s.raisedOverTunnel },
    gates: { groundGapMaxM: checks.gap.maxM, groundAboveRoad: checks.above.aboveRoad + checks.above.throughDeck, needleShare: checks.needles.share, seamMismatches: checks.seams.mismatched, holeShare: checks.area.holeShare },
    gap: checks.gap, above: checks.above, needles: checks.needles, seams: checks.seams, area: checks.area, classes: checks.classes,
    waters: g.surface.waters.filter((w) => w.areaM2 >= 500).sort((p, q) => q.areaM2 - p.areaM2).map((w) => ({ level: w.level, areaM2: w.areaM2, bankMinM: w.bankMinM, bankMaxM: w.bankMaxM, x: Math.round((w.x + ox) * 10) / 10, z: Math.round((w.z + oz) * 10) / 10 })),
    files,
  };
}

export function terrainLog(r: TerrainRecord): string[] {
  const n = r.counts;
  const t = r.triangulation;
  const pct = (v: number): string => `${(v * 100).toFixed(2)} percent`;
  return [
    `built in ${(r.buildMs / 1000).toFixed(2)} s (${Object.entries(r.ms).filter(([k]) => k !== 'total').map(([k, v]) => `${k} ${v}`).join(', ')} ms), checks ${(r.checksMs / 1000).toFixed(2)} s; hash ${r.hash}`,
    `input: ${n.freeEdges} free road edges (${n.wallEdges} at walls) over ${n.roadVertices} road vertices, ${n.ringEdges} ring edges (footprints, water, open land, outline), ${n.splitPoints} points along long segments, ${n.gridPoints} on tile lines, ${n.latticePoints} lattice points; ${n.welded} points welded`,
    `triangulation: ${t.points} points, ${t.vertices} vertices, ${t.triangles} triangles; ${t.segments.segments} segments (${t.segments.direct} already an edge, ${t.segments.snapped} bent through a near vertex, ${t.segments.crossings} crossings got a vertex, ${t.segments.forced} forced, ${t.segments.failed} failed), ${t.flips} flips, ${t.exactCircleTests} exact circle tests; counts that disagree ${t.inconsistent}; hairlines dropped ${t.dropped.components} (${t.dropped.areaM2} m2); ${t.cornerPoints} points put into corners between road edges of different heights`,
    `ground: ${n.emitted} triangles in ${n.tiles} tiles (${Object.entries(n.byClass).map(([k, v]) => `${k} ${v}`).join(', ')}); ${n.pinned} vertices pinned to road edges, ${n.wallVertices} at walls, ${n.stepVertices} at a height step (${n.stepCorners} corners, ${n.skirts} upright faces, ${n.unresolvedSteps} not closed); ${n.waters} water bodies`,
    `heights: road edges up to ${r.heights.maxOffsetM} m off the ground model; ${r.heights.wallClamped} wall vertices held to their wall; under decks ${r.heights.underDeck} (${r.heights.loweredUnderDeck} lowered), over roofed tunnels ${r.heights.overTunnel} (${r.heights.raisedOverTunnel} raised)`,
    `gap: ${r.gap.samples} points on ${r.gap.edges} road edges, largest ${r.gap.maxM} m, mean ${r.gap.meanM} m, over ${GAP_LIMIT_M} m: ${r.gap.over2cm}; covered ${r.gap.coveredM} m, no ground along ${r.gap.uncoveredM.outsideStage} m outside the stage, ${r.gap.uncoveredM.otherRoad} m under another road, ${r.gap.uncoveredM.other} m other; walls: ${r.gap.wallSamples} points, ${r.gap.wallWrongSide} on the wrong side, highest ${r.gap.wallMaxHeightM} m`,
    `above the road: ${r.above.aboveRoad} of ${r.above.vertices} free ground vertices (${r.above.insideRoadFace} inside a road face); under decks ${r.above.underDeck} vertices and triangle centres, ${r.above.throughDeck} into the slab`,
    `needles: ${r.needles.under1deg} of ${r.needles.triangles} ground triangles under 1 degree (${pct(r.needles.share)}; under 5 degrees ${r.needles.under5deg}); footprint pads ${r.needles.plotsUnder1deg} of ${r.needles.plots}`,
    `seams: ${r.seams.edges} edges on tile lines, ${r.seams.matched} equal across the seam (largest difference ${r.seams.maxDiffM} m), ${r.seams.open} with no ground across, ${r.seams.mismatched} mismatched`,
    `area: outline ${r.area.outlineM2} m2 = ground ${r.area.groundM2} + open land ${r.area.lawnM2} + water ${r.area.waterM2} + footprints ${r.area.plotM2} + road faces ${r.area.roadFacesM2} + hairlines ${r.area.droppedM2} + ${r.area.holeM2} (${pct(r.area.holeShare)}); road triangles ${r.area.roadTrianglesM2} m2; class samples ${r.classes.samples}, ${r.classes.mismatches} differ, ${r.classes.holes} holes`,
  ];
}

export function terrainInvariants(r: TerrainRecord, again: string): InvariantResult[] {
  const t = r.triangulation;
  return [
    { id: 'TERR-01.gap', ok: r.gap.maxM <= GAP_LIMIT_M && r.gap.samples > 0, detail: `largest road to ground gap ${r.gap.maxM} m on ${r.gap.samples} points (limit ${GAP_LIMIT_M} m)${r.gap.worst ? `, at ${r.gap.worst.x}, ${r.gap.worst.z}` : ''}` },
    { id: 'TERR-02.nothing_above_the_road', ok: r.gates.groundAboveRoad === 0 && r.gap.wallWrongSide === 0, detail: `${r.above.aboveRoad} ground vertices above a road inside its corridor, ${r.above.throughDeck} into a deck, ${r.gap.wallWrongSide} wall points on the wrong side${r.above.list.length ? `: ${r.above.list.slice(0, 3).map((x) => `${x.what} at ${x.x}, ${x.z}`).join('; ')}` : ''}` },
    { id: 'TERR-03.needles', ok: r.needles.share < NEEDLE_LIMIT, detail: `${(r.needles.share * 100).toFixed(2)} percent of ${r.needles.triangles} ground triangles have a corner under 1 degree (limit ${NEEDLE_LIMIT * 100} percent)` },
    { id: 'TERR-04.seams', ok: r.seams.mismatched === 0 && r.seams.maxDiffM <= SEAM_LIMIT_M, detail: `${r.seams.mismatched} of ${r.seams.edges} edges on tile lines differ across the seam (largest difference of the rest ${r.seams.maxDiffM} m)${r.seams.list.length ? `: ${r.seams.list.slice(0, 2).map((x) => x.what).join('; ')}` : ''}` },
    { id: 'TERR-05.no_hole', ok: r.area.holeShare <= HOLE_LIMIT && r.classes.holes === 0 && t.inconsistent === 0 && t.segments.failed === 0, detail: `ground, footprints and road faces miss the outline area by ${r.area.holeM2} m2 (${(r.area.holeShare * 100).toFixed(3)} percent, limit ${HOLE_LIMIT * 100}); ${r.classes.holes} of ${r.classes.samples} sample points in a hole (${r.classes.mismatches} differ in class), ${t.inconsistent} triangles with two counts, ${t.segments.failed} segments failed` },
    { id: 'TERR-06.same_twice_in_time', ok: r.hash === again && r.buildMs < BUILD_LIMIT_MS, detail: `${r.hash === again ? `the same hash twice (${r.hash})` : `two builds of one input differ: ${r.hash} and ${again}`}; built in ${(r.buildMs / 1000).toFixed(1)} s (limit ${BUILD_LIMIT_MS / 1000} s)` },
  ];
}

/** The ground inside a box as draw meshes in block metres (for a site tile of the road bench scene). */
export function groundInBox(g: Ground, box: { minX: number; maxX: number; minZ: number; maxZ: number }): MeshData[] {
  return emitGround(g, (cx, cz) => (cx >= box.minX && cx <= box.maxX && cz >= box.minZ && cz <= box.maxZ ? 0 : -1), () => ({ x: 0, z: 0 })).get(0) ?? [];
}

/**
 * Camera poses that look at the ground of a site, in block metres (the caller shifts them to the tile): the foot of
 * a ramp wall seen from the ground beside it, and a water bank seen from the land. Each only when the site has one.
 */
export function groundPoses(g: Ground, site: { id: string; x: number; z: number; halfM: number }): SitePose[] {
  const { tg, surface: s } = g;
  const { vx, vz, cdt, road } = tg;
  const out: SitePose[] = [];
  const inSite = (x: number, z: number): boolean => Math.abs(x - site.x) < site.halfM - 30 && Math.abs(z - site.z) < site.halfM - 30;
  const classAt = (x: number, z: number): number => tg.cls[cdt.locate(toUnits(x), toUnits(z))] as number;
  // a ramp wall between 1.5 and 3 m high, the nearest to the middle whose viewpoint stands on ground
  let best: { d: number; pose: SitePose } | null = null;
  for (let k = 0; k < road.a.length; k++) {
    if (!road.alive[k] || road.wall[k] !== 1) continue;
    const a = road.a[k] as number;
    const b = road.b[k] as number;
    const h = (road.ya[k] as number) - (s.vy[a] as number);
    const mx = ((vx[a] as number) + (vx[b] as number)) / 2;
    const mz = ((vz[a] as number) + (vz[b] as number)) / 2;
    if (!(h > 1.5 && h < 3) || !inSite(mx, mz)) continue;
    const dx = (vx[b] as number) - (vx[a] as number);
    const dz = (vz[b] as number) - (vz[a] as number);
    const len = Math.hypot(dx, dz);
    if (len < 0.5) continue;
    // the ground is on the right of the road's edge
    const nx = dz / len;
    const nz = -dx / len;
    const px = mx + nx * 11 + (dx / len) * 9;
    const pz = mz + nz * 11 + (dz / len) * 9;
    const k2 = classAt(px, pz);
    const d = Math.hypot(mx - site.x, mz - site.z);
    if ((k2 !== C_GROUND && k2 !== C_LAWN && k2 !== C_PLOT) || (best && best.d <= d)) continue;
    const y = s.vy[a] as number;
    best = { d, pose: { name: 'ramp_foot', kind: 'eye', pos: [px, g.input.ground(px, pz) + 1.7, pz], target: [mx - (dx / len) * 6, y + 0.8, mz - (dz / len) * 6], size: 62, note: `the foot of a ramp wall ${h.toFixed(1)} m high, seen from the ground beside it`, shot: `ground_${site.id}_ramp_foot` } };
  }
  if (best) out.push(best.pose);
  // a bank: an edge between water and land, the nearest to the middle
  let bank: { d: number; pose: SitePose } | null = null;
  const ne = s.cls.length;
  const edgeLand = new Map<number, number>();
  for (let e = 0; e < ne; e++) {
    if (s.cls[e] === C_WATER) continue;
    for (let i = 0; i < 3; i++) edgeLand.set((s.tri[e * 3 + i] as number) * 4194304 + (s.tri[e * 3 + ((i + 1) % 3)] as number), e);
  }
  for (let e = 0; e < ne; e++) {
    if (s.cls[e] !== C_WATER || (s.waters[s.body[e] as number] as { areaM2: number }).areaM2 < 5000) continue;
    for (let i = 0; i < 3; i++) {
      const p = s.tri[e * 3 + i] as number;
      const q = s.tri[e * 3 + ((i + 1) % 3)] as number;
      if (!edgeLand.has(q * 4194304 + p)) continue;
      const mx = ((vx[p] as number) + (vx[q] as number)) / 2;
      const mz = ((vz[p] as number) + (vz[q] as number)) / 2;
      const d = Math.hypot(mx - site.x, mz - site.z);
      if (!inSite(mx, mz) || (bank && bank.d <= d)) continue;
      const dx = (vx[q] as number) - (vx[p] as number);
      const dz = (vz[q] as number) - (vz[p] as number);
      const len = Math.hypot(dx, dz) || 1;
      // the water is on the left of its own edge, the land on the right
      const nx = dz / len;
      const nz = -dx / len;
      const px = mx + nx * 16 + (dx / len) * 12;
      const pz = mz + nz * 16 + (dz / len) * 12;
      const k2 = classAt(px, pz);
      if (k2 !== C_GROUND && k2 !== C_LAWN) continue;
      const level = (s.waters[s.body[e] as number] as { level: number }).level;
      bank = { d, pose: { name: 'bank', kind: 'eye', pos: [px, g.input.ground(px, pz) + 2.2, pz], target: [mx - nx * 14 - (dx / len) * 10, level, mz - nz * 14 - (dz / len) * 10], size: 62, note: 'the water bank seen from the land: the ground runs down to the water, the surface lies flat', shot: `ground_${site.id}_bank` } };
    }
  }
  if (bank) out.push(bank.pose);
  return out;
}

const FILL: Readonly<Record<number, string>> = { [C_GROUND]: '#a39a86', [C_LAWN]: '#6f9a55', [C_PLOT]: '#c9b8a2', [C_WATER]: '#5b87a8' };

/** A north-up plan of the ground triangles of a box by class, the roads left dark. */
export function groundSvg(g: Ground, box: { minX: number; maxX: number; minZ: number; maxZ: number }, title: string): string {
  const { vx, vz } = g.tg;
  const s = g.surface;
  const pad = 10;
  const w = box.maxX - box.minX + 2 * pad;
  const h = box.maxZ - box.minZ + 2 * pad;
  const scale = Math.min(2400 / w, 2400 / h);
  const X = (x: number): string => ((x - box.minX + pad) * scale).toFixed(1);
  const Z = (z: number): string => ((z - box.minZ + pad) * scale + 40).toFixed(1);
  const o: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * scale)}" height="${Math.round(h * scale) + 40}" font-family="Helvetica, Arial, sans-serif"><rect width="100%" height="100%" fill="#3a3a40"/>`];
  for (let e = 0; e < s.cls.length; e++) {
    const a = s.tri[e * 3] as number;
    const b = s.tri[e * 3 + 1] as number;
    const c = s.tri[e * 3 + 2] as number;
    const cx = ((vx[a] as number) + (vx[b] as number) + (vx[c] as number)) / 3;
    const cz = ((vz[a] as number) + (vz[b] as number) + (vz[c] as number)) / 3;
    if (cx < box.minX || cx > box.maxX || cz < box.minZ || cz > box.maxZ) continue;
    o.push(`<polygon points="${[a, b, c].map((v) => `${X(vx[v] as number)},${Z(vz[v] as number)}`).join(' ')}" fill="${FILL[s.cls[e] as number]}" stroke="#2c2c30" stroke-width="0.25"/>`);
  }
  o.push(`<rect width="100%" height="36" fill="#1d1f24"/><text x="12" y="24" font-size="18" fill="#fff">${title}</text>`);
  const nx = Math.round(w * scale) - 40;
  o.push(`<polygon points="${nx},48 ${nx - 9},78 ${nx},71 ${nx + 9},78" fill="#fff"/><text x="${nx - 6}" y="96" font-size="16" font-weight="bold" fill="#fff">N</text>`);
  o.push(`<rect x="14" y="${Math.round(h * scale) + 22}" width="${(50 * scale).toFixed(1)}" height="5" fill="#fff"/><text x="14" y="${Math.round(h * scale) + 16}" font-size="13" fill="#fff">50 m</text></svg>`);
  return o.join('\n');
}
