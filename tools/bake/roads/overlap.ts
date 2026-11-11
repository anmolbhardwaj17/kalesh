// Strips lying on each other in plan (P1-012 check, P1-031 give-way): every station pair of a strip is one quad over
// its whole width (two triangles); triangles of two strips on one level (layer and bridge flag) that share area
// overlap. Two strips that meet at a joint share its line: their two quads at that joint are one surface (the
// stations are rounded to the millimetre, so they share a sliver a millimetre deep), and that pair is not an overlap.
// Junction surfaces are the mesh builder's. Pure.
import type { Joint, Station, Strip } from './model.ts';
import { TriGrid, overlapPoly, polyArea } from './trigrid.ts';
import type { Tri3, Vec3 } from './trigrid.ts';

export interface QuadTri extends Tri3 {
  strip: number;
  /** Station index of the quad's first station. */
  quad: number;
  level: number;
}

export interface StripOverlap {
  a: QuadTri;
  b: QuadTri;
  /** The shared polygon, [x, z] points. */
  poly: [number, number][];
  area: number;
}

/** Overlaps smaller than this (m2) are float noise. */
export const OVERLAP_EPS_M2 = 1e-4;

const quadKey = (strip: number, quad: number): string => `${strip}:${quad}`;

/** The quads of two strips at the joints between them: pairs that share the joint line. */
export function jointQuads(strips: readonly Strip[], joints: readonly Joint[]): Set<string> {
  const out = new Set<string>();
  const endQuad = (s: number, end: 'start' | 'end'): number => (end === 'start' ? 0 : Math.max(0, (strips[s] as Strip).st.length - 2));
  for (const j of joints) {
    const a = quadKey(j.a.strip, endQuad(j.a.strip, j.a.end));
    const b = quadKey(j.b.strip, endQuad(j.b.strip, j.b.end));
    out.add(`${a}|${b}`);
    out.add(`${b}|${a}`);
  }
  return out;
}

/** Every pair of triangles of two strips that share area in plan. `only` limits the strips that take part. */
export function stripOverlaps(strips: readonly Strip[], joints: readonly Joint[], only?: (s: Strip) => boolean): { overlaps: StripOverlap[]; tested: number } {
  const grid = new TriGrid<QuadTri>(8);
  strips.forEach((s, si) => {
    if (only && !only(s)) return;
    for (let i = 0; i + 1 < s.st.length; i++) {
      const p = s.st[i] as Station;
      const q = s.st[i + 1] as Station;
      const n = p.b.length - 1;
      const v = (st: Station, lat: number): Vec3 => [st.x + st.nx * lat, 0, st.z + st.nz * lat];
      const a = v(p, p.b[0] as number);
      const c = v(p, p.b[n] as number);
      const d = v(q, q.b[0] as number);
      const e = v(q, q.b[n] as number);
      const level = p.layer * 2 + (p.bridge ? 1 : 0);
      grid.add({ p: [a, c, d], strip: si, quad: i, level });
      grid.add({ p: [c, e, d], strip: si, quad: i, level });
    }
  });
  const shared = jointQuads(strips, joints);
  const cell = grid.cellSize();
  const tris = grid.tris;
  const box = tris.map((t) => ({
    minX: Math.min(t.p[0][0], t.p[1][0], t.p[2][0]), maxX: Math.max(t.p[0][0], t.p[1][0], t.p[2][0]),
    minZ: Math.min(t.p[0][2], t.p[1][2], t.p[2][2]), maxZ: Math.max(t.p[0][2], t.p[1][2], t.p[2][2]),
  }));
  const overlaps: StripOverlap[] = [];
  let tested = 0;
  grid.eachCell((ids, ci, cj) => {
    for (let x = 0; x < ids.length; x++) {
      for (let y = x + 1; y < ids.length; y++) {
        const i = ids[x] as number;
        const j = ids[y] as number;
        const ta = tris[i] as QuadTri;
        const tb = tris[j] as QuadTri;
        if (ta.strip === tb.strip || ta.level !== tb.level) continue;
        const a = box[i] as { minX: number; maxX: number; minZ: number; maxZ: number };
        const c = box[j] as { minX: number; maxX: number; minZ: number; maxZ: number };
        if (a.minX >= c.maxX || c.minX >= a.maxX || a.minZ >= c.maxZ || c.minZ >= a.maxZ) continue;
        // each pair once: in the cell of the lower corner of the two boxes' overlap
        if (Math.floor(Math.max(a.minX, c.minX) / cell) !== ci || Math.floor(Math.max(a.minZ, c.minZ) / cell) !== cj) continue;
        if (shared.has(`${quadKey(ta.strip, ta.quad)}|${quadKey(tb.strip, tb.quad)}`)) continue;
        tested++;
        const poly = overlapPoly(ta.p, tb.p);
        const area = poly.length >= 3 ? polyArea(poly) : 0;
        if (area < OVERLAP_EPS_M2) continue;
        overlaps.push(ta.strip < tb.strip ? { a: ta, b: tb, poly, area } : { a: tb, b: ta, poly, area });
      }
    }
  });
  return { overlaps, tested };
}
