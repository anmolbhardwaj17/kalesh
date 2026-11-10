#!/usr/bin/env node
// Keeps Claude's temp folders for this repo (session scratchpads full of screenshots) under a size cap.
// When the total reaches 80% of the limit, deletes the oldest files until it is under 50%.
// Files changed in the last 30 minutes are never touched, so running builders and verifiers keep their work.
//   node harness/bin/tmpclean.mjs [--limit-gb 2] [--dry] [--quiet]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GB = 1024 ** 3;
const KEEP_RECENT_MS = 30 * 60 * 1000;

// Claude Code keeps per-project temp under <tmpdir>/claude-<uid>/<repo path with / turned into ->.
export function tempRoot(repo, uid = process.getuid?.() ?? 0) {
  const base = fs.existsSync('/private/tmp') ? '/private/tmp' : os.tmpdir();
  return path.join(base, `claude-${uid}`, repo.replace(/[^A-Za-z0-9]/g, '-'));
}

function walk(dir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue; // task outputs link to transcripts; never follow or delete them
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) {
      try { const s = fs.statSync(p); out.push({ p, size: s.size, mtime: s.mtimeMs }); } catch {}
    }
  }
  return out;
}

// Pure plan: which files to delete so the total drops under target. Oldest first, recent files kept.
export function planCleanup(files, { limit, now = Date.now(), trigger = 0.8, target = 0.5 }) {
  const total = files.reduce((a, f) => a + f.size, 0);
  if (total < limit * trigger) return { total, remove: [], after: total };
  const candidates = files.filter((f) => now - f.mtime > KEEP_RECENT_MS).sort((a, b) => a.mtime - b.mtime);
  const remove = [];
  let after = total;
  for (const f of candidates) {
    if (after <= limit * target) break;
    remove.push(f);
    after -= f.size;
  }
  return { total, remove, after };
}

function main() {
  const args = process.argv.slice(2);
  const gbArg = args.indexOf('--limit-gb');
  const limit = (gbArg >= 0 ? Number(args[gbArg + 1]) : Number(process.env.HARNESS_TMP_LIMIT_GB || 2)) * GB;
  const dry = args.includes('--dry');
  const quiet = args.includes('--quiet');
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const root = tempRoot(repo);
  const files = walk(root, []) || [];
  const { total, remove, after } = planCleanup(files, { limit });
  const fmt = (n) => (n / GB).toFixed(2) + ' GB';
  if (!remove.length) {
    if (!quiet) console.log(`tmpclean: ${fmt(total)} of ${fmt(limit)} limit, nothing to do`);
    return;
  }
  if (!dry) for (const f of remove) { try { fs.unlinkSync(f.p); } catch {} }
  console.log(`tmpclean: ${fmt(total)} reached 80% of ${fmt(limit)}; ${dry ? 'would delete' : 'deleted'} ${remove.length} oldest files, now ${fmt(after)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
