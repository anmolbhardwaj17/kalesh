// Rebuild the pilot area boards and sheet sections with current, dated photos (P2-049, 2026-11-14).
// Usage: node harness/design/areas/build_boards.mjs [--no-download]
// Inputs: current_photos.json (picked photos, dates, credits), build_boards_data.mjs (made-of text).
// Needs the 500 px thumbs cached under harness/reports/areaphotos/ (build_boards_sheet.mjs fills it).
// Writes: <area>_board.jpg (current photos first, old board below, dimmed and marked OLD) and a marked block
// in <area>.md between "<!-- P2-049:start -->" and "<!-- P2-049:end -->" (safe to rerun).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { CUTOFF, CUTOFF_ISO, DEFAULT_CUTOFF, MADE_OF } from './build_boards_data.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const cache = path.join(here, '../../reports/areaphotos');
const UA = 'kalesh-area-reference-research/1.0 (internal game reference board)';
const photos = JSON.parse(fs.readFileSync(path.join(here, 'current_photos.json'), 'utf8'));
const cand = JSON.parse(fs.readFileSync(path.join(cache, 'candidates.json'), 'utf8'));
const pool = Object.assign({}, ...Object.values(cand));
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

function isoDate(s) {
  let m = s.match(/(\d{4})-(\d\d)-(\d\d)/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/(\d{1,2}) ([A-Za-z]+) (\d{4})/); if (m && MONTHS[m[2].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/([A-Za-z]+) (\d{1,2}),? (\d{4})/); if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = s.match(/(\d{4})/); return m ? m[1] : s;
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const thumbOf = title => {
  const h = crypto.createHash('md5').update('File:' + title).digest('hex').slice(0, 16);
  for (const d of fs.readdirSync(cache)) { const f = path.join(cache, d, h + '.jpg'); if (fs.existsSync(f)) return f; }
  return null;
};
async function ensureThumb(r) {
  let f = thumbOf(r.title); if (f) return f;
  const c = pool['File:' + r.title]; if (!c) return null;
  const dir = path.join(cache, '_extra'); fs.mkdirSync(dir, { recursive: true });
  f = path.join(dir, crypto.createHash('md5').update('File:' + r.title).digest('hex').slice(0, 16) + '.jpg');
  for (let t = 0; t < 5; t++) {
    const x = await fetch(c.thumb.replace(/\/\d+px-/, '/500px-'), { headers: { 'User-Agent': UA } });
    if (x.ok) { fs.writeFileSync(f, Buffer.from(await x.arrayBuffer())); return f; }
    await new Promise(r2 => setTimeout(r2, 4000 * (t + 1)));
  }
  return null;
}

// k-means on a few thousand pixels
function kmeans(px, k, iters = 12) {
  let cs = Array.from({ length: k }, (_, i) => px[Math.floor((i + 0.5) * px.length / k)].slice());
  let counts = new Array(k).fill(0);
  for (let it = 0; it < iters; it++) {
    const sum = Array.from({ length: k }, () => [0, 0, 0]); counts = new Array(k).fill(0);
    for (const p of px) { let b = 0, bd = 1e9; for (let i = 0; i < k; i++) { const d = (p[0] - cs[i][0]) ** 2 + (p[1] - cs[i][1]) ** 2 + (p[2] - cs[i][2]) ** 2; if (d < bd) { bd = d; b = i; } } counts[b]++; for (let j = 0; j < 3; j++) sum[b][j] += p[j]; }
    cs = cs.map((c, i) => counts[i] ? sum[i].map(v => v / counts[i]) : c);
  }
  return cs.map((c, i) => ({ c: c.map(Math.round), share: counts[i] / px.length })).sort((a, b) => b.share - a.share);
}
const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
async function sampleBands(files) {
  const fac = [], road = [];
  for (const f of files) {
    const { data, info } = await sharp(f).resize(120, 80, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    let lum = 0; for (let i = 0; i < data.length; i += 3) lum += (data[i] + data[i + 1] + data[i + 2]) / 3; lum /= data.length / 3;
    if (lum < 70) continue; // night shot
    const px = (x, y) => { const i = (y * info.width + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
    for (let y = 14; y < 42; y++) for (let x = 0; x < 120; x++) { // facade band: 18% to 52% height
      const p = px(x, y), l = (p[0] + p[1] + p[2]) / 3;
      if (l < 45 || l > 225) continue; // black, white sky
      if (p[2] > p[0] + 8 && l > 140) continue; // blue sky
      if (p[1] > p[0] + 12 && p[1] > p[2] + 8) continue; // foliage
      fac.push(p);
    }
    for (let y = 66; y < 76; y++) for (let x = 30; x < 90; x++) road.push(px(x, y)); // road band, centre
  }
  const sub = (a, n) => a.filter((_, i) => i % Math.ceil(a.length / n) === 0);
  const lumOf = c => (c[0] + c[1] + c[2]) / 3;
  const fc = fac.length > 200 ? kmeans(sub(fac, 4000), 6).filter(c => c.share > 0.06 && lumOf(c.c) >= 75).sort((a, b) => lumOf(a.c) - lumOf(b.c)) : [];
  const rk = road.length ? kmeans(sub(road, 3000), 3).filter(c => c.share > 0.1) : [];
  return { fac: fc, road: rk.length ? { main: hex(rk[0].c), others: rk.slice(1).map(c => hex(c.c)) } : null, n: files.length };
}

const caption = (lines, W, H = 44) => `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="#202020"/>` +
  lines.map((l, i) => `<text x="3" y="${12 + i * 13}" font-size="${i ? 10.5 : 12}" fill="${i ? '#c8c8c8' : '#ffe14d'}" font-family="Helvetica,Arial,sans-serif">${esc(l)}</text>`).join('') + '</svg>';

const only = process.argv.filter(a => a.startsWith('--area=')).map(a => a.slice(7));
const summary = {};
for (const [area, rows0] of Object.entries(photos)) {
  if (only.length && !only.includes(area)) continue;
  const cutIso = CUTOFF_ISO[area] || '2019-01-01';
  const rows = rows0.map(r => { const iso = isoDate(r.date); return { ...r, iso, old: (iso.length === 4 ? iso + '-12-31' : iso) < cutIso }; });
  const cur = rows.filter(r => !r.old).sort((a, b) => (a.view === 'street' ? 0 : 1) - (b.view === 'street' ? 0 : 1) || a.iso.localeCompare(b.iso));
  const old = rows.filter(r => r.old);
  const files = [];
  for (const r of cur) { const f = await ensureThumb(r); if (!f) console.log('no thumb', area, r.title); r.f = f; if (f) files.push(f); }
  for (const [i, r] of cur.entries()) r.id = 'C' + (i + 1);
  // board
  const cols = 6, W = 300, IH = 200, CH = 46;
  const n = cur.filter(r => r.f).length, nrows = Math.ceil(n / cols);
  const oldPath = path.join(here, area + '_board_old.jpg'), boardPath = path.join(here, area + '_board.jpg');
  if (!fs.existsSync(oldPath)) fs.copyFileSync(boardPath, oldPath);
  const oldMeta = await sharp(oldPath).metadata();
  const BW = cols * W, bannerH = 44;
  const comps = [];
  const headH = 40;
  comps.push({ input: Buffer.from(`<svg width="${BW}" height="${headH}" xmlns="http://www.w3.org/2000/svg"><rect width="${BW}" height="${headH}" fill="#0d3b1e"/><text x="8" y="26" font-size="20" fill="#ffffff" font-family="Helvetica,Arial,sans-serif" font-weight="bold">${esc(area)}: CURRENT photos (${CUTOFF[area] || DEFAULT_CUTOFF})</text></svg>`), left: 0, top: 0 });
  let k = 0;
  for (const r of cur) {
    if (!r.f) continue;
    const x = (k % cols) * W, y = headH + Math.floor(k / cols) * (IH + CH);
    const img = await sharp(r.f).resize(W, IH, { fit: 'contain', background: '#202020' }).toBuffer();
    comps.push({ input: img, left: x, top: y });
    comps.push({ input: Buffer.from(caption([`${r.id} ${r.iso} ${r.view}`, r.title.slice(0, 48), `${r.author.slice(0, 22)}, ${r.lic}`], W, CH)), left: x, top: y + IH });
    k++;
  }
  const curH = headH + nrows * (IH + CH);
  comps.push({ input: Buffer.from(`<svg width="${BW}" height="${bannerH}" xmlns="http://www.w3.org/2000/svg"><rect width="${BW}" height="${bannerH}" fill="#7a1111"/><text x="8" y="29" font-size="20" fill="#ffffff" font-family="Helvetica,Arial,sans-serif" font-weight="bold">Earlier P0 photo set below (dimmed). Photos marked OLD in the sheet table (before the current state) are not used for surfaces, signs or colours</text></svg>`), left: 0, top: curH });
  const oldScaled = await sharp(oldPath).resize({ width: BW }).modulate({ brightness: 0.6, saturation: 0.6 }).toBuffer();
  const oh = (await sharp(oldScaled).metadata()).height;
  comps.push({ input: oldScaled, left: 0, top: curH + bannerH });
  const total = curH + bannerH + oh;
  await sharp({ create: { width: BW, height: total, channels: 3, background: '#202020' } }).composite(comps).jpeg({ quality: 82 }).toFile(boardPath);

  // sampled colours
  const sFiles = cur.filter(r => r.f && r.view === 'street').map(r => r.f);
  const s = await sampleBands(sFiles);
  const facTxt = s.fac.length ? s.fac.map(c => `${hex(c.c)} (${Math.round(c.share * 100)}%)`).join(', ') : 'not enough open facade in the photos';
  const facHexes = s.fac.map(c => hex(c.c));

  // md block
  const m = MADE_OF[area];
  const L = [];
  L.push('<!-- P2-049:start -->');
  L.push('## Current photos and what the street is made of today (P2-049, 2026-11-14)', '');
  L.push(`Added 2026-11-14 on Anmol's rule: areas are built from how they look today, and every photo carries its date. **State used:** ${CUTOFF[area] || DEFAULT_CUTOFF}. Board: \`${area}_board.jpg\` (current photos first, the earlier P0 board below it, dimmed; the old board alone is \`${area}_board_old.jpg\`).`, '');
  L.push('Date basis: Commons "date" field. EXIF = a time of day is present (taken from the camera tags); stated = the uploader typed the date (no time of day), treated as unverified. Licences are as shown by Commons on 2026-11-14.', '');
  L.push('| C | File | Date (basis) | View | Author | Licence | URL |', '|---|---|---|---|---|---|---|');
  for (const r of cur) L.push(`| ${r.id} | ${r.title} | ${r.iso} (${r.basis}) | ${r.view} | ${r.author.replace(/\|/g, '/')} | ${r.lic} | https://commons.wikimedia.org/wiki/File:${encodeURI(r.title.replace(/ /g, '_'))} |`);
  if (old.length) { L.push('', 'Picked but OLD (before the state above): not used for surfaces, signs or colours.', '', '| File | Date | Author | Licence |', '|---|---|---|---|'); for (const r of old) L.push(`| ${r.title} | ${r.iso} (${r.basis}) | ${r.author.replace(/\|/g, '/')} | ${r.lic} |`); }
  const nStreet = cur.filter(r => r.view === 'street').length;
  L.push('', `Count: ${cur.length} current photos, ${nStreet} at street level or from the player's height (view = street), oldest current date ${cur.map(r => r.iso).sort()[0]}.`, '');
  L.push('### What it is made of today', '');
  for (const c of m.changed) L.push(`- **Changed since the old photos:** ${c}`);
  L.push(`- **Facade colours (sampled):** k-means on the building band (18% to 52% of the frame height, sky, foliage, black and shadow removed, shown dark to light) of ${s.n} street-level current photos (night shots skipped): ${facTxt}. Treat as the range; pick facade paints from these, and bright colours only where a photo shows them.`);
  if (s.road) L.push(`- **Road surface sampled:** the bottom centre of the same photos, largest colour cluster ${s.road.main}${s.road.others.length ? ', others ' + s.road.others.join(', ') : ''} (cars, paint and shadow are mixed in, so read the main value as the surface and judge it against the photos).`);
  for (const l of m.lines) L.push(`- ${l}`);
  L.push('', '### Photo requests for Anmol', '');
  if (m.requests.length) for (const q of m.requests) L.push(`- ${q}`); else L.push('- none: the current set shows the surface, signs, colours and the player-height view.');
  L.push('<!-- P2-049:end -->', '');
  const mdPath = path.join(here, area + '.md');
  let md = fs.readFileSync(mdPath, 'utf8');
  md = md.replace(/<!-- P2-049:start -->[\s\S]*?<!-- P2-049:end -->\n?/, '');
  // mark old rows in the Sources table
  const cutYear = area === 'chandni_chowk_main' || area === 'india_gate_kartavya_path' || area === 'ito' ? 2022 : 2019;
  md = md.split('\n').map(l => {
    if (!/^\| \d+ \|/.test(l) || l.includes('OLD (')) return l;
    const years = [...l.matchAll(/\b(1[89]\d\d|20[0-2]\d)\b/g)].map(x => +x[1]);
    const y = years.length ? years[years.length - 1] : null;
    return y && y < cutYear ? l.replace(/ \|$/, ` **OLD (${y}, before ${cutYear}): not used for surfaces, signs or colours** |`) : l;
  }).join('\n');
  const marker = '\n## Sources';
  const idx = md.indexOf(marker);
  md = idx >= 0 ? md.slice(0, idx) + '\n' + L.join('\n') + md.slice(idx) : md + '\n' + L.join('\n');
  fs.writeFileSync(mdPath, md);
  summary[area] = { current: cur.length, street: nStreet, oldest: cur.map(r => r.iso).sort()[0], facade: facHexes, road: s.road };
  console.log(area, JSON.stringify(summary[area]));
}
