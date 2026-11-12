#!/usr/bin/env node
// Stable game copy to play (P4-073, reworked for Godot in P0-027). Builders edit game/ all the time, so a copy of the
// project exported from a commit is what Anmol plays: it changes only when this script runs (after a verified commit, or
// the dashboard's "Refresh" button). A copy is `git archive <sha> game` unpacked into harness/reports/play/<sha>/game/ and
// imported once by the pinned Godot (headless), then npm run play opens it in a window. The gitignored full tile set is
// cloned in from the main checkout when its bake hash is the one the commit's game/world/tiles.hash names (tileset.mjs),
// else the copy stops with "rebake: npm run bake -- pilot".
//   npm run play                                  play the current copy (builds the newest verified commit if there is none)
//   node harness/bin/playcopy.mjs                 build HEAD into a new copy and make it current
//   node harness/bin/playcopy.mjs <commit>        build that commit
//   node harness/bin/playcopy.mjs --verified      build the newest commit with no unverified task commit at or before it
//   node harness/bin/playcopy.mjs --play [engine args]   launch the pinned Godot on the current copy (npm run play); any
//                                                 further args go to the engine (for example --quit-after 120)
//   node harness/bin/playcopy.mjs --status        print the current copy
// Options: --force (rebuild a commit that already has a copy), --keep N (copies kept, default 3).
// Writes harness/reports/play/current.json. Older copies stay (newest N). The browser build (vite, dist/) is retired:
// harness/bin/browser.mjs stays for a later web demo.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT, R, PATHS, readJSON } from './lib.mjs';
import { resolveGodot, errorLines, stripAnsi } from './godot.mjs';
import { provideTiles } from './tileset.mjs';

export const COPY_ROOT = R('harness', 'reports', 'play');
export const CURRENT = path.join(COPY_ROOT, 'current.json');
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

/** The current copy and the older kept ones, newest first: [{sha, dir, project, builtAt, subject}]. A copy needs its game/project.godot. */
export function readCopies(root = COPY_ROOT) {
  const cur = readJSON(path.join(root, 'current.json'), null);
  if (!cur || !Array.isArray(cur.copies)) return [];
  return cur.copies.filter((c) => c && c.sha && fs.existsSync(path.join(root, c.sha, 'game', 'project.godot')))
    .map((c) => ({ ...c, dir: path.join(root, c.sha), project: path.join(root, c.sha, 'game') }));
}

/** The command that plays the current copy, for the dashboard and docs. */
export const PLAY_COMMAND = 'npm run play';

function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }

function gitLog(n) {
  const out = execFileSync('git', ['log', `-${n}`, '--format=%h%x09%s'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter(Boolean).map((l) => { const [sha, ...s] = l.split('\t'); return { sha, subject: s.join('\t') }; });
}

/** Unpacks the game/ folder of a commit into dest and imports it once (headless), so a window run starts at once. */
async function buildCopy(sha, dest) {
  const tar = path.join(COPY_ROOT, `.tmp-${sha}-${process.pid}.tar`);
  const tmp = path.join(COPY_ROOT, `.tmp-${sha}-${process.pid}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  try {
    execFileSync('git', ['archive', '--format=tar', '-o', tar, sha, 'game'], { cwd: ROOT });
    execFileSync('tar', ['-xf', tar, '-C', tmp]);
    if (!fs.existsSync(path.join(tmp, 'game', 'project.godot'))) throw new Error(`commit ${sha} has no game/project.godot`);
    // the baked tiles are gitignored: the copy gets the full set from the main checkout when it is the one the commit expects (P1-018)
    const tiles = provideTiles(tmp, ROOT);
    if (!tiles.ok) throw new Error(tiles.reason);
    if (tiles.status !== 'none') console.log(`tiles: ${tiles.status} (${tiles.reason})`);
    const g = await resolveGodot({ allowDownload: true });
    const r = spawnSync(g.path, ['--headless', '--path', path.join(tmp, 'game'), '--import'], { encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024 });
    const out = stripAnsi(`${r.stdout || ''}${r.stderr || ''}`);
    const errs = errorLines(out);
    if (r.status !== 0 || errs.length) {
      console.log(errs.slice(0, 12).join('\n') || out.split('\n').slice(-12).join('\n'));
      throw new Error(`the Godot import of ${sha} failed`);
    }
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(tmp, dest);
  } finally {
    fs.rmSync(tar, { force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Opens the pinned Godot on the current copy; resolves with its exit code. */
async function play(copy, extra = []) {
  const g = await resolveGodot({ allowDownload: true });
  console.log(`PLAY ${copy.sha} (${copy.subject}) with Godot ${g.cfg.version}`);
  const r = spawnSync(g.path, ['--path', copy.project, ...extra], { stdio: 'inherit' });
  return r.status ?? 1;
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (f) => { const i = argv.indexOf(f); if (i >= 0) { argv.splice(i, 1); return true; } return false; };
  const opt = (f, d) => { const i = argv.indexOf(f); if (i >= 0) { const v = argv[i + 1]; argv.splice(i, 2); return v; } return d; };
  if (flag('--status')) {
    const c = readCopies();
    console.log(c.length ? c.map((x, i) => `${i ? 'older  ' : 'CURRENT'} ${x.sha} ${x.builtAt} ${x.subject}`).join('\n') : `No play copy yet: run "node harness/bin/playcopy.mjs --verified", or ${PLAY_COMMAND} builds one.`);
    return;
  }
  const wantPlay = flag('--play');
  const force = flag('--force');
  const keep = Math.max(2, Number(opt('--keep', 3)) || 3);
  const extra = wantPlay ? argv.splice(0) : [];
  if (wantPlay && readCopies()[0]) process.exit(await play(readCopies()[0], extra));
  let target;
  if (flag('--verified') || wantPlay) {
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
    const have = !force && fs.existsSync(path.join(dest, 'game', 'project.godot'));
    if (!have) {
      await buildCopy(sha, dest);
      console.log(`built ${sha} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
    // Current first, then the older ones; drop copies past `keep`.
    const entry = { sha, subject, builtAt: new Date().toISOString() };
    const list = [entry, ...copies.filter((c) => c.sha !== sha).map(({ sha: s, subject: sub, builtAt }) => ({ sha: s, subject: sub, builtAt }))];
    const kept = list.slice(0, keep);
    const tmpJson = `${CURRENT}.tmp`;
    fs.writeFileSync(tmpJson, JSON.stringify({ sha, subject, builtAt: entry.builtAt, copies: kept }, null, 1) + '\n');
    fs.renameSync(tmpJson, CURRENT);
    for (const c of list.slice(keep)) fs.rmSync(path.join(COPY_ROOT, c.sha), { recursive: true, force: true });
    for (const f of fs.readdirSync(COPY_ROOT)) if (f.startsWith('.tmp-') && !f.endsWith(`-${process.pid}`) && !f.includes(`-${process.pid}.`)) fs.rmSync(path.join(COPY_ROOT, f), { recursive: true, force: true });
    console.log(`PLAYCOPY ${sha} current (${subject}); keeping ${kept.map((c) => c.sha).join(', ')}`);
  } finally {
    try { fs.unlinkSync(LOCK); } catch { /* gone */ }
  }
  if (wantPlay) process.exit(await play(readCopies()[0], extra));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.log(`PLAYCOPY FAILED: ${String(e.message || e).split('\n')[0]}`); process.exit(1); });
}
