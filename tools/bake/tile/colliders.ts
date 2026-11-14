// Collider chunks of a production tile (P1-016, ARCH_OPTIONS K3, TECH.md "Streaming": "colliders arrive in chunks").
// Made from the drawn vertices of the tile's meshes (the same numbers, so the collider is the drawn surface), in
// chunks of about 500 triangles and never more than 600 (a whole tile collider in one piece is a 17 ms frame).
// - Every surface a wheel or a foot can touch is in: roads and junctions, kerbs, footpaths, medians, walls and
//   parapets, piers (P2-034: crash barriers, deck sides, retaining and abutment walls, rail beds and foot bridge
//   decks are the plain shapes the infrastructure kits draw over), the ground and its pads, river beds and the building shells. Paint, the water surface and the
//   ceilings of decks and tunnels are not.
// - One building shell stays in one chunk (unless one building alone is over the chunk limit).
// - The deck joints (the `joint` strips over the piers) are in: the strip is closed and covers the station line of
//   the deck under it, the line where two deck triangles (and possibly two chunks) meet, so a wheel ray there lands
//   inside one collider triangle. Phase 0 measured that an open 4 cm joint drops a wheel ray.
// - A triangle with no area as 32-bit floats (under a square millimetre) is left out: it carries nothing and a
//   physics engine may refuse it.
// Chunks are compact: triangles are grouped by a 62.5 m cell of the tile, ordered along a Z curve of 4 m cells
// inside it, then cut into nearly equal chunks. Pure.
import type { ColliderChunk, MeshData } from './codec.ts';

export const COLLIDER_MATERIALS: readonly string[] = ['road', 'parking', 'gore', 'joint', 'median', 'planter', 'footpath', 'kerb', 'wall', 'barrier', 'fascia', 'retaining', 'abutment', 'pier', 'railbed', 'fob', 'platform', 'ground', 'lawn', 'plot', 'bed', 'forecourt', 'pad', 'wallbase', 'moat', 'walkway', 'building', 'landmark', 'landmark_red', 'bollard'];
/** Aim and hard limit of a chunk (triangles). */
export const CHUNK_TARGET = 500;
export const CHUNK_LIMIT = 600;
/** Twice the smallest area a collider triangle may have (m2): a square millimetre. */
export const MIN_AREA2 = 2e-6;

const CELL_M = 62.5;
const SUB_M = 4;

interface Unit {
  /** Morton key of the 4 m cell of its centre, inside its 62.5 m cell. */
  key: number;
  cell: number;
  order: number;
  faces: number[];
}

/** Interleaves the low 16 bits of two numbers (a Z curve). */
function morton(x: number, z: number): number {
  let out = 0;
  for (let b = 0; b < 8; b++) out += (((x >> b) & 1) << (2 * b)) + (((z >> b) & 1) << (2 * b + 1));
  return out;
}

export interface ChunkStats {
  triangles: number;
  /** Triangles left out for having no area as float32. */
  slivers: number;
  /** Buildings too big for one chunk (split over several). */
  splitBuildings: number;
  joints: number;
}

/**
 * Chunks from a tile's meshes. `buildings` names the triangle ranges of the `building` mesh, one per shell, in the
 * mesh's own triangle numbers.
 */
export function tileColliders(meshes: readonly MeshData[], buildings: readonly { first: number; end: number }[], size: number): { chunks: ColliderChunk[]; stats: ChunkStats } {
  const f = Math.fround;
  const stats: ChunkStats = { triangles: 0, slivers: 0, splitBuildings: 0, joints: 0 };
  const units: Unit[] = [];
  const per = Math.max(1, Math.round(size / CELL_M));
  const cellOf = (x: number, z: number): number => Math.min(per - 1, Math.max(0, Math.floor(z / CELL_M))) * per + Math.min(per - 1, Math.max(0, Math.floor(x / CELL_M)));
  const keyOf = (x: number, z: number): number => {
    const cx = Math.min(per - 1, Math.max(0, Math.floor(x / CELL_M)));
    const cz = Math.min(per - 1, Math.max(0, Math.floor(z / CELL_M)));
    return morton(Math.max(0, Math.floor((x - cx * CELL_M) / SUB_M)), Math.max(0, Math.floor((z - cz * CELL_M) / SUB_M)));
  };
  /** The faces of triangle t of mesh m, or null for a sliver. */
  const faces = (m: MeshData, t: number, out: number[]): boolean => {
    const ia = (m.idx[t * 3] as number) * 3;
    const ib = (m.idx[t * 3 + 1] as number) * 3;
    const ic = (m.idx[t * 3 + 2] as number) * 3;
    const ux = f(m.pos[ib] as number) - f(m.pos[ia] as number);
    const uy = f(m.pos[ib + 1] as number) - f(m.pos[ia + 1] as number);
    const uz = f(m.pos[ib + 2] as number) - f(m.pos[ia + 2] as number);
    const vx = f(m.pos[ic] as number) - f(m.pos[ia] as number);
    const vy = f(m.pos[ic + 1] as number) - f(m.pos[ia + 1] as number);
    const vz = f(m.pos[ic + 2] as number) - f(m.pos[ia + 2] as number);
    if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < MIN_AREA2) {
      stats.slivers++;
      return false;
    }
    for (const o of [ia, ib, ic]) out.push(m.pos[o] as number, m.pos[o + 1] as number, m.pos[o + 2] as number);
    return true;
  };
  const centre = (fc: readonly number[]): [number, number] => {
    let x = 0;
    let z = 0;
    for (let i = 0; i < fc.length; i += 3) {
      x += fc[i] as number;
      z += fc[i + 2] as number;
    }
    const n = fc.length / 3;
    return [x / n, z / n];
  };
  let order = 0;
  const push = (fc: number[]): void => {
    if (!fc.length) return;
    const [x, z] = centre(fc);
    units.push({ key: keyOf(x, z), cell: cellOf(x, z), order: order++, faces: fc });
    stats.triangles += fc.length / 9;
  };
  for (const m of meshes) {
    if (!COLLIDER_MATERIALS.includes(m.material)) continue;
    const n = m.idx.length / 3;
    if (m.material === 'building') {
      for (const b of buildings) {
        const fc: number[] = [];
        for (let t = b.first; t < b.end; t++) faces(m, t, fc);
        if (fc.length / 9 <= CHUNK_LIMIT) push(fc);
        else {
          stats.splitBuildings++;
          for (let k = 0; k < fc.length; k += CHUNK_TARGET * 9) push(fc.slice(k, k + CHUNK_TARGET * 9));
        }
      }
      continue;
    }
    for (let t = 0; t < n; t++) {
      const fc: number[] = [];
      if (faces(m, t, fc)) {
        push(fc);
        if (m.material === 'joint') stats.joints++;
      }
    }
  }
  units.sort((a, b) => a.cell - b.cell || a.key - b.key || a.order - b.order);
  const chunks: ColliderChunk[] = [];
  for (let i = 0; i < units.length; ) {
    const cell = (units[i] as Unit).cell;
    let j = i;
    let total = 0;
    while (j < units.length && (units[j] as Unit).cell === cell) total += (units[j++] as Unit).faces.length / 9;
    const target = Math.ceil(total / Math.ceil(total / CHUNK_TARGET));
    const ci = cell % per;
    const cj = Math.floor(cell / per);
    let part = 0;
    let cur: number[] = [];
    for (let k = i; k < j; k++) {
      const u = units[k] as Unit;
      if (cur.length && cur.length / 9 + u.faces.length / 9 > target) {
        chunks.push({ name: `col_${ci}_${cj}_${part++}`, faces: cur });
        cur = [];
      }
      for (const v of u.faces) cur.push(v);
    }
    if (cur.length) chunks.push({ name: `col_${ci}_${cj}_${part++}`, faces: cur });
    i = j;
  }
  return { chunks, stats };
}
