// Phase gate paths (P4-101, owner 2026-10-29). A gate passes on one of two paths:
//   full run:  the saved verify --all report for the phase (harness/reports/gate/<P>-all.json) is ok and newer than src/.
//   retry:     (a) a saved --all report exists; (b) a newer retry report (harness/reports/gate/<P>-retry.json, written by
//              gateretry.mjs) at the current tree shows every item that failed in (a) passing (a flaky item 10 of 10 in a
//              flakecheck, a real failure in its own --only or --milestone run), verify --quick ok and every playable milestone
//              ok; (c) the files changed since the --all commit touch no shared-system path (harness/verify/shared_paths.json).
// If (c) fails the full --all is needed as before. The pure parts below are tested in gatecheck.test.mjs; task.mjs gate
// and gateretry.mjs do the file and git work.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, PATHS, readJSON, writeJSON, git, nowISO } from './lib.mjs';

export const GATE_DIR = path.join(ROOT, 'harness', 'reports', 'gate');
export const SHARED_PATHS_FILE = path.join(ROOT, 'harness', 'verify', 'shared_paths.json');
export const FLAKE_RUNS = 10;
export const allCopyFile = (phase) => path.join(GATE_DIR, `${phase}-all.json`);
export const retryFile = (phase) => path.join(GATE_DIR, `${phase}-retry.json`);
/** Milestone ids look like L01, M07, BOSS1: capitals and digits (cliguard.mjs isMilestoneName). */
export const isMilestoneId = (n) => /^[A-Z][A-Z0-9_-]*\d[A-Z0-9_-]*$/.test(String(n)) || /^[A-Z]{3,}$/.test(String(n));

const t = (r) => Date.parse(r?.finishedAt || r?.startedAt || 0) || 0;

/** Shared-system path list: entries ending in "/" (or naming a folder) match everything under them; others match one file. */
export function loadSharedPaths(file = SHARED_PATHS_FILE) { return readJSON(file, { shared: [] }).shared || []; }

export function matchesShared(file, patterns) {
  const f = String(file).replace(/^\.\//, '');
  return patterns.some((p) => {
    const q = String(p).replace(/^\.\//, '');
    if (q.endsWith('/')) return f.startsWith(q);
    return f === q || f.startsWith(q + '/');
  });
}

export function sharedTouched(files, patterns) { return [...new Set(files)].filter((f) => matchesShared(f, patterns)).sort(); }

/**
 * The items a full report failed on: `scenario:<name>`, `milestone:<id>`, `check:<typecheck|test|build>`, plus scenarios
 * and milestones with a shot the light pass failed. `blockers` are failures a retry cannot stand in for (boot failed, or
 * the report failed with no named item, so we cannot tell what to rerun).
 */
export function failedItems(rep) {
  const items = new Map();
  const blockers = [];
  if (!rep) return { items: [], blockers: ['no full report'] };
  for (const [name, c] of Object.entries(rep.checks || {})) if (c && c.ran && !c.ok) items.set(`check:${name}`, `${name} failed`);
  if (rep.boot && !rep.boot.ok) blockers.push(`boot failed: ${rep.boot.reason || 'see report'}`);
  for (const [name, r] of Object.entries(rep.scenarios || {})) if (r && !r.ok) items.set(`scenario:${name}`, String(r.errors?.[0] || r.reason || 'failed').slice(0, 200));
  for (const [id, r] of Object.entries(rep.milestones || {})) if (r && !r.ok) items.set(`milestone:${id}`, String(r.reason || 'failed').slice(0, 200));
  for (const [shot, v] of Object.entries(rep.visibility || {})) {
    if (!v || !['FAIL', 'ERROR'].includes(v.verdict) || !v.from) continue;
    const key = `${isMilestoneId(v.from) ? 'milestone' : 'scenario'}:${v.from}`;
    if (!items.has(key)) items.set(key, `shot ${path.basename(shot)} failed the light check`);
  }
  for (const id of rep.milestonesExpected || []) if (!rep.milestones?.[id]) items.set(`milestone:${id}`, 'never ran in the full report');
  if (!rep.ok && !items.size && !blockers.length) blockers.push(`the full run failed with no named item: ${rep.failReason || 'unknown'}`);
  return { items: [...items].map(([id, reason]) => ({ id, reason })), blockers };
}

/** Full-run path reasons (empty = the full run passes). `milestoneReasonsFn(results)` checks the phase's milestones. */
export function fullRunReasons(rep, { srcCommitMs = 0, milestoneReasonsFn = () => [] } = {}) {
  const reasons = [];
  if (!rep) return ['No full verify report for this phase: run node harness/bin/verify.mjs --all'];
  if (rep.mode !== 'all') reasons.push(`The report is mode "${rep.mode}", the gate needs a full run (verify.mjs --all)`);
  if (!rep.ok) reasons.push(`The full run is not ok: ${rep.failReason || 'see the report'}`);
  if ((rep.consoleErrors || []).length) reasons.push(`${rep.consoleErrors.length} console error(s) in the full run`);
  if (srcCommitMs && t(rep) < srcCommitMs) reasons.push('The full run is older than the last commit touching src/: re-run verify.mjs --all, or use the retry path');
  reasons.push(...milestoneReasonsFn(rep.milestones || {}));
  return reasons;
}

/** Is one retried item proven? Returns null when it is, else the reason. */
export function itemProof(id, entry, retry) {
  if (id.startsWith('check:')) {
    const c = retry?.quick?.checks?.[id.slice(6)];
    return c?.ok ? null : `${id}: not ok in the retry's verify --quick`;
  }
  if (!entry) return `${id}: missing from the retry`;
  if (entry.kind === 'flake') {
    if ((entry.runs || 0) < FLAKE_RUNS) return `${id}: flaky item needs a flakecheck of ${FLAKE_RUNS} runs, got ${entry.runs || 0}`;
    if (entry.pass !== entry.runs) return `${id}: flakecheck ${entry.pass}/${entry.runs}`;
    return null;
  }
  if (!entry.ok) return `${id}: still failing in its ${id.startsWith('milestone:') ? '--milestone' : '--only'} run: ${entry.reason || 'failed'}`;
  return null;
}

/**
 * Retry path decision. Inputs are plain data so tests need no git:
 *   all       the saved --all report            retry    the retry report (gateretry.mjs) or null
 *   changed   files changed since all.commit     shared   shared-path patterns
 *   tree      the current tree hash (lib.treeHash) or null to skip that check
 *   milestoneReasonsFn(results)  the phase's milestone rule applied to the retry's milestone results; phase names the hint
 * Returns { ok, reasons, sharedFiles, retried } where retried lists "<id> <proof>" lines for the print.
 */
export function decideRetry({ all, retry, changed = [], shared = [], tree = null, milestoneReasonsFn = () => [], phase = '<P>' }) {
  const reasons = [];
  if (!all) return { ok: false, reasons: ['(a) no saved --all report for this phase'], sharedFiles: [], retried: [] };
  if (all.mode !== 'all') reasons.push(`(a) the saved report is mode "${all.mode}", not a full run`);
  const sharedFiles = sharedTouched(changed, shared);
  if (sharedFiles.length) reasons.push(`(c) the fix touches shared code since the full run at ${all.commit}, so verify --all is needed: ${sharedFiles.join(', ')}`);
  const { items, blockers } = failedItems(all);
  for (const b of blockers) reasons.push(`(a) ${b}: a retry cannot stand in, run verify --all`);
  if (!retry) {
    reasons.push(`(b) no retry report yet: run node harness/bin/gateretry.mjs ${phase}${items.length ? ` (it reruns ${items.map((i) => i.id).join(', ')})` : ''}`);
    return { ok: false, reasons, sharedFiles, retried: [] };
  }
  if (retry.allCommit !== all.commit || retry.allStartedAt !== all.startedAt) reasons.push(`(b) the retry was made against another full run (${retry.allCommit} ${retry.allStartedAt}), not ${all.commit} ${all.startedAt}`);
  if (t(retry) <= t(all)) reasons.push('(b) the retry report is not newer than the full run');
  if (tree && retry.tree && retry.tree !== tree) reasons.push(`(b) the retry ran on another tree (${String(retry.tree).slice(0, 8)}, now ${String(tree).slice(0, 8)}): code changed since, run gateretry.mjs again`);
  if (tree && !retry.tree) reasons.push('(b) the retry report has no tree hash');
  const retried = [];
  for (const it of items) {
    const e = retry.items?.[it.id];
    const why = itemProof(it.id, e, retry);
    if (why) reasons.push(`(b) ${why}`);
    else retried.push(`${it.id}: ${it.id.startsWith('check:') ? 'ok in quick' : e.kind === 'flake' ? `flakecheck ${e.pass}/${e.runs}` : `ok in its ${it.id.startsWith('milestone:') ? '--milestone' : '--only'} run`}`);
  }
  if (!retry.quick) reasons.push('(b) the retry has no verify --quick result');
  else if (!retry.quick.ok) reasons.push(`(b) verify --quick failed: ${retry.quick.failReason || 'see its report'}`);
  if (!retry.milestones?.results) reasons.push('(b) the retry has no --milestone results');
  else {
    reasons.push(...milestoneReasonsFn(retry.milestones.results).map((r) => `(b) ${r}`));
    const bad = Object.entries(retry.milestones.results).filter(([, r]) => !r?.ok).map(([id]) => id);
    if (bad.length) reasons.push(`(b) milestones failing in the retry: ${bad.join(', ')}`);
  }
  for (const [k, n] of Object.entries(retry.consoleErrors || {})) if (n) reasons.push(`(b) ${n} console error(s) in the retry's ${k} run`);
  return { ok: !reasons.length, reasons: [...new Set(reasons)], sharedFiles, retried };
}

// ---------- file and git helpers (not pure) ----------

/** Files changed between a commit and the working tree (tracked changes plus untracked files). */
export function changedSince(commit) {
  if (!commit) return null;
  if (!git(`rev-parse --verify --quiet ${commit}^{commit}`)) return null;
  const tracked = git(`diff --name-only ${commit}`).split('\n').filter(Boolean);
  const untracked = git('ls-files --others --exclude-standard').split('\n').filter(Boolean);
  return [...new Set([...tracked, ...untracked])].sort();
}

function newestAllInHistory() {
  try {
    const f = fs.readdirSync(PATHS.reportHistory).filter((x) => x.endsWith('-all.json')).sort().pop();
    return f ? { rep: readJSON(path.join(PATHS.reportHistory, f), null), from: path.join(PATHS.reportHistory, f) } : null;
  } catch { return null; }
}

/**
 * Keep the phase's --all report safe from later runs: whenever latest.json (or, with no copy yet, the newest history
 * --all report) is a full run newer than the saved copy, save it as harness/reports/gate/<P>-all.json. Returns the copy.
 */
export function ensureAllCopy(phase) {
  const file = allCopyFile(phase);
  const saved = readJSON(file, null);
  const cands = [];
  const latest = readJSON(PATHS.reportLatest, null);
  if (latest?.mode === 'all') cands.push({ rep: latest, from: PATHS.reportLatest });
  if (!saved) { const h = newestAllInHistory(); if (h?.rep?.mode === 'all') cands.push(h); }
  const best = cands.sort((a, b) => t(b.rep) - t(a.rep))[0];
  if (best && (!saved || t(best.rep) > t(saved))) {
    const copy = { ...best.rep, savedAt: nowISO(), savedFrom: path.relative(ROOT, best.from), commitFull: git(`rev-parse ${best.rep.commit}`) || null };
    writeJSON(file, copy);
    return { rep: copy, file, saved: true };
  }
  return { rep: saved, file, saved: false };
}
