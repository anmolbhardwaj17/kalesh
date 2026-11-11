// Meshes of the road model: every strip and junction becomes top surfaces (kept as triangles with what they are,
// for the checks and the terrain) plus the faces that follow from them: kerb faces between lanes of different
// height, parapets and side walls on structures, deck undersides, piers, lane markings. Kerbs, parapets and walls
// come from the same lane borders as the carriageway, so the collider (all of these triangles) matches the drawn
// surface by construction. Godot winding and normals are handled by tile.ts MeshBuilder.
import type { P2 } from '../geom.ts';
import { MeshBuilder } from '../tile.ts';
import type { ColliderChunk, MeshData } from '../tile.ts';
import { area2, lerp, smoothstep } from './curve.ts';
import { DECK_DEPTH, KERB_RAISE, PARAPET_RAISE } from './model.ts';
import type { Junction, LaneDef, LaneType, Station, Strip } from './model.ts';
import { triangulatePolygon } from './tri.ts';
import { TriGrid, triArea } from './trigrid.ts';
import type { Vec3 } from './trigrid.ts';

export interface SurfTri {
  p: [Vec3, Vec3, Vec3];
  /** Carriageway height under the triangle's corners (without any raise), averaged. */
  hb: number;
  /** Strip number, or strips.length + junction number. */
  piece: number;
  lane: LaneType | 'junction' | 'band';
  atGrade: boolean;
  /** Per corner: piece * 100000 + station for a strip vertex, -1 otherwise. An edge with two equal tags runs across a strip. */
  row: [number, number, number];
  /**
   * How the ground meets this piece of road: 'edge' the ground ends at its edge at the edge's own height (at grade);
   * 'wall' it stands on fill between walls, the ground ends at the foot of the wall (ground model height, `gb`);
   * 'none' a deck: the ground runs on under it.
   */
  cut: 'edge' | 'wall' | 'none';
  /** Ground model height under each corner. */
  gb: [number, number, number];
}

export const borderPoint = (st: Station, k: number): P2 => ({ x: st.x + st.nx * (st.b[k] as number), z: st.z + st.nz * (st.b[k] as number) });

/** Height of the edge kerb at a station: a kerb at grade, growing into a parapet as the road leaves the ground. */
export function edgeRaise(st: Station): number {
  if (st.structure === 0) return KERB_RAISE;
  return KERB_RAISE + (PARAPET_RAISE - KERB_RAISE) * smoothstep((st.h - st.g - 0.6) / 1.2);
}

export function laneRaise(lanes: readonly LaneDef[], k: number, st: Station): number {
  const l = lanes[k] as LaneDef;
  if (l.type === 'kerb' && (k === 0 || k === lanes.length - 1)) return edgeRaise(st);
  return l.raise;
}

const MATERIAL: Readonly<Record<string, string>> = {
  drive: 'road', parking: 'parking', gore: 'gore', kerb: 'kerb', footpath: 'footpath', planter: 'planter', median: 'median', junction: 'road', band: 'footpath',
};

export class MeshSet {
  readonly builders = new Map<string, MeshBuilder>();
  /** Triangles that only the collider gets are kept apart from the drawn ones by name. */
  get(material: string): MeshBuilder {
    let b = this.builders.get(material);
    if (!b) {
      b = new MeshBuilder(material, material);
      this.builders.set(material, b);
    }
    return b;
  }

  meshes(): MeshData[] {
    return [...this.builders.values()].map((b) => b.mesh).filter((m) => m.idx.length > 0);
  }
}

const up = (a: Vec3, b: Vec3, c: Vec3): Vec3 => {
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

export interface SurfaceResult {
  surf: SurfTri[];
  set: MeshSet;
  /** Junctions whose ring could not be fanned from the centre and was ear clipped instead. */
  earClipped: number;
  /** Ears the triangulator had to force in junction rings and corner bands: 0 for clean rings. */
  forced: number;
}

/** Top surfaces and the faces that hang off them, for every strip and junction. */
export function buildSurfaces(strips: readonly Strip[], junctions: readonly Junction[]): SurfaceResult {
  const set = new MeshSet();
  const surf: SurfTri[] = [];
  const top = (a: Vec3, b: Vec3, c: Vec3, hb: number, piece: number, lane: SurfTri['lane'], atGrade: boolean, row: [number, number, number], cut: SurfTri['cut'] = 'edge', gb: [number, number, number] = [a[1], b[1], c[1]]): void => {
    if (triArea(a, b, c) < 1e-8) return;
    surf.push({ p: [a, b, c], hb, piece, lane, atGrade, row, cut, gb });
    set.get(MATERIAL[lane] as string).tri(a, b, c, up(a, b, c));
  };
  strips.forEach((s, si) => {
    const L = s.lanes.length;
    for (let i = 0; i + 1 < s.st.length; i++) {
      const p = s.st[i] as Station;
      const q = s.st[i + 1] as Station;
      const atGrade = p.structure === 0 && q.structure === 0;
      const cut: SurfTri['cut'] = atGrade ? 'edge' : p.structure === 2 || q.structure === 2 ? 'none' : 'wall';
      const rp = si * 100000 + i;
      const rq = rp + 1;
      const hb = (p.h + q.h) / 2;
      for (let k = 0; k < L; k++) {
        const wp = (p.b[k] as number) - (p.b[k + 1] as number);
        const wq = (q.b[k] as number) - (q.b[k + 1] as number);
        if (wp < 1e-4 && wq < 1e-4) continue;
        const r0 = laneRaise(s.lanes, k, p);
        const r1 = laneRaise(s.lanes, k, q);
        const a0 = borderPoint(p, k);
        const b0 = borderPoint(p, k + 1);
        const a1 = borderPoint(q, k);
        const b1 = borderPoint(q, k + 1);
        const A: Vec3 = [a0.x, p.h + r0, a0.z];
        const B: Vec3 = [b0.x, p.h + r0, b0.z];
        const C: Vec3 = [b1.x, q.h + r1, b1.z];
        const D: Vec3 = [a1.x, q.h + r1, a1.z];
        const type = (s.lanes[k] as LaneDef).type;
        top(A, B, C, hb, si, type, atGrade, [rp, rp, rq], cut, [p.g, p.g, q.g]);
        top(A, C, D, hb, si, type, atGrade, [rp, rq, rq], cut, [p.g, q.g, q.g]);
        // the face down to the next lane when that one is lower or higher
        if (k + 1 < L) {
          const n0 = laneRaise(s.lanes, k + 1, p);
          const n1 = laneRaise(s.lanes, k + 1, q);
          if (Math.abs(n0 - r0) > 1e-4 || Math.abs(n1 - r1) > 1e-4) {
            const sign = r0 + r1 > n0 + n1 ? -1 : 1;
            set.get('kerb').quad([b0.x, p.h + r0, b0.z], [b1.x, q.h + r1, b1.z], [b1.x, q.h + n1, b1.z], [b0.x, p.h + n0, b0.z], [p.nx * sign, 0, p.nz * sign]);
          }
        }
      }
      // structures: side walls from the top of the outer lanes down, and the underside of a deck
      if (!atGrade) {
        const bottom = (st: Station): number => (st.structure === 2 ? st.h - DECK_DEPTH : st.structure === 1 ? st.g - 0.6 : st.h - 0.6);
        for (const [k, lane, sign] of [[0, 0, 1], [L, L - 1, -1]] as [number, number, number][]) {
          const e0 = borderPoint(p, k);
          const e1 = borderPoint(q, k);
          set.get('wall').quad([e0.x, p.h + laneRaise(s.lanes, lane, p), e0.z], [e1.x, q.h + laneRaise(s.lanes, lane, q), e1.z], [e1.x, bottom(q), e1.z], [e0.x, bottom(p), e0.z], [p.nx * sign, 0, p.nz * sign]);
        }
        if (p.structure === 2 && q.structure === 2) {
          const l0 = borderPoint(p, 0);
          const r0 = borderPoint(p, L);
          const l1 = borderPoint(q, 0);
          const r1 = borderPoint(q, L);
          set.get('underside').quad([l0.x, p.h - DECK_DEPTH, l0.z], [r0.x, p.h - DECK_DEPTH, r0.z], [r1.x, q.h - DECK_DEPTH, r1.z], [l1.x, q.h - DECK_DEPTH, l1.z], [0, -1, 0]);
        }
        // the cross wall where a walled ramp becomes a deck, seen from under the deck
        if (p.structure !== q.structure && (p.structure === 2 || q.structure === 2)) {
          const at = p.structure === 2 ? q : p;
          const l = borderPoint(at, 0);
          const r = borderPoint(at, L);
          const tx = q.x - p.x;
          const tz = q.z - p.z;
          const len = Math.hypot(tx, tz) || 1;
          for (const sgn of [1, -1]) set.get('wall').quad([l.x, at.h - 0.05, l.z], [r.x, at.h - 0.05, r.z], [r.x, at.g - 0.6, r.z], [l.x, at.g - 0.6, l.z], [(tx / len) * sgn, 0, (tz / len) * sgn]);
        }
      }
    }
    // end caps of raised lanes, so a kerb or parapet that starts or ends is closed
    for (const i of [0, s.st.length - 1]) {
      const st = s.st[i] as Station;
      const other = s.st[i === 0 ? 1 : i - 1] as Station;
      // away from the strip at this end
      const tx = st.x - other.x;
      const tz = st.z - other.z;
      const len = Math.hypot(tx, tz) || 1;
      for (let k = 0; k < L; k++) {
        const r = laneRaise(s.lanes, k, st);
        if (r < 1e-4 || (st.b[k] as number) - (st.b[k + 1] as number) < 1e-4) continue;
        const a = borderPoint(st, k);
        const b = borderPoint(st, k + 1);
        set.get('kerb').quad([a.x, st.h + r, a.z], [b.x, st.h + r, b.z], [b.x, st.h, b.z], [a.x, st.h, a.z], [tx / len, 0, tz / len]);
      }
    }
  });

  let earClipped = 0;
  let forced = 0;
  junctions.forEach((j, ji) => {
    const piece = strips.length + ji;
    const ring = j.ring;
    const flat = ring.map((v) => ({ x: v.x, z: v.z }));
    const sign = Math.sign(area2(flat));
    const c: Vec3 = [j.centre.x, j.h, j.centre.z];
    const star = ring.every((v, k) => {
      const w = ring[(k + 1) % ring.length] as { x: number; z: number };
      return ((v.x - c[0]) * (w.z - c[2]) - (v.z - c[2]) * (w.x - c[0])) * sign > -1e-9;
    });
    if (star) {
      ring.forEach((v, k) => {
        const w = ring[(k + 1) % ring.length] as { x: number; y: number; z: number };
        top(c, [v.x, v.y, v.z], [w.x, w.y, w.z], (v.y + w.y + c[1]) / 3, piece, 'junction', true, [-1, -1, -1]);
      });
    } else {
      earClipped++;
      const t = triangulatePolygon(flat);
      forced += t.forced;
      for (let k = 0; k + 2 < t.idx.length; k += 3) {
        const [a, b, d] = [ring[t.idx[k] as number], ring[t.idx[k + 1] as number], ring[t.idx[k + 2] as number]] as { x: number; y: number; z: number }[];
        top([a!.x, a!.y, a!.z], [b!.x, b!.y, b!.z], [d!.x, d!.y, d!.z], (a!.y + b!.y + d!.y) / 3, piece, 'junction', true, [-1, -1, -1]);
      }
    }
    for (const band of j.bands) {
      const bf = band.ring.map((v) => ({ x: v.x, z: v.z }));
      const t = triangulatePolygon(bf);
      forced += t.forced;
      for (let k = 0; k + 2 < t.idx.length; k += 3) {
        const [a, b, d] = [band.ring[t.idx[k] as number], band.ring[t.idx[k + 1] as number], band.ring[t.idx[k + 2] as number]] as { x: number; y: number; z: number }[];
        top([a!.x, a!.y, a!.z], [b!.x, b!.y, b!.z], [d!.x, d!.y, d!.z], (a!.y + b!.y + d!.y) / 3 - band.raise, piece, 'band', true, [-1, -1, -1]);
      }
      // the kerb face along the carriageway and along the arms' cut lines (not along the outer edge, where the ground meets the top)
      const cx = bf.reduce((s, p) => s + p.x, 0) / bf.length;
      const cz = bf.reduce((s, p) => s + p.z, 0) / bf.length;
      band.ring.forEach((v, k) => {
        const w = band.ring[(k + 1) % band.ring.length] as { x: number; y: number; z: number };
        if (!band.skirt[k]) return;
        const mx = (v.x + w.x) / 2 - cx;
        const mz = (v.z + w.z) / 2 - cz;
        const ex = w.x - v.x;
        const ez = w.z - v.z;
        const len = Math.hypot(ex, ez) || 1;
        // outward: the side of the edge away from the band's middle
        let nx = ez / len;
        let nz = -ex / len;
        if (nx * mx + nz * mz < 0) {
          nx = -nx;
          nz = -nz;
        }
        set.get('kerb').quad([v.x, v.y, v.z], [w.x, w.y, w.z], [w.x, w.y - band.raise, w.z], [v.x, v.y - band.raise, v.z], [nx, 0, nz]);
      });
    }
  });
  return { surf, set, earClipped, forced };
}

/** Lane markings as thin strips just above the surface: dashed between lanes of one direction, solid elsewhere. */
export function buildMarkings(strips: readonly Strip[], set: MeshSet): void {
  const LIFT = 0.02;
  const HALF = 0.06;
  const mesh = set.get('marking');
  for (const s of strips) {
    const L = s.lanes.length;
    for (let k = 0; k <= L; k++) {
      const left = k > 0 ? (s.lanes[k - 1] as LaneDef) : null;
      const right = k < L ? (s.lanes[k] as LaneDef) : null;
      const dl = left?.type === 'drive';
      const dr = right?.type === 'drive';
      if (!dl && !dr) continue;
      const dashed = dl && dr && (left as LaneDef).dir === (right as LaneDef).dir;
      // an edge line sits a little inside the drive lane
      const inset = dl && dr ? 0 : dl ? 0.2 : -0.2;
      let along = 0;
      for (let i = 0; i + 1 < s.st.length; i++) {
        const p = s.st[i] as Station;
        const q = s.st[i + 1] as Station;
        const len = Math.hypot(q.x - p.x, q.z - p.z);
        const widthOk = (st: Station): boolean => (!dl || (st.b[k - 1] as number) - (st.b[k] as number) > 1.2) && (!dr || (st.b[k] as number) - (st.b[k + 1] as number) > 1.2);
        const from = along;
        along += len;
        if (!widthOk(p) || !widthOk(q) || len < 1e-6) continue;
        const pieces: [number, number][] = [];
        if (!dashed) pieces.push([0, 1]);
        else {
          // 3 m of paint, 4.5 m of gap
          const period = 7.5;
          for (let d = Math.floor(from / period) * period; d < along; d += period) {
            const a = Math.max(from, d);
            const b = Math.min(along, d + 3);
            if (b > a) pieces.push([(a - from) / len, (b - from) / len]);
          }
        }
        const lp = (p.b[k] as number) + inset;
        const lq = (q.b[k] as number) + inset;
        for (const [u, v] of pieces) {
          const at = (t: number, off: number): Vec3 => {
            const lat = lerp(lp, lq, t) + off;
            return [lerp(p.x + p.nx * lat, q.x + q.nx * lat, t), lerp(p.h, q.h, t) + LIFT, lerp(p.z + p.nz * lat, q.z + q.nz * lat, t)];
          };
          mesh.quad(at(u, HALF), at(u, -HALF), at(v, -HALF), at(v, HALF), [0, 1, 0]);
        }
      }
    }
  }
}

/** Piers under decks, about every 28 m, never standing on a road at grade. */
export function buildPiers(strips: readonly Strip[], grid: TriGrid<SurfTri>, set: MeshSet): number {
  let count = 0;
  const mesh = set.get('pier');
  for (const s of strips) {
    let since = 14;
    const L = s.lanes.length;
    for (let i = 1; i < s.st.length; i++) {
      const st = s.st[i] as Station;
      const prev = s.st[i - 1] as Station;
      since += Math.hypot(st.x - prev.x, st.z - prev.z);
      if (st.structure !== 2 || since < 28 || st.h - st.g < 3.5) continue;
      const mid = ((st.b[0] as number) + (st.b[L] as number)) / 2;
      const half = Math.max(0.6, ((st.b[0] as number) - (st.b[L] as number)) * 0.3);
      const cx = st.x + st.nx * mid;
      const cz = st.z + st.nz * mid;
      const tx = -st.nz;
      const tz = st.nx;
      const corners: P2[] = [
        { x: cx + st.nx * half + tx * 0.5, z: cz + st.nz * half + tz * 0.5 }, { x: cx - st.nx * half + tx * 0.5, z: cz - st.nz * half + tz * 0.5 },
        { x: cx - st.nx * half - tx * 0.5, z: cz - st.nz * half - tz * 0.5 }, { x: cx + st.nx * half - tx * 0.5, z: cz + st.nz * half - tz * 0.5 },
      ];
      // not on a road under the deck: any corner or the centre over an at-grade surface moves the pier on
      const blocked = [...corners, { x: cx, z: cz }].some((c) => grid.heightsAt(c.x, c.z).some((hit) => (grid.tris[hit.id] as SurfTri).atGrade));
      if (blocked) continue;
      since = 0;
      count++;
      const y0 = st.g - 1;
      const y1 = st.h - DECK_DEPTH;
      for (let k = 0; k < 4; k++) {
        const a = corners[k] as P2;
        const b = corners[(k + 1) % 4] as P2;
        const ex = b.x - a.x;
        const ez = b.z - a.z;
        const len = Math.hypot(ex, ez) || 1;
        let nx = ez / len;
        let nz = -ex / len;
        if (nx * ((a.x + b.x) / 2 - cx) + nz * ((a.z + b.z) / 2 - cz) < 0) {
          nx = -nx;
          nz = -nz;
        }
        mesh.quad([a.x, y0, a.z], [b.x, y0, b.z], [b.x, y1, b.z], [a.x, y1, a.z], [nx, 0, nz]);
      }
    }
  }
  return count;
}

/** Collider chunks of at most `limit` triangles from the drawn meshes of the named materials, by a coarse grid. */
export function colliderChunks(meshes: readonly MeshData[], materials: readonly string[], cell = 64, limit = 1300): ColliderChunk[] {
  const cells = new Map<string, number[]>();
  for (const m of meshes) {
    if (!materials.includes(m.material)) continue;
    for (let k = 0; k + 2 < m.idx.length; k += 3) {
      const ia = (m.idx[k] as number) * 3;
      const ib = (m.idx[k + 1] as number) * 3;
      const ic = (m.idx[k + 2] as number) * 3;
      const cx = ((m.pos[ia] as number) + (m.pos[ib] as number) + (m.pos[ic] as number)) / 3;
      const cz = ((m.pos[ia + 2] as number) + (m.pos[ib + 2] as number) + (m.pos[ic + 2] as number)) / 3;
      const key = `${Math.floor(cx / cell)}_${Math.floor(cz / cell)}`;
      let faces = cells.get(key);
      if (!faces) {
        faces = [];
        cells.set(key, faces);
      }
      for (const o of [ia, ib, ic]) faces.push(m.pos[o] as number, m.pos[o + 1] as number, m.pos[o + 2] as number);
    }
  }
  const out: ColliderChunk[] = [];
  for (const [key, faces] of [...cells].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    for (let from = 0, part = 0; from < faces.length; from += limit * 9, part++) out.push({ name: `col_${key}_${part}`, faces: faces.slice(from, from + limit * 9) });
  }
  return out;
}
