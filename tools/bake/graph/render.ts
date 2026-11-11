// A north-up debug picture of the block graph (SVG text; the driver turns it into a PNG): x east to the right, z south
// downwards, so north is up with no flip. Footprints grey, open ground green, water blue, rail dark grey, metro
// purple, roads by class, paired carriageways orange, one-way streets with no pair red, foot over bridges cyan,
// map edge ends as red rings on the stage outline (dashed). Pure.
import type { P2 } from '../geom.ts';
import type { BlockGraph } from './build.ts';

const ROAD_WIDTH: Record<string, number> = { motorway: 7, trunk: 6, primary: 5, secondary: 4.5, tertiary: 3.5, unclassified: 2.5, residential: 2, living_street: 1.8, service: 1.4, pedestrian: 1.8, road: 2 };

/** SVG of the graph; `pad` metres around the outline box. Coordinates are block metres (one SVG unit is one metre). */
export function graphSvg(g: BlockGraph, pad = 150): string {
  const xs = g.outline.map((p) => p.x);
  const zs = g.outline.map((p) => p.z);
  const minX = Math.floor(Math.min(...xs) - pad);
  const minZ = Math.floor(Math.min(...zs) - pad);
  const w = Math.ceil(Math.max(...xs) + pad - minX);
  const h = Math.ceil(Math.max(...zs) + pad - minZ);
  const f = (v: number): string => (Math.round(v * 10) / 10).toString();
  const line = (pts: readonly P2[]): string => pts.map((p, i) => `${i ? 'L' : 'M'}${f(p.x)} ${f(p.z)}`).join('');
  const poly = (rings: readonly (readonly P2[])[]): string => rings.map((r) => `${line(r)}Z`).join('');
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minZ} ${w} ${h}" width="${w}" height="${h}">`);
  out.push(`<rect x="${minX}" y="${minZ}" width="${w}" height="${h}" fill="#f4f1ea"/>`);
  out.push(`<path d="${poly(g.features.open.flatMap((a) => a.rings))}" fill="#bfdcae" fill-rule="evenodd"/>`);
  out.push(`<path d="${poly(g.features.water.flatMap((a) => a.rings))}" fill="#8fc1e8" fill-rule="evenodd"/>`);
  out.push(`<path d="${g.features.waterLines.map((l) => line(l.pts)).join('')}" fill="none" stroke="#5ea3dc" stroke-width="3"/>`);
  out.push(`<path d="${poly(g.footprints.map((b) => b.ring))}" fill="#c9c4bb" stroke="none"/>`);
  out.push(`<path d="${g.features.rail.filter((l) => l.kind === 'rail').map((l) => line(l.pts)).join('')}" fill="none" stroke="#555" stroke-width="2"/>`);
  out.push(`<path d="${g.features.rail.filter((l) => l.kind === 'metro').map((l) => line(l.pts)).join('')}" fill="none" stroke="#8a3fc4" stroke-width="4" stroke-dasharray="12 6"/>`);
  const byStyle = new Map<string, string[]>();
  for (const e of g.edges) {
    const colour = e.pairedWith.length ? '#e8861a' : e.oneway && !e.roundabout && !e.road.link && ['trunk', 'primary', 'secondary', 'tertiary'].includes(e.road.cls) ? '#d33' : e.road.link ? '#777' : '#333';
    const width = (ROAD_WIDTH[e.road.cls] ?? 2) * (e.road.link ? 0.7 : 1);
    const key = `${colour}|${width}`;
    const list = byStyle.get(key);
    if (list) list.push(line(e.pts));
    else byStyle.set(key, [line(e.pts)]);
  }
  for (const [key, paths] of [...byStyle].sort((a, b) => Number(a[0].split('|')[1]) - Number(b[0].split('|')[1]))) {
    const [colour, width] = key.split('|');
    out.push(`<path d="${paths.join('')}" fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`);
  }
  out.push(`<path d="${g.features.footBridges.flatMap((b) => b.pts).map(line).join('')}" fill="none" stroke="#11b5c9" stroke-width="5"/>`);
  out.push(`<path d="${line(g.outline)}Z" fill="none" stroke="#c22" stroke-width="4" stroke-dasharray="30 15"/>`);
  for (const n of g.nodes) if (n.kind === 'map_edge') out.push(`<circle cx="${f(n.x)}" cy="${f(n.z)}" r="14" fill="none" stroke="#c00" stroke-width="5"/>`);
  // north arrow in the top left corner
  const ax = minX + 120;
  const az = minZ + 60;
  out.push(`<path d="M${ax} ${az}l-40 120h80z" fill="#222"/><text x="${ax}" y="${az + 200}" font-size="90" text-anchor="middle" font-family="sans-serif" fill="#222">N</text>`);
  out.push('</svg>');
  return out.join('\n');
}
