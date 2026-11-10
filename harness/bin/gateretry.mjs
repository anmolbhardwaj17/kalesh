#!/usr/bin/env node
// Phase gate retry (P4-101, owner 2026-10-29): proves a narrow fix after a failed verify --all without a new full run.
//   node harness/bin/gateretry.mjs P4 [--flaky some_scenario,L03] [--dry] [--anyway] [--jobs 4]
// Reads the phase's saved --all report (harness/reports/gate/<P>-all.json, saved by task.mjs gate or here) and runs, in order:
// verify --quick (builds, typecheck, unit tests); each failed scenario in one verify --only and each failed milestone in the
// milestone run (real failures); a flakecheck of 10 runs for every item named in --flaky; verify --milestone over every playable
// milestone (every play script in harness/verify/milestones, the --all set). Writes harness/reports/gate/<P>-retry.json, which task.mjs gate <P>
// reads. It never writes harness/reports/latest.json. Before running it checks rule (c): if the files changed since the
// --all commit touch a shared-system path (harness/verify/shared_paths.json) it stops and says a full verify --all is needed
// (--anyway runs it regardless; the gate still refuses). --dry prints the plan and the reasons, runs nothing.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, R, readJSON, config, writeJSON, parseArgs, nowISO, git, treeHash, TREE_RULE } from './lib.mjs';
import { GATE_DIR, FLAKE_RUNS, ensureAllCopy, retryFile, failedItems, changedSince, loadSharedPaths, sharedTouched, isMilestoneId } from './gatecheck.mjs';

const args = parseArgs(process.argv.slice(2));
const phase = args._[0];
if (!phase || args.help) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 11).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(args.help || args.h ? 0 : 1);
}
const flaky = new Set(String(args.flaky && args.flaky !== true ? args.flaky : '').split(',').map((s) => s.trim()).filter(Boolean));
const jobs = String(Math.max(1, Number(args.jobs || 4) | 0));
const VERIFY = path.join(ROOT, 'harness', 'bin', 'verify.mjs');
const FLAKE = path.join(ROOT, 'harness', 'bin', 'flakecheck.mjs');
const dir = path.join(GATE_DIR, `${phase}-retry`);
const rel = (f) => path.relative(ROOT, f);

const { rep: all, file: allFile, saved } = ensureAllCopy(phase);
if (!all) { console.log(`GATERETRY ${phase}: no --all report found (latest.json or reports/history). Run verify.mjs --all.`); process.exit(1); }
console.log(`gateretry ${phase}: full run ${rel(allFile)}${saved ? ' (saved now)' : ''}: commit ${all.commit}, ${all.startedAt}, ${all.ok ? 'OK' : 'FAIL'}`);
if (all.ok) console.log('  the full run passed: no retry needed (task.mjs gate uses it if it is newer than the last src/ commit)');

const { items, blockers } = failedItems(all);
const changed = changedSince(all.commit);
const shared = changed ? sharedTouched(changed, loadSharedPaths()) : null;
console.log(`  failed items: ${items.length ? items.map((i) => i.id).join(', ') : 'none'}`);
for (const i of items) console.log(`    ${i.id}${flaky.has(i.id.split(':')[1]) ? ' [flaky: flakecheck x' + FLAKE_RUNS + ']' : ''}: ${i.reason}`);
for (const b of blockers) console.log(`  BLOCKER: ${b}`);
if (changed === null) console.log(`  (c) cannot diff from ${all.commit}: commit not found`);
else console.log(`  (c) ${changed.length} file(s) changed since ${all.commit}; shared-system files: ${shared.length ? shared.join(', ') : 'none'}`);
for (const f of flaky) if (!items.some((i) => i.id.split(':')[1] === f)) console.log(`  note: --flaky ${f} did not fail in the full run; it is checked anyway`);

const sol = R(config().milestoneScripts);
const playable = fs.existsSync(sol) ? fs.readdirSync(sol).map((f) => (f.match(/^([A-Za-z0-9_-]+)\.js$/) || [])[1]).filter(Boolean).sort() : [];
const failedMilestones = items.filter((i) => i.id.startsWith('milestone:')).map((i) => i.id.slice(8));
const milestoneIds = [...new Set([...playable, ...failedMilestones])].sort();
const realScen = items.filter((i) => i.id.startsWith('scenario:') && !flaky.has(i.id.slice(9))).map((i) => i.id.slice(9));
const flakeList = [...new Set([...flaky, ...items.filter((i) => flaky.has(i.id.split(':')[1])).map((i) => i.id.split(':')[1])])];
const plan = [
  ['quick', [VERIFY, '--quick', '--jobs', jobs, '--report', path.join(dir, 'quick.json'), '--shots', path.join(dir, 'shots_quick')]],
  ...(realScen.length ? [['only', [VERIFY, '--only', realScen.join(','), '--no-build', '--no-checks', '--jobs', jobs, '--report', path.join(dir, 'only.json'), '--shots', path.join(dir, 'shots_only')]]] : []),
  ...(flakeList.length ? [['flake', [FLAKE, flakeList.join(','), '--runs', String(FLAKE_RUNS), '--jobs', '2', '--no-build', '--out', path.join(dir, 'flake.json')]]] : []),
  ['milestones', [VERIFY, '--milestone', milestoneIds.join(','), '--no-build', '--no-checks', '--report', path.join(dir, 'milestones.json'), '--shots', path.join(dir, 'shots_milestones')]],
];
console.log('  plan:');
for (const [k, a] of plan) console.log(`    ${k}: node ${a.map((x) => (path.isAbsolute(x) ? rel(x) : x)).join(' ')}`);

const stopReasons = [...blockers.map((b) => `the full run has a blocker: ${b}`)];
if (changed === null) stopReasons.push(`cannot diff from the full run's commit ${all.commit}`);
else if (shared.length) stopReasons.push(`the fix touches shared code since ${all.commit}: ${shared.join(', ')}`);
if (stopReasons.length) {
  console.log(`\nGATERETRY ${phase}: the retry path does not apply, run verify --all:\n${stopReasons.map((r) => `  - ${r}`).join('\n')}`);
  if (!args.anyway || args.dry) process.exit(1);
  console.log('  --anyway: running the retry regardless (the gate will still refuse it)');
}
if (args.dry) { console.log(`\nGATERETRY ${phase} --dry: nothing run`); process.exit(0); }

// ---- run ----
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const startedAt = nowISO();
const runs = [];
const env = { ...process.env, HARNESS_NO_GALLERY: '1' };
for (const [k, a] of plan) {
  const t0 = Date.now();
  console.log(`\n=== gateretry ${k} ===`);
  const r = spawnSync(process.execPath, a, { cwd: ROOT, stdio: 'inherit', env, timeout: 3 * 3600 * 1000 });
  runs.push({ step: k, status: r.status, ms: Date.now() - t0 });
  if (k === 'quick' && !readJSON(path.join(dir, 'quick.json'), null)?.checks?.build?.ok) { console.log('gateretry: the quick run did not build, stopping'); break; }
}

const quick = readJSON(path.join(dir, 'quick.json'), null);
const only = readJSON(path.join(dir, 'only.json'), null);
const flake = readJSON(path.join(dir, 'flake.json'), null);
const mis = readJSON(path.join(dir, 'milestones.json'), null);
const out = {};
for (const it of items) {
  const [kind, name] = [it.id.split(':')[0], it.id.slice(it.id.indexOf(':') + 1)];
  if (kind === 'check') { const c = quick?.checks?.[name]; out[it.id] = { kind: 'quick', ok: !!c?.ok, reason: c?.ok ? null : 'not ok in quick' }; continue; }
  if (flaky.has(name)) {
    const row = flake?.table?.[kind === 'milestone' ? `milestone ${name}` : name];
    out[it.id] = { kind: 'flake', runs: row?.runs || 0, pass: row?.pass || 0, ok: !!row && row.pass === row.runs && row.runs >= FLAKE_RUNS, reasons: row?.reasons || {} };
    continue;
  }
  const r = kind === 'milestone' ? mis?.milestones?.[name] : only?.scenarios?.[name];
  out[it.id] = { kind: 'run', ok: !!r?.ok, reason: r ? (r.ok ? null : String(r.reason || r.errors?.[0] || 'failed').slice(0, 200)) : 'did not run' };
}
// The light pass of a targeted run fails the whole report, not the scenario: a light FAIL on an item's shot fails the item.
for (const rep of [only, mis]) for (const [shot, v] of Object.entries(rep?.visibility || {})) {
  if (!['FAIL', 'ERROR'].includes(v?.verdict)) continue;
  const id = `${isMilestoneId(v.from) ? 'milestone' : 'scenario'}:${v.from}`;
  if (out[id]?.kind === 'run') Object.assign(out[id], { ok: false, reason: `shot ${path.basename(shot)} failed the light check` });
}
const retry = {
  mode: 'gateretry', phase, startedAt, finishedAt: nowISO(), commit: git('rev-parse --short HEAD') || null, tree: treeHash(), treeRule: TREE_RULE,
  allReport: rel(allFile), allCommit: all.commit, allStartedAt: all.startedAt, flaky: [...flaky], items: out,
  quick: quick ? { ok: !!quick.ok, failReason: quick.failReason || null, checks: quick.checks || {}, report: rel(path.join(dir, 'quick.json')) } : null,
  only: only ? { ok: !!only.ok, failReason: only.failReason || null } : null,
  milestones: mis ? { ids: milestoneIds, ok: !!mis.ok, failReason: mis.failReason || null, results: Object.fromEntries(Object.entries(mis.milestones || {}).map(([id, r]) => [id, { ok: !!r.ok, reason: r.reason || null }])) } : null,
  consoleErrors: { quick: quick?.consoleErrors?.length || 0, only: only?.consoleErrors?.length || 0, milestones: mis?.consoleErrors?.length || 0 },
  sharedFiles: shared || [], changedFiles: changed?.length ?? null, runs,
};
// A milestone the run never reached counts as failing.
if (retry.milestones) for (const id of milestoneIds) if (!retry.milestones.results[id]) retry.milestones.results[id] = { ok: false, reason: 'did not run' };
retry.ok = Object.values(out).every((x) => x.ok) && !!retry.quick?.ok && !!retry.milestones && Object.values(retry.milestones.results).every((x) => x.ok) && !Object.values(retry.consoleErrors).some(Boolean);
writeJSON(retryFile(phase), retry);
console.log(`\nGATERETRY ${phase}: ${retry.ok ? 'OK' : 'FAIL'}  report: ${rel(retryFile(phase))}`);
for (const [id, x] of Object.entries(out)) console.log(`  ${id}: ${x.ok ? 'ok' : 'FAIL'}${x.kind === 'flake' ? ` (flakecheck ${x.pass}/${x.runs})` : x.reason ? ` ${x.reason}` : ''}`);
console.log(`  quick: ${retry.quick?.ok ? 'ok' : `FAIL ${retry.quick?.failReason || 'no report'}`}`);
console.log(`  milestones: ${retry.milestones ? `${Object.values(retry.milestones.results).filter((x) => x.ok).length}/${milestoneIds.length} ok` : 'no report'}`);
console.log(`Next: node harness/bin/task.mjs gate ${phase}`);
process.exit(retry.ok ? 0 : 1);
