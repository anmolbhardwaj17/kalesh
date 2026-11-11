// The map edge (ARCH_OPTIONS DC2; MAP_REPAIR.md "The map edge"): cuts roads at an outline ring and finds the boundary
// ports, the places where a carriageway crosses the ring. In the signed seamless map this is used only where the map
// really ends: at a stage outline, at the outer edge of a block and at the end of a corridor. Focus districts inside a
// block are never cut (streets run on through them). Moved here in P1-008 from the Phase 0 stitch bench
// (tools/bake/stitch/clip.ts), where every district was an island with ports all round. Also the ring helpers the
// layout gates use (overlap and gap of placed outlines). Rings are open lists of points (no repeated first point) in
// any frame; all functions here are plane geometry in metres.
import { boxOf, boxesMeet, pointInRing, pointSegment, ringArea, segmentSegment, triangulate } from '../geom.ts';
import type { Box2, P2 } from '../geom.ts';
import { ROAD_CLASSES } from '../osm.ts';
import type { Road } from '../osm.ts';
import { overlapArea } from '../roads/trigrid.ts';

/** A rectangle ring around a centre: width along x, height along z. */
export function rectRing(centre: P2, width: number, height: number): P2[] {
  const w = width / 2;
  const h = height / 2;
  return [{ x: centre.x - w, z: centre.z - h }, { x: centre.x + w, z: centre.z - h }, { x: centre.x + w, z: centre.z + h }, { x: centre.x - w, z: centre.z + h }];
}

export function ringLength(ring: readonly P2[]): number {
  let len = 0;
  for (let i = 0; i < ring.length; i++) len += Math.hypot((ring[(i + 1) % ring.length] as P2).x - (ring[i] as P2).x, (ring[(i + 1) % ring.length] as P2).z - (ring[i] as P2).z);
  return len;
}

/** Closest point of a ring to p: its distance, the arc length along the ring from point 0, and the segment. */
export function ringProject(ring: readonly P2[], p: P2): { d: number; s: number; seg: number; x: number; z: number } {
  let best = { d: Infinity, s: 0, seg: 0, x: 0, z: 0 };
  let at = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as P2;
    const b = ring[(i + 1) % ring.length] as P2;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const q = pointSegment(p, a, b);
    if (q.d < best.d) best = { d: q.d, s: at + q.t * len, seg: i, x: q.x, z: q.z };
    at += len;
  }
  return best;
}

/** The point of a ring at arc length s (wraps around) and the unit normal pointing out of the ring there. */
export function ringAt(ring: readonly P2[], s: number): { x: number; z: number; nx: number; nz: number } {
  const total = ringLength(ring);
  let left = ((s % total) + total) % total;
  const pos = ringArea(ring) > 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as P2;
    const b = ring[(i + 1) % ring.length] as P2;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (left <= len || i === ring.length - 1) {
      const t = len === 0 ? 0 : Math.min(1, left / len);
      const tx = len === 0 ? 1 : (b.x - a.x) / len;
      const tz = len === 0 ? 0 : (b.z - a.z) / len;
      // a ring of positive area (clockwise with north up, geom.ringArea) has its outside at (tz, -tx) of its direction
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, nx: pos ? tz : -tz, nz: pos ? -tx : tx };
    }
    left -= len;
  }
  return { x: (ring[0] as P2).x, z: (ring[0] as P2).z, nx: 0, nz: -1 };
}

/** Ramer-Douglas-Peucker on an open line. */
export function simplify(pts: readonly P2[], tol: number): P2[] {
  if (pts.length < 3) return pts.map((p) => ({ x: p.x, z: p.z }));
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop() as [number, number];
    let worst = -1;
    let dMax = tol;
    for (let k = i + 1; k < j; k++) {
      const d = pointSegment(pts[k] as P2, pts[i] as P2, pts[j] as P2).d;
      if (d > dMax) {
        dMax = d;
        worst = k;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([i, worst], [worst, j]);
    }
  }
  return pts.filter((_, k) => keep[k] === 1).map((p) => ({ x: p.x, z: p.z }));
}

/**
 * A ring grown outwards by d metres (d may be negative). Every point of the densified ring is pushed along its
 * normal; a pushed point that ends up closer than d to the ring (the loop a concave corner makes) is dropped.
 */
export function offsetRing(ring: readonly P2[], d: number, step = 5): P2[] {
  const total = ringLength(ring);
  const n = Math.max(8, Math.ceil(total / step));
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const s = (i / n) * total;
    const a = ringAt(ring, s - 0.5 * step);
    const b = ringAt(ring, s + 0.5 * step);
    const here = ringAt(ring, s);
    let nx = a.nx + b.nx;
    let nz = a.nz + b.nz;
    const len = Math.hypot(nx, nz);
    if (len < 1e-6) continue;
    nx /= len;
    nz /= len;
    const p = { x: here.x + nx * d, z: here.z + nz * d };
    if (ringProject(ring, p).d >= Math.abs(d) * 0.97) out.push(p);
  }
  const closed = simplify([...out, out[0] as P2], Math.min(1, Math.abs(d) / 20));
  closed.pop();
  return removeLoops(closed);
}

/** Cuts the small loops off a ring that crosses itself: at every crossing the shorter side is dropped. */
export function removeLoops(ring: readonly P2[]): P2[] {
  let pts = ring.map((p) => ({ x: p.x, z: p.z }));
  for (let guard = 0; guard < 200; guard++) {
    let cut = false;
    const n = pts.length;
    search: for (let i = 0; i < n; i++) {
      const a = pts[i] as P2;
      const b = pts[(i + 1) % n] as P2;
      for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const c = pts[j] as P2;
        const e = pts[(j + 1) % n] as P2;
        const rx = b.x - a.x;
        const rz = b.z - a.z;
        const sx = e.x - c.x;
        const sz = e.z - c.z;
        const den = rx * sz - rz * sx;
        if (Math.abs(den) < 1e-12) continue;
        const t = ((c.x - a.x) * sz - (c.z - a.z) * sx) / den;
        const u = ((c.x - a.x) * rz - (c.z - a.z) * rx) / den;
        if (t <= 1e-6 || t >= 1 - 1e-6 || u <= 1e-6 || u >= 1 - 1e-6) continue;
        const x = { x: a.x + rx * t, z: a.z + rz * t };
        // the ring is 0..i, X, j+1..n-1 with the loop i+1..j cut off, or the other way round
        const inner = pts.slice(i + 1, j + 1);
        const outer = [...pts.slice(0, i + 1), x, ...pts.slice(j + 1)];
        pts = ringLength(inner) < ringLength(outer) ? outer : [x, ...inner];
        cut = true;
        break search;
      }
    }
    if (!cut) break;
  }
  return pts;
}

export interface Crossing extends P2 {
  road: Road;
  /** Unit vector along the road, pointing out of the ring. */
  dx: number;
  dz: number;
  /** Metres along the road. */
  at: number;
}

export interface ClipResult {
  /** Road pieces inside the ring. */
  inside: { road: Road; pts: P2[] }[];
  crossings: Crossing[];
  /** Short stretches of a road outside the ring between two stretches inside it: kept, no port. */
  excursions: number;
  /** Short stretches inside the ring of a road that otherwise runs outside: dropped, no port. */
  nicks: number;
}

export interface ClipOptions {
  /** A road that leaves the ring and is back inside within this many metres stays whole (the far carriageway of the street the ring follows). */
  excursionMax: number;
  /** A road that is inside for less than this many metres between two crossings is left out. */
  nickMax: number;
}

export const CLIP_DEFAULTS: ClipOptions = { excursionMax: 160, nickMax: 15 };

/**
 * Cuts every road at the ring. A crossing is where a kept piece ends on the ring.
 * A short piece inside the ring is a nick (dropped) only when the road comes in and goes out again, or when it
 * starts there on its own: a way that begins at a node it shares with another road just inside the line is the
 * way out of the district for that road, however short its inside piece is.
 */
export function clipRoads(roads: readonly Road[], ring: readonly P2[], opts: ClipOptions = CLIP_DEFAULTS): ClipResult {
  const out: ClipResult = { inside: [], crossings: [], excursions: 0, nicks: 0 };
  const box = boxOf(ring);
  const segBoxes: Box2[] = ring.map((a, i) => boxOf([a, ring[(i + 1) % ring.length] as P2]));
  // how many roads use each node: an end node used by two roads is a joint, not a loose end
  const uses = new Map<number, number>();
  for (const road of roads) for (const id of new Set(road.nodes)) uses.set(id, (uses.get(id) ?? 0) + 1);
  const joint = (id: number | undefined): boolean => id !== undefined && (uses.get(id) ?? 0) > 1;
  for (const road of roads) {
    if (!boxesMeet(road.box, box)) continue;
    const pts = road.pts;
    // cuts along the road, in order
    const cuts: { at: number; x: number; z: number }[] = [];
    let run = 0;
    const cum = [0];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i] as P2;
      const b = pts[i + 1] as P2;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const sb = boxOf([a, b]);
      for (let k = 0; k < ring.length; k++) {
        if (!boxesMeet(sb, segBoxes[k] as Box2)) continue;
        const c = ring[k] as P2;
        const d = ring[(k + 1) % ring.length] as P2;
        const rx = b.x - a.x;
        const rz = b.z - a.z;
        const sx = d.x - c.x;
        const sz = d.z - c.z;
        const den = rx * sz - rz * sx;
        if (Math.abs(den) < 1e-12) continue;
        const t = ((c.x - a.x) * sz - (c.z - a.z) * sx) / den;
        const u = ((c.x - a.x) * rz - (c.z - a.z) * rx) / den;
        // half-open on both: a crossing exactly on a vertex is counted once
        if (t < 0 || t >= 1 || u < 0 || u >= 1) continue;
        cuts.push({ at: run + t * len, x: a.x + rx * t, z: a.z + rz * t });
      }
      run += len;
      cum.push(run);
    }
    cuts.sort((p, q) => p.at - q.at);
    const startsInside = pointInRing(pts[0] as P2, ring);
    if (cuts.length === 0) {
      if (startsInside) out.inside.push({ road, pts: pts.map((p) => ({ x: p.x, z: p.z })) });
      continue;
    }
    // pieces between cuts, alternating inside and outside
    interface Piece { from: number; to: number; inside: boolean }
    let pieces: Piece[] = [];
    let state = startsInside;
    let from = 0;
    for (const c of cuts) {
      pieces.push({ from, to: c.at, inside: state });
      from = c.at;
      state = !state;
    }
    pieces.push({ from, to: run, inside: state });
    // an excursion: outside, short, inside on both sides
    for (let i = 1; i + 1 < pieces.length; i++) {
      const p = pieces[i] as Piece;
      if (!p.inside && p.to - p.from <= opts.excursionMax && (pieces[i - 1] as Piece).inside && (pieces[i + 1] as Piece).inside) {
        p.inside = true;
        out.excursions++;
      }
    }
    // a nick: inside, very short, outside on both sides (or a loose end of the way: no other road joins it there)
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i] as Piece;
      const before = i > 0 ? (pieces[i - 1] as Piece).inside : joint(road.nodes[0]);
      const after = i + 1 < pieces.length ? (pieces[i + 1] as Piece).inside : joint(road.nodes[road.nodes.length - 1]);
      if (p.inside && p.to - p.from <= opts.nickMax && !before && !after && pieces.length > 1) {
        p.inside = false;
        out.nicks++;
      }
    }
    // join neighbours of one kind
    const joined: Piece[] = [];
    for (const p of pieces) {
      const last = joined[joined.length - 1];
      if (last && last.inside === p.inside) last.to = p.to;
      else joined.push({ ...p });
    }
    pieces = joined;
    const pointAt = (at: number): P2 => {
      let i = 0;
      while (i + 2 < cum.length && (cum[i + 1] as number) < at) i++;
      const a = pts[i] as P2;
      const b = pts[i + 1] as P2;
      const len = (cum[i + 1] as number) - (cum[i] as number);
      const t = len === 0 ? 0 : (at - (cum[i] as number)) / len;
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
    };
    const dirAt = (at: number, sign: 1 | -1): { dx: number; dz: number } => {
      const a = pointAt(Math.max(0, at - 4));
      const b = pointAt(Math.min(run, at + 4));
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      return { dx: (sign * (b.x - a.x)) / len, dz: (sign * (b.z - a.z)) / len };
    };
    for (let i = 0; i < pieces.length; i++) {
      const p = pieces[i] as Piece;
      if (!p.inside || p.to - p.from < 1e-6) continue;
      const line: P2[] = [pointAt(p.from)];
      for (let k = 0; k < pts.length; k++) if ((cum[k] as number) > p.from + 1e-9 && (cum[k] as number) < p.to - 1e-9) line.push({ x: (pts[k] as P2).x, z: (pts[k] as P2).z });
      line.push(pointAt(p.to));
      out.inside.push({ road, pts: line });
      // the piece ends on the ring where it has a neighbour outside
      if (i > 0) out.crossings.push({ ...pointAt(p.from), road, at: p.from, ...dirAt(p.from, -1) });
      if (i + 1 < pieces.length) out.crossings.push({ ...pointAt(p.to), road, at: p.to, ...dirAt(p.to, 1) });
    }
  }
  return out;
}

export interface Port extends P2 {
  id: string;
  /** Unit vector pointing out of the outline along the road. */
  dx: number;
  dz: number;
  cls: string;
  link: boolean;
  name: string;
  ways: string[];
  /** Carriageway width of all its ways together, metres. */
  width: number;
  /** Arc length along the clip ring. */
  s: number;
  /** A big road (secondary and up): it needs an authored connector. */
  big: boolean;
}

const BIG = new Set(['motorway', 'trunk', 'primary', 'secondary']);
export const isBigClass = (cls: string): boolean => BIG.has(cls);
const classRank = (cls: string): number => {
  const i = (ROAD_CLASSES as readonly string[]).indexOf(cls);
  return i < 0 ? 99 : i;
};

/**
 * Ports of a ring: crossings that lie close together and leave the same way are one port (the two carriageways of
 * a street, a slip road beside its main line).
 */
export function mergePorts(crossings: readonly Crossing[], ring: readonly P2[], prefix: string, joinDist = 32): Port[] {
  const parent = crossings.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i] as number] as number;
      i = parent[i] as number;
    }
    return i;
  };
  for (let i = 0; i < crossings.length; i++) {
    for (let j = i + 1; j < crossings.length; j++) {
      const a = crossings[i] as Crossing;
      const b = crossings[j] as Crossing;
      if (Math.hypot(a.x - b.x, a.z - b.z) > joinDist) continue;
      if (a.dx * b.dx + a.dz * b.dz < 0.5) continue;
      // a lane beside an arterial is its own port: only roads of one kind join
      if (isBigClass(a.road.cls) !== isBigClass(b.road.cls)) continue;
      parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Crossing[]>();
  crossings.forEach((c, i) => {
    const r = find(i);
    const list = groups.get(r);
    if (list) list.push(c);
    else groups.set(r, [c]);
  });
  const ports: Port[] = [];
  for (const list of groups.values()) {
    const x = list.reduce((s, c) => s + c.x, 0) / list.length;
    const z = list.reduce((s, c) => s + c.z, 0) / list.length;
    let dx = list.reduce((s, c) => s + c.dx, 0);
    let dz = list.reduce((s, c) => s + c.dz, 0);
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const top = list.reduce((m, c) => (classRank(c.road.cls) < classRank(m.road.cls) || (classRank(c.road.cls) === classRank(m.road.cls) && m.road.link && !c.road.link) ? c : m));
    const name = list.map((c) => c.road.name).find((n) => n !== '') ?? '';
    ports.push({
      id: '', x, z, dx, dz, cls: top.road.cls, link: list.every((c) => c.road.link), name, ways: [...new Set(list.map((c) => c.road.id))].sort(),
      width: list.reduce((s, c) => s + c.road.width, 0), s: ringProject(ring, { x, z }).s, big: isBigClass(top.road.cls),
    });
  }
  ports.sort((a, b) => a.s - b.s);
  ports.forEach((p, i) => (p.id = `${prefix}:p${String(i).padStart(2, '0')}`));
  return ports;
}

/** Ports per road class, most important first. */
export function portsByClass(ports: readonly Port[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const cls of ROAD_CLASSES) {
    const n = ports.filter((p) => p.cls === cls).length;
    if (n > 0) out[cls] = n;
  }
  return out;
}

/** Area that two rings share, square metres (0 when they do not overlap). */
export function ringOverlapArea(a: readonly P2[], b: readonly P2[]): number {
  if (!boxesMeet(boxOf(a), boxOf(b))) return 0;
  const tris = (ring: readonly P2[]): [number, number, number][][] => {
    const idx = triangulate(ring);
    const out: [number, number, number][][] = [];
    for (let i = 0; i + 2 < idx.length; i += 3) out.push([0, 1, 2].map((k) => [(ring[idx[i + k] as number] as P2).x, 0, (ring[idx[i + k] as number] as P2).z] as [number, number, number]));
    return out;
  };
  const ta = tris(a);
  const tb = tris(b);
  let area = 0;
  for (const t of ta) for (const u of tb) area += overlapArea(t, u);
  return area;
}

/** Smallest distance between two rings, metres (0 when they touch or overlap). */
export function ringGap(a: readonly P2[], b: readonly P2[]): number {
  if (pointInRing(a[0] as P2, b) || pointInRing(b[0] as P2, a)) return 0;
  let best = Infinity;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      const d = segmentSegment(a[i] as P2, a[(i + 1) % a.length] as P2, b[j] as P2, b[(j + 1) % b.length] as P2);
      if (d < best) best = d;
    }
  }
  return best;
}
