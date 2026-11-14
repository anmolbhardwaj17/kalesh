#!/usr/bin/env node
// Top view of a site from the production tiles (P1-032): reads the KTL1 tiles of game/world/tiles (or another tile
// folder) that meet a box and draws every mesh triangle from above, the highest surface winning, coloured by its
// material. Lane lines are drawn from the road mesh's lane UV and border codes (what the game's road shader reads),
// so the picture shows what the game draws: zebras and stop lines (marking), medians, kerbs, footpaths, the ground.
//
//   node tools/bake/report/tilesite.mjs --site <id> [--tiles game/world/tiles] [--out harness/reports/map/x.png]
//   node tools/bake/report/tilesite.mjs --lat <lat> --lon <lon> --half <m> --out <file> [--title <text>]
//   node tools/bake/report/tilesite.mjs --sheet <prefix>      (one sheet of every <prefix>_<site>_before/_after pair)
//   --modes  (P2-042) draws every lane piece over the picture coloured by who may use it (cars, two-wheelers, walkers)
//
// World metres: block metres plus the tile index's block offset (x east, z south, north up in the picture).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { projector } from '../../geo/projection.ts';
import { decodeContent } from '../tile/codec.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const ORIGIN = { lat: 28.612894, lon: 77.229446 };

/** Sites of the P1-032 before and after pictures (lat, lon of the middle, half width in metres). */
export const SITES = [
  { id: 'median_janpath', name: 'Janpath north of Windsor Place: the median between the two carriageways', lat: 28.6240, lon: 77.2190, half: 60 },
  { id: 'turns_ito', name: 'ITO (Lala Ramcharan Aggarwal Chowk): restrictions and turn lanes', lat: 28.6279, lon: 77.2412, half: 110 },
  { id: 'crossing_janpath', name: 'Janpath mid-block crossing (OSM crossing nodes 6383120542, 6383120543)', lat: 28.629593, lon: 77.219508, half: 45 },
];

const COLOUR = {
  ground: [128, 138, 104], plot: [150, 140, 118], lawn: [104, 150, 82], bed: [120, 104, 76], water: [70, 110, 150], hedge: [70, 110, 60],
  road: [72, 72, 78], parking: [104, 104, 112], gore: [140, 128, 90], marking: [245, 245, 240], footpath: [185, 173, 152], kerb: [205, 200, 190],
  median: [178, 172, 150], planter: [96, 140, 74], building: [120, 92, 80], wall: [150, 130, 110], pier: [160, 160, 160], underside: [90, 90, 96], joint: [60, 60, 60],
  forecourt: [196, 170, 140], pad: [214, 196, 160], wallbase: [128, 76, 64], moat: [108, 98, 78], landmark: [214, 190, 150], landmark_red: [168, 84, 70],
  // P2-042: paved walkways in the ground, and the bollards and gates (drawn bright so a top view shows every post)
  walkway: [222, 196, 150], bollard: [250, 210, 0],
};

const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};

/** Draws the box and writes a PNG; returns the triangle count drawn. */
export async function drawSite({ tilesDir, lat, lon, half, out, title, mPerPx = 0.1, modes = false }) {
  const index = JSON.parse(fs.readFileSync(path.join(tilesDir, 'index.json'), 'utf8'));
  const [ox, oz] = index.offset;
  const p = projector(ORIGIN).toWorld(lat, lon);
  const cx = p.x + ox;
  const cz = p.z + oz;
  const W = Math.round((2 * half) / mPerPx);
  const H = W;
  const minX = cx - half;
  const minZ = cz - half;
  const rgb = new Uint8Array(W * H * 3);
  const top = new Float32Array(W * H).fill(-1e9);
  for (let i = 0; i < W * H; i++) rgb.set([40, 42, 46], i * 3);
  let drawn = 0;
  // P2-042 (--modes): lane pieces over the picture, coloured by who may use them
  const laneLines = [];
  for (const t of index.tiles) {
    const tx0 = t.origin[0];
    const tz0 = t.origin[2];
    if (tx0 > cx + half + 250 || tx0 + index.size < cx - half - 250 || tz0 > cz + half + 250 || tz0 + index.size < cz - half - 250) continue;
    const c = decodeContent(new Uint8Array(fs.readFileSync(path.join(tilesDir, t.file))));
    if (modes) {
      for (const l of c.lanes ?? []) {
        const pts = [];
        for (let i = 0; i + 2 < l.pts.length; i += 3) pts.push([(l.pts[i] + c.origin[0] - minX) / mPerPx, (l.pts[i + 2] + c.origin[2] - minZ) / mPerPx]);
        if (pts.every(([x, z]) => x < -50 || z < -50 || x > W + 50 || z > H + 50)) continue;
        const ms = l.modes ?? ['car', 'auto', 'two_wheeler', 'cycle', 'foot', 'emergency'];
        const colour = ms.includes('car') ? '#2f7cff' : ms.includes('two_wheeler') ? '#ff8c1a' : '#21c45a';
        laneLines.push(`<polyline points="${pts.map(([x, z]) => `${x.toFixed(1)},${z.toFixed(1)}`).join(' ')}" fill="none" stroke="${colour}" stroke-width="${l.kind === 'path' ? 2 : 4}" stroke-opacity="0.9"/>`);
      }
    }
    for (const m of c.meshes) {
      const col = COLOUR[m.material] ?? [200, 0, 200];
      const pos = m.pos;
      const X = (v) => (pos[v * 3] + c.origin[0] - minX) / mPerPx;
      const Y = (v) => pos[v * 3 + 1] + c.origin[1];
      const Z = (v) => (pos[v * 3 + 2] + c.origin[2] - minZ) / mPerPx;
      for (let k = 0; k < m.idx.length; k += 3) {
        const a = m.idx[k];
        const b = m.idx[k + 1];
        const d = m.idx[k + 2];
        const ax = X(a), az = Z(a), bx = X(b), bz = Z(b), dx = X(d), dz = Z(d);
        const x0 = Math.max(0, Math.floor(Math.min(ax, bx, dx)));
        const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, dx)));
        const z0 = Math.max(0, Math.floor(Math.min(az, bz, dz)));
        const z1 = Math.min(H - 1, Math.ceil(Math.max(az, bz, dz)));
        if (x0 > x1 || z0 > z1) continue;
        const area = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
        if (Math.abs(area) < 1e-9) continue;
        // a wall stands on edge: seen from above it is a line, drawn only where nothing higher lies
        const ny = m.nrm[a * 3 + 1];
        if (Math.abs(ny) < 0.2 && m.material !== 'marking') continue;
        drawn++;
        const ya = Y(a), yb = Y(b), yd = Y(d);
        for (let pz = z0; pz <= z1; pz++) {
          for (let px = x0; px <= x1; px++) {
            const sx = px + 0.5;
            const sz = pz + 0.5;
            const w0 = ((bx - sx) * (dz - sz) - (bz - sz) * (dx - sx)) / area;
            const w1 = ((dx - sx) * (az - sz) - (dz - sz) * (ax - sx)) / area;
            const w2 = 1 - w0 - w1;
            if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
            let y = w0 * ya + w1 * yb + w2 * yd;
            if (m.material === 'marking') y += 0.05;
            const at = pz * W + px;
            if (y < top[at]) continue;
            top[at] = y;
            let cc = col;
            if (m.uv && m.uv2) {
              // lane lines from the lane UV: u runs 0 to 1 across the lane, v is metres along the road
              const u = w0 * m.uv[a * 2] + w1 * m.uv[b * 2] + w2 * m.uv[d * 2];
              const v = w0 * m.uv[a * 2 + 1] + w1 * m.uv[b * 2 + 1] + w2 * m.uv[d * 2 + 1];
              const code = u < 0.5 ? m.uv2[a * 2] : m.uv2[a * 2 + 1];
              const edge = u < 0.5 ? u : 1 - u;
              const dash = code !== 1 || ((v % 7.5) + 7.5) % 7.5 < 3;
              if (code >= 1 && edge < 0.035 && dash) cc = code === 2 ? [235, 200, 70] : [235, 235, 230];
            }
            rgb.set(cc, at * 3);
          }
        }
      }
    }
  }
  // light from the north-west by the height difference to the pixel up and left: kerbs and buildings read in plan
  const shade = new Uint8Array(rgb);
  for (let pz = 1; pz < H; pz++) {
    for (let px = 1; px < W; px++) {
      const at = pz * W + px;
      const dy = top[at] - top[at - W - 1];
      if (!(Math.abs(dy) < 1e3)) continue;
      const f = Math.max(0.55, Math.min(1.35, 1 + dy * 1.2));
      for (let ch = 0; ch < 3; ch++) shade[at * 3 + ch] = Math.max(0, Math.min(255, Math.round(rgb[at * 3 + ch] * f)));
    }
  }
  const bar = Math.round(20 / mPerPx);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="34" fill="#1d1f24" opacity="0.85"/><text x="10" y="23" font-family="Helvetica, Arial" font-size="17" fill="#fff">${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text><rect x="12" y="${H - 22}" width="${bar}" height="6" fill="#fff"/><text x="12" y="${H - 28}" font-family="Helvetica" font-size="14" fill="#fff">20 m</text><polygon points="${W - 30},44 ${W - 38},70 ${W - 30},64 ${W - 22},70" fill="#fff"/><text x="${W - 36}" y="88" font-family="Helvetica" font-size="15" font-weight="bold" fill="#fff">N</text>${laneLines.join('')}${modes ? `<rect x="${W - 330}" y="${H - 96}" width="318" height="84" fill="#1d1f24" opacity="0.85"/><rect x="${W - 320}" y="${H - 86}" width="22" height="6" fill="#2f7cff"/><text x="${W - 290}" y="${H - 78}" font-family="Helvetica" font-size="14" fill="#fff">lanes open to cars</text><rect x="${W - 320}" y="${H - 60}" width="22" height="6" fill="#ff8c1a"/><text x="${W - 290}" y="${H - 52}" font-family="Helvetica" font-size="14" fill="#fff">two-wheelers, cycles, walkers</text><rect x="${W - 320}" y="${H - 34}" width="22" height="6" fill="#21c45a"/><text x="${W - 290}" y="${H - 26}" font-family="Helvetica" font-size="14" fill="#fff">walkers, cycles, emergency only</text>` : ''}</svg>`;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp(Buffer.from(shade), { raw: { width: W, height: H, channels: 3 } }).composite([{ input: Buffer.from(svg) }]).png().toFile(out);
  return drawn;
}

/** One sheet: every site of the prefix, before on the left, after on the right. */
export async function sheet(dir, prefix) {
  const rows = SITES.filter((s) => fs.existsSync(path.join(dir, `${prefix}_${s.id}_before.png`)) && fs.existsSync(path.join(dir, `${prefix}_${s.id}_after.png`)));
  const cell = 800;
  const parts = [];
  for (const [r, s] of rows.entries()) {
    for (const [c, side] of ['before', 'after'].entries()) {
      parts.push({ input: await sharp(path.join(dir, `${prefix}_${s.id}_${side}.png`)).resize(cell, cell).png().toBuffer(), left: c * (cell + 10), top: r * (cell + 10) + 40 });
    }
  }
  const W = 2 * cell + 10;
  const H = rows.length * (cell + 10) + 40;
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="40"><rect width="100%" height="100%" fill="#111"/><text x="10" y="27" font-family="Helvetica" font-size="20" fill="#fff">${prefix}: before (left) and after (right), north up</text></svg>`;
  parts.push({ input: Buffer.from(head), left: 0, top: 0 });
  const out = path.join(dir, `${prefix}_sheet.jpg`);
  await sharp({ create: { width: W, height: H, channels: 3, background: '#111' } }).composite(parts).jpeg({ quality: 82 }).toFile(out);
  return out;
}

async function main() {
  const tilesDir = path.resolve(ROOT, arg('--tiles', 'game/world/tiles'));
  const outDir = path.resolve(ROOT, arg('--dir', 'harness/reports/map'));
  if (arg('--sheet')) {
    console.log(await sheet(outDir, arg('--sheet')));
    return;
  }
  const id = arg('--site');
  const list = id === 'all' ? SITES : id ? SITES.filter((s) => s.id === id) : [{ id: 'site', name: arg('--title', 'site'), lat: Number(arg('--lat')), lon: Number(arg('--lon')), half: Number(arg('--half', '80')) }];
  if (!list.length) throw new Error(`no site ${id} (sites: ${SITES.map((s) => s.id).join(', ')})`);
  const tag = arg('--tag', '');
  for (const s of list) {
    const out = arg('--out') && list.length === 1 ? path.resolve(ROOT, arg('--out')) : path.join(outDir, `${arg('--prefix', 'p1-032')}_${s.id}${tag ? `_${tag}` : ''}.png`);
    const n = await drawSite({ tilesDir, lat: s.lat, lon: s.lon, half: s.half, out, title: `${s.name}${tag ? ` (${tag})` : ''}`, mPerPx: Number(arg('--m-per-px', String(Math.max(0.06, (2 * s.half) / 1600)))), modes: args.includes('--modes') });
    console.log(`${path.relative(ROOT, out)}: ${n} triangles`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
