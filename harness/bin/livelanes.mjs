// Live view of every lane's work in progress (P2-066, owner 2026-11-14): the newest pictures each running agent wrote,
// from the main checkout and from each worktree under .worktrees/, for the dashboard overview. Read only.
// One directory listing per folder per poll; a picture's mtime is the only thing read from it (no image is opened).
import fs from 'node:fs';
import path from 'node:path';

export const IMG_RE = /\.(png|jpe?g)$/i;
export const LANE_RE = /^[a-z0-9_-]+$/;
// Folders of harness/reports that are heavy or are not work in progress.
export const SKIP_DIRS = new Set(['history', 'play', 'gate', 'sweep', 'flakecheck']);
// Nested folders that hold pictures worth showing, as paths under harness/reports.
export const EXTRA_DIRS = ['arch/roads', 'flakecheck/shots'];
export const PER_LANE = 8;

/** The main checkout: when `root` is a worktree under <main>/.worktrees/<name>, the folder above .worktrees, else `root`. */
export function mainRootOf(root) {
  const parent = path.dirname(root);
  return path.basename(parent) === '.worktrees' ? path.dirname(parent) : root;
}

/** The checkout folder of a lane: the main checkout for "main", else <main>/.worktrees/<lane>. Null for a name that is not a lane name. */
export function laneRoot(main, lane) {
  if (lane === 'main') return main;
  if (!LANE_RE.test(lane || '')) return null;
  return path.join(main, '.worktrees', lane);
}

function listImages(dir, rel, out) {
  let names;
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const f of names) {
    if (!IMG_RE.test(f) || f.startsWith('art_')) continue;
    try { out.push({ name: rel ? `${rel}/${f}` : f, t: fs.statSync(path.join(dir, f)).mtimeMs }); } catch { /* gone */ }
  }
}

/** The newest pictures in <checkout>/harness/reports (the folder itself under "shots", every direct subfolder except the skipped ones, and the extra nested folders). */
export function scanReports(checkout, n = PER_LANE) {
  const base = path.join(checkout, 'harness', 'reports');
  const out = [];
  let ents;
  try { ents = fs.readdirSync(base, { withFileTypes: true }); } catch { return []; }
  for (const e of ents) {
    if (e.isDirectory() && !SKIP_DIRS.has(e.name)) listImages(path.join(base, e.name), e.name, out);
  }
  for (const x of EXTRA_DIRS) listImages(path.join(base, x), x, out);
  return out.sort((a, b) => b.t - a.t).slice(0, n);
}

/**
 * The lanes to show. Builder side: the main lane (always) and every lane that has a running non-verifier agent.
 * Verifier side: every lane with a running verifier agent, and the "verify" snapshot folder when it has pictures.
 * Each lane: { lane, role, task, what, since, items: [{ name, t, url }] } with url = /lane/<lane>/<path under harness/reports>.
 */
export function liveLanes(main, agents, extraMain = [], n = PER_LANE) {
  const byLane = new Map();
  for (const a of agents || []) {
    if (!a || !LANE_RE.test(a.lane || '')) continue;
    const side = a.role === 'verifier' ? 'verifier' : 'builder';
    const k = `${side}:${a.lane}`;
    if (!byLane.has(k)) byLane.set(k, { lane: a.lane, side, agent: a });
  }
  const mk = (lane, side, agent) => {
    const root = laneRoot(main, lane);
    if (!root || (lane !== 'main' && !fs.existsSync(root))) return null;
    let items = scanReports(root, n).map((x) => ({ name: x.name, t: x.t, url: `/lane/${lane}/${x.name.split('/').map(encodeURIComponent).join('/')}` }));
    if (lane === 'main' && side === 'builder') items = [...items, ...extraMain].sort((a, b) => b.t - a.t).slice(0, n);
    return { lane, role: side, task: agent?.task || '', what: agent?.what || '', since: agent?.since || null, items };
  };
  const builders = [];
  const mainAgent = byLane.get('builder:main');
  const m = mk('main', 'builder', mainAgent?.agent);
  if (m) builders.push(m);
  for (const [, v] of byLane) if (v.side === 'builder' && v.lane !== 'main') { const l = mk(v.lane, 'builder', v.agent); if (l) builders.push(l); }
  const verifiers = [];
  for (const [, v] of byLane) if (v.side === 'verifier') { const l = mk(v.lane, 'verifier', v.agent); if (l && l.items.length) verifiers.push(l); }
  if (!verifiers.some((v) => v.lane === 'verify')) { const l = mk('verify', 'verifier', null); if (l && l.items.length) verifiers.push(l); }
  return { builders, verifiers };
}

/**
 * The absolute file for GET /lane/<lane>/<rel>, or null. Only .png and .jpg files under <checkout>/harness/reports of the main
 * checkout or of a worktree under <main>/.worktrees/; no ".." parts, no absolute paths, no symlink that leaves that folder.
 */
export function resolveLaneFile(main, lane, rel) {
  try {
    if (typeof lane !== 'string' || typeof rel !== 'string' || !rel || rel.includes('\0') || rel.includes('\\')) return null;
    if (!LANE_RE.test(lane) && lane !== 'main') return null;
    const root = laneRoot(main, lane);
    if (!root) return null;
    if (lane !== 'main' && !fs.lstatSync(root).isDirectory()) return null;
    if (path.isAbsolute(rel) || rel.split('/').some((p) => p === '..' || p === '.' || p === '')) return null;
    if (!IMG_RE.test(rel)) return null;
    const base = path.join(root, 'harness', 'reports');
    const abs = path.resolve(base, rel);
    if (!abs.startsWith(base + path.sep)) return null;
    const realBase = fs.realpathSync(base);
    const real = fs.realpathSync(abs);
    if (!real.startsWith(realBase + path.sep) || !fs.statSync(real).isFile()) return null;
    return real;
  } catch { return null; }
}
