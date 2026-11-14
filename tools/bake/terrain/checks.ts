// The R-TERR checks on the built ground (P1-015, MAP_REPAIR.md rule table "Terrain": no ground vertex above the road
// inside a corridor; the road never floats over or sinks into its ground), measured on what was built, not on how:
// the gap along every free road edge between the road's own corner heights and the ground triangles that lie
// along it; ground under decks and inside road faces; needle triangles; the tile seams read back from the tile
// meshes; the areas (ground, footprints, road faces cut to the outline) against the stage outline; and a lattice
// of sample points whose class by plain geometry (inside a road face, inside a footprint) must be the class the
// triangulation gave. Pure.
import type { P2 } from '../geom.ts';
import { pointInRing } from '../geom.ts';
import { TILE_M } from '../layout/grid.ts';
import { sharedArea } from '../mesh/clip.ts';
import { edgeKey } from '../mesh/conform.ts';
import { DECK_DEPTH } from '../roads/model.ts';
import type { Ground } from './build.ts';
import { MEET_EDGE, MEET_NONE, offGround } from './collect.ts';
import { checkPortals } from './portals.ts';
import type { PortalChecks } from './portals.ts';
import { toUnits } from './predicates.ts';
import { C_DROPPED, C_GROUND, C_LAWN, C_OUT, C_PLOT, C_ROAD, C_WATER } from './triangulate.ts';

export interface TerrainChecks {
  gap: {
    /** Points compared on road edges at grade (two per ground edge piece). */
    samples: number;
    maxM: number;
    meanM: number;
    over2cm: number;
    edges: number;
    coveredM: number;
    /** Road edge at grade with no ground triangle along it, by what lies beside it there. */
    uncoveredM: { outsideStage: number; otherRoad: number; other: number };
    /** Where road edge lies under another road face (the largest 25 m cells, world metres; pieces: this face's / the other face's piece). */
    underRoad: { x: number; z: number; m: number; pieces: string[] }[];
    worst: { x: number; z: number; gapM: number } | null;
    /** Where the ground ends at a wall: ground above the ramp it stands beside, or under the road of a cut. */
    wallSamples: number;
    wallWrongSide: number;
    wallMaxHeightM: number;
    /** The first 30 findings (world metres): a gap over the limit, a wall point on the wrong side, a stretch with no ground for no known reason. */
    list: { x: number; z: number; what: string }[];
  };
  above: {
    /** Free ground vertices looked at, and how many lie inside a road face in plan (not on its edge). */
    vertices: number;
    insideRoadFace: number;
    aboveRoad: number;
    /** Ground vertices and triangle centres under a deck that reach its slab. */
    underDeck: number;
    throughDeck: number;
    list: { x: number; z: number; what: string }[];
  };
  needles: { triangles: number; under1deg: number; share: number; under5deg: number; plots: number; plotsUnder1deg: number };
  seams: { edges: number; matched: number; open: number; mismatched: number; maxDiffM: number; tiles: number; list: { x: number; z: number; what: string }[] };
  area: {
    outlineM2: number; groundM2: number; lawnM2: number; waterM2: number; plotM2: number; droppedM2: number;
    /** Road faces the ground meets, each cut to the outline (faces of two levels over each other count twice). */
    roadFacesM2: number;
    /** The triangles the triangulation gave to the road, inside the outline. */
    roadTrianglesM2: number;
    /** Outline minus ground, plots, dropped hairlines and road faces. */
    holeM2: number;
    holeShare: number;
  };
  classes: { samples: number; mismatches: number; holes: number; list: { x: number; z: number; expected: string; got: string }[] };
  /** Tunnel mouths (P1-037, portals.ts). */
  portals: PortalChecks;
}

/** A wall point may be this far on the wrong side (m): a kerb height, at the vertex where a wall starts beside a kerb. */
export const WALL_SLACK_M = 0.152;

const r4 = (v: number): number => Math.round(v * 10000) / 10000;
const r1 = (v: number): number => Math.round(v * 10) / 10;

const inFace = (g: Ground, f: number, x: number, z: number, clear = 0.003): boolean => {
  const fs = g.input.fs;
  const s = fs.start[f] as number;
  const n = fs.len[f] as number;
  let inside = false;
  let edge = Infinity;
  for (let k = 0, j = n - 1; k < n; j = k++) {
    const a = fs.ids[s + k] as number;
    const b = fs.ids[s + j] as number;
    const ax = fs.vx[a] as number;
    const az = fs.vz[a] as number;
    const bx = fs.vx[b] as number;
    const bz = fs.vz[b] as number;
    if (az > z !== bz > z && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
    const len2 = (bx - ax) ** 2 + (bz - az) ** 2;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / len2)) : 0;
    edge = Math.min(edge, Math.hypot(ax + (bx - ax) * t - x, az + (bz - az) * t - z));
  }
  // a point on the face's own edge is not inside it
  return inside && edge >= clear;
};

export function checkGround(g: Ground): TerrainChecks {
  const { input, tg, surface: s, collected } = g;
  const { fs, edges } = input;
  const { vx, vz, cdt } = tg;
  const meet = collected.meet;
  const ne = s.cls.length;
  const pk = (v: number): number => ((cdt.x[v] as number) + 33554432) * 67108864 + ((cdt.z[v] as number) + 33554432);

  // the road's edge pieces by the vertex they end in, and the ground triangle edges that run along a piece
  const road = tg.road;
  const endsIn = new Map<number, number[]>();
  for (let k = 0; k < road.a.length; k++) {
    if (!road.alive[k]) continue;
    const list = endsIn.get(road.b[k] as number);
    if (list) list.push(k);
    else endsIn.set(road.b[k] as number, [k]);
  }
  const along = new Map<number, [number, number]>();
  for (let e = 0; e < ne; e++) {
    for (let i = 0; i < 3; i++) {
      const p = s.tri[e * 3 + i] as number;
      const q = s.tri[e * 3 + ((i + 1) % 3)] as number;
      if (road.find(q, p) >= 0) along.set(p * 4194304 + q, [s.cy[e * 3 + i] as number, s.cy[e * 3 + ((i + 1) % 3)] as number]);
    }
  }
  const vertexAt = new Map<number, number>();
  for (let k = 0; k < road.a.length; k++) {
    if (!road.alive[k]) continue;
    vertexAt.set(pk(road.a[k] as number), road.a[k] as number);
    vertexAt.set(pk(road.b[k] as number), road.b[k] as number);
  }
  const gap: TerrainChecks['gap'] = { samples: 0, maxM: 0, meanM: 0, over2cm: 0, edges: 0, coveredM: 0, uncoveredM: { outsideStage: 0, otherRoad: 0, other: 0 }, underRoad: [], worst: null, wallSamples: 0, wallWrongSide: 0, wallMaxHeightM: 0, list: [] };
  const find = (x: number, z: number, what: string): void => {
    if (gap.list.length < 30) gap.list.push({ x: r1(x + input.offset.x), z: r1(z + input.offset.z), what });
  };
  let sum = 0;
  let other = -1;
  /** Road edge under another road face, by 25 m cell: where the lane model's faces lie on each other. */
  const underRoad = new Map<string, { x: number; z: number; m: number; pieces: Set<string> }>();
  const outline = input.outline as P2[];
  for (const [key, c] of edges.at) {
    const f = edges.owner[c] as number;
    const kind = meet[f] as number;
    if (kind === MEET_NONE) continue;
    const a = Math.floor(key / 4194304);
    const b = key % 4194304;
    const twin = edges.at.get(edgeKey(b, a));
    if (twin !== undefined && meet[edges.owner[twin] as number] !== MEET_NONE) continue;
    const st = fs.start[f] as number;
    const ya = fs.ys[c] as number;
    const yb = fs.ys[st + ((c - st + 1) % (fs.len[f] as number))] as number;
    const ax = fs.vx[a] as number;
    const az = fs.vz[a] as number;
    const bx = fs.vx[b] as number;
    const bz = fs.vz[b] as number;
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    const atEdge = kind === MEET_EDGE && !offGround(input, f, a, b, ya, yb);
    gap.edges++;
    const roadY = (x: number, z: number): number => ya + (yb - ya) * Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (len * len)));
    const sample = (x: number, z: number, y: number): void => {
      const d = y - roadY(x, z);
      if (atEdge) {
        gap.samples++;
        sum += Math.abs(d);
        if (Math.abs(d) > 0.02) {
          gap.over2cm++;
          find(x, z, `ground ${r4(d)} m off the road edge (face ${f})`);
        }
        if (Math.abs(d) > gap.maxM) {
          gap.maxM = Math.abs(d);
          gap.worst = { x: r1(x + input.offset.x), z: r1(z + input.offset.z), gapM: r4(d) };
        }
        return;
      }
      gap.wallSamples++;
      // on fill the ground is under the ramp, in a cut over the road; a kerb height either way is the vertex where the wall starts
      const fill = roadY(x, z) >= input.ground(x, z);
      if ((fill && d > WALL_SLACK_M) || (!fill && d < -WALL_SLACK_M)) {
        gap.wallWrongSide++;
        find(x, z, fill ? `ground ${r4(d)} m above the ramp it ends at (face ${f})` : `ground ${r4(-d)} m under the road of a cut (face ${f})`);
      }
      gap.wallMaxHeightM = Math.max(gap.wallMaxHeightM, Math.abs(d));
    };
    // from b back to a along the pieces the triangulation cut this edge into: each piece has a ground edge along it, or none
    let cur = vertexAt.get((toUnits(bx) + 33554432) * 67108864 + (toUnits(bz) + 33554432)) ?? -1;
    const target = vertexAt.get((toUnits(ax) + 33554432) * 67108864 + (toUnits(az) + 33554432)) ?? -1;
    let left = len;
    for (let guard = 0; guard < 1000 && cur >= 0 && cur !== target; guard++) {
      let best = -1;
      let bestLeft = left - 1e-9;
      for (const k of endsIn.get(cur) ?? []) {
        const v = road.a[k] as number;
        const off = Math.abs((bx - ax) * ((vz[v] as number) - az) - (bz - az) * ((vx[v] as number) - ax)) / len;
        const rest = Math.hypot((vx[v] as number) - ax, (vz[v] as number) - az);
        if (off < 0.004 && rest < bestLeft) {
          best = v;
          bestLeft = rest;
        }
      }
      if (best < 0) break;
      const hit = along.get(cur * 4194304 + best);
      const piece = left - bestLeft;
      if (hit) {
        sample(vx[cur] as number, vz[cur] as number, hit[0]);
        sample(vx[best] as number, vz[best] as number, hit[1]);
        gap.coveredM += piece;
      } else if (atEdge) {
        // what lies on the ground side of a piece with no ground: outside the stage, another road, or something else
        const mx = ((vx[cur] as number) + (vx[best] as number)) / 2 + ((bz - az) / len) * 0.01;
        const mz = ((vz[cur] as number) + (vz[best] as number)) / 2 - ((bx - ax) / len) * 0.01;
        if (!pointInRing({ x: mx, z: mz }, outline)) gap.uncoveredM.outsideStage += piece;
        else if ((other = input.grid.near(mx, mz, mx, mz).find((o) => meet[o] !== MEET_NONE && inFace(g, o, mx, mz, 0)) ?? -1) >= 0) {
          gap.uncoveredM.otherRoad += piece;
          const key = `${Math.floor(mx / 25)}_${Math.floor(mz / 25)}`;
          const at = underRoad.get(key);
          if (at) {
            at.m += piece;
            at.pieces.add(`${fs.piece[f]}/${fs.piece[other]}`);
          } else underRoad.set(key, { x: mx, z: mz, m: piece, pieces: new Set([`${fs.piece[f]}/${fs.piece[other]}`]) });
        }
        else {
          gap.uncoveredM.other += piece;
          find(mx, mz, `${r4(piece)} m of road edge with no ground along it (face ${f})`);
        }
      }
      cur = best;
      left = bestLeft;
    }
    if (cur !== target && atEdge) {
      gap.uncoveredM.other += left;
      find(ax, az, `${r4(left)} m of road edge that the triangulation has no pieces for (face ${f})`);
    }
  }
  gap.meanM = r4(sum / Math.max(1, gap.samples));
  gap.maxM = r4(gap.maxM);
  gap.coveredM = Math.round(gap.coveredM);
  gap.wallMaxHeightM = Math.round(gap.wallMaxHeightM * 100) / 100;
  for (const k of ['outsideStage', 'otherRoad', 'other'] as const) gap.uncoveredM[k] = r1(gap.uncoveredM[k]);
  gap.underRoad = [...underRoad.values()].sort((p, q) => q.m - p.m || p.x - q.x).slice(0, 20).map((u) => ({ x: r1(u.x + input.offset.x), z: r1(u.z + input.offset.z), m: r1(u.m), pieces: [...u.pieces].sort().slice(0, 4) }));

  // free ground vertices inside a road face or under a deck; triangle centres under a deck
  const above: TerrainChecks['above'] = { vertices: 0, insideRoadFace: 0, aboveRoad: 0, underDeck: 0, throughDeck: 0, list: [] };
  const probe = (x: number, z: number, y: number, vertex: boolean): void => {
    for (const f of input.grid.near(x, z, x, z)) {
      if (!inFace(g, f, x, z)) continue;
      const st = fs.start[f] as number;
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = 0; k < (fs.len[f] as number); k++) {
        lo = Math.min(lo, fs.ys[st + k] as number);
        hi = Math.max(hi, fs.ys[st + k] as number);
      }
      if (meet[f] !== MEET_NONE) {
        if (!vertex) continue;
        above.insideRoadFace++;
        if (y > lo) above.aboveRoad++;
        if (above.list.length < 20) above.list.push({ x: r1(x + input.offset.x), z: r1(z + input.offset.z), what: `a ground vertex inside a road face, ${r4(y - lo)} m over it` });
      } else if (hi >= input.ground(x, z)) {
        above.underDeck++;
        if (y > lo - DECK_DEPTH) {
          above.throughDeck++;
          if (above.list.length < 20) above.list.push({ x: r1(x + input.offset.x), z: r1(z + input.offset.z), what: `ground ${r4(y - (lo - DECK_DEPTH))} m into a deck slab` });
        }
      }
    }
  };
  for (let v = 4; v < vx.length; v++) {
    if (Number.isNaN(s.vy[v] as number) || s.role[v] !== 0) continue;
    above.vertices++;
    probe(vx[v] as number, vz[v] as number, s.vy[v] as number, true);
  }
  const needles: TerrainChecks['needles'] = { triangles: 0, under1deg: 0, share: 0, under5deg: 0, plots: 0, plotsUnder1deg: 0 };
  const area: TerrainChecks['area'] = { outlineM2: 0, groundM2: 0, lawnM2: 0, waterM2: 0, plotM2: 0, droppedM2: 0, roadFacesM2: 0, roadTrianglesM2: 0, holeM2: 0, holeShare: 0 };
  const SIN1 = Math.sin(Math.PI / 180);
  const SIN5 = Math.sin((5 * Math.PI) / 180);
  for (let e = 0; e < ne; e++) {
    const a = s.tri[e * 3] as number;
    const b = s.tri[e * 3 + 1] as number;
    const c = s.tri[e * 3 + 2] as number;
    const twice = Math.abs(((vx[b] as number) - (vx[a] as number)) * ((vz[c] as number) - (vz[a] as number)) - ((vz[b] as number) - (vz[a] as number)) * ((vx[c] as number) - (vx[a] as number)));
    const side = (p: number, q: number): number => Math.hypot((vx[q] as number) - (vx[p] as number), (vz[q] as number) - (vz[p] as number));
    const sides = [side(a, b), side(b, c), side(c, a)].sort((p, q) => p - q);
    // the smallest corner lies opposite the shortest side: sin = 2 * area / (the two longer sides)
    const sin = twice / Math.max(1e-12, (sides[1] as number) * (sides[2] as number));
    const k = s.cls[e] as number;
    if (k === C_PLOT) {
      needles.plots++;
      if (sin < SIN1) needles.plotsUnder1deg++;
      area.plotM2 += twice / 2;
    } else {
      needles.triangles++;
      if (sin < SIN1) needles.under1deg++;
      if (sin < SIN5) needles.under5deg++;
      if (k === C_GROUND) area.groundM2 += twice / 2;
      else if (k === C_LAWN) area.lawnM2 += twice / 2;
      else area.waterM2 += twice / 2;
      probe(((vx[a] as number) + (vx[b] as number) + (vx[c] as number)) / 3, ((vz[a] as number) + (vz[b] as number) + (vz[c] as number)) / 3, ((s.cy[e * 3] as number) + (s.cy[e * 3 + 1] as number) + (s.cy[e * 3 + 2] as number)) / 3, false);
    }
  }
  needles.share = r4(needles.under1deg / Math.max(1, needles.triangles));

  // areas
  for (let t = 0; t < cdt.nt; t++) {
    if (tg.cls[t] !== C_ROAD && tg.cls[t] !== C_DROPPED) continue;
    const a = cdt.tv[t * 3] as number;
    const b = cdt.tv[t * 3 + 1] as number;
    const c = cdt.tv[t * 3 + 2] as number;
    const ar = Math.abs(((vx[b] as number) - (vx[a] as number)) * ((vz[c] as number) - (vz[a] as number)) - ((vz[b] as number) - (vz[a] as number)) * ((vx[c] as number) - (vx[a] as number))) / 2;
    if (tg.cls[t] === C_ROAD) area.roadTrianglesM2 += ar;
    else area.droppedM2 += ar;
  }
  let o2 = 0;
  for (let k = 0; k < outline.length; k++) o2 += (outline[k] as P2).x * (outline[(k + 1) % outline.length] as P2).z - (outline[(k + 1) % outline.length] as P2).x * (outline[k] as P2).z;
  area.outlineM2 = Math.abs(o2) / 2;
  const insideV = new Int8Array(fs.vx.length).fill(-1);
  const inside = (id: number): boolean => {
    if (insideV[id] === -1) insideV[id] = pointInRing({ x: fs.vx[id] as number, z: fs.vz[id] as number }, outline) ? 1 : 0;
    return insideV[id] === 1;
  };
  const outRing = outline.map((p) => [p.x, p.z] as [number, number]);
  for (let f = 0; f < fs.faces; f++) {
    if (meet[f] === MEET_NONE) continue;
    const st = fs.start[f] as number;
    let all = true;
    let any = false;
    for (let k = 0; k < (fs.len[f] as number); k++) {
      if (inside(fs.ids[st + k] as number)) any = true;
      else all = false;
    }
    if (all) area.roadFacesM2 += fs.area(f);
    else if (any) area.roadFacesM2 += sharedArea([fs.ring(f)], [outRing], { x: fs.vx[fs.ids[st] as number] as number, z: fs.vz[fs.ids[st] as number] as number });
  }
  area.holeM2 = area.outlineM2 - (area.groundM2 + area.lawnM2 + area.waterM2 + area.plotM2 + area.droppedM2 + area.roadFacesM2);
  area.holeShare = Math.round((Math.abs(area.holeM2) / area.outlineM2) * 1e6) / 1e6;
  for (const k of ['outlineM2', 'groundM2', 'lawnM2', 'waterM2', 'plotM2', 'roadFacesM2', 'roadTrianglesM2', 'holeM2'] as const) area[k] = r1(area[k]);
  area.droppedM2 = Math.round(area.droppedM2 * 1000) / 1000;

  return { gap, above, needles, seams: checkSeams(g), area, classes: checkClasses(g), portals: checkPortals(g) };
}

/** Tile seams read back from the tile meshes: every ground edge on a tile line against the edges of the tile across it. */
function checkSeams(g: Ground): TerrainChecks['seams'] {
  interface SeamEdge { lo: number; hi: number; ylo: number; yhi: number; side: number; water: boolean }
  const lines = new Map<string, SeamEdge[]>();
  const EPS = 1e-3;
  for (const tile of g.tiles) {
    for (const m of tile.meshes) {
      for (let k = 0; k + 2 < m.idx.length; k += 3) {
        for (let i = 0; i < 3; i++) {
          const p = (m.idx[k + i] as number) * 3;
          const q = (m.idx[k + ((i + 1) % 3)] as number) * 3;
          for (const axis of [0, 2]) {
            const u = m.pos[p + axis] as number;
            const w = m.pos[q + axis] as number;
            const at = Math.abs(u) < EPS && Math.abs(w) < EPS ? 0 : Math.abs(u - TILE_M) < EPS && Math.abs(w - TILE_M) < EPS ? 1 : -1;
            if (at < 0) continue;
            const other = axis === 0 ? 2 : 0;
            const base = (other === 0 ? tile.tx : tile.tz) * TILE_M;
            const a = base + (m.pos[p + other] as number);
            const b = base + (m.pos[q + other] as number);
            if (Math.abs(a - b) < 1e-6) continue;
            const key = `${axis === 0 ? 'x' : 'z'}${(axis === 0 ? tile.tx : tile.tz) + at}`;
            const rec: SeamEdge = a < b ? { lo: a, hi: b, ylo: m.pos[p + 1] as number, yhi: m.pos[q + 1] as number, side: at, water: m.material === 'water' } : { lo: b, hi: a, ylo: m.pos[q + 1] as number, yhi: m.pos[p + 1] as number, side: at, water: m.material === 'water' };
            const list = lines.get(key);
            if (list) list.push(rec);
            else lines.set(key, [rec]);
          }
        }
      }
    }
  }
  const out: TerrainChecks['seams'] = { edges: 0, matched: 0, open: 0, mismatched: 0, maxDiffM: 0, tiles: g.tiles.length, list: [] };
  for (const [key, list] of lines) {
    for (const water of [false, true]) {
      const sides = [0, 1].map((sd) => list.filter((e) => e.side === sd && e.water === water).sort((p, q) => p.lo - q.lo));
      for (const sd of [0, 1]) {
        const mine = sides[sd] as SeamEdge[];
        const theirs = sides[1 - sd] as SeamEdge[];
        let j = 0;
        for (const e of mine) {
          out.edges++;
          while (j < theirs.length && (theirs[j] as SeamEdge).hi <= e.lo + 1e-4) j++;
          let state = 'open';
          for (let k = j; k < theirs.length && (theirs[k] as SeamEdge).lo < e.hi - 1e-4; k++) {
            const o = theirs[k] as SeamEdge;
            const d = Math.max(Math.abs(o.lo - e.lo), Math.abs(o.hi - e.hi), Math.abs(o.ylo - e.ylo), Math.abs(o.yhi - e.yhi));
            if (d <= 1e-4) {
              state = 'matched';
              out.maxDiffM = Math.max(out.maxDiffM, d);
              break;
            }
            state = 'mismatched';
          }
          if (state === 'matched') out.matched++;
          else if (state === 'open') out.open++;
          else {
            out.mismatched++;
            if (out.list.length < 20) out.list.push({ x: r1(key[0] === 'x' ? Number(key.slice(1)) * TILE_M : e.lo), z: r1(key[0] === 'x' ? e.lo : Number(key.slice(1)) * TILE_M), what: `${water ? 'water' : 'ground'} edge ${r4(e.lo)} to ${r4(e.hi)} on line ${key} has no equal edge across the seam` });
          }
        }
      }
    }
  }
  out.maxDiffM = Math.round(out.maxDiffM * 1e6) / 1e6;
  return out;
}

/** Sample points every 10 m: what plain geometry says they lie in against what the triangulation says. */
function checkClasses(g: Ground): TerrainChecks['classes'] {
  const { input, tg, collected } = g;
  const out: TerrainChecks['classes'] = { samples: 0, mismatches: 0, holes: 0, list: [] };
  const CELL = 25;
  const cells = new Map<number, number[]>();
  input.footprints.forEach((r, i) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of r) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    for (let a = Math.floor(x0 / CELL); a <= Math.floor(x1 / CELL); a++) {
      for (let b = Math.floor(z0 / CELL); b <= Math.floor(z1 / CELL); b++) {
        const k = (a + 100000) * 262144 + (b + 100000);
        const list = cells.get(k);
        if (list) list.push(i);
        else cells.set(k, [i]);
      }
    }
  });
  const names = ['outside', 'road', 'plot', 'open'];
  const b = collected.box;
  const outline = input.outline as P2[];
  for (let z = b.minZ + 3.37; z < b.maxZ; z += 10) {
    for (let x = b.minX + 3.37; x < b.maxX; x += 10) {
      let want = 3;
      if (!pointInRing({ x, z }, outline)) want = 0;
      else if (input.grid.near(x, z, x, z).some((f) => collected.meet[f] !== MEET_NONE && inFace(g, f, x, z, 0))) want = 1;
      else if ((cells.get((Math.floor(x / CELL) + 100000) * 262144 + (Math.floor(z / CELL) + 100000)) ?? []).some((i) => pointInRing({ x, z }, input.footprints[i] as P2[]))) want = 2;
      const k = tg.cls[tg.cdt.locate(toUnits(x), toUnits(z))] as number;
      const got = k === C_OUT ? 0 : k === C_ROAD ? 1 : k === C_PLOT ? 2 : 3;
      out.samples++;
      if (want === got) continue;
      out.mismatches++;
      if (want !== 0 && got === 0) out.holes++;
      if (out.list.length < 20) out.list.push({ x: r1(x + input.offset.x), z: r1(z + input.offset.z), expected: names[want] as string, got: k === C_WATER ? 'water' : (names[got] as string) });
    }
  }
  return out;
}
