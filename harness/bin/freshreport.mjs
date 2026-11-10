#!/usr/bin/env node
// Is harness/reports/latest.json a passing --all (default) or --quick run (--mode quick) of exactly the current working tree?
// Prints FRESH (exit 0) or STALE with the reason (exit 1). Verifiers use it to skip re-running the whole suite
// when the builder's final --all already covers the tree they are judging.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { PATHS, ROOT, readJSON } from './lib.mjs';

// --tree <checkout>: does <checkout> (the builder's main folder) have a passing quick or all run whose tree hash equals
// this tree? Used by the verifier on the snapshot (owner, 2026-10-09). Prints FRESH or STALE like below.
// The hash covers only lib.mjs TREE_HASH_PATHS (game and verify files), so state, docs and report commits and junk left
// untracked in the snapshot do not count (P4-068).
if (process.argv.includes('--tree')) {
  const { treeHash, TREE_RULE } = await import('./lib.mjs');
  const from = path.resolve(process.argv[process.argv.indexOf('--tree') + 1] || ROOT);
  const mine = treeHash(ROOT);
  // Run it from the folder being judged (the snapshot): it hashes the tree at ROOT, the checkout this script lives in.
  console.log(`hashing ${ROOT}`);
  if (!mine) { console.log('STALE: no tree hash here'); process.exit(1); }
  const hist = path.join(from, 'harness', 'reports', 'history');
  const files = fs.existsSync(hist) ? fs.readdirSync(hist).filter((f) => /-(quick|all)\.json$/.test(f)).sort().reverse() : [];
  for (const f of files) {
    const r = readJSON(path.join(hist, f), null);
    // A quick run on a pretend file list (verify --quick --changed, P2-167) did not pick its set from this tree: never reuse it.
    if (r && r.tree === mine && !(r.quickSet && r.quickSet.simulated)) {
      if (!r.ok) { console.log(`STALE: the run of this tree (${f}) failed: ${r.failReason || 'see report'}`); process.exit(1); }
      const set = r.quickSet ? `, ${r.quickSet.picked} of ${r.quickSet.of} scenarios` : '';
      console.log(`FRESH: --${r.mode} OK at ${r.finishedAt}${set}, same tree ${mine.slice(0, 10)} (${path.join(hist, f)})`);
      process.exit(0);
    }
  }
  // A run recorded under an older hash rule (before P4-068 the hash also covered docs and untracked snapshot junk) never matches.
  const newest = files.length ? readJSON(path.join(hist, files[0]), null) : null;
  const rule = newest && (newest.treeRule || 1) !== TREE_RULE ? ` (the newest run, ${files[0]}, used tree rule ${newest.treeRule || 1}, this is rule ${TREE_RULE})` : '';
  console.log(`STALE: no quick or all run in ${hist} has tree ${mine.slice(0, 10)}${rule}`); process.exit(1);
}
const want = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'all';
// For quick mode, the builder's last quick run is often followed by --mission or --only runs, which overwrite
// latest.json, so take the newest quick (or all) report from the history folder instead.
let rep = readJSON(PATHS.reportLatest, null);
if (want === 'quick' && rep && rep.mode !== 'quick' && rep.mode !== 'all') {
  const hist = path.join(PATHS.reports || path.join(ROOT, 'harness', 'reports'), 'history');
  const files = fs.existsSync(hist) ? fs.readdirSync(hist).filter((f) => /-(quick|all)\.json$/.test(f)).sort() : [];
  rep = files.length ? readJSON(path.join(hist, files[files.length - 1]), null) : null;
}
if (want === 'quick' && rep && rep.quickSet && rep.quickSet.simulated) {
  console.log('STALE: the newest quick run used a pretend file list (--changed); run verify --quick without it'); process.exit(1);
}
const stale = (why) => { console.log(`STALE: ${why}`); process.exit(1); };
if (!rep) stale('no report');
if (rep.mode !== want && !(want === 'quick' && rep.mode === 'all')) stale(`latest report is mode "${rep.mode}", not ${want}`);
if (!rep.ok) stale(`latest --${rep.mode} failed: ${rep.failReason || 'see report'}`);
const finished = Date.parse(rep.finishedAt || 0);
const started = Date.parse(rep.startedAt || 0);
// Every changed or new file that can affect the game or the checks must be older than the start of the run.
const changed = execSync('git status --porcelain --untracked-files=all', { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, ''))
  .filter((f) => !/^harness\/(reports|state)\//.test(f) && !f.startsWith('assets_inbox/'));
let newest = 0, newestFile = '';
for (const f of changed) { try { const m = fs.statSync(path.join(ROOT, f)).mtimeMs; if (m > newest) { newest = m; newestFile = f; } } catch { /* deleted */ } }
const head = Date.parse(execSync('git log -1 --format=%cI', { cwd: ROOT, encoding: 'utf8' }).trim());
if (newest > started) stale(`${newestFile} changed after the run started`);
if (head > started) stale('a commit landed after the run started');
console.log(`FRESH: --${rep.mode} OK at ${rep.finishedAt} (commit ${rep.commit || '?'}) covers the current tree (${changed.length} changed files, all older than the run)`);
