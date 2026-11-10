// P5-089: name checks for verify.mjs and flakecheck.mjs. A scenario or milestone name that matches nothing must stop the run
// loudly, with close matches, before anything builds (`--only camera_jump` used to run nothing for it and print nothing;
// `--milestone M01 M20` ran only M01). Pure functions; tests in cliguard.test.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { checkCliArgs } from './lib.mjs';

/** Levenshtein distance (small names only). */
export function editDistance(a, b) {
  a = String(a); b = String(b);
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Up to `max` candidates close to `name`: same name in another case, names that contain it (or it contains), then a
 * small edit distance (at most a third of the name, at least 2). Closest first. */
export function closeMatches(name, candidates, max = 5) {
  const n = String(name).toLowerCase();
  if (!n) return [];
  const scored = [];
  for (const c of candidates) {
    const l = String(c).toLowerCase();
    let score = null;
    if (l === n) score = 0;
    else if (l.includes(n) || (l.length >= 4 && n.includes(l))) score = 1 + Math.abs(l.length - n.length) / 100;
    else {
      const d = editDistance(n, l);
      if (d <= Math.max(2, Math.floor(n.length / 3))) score = 2 + d;
    }
    if (score !== null) scored.push([score, c]);
  }
  return scored.sort((x, y) => x[0] - y[0] || String(x[1]).localeCompare(String(y[1]))).slice(0, max).map((x) => x[1]);
}

/** The flags checkCliArgs (P5-057) would refuse, each with its close matches among the known ones. */
export function unknownFlags(args, known) {
  if (checkCliArgs({ ...args, _: [] }, known, '').exit !== 2) return [];
  return Object.keys(args).filter((k) => k !== '_' && !known.includes(k)).map((k) => {
    const c = closeMatches(k, known, 3);
    return `unknown flag --${k}${c.length ? `; close matches: ${c.map((x) => `--${x}`).join(', ')}` : ''}`;
  });
}

/** Splits a comma list (`--only a,b*`). */
export function commaList(v) {
  if (v === undefined || v === null || v === true) return [];
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

/** The patterns that match no name (a trailing * is a prefix), each with its close matches. */
export function unknownNames(pats, names) {
  const out = [];
  for (const p of pats) {
    const prefix = p.endsWith('*');
    const stem = prefix ? p.slice(0, -1) : p;
    const hit = prefix ? names.some((n) => n.startsWith(stem)) : names.includes(p);
    if (!hit) out.push({ name: p, close: closeMatches(stem, names) });
  }
  return out;
}

/** One line per unknown name: `unknown scenario "camera_jump"; close matches: move_seq_camera_jump`. */
export function unknownText(unknown, kind) {
  return unknown.map((u) => `unknown ${kind} "${u.name}"; ${u.close.length ? `close matches: ${u.close.join(', ')}` : 'no close match'}`).join('\n');
}

/** Scenario names of harness/verify/scenarios.json. */
export function scenarioNames(root) {
  try { return (JSON.parse(fs.readFileSync(path.join(root, 'harness', 'verify', 'scenarios.json'), 'utf8')).scenarios || []).map((s) => s.name); }
  catch { return []; }
}

/** Milestone ids verify --milestone can play: every play script <milestoneScripts>/<ID>.js (kit.config.json, default
 * harness/verify/milestones). */
export function milestoneIds(root, dir = 'harness/verify/milestones') {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(root, 'harness', 'kit.config.json'), 'utf8'));
    if (cfg.milestoneScripts) dir = cfg.milestoneScripts;
  } catch { /* default dir */ }
  try { return fs.readdirSync(path.join(root, dir)).map((f) => (f.match(/^([A-Za-z0-9_-]+)\.js$/) || [])[1]).filter(Boolean).sort(); }
  catch { return []; }
}

/** Flags verify.mjs reads (without --). `quick` selects the default mode. */
export const VERIFY_FLAGS = ['quick', 'all', 'milestone', 'only', 'dry', 'changed', 'full', 'headed', 'jobs', 'query', 'repeat', 'report', 'shots', 'timescale', 'trace', 'base-url', 'min-mean', 'no-build', 'no-checks'];
/** verify.mjs flags that never take a value, so `--no-build camera_jump` is not read as no-build="camera_jump". */
export const VERIFY_BOOLEANS = ['quick', 'all', 'dry', 'full', 'headed', 'trace', 'no-build', 'no-checks'];

/**
 * The verify.mjs argument check, before anything builds or runs. Returns { exit: null } to go on, or { exit: 2, text }:
 * a bare word (lists are comma separated: `--milestone M01,M20`), an unknown flag, `--milestone`/`--only` with no value, a
 * milestone id with no solution script, or an `--only` name (or prefix*) that matches no scenario. Close matches are listed.
 */
export function checkVerifyArgs(args, { scenarios, milestones, usage = '' }) {
  const errs = [];
  const stray = (args._ || []).map(String);
  if (stray.length) {
    const listFlag = args.milestone !== undefined ? 'milestone' : args.only !== undefined ? 'only' : null;
    if (listFlag && typeof args[listFlag] === 'string') {
      const joined = [...commaList(args[listFlag]), ...stray].join(',');
      errs.push(`--${listFlag} takes one comma separated list, not space separated names: use --${listFlag} ${joined} (the extra words were: ${stray.join(' ')})`);
    } else errs.push(`unknown word${stray.length > 1 ? 's' : ''}: ${stray.join(' ')} (verify takes no bare words; lists are comma separated, like --milestone M01,M20)`);
  }
  errs.push(...unknownFlags(args, VERIFY_FLAGS));
  for (const f of ['milestone', 'only']) if (args[f] === true || (args[f] !== undefined && !commaList(args[f]).length)) errs.push(`--${f} needs a comma separated list, like --${f} ${f === 'milestone' ? 'M01,M20' : 'move_seq_camera_jump,test_street*'}`);
  if (typeof args.milestone === 'string') {
    const u = unknownNames(commaList(args.milestone).filter((m) => !m.endsWith('*')), milestones);
    if (u.length) errs.push(`${unknownText(u, 'milestone')}\n  (a milestone needs a play script harness/verify/milestones/<ID>.js; known: ${milestones.join(' ')})`);
    const pre = commaList(args.milestone).filter((m) => m.endsWith('*'));
    if (pre.length) errs.push(`--milestone takes exact ids, not prefixes: ${pre.join(', ')}`);
  }
  if (typeof args.only === 'string') {
    const u = unknownNames(commaList(args.only), scenarios);
    if (u.length) errs.push(unknownText(u, 'scenario'));
  }
  if (!errs.length) return { exit: null };
  return { exit: 2, text: `verify: nothing run.\n${errs.map((e) => `  ${e.replace(/\n/g, '\n  ')}`).join('\n')}${usage ? `\n\n${usage}` : ''}` };
}

/** Flags flakecheck.mjs reads; the names are bare words (scenarios and milestone ids, comma or space separated). */
export const FLAKE_FLAGS = ['runs', 'jobs', 'load', 'load-set', 'no-build', 'min-mean', 'out'];
export const FLAKE_BOOLEANS = ['no-build'];
/** A name is a milestone when it looks like one: capitals and digits only (L01, M07, BOSS1), as milestone ids are written. */
export const isMilestoneName = (n) => /^[A-Z][A-Z0-9_-]*\d[A-Z0-9_-]*$/.test(n) || /^[A-Z]{3,}$/.test(n);

/** The flakecheck.mjs check: unknown flags, scenario names (or prefix*) that match nothing, and milestone ids with no
 * solution script, in the list and in --load-set. Returns { exit: null } or { exit: 2, text }. */
export function checkFlakeArgs(args, { scenarios, milestones }) {
  const errs = [];
  errs.push(...unknownFlags(args, FLAKE_FLAGS));
  const names = commaList((args._ || []).join(','));
  // A milestone-shaped name (M07, M99) is a milestone; everything else is a scenario.
  const um = unknownNames(names.filter(isMilestoneName), milestones);
  if (um.length) errs.push(`${unknownText(um, 'milestone')} (no play script harness/verify/milestones/<ID>.js)`);
  const us = unknownNames(names.filter((n) => !isMilestoneName(n)), scenarios);
  if (us.length) errs.push(unknownText(us, 'scenario'));
  if (typeof args['load-set'] === 'string') {
    const ul = unknownNames(commaList(args['load-set']), scenarios);
    if (ul.length) errs.push(`--load-set: ${unknownText(ul, 'scenario')}`);
  }
  if (!errs.length) return { exit: null };
  return { exit: 2, text: `flakecheck: nothing run.\n${errs.map((e) => `  ${e}`).join('\n')}` };
}
