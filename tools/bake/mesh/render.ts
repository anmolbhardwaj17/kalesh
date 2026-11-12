// A north-up plan of the road mesh faces (P1-014): every face by what it is, junction surfaces outlined (blue: built
// as planned, red: made or cut by the polygon set), the edge of the at-grade surface the ground is cut to. Pure: the
// driver writes the file.
import { CUT_NONE, LANE_KINDS } from './faces.ts';
import type { FaceSet } from './faces.ts';

const FILL: Readonly<Record<string, string>> = {
  drive: '#4a4a50', parking: '#6a6a72', gore: '#8a7f5a', kerb: '#c9c5bb', footpath: '#b9ad98', planter: '#6f9a55', median: '#9aa38c', junction: '#55555e', band: '#c2b59e',
};

export interface MeshPictureMarks {
  /** Junction number of every junction face that the polygon set made or cut (face number to true). */
  setFaces?: ReadonlySet<number>;
  /** Extra shapes drawn on top: piers, parapets, stop lines. */
  polys?: readonly { ring: readonly (readonly [number, number])[]; fill: string }[];
  lines?: readonly { a: readonly [number, number]; b: readonly [number, number]; stroke: string; width: number }[];
}

export function meshSvg(fs: FaceSet, box: { minX: number; maxX: number; minZ: number; maxZ: number }, title: string, marks: MeshPictureMarks = {}, firstJunctionPiece = Infinity): string {
  const pad = 10;
  const w = box.maxX - box.minX + 2 * pad;
  const h = box.maxZ - box.minZ + 2 * pad;
  const scale = Math.min(2400 / w, 2400 / h);
  const X = (x: number): string => ((x - box.minX + pad) * scale).toFixed(1);
  const Z = (z: number): string => ((z - box.minZ + pad) * scale + 40).toFixed(1);
  const o: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * scale)}" height="${Math.round(h * scale) + 40}" font-family="Helvetica, Arial, sans-serif"><rect width="100%" height="100%" fill="#7d8a66"/>`];
  const inBox = (f: number): boolean => {
    const s = fs.start[f] as number;
    const id = fs.ids[s] as number;
    const x = fs.vx[id] as number;
    const z = fs.vz[id] as number;
    return x > box.minX - 60 && x < box.maxX + 60 && z > box.minZ - 60 && z < box.maxZ + 60;
  };
  const pts = (f: number): string => fs.ring(f).map(([x, z]) => `${X(x)},${Z(z)}`).join(' ');
  // the ground level first, decks on top
  for (const deck of [false, true]) {
    for (let f = 0; f < fs.faces; f++) {
      if (((fs.cut[f] as number) === CUT_NONE && (fs.sheet[f] as number) < 2000) !== deck || !inBox(f)) continue;
      const kind = LANE_KINDS[fs.kind[f] as number] as string;
      let fill = FILL[kind] as string;
      if (deck && (kind === 'drive' || kind === 'junction')) fill = '#5a5f78';
      if ((fs.sheet[f] as number) >= 2000 && (kind === 'drive' || kind === 'junction')) fill = '#3a3a40';
      const junction = (fs.piece[f] as number) >= firstJunctionPiece;
      const stroke = !junction ? `stroke="${fill}" stroke-width="0.3"` : marks.setFaces?.has(f) ? 'stroke="#e0483c" stroke-width="1.6"' : 'stroke="#3d78c9" stroke-width="1"';
      o.push(`<polygon points="${pts(f)}" fill="${fill}" ${stroke}/>`);
    }
  }
  for (const p of marks.polys ?? []) o.push(`<polygon points="${p.ring.map(([x, z]) => `${X(x)},${Z(z)}`).join(' ')}" fill="${p.fill}"/>`);
  for (const l of marks.lines ?? []) o.push(`<line x1="${X(l.a[0])}" y1="${Z(l.a[1])}" x2="${X(l.b[0])}" y2="${Z(l.b[1])}" stroke="${l.stroke}" stroke-width="${(l.width * scale).toFixed(1)}"/>`);
  o.push(`<rect width="100%" height="36" fill="#1d1f24"/><text x="12" y="24" font-size="18" fill="#fff">${title}</text>`);
  const nx = Math.round(w * scale) - 40;
  o.push(`<polygon points="${nx},48 ${nx - 9},78 ${nx},71 ${nx + 9},78" fill="#fff"/><text x="${nx - 6}" y="96" font-size="16" font-weight="bold" fill="#fff">N</text>`);
  o.push(`<rect x="14" y="${Math.round(h * scale) + 22}" width="${(50 * scale).toFixed(1)}" height="5" fill="#fff"/><text x="14" y="${Math.round(h * scale) + 16}" font-size="13" fill="#fff">50 m</text></svg>`);
  return o.join('\n');
}
