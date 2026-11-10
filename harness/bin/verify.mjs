#!/usr/bin/env node
// Verification. Builds the game, runs it in Chromium, runs scenarios, plays milestones with their play scripts.
//   node harness/bin/verify.mjs --quick            typecheck + tests + build + boot + quick scenario set (default)
//   node harness/bin/verify.mjs --milestone L03    build + boot + that milestone's play script (comma list allowed)
//   node harness/bin/verify.mjs --all              everything: checks, every scenario incl. perf, every milestone with a play script
//   node harness/bin/verify.mjs --only a,b*        typecheck + tests + build + boot + only the named scenarios (prefix* allowed)
//   --quick --dry [--changed a,b] prints the quick set and why each mapped scenario is in it, runs nothing
//   --all --dry (or --only a,b --dry) prints the run order (perf scenarios first and alone, the pool, the solo ones, milestones)
// Options: --no-build (reuse the build), --no-checks (skip typecheck and tests), --headed, --jobs N (pages side by side,
//   default 4), --repeat N (with --only: each scenario N times and a pass table; flakecheck.mjs drives it), --report <file>,
//   --shots <dir>, --query "a=1" (extra page params for milestone pages), --base-url <url> (test a served copy, no build)
// Writes harness/reports/latest.json (+ history/) and screenshots in harness/reports/shots/. Exit code 1 if not ok.
// Budgets (frame time, draw calls, triangles, GPU memory, load time) come from harness/verify/perf_budgets.json, which
// Phase 0 style discovery fills in (docs/GAME_HOOKS.md says what the game must expose for each number).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { PATHS, ROOT, R, readJSON, writeJSON, nowISO, parseArgs, git, treeHash, TREE_RULE, powerInfo, config } from './lib.mjs';
import { npmRun, startServer, launch, openPage, waitReady, debugCall, runStep } from './browser.mjs';
import { pickQuick, describePick, changedScenarioNames, useCommitFiles } from './quickset.mjs';
import { frameTimeGate, loadText, perfSummary, perfTable, runOrder } from './perfgate.mjs';
import { checkVerifyArgs, scenarioNames, milestoneIds, VERIFY_BOOLEANS } from './cliguard.mjs';
import { loadBudgets, judgeBudgets } from './perfbudget.mjs';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 15).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}
const args = parseArgs(process.argv.slice(2), { booleans: VERIFY_BOOLEANS });
{
  const chk = checkVerifyArgs(args, { scenarios: scenarioNames(ROOT), milestones: milestoneIds(ROOT) });
  if (chk.exit !== null) { console.log(chk.text); process.exit(chk.exit); }
}
const CFG = config();
const BUDGETS = loadBudgets();
const mode = args.all ? 'all' : args.milestone ? 'milestone' : args.only ? 'only' : 'quick';
const onlyPats = args.only ? String(args.only).split(',').map((x) => x.trim()).filter(Boolean) : null;
const picked = (name) => !onlyPats || onlyPats.some((p) => (p.endsWith('*') ? name.startsWith(p.slice(0, -1)) : name === p));
const REPEAT = Math.max(0, Number(args.repeat || 0) | 0);
const FC_DIR = path.join(ROOT, 'harness', 'reports', 'flakecheck');
const REPORT_OUT = args.report ? path.resolve(String(args.report)) : REPEAT ? path.join(FC_DIR, 'last.json') : PATHS.reportLatest;
const shotsDir = args.shots ? path.resolve(String(args.shots)) : REPEAT ? path.join(FC_DIR, 'shots') : PATHS.shots;
const JOBS = Math.max(1, Number(args.jobs || process.env.HARNESS_JOBS || 4) | 0);
const TIMINGS_FILE = path.join(path.dirname(PATHS.reportLatest), 'timings.json');
const SCEN_FILE = path.join(ROOT, 'harness', 'verify', 'scenarios.json');
const report = { mode, ok: false, startedAt: nowISO(), finishedAt: null, commit: git('rev-parse --short HEAD') || null, gl: null, budgets: BUDGETS.source, checks: {}, boot: null, consoleErrors: [], warnings: [], failedRequests: [], scenarios: {}, milestones: {}, failReason: null };
if (mode === 'quick' || mode === 'all') { report.tree = treeHash(); report.treeRule = TREE_RULE; }
const fail = (why) => { if (!report.failReason) report.failReason = why; };

const quickCandidate = (s) => !s.allOnly || s.quickMapped === true;

/** --quick: the core set plus the scenarios mapped to the changed files (harness/verify/quick.json, quickset.mjs). */
function quickPick(all, list) {
  const q = readJSON(path.join(ROOT, 'harness', 'verify', 'quick.json'), { core: [], areas: [] });
  let changed = [];
  let changedScenarios = [];
  const simulated = typeof args.changed === 'string';
  if (simulated) changed = args.changed.split(',').map((x) => x.trim()).filter(Boolean);
  else {
    try { changed = execSync('git status --porcelain --untracked-files=all', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, '').split(' -> ').pop()); } catch { /* not a git tree */ }
  }
  // A clean tree (a verifier's snapshot of the builder's commit) maps the last commit's files instead.
  let base = 'HEAD';
  if (!simulated && useCommitFiles(changed)) {
    try {
      const files = execSync('git show --name-only --pretty=format: HEAD', { cwd: ROOT, encoding: 'utf8' }).split('\n').map((x) => x.trim()).filter(Boolean);
      if (files.length) { console.log(`quick: no mappable change in the tree; mapping the last commit's ${files.length} files`); changed = files; base = 'HEAD~1'; }
    } catch { /* no git or no parent */ }
  }
  if (changed.includes('harness/verify/scenarios.json')) {
    try {
      const head = JSON.parse(execSync(`git show ${base}:harness/verify/scenarios.json`, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] })).scenarios || [];
      changedScenarios = changedScenarioNames(head, all);
    } catch { /* new file or no git */ }
  }
  const r = pickQuick({ quick: q, all, list, changed, changedScenarios, timings: readJSON(TIMINGS_FILE, {}), jobs: JOBS });
  report.quickSet = { core: r.core.length, changedFiles: changed.length, mappedFiles: r.mappedFiles, picked: r.picked.length, of: list.length, cap: r.cap, extras: r.extras, capped: r.capped, estSec: r.estSec, ...(simulated ? { simulated: true, changed } : {}) };
  for (const l of describePick(r, { of: list.length, changedCount: changed.length, jobs: JOBS })) console.log(l);
  return r.picked;
}

function pickScenarios() {
  const all = readJSON(SCEN_FILE, { scenarios: [] }).scenarios || [];
  const mapped = mode === 'quick' && !args.full;
  let list = all.filter((s) => (mode === 'all' || mode === 'only' || (mapped ? quickCandidate(s) : !s.allOnly)) && picked(s.name));
  if (mapped) list = quickPick(all, list);
  return list;
}

function milestoneList() {
  if (mode === 'milestone') return String(args.milestone).split(',').map((s) => s.trim()).filter(Boolean);
  if (mode !== 'all') return [];
  return milestoneIds(ROOT);
}

// perf scenarios measure in --all and --only; --quick measures only those marked `perfQuick: true` (keep one cheap one).
const measuresPerf = (sc) => !!(sc.perf && (mode === 'all' || mode === 'only' || sc.perfQuick === true));
const runsAlone = (sc) => measuresPerf(sc) || sc.solo === true;
const orderOf = (list) => runOrder(list, { measures: measuresPerf, solo: runsAlone });

if (args.dry) {
  if (mode === 'quick') { console.log(pickScenarios().map((s) => s.name).join(' ')); process.exit(0); }
  const o = orderOf(pickScenarios());
  console.log(`verify ${mode} --dry: run order`);
  console.log(`  1. perf, alone and first (${o.perf.length}): ${o.perf.map((s) => s.name).join(' ') || '-'}`);
  console.log(`  2. pool, ${JOBS} page(s) side by side (${o.pool.length}): ${o.pool.map((s) => s.name).join(' ') || '-'}`);
  console.log(`  3. alone after the pool (${o.after.length}): ${o.after.map((s) => s.name).join(' ') || '-'}`);
  const ms = milestoneList();
  if (ms.length) console.log(`  4. milestones, one at a time (${ms.length}): ${ms.join(' ')}`);
  process.exit(0);
}

function pageUrl(base, { quality, query = '' } = {}) {
  const q = [CFG.pageQuery, quality ? `quality=${encodeURIComponent(quality)}` : '', String(query || '').replace(/^[?&]+/, ''), String(process.env.HARNESS_QUERY || '').replace(/^[?&]+/, '')].filter(Boolean).join('&');
  return `${base}index.html${q ? `?${q}` : ''}`;
}

async function freshPage(browser, base, opts = {}) {
  const t0 = Date.now();
  const { page, log } = await openPage(browser, pageUrl(base, opts), { dpr: opts.dpr || 1, width: opts.viewport?.[0], height: opts.viewport?.[1] });
  const ready = await waitReady(page);
  return { page, log, ready, loadMs: Date.now() - t0 };
}

function absorb(log) {
  report.consoleErrors.push(...log.errors);
  report.warnings.push(...log.warnings.slice(0, 20));
  report.failedRequests.push(...log.failedRequests.slice(0, 20));
}

/** One perf window (debug.perf(ms), docs/GAME_HOOKS.md) with the machine load around it. */
async function measurePerf(ctx, ms) {
  const before = os.loadavg()[0];
  const r = await runStep(ctx, { perf: ms });
  if (r.ok && ctx.perf) {
    const after = os.loadavg()[0];
    ctx.perf.load = { avg1: Math.round(Math.max(before, after) * 100) / 100, cores: os.cpus().length };
    // HARNESS_PERF_STRICT=1: the GPU timer p95 over the fail budget fails on its own (perfgate.mjs).
    ctx.perf.strict = process.env.HARNESS_PERF_STRICT === '1';
  }
  return r;
}

async function runScenario(browser, base, sc, solo) {
  const t0 = Date.now();
  const { page, log, ready, loadMs } = await freshPage(browser, base, { quality: sc.quality, query: sc.query, dpr: sc.dpr, viewport: sc.viewport });
  const ctx = { page, shotsDir: sc.baseName ? path.join(shotsDir, `r${sc.name.split('#').pop()}`) : shotsDir, shots: [], perf: null };
  const res = { ok: true, shots: ctx.shots, errors: [], loadMs };
  if (!ready.ok) { res.ok = false; res.errors.push(ready.reason); }
  else {
    for (const step of sc.steps || []) {
      const r = await runStep(ctx, step);
      if (!r.ok) { res.ok = false; res.errors.push(r.error); break; }
    }
    if (ctx.scriptResult) {
      res.script = { ok: ctx.scriptResult.ok, reason: ctx.scriptResult.reason || null, log: ctx.scriptResult.log || null };
      if (ctx.scriptResult.metrics) res.metrics = ctx.scriptResult.metrics;
      if (ctx.scriptResult.summary) res.summary = ctx.scriptResult.summary;
    }
    if (res.ok && measuresPerf(sc)) {
      const power = powerInfo();
      const r = await measurePerf(ctx, sc.perfMs || BUDGETS.windowMs);
      if (r.ok) {
        res.perf = ctx.perf;
        // A fail is measured once more before it counts (a stray background job can spike one window).
        if (!report.gl.software && frameTimeGate(res.perf, BUDGETS.gateOpts).level === 'fail') {
          const first = frameTimeGate(res.perf, BUDGETS.gateOpts).p95;
          const again = await measurePerf(ctx, sc.perfMs || BUDGETS.windowMs);
          if (again.ok) { res.perf = ctx.perf; res.perf.firstP95Ms = first; }
        }
        res.perf.power = power;
      } else res.errors.push(`perf: ${r.error} (the game must expose debug.perf(ms), docs/GAME_HOOKS.md)`);
    }
  }
  if (ctx.problems?.length) { res.ok = false; res.errors.push(...ctx.problems.slice(0, 3)); }
  if (log.errors.length) { res.ok = false; res.errors.push(`${log.errors.length} console error(s)`); }
  // Budgets (perf_budgets.json): frame time, draw calls, triangles, GPU memory, per quality preset; load time on every page.
  const b = judgeBudgets({ perf: res.perf, loadMs: res.loadMs, quality: sc.quality, budgets: BUDGETS, software: !!report.gl?.software, scenario: sc });
  for (const w of b.warnings) report.warnings.push(`${sc.name}: ${w}`);
  if (b.fails.length) { res.ok = false; res.errors.push(...b.fails); }
  if (res.perf) Object.assign(res.perf, { judged: !report.gl.software, frameGate: b.frame?.level ?? null, frameP95Ms: b.frame?.p95 ?? null });
  if (!res.ok) fail(`scenario ${sc.name}: ${res.errors[0]}`);
  await page.close();
  res.ms = Date.now() - t0;
  res.parallel = !solo;
  console.log(`  scenario ${sc.name}: ${res.ok ? 'ok' : 'FAIL ' + res.errors.join('; ')}${res.perf ? ` (p95 ${b.frame?.p95 != null ? b.frame.p95.toFixed(1) : '-'} ms, ${res.perf.avgFps != null ? res.perf.avgFps.toFixed(1) : '-'} fps, ${res.perf.drawCalls ?? '-'} calls, ${res.perf.triangles != null ? Math.round(res.perf.triangles / 1000) + 'k' : '-'} tris, ${loadText(res.perf)})` : ''}`);
  for (const w of b.warnings) console.log(`    WARN ${w}`);
  return { res, log };
}

async function runScenarios(browser, base) {
  let list = pickScenarios();
  if (onlyPats && !list.length) fail(`--only matched no scenario: ${onlyPats.join(',')}`);
  if (REPEAT) list = list.flatMap((s) => (runsAlone(s) ? [s] : Array.from({ length: REPEAT }, (_, k) => ({ ...s, name: `${s.name}#${k + 1}`, baseName: s.name }))));
  const hints = readJSON(TIMINGS_FILE, {});
  const { perf, pool, after } = orderOf(list);
  const done = new Map();
  if (perf.length) console.log(`  perf first, alone (${perf.length}): ${perf.map((s) => s.name).join(' ')}`);
  for (const sc of perf) done.set(sc.name, await runScenario(browser, base, sc, true));
  const hint = (s) => hints[s.baseName || s.name] || 0;
  const round = (s) => (s.baseName ? Number(s.name.split('#').pop()) : 0);
  const queue = pool.map((s, i) => ({ s, i })).sort((a, b) => round(a.s) - round(b.s) || hint(b.s) - hint(a.s) || a.i - b.i);
  const jobs = Math.min(JOBS, queue.length);
  const worker = async () => { while (queue.length) { const { s } = queue.shift(); done.set(s.name, await runScenario(browser, base, s, jobs <= 1)); } };
  await Promise.all(Array.from({ length: jobs }, worker));
  for (const sc of after) done.set(sc.name, await runScenario(browser, base, sc, true));
  for (const sc of list) { const d = done.get(sc.name); if (!d) continue; absorb(d.log); report.scenarios[sc.name] = d.res; }
  if (!REPEAT) try { const t = { ...hints }; for (const [n, d] of done) t[n] = d.res.ms; writeJSON(TIMINGS_FILE, t); } catch { /* optional */ }
}

/** A milestone run: a fresh page, then its play script (harness/verify/milestones/<id>.js) with a long budget. */
async function runMilestone(browser, base, id) {
  const t0 = Date.now();
  const { page, log, ready, loadMs } = await freshPage(browser, base, { query: typeof args.query === 'string' ? args.query : '' });
  const res = { ok: false, ms: 0, reason: null, shots: [], loadMs };
  const ctx = { page, shotsDir, shots: res.shots, perf: null };
  const meta = (readJSON(PATHS.milestones, { milestones: [] }).milestones || []).find((m) => m.id === id) || {};
  try {
    if (!ready.ok) throw new Error(ready.reason);
    await runStep(ctx, { shot: `${id}_start` });
    const script = path.join(CFG.milestoneScripts, `${id}.js`);
    const r = await runStep(ctx, { script, timeout: Number(meta.budgetMs || 300000), data: meta.data || undefined });
    const v = ctx.scriptResult || {};
    res.ok = r.ok; res.reason = r.ok ? null : r.error; res.log = Array.isArray(v.log) ? v.log.slice(-30) : null;
    if (v.summary) res.summary = v.summary;
    await runStep(ctx, { shot: `${id}_end` });
  } catch (e) {
    res.ok = false; res.reason = String(e.message || e);
    try { await runStep(ctx, { shot: `${id}_error` }); } catch { /* ignore */ }
  }
  if (ctx.problems?.length) { res.ok = false; res.reason = res.reason || ctx.problems[0]; }
  res.consoleErrors = log.errors.length;
  if (log.errors.length) { res.ok = false; res.reason = res.reason || `${log.errors.length} console error(s)`; }
  absorb(log);
  res.ms = Date.now() - t0;
  report.milestones[id] = res;
  if (!res.ok) fail(`${CFG.milestoneWord} ${id}: ${res.reason}`);
  console.log(`  ${CFG.milestoneWord} ${id}: ${res.ok ? 'ok' : 'FAIL ' + res.reason} (${Math.round(res.ms / 1000)} s)`);
  await page.close();
}

async function main() {
  fs.mkdirSync(shotsDir, { recursive: true });
  console.log(`verify ${mode}${mode === 'milestone' ? ' ' + args.milestone : ''}${mode === 'only' ? ' ' + onlyPats.join(',') : ''}`);
  const BASE_URL = typeof args['base-url'] === 'string' ? String(args['base-url']).replace(/\/?$/, '/') : null;
  const steps = BASE_URL ? [] : mode === 'milestone' || args['no-checks'] ? ['build'] : ['typecheck', 'test', 'build'];
  if (args['no-build'] && steps.includes('build')) steps.splice(steps.indexOf('build'), 1);
  for (const s of steps) {
    const r = npmRun(s, s === 'test' ? { timeoutMs: 1200000 } : {});
    report.checks[s] = r;
    console.log(`  ${s}: ${!r.ran ? 'skipped (' + r.tail + ')' : r.ok ? `ok (${Math.round(r.ms / 1000)} s)` : 'FAIL'}`);
    if (!r.ran && s === 'build') fail('package.json has no "build" script');
    if (r.ran && !r.ok) fail(`${s} failed:\n${r.tail}`);
  }
  if (!BASE_URL && !report.failReason && !fs.existsSync(R(CFG.buildDir, 'index.html'))) fail(`${CFG.buildDir}/index.html does not exist after the build`);
  if (report.failReason) return;
  const server = BASE_URL ? { url: BASE_URL, close: async () => undefined } : await startServer();
  let browser;
  try {
    const l = await launch({ headed: !!args.headed });
    browser = l.browser; report.gl = l.gl; report.perfJudged = !l.gl.software;
    console.log(`  webgl: ${l.gl.renderer}${l.gl.software ? ' (software: perf not judged)' : ''}`);
    // Boot: the page loads and window.__game.ready turns true. Its load time is judged against the budget.
    const { page, log, ready, loadMs } = await freshPage(browser, server.url);
    report.boot = { ok: ready.ok, ms: loadMs, reason: ready.reason || null };
    const ctx = { page, shotsDir, shots: [], perf: null };
    await runStep(ctx, { shot: 'boot' });
    report.boot.shots = ctx.shots;
    if (ready.ok) {
      const st = await debugCall(page, 'state', [], 10000);
      report.boot.state = st.ok ? st.value : st.error;
      report.version = await page.evaluate(() => window.__game && window.__game.version).catch(() => null);
    }
    const bb = judgeBudgets({ loadMs, budgets: BUDGETS, software: !!l.gl.software });
    for (const w of bb.warnings) report.warnings.push(`boot: ${w}`);
    if (bb.fails.length) { report.boot.ok = false; report.boot.reason = bb.fails[0]; }
    absorb(log);
    console.log(`  boot: ${report.boot.ok ? 'ok' : 'FAIL ' + report.boot.reason} (${loadMs} ms to ready)`);
    await page.close();
    if (!report.boot.ok) { fail(`boot: ${report.boot.reason}`); return; }
    if (mode !== 'milestone') await runScenarios(browser, server.url);
    const ms = milestoneList();
    if (mode === 'all') report.milestonesExpected = ms;
    for (const id of ms) await runMilestone(browser, server.url, id);
  } catch (e) {
    fail(String(e.message || e));
  } finally {
    try { await browser?.close(); } catch { /* ignore */ }
    await server.close();
  }
}

function printRepeat() {
  const by = new Map();
  for (const [n, r] of Object.entries(report.scenarios)) {
    const base = n.split('#')[0];
    const row = by.get(base) || { runs: 0, pass: 0, reasons: new Map(), ms: [] };
    row.runs++; if (r.ok) row.pass++; else { const k = String(r.errors?.[0] ?? 'failed').slice(0, 160); row.reasons.set(k, (row.reasons.get(k) || 0) + 1); }
    row.ms.push(r.ms || 0); by.set(base, row);
  }
  report.repeat = { runs: REPEAT, jobs: JOBS, table: Object.fromEntries([...by].map(([n, r]) => [n, { pass: r.pass, runs: r.runs, reasons: Object.fromEntries(r.reasons), msMax: Math.max(...r.ms) }])) };
  console.log(`\n  FLAKECHECK (${REPEAT} runs each, --jobs ${JOBS})`);
  for (const [n, r] of by) {
    console.log(`    ${n.padEnd(28)} ${`${r.pass}/${r.runs}`.padEnd(6)} ${(Math.max(...r.ms) / 1000).toFixed(1)} s${r.pass < r.runs ? '  FLAKY' : ''}`);
    for (const [why, c] of r.reasons) console.log(`      ${c}x ${why}`);
  }
}

function finish() {
  const rows = Object.entries(report.scenarios).filter(([, r]) => r?.perf).map(([name, r]) => ({ name, perf: r.perf }));
  if (rows.length) {
    report.perfSummary = Object.fromEntries(rows.map(({ name, perf }) => [name, perfSummary(perf)]));
    console.log(`\n  FRAME TIME (ms; budgets from ${BUDGETS.source}: p95 warn ${BUDGETS.frameMsWarn}, fail ${BUDGETS.frameMsFail})`);
    for (const l of perfTable(rows)) console.log(l);
  }
  if (REPEAT) printRepeat();
  if (report.consoleErrors.length) fail(`${report.consoleErrors.length} console error(s), first: ${report.consoleErrors[0].text}`);
  report.ok = !report.failReason;
  report.finishedAt = nowISO();
  report.durationMs = Date.parse(report.finishedAt) - Date.parse(report.startedAt);
  report.consoleErrors = report.consoleErrors.slice(0, 50);
  report.failedRequests = [...new Set(report.failedRequests)].slice(0, 30);
  writeJSON(REPORT_OUT, report);
  const nM = Object.keys(report.milestones).length;
  const okM = Object.values(report.milestones).filter((m) => m.ok).length;
  if (REPORT_OUT === PATHS.reportLatest) {
    fs.mkdirSync(PATHS.reportHistory, { recursive: true });
    writeJSON(path.join(PATHS.reportHistory, `${report.finishedAt.replace(/[:.]/g, '-')}-${mode}.json`), report);
    const hist = fs.readdirSync(PATHS.reportHistory).sort();
    for (const f of hist.slice(0, Math.max(0, hist.length - 40))) fs.unlinkSync(path.join(PATHS.reportHistory, f));
  }
  console.log(`\nVERIFY ${mode.toUpperCase()}${REPEAT ? ` x${REPEAT}` : ''}: ${report.ok ? 'OK' : 'FAIL'}${nM ? `  ${CFG.milestoneWord}s ${okM}/${nM}` : ''}  scenarios ${Object.values(report.scenarios).filter((s) => s.ok).length}/${Object.keys(report.scenarios).length}  console errors ${report.consoleErrors.length}`);
  if (!report.ok) console.log(`reason: ${report.failReason}`);
  console.log(`report: ${path.relative(ROOT, REPORT_OUT)}   screenshots: ${path.relative(ROOT, shotsDir)}/`);
  process.exitCode = report.ok ? 0 : 1;
}

main().then(finish, (e) => { fail(String(e.stack || e)); finish(); });
