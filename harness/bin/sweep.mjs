#!/usr/bin/env node
// Regression sweep (owner, 2026-10-08): run verify.mjs --all on the latest commit in a separate git worktree,
// never in the main checkout, so the builder's working tree and harness/reports/latest.json stay untouched.
// Usage: node harness/bin/sweep.mjs [--due] [--force]
//   --due    only run when at least 10 tasks were marked done since the last sweep (prints SWEEP NOT DUE otherwise)
//   --force also runs when another sweep holds the lock.
// Writes harness/reports/sweep/<sha>.json (summary) and <sha>.log, and harness/state/sweep.json (last sweep).
// Prints SWEEP OK or SWEEP FAIL with the failing scenarios and missions.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync, spawnSync } from 'node:child_process';
import { ROOT, R, readJSON } from './lib.mjs';
import { perfSummary, perfTable } from './perfgate.mjs';

const args = process.argv.slice(2);
const STATE = R('harness', 'state', 'sweep.json');
const WT = R('.worktrees', 'sweep');
const OUT = R('harness', 'reports', 'sweep');
const sh = (c, cwd = ROOT) => execSync(c, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const backlog = readJSON(R('harness', 'state', 'backlog.json'));
const doneCount = backlog.tasks.filter((t) => t.status === 'done').length;
const state = readJSON(STATE, { lastDoneCount: 0, runs: [] });
if (args.includes('--due') && doneCount - state.lastDoneCount < 10) {
  console.log(`SWEEP NOT DUE: ${doneCount - state.lastDoneCount} of 10 tasks done since the last sweep`);
  process.exit(0);
}
// owner 2026-10-13: the sweep runs alongside builders and verifiers (it used to wait for a gap). A perf or fps
// failure from an overlapping run gets one solo rerun (--only, in the worktree) before it becomes a bug.
fs.mkdirSync(OUT, { recursive: true });
const lock = path.join(OUT, '.running');
// The lock holds the sweep's pid; a lock left by a killed sweep (dead pid, or an old lock with no pid) is stale.
const lockAlive = () => { const pid = Number((fs.readFileSync(lock, 'utf8').match(/pid (\d+)/) || [])[1]); if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };
if (fs.existsSync(lock) && !args.includes('--force')) {
  if (lockAlive()) { console.log(`SWEEP BUSY: another sweep is running (${fs.readFileSync(lock, 'utf8')})`); process.exit(0); }
  console.log(`sweep: removing stale lock (${fs.readFileSync(lock, 'utf8')})`);
}

const sha = sh('git rev-parse --short HEAD');
fs.writeFileSync(lock, `${sha} since ${new Date().toISOString()} pid ${process.pid}`);
try {
  // One detached worktree, reused between sweeps. Leftovers (dist/, harness/reports/) are rebuilt by verify.
  if (!fs.existsSync(path.join(WT, '.git'))) { sh('git worktree prune'); sh(`git worktree add --detach "${WT}" ${sha}`); }
  else sh(`git checkout --detach --force ${sha}`, WT);
  // Share the main node_modules.
  const nm = path.join(WT, 'node_modules');
  if (!fs.existsSync(nm)) fs.symlinkSync(R('node_modules'), nm, 'dir');
  const started = Date.now();
  const r = spawnSync(process.execPath, [path.join(WT, 'harness', 'bin', 'verify.mjs'), '--all'], {
    cwd: WT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    // No gallery copies from the sweep; a smaller page pool so the builder's runs on the same GPU are not starved.
    env: { ...process.env, HARNESS_NO_GALLERY: '1', HARNESS_JOBS: process.env.HARNESS_JOBS || '2' },
  });
  fs.writeFileSync(path.join(OUT, `${sha}.log`), `${r.stdout || ''}\n${r.stderr || ''}`);
  const rep = readJSON(path.join(WT, 'harness', 'reports', 'latest.json'), null);
  const why = (x) => String(x.error || x.reason || x.failReason || 'failed').slice(0, 240);
  const failing = rep ? Object.entries(rep.scenarios || {}).filter(([, s]) => s && s.ok === false).map(([n, s]) => `${n}: ${why(s)}`) : ['no report written'];
  const missionsFailing = rep ? Object.entries(rep.missions || {}).filter(([, m]) => m && m.ok === false).map(([id, m]) => `${id}: ${why(m)}`) : [];
  const ok = !!rep?.ok && r.status === 0;
  // Frame time per perf scenario (P2-118): CPU and GPU ms p50, p95, max, with fps second.
  const perfRows = rep ? Object.entries(rep.scenarios || {}).filter(([, s]) => s && s.perf).map(([name, s]) => ({ name, perf: s.perf })) : [];
  const perf = Object.fromEntries(perfRows.map(({ name, perf: p }) => [name, perfSummary(p)]));
  const summary = { sha, at: new Date().toISOString(), minutes: Math.round((Date.now() - started) / 6000) / 10, ok, exit: r.status, failReason: rep?.failReason || null, failing, missionsFailing, doneCount, perf, load: { avg1: Math.round(os.loadavg()[0] * 100) / 100, cores: os.cpus().length } };
  fs.writeFileSync(path.join(OUT, `${sha}.json`), JSON.stringify(summary, null, 2));
  state.lastDoneCount = doneCount;
  state.runs = [...(state.runs || []).slice(-19), { sha, at: summary.at, ok, minutes: summary.minutes }];
  fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
  const lines = ok ? [] : [rep?.failReason, ...failing, ...missionsFailing].filter(Boolean);
  console.log(`${ok ? 'SWEEP OK' : 'SWEEP FAIL'} ${sha} in ${summary.minutes} min${lines.length ? `\n  ${lines.join('\n  ')}` : ''}\n  report: harness/reports/sweep/${sha}.json  log: harness/reports/sweep/${sha}.log${perfRows.length ? `\n  frame time (ms):\n${perfTable(perfRows).join('\n')}` : ''}`);
} finally { fs.rmSync(lock, { force: true }); }
