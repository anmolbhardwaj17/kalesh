// What the mesh step hands on (P1-014): the record for the health report, a hash of the faces (the same input must
// give the same mesh), and the stand-in tiles of the road bench scene (game/bench/roads, --arch=roads:<site>), cut
// from the production mesh around a few sites. The stand-in tile adds two things the game will not take from here:
// lane lines as thin strips (the game draws them in the road shader from the lane UV) and a plain ground sheet
// under the roads with a verge down to it (the real ground is cut to the road edges by the terrain step). Pure.
import { hashText } from '../graph/checks.ts';
import { colliderChunks } from '../roads/mesh.ts';
import type { LaneDef, Station, Strip } from '../roads/model.ts';
import type { MeshData, TileContent } from '../tile.ts';
import type { RoadMesh } from './build.ts';
import type { MeshChecks } from './checks.ts';
import { edgeKey } from './conform.ts';
import { CUT_NONE } from './faces.ts';
import type { MeshInput } from './input.ts';
import { laneLineStrips } from './paint.ts';
import { PAIR_LIMIT_M2 } from './proof.ts';
import { Sink } from './solids.ts';
import type { V3 } from './solids.ts';
import { K_DECK, K_GRADE, K_TUNNEL } from './stripfaces.ts';

export interface MeshRecord {
  hash: string;
  /** Wall time of the mesh build (faces to draw meshes) and of its parts, and of the checks (ms). */
  buildMs: number;
  checksMs: number;
  ms: Record<string, number>;
  counts: {
    faces: number; vertices: number; laneQuads: number; triangles: number; trianglesByMaterial: Record<string, number>;
    junctions: number; j1: number; j2: number; junctionFaces: number; setFaces: number; clippedFaces: number; clippedJunctions: number; clippedAreaM2: number;
    bands: number; crossedBands: number; droppedBands: number; holes: number; fannedJunctions: number; foldedBorders: number; foldedQuads: number; jointPins: number; jointPinMaxM: number; jointsApart: number;
    kerbFaces: number; endCaps: number; stopLines: number; crossings: number; undersides: number; roofs: number; abutmentWalls: number;
  };
  /** The gate counts of MAP_REPAIR.md "Verification" this step measures. */
  gates: { overlappingRoadFaces: number; openBoundaryEdges: number; unjoinedEnds: number; floatingEnds: number; railingsAtGrade: number; piersInLane: number };
  overlap: MeshChecks['overlap'] & { note: string };
  watertight: MeshChecks['watertight'];
  ends: MeshChecks['ends'];
  railings: MeshChecks['railings'];
  piers: MeshChecks['piers'];
  kerbs: MeshChecks['kerbs'];
  uv: MeshChecks['uv'];
  stopLines: MeshChecks['stopLines'];
  /** Junction surfaces over 3,000 m2 (world metres): a cluster the lane model cut far too wide. */
  oversize: { id: string; method: string; arms: number; areaM2: number; x: number; z: number }[];
  /** What the builder did at junctions it could not build as planned (the first 400). */
  notes: { id: string; what: string }[];
  files: Record<string, string | string[]>;
}

/** A hash of every face: its vertices in plan, its heights and what it is. */
export function meshHash(mesh: RoadMesh): string {
  const fs = mesh.fs;
  let a = 0;
  let b = 0;
  for (let f = 0; f < fs.faces; f++) {
    const s = fs.start[f] as number;
    for (let k = 0; k < (fs.len[f] as number); k++) {
      const id = fs.ids[s + k] as number;
      const v = Math.round((fs.vx[id] as number) * 1000) * 3 + Math.round((fs.vz[id] as number) * 1000) * 7 + Math.round((fs.ys[s + k] as number) * 1000) * 13 + (fs.kind[f] as number) * 17;
      a = (a + v * (k + 1)) % 2147483647;
      b = (b * 31 + v) % 2147483629;
    }
  }
  return hashText(`${fs.faces}:${fs.vx.length}:${a}:${b}:${JSON.stringify(mesh.sink.triangles())}`);
}

export function meshRecord(input: MeshInput, mesh: RoadMesh, checks: MeshChecks, checksMs: number, offset: { x: number; z: number }, hash: string, files: MeshRecord['files']): MeshRecord {
  const { fs } = mesh;
  const tri = mesh.sink.triangles();
  const first = input.strips.length;
  const oversize: MeshRecord['oversize'] = [];
  input.junctions.forEach((j, ji) => {
    let area = 0;
    for (const f of mesh.junctions.faces[ji] as number[]) if (fs.raise[f] === 0) area += fs.area(f);
    if (area > 3000) oversize.push({ id: j.id, method: j.method, arms: j.arms.length, areaM2: Math.round(area), x: Math.round((j.centre.x + offset.x) * 10) / 10, z: Math.round((j.centre.z + offset.z) * 10) / 10 });
  });
  oversize.sort((p, q) => q.areaM2 - p.areaM2);
  const world = <T extends { x: number; z: number }>(p: T): T => ({ ...p, x: Math.round((p.x + offset.x) * 10) / 10, z: Math.round((p.z + offset.z) * 10) / 10 });
  const o = checks.overlap;
  return {
    hash, buildMs: mesh.ms['total'] ?? 0, checksMs, ms: mesh.ms,
    counts: {
      faces: fs.faces, vertices: fs.vx.length, laneQuads: mesh.stripFaces.quads, triangles: Object.values(tri).reduce((s, v) => s + v, 0), trianglesByMaterial: tri,
      junctions: input.junctions.length, j1: mesh.junctions.j1, j2: mesh.junctions.j2, junctionFaces: fs.faces - (mesh.stripFaces.first[first] as number), setFaces: mesh.junctions.setFaces.size,
      clippedFaces: mesh.junctions.clippedFaces, clippedJunctions: mesh.junctions.clippedJunctions, clippedAreaM2: mesh.junctions.clippedAreaM2, bands: mesh.junctions.bands, crossedBands: mesh.junctions.crossedBands,
      droppedBands: mesh.junctions.droppedBands, holes: mesh.junctions.holes, fannedJunctions: mesh.tops.fanned, foldedBorders: mesh.stripFaces.foldedBorders, foldedQuads: mesh.stripFaces.foldedQuads,
      jointPins: mesh.borders.pinned, jointPinMaxM: Math.round(mesh.borders.pinMaxM * 10000) / 10000, jointsApart: mesh.borders.apart,
      kerbFaces: mesh.steps.faces, endCaps: mesh.steps.caps, stopLines: mesh.stops.lines.length, crossings: mesh.stops.crossings, undersides: mesh.structures.undersides, roofs: mesh.structures.roofs, abutmentWalls: mesh.structures.abutmentWalls,
    },
    gates: {
      overlappingRoadFaces: o.pairsOver + o.stripPairs.pairs, openBoundaryEdges: checks.watertight.openBoundaryEdges, unjoinedEnds: checks.ends.unjoined, floatingEnds: checks.ends.floating,
      railingsAtGrade: checks.railings.atGrade, piersInLane: checks.piers.inLane,
    },
    overlap: {
      ...o, worst: o.worst.map(world), stripPairs: { ...o.stripPairs, worst: o.stripPairs.worst.map(world) },
      note: `pairs over ${PAIR_LIMIT_M2} m2: ${o.pairsOver} at junctions (a junction's faces against every strip and junction near it, and against each other), ${o.stripPairs.pairs} strip on strip with no junction involved (the lane model's own: two roads whose surfaces lie on each other at one height; the mesh builds what the lane model gives). totalM2 is the area under more than one face from the union of every face, sheet by sheet.`,
    },
    watertight: checks.watertight,
    ends: { ...checks.ends, unjoinedList: checks.ends.unjoinedList.map(world), floatingList: checks.ends.floatingList.map(world) },
    railings: { ...checks.railings, list: checks.railings.list.map(world) },
    piers: { ...checks.piers, list: checks.piers.list.map(world) },
    kerbs: { ...checks.kerbs, list: checks.kerbs.list.map(world) },
    uv: checks.uv, stopLines: checks.stopLines, oversize, notes: mesh.junctions.list, files,
  };
}

export interface MeshSite {
  id: string;
  name: string;
  /** Block metres. */
  x: number;
  z: number;
  halfM: number;
  /** Streets the eye pose may stand on (by name), nearest the middle first. */
  eye: RegExp;
}

export interface SitePose {
  name: string;
  kind: 'top' | 'eye';
  pos: [number, number, number];
  target: [number, number, number];
  size: number;
  note: string;
}

export interface SiteTile {
  tile: TileContent;
  meta: { site: string; name: string; tile: string; origin: [number, number, number]; poses: SitePose[]; probes: { x: number; y: number; z: number; what: string }[]; note: string };
  triangles: number;
}

const round = (v: number, d = 2): number => Math.round(v * 10 ** d) / 10 ** d;

/** The stand-in tile of one site: the production meshes inside its box, lane lines as strips, a ground sheet and verges. */
export function siteTile(input: MeshInput, mesh: RoadMesh, site: MeshSite): SiteTile {
  const { fs } = mesh;
  const box = { minX: site.x - site.halfM, maxX: site.x + site.halfM, minZ: site.z - site.halfM, maxZ: site.z + site.halfM };
  const inBox = (x: number, z: number): boolean => x >= box.minX && x <= box.maxX && z >= box.minZ && z <= box.maxZ;
  const extra = new Sink();
  laneLineStrips(input.strips, extra, inBox);

  // the ground sheet: under every road near it, never above one
  const CELL = 12;
  const cols = Math.ceil((box.maxX - box.minX) / CELL) + 1;
  const rows = Math.ceil((box.maxZ - box.minZ) / CELL) + 1;
  const low = new Float64Array(cols * rows).fill(Infinity);
  const REACH = 2;
  let minY = Infinity;
  input.strips.forEach((s: Strip, si: number) => {
    const kind = input.kinds[si] as ArrayLike<number>;
    s.st.forEach((st: Station, i: number) => {
      if (st.x < box.minX - 40 || st.x > box.maxX + 40 || st.z < box.minZ - 40 || st.z > box.maxZ + 40) return;
      // under a deck and over a tunnel the ground runs on; a road at grade, on fill or in an open cut is never under the sheet
      const y = (kind[i] === K_DECK || kind[i] === K_TUNNEL ? st.g : Math.min(st.h, st.g)) - 0.3;
      minY = Math.min(minY, y, st.h);
      const half = Math.max(Math.abs(st.b[0] as number), Math.abs(st.b[st.b.length - 1] as number));
      const reach = REACH + Math.ceil(half / CELL);
      const c = Math.round((st.x - box.minX) / CELL);
      const r = Math.round((st.z - box.minZ) / CELL);
      for (let i2 = Math.max(0, c - reach); i2 <= Math.min(cols - 1, c + reach); i2++) for (let j = Math.max(0, r - reach); j <= Math.min(rows - 1, r + reach); j++) if (y < (low[j * cols + i2] as number)) low[j * cols + i2] = y;
    });
  });
  if (minY === Infinity) minY = 0;
  // nodes far from every road take their neighbours' height
  for (let pass = 0; pass < cols + rows; pass++) {
    let changed = false;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        if ((low[j * cols + i] as number) < Infinity) continue;
        let sum = 0;
        let n = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as [number, number][]) {
          const v = low[(j + dj) * cols + i + di];
          if (i + di >= 0 && i + di < cols && j + dj >= 0 && j + dj < rows && v !== undefined && v < Infinity) {
            sum += v;
            n++;
          }
        }
        if (n) {
          low[j * cols + i] = sum / n;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  const G = (i: number, j: number): V3 => [box.minX + i * CELL, (low[j * cols + i] as number) < Infinity ? (low[j * cols + i] as number) : minY, box.minZ + j * CELL];
  for (let j = 0; j + 1 < rows; j++) for (let i = 0; i + 1 < cols; i++) extra.quad('ground', G(i, j), G(i + 1, j), G(i + 1, j + 1), G(i, j + 1), [0, 1, 0]);
  // a verge from every free edge of the at-grade surface down to the sheet
  for (const [key, c] of mesh.edges.at) {
    const f = mesh.edges.owner[c] as number;
    if (fs.cut[f] === CUT_NONE) continue;
    const a = Math.floor(key / 4194304);
    const b = key % 4194304;
    const twin = mesh.edges.at.get(edgeKey(b, a));
    if (twin !== undefined && fs.cut[mesh.edges.owner[twin] as number] !== CUT_NONE) continue;
    const ax = fs.vx[a] as number;
    const az = fs.vz[a] as number;
    const bx = fs.vx[b] as number;
    const bz = fs.vz[b] as number;
    if (!inBox(ax, az) && !inBox(bx, bz)) continue;
    const s = fs.start[f] as number;
    const n = fs.len[f] as number;
    const ya = fs.ys[c] as number;
    const yb = fs.ys[s + ((c - s + 1) % n)] as number;
    const len = Math.hypot(bx - ax, bz - az) || 1;
    extra.quad('ground', [ax, ya, az], [bx, yb, bz], [bx, yb - 1.6, bz], [ax, ya - 1.6, az], [(bz - az) / len, 0, -(bx - ax) / len]);
  }

  const origin: [number, number, number] = [Math.floor(box.minX), Math.floor(minY) - 4, Math.floor(box.minZ)];
  const NAME: Readonly<Record<string, string>> = { kerbface: 'kerb', parapet: 'wall' };
  const by = new Map<string, MeshData>();
  let triangles = 0;
  const take = (material: string, pos: readonly number[], nrm: readonly number[], idx: readonly number[], all: boolean): void => {
    const name = NAME[material] ?? material;
    let m = by.get(name);
    if (!m) by.set(name, (m = { name, material: name, pos: [], nrm: [], idx: [] }));
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const v = [idx[t] as number, idx[t + 1] as number, idx[t + 2] as number];
      const cx = ((pos[v[0]! * 3] as number) + (pos[v[1]! * 3] as number) + (pos[v[2]! * 3] as number)) / 3;
      const cz = ((pos[v[0]! * 3 + 2] as number) + (pos[v[1]! * 3 + 2] as number) + (pos[v[2]! * 3 + 2] as number)) / 3;
      if (!all && !inBox(cx, cz)) continue;
      const base = m.pos.length / 3;
      for (const k of v) {
        m.pos.push((pos[k * 3] as number) - origin[0], (pos[k * 3 + 1] as number) - origin[1], (pos[k * 3 + 2] as number) - origin[2]);
        m.nrm.push(nrm[k * 3] as number, nrm[k * 3 + 1] as number, nrm[k * 3 + 2] as number);
      }
      m.idx.push(base, base + 1, base + 2);
      triangles++;
    }
  };
  for (const m of mesh.sink.meshes.values()) take(m.material, m.pos, m.nrm, m.idx, false);
  for (const m of extra.meshes.values()) take(m.material, m.pos, m.nrm, m.idx, true);
  const meshes = [...by.values()].filter((m) => m.idx.length > 0);
  const colliders = colliderChunks(meshes, ['road', 'parking', 'gore', 'kerb', 'footpath', 'planter', 'median', 'wall', 'ground', 'pier']);
  const tile: TileContent = { district: site.id, tx: 0, tz: 0, size: Math.ceil(site.halfM * 2), origin, meshes, colliders, placements: [] };

  // poses: the whole site from above, north up, and driver height on a named street looking to the middle
  const loc = (x: number, y: number, z: number): [number, number, number] => [round(x - origin[0]), round(y - origin[1]), round(z - origin[2])];
  const poses: SitePose[] = [];
  let ground = minY + 0.3;
  let best: { st: Station; d: number; s: Strip; k: number } | null = null;
  const probes: SiteTile['meta']['probes'] = [];
  input.strips.forEach((s: Strip, si: number) => {
    const kind = input.kinds[si] as ArrayLike<number>;
    const k = s.lanes.findIndex((l: LaneDef) => l.type === 'drive');
    if (k < 0) return;
    const mid = Math.floor(s.st.length / 2);
    const m = s.st[mid] as Station;
    // probes stand well inside the tile: at its edge the triangle under one may belong to the next tile
    if (Math.abs(m.x - site.x) < site.halfM - 12 && Math.abs(m.z - site.z) < site.halfM - 12 && si % 7 === 0 && probes.length < 40 && (m.b[k] as number) - (m.b[k + 1] as number) > 1 && s.st.length > 3) {
      const lat = ((m.b[k] as number) + (m.b[k + 1] as number)) / 2;
      probes.push({ x: round(m.x + m.nx * lat - origin[0], 3), y: round(m.h - origin[1], 4), z: round(m.z + m.nz * lat - origin[2], 3), what: `${s.id} lane ${k}` });
    }
    if (!site.eye.test(s.name)) return;
    s.st.forEach((st: Station, i: number) => {
      if (kind[i] !== K_GRADE) return;
      const d = Math.hypot(st.x - site.x, st.z - site.z);
      // far enough out to see the junctions in the middle, near enough to stay in the tile
      const want = Math.abs(d - Math.min(90, site.halfM * 0.35));
      if (d < site.halfM * 0.8 && (!best || want < best.d)) best = { st, d: want, s, k };
    });
  });
  const centre = input.strips.flatMap((s: Strip) => s.st).reduce<Station | null>((a, st) => (!a || Math.hypot(st.x - site.x, st.z - site.z) < Math.hypot(a.x - site.x, a.z - site.z) ? st : a), null);
  if (centre) ground = centre.g;
  poses.push({ name: 'top', kind: 'top', pos: loc(site.x, ground + 500, site.z), target: loc(site.x, ground, site.z), size: round(site.halfM * 2 * 1.02, 1), note: `${site.name} from above, north up` });
  const b = best as { st: Station; d: number; s: Strip; k: number } | null;
  if (b) {
    const lat = ((b.st.b[b.k] as number) + (b.st.b[b.k + 1] as number)) / 2;
    const x = b.st.x + b.st.nx * lat;
    const z = b.st.z + b.st.nz * lat;
    // along the street, in the direction that leads towards the middle of the site
    const sign = -b.st.nz * (site.x - x) + b.st.nx * (site.z - z) >= 0 ? 1 : -1;
    poses.push({ name: 'eye', kind: 'eye', pos: loc(x, b.st.h + 1.5, z), target: loc(x - b.st.nz * sign * 40, b.st.h + 0.8, z + b.st.nx * sign * 40), size: 62, note: `driver height on ${b.s.name}, looking along it towards the middle of the site` });
  }
  return {
    tile, triangles,
    meta: {
      site: site.id, name: site.name, tile: `${site.id}.ktl`, origin, poses, probes,
      note: 'Cut from the production road mesh (tools/bake/mesh/, the bake step mesh). Stand-in only: lane lines drawn as strips from the lane UV codes, a ground sheet under the roads with a verge down to it (the real ground is the terrain step).',
    },
  };
}
