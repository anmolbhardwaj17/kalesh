// Search Wikimedia Commons for current (2019+) free photos per pilot area.
// Usage: node build_boards_search.mjs   -> writes harness/reports/areaphotos/candidates.json
import fs from 'node:fs';
const UA = 'kalesh-area-reference-research/1.0 (internal game reference board)';
const OUT = new URL('../../reports/areaphotos/candidates.json', import.meta.url).pathname;
const AREAS = {
  chandni_chowk_main: ['Chandni Chowk redevelopment', 'Chandni Chowk sandstone', 'Chandni Chowk pedestrian', 'Chandni Chowk 2022', 'Chandni Chowk 2023', 'Chandni Chowk street', 'Chandni Chowk bazaar', 'Chandni Chowk Town Hall', 'Sisganj Gurudwara', 'Fatehpuri Masjid', 'Gauri Shankar Temple', 'Digambar Jain Lal Mandir', 'Chandni Chowk metro'],
  chandni_chowk_galis: ['Old Delhi lane', 'Old Delhi gali', 'Paratha Wali Gali', 'Kinari Bazaar', 'Dariba Kalan', 'Old Delhi wires', 'Chawri Bazaar', 'Ballimaran', 'Old Delhi alley', 'Old Delhi street 2022', 'Old Delhi bazaar 2023', 'Khari Baoli', 'Naya Bazar Delhi'],
  cp_inner_circle: ['Connaught Place inner circle', 'Connaught Place colonnade', 'Connaught Place 2022', 'Connaught Place 2023', 'Connaught Place arcade', 'Connaught Place facade', 'Connaught Place block', 'Connaught Place central park', 'Connaught Place street'],
  cp_outer_circle: ['Connaught Place outer circle', 'Connaught Place road', 'Barakhamba Road', 'Kasturba Gandhi Marg', 'Connaught Place traffic', 'Connaught Place 2021', 'Connaught Place 2024', 'Connaught Place night', 'Janpath Connaught'],
  gb_road_ajmeri_gate: ['GB Road Delhi', 'Ajmeri Gate Delhi', 'Shraddhanand Marg', 'Lahori Gate Delhi', 'Ajmeri Gate', 'Delhi Gate Ajmeri', 'Asaf Ali Road', 'New Delhi railway station Ajmeri Gate', 'Ramlila Maidan', 'Turkman Gate'],
  india_gate_kartavya_path: ['Kartavya Path', 'Rajpath', 'Central Vista avenue', 'Kartavya Path 2023', 'Kartavya Path 2024', 'India Gate', 'India Gate lawns', 'Kartavya Path lamp', 'Central Vista redevelopment', 'India Gate 2022'],
  ito: ['ITO Delhi', 'ITO intersection Delhi', 'Vikas Marg Delhi', 'Bahadur Shah Zafar Marg', 'Pragati Maidan tunnel', 'Pragati Maidan', 'Bharat Mandapam', 'Delhi flyover ITO', 'ITO metro', 'Delhi Police Headquarters', 'Indraprastha Delhi', 'Delhi Ring Road', 'Mathura Road Delhi', 'Tilak Marg'],
  janpath: ['Janpath', 'Janpath market', 'Janpath Delhi 2022', 'Janpath road', 'Tolstoy Marg', 'Janpath Lane', 'National Museum Delhi', 'Janpath Connaught', 'Jawaharlal Nehru Marg'],
  jantar_mantar: ['Jantar Mantar', 'Jantar Mantar road', 'Sansad Marg', 'Parliament Street Delhi', 'Jantar Mantar 2022', 'Jantar Mantar 2023', 'Patel Chowk', 'Parliament Street', 'Hanuman Road Connaught'],
  paharganj_station: ['Paharganj', 'Main Bazaar Paharganj', 'New Delhi railway station', 'Paharganj 2022', 'Paharganj street', 'Paharganj 2023', 'New Delhi Railway Station forecourt', 'Ramakrishna Ashram Marg', 'Nehru Bazaar', 'Paharganj lane'],
  red_fort_surroundings: ['Red Fort Delhi', 'Netaji Subhash Marg', 'Lal Qila road', 'Red Fort Chandni Chowk', 'Lahori Gate Red Fort', 'Jama Masjid Delhi', 'Meena Bazaar Red Fort', 'Red Fort 2022', 'Red Fort 2023', 'Digambar Jain Lal Mandir', 'Subhash Park', 'Lal Qila metro', 'Ring Road Red Fort'],
};
const FREE = /^(CC BY|CC0|CC-BY|Public domain|PD|CC BY-SA|Attribution)/i;
const strip = s => (s || '').replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, ' ').trim();
async function api(params) {
  const u = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ format: 'json', origin: '*', ...params });
  await new Promise(r => setTimeout(r, 700));
  for (let i = 0; i < 5; i++) {
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    if (r.ok) return r.json();
    await new Promise(r => setTimeout(r, 4000 * (i + 1)));
  }
  console.log('skip', u.slice(80, 160)); return {};
}
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
for (const [area, qs] of Object.entries(AREAS)) {
  const seen = out[area] || {};
  for (const q of qs) {
    let cont = {};
    for (let page = 0; page < 3; page++) {
      const j = await api({ action: 'query', generator: 'search', gsrsearch: q + ' filetype:bitmap', gsrnamespace: 6, gsrlimit: 50, prop: 'imageinfo', iiprop: 'url|size|extmetadata|mime', iiurlwidth: 1000, ...cont });
      for (const p of Object.values(j.query?.pages || {})) {
        const ii = p.imageinfo?.[0]; if (!ii) continue;
        const m = ii.extmetadata || {};
        const date = strip(m.DateTimeOriginal?.value) || strip(m.DateTime?.value);
        const lic = strip(m.LicenseShortName?.value);
        const ym = date.match(/(20[0-2]\d)/);
        const year = ym ? +ym[1] : null;
        if (!FREE.test(lic)) continue;
        if (!year || year < 2019) continue;
        if (ii.width < 1200) continue;
        seen[p.title] = { title: p.title, year, date, lic, author: strip(m.Artist?.value).slice(0, 80), w: ii.width, h: ii.height, thumb: ii.thumburl, page: ii.descriptionurl, desc: strip(m.ImageDescription?.value).slice(0, 160), q };
      }
      if (!j.continue) break; cont = j.continue;
    }
  }
  out[area] = seen;
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(area, Object.keys(seen).length);
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
