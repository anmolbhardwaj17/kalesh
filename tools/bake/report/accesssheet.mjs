#!/usr/bin/env node
// A before and after sheet with references (P2-042): two top views of the production tiles (tilesite.mjs) side by side,
// the map beside Esri imagery (judge.mjs site), then a game shot beside a reference board (or the board alone).
//   node tools/bake/report/accesssheet.mjs <out.jpg> <title> <before.png> <after.png> <sat.png> <board.jpg> [shot.png]
import sharp from 'sharp';
const [out, title, before, after, sat, board, shot] = process.argv.slice(2);
const W = 1600;
const label = (t, w, h = 34) => Buffer.from(`<svg width="${w}" height="${h}"><rect width="100%" height="100%" fill="#222"/><text x="10" y="23" font-family="Helvetica" font-size="18" fill="#fff">${t.replace(/&/g, '&amp;')}</text></svg>`);
const half = (W - 30) / 2;
const img = async (f, w, h) => sharp(f).resize(Math.round(w), h ? Math.round(h) : undefined, { fit: 'contain', background: '#222' }).png().toBuffer();
const parts = [];
let y = 0;
parts.push({ input: label(title, W, 40), left: 0, top: 0 }); y += 50;
const b = await img(before, half, half); const a = await img(after, half, half);
parts.push({ input: b, left: 10, top: y }, { input: a, left: 20 + half, top: y }); y += half + 10;
const s = await img(sat, W - 20, Math.round((W - 20) * 448 / 852));
parts.push({ input: s, left: 10, top: y }); y += Math.round((W - 20) * 448 / 852) + 10;
if (shot) { const sh = await img(shot, half, Math.round(half * 9 / 16)); const bo = await img(board, half, Math.round(half * 9 / 16)); parts.push({ input: sh, left: 10, top: y }, { input: bo, left: 20 + half, top: y }); y += Math.round(half * 9 / 16) + 10; }
else { const bo = await img(board, W - 20, Math.round((W - 20) * 0.5)); parts.push({ input: bo, left: 10, top: y }); y += Math.round((W - 20) * 0.5) + 10; }
await sharp({ create: { width: W, height: y, channels: 3, background: '#222' } }).composite(parts).jpeg({ quality: 82 }).toFile(out);
console.log(out, W, y);
