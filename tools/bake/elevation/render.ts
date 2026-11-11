// Debug pictures of the solved heights (SVG text; the driver turns them into PNGs). heightMapSvg: north up (x east to
// the right, z south downwards, no flip), every road coloured by its height above the ground model, structures
// labelled. profileSvg: the side view of one road, heights drawn ten times taller than lengths, the ground model
// under it. Pure.
import type { Box2 } from '../geom.ts';
import type { Station, Strip } from '../roads/model.ts';
import type { Structure } from './structures.ts';

const f = (v: number): string => (Math.round(v * 100) / 100).toString();
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Colour of a height above the ground model: blue under it, grey at grade, yellow to red above. */
export function hagColour(hag: number): string {
  if (hag < -4.5) return '#1d3f9e';
  if (hag < -2) return '#3f74d1';
  if (hag < -0.6) return '#8fb4ea';
  if (hag <= 0.6) return '#5b5b60';
  if (hag <= 2) return '#e6c229';
  if (hag <= 4.5) return '#f08a24';
  return '#d1341f';
}

const LEGEND: readonly [string, number][] = [['under -4.5 m (tunnel)', -6], ['-4.5 to -2 m', -3], ['-2 to -0.6 m (cut)', -1], ['at grade', 0], ['0.6 to 2 m (fill)', 1], ['2 to 4.5 m', 3], ['over 4.5 m (deck)', 6]];

/** Every strip coloured by height above the ground model, with the structures named. One SVG unit is one metre. */
export function heightMapSvg(strips: readonly Strip[], structures: readonly Structure[], box: Box2, title: string): string {
  const w = box.maxX - box.minX;
  const h = box.maxZ - box.minZ;
  const u = Math.max(w, h) / 2400;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(box.minX)} ${f(box.minZ - 46 * u)} ${f(w)} ${f(h + 46 * u)}" width="${Math.round(w / u)}" height="${Math.round(h / u + 46)}" font-family="Helvetica, Arial, sans-serif">`);
  out.push(`<rect x="${f(box.minX)}" y="${f(box.minZ - 46 * u)}" width="${f(w)}" height="${f(h + 46 * u)}" fill="#eceae4"/>`);
  // at grade first, then lowered, then raised: a deck is drawn over the road under it
  for (const level of [0, -1, 1]) {
    const paths = new Map<string, string[]>();
    for (const s of strips) {
      const width = Math.max(3 * u, Math.abs((s.st[0] as Station).b[0] as number) + Math.abs((s.st[0] as Station).b[(s.st[0] as Station).b.length - 1] as number));
      for (let i = 0; i + 1 < s.st.length; i++) {
        const a = s.st[i] as Station;
        const b = s.st[i + 1] as Station;
        const hag = (a.h - a.g + b.h - b.g) / 2;
        if ((hag > 0.6 ? 1 : hag < -0.6 ? -1 : 0) !== level) continue;
        const key = `${hagColour(hag)}|${f(level === 0 ? width : Math.max(width, 5 * u))}`;
        const d = `M${f(a.x)} ${f(a.z)}L${f(b.x)} ${f(b.z)}`;
        const list = paths.get(key);
        if (list) list.push(d);
        else paths.set(key, [d]);
      }
    }
    for (const [key, d] of paths) {
      const [colour, width] = key.split('|') as [string, string];
      out.push(`<path d="${d.join('')}" fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round"/>`);
    }
  }
  for (const s of structures) {
    if (s.structureM < 60) continue;
    const label = `${s.id} ${s.kind}${s.name ? `: ${s.name.split(', ')[0]}` : ''} (${Math.round(s.structureM)} m${s.sunk > 0.05 ? `, sunk ${s.sunk}` : ''})`;
    out.push(`<text x="${f(s.x + 8 * u)}" y="${f(s.z - 6 * u)}" font-size="${f(13 * u)}" fill="#111" stroke="#eceae4" stroke-width="${f(3 * u)}" paint-order="stroke">${esc(label)}</text>`);
  }
  const top = box.minZ - 46 * u;
  out.push(`<rect x="${f(box.minX)}" y="${f(top)}" width="${f(w)}" height="${f(40 * u)}" fill="#1d1f24"/><text x="${f(box.minX + 12 * u)}" y="${f(top + 26 * u)}" font-size="${f(18 * u)}" fill="#fff">${esc(title)}</text>`);
  LEGEND.forEach(([name, hag], i) => {
    const x = box.minX + 14 * u;
    const y = box.maxZ - (LEGEND.length - i) * 24 * u - 30 * u;
    out.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(34 * u)}" height="${f(14 * u)}" fill="${hagColour(hag)}"/><text x="${f(x + 42 * u)}" y="${f(y + 12 * u)}" font-size="${f(14 * u)}" fill="#111">${name}</text>`);
  });
  const nx = box.maxX - 40 * u;
  const ny = box.minZ + 20 * u;
  out.push(`<polygon points="${f(nx)},${f(ny)} ${f(nx - 9 * u)},${f(ny + 30 * u)} ${f(nx)},${f(ny + 23 * u)} ${f(nx + 9 * u)},${f(ny + 30 * u)}" fill="#111"/><text x="${f(nx - 6 * u)}" y="${f(ny + 48 * u)}" font-size="${f(16 * u)}" font-weight="bold" fill="#111">N</text>`);
  out.push(`<rect x="${f(box.minX + 14 * u)}" y="${f(box.maxZ - 16 * u)}" width="500" height="${f(5 * u)}" fill="#111"/><text x="${f(box.minX + 14 * u)}" y="${f(box.maxZ - 22 * u)}" font-size="${f(13 * u)}" fill="#111">500 m</text></svg>`);
  return out.join('\n');
}

/**
 * Side view of the strips `pick` chooses (a flyover with both carriageways and its ramps): metres along the road's
 * main direction to the right, heights ten times taller, the ground model under each strip, a line every metre of height.
 */
export function profileSvg(strips: readonly Strip[], pick: (s: Strip) => boolean, title: string): string {
  const chosen = strips.filter(pick);
  const pts = chosen.flatMap((s) => s.st);
  if (pts.length < 2) return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="60"><text x="10" y="30">${esc(title)}: no road found</text></svg>`;
  // main direction: the longer side of the box, from north to south or west to east
  const xs = pts.map((p) => p.x);
  const zs = pts.map((p) => p.z);
  const alongZ = Math.max(...zs) - Math.min(...zs) > Math.max(...xs) - Math.min(...xs);
  const s0 = alongZ ? Math.min(...zs) : Math.min(...xs);
  const len = (alongZ ? Math.max(...zs) : Math.max(...xs)) - s0;
  const lo = Math.floor(Math.min(...pts.map((p) => Math.min(p.h, p.g))) - 1);
  const hi = Math.ceil(Math.max(...pts.map((p) => Math.max(p.h, p.g))) + 1);
  const V = 10;
  const W = 2200;
  const k = (W - 120) / len;
  const H = (hi - lo) * V * k + 110;
  const X = (p: Station): string => f(70 + ((alongZ ? p.z : p.x) - s0) * k);
  const Y = (h: number): string => f(60 + (hi - h) * V * k);
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Math.round(H)}" font-family="Helvetica, Arial, sans-serif"><rect width="100%" height="100%" fill="#f6f4ee"/>`];
  for (let m = lo; m <= hi; m++) out.push(`<line x1="70" y1="${Y(m)}" x2="${W - 50}" y2="${Y(m)}" stroke="${m % 5 === 0 ? '#b5b1a6' : '#e2dfd6'}" stroke-width="1"/>${m % 5 === 0 || hi - lo < 14 ? `<text x="62" y="${f(Number(Y(m)) + 4)}" font-size="12" text-anchor="end" fill="#444">${m} m</text>` : ''}`);
  for (let d = 0; d <= len; d += 100) out.push(`<text x="${f(70 + d * k)}" y="${f(H - 30)}" font-size="12" text-anchor="middle" fill="#444">${d} m</text><line x1="${f(70 + d * k)}" y1="${f(H - 46)}" x2="${f(70 + d * k)}" y2="60" stroke="#e2dfd6" stroke-width="1"/>`);
  for (const s of chosen) out.push(`<polyline points="${s.st.map((p) => `${X(p)},${Y(p.g)}`).join(' ')}" fill="none" stroke="#6f8f4e" stroke-width="2"/>`);
  for (const s of chosen) {
    for (let i = 0; i + 1 < s.st.length; i++) {
      const a = s.st[i] as Station;
      const b = s.st[i + 1] as Station;
      out.push(`<line x1="${X(a)}" y1="${Y(a.h)}" x2="${X(b)}" y2="${Y(b.h)}" stroke="${hagColour((a.h - a.g + b.h - b.g) / 2)}" stroke-width="${s.link ? 2.5 : 4}" stroke-linecap="round"/>`);
    }
  }
  out.push(`<rect width="100%" height="40" fill="#1d1f24"/><text x="12" y="26" font-size="18" fill="#fff">${esc(title)}: side view from the ${alongZ ? 'west, north on the left' : 'south, west on the left'}; heights 10 times taller; green is the ground model; thin lines are ramps</text></svg>`);
  return out.join('\n');
}
