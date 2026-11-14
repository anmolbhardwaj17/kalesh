// The sign board reference board (P2-048): the picked free, dated Wikimedia Commons photos of shop signs per pilot
// area, numbered and credited, in one image (harness/design/areas/signboards_board.jpg). signboards.md cites the numbers.
// Usage: node harness/design/areas/signboards_board.mjs  (thumbs cached in harness/reports/signboards/board/)
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const here = path.dirname(new URL(import.meta.url).pathname);
const cache = path.join(here, '../../reports/signboards/board');
const UA = 'kalesh-area-reference-research/1.0 (internal game reference board)';
/** [number, area, Commons file title, what it shows]. Dates, authors and licences come from the file pages. */
export const PICKS = [
  [1, 'chandni_chowk_main', 'Old Delhi market, Jama Masjid.jpg', 'glow boxes and painted boards stacked two and three high, LED letters, wires'],
  [2, 'chandni_chowk_main', 'A shop at Paranthe Wali Gali, Delhi, India.jpg', 'old painted board "since 1889" with drop shadow letters over a newer printed glow board'],
  [3, 'chandni_chowk_main', 'Zeenat Mahal at Lal Kuan in Old Delhi.jpg', 'small faded boards on a haveli front, tarps and tangled wires'],
  [4, 'chandni_chowk_galis', 'Meena Bazar in Old Delhi 01.jpg', 'an official blue board in Urdu over a gate, rusted iron posts'],
  [5, 'chandni_chowk_galis', 'Meena Bazar in Old Delhi 17.jpg', 'trilingual gateway board (Hindi, Urdu, English), white letters on green'],
  [6, 'chandni_chowk_galis', '25 - Old Delhi Bazaar.jpg', 'wholesale lane: printed and painted boards over every shutter, flex up the upper floors, AC units, wires'],
  [7, 'chandni_chowk_galis', '23 - Old Delhi Bazaar.jpg', 'paper notices with phone numbers pasted on a pole, boards stacked up the facades'],
  [8, 'chandni_chowk_galis', '18 - Old Delhi Bazaar.jpg', 'a printed flex poster high on a wall, small painted boards on the far shops'],
  [9, 'paharganj_station', 'Diwali market at Pahar ganj Delhi 02.jpg', 'Main Bazaar at night: lit glow fascias and LED outlines up the facades'],
  [10, 'paharganj_station', 'Diwali market at Pahar ganj Delhi 14.jpg', 'a lit hotel front with light strings, glow boards at street level'],
  [11, 'paharganj_station', 'Diwali market at Pahar ganj Delhi 18.jpg', 'a guest house glow box over a lane at night'],
  [12, 'janpath', 'Tibetan Market, at Janpath in New Delhi 05.jpg', 'printed flex boards with shop numbers and phone numbers over each shutter'],
  [13, 'janpath', 'Tibetan Market, at Janpath in New Delhi 04.jpg', 'a row of printed acrylic and flex boards, one per shop, same height'],
  [14, 'janpath', 'Tibet Market, Janpath in New Delhi 08.jpg', 'printed boards with goods lists ("wholesalers of ..."), a hanging board'],
  [15, 'cp_inner_circle', 'A View of Connaught Place, New Delhi.jpg', 'neat showroom signs under the colonnade, one per bay, little wear'],
  [16, 'cp_inner_circle', 'PPH Connaught Place Showroom.jpg', 'an old bookshop board inside the colonnade, painted letters'],
  [17, 'cp_outer_circle', 'Everyday Buzz at Connaught Place, Delhi.jpg', 'outer circle road: few boards in view, autos and the arcade edge'],
  [18, 'ito', 'Daryaganj Book Market in Daryaganj, New Delhi 19.jpg', 'hand-painted placards ("SALE 50/- each"), tarp stalls'],
  [19, 'gb_road_ajmeri_gate', 'New Delhi Railway Station Ajmeri Gate side, India. 03.jpg', 'trilingual official station boards; the shop boards of GB Road itself are in the owner photos only'],
  [20, 'jantar_mantar', 'Sansad Marg, a street in New Delhi, India 03.jpg', 'no shop boards: green road signs, office walls'],
  [21, 'india_gate_kartavya_path', 'Kartavya Path in the evening in New Delhi 04.jpg', 'no shop boards: official signage only, stalls at the edges'],
  [22, 'red_fort_surroundings', 'Lal qila from chandni chowk.jpg', 'parking sign, a security kiosk with a printed board, the fort behind'],
];
const strip = (s) => (s || '').replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, ' ').trim();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Metadata and a cached thumb from the earlier searches (signboards_search.mjs shortlist, current_photos.json), else the API. */
function local(title) {
  const sl = path.join(here, '../../reports/signboards/shortlist.json');
  if (fs.existsSync(sl)) {
    for (const list of Object.values(JSON.parse(fs.readFileSync(sl, 'utf8'))))
      for (const x of list)
        if (x.title === 'File:' + title) {
          const f = path.join(here, '../../reports/signboards/thumbs', crypto.createHash('md5').update(x.title).digest('hex').slice(0, 16) + '.jpg');
          return { thumb: x.thumb, file: fs.existsSync(f) ? f : null, page: x.page, date: x.date, author: x.author.slice(0, 60), lic: x.lic };
        }
  }
  const cp = JSON.parse(fs.readFileSync(path.join(here, 'current_photos.json'), 'utf8'));
  for (const list of Object.values(cp))
    for (const x of list)
      if (x.title === title) {
        const h = crypto.createHash('md5').update('File:' + title).digest('hex').slice(0, 16);
        const dir = path.join(here, '../../reports/areaphotos');
        let file = null;
        for (const d of fs.readdirSync(dir)) if (fs.existsSync(path.join(dir, d, h + '.jpg'))) file = path.join(dir, d, h + '.jpg');
        return { thumb: null, file, page: x.url, date: x.date, author: x.author.slice(0, 60), lic: x.lic };
      }
  return null;
}

async function info(title) {
  const l = local(title);
  if (l) return l;
  const u = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ action: 'query', format: 'json', titles: 'File:' + title, prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: 960 });
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': UA } });
      if (r.ok) {
        const p = Object.values((await r.json()).query.pages)[0];
        const ii = p.imageinfo[0];
        const m = ii.extmetadata;
        return { thumb: ii.thumburl, page: ii.descriptionurl, date: strip(m.DateTimeOriginal?.value) || strip(m.DateTime?.value), author: strip(m.Artist?.value).slice(0, 60), lic: strip(m.LicenseShortName?.value) };
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
  }
  throw new Error('no info for ' + title);
}

async function main() {
  fs.mkdirSync(cache, { recursive: true });
  const metaFile = path.join(cache, 'meta.json');
  const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
  const W = 480;
  const H = 320;
  const CAP = 58;
  const tiles = [];
  for (const [n, area, title, shows] of PICKS) {
    if (!meta[title]) meta[title] = await info(title);
    const m = meta[title];
    let f = path.join(cache, crypto.createHash('md5').update(title).digest('hex').slice(0, 16) + '.jpg');
    if (m.file && fs.existsSync(m.file)) f = m.file;
    else if (!fs.existsSync(f)) {
      const r = await fetch(m.thumb, { headers: { 'User-Agent': UA } });
      fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
    }
    const date = (m.date.match(/\d{4}-\d\d-\d\d/) || [m.date])[0];
    const cap = `<svg width="${W}" height="${CAP}"><rect width="${W}" height="${CAP}" fill="#111"/><text x="8" y="22" font-family="Helvetica" font-size="17" font-weight="bold" fill="#ffd54a">${n}  ${esc(area)}  ${esc(date)}</text><text x="8" y="44" font-family="Helvetica" font-size="13" fill="#ddd">${esc(m.author)}, ${esc(m.lic)}, Wikimedia Commons</text></svg>`;
    const img = await sharp(f).resize(W, H, { fit: 'cover' }).toBuffer();
    tiles.push(await sharp({ create: { width: W, height: H + CAP, channels: 3, background: '#111' } }).composite([{ input: img, top: 0, left: 0 }, { input: Buffer.from(cap), top: H, left: 0 }]).jpeg().toBuffer());
    meta[title].shows = shows;
  }
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1));
  const cols = 4;
  const rows = Math.ceil(tiles.length / cols);
  const head = 60;
  const title = `<svg width="${cols * W}" height="${head}"><rect width="${cols * W}" height="${head}" fill="#000"/><text x="12" y="40" font-family="Helvetica" font-size="28" font-weight="bold" fill="#fff">Kalesh: shop sign boards of the pilot areas (P2-048), free dated photos, numbers cited in signboards.md</text></svg>`;
  await sharp({ create: { width: cols * W, height: head + rows * (H + CAP), channels: 3, background: '#000' } })
    .composite([{ input: Buffer.from(title), top: 0, left: 0 }, ...tiles.map((b, i) => ({ input: b, left: (i % cols) * W, top: head + Math.floor(i / cols) * (H + CAP) }))])
    .jpeg({ quality: 82 })
    .toFile(path.join(here, 'signboards_board.jpg'));
  for (const [n, area, title] of PICKS) {
    const m = meta[title];
    console.log(`| ${n} | ${area} | [${title}](${m.page}) | ${(m.date.match(/\d{4}-\d\d-\d\d/) || [m.date])[0]} | ${m.author} | ${m.lic} |`);
  }
}

/** Rows of the side by side sheet: area, reference photos (board numbers, or owner files kept local), game shots. */
const COMPARE = [
  ['Chandni Chowk main (bazaar)', [1, 2], ['signs_bazaar', 'signs_bazaar_night']],
  ['Old Delhi galis (gali)', [6, 7], ['signs_gali']],
  ['GB Road (hardware)', ['owner/gb_road/06_streetview_oct2025_hardware_facades.png', 'owner/gb_road/03_night_hardware_shops_below.webp'], ['signs_gbroad', 'signs_gbroad_night']],
  ['Old shop signs (owner collage)', ['owner/signboards/03_real_delhi_old_shop_signs_collage.png'], ['signs_bazaar', 'signs_gali', 'signs_gbroad']],
  ['Paharganj (hotel)', [9, 10], ['signs_paharganj', 'signs_paharganj_night']],
  ['Janpath (market)', [12, 14], ['signs_janpath']],
  ['Connaught Place (colonnade)', [15, 16], ['signs_cp']],
  ['ITO (office)', [18], ['signs_ito']],
];

/** The side by side sheet (harness/reports/shots/signs_compare.png, local only: it may hold owner photos). */
async function compare() {
  const meta = JSON.parse(fs.readFileSync(path.join(cache, 'meta.json'), 'utf8'));
  const shots = path.join(here, '../../reports/shots');
  const W = 400;
  const H = 225;
  const LBL = 26;
  const cols = 4;
  const rows = [];
  for (const [label, refs, games] of COMPARE) {
    const tiles = [];
    for (const r of refs) {
      let f;
      let cap;
      if (typeof r === 'number') {
        const [, , title] = PICKS.find((x) => x[0] === r);
        f = meta[title].file || path.join(cache, crypto.createHash('md5').update(title).digest('hex').slice(0, 16) + '.jpg');
        cap = `photo #${r} ${(meta[title].date.match(/\d{4}-\d\d-\d\d/) || [''])[0]}`;
      } else {
        f = path.join(here, '../reference', r);
        cap = `owner photo ${path.basename(r)}`;
      }
      tiles.push([f, cap]);
    }
    for (const g of games) tiles.push([path.join(shots, g + '.png'), `game ${g}`]);
    rows.push([label, tiles.slice(0, cols)]);
  }
  const comps = [];
  let y = 0;
  for (const [label, tiles] of rows) {
    comps.push({ input: Buffer.from(`<svg width="${cols * W}" height="${LBL}"><rect width="${cols * W}" height="${LBL}" fill="#000"/><text x="8" y="19" font-family="Helvetica" font-size="17" font-weight="bold" fill="#ffd54a">${esc(label)}</text></svg>`), top: y, left: 0 });
    y += LBL;
    for (const [i, [f, cap]] of tiles.entries()) {
      if (!fs.existsSync(f)) continue;
      const img = await sharp(f).resize(W, H, { fit: 'cover' }).composite([{ input: Buffer.from(`<svg width="${W}" height="22"><rect width="${W}" height="22" fill="#000" opacity="0.6"/><text x="6" y="16" font-family="Helvetica" font-size="14" fill="#fff">${esc(cap)}</text></svg>`), top: H - 22, left: 0 }]).toBuffer();
      comps.push({ input: img, top: y, left: i * W });
    }
    y += H;
  }
  await sharp({ create: { width: cols * W, height: y, channels: 3, background: '#000' } }).composite(comps).png().toFile(path.join(shots, 'signs_compare.png'));
  console.log('signs_compare.png', cols * W, y);
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) await (process.argv.includes('--compare') ? compare() : main());
