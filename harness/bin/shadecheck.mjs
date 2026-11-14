#!/usr/bin/env node
// Shade colour check (P2-052, FIDELITY_BAR.md row 8): is the shade in a street shot neutral warm grey, or a blue wash?
// For each PNG it takes the ground band of the frame (rows from --top, default 0.55, to the bottom; the street, the
// footpaths and the wall bases at eye height) at a 480x270 downscale, picks the shade pixels (display luma between
// 0.03 and the band's 40th percentile, so sunlit ground and black holes are left out) and prints their mean colour
// and mean blue minus red (0 to 255). The bar: blue minus red at most 6 (STYLE_BIBLE.md "Palette": no cold wash).
// Also prints the readability floor numbers of the whole frame (mean luma, near black under 0.04, blown over 0.97).
//   node harness/bin/shadecheck.mjs <png...> [--top 0.55] [--max 6] [--json]
import sharp from 'sharp';
import { pathToFileURL } from 'node:url';

export function luma(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** Shade and floor numbers of raw RGB pixels (w x h, 3 channels). Pure. */
export function measure(data, w, h, topShare = 0.55) {
  const y0 = Math.floor(h * topShare);
  const band = [];
  let sum = 0, black = 0, blown = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const l = luma(data[i], data[i + 1], data[i + 2]);
      sum += l;
      if (l < 0.04) black++;
      if (l > 0.97) blown++;
      if (y >= y0) band.push([l, data[i], data[i + 1], data[i + 2]]);
    }
  }
  const ls = band.map((p) => p[0]).sort((a, b) => a - b);
  const p40 = ls[Math.floor(ls.length * 0.4)] ?? 0;
  let n = 0, r = 0, g = 0, b = 0;
  for (const p of band) {
    if (p[0] >= 0.03 && p[0] <= p40) {
      n++; r += p[1]; g += p[2]; b += p[3];
    }
  }
  const n0 = Math.max(n, 1);
  return {
    shadePixels: n, shade: [r / n0, g / n0, b / n0].map((v) => +v.toFixed(1)), blueMinusRed: +((b - r) / n0).toFixed(1),
    meanLuma: +(sum / (w * h)).toFixed(3), nearBlack: +(black / (w * h)).toFixed(4), blown: +(blown / (w * h)).toFixed(4),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
  const json = args.includes('--json') ? (args.splice(args.indexOf('--json'), 1), true) : false;
  const top = Number(opt('--top', '0.55'));
  const max = Number(opt('--max', '6'));
  if (!args.length) {
    console.log('usage: node harness/bin/shadecheck.mjs <png...> [--top 0.55] [--max 6] [--json]');
    process.exit(2);
  }

  let fail = false;
  const out = {};
  for (const f of args) {
    const { data, info } = await sharp(f).resize(480, 270, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const m = measure(data, info.width, info.height, top);
    out[f] = m;
    const ok = m.blueMinusRed <= max;
    if (!ok) fail = true;
    if (!json) {
      console.log(`${ok ? 'ok  ' : 'BLUE'} ${f}: shade rgb ${m.shade.join(', ')} blue-red ${m.blueMinusRed} | mean luma ${m.meanLuma} near-black ${(m.nearBlack * 100).toFixed(1)}% blown ${(m.blown * 100).toFixed(1)}%`);
    }
  }
  if (json) console.log(JSON.stringify(out, null, 1));
  process.exit(fail ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
