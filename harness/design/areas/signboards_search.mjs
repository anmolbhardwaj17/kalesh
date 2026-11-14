// Search Wikimedia Commons for free, dated photos of shop sign boards per pilot area (P2-048, 2026-11-14).
// Usage: node harness/design/areas/signboards_search.mjs   -> harness/reports/signboards/candidates.json
// Keeps free licences only, and a year read from the file's EXIF or upload metadata. Picking and the board image:
// signboards_board.mjs.
import fs from 'node:fs';
import path from 'node:path';

const UA = 'kalesh-area-reference-research/1.0 (internal game reference board)';
const OUT_DIR = new URL('../../reports/signboards/', import.meta.url).pathname;
const OUT = path.join(OUT_DIR, 'candidates.json');
const AREAS = {
  chandni_chowk_main: ['Chandni Chowk shop', 'Chandni Chowk shops', 'Chandni Chowk signboard', 'Chandni Chowk market', 'Chandni Chowk 2022', 'Chandni Chowk 2023', 'Chandni Chowk 2024', 'Chandni Chowk sweets shop'],
  chandni_chowk_galis: ['Old Delhi shop sign', 'Old Delhi shop', 'Old Delhi signs', 'Kinari Bazaar', 'Dariba Kalan', 'Chawri Bazaar', 'Khari Baoli shop', 'Old Delhi market', 'Nai Sarak Delhi', 'Ballimaran'],
  paharganj_station: ['Paharganj', 'Main Bazaar Paharganj', 'Paharganj hotel', 'Paharganj signs', 'Paharganj market', 'Paharganj street'],
  janpath: ['Janpath market', 'Janpath', 'Tibetan market Janpath', 'Janpath shops'],
  gb_road_ajmeri_gate: ['GB Road Delhi', 'Shraddhanand Marg', 'Ajmeri Gate', 'Lahori Gate Delhi market', 'Delhi hardware market', 'Delhi machinery shop'],
  cp_inner_circle: ['Connaught Place shop', 'Connaught Place showroom', 'Connaught Place shops', 'Connaught Place colonnade', 'Connaught Place store'],
  cp_outer_circle: ['Connaught Place outer circle', 'Connaught Place night', 'Connaught Place block'],
  ito: ['ITO Delhi', 'Bahadur Shah Zafar Marg', 'Daryaganj', 'Daryaganj book market', 'Asaf Ali Road'],
  any_delhi: ['Delhi shop sign', 'Delhi signboard', 'Delhi shop signs', 'hand painted sign India', 'shop signs India', 'signboard Hindi', 'Indian shop front', 'Delhi shopfront', 'painted sign Delhi'],
};
const FREE = /^(CC BY|CC0|CC-BY|Public domain|PD|CC BY-SA|Attribution)/i;
const strip = (s) => (s || '').replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, ' ').trim();
async function api(params) {
  const u = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ format: 'json', origin: '*', ...params });
  await new Promise((r) => setTimeout(r, 500));
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA } });
      if (r.ok) return r.json();
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
  }
  console.log('skip', u.slice(80, 160));
  return {};
}
fs.mkdirSync(OUT_DIR, { recursive: true });
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
for (const [area, qs] of Object.entries(AREAS)) {
  const seen = out[area] || {};
  for (const q of qs) {
    const j = await api({ action: 'query', generator: 'search', gsrsearch: q + ' filetype:bitmap', gsrnamespace: 6, gsrlimit: 50, prop: 'imageinfo', iiprop: 'url|size|extmetadata|mime', iiurlwidth: 900 });
    for (const p of Object.values(j.query?.pages || {})) {
      const ii = p.imageinfo?.[0];
      if (!ii) continue;
      const m = ii.extmetadata || {};
      const date = strip(m.DateTimeOriginal?.value) || strip(m.DateTime?.value);
      const lic = strip(m.LicenseShortName?.value);
      const ym = date.match(/((?:19|20)\d\d)/);
      const year = ym ? +ym[1] : null;
      if (!FREE.test(lic) || !year || ii.width < 900) continue;
      seen[p.title] = { title: p.title, year, date, basis: m.DateTimeOriginal?.value ? 'EXIF or author date' : 'upload date', lic, author: strip(m.Artist?.value).slice(0, 80), w: ii.width, h: ii.height, thumb: ii.thumburl, page: ii.descriptionurl, desc: strip(m.ImageDescription?.value).slice(0, 200), q };
    }
  }
  out[area] = seen;
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(area, Object.keys(seen).length);
}
