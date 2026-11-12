// Edges of the road mesh (P1-014): which faces meet along which edge, the T joint repair, and the boundary loops the
// ground is cut to (P1-015). A face edge from vertex a to b is shared when another face has the edge from b to a.
// A T joint is a vertex of one face lying in the middle of a free edge of another (a strip beside a junction the
// polygon set cut, a zone end against its branches): the vertex is put into that edge, so both faces name it and no
// crack can open between them. The watertight check reads what is left: free edges that do not close into loops,
// loops with no width (a seam), vertices still lying on a free edge. Pure.
import { CUT_NONE } from './faces.ts';
import type { FaceSet } from './faces.ts';

/** A vertex this close to a free edge of another face is put into the edge (m). */
export const T_JOINT_M = 0.002;
/** A vertex this close to a free edge it is not part of, but further than T_JOINT_M, is a near miss: a seam (m). */
export const NEAR_MISS_M = 0.02;

const KEY = 4194304;
export const edgeKey = (a: number, b: number): number => a * KEY + b;

export interface EdgeMap {
  /** Directed edge to the pool index of the corner it starts at. */
  at: Map<number, number>;
  /** Face of every pool index that is in use. */
  owner: Int32Array;
  /** Edges that two faces have in the same direction: faces on top of each other. */
  doubled: number;
}

export function buildEdges(fs: FaceSet): EdgeMap {
  const at = new Map<number, number>();
  const owner = new Int32Array(fs.ids.length).fill(-1);
  let doubled = 0;
  for (let f = 0; f < fs.faces; f++) {
    const s = fs.start[f] as number;
    const n = fs.len[f] as number;
    for (let k = 0; k < n; k++) {
      owner[s + k] = f;
      const key = edgeKey(fs.ids[s + k] as number, fs.ids[s + ((k + 1) % n)] as number);
      if (at.has(key)) doubled++;
      else at.set(key, s + k);
    }
  }
  return { at, owner, doubled };
}

/** The corner after pool index c in its face. */
export const nextCorner = (fs: FaceSet, face: number, c: number): number => {
  const s = fs.start[face] as number;
  return s + ((c - s + 1) % (fs.len[face] as number));
};

export interface ConformReport {
  rounds: number;
  /** Vertices put into the free edge of another face. */
  inserted: number;
  /** Vertices still within T_JOINT_M of a free edge they are not part of, after the last round. */
  tJointsLeft: number;
  /** Vertices between T_JOINT_M and NEAR_MISS_M from a free edge they are not part of, and the widest such gap. */
  nearMisses: number;
  nearMissMaxM: number;
  nearMissList: { x: number; z: number; d: number }[];
}

interface Hit {
  face: number;
  at: number;
  id: number;
  t: number;
}

function findJoints(fs: FaceSet, edges: EdgeMap, near: { n: number; max: number; list: { x: number; z: number; d: number }[] } | null): Hit[] {
  // free edges on a grid
  const CELL = 4;
  const cells = new Map<number, number[]>();
  const free: number[] = [];
  const boundary = new Set<number>();
  for (const [key, c] of edges.at) {
    const a = Math.floor(key / KEY);
    const b = key % KEY;
    if (edges.at.has(edgeKey(b, a))) continue;
    free.push(c);
    boundary.add(a);
    boundary.add(b);
    const x0 = Math.floor((Math.min(fs.vx[a] as number, fs.vx[b] as number) - NEAR_MISS_M) / CELL);
    const x1 = Math.floor((Math.max(fs.vx[a] as number, fs.vx[b] as number) + NEAR_MISS_M) / CELL);
    const z0 = Math.floor((Math.min(fs.vz[a] as number, fs.vz[b] as number) - NEAR_MISS_M) / CELL);
    const z1 = Math.floor((Math.max(fs.vz[a] as number, fs.vz[b] as number) + NEAR_MISS_M) / CELL);
    for (let x = x0; x <= x1; x++) {
      for (let z = z0; z <= z1; z++) {
        const k = (x + 100000) * 262144 + (z + 100000);
        const list = cells.get(k);
        if (list) list.push(c);
        else cells.set(k, [c]);
      }
    }
  }
  const hits: Hit[] = [];
  for (const v of boundary) {
    const x = fs.vx[v] as number;
    const z = fs.vz[v] as number;
    const list = cells.get((Math.floor(x / CELL) + 100000) * 262144 + (Math.floor(z / CELL) + 100000));
    if (!list) continue;
    for (const c of list) {
      const f = edges.owner[c] as number;
      const a = fs.ids[c] as number;
      const b = fs.ids[nextCorner(fs, f, c)] as number;
      if (a === v || b === v) continue;
      const ax = fs.vx[a] as number;
      const az = fs.vz[a] as number;
      const dx = (fs.vx[b] as number) - ax;
      const dz = (fs.vz[b] as number) - az;
      const len2 = dx * dx + dz * dz;
      if (len2 < 1e-12) continue;
      const t = ((x - ax) * dx + (z - az) * dz) / len2;
      const len = Math.sqrt(len2);
      if (t * len <= T_JOINT_M || (1 - t) * len <= T_JOINT_M) continue;
      const d = Math.abs((x - ax) * dz - (z - az) * dx) / len;
      if (d <= T_JOINT_M) hits.push({ face: f, at: c - (fs.start[f] as number), id: v, t });
      else if (near && d <= NEAR_MISS_M) {
        near.n++;
        near.max = Math.max(near.max, d);
        if (near.list.length < 40) near.list.push({ x: Math.round(x * 100) / 100, z: Math.round(z * 100) / 100, d: Math.round(d * 10000) / 10000 });
      }
    }
  }
  return hits;
}

/** Puts every vertex that lies on a free edge of another face into that edge, until none is left. */
export function conform(fs: FaceSet): ConformReport {
  const out: ConformReport = { rounds: 0, inserted: 0, tJointsLeft: 0, nearMisses: 0, nearMissMaxM: 0, nearMissList: [] };
  for (let round = 0; round < 6; round++) {
    const hits = findJoints(fs, buildEdges(fs), null);
    if (!hits.length) break;
    out.rounds++;
    // per face, edges from the last to the first, so the corner numbers before them stay
    const byFace = new Map<number, Map<number, { id: number; t: number }[]>>();
    for (const h of hits) {
      let m = byFace.get(h.face);
      if (!m) byFace.set(h.face, (m = new Map()));
      const list = m.get(h.at);
      if (list) {
        if (!list.some((e) => e.id === h.id)) list.push({ id: h.id, t: h.t });
      } else m.set(h.at, [{ id: h.id, t: h.t }]);
    }
    for (const [face, m] of byFace) {
      for (const at of [...m.keys()].sort((a, b) => b - a)) {
        const extra = m.get(at) as { id: number; t: number }[];
        fs.insert(face, at, extra);
        out.inserted += extra.length;
      }
    }
  }
  const near = { n: 0, max: 0, list: [] as { x: number; z: number; d: number }[] };
  out.tJointsLeft = findJoints(fs, buildEdges(fs), near).length;
  out.nearMisses = near.n;
  out.nearMissMaxM = Math.round(near.max * 10000) / 10000;
  out.nearMissList = near.list;
  return out;
}

export interface Loop {
  /** Vertex numbers around the loop, in the faces' own direction: the road is on the left. */
  ids: number[];
  /** Signed area (m2): positive around a road region, negative around a block the roads enclose. */
  area: number;
  perimeter: number;
}

export interface BoundaryReport {
  loops: Loop[];
  freeEdges: number;
  /** Free edges that did not close into a loop. */
  unclosed: number;
  /** Loops under a centimetre wide on average: a hairline between two pieces that nearly touch. The ground cut may drop them. */
  sliverLoops: number;
  sliverEdges: number;
  sliverM2: number;
}

/**
 * The edge of the road surface the ground is cut to: free edges of the faces the ground meets (not decks, not
 * tunnels), chained into loops. At a vertex where several loops touch the walk takes the sharpest turn towards
 * the road, so loops do not cross.
 */
export function boundaryLoops(fs: FaceSet, edges: EdgeMap): BoundaryReport {
  const meets = (f: number): boolean => fs.cut[f] !== CUT_NONE;
  const outOf = new Map<number, number[]>();
  let freeEdges = 0;
  for (const [key, c] of edges.at) {
    const f = edges.owner[c] as number;
    if (!meets(f)) continue;
    const a = Math.floor(key / KEY);
    const b = key % KEY;
    const twin = edges.at.get(edgeKey(b, a));
    if (twin !== undefined && meets(edges.owner[twin] as number)) continue;
    freeEdges++;
    const list = outOf.get(a);
    if (list) list.push(b);
    else outOf.set(a, [b]);
  }
  const used = new Set<number>();
  const loops: Loop[] = [];
  let unclosed = 0;
  let sliverLoops = 0;
  let sliverEdges = 0;
  let sliverM2 = 0;
  for (const [a0, list0] of outOf) {
    for (const b0 of list0) {
      if (used.has(edgeKey(a0, b0))) continue;
      const ids = [a0];
      let a = a0;
      let b = b0;
      used.add(edgeKey(a, b));
      let closed = false;
      for (let guard = 0; guard < 4000000; guard++) {
        if (b === a0) {
          closed = true;
          break;
        }
        ids.push(b);
        const outs = (outOf.get(b) ?? []).filter((c) => !used.has(edgeKey(b, c)));
        if (!outs.length) break;
        let next = outs[0] as number;
        if (outs.length > 1) {
          // the sharpest turn towards the road (the road is on the left of every free edge)
          const dx = (fs.vx[b] as number) - (fs.vx[a] as number);
          const dz = (fs.vz[b] as number) - (fs.vz[a] as number);
          let best = -Infinity;
          for (const c of outs) {
            const ex = (fs.vx[c] as number) - (fs.vx[b] as number);
            const ez = (fs.vz[c] as number) - (fs.vz[b] as number);
            const ang = Math.atan2(dx * ez - dz * ex, dx * ex + dz * ez);
            if (ang > best) {
              best = ang;
              next = c;
            }
          }
        }
        used.add(edgeKey(b, next));
        a = b;
        b = next;
      }
      if (!closed) {
        unclosed += ids.length;
        continue;
      }
      let area = 0;
      let perimeter = 0;
      for (let k = 0; k < ids.length; k++) {
        const p = ids[k] as number;
        const q = ids[(k + 1) % ids.length] as number;
        area += (fs.vx[p] as number) * (fs.vz[q] as number) - (fs.vx[q] as number) * (fs.vz[p] as number);
        perimeter += Math.hypot((fs.vx[q] as number) - (fs.vx[p] as number), (fs.vz[q] as number) - (fs.vz[p] as number));
      }
      area /= 2;
      if (Math.abs(area) < 0.01 * perimeter * 0.5) {
        sliverLoops++;
        sliverEdges += ids.length;
        sliverM2 += Math.abs(area);
      }
      loops.push({ ids, area, perimeter });
    }
  }
  return { loops, freeEdges, unclosed, sliverLoops, sliverEdges, sliverM2: Math.round(sliverM2 * 1000) / 1000 };
}
