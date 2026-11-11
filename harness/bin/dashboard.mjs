#!/usr/bin/env node
// Build monitor for the owner. Zero dependencies. http://localhost:<dashboardPort> (kit.config.json, default 4477)
// Read-only view of the harness state (with notices from harness/state/notices.jsonl), plus two writes: mentor messages
// (inbox) and file uploads (assets_inbox).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { PATHS, ROOT, R, H, config, readJSON, readJSONL, appendJSONL, nowISO, git, manifest, manifestEntry, statusOf } from './lib.mjs';
import { perfSummary } from './perfgate.mjs';
import { readNotices, openNotices } from './notice.mjs';
import { signoffStates } from './signoffs.mjs';
import { scriptIds, milestoneCounts, isRequired, loadMilestones } from './milestoneset.mjs';
import { readCopies, COPY_ROOT, PLAY_COMMAND } from './playcopy.mjs';
import { inspectorHandler } from '../../tools/inspector/server.mjs';

const PORT = Number(process.env.HARNESS_DASHBOARD_PORT || config().dashboardPort || 4477);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.webmanifest': 'application/manifest+json' };
const UPLOAD_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'glb']);

function tail(file, n) { try { return fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.startsWith('- ')).slice(-n); } catch { return []; } }
function mtime(file) { try { return fs.statSync(file).mtimeMs; } catch { return 0; } }

function shotsList() {
  if (!fs.existsSync(PATHS.shots)) return [];
  // art_* shots (an art bench, if the game has one) stay out of the newest list.
  return fs.readdirSync(PATHS.shots).filter((f) => f.endsWith('.png') && !f.startsWith('art_'))
    // Sorted by when a shot first appeared (birth time), so the regression set that every verify run re-takes under the same names
    // does not keep pushing itself back to the top. t is the last update, used for cache busting and "ago".
    .map((f) => { const st = fs.statSync(path.join(PATHS.shots, f)); return { name: f, t: st.mtimeMs, first: st.birthtimeMs || st.mtimeMs }; })
    .sort((a, b) => b.first - a.first).slice(0, 80);
}

// Live strips (owner, 2026-10-09): the shots most recently WRITTEN (mtime), so a builder that re-saves known names still shows,
// for the main checkout (builder) and the verify snapshot worktree (verifier). Read only; costs the builders nothing.
const VERIFY_SHOTS = path.join(PATHS.shots, '..', '..', '..', '.worktrees', 'verify', 'harness', 'reports', 'shots');
function liveShots(dir, n = 10) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.png') && !f.startsWith('art_'))
    .map((f) => { const st = fs.statSync(path.join(dir, f)); return { name: f, t: st.mtimeMs }; })
    .sort((a, b) => b.t - a.t).slice(0, n);
}

// Look shots (owner 2026-11-10): the newest lookproof views (harness/look_proof/<set>/*.png, approved excluded)
// and sheets (harness/reports/look/*.jpg), so style tests show up live. Names are relative to LOOK_ROOT.
const LOOK_ROOT = R('harness');
function liveLook(n = 12) {
  const out = [];
  const lp = path.join(LOOK_ROOT, 'look_proof');
  try { for (const set of fs.readdirSync(lp)) { if (set === 'approved') continue; const d = path.join(lp, set); if (!fs.statSync(d).isDirectory()) continue;
    for (const v of fs.readdirSync(d)) if (v.endsWith('.png')) out.push({ name: 'look_proof/' + set + '/' + v, t: fs.statSync(path.join(d, v)).mtimeMs }); } } catch { /* none yet */ }
  const sheets = path.join(LOOK_ROOT, 'reports', 'look');
  try { for (const v of fs.readdirSync(sheets)) if (/\.(jpg|png)$/.test(v)) out.push({ name: 'reports/look/' + v, t: fs.statSync(path.join(sheets, v)).mtimeMs }); } catch { /* none yet */ }
  return out.sort((a, b) => b.t - a.t).slice(0, n);
}

// Frame time panel (P2-118): the newest run that measured perf, from latest.json, the report history or a sweep summary.
// Runs with frame time in ms (cpuMs) win over older fps only runs. Cached on the newest file's mtime, so polling stays cheap.
const SWEEP_DIR = path.join(path.dirname(PATHS.reportLatest), 'sweep');
let perfCache = { key: '', value: null };
function lastPerf() {
  const files = [];
  const add = (dir, re, kind) => { try { for (const f of fs.readdirSync(dir)) if (re.test(f)) files.push({ file: path.join(dir, f), kind, t: mtime(path.join(dir, f)) }); } catch { /* none yet */ } };
  if (fs.existsSync(PATHS.reportLatest)) files.push({ file: PATHS.reportLatest, kind: 'report', t: mtime(PATHS.reportLatest) });
  add(PATHS.reportHistory, /\.json$/, 'report');
  add(SWEEP_DIR, /^[0-9a-f]+\.json$/, 'sweep');
  files.sort((a, b) => b.t - a.t);
  const key = files.slice(0, 3).map((f) => `${f.file}:${f.t}`).join('|');
  if (key === perfCache.key) return perfCache.value;
  let legacy = null;
  let found = null;
  for (const f of files.slice(0, 60)) {
    const j = readJSON(f.file, null);
    if (!j) continue;
    let rows;
    if (f.kind === 'sweep') rows = Object.entries(j.perf || {}).map(([name, p]) => ({ name, ...p }));
    else rows = Object.entries(j.scenarios || {}).filter(([, x]) => x && x.perf).map(([name, x]) => ({ name, ok: x.ok, ...perfSummary(x.perf) }));
    if (!rows.length) continue;
    const entry = { from: f.kind === 'sweep' ? `sweep ${j.sha}` : `${j.mode} run`, at: j.finishedAt || j.at || null, commit: j.commit || j.sha || null, rows };
    if (rows.some((r) => r.cpuMs)) { found = entry; break; }
    if (!legacy) legacy = entry;
  }
  perfCache = { key, value: found || legacy };
  return perfCache.value;
}

// Progress and time estimates, all derived from the backlog (no guessing beyond what is recorded).
// Task time = started to done (build plus independent verification). Runs over 6 h are usage-limit pauses and are left out.
// Overall percent weights each phase by its milestone count (at least 1). Rough by design.
function progressInfo(tasks, phases) {
  const mins = tasks.filter((t) => t.started && t.done).map((t) => (Date.parse(t.done) - Date.parse(t.started)) / 60000).filter((m) => m > 0 && m < 360).sort((a, b) => a - b);
  const q = (f) => (mins.length ? mins[Math.min(mins.length - 1, Math.floor(mins.length * f))] : null);
  const median = q(0.5), p75 = q(0.75);
  const doneLike = (t) => t.status === 'done' || t.status === 'skipped';
  let wSum = 0, wDone = 0;
  const per = phases.map((ph) => {
    const list = tasks.filter((t) => t.phase === ph.id); const d = list.filter(doneLike).length;
    const frac = ph.status === 'done' ? 1 : list.length ? d / list.length : 0;
    const w = Math.max(1, (ph.milestones || []).length); wSum += w; wDone += w * frac;
    return { id: ph.id, name: ph.name, status: ph.status, done: d, total: list.length, pct: Math.round(frac * 100) };
  });
  const active = phases.find((ph) => ph.status === 'active');
  const doing = tasks.filter((t) => t.status === 'doing').map((t) => ({ id: t.id, title: t.title, elapsedMin: t.started ? Math.round((Date.now() - Date.parse(t.started)) / 60000) : null }));
  let phaseEta = null;
  if (active && median) {
    const left = tasks.filter((t) => t.phase === active.id && !doneLike(t));
    const todo = left.filter((t) => t.status !== 'doing').length;
    const curLeft = doing.length ? Math.max(5, median - Math.max(...doing.map((d) => d.elapsedMin || 0))) : 0;
    phaseEta = { phase: active.id, tasksLeft: left.length, lowMin: Math.round(curLeft + todo * median), highMin: Math.round(curLeft + todo * (p75 || median)) };
  }
  // Whole game (rough): open tasks in planned phases, plus a guess for phases not planned yet (at least 15 tasks, or 3.5 per
  // milestone), timed at the real recent pace (wall hours per task done over the last 48 h, retries and idle gaps included).
  let gameEta = null;
  {
    let left = 0, guessed = 0;
    for (const ph of phases) {
      if (ph.status === 'done') continue;
      const open = tasks.filter((t) => t.phase === ph.id && !doneLike(t)).length;
      if (ph.planned !== false || ph.status === 'active') { left += open; continue; }
      const est = Math.max(15, Math.round((ph.milestones || []).length * 3.5), open);
      left += est; guessed += est - open;
    }
    const since = Date.now() - 48 * 3600e3;
    const recent = tasks.filter((t) => t.status === 'done' && t.done && Date.parse(t.done) > since).length;
    // Fewer than 10 finished tasks is too few to trust the pace: assume at least 1 hour per task until then.
    const rawH = recent >= 4 ? 48 / recent : (median ? median / 60 : 1);
    const hPerTask = mins.length < 10 ? Math.max(1, rawH) : rawH;
    const hours = left * hPerTask;
    gameEta = { tasksLeft: left, guessedTasks: guessed, hoursPerTask: Math.round(hPerTask * 100) / 100, lowDays: Math.round((hours * 0.8) / 24 * 10) / 10, highDays: Math.round((hours * 1.3) / 24 * 10) / 10 };
  }
  // Whole game percent: tasks done over the whole game's size. Until every phase is planned, the size is at least
  // config.gameSizeEstimate.tasks (a rough guess for the full game), so an early phase cannot read as a big share of the game.
  const doneCount = tasks.filter(doneLike).length;
  const known = doneCount + (gameEta ? gameEta.tasksLeft : 0);
  const floor = Number(config().gameSizeEstimate?.tasks) || 0;
  const sized = floor > known;
  const total = Math.max(known, floor, 1);
  if (gameEta && sized) { const extra = total - known; gameEta.guessedTasks += extra; gameEta.tasksLeft += extra; const hours = gameEta.tasksLeft * gameEta.hoursPerTask; gameEta.lowDays = Math.round((hours * 0.8) / 24 * 10) / 10; gameEta.highDays = Math.round((hours * 1.3) / 24 * 10) / 10; }
  const overallPct = Math.round((1000 * doneCount) / total) / 10;
  return { overallPct, overallTasks: { done: doneCount, total, estimated: sized || (gameEta && gameEta.guessedTasks > 0) }, phaseWeightedPct: Math.round((100 * wDone) / Math.max(1, wSum)), phases: per, taskMinutes: { median: median && Math.round(median), p75: p75 && Math.round(p75), samples: mins.length }, doing, phaseEta, gameEta };
}

function buildState() {
  const backlog = readJSON(PATHS.backlog, { phases: [], tasks: [] });
  const st = readJSON(PATHS.state, {});
  const milestones = loadMilestones();
  const mstatus = readJSON(PATHS.milestoneStatus, {});
  const report = readJSON(PATHS.reportLatest, null);
  const man = manifest();
  const acks = readJSONL(PATHS.inboxAcks);
  const ackById = Object.fromEntries(acks.map((a) => [a.id, a]));
  const inbox = readJSONL(PATHS.inbox).map((m) => ({ ...m, ack: ackById[m.id] || null })).reverse();
  const req = (file, key) => (readJSON(file, { [key]: [] })[key] || []).map((r) => ({ ...r, status: statusOf(r.id, r, man), file: manifestEntry(man, r.id)?.path || null, ingestedAt: manifestEntry(man, r.id)?.ingestedAt || null, info: man.models?.[r.id] ? { triangles: man.models[r.id].triangles ?? '?', materials: man.models[r.id].materials ?? '?', warnings: man.models[r.id].warnings || [] } : undefined }));
  const voice = readJSON(PATHS.reqVoice, { voices: [], lines: [] });
  const tasks = backlog.tasks || [];
  const done = tasks.filter((t) => t.status === 'done' || t.status === 'skipped').length;
  const scripts = scriptIds();
  const mc = milestoneCounts(milestones, mstatus, scripts);
  const cfg = config();
  return {
    now: nowISO(),
    game: cfg.game, owner: cfg.owner, milestoneWord: cfg.milestoneWord,
    lastActivity: Math.max(mtime(PATHS.journal), mtime(PATHS.backlog), mtime(PATHS.reportLatest)),
    phases: backlog.phases,
    tasks,
    // core = required milestones, side = optional ones (back = optional with a play script), the shape the page reads.
    progress: { tasksDone: done, tasksTotal: tasks.length, milestones: mc, core: { total: mc.required.total, playable: mc.required.playable }, side: { total: mc.optional.total, playable: mc.optional.playable, back: mc.optional.scripted } },
    state: st,
    // The three Phase 0 sign-offs (style, architecture, game design) with their state and the owner's words.
    signoffs: signoffStates(st),
    current: tasks.find((t) => t.status === 'doing') || null,
    eta: progressInfo(tasks, backlog.phases || []),
    // `missions` and `chapters` are the page's names for milestones and their groups (milestones.json `chapter`, optional;
    // `chapters` in milestones.json may give each group a title).
    missions: milestones.map((m) => ({ id: m.id, chapter: m.chapter ?? null, title: m.title || '', summary: m.summary || '', tags: m.tags || [], core: isRequired(m), solution: scripts.has(m.id), status: mstatus[m.id]?.status || 'planned', verify: report?.milestones?.[m.id] ? { ok: report.milestones[m.id].ok, reason: report.milestones[m.id].reason } : null })),
    chapters: (() => {
      const named = readJSON(PATHS.milestones, {}).chapters || [];
      const ns = [...new Set(milestones.map((m) => m.chapter ?? null))];
      return ns.map((n) => { const c = named.find((x) => x.n === n); return { n, title: c?.title || (n == null ? `All ${cfg.milestoneWord}s` : `Part ${n}`), sub: c?.sub || '' }; });
    })(),
    report: report && { mode: report.mode, ok: report.ok, finishedAt: report.finishedAt, durationMs: report.durationMs, gl: report.gl, failReason: report.failReason, consoleErrors: (report.consoleErrors || []).slice(0, 5), checks: Object.fromEntries(Object.entries(report.checks || {}).map(([k, v]) => [k, { ran: v.ran, ok: v.ok }])), scenarios: Object.fromEntries(Object.entries(report.scenarios || {}).map(([k, v]) => [k, { ok: v.ok, error: v.errors?.[0] || null, perf: v.perf || null }])), missionsRun: Object.keys(report.milestones || {}).length, missionsOk: Object.values(report.milestones || {}).filter((m) => m.ok).length },
    perf: lastPerf(),
    shots: shotsList(),
    live: { builder: liveShots(PATHS.shots), verifier: liveShots(VERIFY_SHOTS), look: liveLook() },
    requests: { images: req(PATHS.reqAssets, 'requests'), sfx: req(PATHS.reqSfx, 'requests'), music: req(PATHS.reqMusic, 'requests'), voices: voice.voices || [], lines: (voice.lines || []).map((l) => ({ ...l, status: statusOf(l.id, l, man), file: man.audio?.[l.id]?.path || null })) },
    inbox,
    notices: openNotices(readNotices()),
    journal: tail(PATHS.journal, 80),
    commits: git('log --oneline -12').split('\n').filter(Boolean),
    playCommand: PLAY_COMMAND,
    play: playInfo(),
  };
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function playInfo() {
  const c = readCopies()[0];
  let building = false;
  try { const pid = Number(fs.readFileSync(path.join(COPY_ROOT, '.lock'), 'utf8')); process.kill(pid, 0); building = true; } catch { /* idle */ }
  return { sha: c?.sha || null, subject: c?.subject || null, builtAt: c?.builtAt || null, building, command: PLAY_COMMAND };
}

function serveFile(res, roots, rel, cache = 'no-store') {
  rel = path.normalize(decodeURIComponent(rel)).replace(/^(\.\.[/\\])+/, '').replace(/^[/\\]+/, '');
  for (const root of roots) {
    const f = path.join(root, rel);
    if ((f === root || f.startsWith(root + path.sep)) && fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': cache });
      fs.createReadStream(f).pipe(res); return true;
    }
  }
  return false;
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function knownRequest(id) {
  const ids = [
    ...(readJSON(PATHS.reqAssets, { requests: [] }).requests || []).map((r) => r.id),
    ...(readJSON(PATHS.reqSfx, { requests: [] }).requests || []).map((r) => r.id),
    ...(readJSON(PATHS.reqMusic, { requests: [] }).requests || []).map((r) => r.id),
    ...(readJSON(PATHS.reqVoice, { lines: [] }).lines || []).map((r) => r.id),
  ];
  return ids.includes(id);
}

// Phone access through a tunnel (owner, 2026-10-15): requests that come through a proxy (cloudflared adds
// cf-connecting-ip, others x-forwarded-for) need the secret from harness/state/.dash_token, given once as ?k=
// and then kept in a cookie. Direct localhost requests are unchanged.
const TOKEN_FILE = H('state', '.dash_token');
const dashToken = () => { try { return fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch { return ''; } };
function tunnelAllowed(req, url, res) {
  if (!req.headers['cf-connecting-ip'] && !req.headers['x-forwarded-for']) return true;
  const tok = dashToken();
  if (!tok) return false;
  const cookie = /(?:^|;\s*)hk=([^;]+)/.exec(req.headers.cookie || '');
  if (cookie && cookie[1] === tok) return true;
  if (url.searchParams.get('k') === tok) {
    res.setHeader('Set-Cookie', `hk=${tok}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`);
    return true;
  }
  return false;
}

// The map inspector (tools/inspector/, P1-001) lives on this port under /inspector/ and /api/inspector/.
const inspector = inspectorHandler();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = url.pathname;
    if (!tunnelAllowed(req, url, res)) return send(res, 403, 'Forbidden', 'text/plain');
    if (await inspector(req, res, url)) return;
    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return serveFile(res, [H('dashboard')], 'index.html') || send(res, 404, 'missing dashboard', 'text/plain');
    if (req.method === 'GET' && p.startsWith('/fonts/')) return serveFile(res, [H('dashboard/fonts')], p.slice(7), 'public, max-age=86400') || send(res, 404, 'no font', 'text/plain');
    if (req.method === 'GET' && p === '/logo') { const f = ['logo.png', 'logo.jpg', 'logo.webp'].find((n) => fs.existsSync(H('dashboard', n))); return (f && serveFile(res, [H('dashboard')], f)) || send(res, 404, 'no logo', 'text/plain'); }
    if (req.method === 'GET' && p === '/api/ping') return send(res, 200, { ok: true });
    if (req.method === 'GET' && p === '/api/state') return send(res, 200, buildState());
    if (req.method === 'GET' && p.startsWith('/lshots/')) return serveFile(res, [LOOK_ROOT], p.slice(8)) || send(res, 404, 'no shot', 'text/plain');
    if (req.method === 'GET' && p.startsWith('/vshots/')) return serveFile(res, [VERIFY_SHOTS], p.slice(8)) || send(res, 404, 'no shot', 'text/plain');
    if (req.method === 'GET' && p.startsWith('/shots/')) return serveFile(res, [PATHS.shots], p.slice(7)) || send(res, 404, 'no shot', 'text/plain');
    if (req.method === 'GET' && p.startsWith('/assets/')) return serveFile(res, [PATHS.publicAssets], p.slice(8)) || send(res, 404, 'no asset', 'text/plain');
    if (req.method === 'GET' && (p === '/play' || p.startsWith('/play/'))) {
      // P0-027: the game is Godot, so there is no page to open. /play/ (old bookmarks) says how to run the newest verified build.
      const c = readCopies()[0];
      const body = `<!doctype html><meta charset="utf-8"><title>Play</title><body style="background:#111;color:#e8e6e1;font:16px/1.5 -apple-system,'SF Pro Text',system-ui,sans-serif;max-width:560px;margin:12vh auto;padding:0 20px"><h1 style="font-weight:600;font-size:22px">Play the latest verified build</h1><p>The game runs in Godot, not in the browser. Open a terminal in the project folder and run:</p><pre style="background:#1b1b1b;border:1px solid #2c2c2c;border-radius:8px;padding:12px 14px;font-size:15px">${PLAY_COMMAND}</pre><p style="color:#9a968e">${c ? `Current copy: ${c.sha} (${String(c.subject || '').replace(/[<&]/g, '')}).` : 'No copy yet: the command builds one from the newest verified commit.'}</p>`;
      return send(res, 200, body, 'text/html; charset=utf-8');
    }
    if (req.method === 'POST' && p === '/api/play') {
      // The sidebar Play button: opens the latest stable copy in a Godot window on this machine (playcopy.mjs --play).
      // Only from this machine: a window opened through the tunnel would appear on the Mac, not for the remote viewer.
      if (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for']) return send(res, 403, { error: 'Play opens a window on the Mac, so it only works from this machine.' });
      fs.mkdirSync(PATHS.shots, { recursive: true });
      const log = fs.openSync(path.join(PATHS.shots, '..', 'play.log'), 'a');
      const child = spawn(process.execPath, [H('bin', 'playcopy.mjs'), '--play'], { cwd: ROOT, stdio: ['ignore', log, log], detached: true });
      child.unref();
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/playcopy') {
      // P4-073: the dashboard's Refresh button. Builds the newest verified commit in the background (playcopy.mjs --verified).
      if (playInfo().building) return send(res, 409, { error: 'A copy is already building.' });
      fs.mkdirSync(PATHS.shots, { recursive: true });
      const log = fs.openSync(path.join(PATHS.shots, '..', 'playcopy.log'), 'a');
      const child = spawn(process.execPath, [H('bin', 'playcopy.mjs'), '--verified'], { cwd: ROOT, stdio: ['ignore', log, log], detached: true });
      child.unref();
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/inbox') {
      const body = JSON.parse((await readBody(req, 100000)).toString() || '{}');
      const text = String(body.text || '').trim();
      if (!text) return send(res, 400, { error: 'empty message' });
      const msg = { id: `m${Date.now().toString(36)}`, ts: nowISO(), text, source: 'dashboard' };
      appendJSONL(PATHS.inbox, msg);
      return send(res, 200, msg);
    }
    if (req.method === 'PUT' && p === '/api/upload') {
      const id = String(url.searchParams.get('id') || '');
      const name = String(url.searchParams.get('name') || '');
      const ext = (name.split('.').pop() || '').toLowerCase();
      if (!/^[A-Za-z0-9_]+$/.test(id) || !knownRequest(id)) return send(res, 400, { error: `unknown request id ${id}` });
      if (!UPLOAD_EXT.has(ext)) return send(res, 400, { error: `unsupported file type .${ext}` });
      const data = await readBody(req, (ext === 'glb' ? 200 : 40) * 1024 * 1024);
      fs.mkdirSync(PATHS.inboxDir, { recursive: true });
      for (const f of fs.readdirSync(PATHS.inboxDir)) if (f.startsWith(id + '.') && fs.statSync(path.join(PATHS.inboxDir, f)).isFile()) fs.unlinkSync(path.join(PATHS.inboxDir, f));
      fs.writeFileSync(path.join(PATHS.inboxDir, `${id}.${ext}`), data);
      const child = spawn(process.execPath, [H('bin', 'ingest.mjs'), '--id', id], { cwd: ROOT, stdio: 'ignore', detached: true });
      child.unref();
      return send(res, 200, { ok: true, id, bytes: data.length });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    if (String(e.message) === 'too large') return send(res, 413, { error: 'This file is too big to upload (models up to 200 MB, images and audio up to 40 MB). For a .glb, keep it under about 30 MB.' });
    send(res, 500, { error: String(e.message || e) });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.log(`Dashboard already running on http://localhost:${PORT}`); process.exit(0); }
  throw e;
});
server.listen(PORT, '127.0.0.1', () => console.log(`${config().game} dashboard: http://localhost:${PORT}`));
