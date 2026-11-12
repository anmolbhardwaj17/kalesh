// Before and after pictures of repaired sites (P1-017), north up, x east to the right: on the left the centre lines as
// OSM drew them (the raw block graph) with the issues the rules found there, coloured by what became of them; on the
// right the road mesh the bake built from the repaired graph, with the repaired centre lines drawn thin on top. Both
// panels use the same box and scale, so a point is at the same place in each. Pure (SVG text).
import type { P2 } from '../geom.ts';
import type { BlockGraph } from '../graph/build.ts';
import type { FaceSet } from '../mesh/faces.ts';
import { meshSvg } from '../mesh/render.ts';
import type { MeshPictureMarks } from '../mesh/render.ts';
import type { Issue } from '../rules/types.ts';

type Box = { minX: number; maxX: number; minZ: number; maxZ: number };

const ROAD_WIDTH: Record<string, number> = { motorway: 14, trunk: 12, primary: 10, secondary: 9, tertiary: 7, unclassified: 5, residential: 5, living_street: 4, service: 3.5, pedestrian: 4, road: 5 };
const STATUS: Record<string, [string, string]> = { auto_repaired: ['#2e9e4f', 'repaired on its own'], overridden: ['#8e44ad', 'settled by an override'], explained: ['#2b6cc4', 'explained, unchanged'], open: ['#f08c1a', 'queued for a person'] };

function segments(g: Pick<BlockGraph, 'edges'>, box: Box): { pts: readonly P2[]; cls: string; link: boolean }[] {
  const near = (p: P2): boolean => p.x > box.minX - 80 && p.x < box.maxX + 80 && p.z > box.minZ - 80 && p.z < box.maxZ + 80;
  return g.edges.filter((e) => e.pts.some(near)).map((e) => ({ pts: e.pts, cls: e.road.cls, link: e.road.link }));
}

export function repairSiteSvg(raw: BlockGraph, repaired: Pick<BlockGraph, 'edges'>, issues: readonly Issue[], fs: FaceSet, marks: MeshPictureMarks, firstJunctionPiece: number, box: Box, title: string): string {
  const pad = 10;
  const w = box.maxX - box.minX + 2 * pad;
  const h = box.maxZ - box.minZ + 2 * pad;
  const scale = Math.min(2400 / w, 2400 / h);
  const W = Math.round(w * scale);
  const H = Math.round(h * scale) + 40;
  const X = (x: number): string => ((x - box.minX + pad) * scale).toFixed(1);
  const Z = (z: number): string => ((z - box.minZ + pad) * scale + 40).toFixed(1);
  const line = (pts: readonly P2[]): string => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x)} ${Z(p.z)}`).join('');
  const inside = (p: { x: number; z: number }): boolean => p.x >= box.minX && p.x <= box.maxX && p.z >= box.minZ && p.z <= box.maxZ;

  // left: the raw graph with the issues
  const L: string[] = [`<svg x="0" y="0" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#f4f1ea"/>`];
  const footprints = raw.footprints.filter((f) => f.ring.some(inside));
  L.push(`<path d="${footprints.map((f) => `${line(f.ring)}Z`).join('')}" fill="#dcd6ca"/>`);
  for (const s of segments(raw, box)) L.push(`<path d="${line(s.pts)}" fill="none" stroke="#7b7b76" stroke-opacity="0.75" stroke-width="${((ROAD_WIDTH[s.cls] ?? 5) * (s.link ? 0.7 : 1) * scale).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  for (const s of segments(raw, box)) L.push(`<path d="${line(s.pts)}" fill="none" stroke="#202020" stroke-width="1.2"/>`);
  const count: Record<string, number> = {};
  for (const i of issues) {
    if (!inside(i)) continue;
    const st = STATUS[i.status] ?? STATUS['open'] as [string, string];
    count[i.status] = (count[i.status] ?? 0) + 1;
    L.push(`<circle cx="${X(i.x)}" cy="${Z(i.z)}" r="${i.impact >= 0.7 ? 16 : 10}" fill="${st[0]}" fill-opacity="0.8" stroke="#fff" stroke-width="2"/>`);
  }
  L.push(`<rect width="100%" height="36" fill="#1d1f24"/><text x="12" y="24" font-size="18" fill="#fff">Before: OSM centre lines as read, with the issues the rules found</text>`);
  const rows = Object.entries(STATUS).filter(([k]) => count[k]);
  L.push(`<rect x="12" y="48" width="330" height="${rows.length * 26 + 14}" fill="#fff" fill-opacity="0.9" stroke="#999"/>`);
  rows.forEach(([k, [c, t]], n) => L.push(`<circle cx="30" cy="${68 + n * 26}" r="8" fill="${c}"/><text x="46" y="${74 + n * 26}" font-size="16" fill="#222">${t}: ${count[k]}</text>`));
  L.push(`</svg>`);

  // right: the mesh with the repaired centre lines
  const lines = [...(marks.lines ?? [])];
  for (const s of segments(repaired, box)) for (let k = 1; k < s.pts.length; k++) {
    const a = s.pts[k - 1] as P2;
    const b = s.pts[k] as P2;
    lines.push({ a: [a.x, a.z], b: [b.x, b.z], stroke: '#ffe066', width: 0.35 });
  }
  const after = meshSvg(fs, box, 'After: the road mesh built from the repaired graph (repaired centre lines yellow)', { ...marks, lines }, firstJunctionPiece).replace(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="\d+" height="\d+"/, `<svg x="${W + 16}" y="0" width="${W}" height="${H}"`);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${2 * W + 16}" height="${H + 44}" font-family="Helvetica, Arial, sans-serif"><rect width="100%" height="100%" fill="#111"/>`,
    ...L, after,
    `<text x="12" y="${H + 30}" font-size="20" fill="#fff">${title}</text></svg>`,
  ].join('');
}
