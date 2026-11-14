// Harvest current (2019+) free files from Commons categories (with one level of subcategories).
// Usage: node build_boards_cats.mjs <area> "Category:A" "Category:B" ...   -> merges into candidates.json
import fs from 'node:fs';
const UA = 'kalesh-area-reference-research/1.0 (internal game reference board)';
const OUT = new URL('../../reports/areaphotos/candidates.json', import.meta.url).pathname;
const [area, ...cats] = process.argv.slice(2);
const FREE = /^(CC BY|CC0|CC-BY|Public domain|PD|CC BY-SA|Attribution)/i;
const strip = s => (s || '').replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, ' ').trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(params) {
  for (let i = 0; i < 6; i++) {
    await sleep(900);
    const r = await fetch('https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ format: 'json', origin: '*', ...params }), { headers: { 'User-Agent': UA } });
    if (r.ok) return r.json();
    await sleep(6000 * (i + 1));
  }
  return {};
}
const out = JSON.parse(fs.readFileSync(OUT, 'utf8')); const seen = out[area] ||= {};
const todo = [...cats]; const done = new Set();
for (let n = 0; n < todo.length && n < 25; n++) {
  const cat = todo[n]; if (done.has(cat)) continue; done.add(cat);
  if (n < cats.length) { // subcats of the roots only
    const j = await api({ action: 'query', list: 'categorymembers', cmtitle: cat, cmtype: 'subcat', cmlimit: 60 });
    for (const c of j.query?.categorymembers || []) if (!/food|restaurant|metro|bus|map|painting|history|people/i.test(c.title)) todo.push(c.title);
  }
  let cont = {}, added = 0;
  for (let page = 0; page < 6; page++) {
    const j = await api({ action: 'query', generator: 'categorymembers', gcmtitle: cat, gcmtype: 'file', gcmlimit: 50, prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: 1000, ...cont });
    for (const p of Object.values(j.query?.pages || {})) {
      const ii = p.imageinfo?.[0]; if (!ii) continue; const m = ii.extmetadata || {};
      const date = strip(m.DateTimeOriginal?.value) || strip(m.DateTime?.value); const lic = strip(m.LicenseShortName?.value);
      const year = (date.match(/(20[0-2]\d)/) || [])[1]; if (!FREE.test(lic) || !year || +year < 2019 || ii.width < 1200) continue;
      if (!seen[p.title]) added++;
      seen[p.title] = { title: p.title, year: +year, date, lic, author: strip(m.Artist?.value).slice(0, 80), w: ii.width, h: ii.height, thumb: ii.thumburl, page: ii.descriptionurl, desc: strip(m.ImageDescription?.value).slice(0, 160), q: cat, cat: true };
    }
    if (!j.continue) break; cont = j.continue;
  }
  console.log(cat, 'added', added);
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
