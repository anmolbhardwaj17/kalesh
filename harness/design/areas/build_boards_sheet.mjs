// Contact sheet of candidates for one area: node build_boards_sheet.mjs <area> [from] [count]
// Downloads 500px thumbs into harness/reports/areaphotos/<area>/ and writes sheet_<area>_<from>.jpg
import crypto from 'node:crypto'; import fs from 'node:fs'; import path from 'node:path'; import sharp from 'sharp';
const UA = 'kalesh-area-reference-research/1.0 (internal game reference board)';
const [area, from = '0', count = '40', rx = ''] = process.argv.slice(2);
const root = new URL('../../reports/areaphotos/', import.meta.url).pathname;
const cand = JSON.parse(fs.readFileSync(root + 'candidates.json', 'utf8')); const all = rx ? Object.assign({}, ...Object.values(cand)) : cand[area];
const PLACE = /delhi|chandni|connaught|janpath|jantar|kartavya|rajpath|india gate|paharganj|ajmeri|red fort|lal qila|\bito\b|pragati|bharat mandapam|sansad|parliament|barakhamba|fatehpuri|sisganj|jama masjid|asaf ali|kinari|dariba|khari baoli|chawri|ballimaran|paratha|kasturba|netaji|tolstoy|central vista|vikas marg|shraddhanand|g\.? ?b\.? road|nehru/i;
const EXCL = /geograph|london|bristol|england|hong kong|HK Central|himachal|pune|mumbai|rayleigh|silvertown|knowle|tyburn|food|rabri|kulfi|chaat|burger|dosa|platter|thali|biryani|lassi|plate|breakfast|dinner|lunch|paratha|interior|ceiling|dome|painting|inscription|plant|flower|bird|jama masjid|mosque|masjid|gurudwara|temple|mandir|railway platform|platform|train/i;
const seenPrefix = new Set();
const R = rx ? new RegExp(rx, 'i') : null;
const list = Object.values(all).filter(c => R ? R.test(c.title) : ((c.cat || PLACE.test(c.title + ' ' + c.desc)) && !EXCL.test(c.title + ' ' + c.desc))).sort((a, b) => a.title.localeCompare(b.title)).filter(c => { if (R) return true; const k = c.title.replace(/[\d\s()_,.-]+(jpe?g|png)?$/i, '').slice(0, 30) + c.year; if (seenPrefix.has(k)) return false; seenPrefix.add(k); return true; }).slice(+from, +from + +count);
fs.writeFileSync(root + `list_${area}_${rx ? 'x' + from : from}.json`, JSON.stringify(list.map((c, i) => ({ i: +from + i, ...c })), null, 1));
fs.mkdirSync(root + area, { recursive: true });
const tiles = [];
for (const [i, c] of list.entries()) {
  const f = root + area + '/' + crypto.createHash('md5').update(c.title).digest('hex').slice(0, 16) + '.jpg';
  if (!fs.existsSync(f)) {
    const u = c.thumb.replace(/\/\d+px-/, '/500px-');
    for (let t = 0; t < 4; t++) {
      const r = await fetch(u, { headers: { 'User-Agent': UA } });
      if (r.ok) { fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); break; }
      await new Promise(r => setTimeout(r, 3000 * (t + 1)));
    }
    await new Promise(r => setTimeout(r, 500));
  }
  if (!fs.existsSync(f)) continue;
  const W = 300, H = 210;
  const img = await sharp(f).resize(W, H, { fit: 'inside', background: '#222' }).toBuffer();
  const label = `<svg width="${W}" height="30"><rect width="${W}" height="30" fill="#222"/><text x="2" y="12" font-size="12" fill="#ff0" font-family="Helvetica">${+from + i} ${c.year} ${c.title.replace('File:', '').slice(0, 34).replace(/[<&]/g, ' ')}</text><text x="2" y="26" font-size="11" fill="#bbb" font-family="Helvetica">${c.lic.slice(0, 14)}</text></svg>`;
  tiles.push({ img, label: Buffer.from(label) });
}
const cols = 5, W = 300, H = 240;
const rows = Math.ceil(tiles.length / cols);
const comps = [];
tiles.forEach((t, i) => { const x = (i % cols) * W, y = Math.floor(i / cols) * H; comps.push({ input: t.img, left: x, top: y }, { input: t.label, left: x, top: y + 210 }); });
await sharp({ create: { width: cols * W, height: rows * H, channels: 3, background: '#222' } }).composite(comps).jpeg({ quality: 80 }).toFile(root + `sheet_${area}_${rx ? 'x' + from : from}.jpg`);
console.log('ok', tiles.length);
