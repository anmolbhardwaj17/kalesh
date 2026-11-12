// Map inspector server part (P1-001, P1-011). The dashboard mounts it on its own port (harness/bin/dashboard.mjs), and
// serve.mjs runs it alone for the tests. `inspectorHandler(options)` returns async (req, res, url) => boolean: true
// when it answered the request. No outside host is ever contacted; the only socket it opens besides the page itself
// is the game's debug port on 127.0.0.1 (the "Open in game" button).
//
//   GET  /inspector/                      the page (tools/inspector/web/)
//   GET  /inspector/<file>                page files; .ts files go out with their types stripped
//   GET  /inspector/vendor/three/<path>   three.js from node_modules (a dev dependency of the harness only)
//   GET  /inspector/data/<file>           issues.json, context.json, lanes.json, tiles/index.json, tiles/*.ktl from the data folder
//                                         (harness/reports/map/, written by `npm run bake -- pilot`; the file contract is in
//                                         tools/bake/report/inspector.ts and tools/bake/repair/engine.ts issueRecords)
//   GET  /api/inspector/status            { ready, counts, layers: { lanes } } (lanes: the lane model's layer file is there)
//   GET  /api/inspector/picks             what has been picked so far, read from the override files
//   POST /api/inspector/pick              { issue, proposal: index | null, note } writes the patch and the inbox line
//   POST /api/inspector/open-in-game      { x, z } teleports the running game (--debug) to the spot
import fs from 'node:fs';
import path from 'node:path';
import module from 'node:module';
import { fileURLToPath } from 'node:url';
import { GodotDebugClient } from '../../harness/bin/godotclient.mjs';
import { buildPatch, inboxText, mergePatch, overrideFileName, worldTile } from './lib.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.ts': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.ktl': 'application/octet-stream', '.svg': 'image/svg+xml' };

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

const inside = (root, f) => f === root || f.startsWith(root + path.sep);

function readBody(req, limit = 100000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

/** One file of the page. A .ts file goes out as JavaScript (types stripped), so the page and the tests share lib.ts. */
function serveStatic(res, root, rel, { stripTs = false } = {}) {
  const f = path.join(root, path.normalize(decodeURIComponent(rel)).replace(/^(\.\.[/\\])+/, ''));
  if (!inside(root, f) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return false;
  const ext = path.extname(f).toLowerCase();
  if (ext === '.ts' && stripTs) {
    send(res, 200, module.stripTypeScriptTypes(fs.readFileSync(f, 'utf8')), MIME['.ts']);
    return true;
  }
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(res);
  return true;
}

/**
 * options: dataDir (the bake's report folder), overridesDir (harness/data/overrides), inboxFile (harness/state/inbox.jsonl),
 * gamePort (the game's debug port), date (a fixed date for tests).
 */
export function inspectorHandler(options = {}) {
  const dataDir = options.dataDir ?? path.join(ROOT, 'harness', 'reports', 'map');
  const overridesDir = options.overridesDir ?? path.join(ROOT, 'harness', 'data', 'overrides');
  const inboxFile = options.inboxFile ?? path.join(ROOT, 'harness', 'state', 'inbox.jsonl');
  const gamePort = options.gamePort ?? Number(process.env.HARNESS_GAME_PORT || 47181);
  const today = () => options.date ?? new Date().toISOString().slice(0, 10);
  let issuesCache = { mtime: 0, file: null };

  const issuesFile = path.join(dataDir, 'issues.json');
  const ready = () => fs.existsSync(issuesFile);
  const loadIssues = () => {
    const m = fs.existsSync(issuesFile) ? fs.statSync(issuesFile).mtimeMs : 0;
    if (m !== issuesCache.mtime) issuesCache = { mtime: m, file: readJson(issuesFile, null) };
    return issuesCache.file;
  };

  const picks = () => {
    const out = {};
    if (!fs.existsSync(overridesDir)) return out;
    for (const f of fs.readdirSync(overridesDir)) {
      if (!/^-?\d+_-?\d+\.json$/.test(f)) continue;
      for (const p of readJson(path.join(overridesDir, f), [])) if (p.source === 'inspector') out[p.issue] = { patch: p.id, action: p.action, why: p.why, file: f };
    }
    return out;
  };

  async function pick(body) {
    const file = loadIssues();
    const issue = file?.issues.find((i) => i.id === body.issue);
    if (!issue) return [404, { error: `no issue ${body.issue}` }];
    const note = String(body.note ?? '').trim();
    const index = body.proposal === null || body.proposal === undefined ? null : Number(body.proposal);
    const proposal = index === null ? null : issue.proposals[index];
    if (index !== null && !proposal) return [400, { error: `issue ${issue.id} has no proposal ${index}` }];
    if (!proposal && !note) return [400, { error: 'Pick a fix or type a note.' }];
    let patch = null;
    let fileName = null;
    if (proposal) {
      const tile = worldTile(issue.x, issue.z);
      fileName = overrideFileName(tile);
      const full = path.join(overridesDir, fileName);
      const existing = readJson(full, []);
      const made = buildPatch(issue, proposal, { note, date: today(), id: '' });
      const { id: _drop, ...rest } = made;
      const merged = mergePatch(existing, tile, rest);
      fs.mkdirSync(overridesDir, { recursive: true });
      fs.writeFileSync(full, JSON.stringify(merged.patches, null, 2) + '\n');
      patch = merged.patch;
    }
    const entry = { id: `m${Date.now().toString(36)}`, ts: new Date().toISOString(), text: inboxText(issue, proposal, note, patch?.id ?? null, fileName ? `overrides/${fileName}` : null), source: 'inspector' };
    fs.mkdirSync(path.dirname(inboxFile), { recursive: true });
    fs.appendFileSync(inboxFile, JSON.stringify(entry) + '\n');
    return [200, { ok: true, patch, file: fileName, inbox: entry.id }];
  }

  async function openInGame(body) {
    const x = Number(body.x);
    const z = Number(body.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return [400, { ok: false, message: 'Missing position.' }];
    const client = new GodotDebugClient();
    try {
      await client.connect(gamePort, { timeoutMs: 1200 });
    } catch {
      return [200, { ok: false, message: 'No game is running. Start it with "npm run play" or run the game with --debug, then press the button again.' }];
    }
    try {
      const moved = await client.call('teleport', [x, 0, z]);
      if (!moved) return [200, { ok: false, message: 'The game is running but has no player to move yet.' }];
      await client.call('frames', 2);
      const pos = client.snapshot?.state?.player?.pos ?? null;
      return [200, { ok: true, message: 'The game is now at this spot.', pos }];
    } catch (e) {
      return [200, { ok: false, message: `The game did not answer: ${e.message}` }];
    } finally {
      client.close();
    }
  }

  return async function handle(req, res, url) {
    const p = url.pathname;
    try {
      if (req.method === 'GET' && (p === '/inspector' || p === '/inspector/')) return serveStatic(res, path.join(HERE, 'web'), 'index.html') || send(res, 404, 'missing page', 'text/plain'), true;
      if (req.method === 'GET' && p.startsWith('/inspector/vendor/three/')) {
        const root = path.join(ROOT, 'node_modules', 'three');
        const rel = p.slice('/inspector/vendor/three/'.length);
        if (!/^(build|examples\/jsm)\//.test(rel)) return send(res, 404, 'not found', 'text/plain'), true;
        return serveStatic(res, root, rel) || send(res, 404, 'not found', 'text/plain'), true;
      }
      if (req.method === 'GET' && p.startsWith('/inspector/data/')) {
        const rel = p.slice('/inspector/data/'.length);
        if (!/^(issues\.json|context\.json|lanes\.json|tiles\/[\w.-]+)$/.test(rel)) return send(res, 404, 'not found', 'text/plain'), true;
        return serveStatic(res, dataDir, rel) || send(res, 404, 'not found', 'text/plain'), true;
      }
      if (req.method === 'GET' && p.startsWith('/inspector/')) {
        const rel = p.slice('/inspector/'.length);
        if (!/^(web\/[\w.-]+|lib\.ts|ktl1\.ts|describe\.ts)$/.test(rel) || rel.includes('.test.')) return send(res, 404, 'not found', 'text/plain'), true;
        return serveStatic(res, HERE, rel, { stripTs: true }) || send(res, 404, 'not found', 'text/plain'), true;
      }
      if (req.method === 'GET' && p === '/favicon.ico') return send(res, 204, '', 'text/plain'), true;
      if (!p.startsWith('/api/inspector/')) return false;
      if (req.method === 'GET' && p === '/api/inspector/status') {
        const f = ready() ? loadIssues() : null;
        return send(res, 200, { ready: ready(), counts: f ? { issues: f.issues.length } : null, layers: { lanes: fs.existsSync(path.join(dataDir, 'lanes.json')) } }), true;
      }
      if (req.method === 'GET' && p === '/api/inspector/picks') return send(res, 200, picks()), true;
      if (req.method === 'POST' && p === '/api/inspector/pick') {
        const [code, body] = await pick(JSON.parse((await readBody(req)).toString() || '{}'));
        return send(res, code, body), true;
      }
      if (req.method === 'POST' && p === '/api/inspector/open-in-game') {
        const [code, body] = await openInGame(JSON.parse((await readBody(req)).toString() || '{}'));
        return send(res, code, body), true;
      }
      return send(res, 404, { error: 'not found' }), true;
    } catch (e) {
      send(res, 500, { error: String(e.message || e) });
      return true;
    }
  };
}
