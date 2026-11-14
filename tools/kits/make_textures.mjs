#!/usr/bin/env node
// Area kit textures (P2-010, TECH.md "Rendering of the city" TX1): for every kit of game/world/kits/kits.json one tiling
// texture array (8 layers of 512 px stacked top to bottom: render, brick, stone, concrete, shutter, wood, glass, cloth;
// imported by Godot as a VRAM compressed Texture2DArray), one trim and decal atlas (1024 px: doors, gates, posters, AC
// units, three kinds of shop goods in the lower half, make_goods.mjs) and one sign atlas (make_signs.mjs, P2-048). Procedural stand-ins in the signed
// stylised B look: the AI texture cards replace them file for file (same names, same layout).
//   node tools/kits/make_textures.mjs            writes game/world/kits/textures/<kit>_tiles.png, <kit>_atlas.png, <kit>_signs.png, boards.json
//   node tools/kits/make_textures.mjs --signs-only   only the sign atlases and boards.json
// Layer colours: render, concrete, shutter, glass and cloth are grey detail around sRGB 186 (linear 0.5) that the shader
// multiplies with the part colour; brick, stone and wood carry their own colour. Alpha is the joint and crack mask the
// grime layer darkens. Sign board names come only from game/data/names/<area>.json (the test in game/tests/test_area_kits.gd
// checks boards.json against those files).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { allSigns, GROUPS, SIGN_ATLAS } from './make_signs.mjs';
import { goodsSvg } from './make_goods.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const KITS = JSON.parse(fs.readFileSync(path.join(ROOT, 'game/world/kits/kits.json'), 'utf8'));
const OUT = path.join(ROOT, 'game/world/kits/textures');
const N = 512;
const ATLAS = 1024;

// ------------------------------------------------------------------ noise
function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Value noise that tiles with period p (cells). */
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
/** Tiling fbm over the 512 px square, `cells` noise cells across at the first octave. */
function fbm(px, py, cells, s, oct = 4) {
  let a = 0.5;
  let t = 0;
  let c = cells;
  for (let i = 0; i < oct; i++) {
    t += a * vnoise((px / N) * c, (py / N) * c, c, s + i * 31);
    a *= 0.5;
    c *= 2;
  }
  return t;
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------ layers (RGBA, N x N)
function layer(fn) {
  const buf = Buffer.alloc(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const [r, g, b, a] = fn(x, y);
      const i = (y * N + x) * 4;
      buf[i] = clamp(r);
      buf[i + 1] = clamp(g);
      buf[i + 2] = clamp(b);
      buf[i + 3] = clamp(a);
    }
  }
  return buf;
}
const GREY = 186;

function render(t, s) {
  return layer((x, y) => {
    const big = fbm(x, y, 3, s) - 0.5;
    const mid = fbm(x, y, 12, s + 7) - 0.5;
    const fine = hash2(x, y, s + 3) - 0.5;
    // patches of newer plaster: soft clouds, never cells (blocky patches read as pixels on a wall)
    const pf = fbm(x, y, 4, s + 11, 3);
    const patch = Math.max(0, Math.min(1, (pf - (0.72 - t.patch * 0.12)) / 0.08)) * 9;
    const v = GREY + big * 40 * (0.3 + t.patch) + mid * 18 * (0.4 + t.tone * 4) + fine * 6 + patch;
    // hairline cracks: short runs of a thin noise ridge, only where a second field allows (not contour lines everywhere)
    const cn = fbm(x, y, 6, s + 21, 3);
    const allow = Math.max(0, Math.min(1, (fbm(x, y, 5, s + 41, 2) - 0.6) / 0.08));
    const crack = t.crack > 0 ? Math.max(0, 1 - Math.abs(cn - 0.5) * (320 / (0.4 + t.crack))) * t.crack * allow : 0;
    const warm = big * 8 * t.tone * 10;
    return [v - crack * 55 + warm, v - crack * 55, v - crack * 57 - warm * 0.6, crack * 220 + Math.max(0, -mid) * 50];
  });
}

function brick(t, s) {
  const cols = t.c.map(hex);
  const mortar = hex(t.mortar);
  const bh = t.h;
  const bw = t.w;
  // courses must tile the square: round to a whole number
  const rows = Math.max(1, Math.round(N / bh));
  const ch = N / rows;
  const per = Math.max(1, Math.round(N / bw));
  const cw = N / per;
  return layer((x, y) => {
    const row = Math.floor(y / ch);
    const off = row % 2 ? cw / 2 : 0;
    const xx = (x + off) % N;
    const col = Math.floor(xx / cw);
    const fx = xx - col * cw;
    const fy = y - row * ch;
    const jx = 2 + hash2(col, row, s + 5) * 2;
    const jy = 2 + hash2(col, row, s + 9) * 1.5;
    const joint = fx < jx || fy < jy;
    const pick = cols[Math.floor(hash2(col, row, s) * cols.length)];
    const n = (fbm(x, y, 16, s + 3) - 0.5) * 30 + (hash2(x, y, s + 1) - 0.5) * 10;
    const burn = (hash2(col, row, s + 13) - 0.5) * 26;
    if (joint) {
      const m = (hash2(x, y, s + 2) - 0.5) * 14;
      return [mortar[0] + m, mortar[1] + m, mortar[2] + m, 230];
    }
    const chip = fbm(x, y, 24, s + 17) > 0.72 ? 1 : 0;
    return [pick[0] + n + burn - chip * 25, pick[1] + n + burn * 0.7 - chip * 22, pick[2] + n + burn * 0.5 - chip * 18, chip * 120];
  });
}

function stone(t, s) {
  const cols = t.c.map(hex);
  const rows = Math.max(1, Math.round(N / t.course));
  const ch = N / rows;
  const per = Math.max(1, Math.round(N / t.block));
  const cw = N / per;
  return layer((x, y) => {
    const row = Math.floor(y / ch);
    const off = row % 2 ? cw / 2 : 0;
    const xx = (x + off) % N;
    const col = Math.floor(xx / cw);
    const fx = xx - col * cw;
    const fy = y - row * ch;
    const joint = fx < 2 || fy < 2;
    const pick = cols[Math.floor(hash2(col, row, s) * cols.length)];
    const n = (fbm(x, y, 8, s + 3) - 0.5) * 22 + (hash2(x, y, s + 1) - 0.5) * 8;
    if (joint) return [pick[0] - 45, pick[1] - 45, pick[2] - 42, 255];
    return [pick[0] + n, pick[1] + n, pick[2] + n * 0.9, Math.max(0, fbm(x, y, 20, s + 9) - 0.6) * 300];
  });
}

function concrete(t, s) {
  return layer((x, y) => {
    const big = fbm(x, y, 4, s) - 0.5;
    const fine = hash2(x, y, s + 3) - 0.5;
    const board = t.board ? Math.sin((y / N) * Math.PI * 2 * 16) * 4 + (hash2(0, Math.floor(y / 32), s + 5) - 0.5) * 10 : 0;
    // water stains run down from the panel joints every 128 px
    const panel = y % 128 < 2 || x % 256 < 2;
    const run = t.stain * Math.max(0, fbm(x, (y >> 7) * 37, 24, s + 13, 2) - 0.55) * 1.6 * Math.pow(1 - (y % 128) / 128, 2);
    const v = GREY + big * 26 + fine * 8 + board - run * 40;
    return [v, v, v - 2, panel ? 255 : run * 200];
  });
}

function shutter(t, s) {
  const rib = t.rib;
  return layer((x, y) => {
    const ph = (y % rib) / rib;
    const prof = Math.sin(ph * Math.PI * 2) * 22;
    const groove = ph < 0.12 ? -30 : 0;
    const rust = Math.max(0, fbm(x, y, 10, s + 3) - 0.62) * 160;
    const n = (hash2(x, y, s) - 0.5) * 6;
    const v = GREY + prof + groove + n;
    return [v - rust * 0.2, v - rust * 0.45, v - rust * 0.7, (ph < 0.12 ? 200 : 0) + rust];
  });
}

function wood(t, s) {
  const cols = t.c.map(hex);
  const pw = 64;
  return layer((x, y) => {
    const plank = Math.floor(x / pw);
    const fx = x - plank * pw;
    const pick = cols[Math.floor(hash2(plank, 0, s) * cols.length)];
    const grain = Math.sin(((x + fbm(x, y, 4, s + plank) * 60) / N) * Math.PI * 2 * 18) * 10;
    const n = (fbm(x, y, 16, s + 3) - 0.5) * 18;
    const joint = fx < 2;
    const v = grain + n;
    return joint ? [pick[0] * 0.5, pick[1] * 0.5, pick[2] * 0.5, 255] : [pick[0] + v, pick[1] + v * 0.8, pick[2] + v * 0.6, 0];
  });
}

function glass(t, s) {
  return layer((x, y) => {
    // soft sky and street reflections: vertical bands and a dark lower part
    const band = (fbm(x, 0, 6, s, 3) - 0.5) * 40;
    const sky = (1 - y / N) * 26;
    const n = (fbm(x, y, 24, s + 5) - 0.5) * 6;
    const v = GREY - 20 + band + sky + n;
    return [v - 6, v, v + 6, 0];
  });
}

function cloth(t, s) {
  return layer((x, y) => {
    const weave = ((x >> 1) + (y >> 1)) % 2 ? 6 : -6;
    const stripe = t.stripe ? (Math.floor(x / 64) % 2 ? 14 : -14) : 0;
    const fold = Math.sin((x / N) * Math.PI * 2 * 4) * 10;
    const n = (fbm(x, y, 8, s + 3) - 0.5) * 18;
    const v = GREY + weave + stripe + fold + n;
    return [v, v, v, Math.max(0, fbm(x, y, 12, s + 7) - 0.6) * 250];
  });
}

// ------------------------------------------------------------------ atlas
/** The lower half of the atlas: 8 cells of 256 px. Row 512: posters, door, gate, jali. Row 768: AC, goods A, goods B, goods C. */
function cellsSvg(id, kit) {
  const acc = kit.accent;
  const wood = kit.tex.wood.c[0];
  let s = '';
  // 0 posters: a cluster of torn handbills on a wall (decal for worn walls)
  s += `<rect x="0" y="512" width="256" height="256" fill="#bab3a3"/>`;
  const pcol = ['#e8dcc0', '#f2c230', '#d98fa0', '#6f94c4', '#f4efe4', '#c0392b'];
  for (let i = 0; i < 9; i++) {
    const px = 12 + (i % 3) * 80 + (i * 7) % 13;
    const py = 524 + Math.floor(i / 3) * 78 + (i * 11) % 9;
    s += `<rect x="${px}" y="${py}" width="64" height="70" fill="${pcol[i % pcol.length]}" transform="rotate(${(i % 3) - 1} ${px + 32} ${py + 35})"/>`;
    s += `<rect x="${px + 8}" y="${py + 10}" width="48" height="8" fill="#2c2c2c" opacity="0.7"/><rect x="${px + 8}" y="${py + 26}" width="40" height="5" fill="#2c2c2c" opacity="0.5"/><rect x="${px + 8}" y="${py + 38}" width="44" height="5" fill="#2c2c2c" opacity="0.5"/>`;
  }
  // 1 door: wooden double door with panels and studs (haveli doors in the old city, plainer elsewhere)
  s += `<rect x="256" y="512" width="256" height="256" fill="${wood}"/>`;
  for (let k = 0; k < 2; k++) {
    const dx = 256 + 16 + k * 116;
    s += `<rect x="${dx}" y="528" width="108" height="224" fill="#000" opacity="0.18"/>`;
    for (let r = 0; r < 4; r++) s += `<rect x="${dx + 12}" y="${540 + r * 52}" width="84" height="40" fill="#fff" opacity="0.08" stroke="#000" stroke-opacity="0.35" stroke-width="3"/>`;
    if (id === 'gali' || id === 'bazaar' || id === 'hardware') for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) s += `<circle cx="${dx + 24 + c * 30}" cy="${546 + r * 36}" r="4" fill="#b08a3e"/>`;
  }
  s += `<rect x="382" y="512" width="4" height="256" fill="#1c1c1e"/>`;
  // 2 gate: painted iron gate seen against the dark entry behind it
  s += `<rect x="512" y="512" width="256" height="256" fill="#2a2522"/>`;
  for (let i = 0; i < 12; i++) s += `<rect x="${520 + i * 21}" y="520" width="6" height="240" fill="${acc[0]}"/>`;
  s += `<rect x="512" y="560" width="256" height="8" fill="${acc[0]}"/><rect x="512" y="700" width="256" height="8" fill="${acc[0]}"/>`;
  for (let i = 0; i < 6; i++) s += `<circle cx="${533 + i * 42}" cy="630" r="16" fill="none" stroke="${acc[0]}" stroke-width="5"/>`;
  // 3 jali: perforated stone screen
  s += `<rect x="768" y="512" width="256" height="256" fill="#d8cfb8"/>`;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) s += `<polygon points="${784 + c * 30},${528 + r * 30} ${796 + c * 30},${540 + r * 30} ${784 + c * 30},${552 + r * 30} ${772 + c * 30},${540 + r * 30}" fill="#3a332c"/>`;
  // 4 AC unit front
  s += `<rect x="0" y="768" width="256" height="256" fill="#d9d6cc"/><rect x="16" y="800" width="224" height="180" fill="#bdb8ac"/>`;
  for (let i = 0; i < 14; i++) s += `<rect x="24" y="${808 + i * 12}" width="208" height="5" fill="#8c877c"/>`;
  s += `<circle cx="128" cy="890" r="70" fill="none" stroke="#7a756b" stroke-width="6"/>`;
  // 5, 6 and 7: goods on shelves behind the shop front, three kinds per kit (make_goods.mjs; the shader picks one per bay)
  s += goodsSvg(id);
  return s;
}

async function atlas(id, kit) {
  // (the upper half held the P2-010 sign boards; since P2-048 they are the kit's own sign atlas, make_signs.mjs)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ATLAS}" height="${ATLAS}"><rect width="${ATLAS}" height="${ATLAS}" fill="#7a7d7e"/>${cellsSvg(id, kit)}</svg>`;
  await sharp(Buffer.from(svg)).removeAlpha().png().toFile(path.join(OUT, `${id}_atlas.png`));
}

async function tiles(id, kit, seed) {
  const t = kit.tex;
  const layers = [render(t.render, seed), brick(t.brick, seed + 100), stone(t.stone, seed + 200), concrete(t.concrete, seed + 300), shutter(t.shutter, seed + 400), wood(t.wood, seed + 500), glass(t.glass, seed + 600), cloth(t.cloth, seed + 700)];
  if (layers.length !== KITS.layers.length) throw new Error('layer count');
  const all = Buffer.concat(layers);
  await sharp(all, { raw: { width: N, height: N * layers.length, channels: 4 } }).png().toFile(path.join(OUT, `${id}_tiles.png`));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.argv.includes('--signs-only');
  let seed = 1;
  for (const [id, kit] of Object.entries(KITS.kits)) {
    if (!only) {
      await tiles(id, kit, seed * 1000);
      await atlas(id, kit);
      console.log(`kit ${id}: ${id}_tiles.png (${KITS.layers.length} layers), ${id}_atlas.png`);
    }
    seed++;
  }
  const signs = await allSigns(ROOT, KITS.kits, OUT);
  const boards = {
    _doc: 'Sign atlas of each kit (tools/kits/make_signs.mjs, P2-048): <kit>_signs.png, ' + SIGN_ATLAS + ' px; groups give each kind of board its cells (left to right, then down). Every cell name is copied from game/data/names/<area>.json (respect rule: invented names only); extra holds the generic words on the board (goods, estd, phone numbers one digit short, notices).',
    atlas: SIGN_ATLAS,
    groups: GROUPS,
    kits: signs,
  };
  for (const [id, b] of Object.entries(signs)) console.log(`kit ${id}: ${id}_signs.png (${b.cells.length} boards, wear ${b.wear})`);
  fs.writeFileSync(path.join(OUT, 'boards.json'), JSON.stringify(boards, null, 1) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
