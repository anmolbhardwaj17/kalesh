// Debug renders of the pilot census (P0-018): a north-up, top-down picture of one district with its roads and
// buildings on a plain ground and the counted issues as coloured marks. East is right, north is up, like the map.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export const RULE_COLOURS = {
  'R-ROAD-01': '#e6194b', 'R-ROAD-02': '#f58231', 'R-ROAD-04': '#911eb4', 'R-BRIDGE-01': '#0082c8', 'R-BRIDGE-02': '#008080',
  'R-BLDG-01': '#d4a000', 'R-BLDG-03': '#3cb44b', 'R-TERR-03': '#7a5230',
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Writes a PNG. `layers` = { roads, buildings, open, issues, title, counts, extra }: roads and buildings in district
 * metres, issues as rule engine records. `rules` limits the issues drawn. Returns the file path.
 */
export async function renderMap(file, box, layers, opts = {}) {
  const width = opts.width || 1600;
  const pad = 30;
  const top = 64;
  const scale = (width - 2 * pad) / (box.maxX - box.minX);
  const height = Math.round((box.maxZ - box.minZ) * scale + top + pad + 20);
  const X = (x) => (pad + (x - box.minX) * scale).toFixed(1);
  const Z = (z) => (top + (z - box.minZ) * scale).toFixed(1);
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="Helvetica, Arial, sans-serif">`);
  out.push(`<rect width="100%" height="100%" fill="#f4f1ea"/>`);
  out.push(`<rect x="${pad}" y="${top}" width="${((box.maxX - box.minX) * scale).toFixed(1)}" height="${((box.maxZ - box.minZ) * scale).toFixed(1)}" fill="#ece8de" stroke="#b9b3a4"/>`);
  for (const o of layers.open || []) out.push(`<polygon points="${o.ring.map((p) => `${X(p.x)},${Z(p.z)}`).join(' ')}" fill="#cfe3c2" stroke="none"/>`);
  for (const b of layers.buildings || []) out.push(`<polygon points="${b.ring.map((p) => `${X(p.x)},${Z(p.z)}`).join(' ')}" fill="${b.fill || '#c9c2b4'}" stroke="#a39c8d" stroke-width="0.4"/>`);
  for (const r of layers.roads || []) {
    const w = Math.max(0.8, r.width * scale);
    const colour = r.bridge ? '#5b6f8f' : r.tunnel ? '#9a9a9a' : '#ffffff';
    out.push(`<polyline points="${r.pts.map((p) => `${X(p.x)},${Z(p.z)}`).join(' ')}" fill="none" stroke="#8d8778" stroke-width="${(w + 1.2).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    out.push(`<polyline points="${r.pts.map((p) => `${X(p.x)},${Z(p.z)}`).join(' ')}" fill="none" stroke="${colour}" stroke-width="${w.toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"${r.tunnel ? ' stroke-dasharray="6 4"' : ''}/>`);
  }
  for (const e of layers.extra || []) out.push(e({ X, Z, scale }));
  const rules = opts.rules || Object.keys(RULE_COLOURS);
  for (const i of layers.issues || []) {
    if (!rules.includes(i.rule)) continue;
    const c = RULE_COLOURS[i.rule] || '#000';
    const p = i.proposals?.[0]?.preview;
    if (p && p.length >= 2 && p.length <= 400 && i.rule !== 'R-BLDG-03') out.push(`<polyline points="${p.map((q) => `${X(q.x)},${Z(q.z)}`).join(' ')}" fill="none" stroke="${c}" stroke-width="2.2" stroke-opacity="0.75"/>`);
    out.push(`<circle cx="${X(i.x)}" cy="${Z(i.z)}" r="${opts.dot || 5}" fill="${c}" fill-opacity="0.85" stroke="#fff" stroke-width="1"/>`);
  }
  // title, legend, north arrow, scale bar
  out.push(`<text x="${pad}" y="26" font-size="20" font-weight="bold" fill="#222">${esc(layers.title || '')}</text>`);
  let lx = pad;
  for (const rule of rules) {
    const n = layers.counts?.[rule];
    const label = `${rule}${n !== undefined ? ` (${n})` : ''} ${opts.labels?.[rule] || ''}`.trim();
    out.push(`<circle cx="${lx + 7}" cy="46" r="6" fill="${RULE_COLOURS[rule]}"/><text x="${lx + 18}" y="51" font-size="13" fill="#333">${esc(label)}</text>`);
    lx += 26 + label.length * 7.1;
  }
  const nx = width - pad - 26;
  out.push(`<polygon points="${nx},${top + 14} ${nx - 9},${top + 44} ${nx},${top + 37} ${nx + 9},${top + 44}" fill="#222"/><text x="${nx - 6}" y="${top + 62}" font-size="16" font-weight="bold" fill="#222">N</text>`);
  const bar = 200;
  out.push(`<rect x="${pad + 10}" y="${height - pad - 2}" width="${(bar * scale).toFixed(1)}" height="5" fill="#222"/><text x="${pad + 10}" y="${height - pad - 8}" font-size="13" fill="#222">${bar} m</text>`);
  out.push('</svg>');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp(Buffer.from(out.join('\n'))).png().toFile(file);
  return file;
}
