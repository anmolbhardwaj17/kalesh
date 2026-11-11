// Terrain that fits the roads (ARCH_OPTIONS TF1 against TF2).
//
// TF2: the ground is what is left of the site when the at-grade road surface is taken out. The edge of that
// surface is found on the road mesh itself: every triangle edge used by one triangle only is a boundary edge, and
// the boundary edges chain into closed loops. The ground polygons are triangulated to exactly those loops and take
// the road's own heights on them, so road and ground share every edge vertex. A structure does not cut the ground:
// a deck's triangles are left out, and the ground runs on under it; a ramp on fill does cut the ground, which then
// ends at the foot of the ramp's walls.
// TF1: a height grid (2 m cells) set to the road height under the corridor, pushed down a little, with a blend
// back to the ground model over a shoulder. Both are measured the same way: the height difference between the
// road's edge and the ground beside it.
import type { P2 } from '../geom.ts';
import { pointInRing } from '../geom.ts';
import { area2, smoothstep } from './curve.ts';
import type { SurfTri } from './mesh.ts';
import { triangulatePolygon } from './tri.ts';
import { TriGrid } from './trigrid.ts';
import type { Tri3, Vec3 } from './trigrid.ts';

export interface BoundaryEdge {
  a: Vec3;
  b: Vec3;
  /** Runs across a strip (an end, the line where a structure starts), not along a road edge. */
  cross: boolean;
  /** The foot of a ramp wall: the ground ends here at ground height, the road is above it on the wall. */
  wall: boolean;
}

export interface Boundary {
  /** Closed loops of boundary vertices (x, top height, z). Positive area: the outside edge of a road region. */
  loops: Vec3[][];
  edges: BoundaryEdge[];
  /** Boundary edges that did not close into a loop: a seam in the road mesh. 0 for a watertight surface. */
  openEdges: number;
  /** Edges used by more than two triangles or twice in one direction: faces on top of each other. */
  doubledEdges: number;
}

/** The edge of the at-grade road surface, from the mesh: loops of vertices that the ground must meet. */
export function surfaceBoundary(surf: readonly SurfTri[]): Boundary {
  const ids = new Map<string, number>();
  const pos: P2[] = [];
  const vid = (p: Vec3): number => {
    const fx = p[0] * 1000;
    const fz = p[2] * 1000;
    const ix = Math.round(fx);
    const iz = Math.round(fz);
    let id = ids.get(`${ix},${iz}`);
    if (id === undefined) {
      // two copies of one vertex can round to neighbouring millimetres: look there before making a new one
      const nx = Math.abs(fx - ix) > 0.4 ? ix + Math.sign(fx - ix) : ix;
      const nz = Math.abs(fz - iz) > 0.4 ? iz + Math.sign(fz - iz) : iz;
      for (const k of [`${nx},${iz}`, `${ix},${nz}`, `${nx},${nz}`]) {
        id = ids.get(k);
        if (id !== undefined) break;
      }
    }
    if (id === undefined) {
      id = pos.length;
      ids.set(`${ix},${iz}`, id);
      pos.push({ x: p[0], z: p[2] });
    }
    return id;
  };
  interface E { from: number; to: number; ya: number; yb: number; cross: boolean; wall: boolean; n: number }
  const edges = new Map<string, E>();
  for (const t of surf) {
    if (t.cut === 'none') continue;
    const wall = t.cut === 'wall';
    let order = [0, 1, 2];
    const [a, b, c] = t.p;
    if ((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]) < 0) order = [0, 2, 1];
    const v = order.map((i) => vid(t.p[i] as Vec3));
    if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue;
    for (let k = 0; k < 3; k++) {
      const i = order[k] as number;
      const j = order[(k + 1) % 3] as number;
      const key = `${v[k]},${v[(k + 1) % 3]}`;
      const e = edges.get(key);
      if (e) e.n++;
      else edges.set(key, { from: v[k] as number, to: v[(k + 1) % 3] as number, ya: wall ? (t.gb[i] as number) : (t.p[i] as Vec3)[1], yb: wall ? (t.gb[j] as number) : (t.p[j] as Vec3)[1], cross: (t.row[i] as number) >= 0 && t.row[i] === t.row[j], wall, n: 1 });
    }
  }
  let doubled = 0;
  const free: E[] = [];
  for (const e of edges.values()) {
    if (e.n > 1) doubled++;
    if (!edges.has(`${e.to},${e.from}`)) free.push(e);
  }
  // the height the ground takes at a vertex: the top of a road edge at grade when one ends there; else the ground
  // model at the foot of a ramp wall or under a deck; else (a road end) the highest edge
  const ySide = new Map<number, number>();
  const yWall = new Map<number, number>();
  const yAny = new Map<number, number>();
  for (const e of free) {
    for (const [v, y] of [[e.from, e.ya], [e.to, e.yb]] as [number, number][]) {
      if (e.wall) yWall.set(v, Math.min(yWall.get(v) ?? Infinity, y));
      else {
        const m = e.cross ? yAny : ySide;
        m.set(v, Math.max(m.get(v) ?? -Infinity, y));
      }
    }
  }
  // a line across a road at grade where a ramp starts on the other side: only its two ends are road edge
  const yOf = (v: number): number => ySide.get(v) ?? yWall.get(v) ?? (yAny.get(v) as number);
  const out = new Map<number, E[]>();
  for (const e of free) {
    const list = out.get(e.from);
    if (list) list.push(e);
    else out.set(e.from, [e]);
  }
  const used = new Set<E>();
  const loops: Vec3[][] = [];
  let open = 0;
  for (const start of free) {
    if (used.has(start)) continue;
    const loop: number[] = [];
    let e: E | null = start;
    let closed = false;
    while (e && !used.has(e)) {
      used.add(e);
      loop.push(e.from);
      if (e.to === start.from) {
        closed = true;
        break;
      }
      const cands: E[] = (out.get(e.to) ?? []).filter((c) => !used.has(c));
      if (cands.length <= 1) e = cands[0] ?? null;
      else {
        // where two parts of the surface touch at one vertex: keep the surface on the left
        const p = pos[e.to] as P2;
        const q = pos[e.from] as P2;
        const back = Math.atan2(q.z - p.z, q.x - p.x);
        let best: E | null = null;
        let bestTurn = Infinity;
        for (const c of cands) {
          const r = pos[c.to] as P2;
          let turn = back - Math.atan2(r.z - p.z, r.x - p.x);
          while (turn <= 1e-9) turn += 2 * Math.PI;
          if (turn < bestTurn) {
            bestTurn = turn;
            best = c;
          }
        }
        e = best;
      }
    }
    if (closed && loop.length >= 3) loops.push(loop.map((v) => [(pos[v] as P2).x, yOf(v), (pos[v] as P2).z]));
    else open += loop.length;
  }
  return {
    loops, openEdges: open, doubledEdges: doubled,
    edges: free.map((e) => ({ a: [(pos[e.from] as P2).x, e.ya, (pos[e.from] as P2).z], b: [(pos[e.to] as P2).x, e.yb, (pos[e.to] as P2).z], cross: e.cross, wall: e.wall })),
  };
}

export interface GroundMesh {
  tris: [Vec3, Vec3, Vec3][];
  polygons: number;
  /** Triangles with a corner under one degree: ear clipping makes them, a production triangulator must not. */
  needles: number;
  /** Ears the triangulator had to force: 0 when every polygon was clean. */
  forced: number;
  /** Area check: the triangles' area against the polygons' area (square metres apart). */
  areaError: number;
}

/** TF2: ground polygons triangulated to the road surface's own edge vertices. */
export function buildTf2(boundary: Boundary, siteRing: readonly P2[], ground: (x: number, z: number) => number): GroundMesh {
  interface Ring { pts: P2[]; ys: number[]; area: number; site: boolean; parent: number }
  const rings: Ring[] = [{ pts: siteRing.map((p) => ({ x: p.x, z: p.z })), ys: siteRing.map((p) => ground(p.x, p.z)), area: Math.abs(area2(siteRing)), site: true, parent: -1 }];
  for (const l of boundary.loops) {
    const pts = l.map((v) => ({ x: v[0], z: v[2] }));
    rings.push({ pts, ys: l.map((v) => v[1]), area: area2(pts), site: false, parent: -1 });
  }
  // the smallest ring that holds each loop
  rings.forEach((r, i) => {
    if (r.site) return;
    const a = r.pts[0] as P2;
    const b = r.pts[1] as P2;
    const probe = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    let best = -1;
    rings.forEach((c, j) => {
      if (j === i || Math.abs(c.area) <= Math.abs(r.area)) return;
      if (!pointInRing(probe, c.pts)) return;
      if (best < 0 || Math.abs(c.area) < Math.abs((rings[best] as Ring).area)) best = j;
    });
    r.parent = best;
  });
  const out: GroundMesh = { tris: [], polygons: 0, needles: 0, forced: 0, areaError: 0 };
  rings.forEach((outer, i) => {
    // ground lies inside the site and inside every hole of the road surface (a loop of negative area)
    if (!outer.site && outer.area > 0) return;
    const holes = rings.filter((r) => !r.site && r.area > 0 && r.parent === i && r.pts.length >= 3);
    const t = triangulatePolygon(outer.pts, holes.map((h) => h.pts));
    const ys = [...outer.ys, ...holes.flatMap((h) => h.ys)];
    let area = 0;
    for (let k = 0; k + 2 < t.idx.length; k += 3) {
      const tri = [0, 1, 2].map((d) => {
        const v = t.idx[k + d] as number;
        const p = t.pts[v] as P2;
        return [p.x, ys[v] as number, p.z] as Vec3;
      }) as [Vec3, Vec3, Vec3];
      out.tris.push(tri);
      const twice = Math.abs((tri[1][0] - tri[0][0]) * (tri[2][2] - tri[0][2]) - (tri[1][2] - tri[0][2]) * (tri[2][0] - tri[0][0]));
      area += twice / 2;
      const side = (p: Vec3, q: Vec3): number => Math.hypot(q[0] - p[0], q[2] - p[2]);
      const sides = [side(tri[0], tri[1]), side(tri[1], tri[2]), side(tri[2], tri[0])].sort((p, q) => p - q);
      // the smallest corner lies opposite the shortest side: sin = 2 * area / (product of the two longer sides)
      if (twice / Math.max(1e-12, (sides[1] as number) * (sides[2] as number)) < Math.sin(Math.PI / 180)) out.needles++;
    }
    out.polygons++;
    out.forced += t.forced;
    out.areaError += Math.abs(area - (Math.abs(outer.area) - holes.reduce((s, h) => s + h.area, 0)));
  });
  return out;
}

export interface GapStats {
  samples: number;
  maxM: number;
  meanM: number;
  p95M: number;
  /** TF2: road side edges that are not an edge of any ground triangle (0 when road and ground share every edge). */
  missing: number;
  /** Triangles of the road surface with ground standing above them, and by how much at most. */
  pokeThrough: number;
  pokeMaxM: number;
  worst: { x: number; z: number; gap: number } | null;
}

function stats(gaps: { x: number; z: number; gap: number }[], missing: number, poke: number, pokeMax: number): GapStats {
  const abs = gaps.map((g) => Math.abs(g.gap)).sort((a, b) => a - b);
  const worst = gaps.reduce<{ x: number; z: number; gap: number } | null>((w, g) => (!w || Math.abs(g.gap) > Math.abs(w.gap) ? g : w), null);
  const r = (v: number): number => Math.round(v * 10000) / 10000;
  return {
    samples: abs.length, maxM: r(abs[abs.length - 1] ?? 0), meanM: r(abs.reduce((s, v) => s + v, 0) / Math.max(1, abs.length)), p95M: r(abs[Math.floor((abs.length - 1) * 0.95)] ?? 0),
    missing, pokeThrough: poke, pokeMaxM: r(pokeMax), worst: worst ? { x: r(worst.x), z: r(worst.z), gap: r(worst.gap) } : null,
  };
}

/** Sample points along the road's side edges: both ends and the middle of every boundary edge that runs along a road. */
function edgeSamples(boundary: Boundary): { p: Vec3; out: P2 }[] {
  const list: { p: Vec3; out: P2 }[] = [];
  for (const e of boundary.edges) {
    if (e.cross || e.wall) continue;
    const dx = e.b[0] - e.a[0];
    const dz = e.b[2] - e.a[2];
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    // the surface is on the left of a boundary edge (in the x, z plane), so the ground is on its right
    const out = { x: dz / len, z: -dx / len };
    for (const t of [0.02, 0.5, 0.98]) list.push({ p: [e.a[0] + dx * t, e.a[1] + (e.b[1] - e.a[1]) * t, e.a[2] + dz * t], out });
  }
  return list;
}

/**
 * Road to ground gap of TF2. Every side edge of the road surface must be an edge of a ground triangle, with the
 * same two heights: then road and ground share the edge and the gap is the height difference at its ends. An edge
 * that no ground triangle has (a T joint) is counted in `missing` and measured by sampling the ground beside it.
 */
export function gapTf2(boundary: Boundary, ground: GroundMesh): GapStats {
  const key = (p: Vec3): string => `${Math.round(p[0] * 1000)},${Math.round(p[2] * 1000)}`;
  const edges = new Map<string, [number, number]>();
  for (const t of ground.tris) {
    for (let k = 0; k < 3; k++) {
      const a = t[k] as Vec3;
      const b = t[(k + 1) % 3] as Vec3;
      edges.set(`${key(a)}|${key(b)}`, [a[1], b[1]]);
    }
  }
  const grid = new TriGrid<Tri3>(8);
  for (const t of ground.tris) grid.add({ p: t });
  const gaps: { x: number; z: number; gap: number }[] = [];
  let missing = 0;
  for (const e of boundary.edges) {
    if (e.cross || e.wall) continue;
    const hit = edges.get(`${key(e.a)}|${key(e.b)}`);
    const back = edges.get(`${key(e.b)}|${key(e.a)}`);
    if (hit || back) {
      const ya = hit ? hit[0] : (back as [number, number])[1];
      const yb = hit ? hit[1] : (back as [number, number])[0];
      gaps.push({ x: e.a[0], z: e.a[2], gap: e.a[1] - ya }, { x: e.b[0], z: e.b[2], gap: e.b[1] - yb });
      continue;
    }
    missing++;
    const dx = e.b[0] - e.a[0];
    const dz = e.b[2] - e.a[2];
    const len = Math.hypot(dx, dz) || 1;
    for (const t of [0.02, 0.5, 0.98]) {
      const p: Vec3 = [e.a[0] + dx * t, e.a[1] + (e.b[1] - e.a[1]) * t, e.a[2] + dz * t];
      const hits = grid.heightsAt(p[0] + (dz / len) * 0.001, p[2] - (dx / len) * 0.001, 1e-6);
      if (hits.length === 0) continue;
      const y = hits.reduce((best, h) => (Math.abs(h.y - p[1]) < Math.abs(best - p[1]) ? h.y : best), (hits[0] as { y: number }).y);
      gaps.push({ x: p[0], z: p[2], gap: p[1] - y });
    }
  }
  return stats(gaps, missing, 0, 0);
}

export interface Tf1Result {
  cell: number;
  cols: number;
  rows: number;
  triangles: number;
  gap: GapStats;
  heights: Float32Array;
  minX: number;
  minZ: number;
}

/**
 * TF1: a height grid over the site, flattened under the road corridor (0.1 m under the surface), with a blend
 * back to the ground model over `shoulder` metres, and its gap to the road edges.
 */
export function buildTf1(surf: readonly SurfTri[], boundary: Boundary, siteRing: readonly P2[], ground: (x: number, z: number) => number, cell = 2, shoulder = 6, push = 0.1): Tf1Result {
  const minX = Math.floor(Math.min(...siteRing.map((p) => p.x)) / cell) * cell;
  const minZ = Math.floor(Math.min(...siteRing.map((p) => p.z)) / cell) * cell;
  const cols = Math.ceil((Math.max(...siteRing.map((p) => p.x)) - minX) / cell) + 1;
  const rows = Math.ceil((Math.max(...siteRing.map((p) => p.z)) - minZ) / cell) + 1;
  const grid = new TriGrid<SurfTri>(6);
  for (const t of surf) if (t.atGrade) grid.add(t);
  // road edge samples in buckets, for the shoulder blend
  const buckets = new Map<string, Vec3[]>();
  const samples = edgeSamples(boundary);
  for (const s of samples) {
    const key = `${Math.floor(s.p[0] / shoulder)},${Math.floor(s.p[2] / shoulder)}`;
    const list = buckets.get(key);
    if (list) list.push(s.p);
    else buckets.set(key, [s.p]);
  }
  const heights = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = minX + i * cell;
      const z = minZ + j * cell;
      const g = ground(x, z);
      const hits = grid.heightsAt(x, z);
      if (hits.length) {
        heights[j * cols + i] = Math.min(...hits.map((h) => h.y)) - push;
        continue;
      }
      let best = Infinity;
      let y = g;
      const ci = Math.floor(x / shoulder);
      const cj = Math.floor(z / shoulder);
      for (let a = ci - 1; a <= ci + 1; a++) {
        for (let b = cj - 1; b <= cj + 1; b++) {
          for (const p of buckets.get(`${a},${b}`) ?? []) {
            const d = Math.hypot(p[0] - x, p[2] - z);
            if (d < best) {
              best = d;
              y = p[1];
            }
          }
        }
      }
      heights[j * cols + i] = best < shoulder ? y + (g - y) * smoothstep(best / shoulder) : g;
    }
  }
  // the grid as its two triangles per cell would draw it
  const at = (x: number, z: number): number => {
    const fx = (x - minX) / cell;
    const fz = (z - minZ) / cell;
    const i = Math.max(0, Math.min(cols - 2, Math.floor(fx)));
    const j = Math.max(0, Math.min(rows - 2, Math.floor(fz)));
    const u = fx - i;
    const v = fz - j;
    const h00 = heights[j * cols + i] as number;
    const h10 = heights[j * cols + i + 1] as number;
    const h01 = heights[(j + 1) * cols + i] as number;
    const h11 = heights[(j + 1) * cols + i + 1] as number;
    return u + v <= 1 ? h00 + (h10 - h00) * u + (h01 - h00) * v : h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  };
  const gaps = samples.map((s) => ({ x: s.p[0], z: s.p[2], gap: s.p[1] - at(s.p[0] + s.out.x * 0.01, s.p[2] + s.out.z * 0.01) }));
  let poke = 0;
  let pokeMax = 0;
  for (const t of surf) {
    if (!t.atGrade) continue;
    const cx = (t.p[0][0] + t.p[1][0] + t.p[2][0]) / 3;
    const cy = (t.p[0][1] + t.p[1][1] + t.p[2][1]) / 3;
    const cz = (t.p[0][2] + t.p[1][2] + t.p[2][2]) / 3;
    const over = at(cx, cz) - cy;
    if (over > 0.005) {
      poke++;
      pokeMax = Math.max(pokeMax, over);
    }
  }
  return { cell, cols, rows, triangles: (cols - 1) * (rows - 1) * 2, gap: stats(gaps, 0, poke, pokeMax), heights, minX, minZ };
}
