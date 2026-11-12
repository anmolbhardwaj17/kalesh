// Draw meshes of the road faces (P1-014): the top of every face cut into triangles with the lane UV, and the faces
// that follow from the tops: wherever two faces that share an edge stand at different heights, a kerb face joins
// them (the kerb beside a lane, the edge of a raised corner, the end of a footpath against a junction), and a raised
// lane that ends with nothing after it gets an end cap. Nothing here places a kerb by rule: a kerb face exists
// because two tops differ in height, so the collider (the same triangles) matches the drawn surface by construction.
// Godot winding: clockwise seen from the side the normal points to. Pure.
import earcut from 'earcut';
import type { P2 } from '../geom.ts';
import { triangulatePolygon } from '../roads/tri.ts';
import { edgeKey, nextCorner } from './conform.ts';
import type { EdgeMap } from './conform.ts';
import { LANE_KINDS } from './faces.ts';
import type { FaceSet } from './faces.ts';

export type V3 = [number, number, number];

export interface DrawMesh {
  material: string;
  pos: number[];
  nrm: number[];
  /** Lane UV, two numbers per vertex: u across the lane (0 at its left border, 1 at its right), v metres along the road. Every top mesh has it for every vertex; empty for the other meshes (kerb faces, walls, piers). */
  uv: number[];
  /** Marking codes of the lane's left and right border (stripfaces.ts borderMarks), two numbers per vertex. */
  uv2: number[];
  idx: number[];
}

export class Sink {
  readonly meshes = new Map<string, DrawMesh>();

  get(material: string): DrawMesh {
    let m = this.meshes.get(material);
    if (!m) this.meshes.set(material, (m = { material, pos: [], nrm: [], uv: [], uv2: [], idx: [] }));
    return m;
  }

  /** A triangle with a flat normal n. `uv` holds u, v of the three corners, `marks` the two codes every corner gets. */
  tri(material: string, a: V3, b: V3, c: V3, n: V3, uv?: readonly number[], marks?: readonly [number, number]): void {
    const m = this.get(material);
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const facing = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
    const base = m.pos.length / 3;
    // Godot: for a front face (b - a) x (c - a) points away from the viewer
    const order = facing > 0 ? [0, 2, 1] : [0, 1, 2];
    const p = [a, b, c];
    for (const k of order) {
      const q = p[k] as V3;
      m.pos.push(q[0], q[1], q[2]);
      m.nrm.push(n[0], n[1], n[2]);
      if (uv) m.uv.push(uv[k * 2] as number, uv[k * 2 + 1] as number);
      if (marks) m.uv2.push(marks[0], marks[1]);
    }
    m.idx.push(base, base + 1, base + 2);
  }

  quad(material: string, a: V3, b: V3, c: V3, d: V3, n: V3): void {
    this.tri(material, a, b, c, n);
    this.tri(material, a, c, d, n);
  }

  triangles(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, m] of [...this.meshes].sort((a, b) => (a[0] < b[0] ? -1 : 1))) out[k] = m.idx.length / 3;
    return out;
  }
}

export const MATERIAL: Readonly<Record<string, string>> = {
  drive: 'road', parking: 'parking', gore: 'gore', kerb: 'kerb', footpath: 'footpath', planter: 'planter', median: 'median', junction: 'road', band: 'footpath',
};

/**
 * Triangles of a simple ring (indices into it). earcut first; it drops points on a straight edge, and a face must
 * keep every vertex (its neighbour names them), so when a vertex is missing or the area does not add up the ear
 * clipper of tri.ts, which keeps them all, takes over.
 */
export function triangulateRing(ring: readonly (readonly [number, number])[]): number[] {
  const n = ring.length;
  if (n === 3) return [0, 1, 2];
  const flat: number[] = [];
  for (const [x, z] of ring) flat.push(x, z);
  const idx = earcut(flat);
  const used = new Uint8Array(n);
  let area = 0;
  for (let k = 0; k + 2 < idx.length; k += 3) {
    const [a, b, c] = [ring[idx[k] as number], ring[idx[k + 1] as number], ring[idx[k + 2] as number]] as [readonly [number, number], readonly [number, number], readonly [number, number]];
    used[idx[k] as number] = used[idx[k + 1] as number] = used[idx[k + 2] as number] = 1;
    area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
  }
  let whole = 0;
  for (let k = 0; k < n; k++) {
    const p = ring[k] as readonly [number, number];
    const q = ring[(k + 1) % n] as readonly [number, number];
    whole += p[0] * q[1] - q[0] * p[1];
  }
  whole = Math.abs(whole) / 2;
  if (used.every((u) => u === 1) && Math.abs(area - whole) <= 1e-6 * Math.max(1, whole)) return idx;
  const pts: P2[] = ring.map(([x, z]) => ({ x, z }));
  return triangulatePolygon(pts).idx;
}

const NO_UV: readonly number[] = [0, 0, 0, 0, 0, 0];
const NO_MARKS: readonly [number, number] = [0, 0];

export interface TopReport {
  triangles: number;
  /** Triangles of strip lanes: the ones that carry a lane UV. */
  laneTriangles: number;
  /** Junction surfaces fanned from their centre (every ring edge seen from it), and faces cut by the triangulator. */
  fanned: number;
  cut: number;
}

/**
 * The top of every face. A lane quad is two triangles; a junction surface whose whole ring is seen from its centre
 * is a fan around the centre at the solved centre height; anything else goes to the triangulator. `marksOf` gives
 * the marking codes of a strip face's two borders, `centreOf` the centre of a junction piece.
 */
export function emitTops(fs: FaceSet, sink: Sink, marksOf: (piece: number, lane: number) => [number, number] | null, centreOf: (piece: number) => { x: number; z: number; h: number } | null): TopReport {
  const out: TopReport = { triangles: 0, laneTriangles: 0, fanned: 0, cut: 0 };
  const up = (a: V3, b: V3, c: V3): V3 => {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    if (ny < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    return [nx / len, ny / len, nz / len];
  };
  for (let f = 0; f < fs.faces; f++) {
    const s = fs.start[f] as number;
    const n = fs.len[f] as number;
    const kind = LANE_KINDS[fs.kind[f] as number] as string;
    const material = MATERIAL[kind] as string;
    const marks = (fs.lane[f] as number) >= 0 ? marksOf(fs.piece[f] as number, fs.lane[f] as number) : null;
    const P = (k: number): V3 => {
      const id = fs.ids[s + k] as number;
      return [fs.vx[id] as number, fs.ys[s + k] as number, fs.vz[id] as number];
    };
    // every top vertex carries a UV and two border codes; a junction surface has no lane, so zeros
    const tri = (i: number, j: number, k: number): void => {
      const a = P(i);
      const b = P(j);
      const c = P(k);
      const uv = marks ? [fs.us[s + i] as number, fs.vs[s + i] as number, fs.us[s + j] as number, fs.vs[s + j] as number, fs.us[s + k] as number, fs.vs[s + k] as number] : NO_UV;
      sink.tri(material, a, b, c, up(a, b, c), uv, marks ?? NO_MARKS);
      out.triangles++;
      if (marks) out.laneTriangles++;
    };
    if (n === 3) {
      tri(0, 1, 2);
      continue;
    }
    const ring = fs.ring(f);
    if (n === 4) {
      // a quad whose four corners all turn the same way: two triangles
      let convex = true;
      for (let k = 0; k < 4; k++) {
        const a = ring[k] as [number, number];
        const b = ring[(k + 1) % 4] as [number, number];
        const c = ring[(k + 2) % 4] as [number, number];
        if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < -1e-12) convex = false;
      }
      if (convex) {
        tri(0, 1, 2);
        tri(0, 2, 3);
        continue;
      }
    }
    const centre = kind === 'junction' ? centreOf(fs.piece[f] as number) : null;
    if (centre) {
      let star = true;
      for (let k = 0; k < n && star; k++) {
        const a = ring[k] as [number, number];
        const b = ring[(k + 1) % n] as [number, number];
        if ((a[0] - centre.x) * (b[1] - centre.z) - (a[1] - centre.z) * (b[0] - centre.x) <= 1e-9) star = false;
      }
      if (star) {
        const c: V3 = [centre.x, centre.h, centre.z];
        for (let k = 0; k < n; k++) {
          const a = P(k);
          const b = P((k + 1) % n);
          sink.tri(material, c, a, b, up(c, a, b), NO_UV, NO_MARKS);
          out.triangles++;
        }
        out.fanned++;
        continue;
      }
    }
    const idx = triangulateRing(ring);
    for (let k = 0; k + 2 < idx.length; k += 3) tri(idx[k] as number, idx[k + 1] as number, idx[k + 2] as number);
    out.cut++;
  }
  return out;
}

export interface StepReport {
  /** Kerb faces between two tops, and end caps of raised lanes. */
  faces: number;
  caps: number;
  /**
   * Heights of the kerb faces between a kerb or a raised corner and the carriageway beside it, at grade: how many
   * were sampled, the range, and how many are off 0.15 m by more than 0.01 m. Kerb faces beside a surface the polygon
   * set made are counted apart (`beside`): that surface's heights are spread from the arms' cut lines, so the step
   * to it is not the kerb's own height.
   */
  kerbs: { sampled: number; minM: number; maxM: number; off: number; list: { x: number; z: number; heightM: number }[]; beside: { sampled: number; off: number; minM: number; maxM: number } };
}

const FLUSH = new Set(['drive', 'parking', 'gore', 'junction']);

/** The faces between tops of different height along shared edges, and the end caps of raised strip lanes. */
export function emitSteps(fs: FaceSet, edges: EdgeMap, sink: Sink, kerbRaise: number, setFaces: ReadonlySet<number>): StepReport {
  const out: StepReport = { faces: 0, caps: 0, kerbs: { sampled: 0, minM: Infinity, maxM: -Infinity, off: 0, list: [], beside: { sampled: 0, off: 0, minM: Infinity, maxM: -Infinity } } };
  for (let f = 0; f < fs.faces; f++) {
    const s = fs.start[f] as number;
    const n = fs.len[f] as number;
    const raise = fs.raise[f] as number;
    const kind = LANE_KINDS[fs.kind[f] as number] as string;
    for (let k = 0; k < n; k++) {
      const c = s + k;
      const d = s + ((k + 1) % n);
      const a = fs.ids[c] as number;
      const b = fs.ids[d] as number;
      const ax = fs.vx[a] as number;
      const az = fs.vz[a] as number;
      const bx = fs.vx[b] as number;
      const bz = fs.vz[b] as number;
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-6) continue;
      // away from this face: the road is on the left of its edges
      const nrm: V3 = [(bz - az) / len, 0, -(bx - ax) / len];
      const twin = edges.at.get(edgeKey(b, a));
      if (twin === undefined) {
        // a raised strip lane that ends across the road with nothing after it
        if (raise < 1e-3 || (fs.station[f] as number) < 0 || Math.abs((fs.vs[c] as number) - (fs.vs[d] as number)) > 1e-6) continue;
        sink.quad('kerbface', [ax, fs.ys[c] as number, az], [bx, fs.ys[d] as number, bz], [bx, (fs.ys[d] as number) - raise, bz], [ax, (fs.ys[c] as number) - raise, az], nrm);
        out.caps++;
        continue;
      }
      const tf = edges.owner[twin] as number;
      const ta = fs.ys[nextCorner(fs, tf, twin)] as number;
      const tb = fs.ys[twin] as number;
      const da = (fs.ys[c] as number) - ta;
      const db = (fs.ys[d] as number) - tb;
      // the higher face of the two draws the step
      if (da + db <= 0 || Math.max(da, db) < 0.005) continue;
      sink.quad('kerbface', [ax, fs.ys[c] as number, az], [bx, fs.ys[d] as number, bz], [bx, tb, bz], [ax, ta, az], nrm);
      out.faces++;
      const other = LANE_KINDS[fs.kind[tf] as number] as string;
      if ((kind === 'kerb' || kind === 'band') && FLUSH.has(other) && fs.cut[f] === 0 && fs.cut[tf] === 0) {
        const made = setFaces.has(f) || setFaces.has(tf);
        for (const h of [da, db]) {
          if (made) {
            const b = out.kerbs.beside;
            b.sampled++;
            b.minM = Math.min(b.minM, h);
            b.maxM = Math.max(b.maxM, h);
            if (Math.abs(h - kerbRaise) > 0.01) b.off++;
            continue;
          }
          out.kerbs.sampled++;
          out.kerbs.minM = Math.min(out.kerbs.minM, h);
          out.kerbs.maxM = Math.max(out.kerbs.maxM, h);
          if (Math.abs(h - kerbRaise) > 0.01) {
            out.kerbs.off++;
            if (out.kerbs.list.length < 20) out.kerbs.list.push({ x: Math.round(ax * 10) / 10, z: Math.round(az * 10) / 10, heightM: Math.round(h * 1000) / 1000 });
          }
        }
      }
    }
  }
  if (!out.kerbs.sampled) out.kerbs.minM = out.kerbs.maxM = 0;
  const b = out.kerbs.beside;
  if (!b.sampled) b.minM = b.maxM = 0;
  b.minM = Math.round(b.minM * 1000) / 1000;
  b.maxM = Math.round(b.maxM * 1000) / 1000;
  out.kerbs.minM = Math.round(out.kerbs.minM * 10000) / 10000;
  out.kerbs.maxM = Math.round(out.kerbs.maxM * 10000) / 10000;
  return out;
}
