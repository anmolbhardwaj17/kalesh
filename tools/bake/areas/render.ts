// Pictures of the generator's result (P2-009): a top view of a box of the stage with every parcel in its wall colour,
// darker with more floors, the lots cut from block faces and the regularised outlines marked, the area edges and the
// blend transects; and the transects as charts of the profile mix. Pure: returns SVG text.
import type { Box2, P2 } from '../geom.ts';
import type { Transect } from './blend.ts';
import type { BuildingPlan } from './plan.ts';

export interface CityMap {
  roads: readonly { pts: readonly P2[]; width: number }[];
  parcels: readonly { id: string; ring: readonly P2[]; source: string }[];
  plans: ReadonlyMap<string, BuildingPlan>;
  /** Ids of the regularised footprints. */
  regularised: ReadonlySet<string>;
  areas: readonly { id: string; rings: readonly (readonly P2[])[] }[];
  zones: readonly (readonly P2[])[];
  transects: readonly Transect[];
}

const hex = (rgb: number): string => `#${(rgb & 0xffffff).toString(16).padStart(6, '0')}`;
const shadeBy = (rgb: number, f: number): number => {
  const c = (v: number): number => Math.max(0, Math.min(255, Math.round(v * f)));
  return (c((rgb >> 16) & 255) << 16) | (c((rgb >> 8) & 255) << 8) | c(rgb & 255);
};

/** The top view of a box (block metres, north up). */
export function citySvg(map: CityMap, box: Box2, title: string): string {
  const w = box.maxX - box.minX;
  const h = box.maxZ - box.minZ;
  const inBox = (ring: readonly P2[]): boolean => ring.some((p) => p.x >= box.minX && p.x <= box.maxX && p.z >= box.minZ && p.z <= box.maxZ);
  const path = (ring: readonly P2[], close: boolean): string => ring.map((p, i) => `${i ? 'L' : 'M'}${(p.x - box.minX).toFixed(1)} ${(p.z - box.minZ).toFixed(1)}`).join('') + (close ? 'Z' : '');
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${-h * 0.06} ${w} ${h * 1.06}" width="${Math.round(w * 3)}" height="${Math.round(h * 1.06 * 3)}">`);
  out.push(`<rect x="0" y="${-h * 0.06}" width="${w}" height="${h * 1.06}" fill="#d9d4c4"/>`);
  for (const z of map.zones) if (inBox(z)) out.push(`<path d="${path(z, true)}" fill="#c9b78f" fill-opacity="0.6" stroke="#8a6d3b" stroke-width="0.6" stroke-dasharray="3 2"/>`);
  for (const r of map.roads) if (inBox(r.pts)) out.push(`<path d="${path(r.pts, false)}" fill="none" stroke="#5a5a5e" stroke-width="${Math.max(1.5, r.width).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  let shown = 0;
  let lots = 0;
  let regular = 0;
  for (const p of map.parcels) {
    if (!inBox(p.ring)) continue;
    const plan = map.plans.get(p.id);
    if (!plan) continue;
    shown++;
    const lot = p.source === 'generator';
    const reg = map.regularised.has(p.id);
    const bp = p.source === 'blueprint';
    if (lot) lots++;
    if (reg) regular++;
    const fill = hex(shadeBy(plan.tint, Math.max(0.55, 1 - plan.floors * 0.035)));
    out.push(`<path d="${path(p.ring, true)}" fill="${fill}" stroke="${lot ? '#1f5fd0' : bp ? '#8a2be2' : reg ? '#d0661f' : '#3a342c'}" stroke-width="${lot || reg || bp ? 0.7 : 0.25}"/>`);
    if (w <= 420) {
      let cx = 0;
      let cz = 0;
      for (const q of p.ring) {
        cx += q.x;
        cz += q.z;
      }
      out.push(`<text x="${(cx / p.ring.length - box.minX).toFixed(1)}" y="${(cz / p.ring.length - box.minZ + 1.2).toFixed(1)}" font-size="3.2" text-anchor="middle" fill="#111" font-family="sans-serif">${plan.floors}</text>`);
    }
  }
  for (const a of map.areas) for (const r of a.rings) if (inBox(r)) out.push(`<path d="${path(r, true)}" fill="none" stroke="#b0182a" stroke-width="1.2" stroke-dasharray="6 4"/>`);
  for (const t of map.transects) {
    const a = t.samples[0];
    const b = t.samples[t.samples.length - 1];
    if (!a || !b || !inBox([a, b])) continue;
    out.push(`<path d="${path([a, b], false)}" stroke="#0a7a3a" stroke-width="1.5" fill="none"/>`);
    for (const s of t.samples) out.push(`<circle cx="${(s.x - box.minX).toFixed(1)}" cy="${(s.z - box.minZ).toFixed(1)}" r="1.6" fill="#0a7a3a"/>`);
  }
  const fs = Math.max(6, w / 70);
  out.push(`<text x="${fs * 0.5}" y="${-h * 0.06 + fs * 1.2}" font-size="${fs}" font-family="sans-serif" fill="#111">${esc(title)}</text>`);
  out.push(`<text x="${fs * 0.5}" y="${-h * 0.06 + fs * 2.5}" font-size="${fs * 0.7}" font-family="sans-serif" fill="#333">${shown} parcels in their wall colour (darker: more floors${w <= 420 ? ', the number is the floor count' : ''}); blue outline: ${lots} lots cut from a block face; orange: ${regular} regularised outlines; red dashes: area edges; green: blend transects; tan: landmark zones</text>`);
  out.push('</svg>');
  return out.join('\n');
}

const PALETTE = ['#b0182a', '#1f5fd0', '#0a7a3a', '#d0961f', '#7a3ab0', '#1fa3a3', '#8a6d3b', '#555555', '#d04f8a', '#3a6b1f'];

/** The transects as stacked charts: the weight of every profile along each line. */
export function transectSvg(transects: readonly Transect[], title: string): string {
  const W = 900;
  const rowH = 190;
  const H = 40 + transects.length * rowH;
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 2}" height="${H * 2}">`, `<rect width="${W}" height="${H}" fill="#fff"/>`, `<text x="12" y="22" font-size="14" font-family="sans-serif">${esc(title)}</text>`];
  transects.forEach((t, row) => {
    const y0 = 40 + row * rowH;
    const ph = 110;
    const x0 = 50;
    const pw = W - 320;
    const len = t.samples[t.samples.length - 1]?.at ?? 1;
    const keys = [...new Set(t.samples.flatMap((s) => s.weights.map((w) => w.key)))].sort();
    out.push(`<text x="12" y="${y0 + 12}" font-size="11" font-family="sans-serif">${esc(t.name)}: largest step ${(t.maxStep * 100).toFixed(1)} percent between samples 25 m apart; the weight of ${esc(t.area)} goes ${t.from.toFixed(2)} to ${t.to.toFixed(2)}, largest rise ${t.maxRise.toFixed(3)}</text>`);
    out.push(`<rect x="${x0}" y="${y0 + 22}" width="${pw}" height="${ph}" fill="#f6f4ee" stroke="#999" stroke-width="0.5"/>`);
    keys.forEach((k, ki) => {
      const pts = t.samples.map((s) => `${(x0 + (s.at / len) * pw).toFixed(1)},${(y0 + 22 + ph - (s.weights.find((w) => w.key === k)?.w ?? 0) * ph).toFixed(1)}`).join(' ');
      const col = PALETTE[ki % PALETTE.length] as string;
      out.push(`<polyline points="${pts}" fill="none" stroke="${col}" stroke-width="${k === `area:${t.area}` ? 2.2 : 1.2}"/>`);
      out.push(`<rect x="${x0 + pw + 14}" y="${y0 + 24 + ki * 13}" width="9" height="9" fill="${col}"/><text x="${x0 + pw + 28}" y="${y0 + 32 + ki * 13}" font-size="9.5" font-family="sans-serif">${esc(k)}</text>`);
    });
    for (const s of t.samples) out.push(`<line x1="${(x0 + (s.at / len) * pw).toFixed(1)}" y1="${y0 + 22 + ph}" x2="${(x0 + (s.at / len) * pw).toFixed(1)}" y2="${y0 + 22 + ph + 3}" stroke="#555" stroke-width="0.5"/>`);
    out.push(`<text x="${x0}" y="${y0 + 22 + ph + 14}" font-size="9" font-family="sans-serif">0 m</text><text x="${x0 + pw}" y="${y0 + 22 + ph + 14}" font-size="9" text-anchor="end" font-family="sans-serif">${len} m</text>`);
  });
  out.push('</svg>');
  return out.join('\n');
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
