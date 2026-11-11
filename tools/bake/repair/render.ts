// A north-up debug picture of the issues on the repaired block graph (SVG text; the driver turns it into a PNG):
// x east to the right, z south downwards, so north is up with no flip. Footprints light grey, roads grey by class,
// water blue, the stage outline dashed. Issues: repaired on their own green, queued orange, queued with a high
// impact red and larger, explained blue rings. Pure.
import type { P2 } from '../geom.ts';
import type { BlockGraph } from '../graph/build.ts';
import type { Issue } from '../rules/types.ts';

const ROAD_WIDTH: Record<string, number> = { motorway: 7, trunk: 6, primary: 5, secondary: 4.5, tertiary: 3.5, unclassified: 2.5, residential: 2, living_street: 1.8, service: 1.4, pedestrian: 1.8, road: 2 };

export function issuesSvg(g: BlockGraph, issues: readonly Issue[], pad = 150): string {
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
  out.push(`<rect x="${minX}" y="${minZ}" width="${w}" height="${h}" fill="#f7f5f0"/>`);
  out.push(`<path d="${poly(g.features.water.flatMap((a) => a.rings))}" fill="#b9d6ee" fill-rule="evenodd"/>`);
  out.push(`<path d="${poly(g.footprints.map((b) => b.ring))}" fill="#dedad2" stroke="none"/>`);
  const byWidth = new Map<number, string[]>();
  for (const e of g.edges) {
    const width = (ROAD_WIDTH[e.road.cls] ?? 2) * (e.road.link ? 0.7 : 1);
    const list = byWidth.get(width);
    if (list) list.push(line(e.pts));
    else byWidth.set(width, [line(e.pts)]);
  }
  for (const [width, paths] of [...byWidth].sort((a, b) => a[0] - b[0])) out.push(`<path d="${paths.join('')}" fill="none" stroke="#8a8a86" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`);
  out.push(`<path d="${line(g.outline)}Z" fill="none" stroke="#555" stroke-width="4" stroke-dasharray="30 15"/>`);
  const count = { auto: 0, queued: 0, high: 0, explained: 0 };
  const marks: string[][] = [[], [], [], []];
  for (const i of issues) {
    if (i.status === 'auto_repaired') {
      count.auto++;
      (marks[0] as string[]).push(`<circle cx="${f(i.x)}" cy="${f(i.z)}" r="9" fill="#2e9e4f" fill-opacity="0.75"/>`);
    } else if (i.status === 'explained') {
      count.explained++;
      (marks[1] as string[]).push(`<circle cx="${f(i.x)}" cy="${f(i.z)}" r="16" fill="none" stroke="#2b6cc4" stroke-width="5"/>`);
    } else if (i.impact >= 0.7) {
      count.high++;
      (marks[3] as string[]).push(`<circle cx="${f(i.x)}" cy="${f(i.z)}" r="30" fill="#d62424" fill-opacity="0.85" stroke="#fff" stroke-width="4"/>`);
    } else {
      count.queued++;
      (marks[2] as string[]).push(`<circle cx="${f(i.x)}" cy="${f(i.z)}" r="15" fill="#f08c1a" fill-opacity="0.85"/>`);
    }
  }
  for (const layer of marks) out.push(layer.join(''));
  // north arrow and the legend, top left
  const ax = minX + 120;
  const az = minZ + 60;
  out.push(`<path d="M${ax} ${az}l-40 120h80z" fill="#222"/><text x="${ax}" y="${az + 200}" font-size="90" text-anchor="middle" font-family="sans-serif" fill="#222">N</text>`);
  const rows: [string, string][] = [['#2e9e4f', `repaired on its own: ${count.auto}`], ['#f08c1a', `queued: ${count.queued}`], ['#d62424', `queued, high impact: ${count.high}`], ['#2b6cc4', `explained, unchanged: ${count.explained}`]];
  out.push(`<rect x="${minX + 240}" y="${minZ + 40}" width="1500" height="${rows.length * 110 + 50}" fill="#fff" fill-opacity="0.9" stroke="#999" stroke-width="3"/>`);
  rows.forEach(([colour, text], k) => {
    const y = minZ + 120 + k * 110;
    out.push(`<circle cx="${minX + 310}" cy="${y}" r="32" fill="${colour}"/><text x="${minX + 370}" y="${y + 30}" font-size="90" font-family="sans-serif" fill="#222">${text}</text>`);
  });
  out.push('</svg>');
  return out.join('\n');
}
