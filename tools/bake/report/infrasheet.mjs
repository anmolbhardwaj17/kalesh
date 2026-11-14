// Reference and game side by side for the infrastructure kits (P2-034, STYLE_BIBLE.md "Infrastructure":
// "a side by side of a reference photo and the game view"). One row per variant: on the left the reference photo of
// harness/design/reference/infrastructure/img/ (or, for a variant with no licensed photo, a card with the key shapes
// and colours of its kind file), on the right the game shot. Writes harness/reports/infra/<out>.jpg, 1600 px wide.
//   node tools/bake/report/infrasheet.mjs --rows rows.json --out infra_sheet_a
// rows.json: [{"variant": "FLY-T1", "ref": "flyover_aiims_ring_road.jpg" | null, "card": "text when no photo", "shot": "harness/reports/shots/x.png"}]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const IMG = path.join(ROOT, 'harness/design/reference/infrastructure/img');
const W = 800;
const H = 450;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function wrap(text, n) {
  const out = [];
  let line = '';
  for (const w of String(text).split(/\s+/)) {
    if ((line + ' ' + w).trim().length > n) {
      out.push(line.trim());
      line = w;
    } else line += ' ' + w;
  }
  if (line.trim()) out.push(line.trim());
  return out;
}

async function card(variant, text) {
  const lines = wrap(text, 62).slice(0, 14);
  const svg = `<svg width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#2b2a28"/><text x="24" y="56" font-size="30" fill="#f2c230" font-family="sans-serif">${esc(variant)}: reference (no licensed photo)</text>${lines.map((l, i) => `<text x="24" y="${100 + i * 24}" font-size="19" fill="#f2f0ea" font-family="sans-serif">${esc(l)}</text>`).join('')}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function framed(file, label) {
  const img = await sharp(file).resize(W, H, { fit: 'cover' }).toBuffer();
  const bar = Buffer.from(`<svg width="${W}" height="34"><rect width="${W}" height="34" fill="black" opacity="0.65"/><text x="10" y="24" font-size="20" fill="white" font-family="sans-serif">${esc(label)}</text></svg>`);
  return sharp(img).composite([{ input: bar, top: 0, left: 0 }]).png().toBuffer();
}

async function main() {
  const args = process.argv.slice(2);
  const get = (k) => {
    const i = args.indexOf(k);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const rows = JSON.parse(fs.readFileSync(get('--rows'), 'utf8'));
  const out = get('--out') ?? 'infra_sheet';
  const parts = [];
  for (const [i, r] of rows.entries()) {
    const left = r.ref ? await framed(path.join(IMG, r.ref), `${r.variant} reference: ${r.ref}`) : await card(r.variant, r.card ?? '');
    const right = await framed(path.resolve(ROOT, r.shot), `${r.variant} in the game: ${path.basename(r.shot)}`);
    parts.push({ input: left, left: 0, top: i * H }, { input: right, left: W, top: i * H });
  }
  const dir = path.join(ROOT, 'harness/reports/infra');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${out}.jpg`);
  await sharp({ create: { width: 2 * W, height: H * rows.length, channels: 3, background: '#000' } }).composite(parts).jpeg({ quality: 80 }).toFile(file);
  console.log(path.relative(ROOT, file));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
