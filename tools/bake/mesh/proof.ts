// The overlap proof (P1-014, MAP_REPAIR.md "Junction mesh builder": "a polygon union of all road surfaces then
// proves that the overlap area is zero"). It reads the finished faces, not the builder's notes. Two measures:
//   - the union identity per level sheet: the areas of all faces added up, minus the area of their union, is the
//     area that lies under more than one face. Faces on different sheets (a deck, a tunnel) may cross.
//   - pair by pair at every junction: the junction's faces against every strip and every other junction near it.
// Pure.
import { FillRule, union } from 'clipper2-ts';
import type { Paths64 } from 'clipper2-ts';
import type { Joint, Strip } from '../roads/model.ts';
import { overlapArea } from '../roads/trigrid.ts';
import type { Vec3 } from '../roads/trigrid.ts';
import { CLIP_SCALE, pathsArea, sharedArea, toPath, unionArea } from './clip.ts';
import type { Origin } from './clip.ts';
import type { FaceSet } from './faces.ts';
import type { StripIndex } from './stripfaces.ts';

/** Two pieces may share this much area before they count as overlapping (m2): the acceptance bound. */
export const PAIR_LIMIT_M2 = 0.01;

export interface OverlapPair {
  a: string;
  b: string;
  areaM2: number;
  x: number;
  z: number;
}

export interface OverlapProof {
  /** Area under more than one face, all sheets (m2), and the same for the ground sheet alone. */
  totalM2: number;
  groundM2: number;
  sheets: { sheet: number; faces: number; facesM2: number; unionM2: number; overlapM2: number }[];
  junctions: number;
  /** Junctions with a pair over PAIR_LIMIT_M2, the pairs, and the largest pair. */
  junctionsOver: number;
  pairsOver: number;
  maxPairM2: number;
  /** Area a junction's own faces share with each other, largest. */
  maxSelfM2: number;
  /** All pair areas and all self areas added up, the ones under the limit too: what the junctions add to the total. */
  pairSumM2: number;
  selfSumM2: number;
  pairsTested: number;
  worst: OverlapPair[];
  /** Strip against strip (no junction involved): pairs over PAIR_LIMIT_M2, all shared area added up, the largest pairs. The lane model's own overlaps. */
  stripPairs: { pairs: number; areaM2: number; worst: OverlapPair[] };
}

const r4 = (v: number): number => Math.round(v * 10000) / 10000 + 0;

/** The outline of a run of a strip's stations (i0 to i1): the left edge out, the right edge back. */
function outline(index: StripIndex, si: number, i0: number, i1: number): { x: number; y: number }[] {
  const left: { x: number; y: number }[] = [];
  const right: { x: number; y: number }[] = [];
  const at = (p: readonly [number, number]): { x: number; y: number } => ({ x: Math.round(p[0] * CLIP_SCALE), y: Math.round(p[1] * CLIP_SCALE) });
  for (let i = i0; i < i1; i++) {
    const q = index.quad(si, i);
    if (i === i0) {
      left.push(at(q[0] as [number, number]));
      right.push(at(q[1] as [number, number]));
    }
    left.push(at(q[3] as [number, number]));
    right.push(at(q[2] as [number, number]));
  }
  return [...left, ...right.reverse()];
}

export function proveNoOverlap(fs: FaceSet, strips: readonly Strip[], joints: readonly Joint[], index: StripIndex, junctionFaces: readonly (readonly number[])[], junctionSheets: readonly number[], nameOf: (piece: number) => string): OverlapProof {
  // the union identity, sheet by sheet
  const bySheet = new Map<number, { faces: number; area: number; paths: Paths64 }>();
  const sheetAt = (sheet: number): { faces: number; area: number; paths: Paths64 } => {
    let s = bySheet.get(sheet);
    if (!s) bySheet.set(sheet, (s = { faces: 0, area: 0, paths: [] }));
    return s;
  };
  // areas are taken on the same tenth of a millimetre grid the union works on
  const grid = (f: number): { x: number; y: number }[] => fs.ring(f).map(([x, z]) => ({ x: Math.round(x * CLIP_SCALE), y: Math.round(z * CLIP_SCALE) }));
  for (let f = 0; f < fs.faces; f++) {
    const s = sheetAt(fs.sheet[f] as number);
    s.faces++;
    s.area += pathsArea([grid(f)]);
  }
  strips.forEach((s, si) => {
    let from = 0;
    for (let i = 0; i + 1 < s.st.length; i++) {
      const sh = index.sheet(si, i);
      const last = i + 2 >= s.st.length || index.sheet(si, i + 1) !== sh;
      if (!last) continue;
      sheetAt(sh).paths.push(outline(index, si, from, i + 1));
      from = i + 1;
    }
  });
  junctionFaces.forEach((faces, ji) => {
    for (const f of faces) sheetAt(junctionSheets[ji] as number).paths.push(grid(f));
  });
  const sheets: OverlapProof['sheets'] = [];
  let total = 0;
  let ground = 0;
  for (const [sheet, s] of [...bySheet].sort((a, b) => a[0] - b[0])) {
    const unionM2 = pathsArea(union(s.paths, FillRule.NonZero));
    const overlap = Math.max(0, s.area - unionM2);
    sheets.push({ sheet, faces: s.faces, facesM2: r4(s.area), unionM2: r4(unionM2), overlapM2: r4(overlap) });
    total += overlap;
    if (sheet === 0) ground = overlap;
  }

  // pair by pair at every junction
  const out: OverlapProof = { totalM2: r4(total), groundM2: r4(ground), sheets, junctions: junctionFaces.length, junctionsOver: 0, pairsOver: 0, maxPairM2: 0, maxSelfM2: 0, pairSumM2: 0, selfSumM2: 0, pairsTested: 0, worst: [], stripPairs: { pairs: 0, areaM2: 0, worst: [] } };
  const boxes = junctionFaces.map((faces) => {
    const b = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const f of faces) {
      for (const [x, z] of fs.ring(f)) {
        b.minX = Math.min(b.minX, x);
        b.maxX = Math.max(b.maxX, x);
        b.minZ = Math.min(b.minZ, z);
        b.maxZ = Math.max(b.maxZ, z);
      }
    }
    return b;
  });
  const CELL = 64;
  const cells = new Map<number, number[]>();
  boxes.forEach((b, ji) => {
    if (b.minX > b.maxX) return;
    for (let x = Math.floor(b.minX / CELL); x <= Math.floor(b.maxX / CELL); x++) {
      for (let z = Math.floor(b.minZ / CELL); z <= Math.floor(b.maxZ / CELL); z++) {
        const k = (x + 100000) * 262144 + (z + 100000);
        const list = cells.get(k);
        if (list) list.push(ji);
        else cells.set(k, [ji]);
      }
    }
  });
  const worst: OverlapPair[] = [];
  const record = (a: string, b: string, area: number, x: number, z: number): void => {
    worst.push({ a, b, areaM2: r4(area), x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 });
  };
  junctionFaces.forEach((faces, ji) => {
    if (!faces.length) return;
    const b = boxes[ji] as { minX: number; maxX: number; minZ: number; maxZ: number };
    const centre: Origin = { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
    const mine = faces.map((f) => fs.ring(f));
    const sheet = junctionSheets[ji] as number;
    let over = false;
    const self = mine.reduce((s, r) => s + pathsArea([toPath(r, centre)]), 0) - unionArea(mine, centre);
    out.maxSelfM2 = Math.max(out.maxSelfM2, self);
    out.selfSumM2 += Math.max(0, self);
    if (self > PAIR_LIMIT_M2) {
      over = true;
      out.pairsOver++;
      record(nameOf(strips.length + ji), nameOf(strips.length + ji), self, centre.x, centre.z);
    }
    const test = (name: string, rings: readonly (readonly (readonly [number, number])[])[]): void => {
      out.pairsTested++;
      const area = sharedArea(mine, rings, centre);
      out.maxPairM2 = Math.max(out.maxPairM2, area);
      out.pairSumM2 += area;
      if (area <= PAIR_LIMIT_M2) return;
      over = true;
      out.pairsOver++;
      record(nameOf(strips.length + ji), name, area, centre.x, centre.z);
    };
    for (const [si, rings] of index.near(b.minX, b.minZ, b.maxX, b.maxZ, sheet)) test(nameOf(si), rings);
    const others = new Set<number>();
    for (let x = Math.floor(b.minX / CELL); x <= Math.floor(b.maxX / CELL); x++) {
      for (let z = Math.floor(b.minZ / CELL); z <= Math.floor(b.maxZ / CELL); z++) for (const k of cells.get((x + 100000) * 262144 + (z + 100000)) ?? []) if (k > ji && junctionSheets[k] === sheet) others.add(k);
    }
    for (const k of others) {
      const ob = boxes[k] as { minX: number; maxX: number; minZ: number; maxZ: number };
      if (ob.minX > b.maxX || ob.maxX < b.minX || ob.minZ > b.maxZ || ob.maxZ < b.minZ) continue;
      test(nameOf(strips.length + k), (junctionFaces[k] as readonly number[]).map((f) => fs.ring(f)));
    }
    if (over) out.junctionsOver++;
  });
  out.stripPairs = stripPairs(strips, index, joints, nameOf);
  out.maxPairM2 = r4(out.maxPairM2);
  out.maxSelfM2 = r4(out.maxSelfM2);
  out.pairSumM2 = r4(out.pairSumM2);
  out.selfSumM2 = r4(out.selfSumM2);
  out.worst = worst.sort((p, q) => q.areaM2 - p.areaM2).slice(0, 20);
  return out;
}

/**
 * Strip on strip, no junction involved: every two stretches of different strips on one sheet that share area. The
 * two stretches at a joint are one cross-section and are left out. These are the lane model's own overlaps (the
 * lanes step lists them by level tag; here the level is the solved height, so a ramp on fill beside a road at
 * grade counts too).
 */
function stripPairs(strips: readonly Strip[], index: StripIndex, joints: readonly Joint[], nameOf: (piece: number) => string): OverlapProof['stripPairs'] {
  const jointed = new Set<number>();
  const endQuad = (e: { strip: number; end: 'start' | 'end' }): number => (e.end === 'start' ? 0 : Math.max(0, (strips[e.strip] as Strip).st.length - 2));
  const N = strips.length;
  for (const j of joints) {
    const a = j.a.strip * 4096 + endQuad(j.a);
    const b = j.b.strip * 4096 + endQuad(j.b);
    jointed.add(Math.min(a, b) * N * 4096 + Math.max(a, b));
  }
  const tris = (q: readonly (readonly [number, number])[]): [Vec3, Vec3, Vec3][] => {
    const v = q.map(([x, z]) => [x, 0, z] as Vec3);
    return [[v[0] as Vec3, v[1] as Vec3, v[2] as Vec3], [v[0] as Vec3, v[2] as Vec3, v[3] as Vec3]];
  };
  const seen = new Set<number>();
  const pairs = new Map<number, { area: number; x: number; z: number }>();
  const total = index.strip.length;
  index.eachCell((ids) => {
    for (let x = 0; x < ids.length; x++) {
      for (let y = x + 1; y < ids.length; y++) {
        const i = ids[x] as number;
        const k = ids[y] as number;
        const si = index.strip[i] as number;
        const sk = index.strip[k] as number;
        if (si === sk) continue;
        const key = Math.min(i, k) * total + Math.max(i, k);
        if (seen.has(key)) continue;
        seen.add(key);
        const qi = index.station[i] as number;
        const qk = index.station[k] as number;
        if (index.sheet(si, qi) !== index.sheet(sk, qk)) continue;
        const a = si * 4096 + qi;
        const b = sk * 4096 + qk;
        if (jointed.has(Math.min(a, b) * N * 4096 + Math.max(a, b))) continue;
        const ra = index.quad(si, qi);
        const rb = index.quad(sk, qk);
        const box = (r: readonly (readonly [number, number])[]): [number, number, number, number] => [Math.min(...r.map((p) => p[0])), Math.min(...r.map((p) => p[1])), Math.max(...r.map((p) => p[0])), Math.max(...r.map((p) => p[1]))];
        const ba = box(ra);
        const bb = box(rb);
        if (ba[0] >= bb[2] || bb[0] >= ba[2] || ba[1] >= bb[3] || bb[1] >= ba[3]) continue;
        let area = 0;
        for (const t of tris(ra)) for (const u of tris(rb)) area += overlapArea(t, u);
        if (area < 1e-4) continue;
        const pk = Math.min(si, sk) * N + Math.max(si, sk);
        const e = pairs.get(pk);
        if (e) e.area += area;
        else pairs.set(pk, { area, x: (ba[0] + ba[2]) / 2, z: (ba[1] + ba[3]) / 2 });
      }
    }
  });
  const list = [...pairs].filter(([, v]) => v.area > PAIR_LIMIT_M2).sort((p, q) => q[1].area - p[1].area);
  return {
    pairs: list.length, areaM2: r4([...pairs.values()].reduce((s, v) => s + v.area, 0)),
    worst: list.slice(0, 12).map(([k, v]) => ({ a: nameOf(Math.floor(k / N)), b: nameOf(k % N), areaM2: r4(v.area), x: Math.round(v.x * 10) / 10, z: Math.round(v.z * 10) / 10 })),
  };
}
