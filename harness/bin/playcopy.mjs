#!/usr/bin/env node
// Stable game copy for the dashboard's /play/ (P4-073). Builders rebuild and wipe dist/ all the time, so a page the owner has
// open asked for chunks that no longer existed (the P4-070 hang). /play/ now serves a copy built from a commit, which
// changes only when this script runs (after a verified commit, or the dashboard's "Refresh" button).
//   node harness/bin/playcopy.mjs                 build HEAD into a new copy and make it current
//   node harness/bin/playcopy.mjs <commit>        build that commit
//   node harness/bin/playcopy.mjs --verified      build the newest commit with no unverified task commit at or before it
//   node harness/bin/playcopy.mjs --status        print the current copy
// Options: --force (rebuild a commit that already has a copy), --keep N (copies kept, default 3).
// Builds in its own worktree .worktrees/play (vite build only, no tsc: the commit was checked), into
// .worktrees/playcopy/<sha>/, then writes .worktrees/playcopy/current.json. Older copies stay (newest N) so an open page
// still finds its own chunks. Files that public/ also has (same size) are left out of a copy: the dashboard serves
// public/ first, as it did with dist/.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT, R, PATHS, readJSON } from './lib.mjs';

export const COPY_ROOT = R('.worktrees', 'playcopy');
export const CURRENT = path.join(COPY_ROOT, 'current.json');
const WT = R('.worktrees', 'play');
const LOCK = path.join(COPY_ROOT, '.lock');
const SETTLED = new Set(['done', 'skipped', 'blocked']);

/** Task ids named in a commit subject: `[P4-073][P4-051] ...`. */
export function taskIds(subject) {
  return [...String(subject || '').matchAll(/\[([A-Z0-9]+-[A-Z0-9-]+)\]/g)].map((m) => m[1]);
}

/**
 * The newest commit a verifier has passed, plus the untagged commits after it (state, content and art commits) up to the
 * next task commit still being verified. `commits` is newest first ({sha, subject}); `status(id)` gives a task's status.
 * A task commit counts as verified when all its ids are done, skipped or blocked: its snapshot passed, and that tree also
 * held every older commit. Null when no task commit in the list is verified.
 */
export function pickVerified(commits, status) {
  const pending = (c) => { const ids = taskIds(c.subject); return ids.length > 0 && ids.some((id) => !SETTLED.has(status(id))); };
  const k = commits.findIndex((c) => taskIds(c.subject).length > 0 && !pending(c));
  if (k < 0) return null;
  for (let i = k - 1; i >= 0; i--) if (pending(commits[i])) return commits[i + 1];
  return commits[0];
}

/** The current copy and the older kept ones, newest first: [{sha, dir, builtAt, subject}]. */
export function readCopies(root = COPY_ROOT) {
  const cur = readJSON(path.join(root, 'current.json'), null);
  if (!cur || !Array.isArray(cur.copies)) return [];
  return cur.copies.filter((c) => c && c.sha && fs.existsSync(path.join(root, c.sha, 'index.html')))
    .map((c) => ({ ...c, dir: path.join(root, c.sha) }));
}

/** Folders /play/ serves from, in order: public/ first (re-ingested art), then the current copy, then older copies. */
export function playRoots(root = COPY_ROOT) {
  const copies = readCopies(root);
  return copies.length ? [R('public'), ...copies.map((c) => c.dir)] : null;
}

/** Remove files from a fresh copy that public/ has with the same size (served from public/ first anyway). */
function stripPublic(dir, pub) {
  let n = 0;
  const walk = (rel) => {
    const abs = path.join(pub, rel);
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) { walk(r); continue; }
      const f = path.join(dir, r);
      try { if (fs.statSync(f).size === fs.statSync(path.join(pub, r)).size) { fs.unlinkSync(f); n++; } } catch { /* not in copy */ }
    }
  };
  if (fs.existsSync(pub)) walk('');
  return n;
}

function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

function gitLog(n) {
  const out = execFileSync('git', ['log', `-${n}`, '--format=%h%x09%s'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter(Boolean).map((l) => { const [sha, ...s] = l.split('\t'); return { sha, subject: s.join('\t') }; });
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (f) => { const i = argv.indexOf(f); if (i >= 0) { argv.splice(i, 1); return true; } return false; };
  const opt = (f, d) => { const i = argv.indexOf(f); if (i >= 0) { const v = argv[i + 1]; argv.splice(i, 2); return v; } return d; };
  if (flag('--status')) {
    const c = readCopies();
    console.log(c.length ? c.map((x, i) => `${i ? 'older  ' : 'CURRENT'} ${x.sha} ${x.builtAt} ${x.subject}`).join('\n') : 'No play copy yet: /play/ serves dist/.');
    return;
  }
  const force = flag('--force');
  const keep = Math.max(2, Number(opt('--keep', 3)) || 3);
  let target;
  if (flag('--verified')) {
    const tasks = readJSON(PATHS.backlog, { tasks: [] }).tasks || [];
    const byId = new Map(tasks.map((t) => [t.id, t.status]));
    const pick = pickVerified(gitLog(60), (id) => byId.get(id) || 'done');
    if (!pick) { console.log('PLAYCOPY no verified commit in the last 60'); process.exit(1); }
    target = pick.sha;
  } else target = argv[0] || 'HEAD';
  const sha = execFileSync('git', ['rev-parse', '--short', target], { cwd: ROOT, encoding: 'utf8' }).trim();
  const subject = execFileSync('git', ['log', '-1', '--format=%s', sha], { cwd: ROOT, encoding: 'utf8' }).trim();
  fs.mkdirSync(COPY_ROOT, { recursive: true });
  const copies = readCopies();
  if (!force && copies[0]?.sha === sha) { console.log(`PLAYCOPY ${sha} is already current`); return; }

  if (fs.existsSync(LOCK)) {
    const pid = Number(fs.readFileSync(LOCK, 'utf8'));
    if (alive(pid)) { console.log(`PLAYCOPY busy: pid ${pid} is building a copy`); process.exit(2); }
  }
  fs.writeFileSync(LOCK, String(process.pid));
  try {
    const t0 = Date.now();
    const dest = path.join(COPY_ROOT, sha);
    const have = !force && fs.existsSync(path.join(dest, 'index.html'));
    if (!have) {
      const sh = (c, cwd = ROOT) => execSync(c, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      if (!fs.existsSync(path.join(WT, '.git'))) { sh('git worktree prune'); sh(`git worktree add --detach "${WT}" ${sha}`); }
      else sh(`git checkout --detach --force ${sha}`, WT);
      const nm = path.join(WT, 'node_modules');
      if (!fs.existsSync(nm)) fs.symlinkSync(R('node_modules'), nm, 'dir');
      const tmp = path.join(COPY_ROOT, `.tmp-${sha}-${process.pid}`);
      fs.rmSync(tmp, { recursive: true, force: true });
      try {
        execFileSync(process.execPath, [path.join(WT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', tmp, '--emptyOutDir', '--logLevel', 'error'],
          { cwd: WT, stdio: ['ignore', 'pipe', 'pipe'], timeout: 900_000, maxBuffer: 64 * 1024 * 1024 });
      } catch (e) {
        console.log(String(e.stderr || e.stdout || '').split('\n').filter(Boolean).slice(-12).join('\n'));
        throw new Error(`vite build of ${sha} failed`);
      }
      if (!fs.existsSync(path.join(tmp, 'index.html'))) throw new Error('vite build wrote no index.html');
      const stripped = stripPublic(tmp, R('public'));
      fs.rmSync(dest, { recursive: true, force: true });
      fs.renameSync(tmp, dest);
      console.log(`built ${sha} in ${((Date.now() - t0) / 1000).toFixed(0)} s (${stripped} public files left to public/)`);
    }
    // Current first, then the older ones; drop copies past `keep`.
    const entry = { sha, subject, builtAt: new Date().toISOString() };
    const list = [entry, ...copies.filter((c) => c.sha !== sha).map(({ sha: s, subject: sub, builtAt }) => ({ sha: s, subject: sub, builtAt }))];
    const kept = list.slice(0, keep);
    const tmpJson = `${CURRENT}.tmp`;
    fs.writeFileSync(tmpJson, JSON.stringify({ sha, subject, builtAt: entry.builtAt, copies: kept }, null, 1) + '\n');
    fs.renameSync(tmpJson, CURRENT);
    for (const c of list.slice(keep)) fs.rmSync(path.join(COPY_ROOT, c.sha), { recursive: true, force: true });
    for (const f of fs.readdirSync(COPY_ROOT)) if (f.startsWith('.tmp-') && !f.endsWith(`-${process.pid}`)) fs.rmSync(path.join(COPY_ROOT, f), { recursive: true, force: true });
    console.log(`PLAYCOPY ${sha} current (${subject}); keeping ${kept.map((c) => c.sha).join(', ')}`);
  } finally {
    try { fs.unlinkSync(LOCK); } catch { /* gone */ }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.log(`PLAYCOPY FAILED: ${String(e.message || e).split('\n')[0]}`); process.exit(1); }
}
