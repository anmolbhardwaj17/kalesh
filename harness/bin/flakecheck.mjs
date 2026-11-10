#!/usr/bin/env node
// Flake check (P2-093): runs a list of scenarios N times each and prints how often each one passed.
//   node harness/bin/flakecheck.mjs boot_title,camera_follow --runs 10 --jobs 2 --load 2
// Options: --runs N (default 10), --jobs N (pages side by side, default 2), --load N (a second verify with N pages runs
// heavy scenarios over and over in another browser while the check runs, so the GPU and CPU are shared; default 0),
// --load-set a,b (scenarios for the load run), --no-build (reuse dist; the default builds once first). Every run's shots are
// measured (P2B-105, shots/r<k>/): a lightcheck FAIL fails that run, --min-mean N also fails a run with a shot under N.
// A milestone id in the list (M07, TEST; P2-180) runs `verify --milestone <id>` N times, --jobs at a time, beside the scenarios.
// It never runs typecheck or the unit tests (use npm test), never writes harness/reports/latest.json: the report is
// harness/reports/flakecheck/last.json (the load run is stopped at the end and keeps no report). Exit 1 if any run failed.
// --out <file> (P4-101) also writes the whole pass table, scenarios and milestones, as JSON (gateretry.mjs reads it).
// Names are comma or space separated. An unknown name or flag exits 2 with close matches before anything builds (P5-089).
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, readJSON, writeJSON, parseArgs, nowISO, git } from './lib.mjs';
import { checkFlakeArgs, scenarioNames, milestoneIds, isMilestoneName as isMilestone, FLAKE_BOOLEANS } from './cliguard.mjs';

const args = parseArgs(process.argv.slice(2), { booleans: FLAKE_BOOLEANS });
if (args.help || args.h || !args._.length) {
  console.log(String((await import('node:fs')).readFileSync(new URL(import.meta.url), 'utf8')).split('\n').slice(1, 12).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(args.help || args.h ? 0 : 1);
}
// P5-089: unknown scenario names (or prefix*), milestone ids with no solution script and unknown flags stop here, exit 2,
// with close matches, before the build (verify --only used to skip an unknown name silently).
{
  const chk = checkFlakeArgs(args, { scenarios: scenarioNames(ROOT), milestones: milestoneIds(ROOT) });
  if (chk.exit !== null) { console.log(chk.text); process.exit(chk.exit); }
}
const names = args._.join(',').split(',').map((s) => s.trim()).filter(Boolean);
const list = names.filter((n) => !isMilestone(n)).join(',');
const milestones = names.filter(isMilestone);
const runs = Math.max(1, Number(args.runs || 10) | 0);
const jobs = Math.max(1, Number(args.jobs || 2) | 0);
const load = Math.max(0, Number(args.load || 0) | 0);
// The default load set: every scenario marked `"load": true` in scenarios.json (heavy ones), else the first four.
const loadDefault = (() => { try { const all = readJSON(path.join(ROOT, 'harness', 'verify', 'scenarios.json'), { scenarios: [] }).scenarios; const marked = all.filter((s) => s.load === true).map((s) => s.name); return (marked.length ? marked : all.slice(0, 4).map((s) => s.name)).join(','); } catch { return ''; } })();
const loadSet = String(args['load-set'] || loadDefault);
const verify = path.join(ROOT, 'harness', 'bin', 'verify.mjs');
const fcDir = path.join(ROOT, 'harness', 'reports', 'flakecheck');

if (!args['no-build']) {
  console.log('flakecheck: building once');
  const b = spawnSync('npm', ['run', '-s', 'build'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (b.status !== 0) { console.log(`${b.stdout || ''}${b.stderr || ''}`.split('\n').slice(-30).join('\n')); console.log('flakecheck: build failed'); process.exit(1); }
}

// The load run: its own browser, its own report and shots folder, repeated far more often than needed; stopped at the end.
let loader = null;
if (load) {
  console.log(`flakecheck: load run of ${loadSet} on ${load} page(s)`);
  loader = spawn(process.execPath, [verify, '--only', loadSet, '--repeat', '500', '--jobs', String(load), '--no-build', '--no-checks', '--report', path.join(fcDir, 'load.json'), '--shots', path.join(fcDir, 'load_shots')], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, HARNESS_NO_GALLERY: '1' } });
}

const t0 = Date.now();
const main = list ? spawnSync(process.execPath, [verify, '--only', list, '--repeat', String(runs), '--jobs', String(jobs), '--no-build', '--no-checks', ...(args['min-mean'] != null ? ['--min-mean', String(args['min-mean'])] : [])], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, HARNESS_NO_GALLERY: '1' } }) : { status: 0 };
const rep = list ? readJSON(path.join(fcDir, 'last.json'), null) : null;
const table = { ...(rep?.repeat?.table || {}) };
// Milestones (P2-180): each run is its own verify --milestone (own browser and report), --jobs of them side by side.
for (const id of milestones) {
  const row = { pass: 0, runs: 0, reasons: {} };
  const one = (k) => new Promise((resolve) => {
    const out = path.join(fcDir, `milestone_${id}_${k}.json`);
    const ch = spawn(process.execPath, [verify, '--milestone', id, '--no-build', '--no-checks', '--report', out, '--shots', path.join(fcDir, `milestone_shots_${k}`)], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, HARNESS_NO_GALLERY: '1' } });
    ch.on('exit', () => {
      const r = readJSON(out, null)?.milestones?.[id];
      row.runs++;
      if (r?.ok) row.pass++;
      else {
        const why = String(r?.reason ?? 'no report').slice(0, 200);
        row.reasons[why] = (row.reasons[why] || 0) + 1;
      }
      console.log(`  milestone ${id} run ${k}: ${r?.ok ? 'ok' : `FAIL ${r?.reason ?? 'no report'}`}`);
      resolve();
    });
  });
  const queue = Array.from({ length: runs }, (_, k) => k + 1);
  await Promise.all(Array.from({ length: Math.min(jobs, runs) }, async () => { while (queue.length) await one(queue.shift()); }));
  table[`milestone ${id}`] = row;
  console.log(`  milestone ${id}: ${row.pass}/${row.runs}${Object.keys(row.reasons).length ? ` ${JSON.stringify(row.reasons)}` : ''}`);
}
if (loader) { loader.kill('SIGTERM'); }
let bad = 0;
for (const r of Object.values(table)) if (r.pass < r.runs) bad++;
if (args.out && args.out !== true) writeJSON(path.resolve(String(args.out)), { finishedAt: nowISO(), commit: git('rev-parse --short HEAD') || null, runs, jobs, load, ok: !bad && !main.status, table });
console.log(`\nFLAKECHECK ${bad || main.status ? 'FAIL' : 'OK'}: ${Object.keys(table).length} scenarios x ${runs} runs, --jobs ${jobs}${load ? `, load ${load} page(s) running ${loadSet}` : ''}, ${Math.round((Date.now() - t0) / 1000)} s`);
process.exit(bad || main.status ? 1 : 0);
