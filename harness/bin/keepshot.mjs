#!/usr/bin/env node
// Keep a progress screenshot for Anmol's memory folder (progress/).
// Usage: node harness/bin/keepshot.mjs "<short label>" <image> [<image> ...]
// Each image is saved as progress/<YYYY-MM-DD>_<label>[_n].jpg, at most 1600 px wide, JPEG quality 80 (macOS sips).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';

const [label, ...files] = process.argv.slice(2);
if (!label || !files.length) { console.error('usage: keepshot.mjs "<label>" <image> [...]'); process.exit(2); }
const dir = path.join(ROOT, 'progress');
fs.mkdirSync(dir, { recursive: true });
const day = new Date().toISOString().slice(0, 10);
const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
files.forEach((f, i) => {
  if (!fs.existsSync(f)) { console.error(`missing: ${f}`); process.exitCode = 1; return; }
  const out = path.join(dir, `${day}_${slug}${files.length > 1 ? `_${i + 1}` : ''}.jpg`);
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', '-Z', '1600', f, '--out', out], { stdio: 'ignore' });
  console.log(`kept ${path.relative(ROOT, out)}`);
});
