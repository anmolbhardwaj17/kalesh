#!/usr/bin/env node
// The kit shader's baked noise (P2-010 attempt 2, perf): one tiling square that game/render/shaders/surface_b.gdshaderinc
// reads with KIT on, one texture fetch instead of 16 hashes per fbm and 4 per value noise (the grime layer calls fbm
// five times and value noise four times a wall pixel). Grey: 4 octave value noise fbm; alpha: one octave of value
// noise. Period 64 noise cells, 16 px a cell (the finest fbm octave 2 px a cell), octaves at 2x (2.03x in the
// procedural fbm, which cannot tile) with the same amplitudes 0.5, 0.25, 0.125, 0.0625, so the value range (0 to
// 0.9375, mean about 0.47) and the thresholds of the grime layer stay as they were.
//   node tools/kits/make_noise.mjs            writes game/world/kits/textures/kit_noise.png
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'game/world/kits/textures/kit_noise.png');
export const PERIOD = 64;
export const PX_PER_CELL = 16;
export const SIZE = PERIOD * PX_PER_CELL;

function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise with smoothstep interpolation (the shader's vnoise) that tiles with period p cells. */
function vnoise(x, y, p, s) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const w = (a) => ((a % p) + p) % p;
  const a = hash2(w(xi), w(yi), s);
  const b = hash2(w(xi + 1), w(yi), s);
  const c = hash2(w(xi), w(yi + 1), s);
  const d = hash2(w(xi + 1), w(yi + 1), s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** The baked fbm at p (noise cells), tiling every PERIOD cells. */
export function fbm(px, py) {
  let a = 0.5;
  let t = 0;
  let f = 1;
  for (let i = 0; i < 4; i++) {
    t += a * vnoise(px * f, py * f, PERIOD * f, 7 + i * 31);
    a *= 0.5;
    f *= 2;
  }
  return t;
}

async function main() {
  const buf = Buffer.alloc(SIZE * SIZE * 2);
  const byte = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const px = (x + 0.5) / PX_PER_CELL;
      const py = (y + 0.5) / PX_PER_CELL;
      buf[(y * SIZE + x) * 2] = byte(fbm(px, py));
      buf[(y * SIZE + x) * 2 + 1] = byte(vnoise(px, py, PERIOD, 101));
    }
  }
  await sharp(buf, { raw: { width: SIZE, height: SIZE, channels: 2 } }).toColourspace('b-w').png().toFile(OUT);
  console.log(`wrote ${path.relative(ROOT, OUT)} (${SIZE} px, period ${PERIOD} cells)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
