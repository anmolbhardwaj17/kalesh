// A grid over triangles in the plane: which triangles are near a point or a box, and the height of a triangle
// soup at a point. Used by the road checks, the terrain and the pier placement.
export type Vec3 = [number, number, number];

export interface Tri3 {
  p: [Vec3, Vec3, Vec3];
}

export class TriGrid<T extends Tri3> {
  private readonly cells = new Map<number, number[]>();
  readonly tris: T[] = [];
  private readonly cell: number;

  constructor(cell = 6) {
    this.cell = cell;
  }

  private key(i: number, j: number): number {
    return (i + 100000) * 262144 + (j + 100000);
  }

  add(t: T): number {
    const id = this.tris.length;
    this.tris.push(t);
    const [a, b, c] = t.p;
    const c0 = Math.floor(Math.min(a[0], b[0], c[0]) / this.cell);
    const c1 = Math.floor(Math.max(a[0], b[0], c[0]) / this.cell);
    const r0 = Math.floor(Math.min(a[2], b[2], c[2]) / this.cell);
    const r1 = Math.floor(Math.max(a[2], b[2], c[2]) / this.cell);
    for (let i = c0; i <= c1; i++) {
      for (let j = r0; j <= r1; j++) {
        const k = this.key(i, j);
        const list = this.cells.get(k);
        if (list) list.push(id);
        else this.cells.set(k, [id]);
      }
    }
    return id;
  }

  /** Ids of the triangles whose cells hold the point. */
  near(x: number, z: number): readonly number[] {
    return this.cells.get(this.key(Math.floor(x / this.cell), Math.floor(z / this.cell))) ?? [];
  }

  /** Every cell with its triangle ids, and the cell's indices. */
  eachCell(fn: (ids: readonly number[], i: number, j: number) => void): void {
    for (const [k, ids] of this.cells) fn(ids, Math.floor(k / 262144) - 100000, (k % 262144) - 100000);
  }

  cellSize(): number {
    return this.cell;
  }

  /** Heights of the triangles over a point (empty when none), with the triangle ids. */
  heightsAt(x: number, z: number, eps = 1e-9): { y: number; id: number }[] {
    const out: { y: number; id: number }[] = [];
    for (const id of this.near(x, z)) {
      const [a, b, c] = (this.tris[id] as T).p;
      const den = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(den) < 1e-12) continue;
      const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / den;
      const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / den;
      const w = 1 - u - v;
      if (u < -eps || v < -eps || w < -eps) continue;
      out.push({ y: u * a[1] + v * b[1] + w * c[1], id });
    }
    return out;
  }
}

/** Area of a triangle in the plane. */
export const triArea = (a: Vec3, b: Vec3, c: Vec3): number => Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])) / 2;

/** Area that two triangles share in the plane (Sutherland-Hodgman clip of one by the other). */
export function overlapArea(t: readonly Vec3[], u: readonly Vec3[]): number {
  let poly: [number, number][] = t.map((p) => [p[0], p[2]]);
  const clip: [number, number][] = u.map((p) => [p[0], p[2]]);
  const sign = (clip[1]![0] - clip[0]![0]) * (clip[2]![1] - clip[0]![1]) - (clip[1]![1] - clip[0]![1]) * (clip[2]![0] - clip[0]![0]) >= 0 ? 1 : -1;
  for (let i = 0; i < 3 && poly.length > 0; i++) {
    const a = clip[i] as [number, number];
    const b = clip[(i + 1) % 3] as [number, number];
    const side = (p: [number, number]): number => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
    const next: [number, number][] = [];
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k] as [number, number];
      const q = poly[(k + 1) % poly.length] as [number, number];
      const sp = side(p);
      const sq = side(q);
      if (sp >= 0) next.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const f = sp / (sp - sq);
        next.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]);
      }
    }
    poly = next;
  }
  let area = 0;
  for (let k = 0; k < poly.length; k++) {
    const p = poly[k] as [number, number];
    const q = poly[(k + 1) % poly.length] as [number, number];
    area += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(area) / 2;
}
