// Sign board lettering (P2-048): text shaped with HarfBuzz (harfbuzzjs, wasm) from the free fonts in tools/kits/fonts/
// and turned into SVG paths, so Devanagari conjuncts and Nastaliq joins come out right and the atlas never depends on
// the fonts of the machine that builds it (sharp's SVG text uses the system's CoreText fonts on macOS). Credits and
// licences: tools/kits/fonts/CREDITS.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as hb from 'harfbuzzjs';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fonts');

/** Font keys -> [file, variations]. Every file is OFL (tools/kits/fonts/CREDITS.md). */
export const FONTS = {
  mukta: ['Mukta-ExtraBold.ttf', ''],
  mukta_b: ['Mukta-Bold.ttf', ''],
  hind: ['Hind-Bold.ttf', ''],
  rozha: ['RozhaOne-Regular.ttf', ''],
  yatra: ['YatraOne-Regular.ttf', ''],
  kalam: ['Kalam-Bold.ttf', ''],
  teko: ['Teko[wght].ttf', 'wght=600'],
  khand: ['Khand-Bold.ttf', ''],
  noto_deva: ['NotoSansDevanagari[wdth,wght].ttf', 'wght=800'],
  noto_serif_deva: ['NotoSerifDevanagari[wdth,wght].ttf', 'wght=800'],
  nastaliq: ['NotoNastaliqUrdu[wght].ttf', 'wght=700'],
  alfa: ['AlfaSlabOne-Regular.ttf', ''],
  oswald: ['Oswald[wght].ttf', 'wght=650'],
  anton: ['Anton-Regular.ttf', ''],
};

const cache = new Map();
function font(key) {
  if (cache.has(key)) return cache.get(key);
  const spec = FONTS[key];
  if (!spec) throw new Error(`unknown font ${key}`);
  const data = fs.readFileSync(path.join(DIR, spec[0]));
  const face = new hb.Face(new hb.Blob(new Uint8Array(data)));
  const f = new hb.Font(face);
  if (spec[1]) {
    const v = spec[1].split(',').map((s) => hb.Variation.fromString(s)).filter(Boolean);
    f.setVariations(v);
  }
  const e = { font: f, upem: face.upem, glyphs: new Map() };
  cache.set(key, e);
  return e;
}

/**
 * Shapes one line. Returns {width, d}: the advance width at `size` px and an SVG path (y down, baseline at 0, x from 0)
 * that draws the line at `size` px. `track` adds px between glyph clusters.
 */
export function shapeLine(key, text, size, track = 0, opt = {}) {
  const e = font(key);
  const buf = new hb.Buffer();
  buf.addText(String(text));
  buf.guessSegmentProperties();
  hb.shape(e.font, buf);
  const infos = buf.getGlyphInfos();
  const pos = buf.getGlyphPositions();
  const s = size / e.upem;
  let x = 0;
  const parts = [];
  for (let i = 0; i < infos.length; i++) {
    const g = infos[i].codepoint;
    let d = e.glyphs.get(g);
    if (d === undefined) {
      d = e.font.glyphToPath(g);
      e.glyphs.set(g, d);
    }
    const p = pos[i];
    if (d) {
      // hand painted: every cluster sits a little off the line and leans a little (opt.jitter: a function -> [-1, 1])
      const j = opt.jitter;
      const dy = j ? j(infos[i].cluster * 2) * size * 0.025 : 0;
      const rot = j ? j(infos[i].cluster * 2 + 1) * 2.2 : 0;
      const gx = x + p.xOffset * s;
      const t = rot ? ` rotate(${rot.toFixed(2)} ${(gx + p.xAdvance * s * 0.5).toFixed(1)} ${(-size * 0.35).toFixed(1)})` : '';
      const path = `<path transform="${t}translate(${gx.toFixed(2)} ${(dy - p.yOffset * s).toFixed(2)}) scale(${s.toFixed(5)} ${(-s).toFixed(5)})" d="${d}"/>`;
      // a missing letter (opt.drop: a function of the cluster number): only a ghost of the old paint is left
      parts.push(opt.drop && opt.drop(infos[i].cluster) ? `<g opacity="0.13">${path}</g>` : path);
    }
    x += p.xAdvance * s;
    if (track && i + 1 < infos.length && infos[i + 1].cluster !== infos[i].cluster) x += track;
  }
  if (typeof buf.destroy === 'function') buf.destroy();
  return { width: x, svg: parts.join('') };
}

/**
 * SVG for one line fitted into a box: centred (or left / right) on (cx, baseline), at most `maxW` wide, at most `size`
 * px tall, squeezed horizontally down to 70 % before the size drops (sign painters condense letters to fit the board).
 * Extra attributes (fill, stroke) go on the group.
 */
export function fitLine(key, text, { x, y, maxW, size, anchor = 'middle', attrs = '', track = 0, minSqueeze = 0.7, jitter = null, drop = null }) {
  const { width, svg } = shapeLine(key, text, size, track, { jitter, drop });
  let sx = 1;
  let sz = 1;
  if (width > maxW) {
    sx = Math.max(minSqueeze, maxW / width);
    if (width * sx > maxW) sz = maxW / (width * sx);
  }
  const w = width * sx * sz;
  const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return { w, h: size * sz, svg: `<g transform="translate(${x0.toFixed(2)} ${y.toFixed(2)}) scale(${(sx * sz).toFixed(4)} ${sz.toFixed(4)})" ${attrs}>${svg}</g>` };
}
