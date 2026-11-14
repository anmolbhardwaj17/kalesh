#!/usr/bin/env node
// Wall colours of the area kits sampled from their area boards (P2-010 fix round; decisions.md 2026-11-14 "Areas are
// built from how they look today"). Reads tools/kits/wall_samples.json (a board and wall rectangles per kit), takes the
// median colour of each rectangle (darkest fifth and brightest tenth by luma dropped: shadow and glare), and writes
// into game/world/kits/kits.json, per kit, `walls`:
//   board     the board the samples come from
//   samples   [{photo, rect, hex}] each rectangle with the photo number on the board and its median colour
//   colours   the kit's wall colours (the samples, near duplicates merged, lifted together to `lift` when the board
//             photos are dull, scaled together so the brightest channel stays under `cap` so a
//             sunlit wall keeps its detail, nudged off the shader's brick test so a painted wall never shows brick)
//   range     {h: [min, max] degrees, s: [min, max], v: [min, max]} of the colours
//   map       palette word -> up to 3 nearest kit colours (CIE Lab): the game repaints a wall the bake tinted with
//             that word in one of them (game/world/kits/module_library.gd wall_tint); brick words keep their colour
// and the palette itself as kits.json `palette` (the game cannot read harness/data). Also writes a crop sheet,
// harness/reports/kits/wall_samples.jpg: every rectangle enlarged next to its colour, to check it sits on a wall.
//   node tools/kits/sample_walls.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const KITS_PATH = path.join(ROOT, 'game/world/kits/kits.json');
const SAMPLES = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/kits/wall_samples.json'), 'utf8'));
const PALETTE = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness/data/areas/palette.json'), 'utf8'));
/** Palette words that draw the brick layer: they keep their own colour. */
export const BRICK_WORDS = ['brown_brick', 'brick_red', 'orange_brick', 'red_sandstone'];

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const toHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

export function hsv([r, g, b]) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d > 0) h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [Math.round(((h * 60) + 360) % 360), max > 0 ? d / max : 0, max];
}

export function lab([r, g, b]) {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), Y = f(0.2126 * R + 0.7152 * G + 0.0722 * B), Z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

/** The shader's brick test (surface_b.gdshaderinc, KIT): a painted wall that passes it would draw the brick layer. */
const isBrick = ([r, g, b]) => {
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255;
  return mx > 0 && (mx - mn) / mx > 0.28 && mx < 0.62 && r > b * 1.35;
};

/** One wall colour: cap the brightest channel, keep it off the brick test. */
export function wallColour(c, cap) {
  let o = [...c];
  const mx = Math.max(...o);
  if (mx > cap) o = o.map((v) => (v * cap) / mx);
  if (isBrick(o.map(Math.round))) {
    // lower the saturation to 0.26 at the same value: a painted brown wall stays paint
    const m = Math.max(...o);
    o = o.map((v) => m - (m - v) * (0.26 / ((m - Math.min(...o)) / m)));
  }
  return o.map(Math.round);
}

async function median(img, [x, y, w, h]) {
  const { data, info } = await img.clone().extract({ left: x, top: y, width: w, height: h }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = [];
  for (let i = 0; i < data.length; i += info.channels) px.push([data[i], data[i + 1], data[i + 2]]);
  px.sort((a, b) => luma(a) - luma(b));
  const kept = px.slice(Math.floor(px.length * 0.2), Math.ceil(px.length * 0.9));
  return [0, 1, 2].map((k) => { const v = kept.map((p) => p[k]).sort((a, b) => a - b); return v[v.length >> 1]; });
}

/** kits.json as before: one kit field a line where it fits (arrays and small objects inline). */
function compact(v, ind = '') {
  const flat = JSON.stringify(v);
  if (typeof v !== 'object' || v === null || flat.length + ind.length < 150) return flat.replace(/","/g, '", "').replace(/":/g, '": ').replace(/,(?=[{\[\d"-])/g, ', ');
  const inner = ind + '  ';
  if (Array.isArray(v)) return '[\n' + v.map((x) => inner + compact(x, inner)).join(',\n') + '\n' + ind + ']';
  return '{\n' + Object.entries(v).map(([k, x]) => `${inner}${JSON.stringify(k)}: ${compact(x, inner)}`).join(',\n') + '\n' + ind + '}';
}

async function main() {
  const kits = JSON.parse(fs.readFileSync(KITS_PATH, 'utf8'));
  const sheet = [];
  for (const [id, spec] of Object.entries(SAMPLES.kits)) {
    const file = path.join(ROOT, 'harness/design/areas', `${spec.board}_board.jpg`);
    const img = sharp(file);
    const samples = [];
    for (const s of spec.samples) {
      const c = await median(img, s.rect);
      samples.push({ photo: s.photo, rect: s.rect, hex: toHex(c) });
      sheet.push({ id, photo: s.photo, file, rect: s.rect, hex: toHex(c) });
    }
    // colours: samples capped and off the brick test, near duplicates (Lab distance under 4) merged
    const colours = [];
    for (const s of samples) {
      // a sample darker than this is shadow or a dark interior, not a wall colour: kept in the list, not used
      if (hsv(hex(s.hex))[2] < 0.28) {
        s.unused = 'too dark: shadow';
        continue;
      }
      const c = hex(s.hex);
      if (!colours.some((o) => dist(lab(hex(o)), lab(c)) < 4)) colours.push(toHex(c));
    }
    // exposure, for the kit's colours together (their order and hues kept): dull boards (haze, shade) are lifted until
    // the brightest reaches `lift`, and the set is scaled down until its brightest channel is under the cap (a lit wall
    // in the game reads as bright as in its photo without clipping); then each colour is kept off the brick test
    const cap = spec.cap ?? SAMPLES.cap;
    const top = Math.max(...colours.map((h) => hsv(hex(h))[2]));
    const f = Math.min(Math.max(1, SAMPLES.lift / top), cap / (top * 255));
    for (let i = 0; i < colours.length; i++) colours[i] = toHex(wallColour(hex(colours[i]).map((v) => v * f), cap));
    const hs = colours.map((h) => hsv(hex(h)));
    const r = (k) => [Math.min(...hs.map((x) => x[k])), Math.max(...hs.map((x) => x[k]))].map((v) => (k ? +v.toFixed(2) : v));
    const map = {};
    for (const [word, h] of Object.entries(PALETTE)) {
      if (word.startsWith('_') || word === 'glass_tint') continue;
      if (BRICK_WORDS.includes(word)) {
        map[word] = [h];
        continue;
      }
      const w = lab(hex(h));
      map[word] = [...colours].sort((a, b) => dist(lab(hex(a)), w) - dist(lab(hex(b)), w)).slice(0, 3);
    }
    kits.kits[id].walls = { board: `harness/design/areas/${spec.board}_board.jpg`, samples, colours, range: { h: r(0), s: r(1), v: r(2) }, map };
    console.log(`kit ${id}: ${colours.length} wall colours ${colours.join(' ')}  h ${r(0).join('-')} s ${r(1).join('-')} v ${r(2).join('-')}`);
  }
  kits.palette = Object.fromEntries(Object.entries(PALETTE).filter(([w]) => !w.startsWith('_') && w !== 'glass_tint'));
  fs.writeFileSync(KITS_PATH, compact(kits) + '\n');
  // the crop sheet: 6 crops a row, each 200 x 120 with its colour on the right
  const W = 260, H = 120, COLS = 6;
  const rows = Math.ceil(sheet.length / COLS);
  const comps = [];
  for (let i = 0; i < sheet.length; i++) {
    const s = sheet[i];
    const crop = await sharp(s.file).extract({ left: s.rect[0], top: s.rect[1], width: s.rect[2], height: s.rect[3] }).resize(200, H, { fit: 'contain', background: '#202020' }).png().toBuffer();
    const sw = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="60" height="${H}"><rect width="60" height="${H}" fill="${s.hex}"/><text x="2" y="12" font-size="10" font-family="Helvetica" fill="#000">${s.id}</text><text x="2" y="26" font-size="10" font-family="Helvetica" fill="#000">p${s.photo}</text></svg>`);
    const x = (i % COLS) * W, y = Math.floor(i / COLS) * H;
    comps.push({ input: crop, left: x, top: y }, { input: sw, left: x + 200, top: y });
  }
  const out = path.join(ROOT, 'harness/reports/kits');
  fs.mkdirSync(out, { recursive: true });
  await sharp({ create: { width: COLS * W, height: rows * H, channels: 3, background: '#202020' } }).composite(comps).jpeg({ quality: 85 }).toFile(path.join(out, 'wall_samples.jpg'));
  console.log(`crop sheet harness/reports/kits/wall_samples.jpg (${sheet.length} samples)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
