// Shared helpers for harness scripts. Node built-ins only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { execSync, execFileSync } from 'node:child_process';

// HARNESS_ROOT points the whole harness at a scratch copy (tests run in one); it is never set in normal use.
export const ROOT = process.env.HARNESS_ROOT ? path.resolve(process.env.HARNESS_ROOT) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const H = (...p) => path.join(ROOT, 'harness', ...p);
export const R = (...p) => path.join(ROOT, ...p);

export const PATHS = {
  backlog: H('state', 'backlog.json'),
  state: H('state', 'state.json'),
  journal: H('state', 'journal.md'),
  decisions: H('state', 'decisions.md'),
  knowledge: H('state', 'knowledge.md'),
  inbox: H('state', 'inbox.jsonl'),
  inboxAcks: H('state', 'inbox_acks.jsonl'),
  // P2B-106: dashboard notices (push failures and similar), managed with harness/bin/notice.mjs.
  notices: H('state', 'notices.jsonl'),
  // Milestones: the playable end-to-end units of the game (levels, missions, stages, quests). Word and files in kit.config.json.
  milestoneStatus: H('state', 'milestones_status.json'),
  milestones: H('data', 'milestones.json'),
  config: H('kit.config.json'),
  reqAssets: H('requests', 'assets.json'),
  reqSfx: H('requests', 'sfx.json'),
  reqMusic: H('requests', 'music.json'),
  reqVoice: H('requests', 'voice.json'),
  reportLatest: H('reports', 'latest.json'),
  reportHistory: H('reports', 'history'),
  shots: H('reports', 'shots'),
  inboxDir: R('assets_inbox'),
  publicAssets: R('public', 'assets'),
  manifest: R('public', 'assets', 'manifest.json'),
};

/** harness/kit.config.json merged over the defaults (see harness/kit.config.json for what each key means). */
export const CONFIG_DEFAULTS = {
  game: 'the game', owner: 'the owner', milestoneWord: 'level', milestoneScripts: 'harness/verify/milestones',
  pageQuery: 'debug=1&verify=1', buildDir: 'dist', publicDir: 'public', dashboardPort: 4477, sessionLogLimitMB: 15,
  artPass: { intents: 8, tasksSince: 6 }, perfBudgetsFile: 'harness/verify/perf_budgets.json',
  treeHashPaths: null,
};
let configCache = null;
export function config() {
  if (configCache) return configCache;
  let c = {};
  try { c = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness', 'kit.config.json'), 'utf8')); } catch { /* defaults */ }
  configCache = { ...CONFIG_DEFAULTS, ...c, artPass: { ...CONFIG_DEFAULTS.artPass, ...(c.artPass || {}) } };
  return configCache;
}

export function readJSON(file, fallback = undefined) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (fallback !== undefined) return fallback; throw new Error(`Cannot read ${path.relative(ROOT, file)}: ${e.message}`); }
}

export function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

export function readJSONL(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

export function appendJSONL(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}

export function nowISO() { return new Date().toISOString(); }
export function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function appendJournal(line) {
  fs.mkdirSync(path.dirname(PATHS.journal), { recursive: true });
  fs.appendFileSync(PATHS.journal, `- ${stamp()} ${line.replace(/\s+/g, ' ').trim()}\n`);
}

export function git(cmd) {
  try { return execSync(`git ${cmd}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return ''; }
}

// Parse "--flag value" and "--flag=value" plus positionals. `booleans` (P5-089) names flags that never take a value, so
// `--no-build camera_jump` keeps camera_jump as a positional instead of no-build="camera_jump".
export function parseArgs(argv, { booleans = [] } = {}) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--') || booleans.includes(key)) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

/**
 * P5-057: the flag check of a measuring tool, before it builds or writes anything. `known` lists the long flags the tool
 * reads (without `--`). Returns { exit: null } to go on, { exit: 0, text: usage } for --help / -h, or { exit: 2, text }
 * for an unknown flag or a stray word (a typo must never start a long run that overwrites committed proof).
 */
export function checkCliArgs(args, known, usage) {
  if (args.help || args.h || args._.includes('-h')) return { exit: 0, text: usage };
  const unknown = Object.keys(args).filter((k) => k !== '_' && !known.includes(k)).map((k) => `--${k}`);
  const stray = args._.map(String);
  if (unknown.length || stray.length) return { exit: 2, text: `unknown ${[...unknown, ...stray].join(' ')}\n\n${usage}` };
  return { exit: null };
}
/** Parses argv with parseArgs and applies checkCliArgs: prints usage and exits on --help or an unknown flag. */
export function cliArgs(argv, known, usage) {
  const args = parseArgs(argv);
  const r = checkCliArgs(args, known, usage);
  if (r.exit === 0) { console.log(r.text); process.exit(0); }
  if (r.exit !== null) { console.log(r.text); process.exit(r.exit); }
  return args;
}

// ---- asset request status (derived from files, never stored) ----
export function manifest() { return readJSON(PATHS.manifest, { images: {}, audio: {}, models: {} }); }
// The delivered file of an id, whichever kind it is: image, audio or rigged model.
export function manifestEntry(man, id) { return man.images?.[id] || man.audio?.[id] || man.models?.[id]; }
export function inboxFile(id) {
  if (!fs.existsSync(PATHS.inboxDir)) return null;
  const f = fs.readdirSync(PATHS.inboxDir).find((n) => n.startsWith(id + '.') && fs.statSync(path.join(PATHS.inboxDir, n)).isFile());
  return f ? path.join(PATHS.inboxDir, f) : null;
}
// waiting: nothing uploaded | received: uploaded, not processed yet | ready: in the game | redo: Claude asked for a new version
export function statusOf(id, req, man = manifest()) {
  const inMan = manifestEntry(man, id);
  if (req?.redo && (!inMan || Date.parse(inMan.ingestedAt || 0) < Date.parse(req.redo.at))) return inboxFile(id) ? 'received' : 'redo';
  if (inMan) return 'ready';
  if (inboxFile(id)) return 'received';
  return 'waiting';
}

// Lists: ids are comma-separated; free-text lists (acceptance criteria) are '|' separated.
export function splitList(v, sep = /[|,]/) {
  if (!v || v === true) return [];
  return String(v).split(sep).map((s) => s.trim()).filter(Boolean);
}

// Tiny lock so parallel agents (and the dashboard's ingest) do not lose writes to harness/requests/*.json.
const LOCK = path.join(ROOT, 'harness', 'state', '.requests.lock');
export function withLock(fn) {
  const start = Date.now();
  for (;;) {
    try { fs.mkdirSync(path.dirname(LOCK), { recursive: true }); fs.mkdirSync(LOCK); break; }
    catch {
      try { if (Date.now() - fs.statSync(LOCK).mtimeMs > 30000) fs.rmdirSync(LOCK); } catch { /* raced */ }
      if (Date.now() - start > 20000) throw new Error('requests lock busy for 20 s');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
  try { return fn(); } finally { try { fs.rmdirSync(LOCK); } catch { /* ok */ } }
}

/**
 * The paths whose content decides a verify run: the game (src, public, index.html, package and build config, the
 * milestone data in harness/data) and the verify scripts and their inputs (harness/bin, harness/verify, the look proof
 * poses). Everything else (docs, harness/state, harness/reports, harness/design, harness/requests, look proof output,
 * CLAUDE.md, .claude, assets_inbox, and junk a verifier leaves untracked in its snapshot) is left out of treeHash.
 * kit.config.json `treeHashPaths` replaces the list for a repo with another layout.
 */
/** Bump when TREE_HASH_PATHS or the hash method changes: reports record it, so freshreport can say why an older run never matches. */
export const TREE_RULE = 2;
export const TREE_HASH_PATHS = [
  'src', 'public', 'index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.node.json',
  'vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vitest.config.ts', 'vitest.config.mts', 'build',
  'harness/bin', 'harness/verify', 'harness/data', 'harness/look_proof/poses.json',
];
function hashPaths() { const c = config().treeHashPaths; return Array.isArray(c) && c.length ? c : TREE_HASH_PATHS; }

/**
 * Content hash of the TREE_HASH_PATHS part of the working tree as git would commit it (tracked plus untracked, ignored
 * files left out). A builder's uncommitted tree and the verify snapshot of the commit made from it give the same hash,
 * so the verifier can reuse the builder's quick run (owner, 2026-10-09). It starts from an empty index, so
 * nothing outside the allow list (state commits, docs, a snapshot's node_modules symlink, look proof junk) counts.
 */
export function treeHash(root = ROOT) {
  const idx = path.join(os.tmpdir(), `harness-tree-${process.pid}-${Date.now()}.idx`);
  try {
    const env = { ...process.env, GIT_INDEX_FILE: idx };
    // git add fails on a pathspec that matches nothing, so pass only the ones present (a deleted path just drops out).
    const paths = hashPaths().filter((p) => fs.existsSync(path.join(root, p)));
    if (paths.length) execFileSync('git', ['add', '-A', '--', ...paths], { cwd: root, env, stdio: 'ignore' });
    return execFileSync('git', ['write-tree'], { cwd: root, env, encoding: 'utf8' }).trim();
  } catch { return null; } finally { try { fs.unlinkSync(idx); } catch { /* none */ } }
}

// Power source and battery percent (macOS `pmset -g batt`), so a battery run, which throttles the GPU, is visible in a perf
// report (verify.mjs, lookproof.mjs).
export function powerInfo() {
  try {
    const out = execSync('pmset -g batt', { encoding: 'utf8', timeout: 4000 });
    const source = /'(.+?)'/.exec(out)?.[1] || 'unknown';
    const pct = /(\d+)%/.exec(out)?.[1];
    return { source, batteryPct: pct === undefined ? null : Number(pct) };
  } catch { return { source: 'unknown', batteryPct: null }; }
}
