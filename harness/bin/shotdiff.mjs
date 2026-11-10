#!/usr/bin/env node
// shotdiff.mjs (P5-007): pixel comparison of two sets of shots with the same file names.
//   node harness/bin/shotdiff.mjs <dirA> <dirB> [--match ch2hold_] [--tol-mean 2.0] [--tol-share 0.03] [--delta 24]
// For each PNG in both dirs (names containing --match): the mean absolute difference over the RGB channels (0 to 255) and
// the share of pixels whose largest channel difference is over --delta. A pair passes when the mean is at most --tol-mean
// and the share at most --tol-share (the defaults sit above the run to run noise of the animated water, motes and flames).
// Exit code 1 when any pair fails or a name is missing from dirB.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  if (i < 0) return def;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const match = opt('--match', '');
const tolMean = Number(opt('--tol-mean', '2.0'));
const tolShare = Number(opt('--tol-share', '0.03'));
const delta = Number(opt('--delta', '24'));
const [dirA, dirB] = args;
if (!dirA || !dirB) {
  console.log('usage: node harness/bin/shotdiff.mjs <dirA> <dirB> [--match prefix] [--tol-mean 2.0] [--tol-share 0.03] [--delta 24]');
  process.exit(2);
}

const raw = async (file) => sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const names = fs.readdirSync(dirA).filter((n) => n.endsWith('.png') && n.includes(match)).sort();
let bad = 0;
console.log(`shotdiff ${dirA} vs ${dirB} (pass: mean <= ${tolMean}, share over ${delta} <= ${tolShare})`);
for (const n of names) {
  const b = path.join(dirB, n);
  if (!fs.existsSync(b)) {
    console.log(`  ${n.padEnd(28)} MISSING in ${dirB}`);
    bad++;
    continue;
  }
  const [x, y] = await Promise.all([raw(path.join(dirA, n)), raw(b)]);
  if (x.info.width !== y.info.width || x.info.height !== y.info.height) {
    console.log(`  ${n.padEnd(28)} SIZE ${x.info.width}x${x.info.height} vs ${y.info.width}x${y.info.height}`);
    bad++;
    continue;
  }
  let sum = 0;
  let over = 0;
  const px = x.info.width * x.info.height;
  for (let i = 0; i < px; i++) {
    let m = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs((x.data[i * 3 + c] ?? 0) - (y.data[i * 3 + c] ?? 0));
      sum += d;
      if (d > m) m = d;
    }
    if (m > delta) over++;
  }
  const mean = sum / (px * 3);
  const share = over / px;
  const ok = mean <= tolMean && share <= tolShare;
  if (!ok) bad++;
  console.log(`  ${n.padEnd(28)} mean ${mean.toFixed(3).padStart(7)}  share ${(share * 100).toFixed(3).padStart(7)}%  ${ok ? 'ok' : 'FAIL'}`);
}
console.log(bad ? `SHOTDIFF FAIL (${bad})` : `SHOTDIFF OK (${names.length} pairs)`);
process.exit(bad ? 1 : 0);
