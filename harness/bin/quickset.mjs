// Picks the scenarios of `verify --quick` (P2-167): the core set from harness/verify/quick.json plus at most `maxExtras`
// scenarios mapped to the changed files, the most specific first. Pure logic, no git or file access, so vitest covers it
// (quickset.test.mjs); verify.mjs gathers the changed files and calls pickQuick.
//
// Rules (also in harness/design/VERIFY.md "Quick set" and docs/ARCHITECTURE.md "Tooling"):
// - An area `path` is a prefix of the changed file ("src/actors/player/camera" matches cameraRig.ts and cameraFollow.ts).
//   A file uses ONLY its most specific areas (the longest matching path), so a broad fallback area never adds its list
//   on top of a narrow one.
// - Test files (*.test.ts, *.test.mjs) map to nothing: npm test covers them and they do not ship.
// - A changed harness/verify/scripts/<name>.js adds every scenario whose steps use it; a scenarios.json entry that differs
//   from HEAD adds that scenario. Both rank above any area.
// - Scenario names in an area may end in * (a prefix). Exact names rank above names a * expanded to.
// - Ranking of the extras: specificity (path length), exact before *, more changed files pointing at it, then first seen.
//   The first `maxExtras` run, the rest are printed as skipped by the cap.

export const DEFAULT_MAX_EXTRAS = 12;
const SPEC_SCRIPT = 1000;

/** Files that ship or drive checks; test files and harness state map to nothing. */
export function isMappable(file) {
  if (/\.test\.(ts|mts|js|mjs)$/.test(file)) return false;
  // P5-042 attempt 2: harness/look_proof/ holds proof outputs (sheets, PNGs, JSON a run writes): a verifier snapshot kept 59
  // stale untracked ones, which hid the commit's files from `--quick`. A look change maps through its src/ files.
  if (/^harness\/(state|reports|requests|look_proof)\//.test(file)) return false;
  return true;
}

/**
 * P5-042: a tree with no mappable change (a verifier's snapshot of a builder's commit, `.worktrees/verify`: its git status
 * is clean) maps the files of its last commit instead, so the task's own scenarios are in the verifier's quick run too.
 * Returns true when `changed` (git status) has nothing to map.
 */
export function useCommitFiles(changed) {
  return !changed.some(isMappable);
}

/** The areas whose path is the longest prefix of `file` (all of them when several share that length). */
export function areasFor(file, areas) {
  let best = -1;
  let hits = [];
  for (const a of areas) {
    if (!file.startsWith(a.path)) continue;
    if (a.path.length > best) { best = a.path.length; hits = [a]; } else if (a.path.length === best) hits.push(a);
  }
  return hits;
}

const nameRe = (p) => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');

/** Names of scenarios whose entry differs between two scenarios.json lists (new ones count as changed). */
export function changedScenarioNames(headList, nowList) {
  const head = new Map((headList || []).map((s) => [s.name, JSON.stringify(s)]));
  return (nowList || []).filter((s) => head.get(s.name) !== JSON.stringify(s)).map((s) => s.name);
}

/**
 * @param {object} o
 * @param {{core: string[], areas: {path: string, scenarios: string[]}[], maxExtras?: number}} o.quick  quick.json
 * @param {{name: string, steps?: unknown[]}[]} o.all   every scenario (scenarios.json), used to find script users
 * @param {{name: string}[]} o.list                     the candidates (not allOnly), in scenarios.json order
 * @param {string[]} o.changed                          changed files, repo relative
 * @param {string[]} [o.changedScenarios]               scenarios whose scenarios.json entry changed
 * @param {Record<string, number>} [o.timings]          last wall ms per scenario (harness/reports/timings.json)
 * @param {number} [o.jobs]                             pages side by side, for the time estimate
 * @param {number} [o.maxExtras]                        overrides quick.maxExtras
 */
export function pickQuick({ quick, all, list, changed, changedScenarios = [], timings = {}, jobs = 4, maxExtras }) {
  const cap = Number.isFinite(maxExtras) ? maxExtras : Number.isFinite(quick.maxExtras) ? quick.maxExtras : DEFAULT_MAX_EXTRAS;
  const names = list.map((s) => s.name);
  const inList = new Set(names);
  const coreRes = (quick.core || []).map(nameRe);
  const core = names.filter((n) => coreRes.some((r) => r.test(n)));
  const coreSet = new Set(core);
  const missingCore = (quick.core || []).filter((c) => !c.includes('*') && !inList.has(c));

  /** name -> {spec, exact, files:Set, why, order} */
  const cand = new Map();
  let order = 0;
  const offer = (name, spec, exact, file, why) => {
    if (!inList.has(name) || coreSet.has(name)) return;
    const c = cand.get(name);
    if (!c) { cand.set(name, { name, spec, exact, files: new Set([file]), why, order: order++ }); return; }
    c.files.add(file);
    if (spec > c.spec || (spec === c.spec && exact && !c.exact)) { c.spec = spec; c.exact = exact; c.why = why; }
  };
  const mapped = changed.filter(isMappable);
  for (const name of changedScenarios) offer(name, SPEC_SCRIPT + 1, true, 'harness/verify/scenarios.json', 'its scenarios.json entry changed');
  for (const f of mapped) {
    const m = f.match(/^harness\/verify\/scripts\/([^/]+\.js)$/);
    if (m) {
      for (const s of all) if (JSON.stringify(s.steps || []).includes(`scripts/${m[1]}`)) offer(s.name, SPEC_SCRIPT, true, f, `uses ${m[1]}`);
      continue;
    }
    for (const a of areasFor(f, quick.areas || [])) {
      for (const p of a.scenarios) {
        if (p.includes('*')) {
          const r = nameRe(p);
          for (const n of names) if (r.test(n)) offer(n, a.path.length, false, f, `${f} (area ${a.path}, ${p})`);
        } else offer(p, a.path.length, true, f, `${f} (area ${a.path})`);
      }
    }
  }
  const ranked = [...cand.values()].sort((x, y) => y.spec - x.spec || Number(y.exact) - Number(x.exact) || y.files.size - x.files.size || x.order - y.order);
  const extras = ranked.slice(0, Math.max(0, cap));
  const capped = ranked.slice(Math.max(0, cap));
  const chosen = new Set([...core, ...extras.map((e) => e.name)]);
  const picked = list.filter((s) => chosen.has(s.name));
  const ms = picked.map((s) => timings[s.name] || 0);
  const sum = ms.reduce((a, b) => a + b, 0);
  const longest = picked.reduce((best, s) => ((timings[s.name] || 0) > (timings[best?.name] || 0) ? s : best), null);
  const estSec = Math.round(Math.max(longest ? timings[longest.name] || 0 : 0, sum / Math.max(1, jobs)) / 1000);
  return {
    picked,
    core,
    missingCore,
    extras: extras.map((e) => ({ name: e.name, why: e.why, files: e.files.size })),
    capped: capped.map((e) => e.name),
    mappedFiles: mapped.length,
    estSec,
    longest: longest ? { name: longest.name, sec: Math.round((timings[longest.name] || 0) / 1000) } : null,
    cap,
  };
}

/** The lines verify.mjs prints for a pick. */
export function describePick(r, { of, changedCount, jobs = 4 }) {
  const lines = [`quick set: ${r.picked.length} of ${of} scenarios: core ${r.core.length}, plus ${r.extras.length} mapped from ${r.mappedFiles} of ${changedCount} changed files (cap ${r.cap}; --full runs all)`];
  // One line per reason, in rank order: "+ <why>: a b c" (a name pulled in by several files shows "(+n files)").
  const groups = new Map();
  for (const e of r.extras) {
    if (!groups.has(e.why)) groups.set(e.why, []);
    groups.get(e.why).push(e.files > 1 ? `${e.name} (+${e.files - 1} files)` : e.name);
  }
  for (const [why, names] of groups) lines.push(`  + ${why}: ${names.join(' ')}`);
  if (r.capped.length) lines.push(`  skipped by the cap (${r.capped.length}): ${r.capped.join(' ')} (run them with --only if they matter)`);
  if (r.missingCore.length) lines.push(`  core names with no scenario: ${r.missingCore.join(' ')}`);
  lines.push(`  estimated scenario time about ${r.estSec} s at ${jobs} pages${r.longest ? ` (longest ${r.longest.name} ${r.longest.sec} s)` : ''}`);
  return lines;
}
