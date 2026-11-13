// Map inspector server part (P1-001, P1-011). The dashboard mounts it on its own port (harness/bin/dashboard.mjs), and
// serve.mjs runs it alone for the tests. `inspectorHandler(options)` returns async (req, res, url) => boolean: true
// when it answered the request. No outside host is ever contacted; the only socket it opens besides the page itself
// is the game's debug port on 127.0.0.1 (the "Open in game" button).
//
//   GET  /inspector/                      the page (tools/inspector/web/)
//   GET  /inspector/<file>                page files; .ts files go out with their types stripped
//   GET  /inspector/vendor/three/<path>   three.js from node_modules (a dev dependency of the harness only)
//   GET  /inspector/data/<file>           issues.json, context.json, lanes.json, health.json, tiles/index.json, tiles/*.ktl from the data folder
//                                         (harness/reports/map/, written by `npm run bake -- pilot`; the file contract is in
//                                         tools/bake/report/inspector.ts and tools/bake/repair/engine.ts issueRecords)
//   GET  /api/inspector/status            { ready, counts, layers: { lanes, health } } (lanes: the lane model's layer file is there)
//   GET  /api/inspector/picks             what has been picked so far, read from the override files
//   POST /api/inspector/pick              { issue, proposal: index | null, note } writes the patch and the inbox line
//   POST /api/inspector/set-lanes         { edge, lanes, x, z, note } writes a set_lanes patch for a road edge of the lanes layer and the inbox line
//   POST /api/inspector/add               { kind, points: [[x, z], ...], settings, reference: { link, date }, note } writes an add
//                                         patch (a drawn road, median, footpath, crossing or barrier, P1-045) and the inbox line
//   POST /api/inspector/open-in-game      { x, z } teleports the running game (--debug) to the spot
import fs from 'node:fs';
import path from 'node:path';
import module from 'node:module';
import { fileURLToPath } from 'node:url';
import { GodotDebugClient } from '../../harness/bin/godotclient.mjs';
import { worldToGeo } from '../geo/projection.ts';
import { buildPatch, inboxText, mergePatch, nextPatchId, overrideFileName, worldTile } from './lib.ts';
import { driveLaneCount, lanesInboxText, lanesIssueId } from './lanes.ts';
import { addInboxText, addInputProblems, buildAddPatch, kindInfo, mapRoads } from './adds.ts';
import { patchProblems } from '../bake/repair/overrides.ts';

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
      for (const p of readJson(path.join(overridesDir, f), [])) if (p.source === 'inspector') out[p.issue] = { patch: p.id, action: p.action, why: p.why, file: f, params: p.params };
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

  // the lanes layer is about 10 MB: parsed once per file version, only when a lane count is set
  let lanesCache = { mtime: 0, file: null };
  const loadLanes = () => {
    const f = path.join(dataDir, 'lanes.json');
    const m = fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0;
    if (m !== lanesCache.mtime) lanesCache = { mtime: m, file: m ? readJson(f, null) : null };
    return lanesCache.file;
  };

  /** A lane count the owner sets on a road edge of the lanes layer: a set_lanes patch in the override file of the clicked tile. */
  async function setLanes(body) {
    const layer = loadLanes();
    if (!layer) return [404, { error: 'There is no lanes layer yet. Run "npm run bake -- pilot --stage lanes --offline" first.' }];
    const edge = String(body.edge ?? '');
    const strips = layer.strips.filter((s) => s.edge === edge);
    if (!strips.length) return [404, { error: `no road ${edge} in the lanes layer` }];
    if (strips.every((s) => s.kind === 'zone')) return [400, { error: 'A split zone has no lane count of its own. Set the lanes of one of the roads beside it.' }];
    const lanes = Number(body.lanes);
    if (!Number.isInteger(lanes) || lanes < 1 || lanes > 12) return [400, { error: 'The lane count must be a whole number from 1 to 12.' }];
    const x = Number(body.x);
    const z = Number(body.z);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return [400, { error: 'Missing position.' }];
    if (!layer.origin || !layer.offset) return [400, { error: 'The lanes layer has no frame origin. Bake the lanes step again.' }];
    // the anchor of the patch: the clicked spot as latitude and longitude, in the block frame of the bake (world = block + offset)
    const geo = worldToGeo(x - layer.offset[0], z - layer.offset[1], layer.origin);
    const note = String(body.note ?? '').trim();
    const tile = worldTile(x, z);
    const fileName = overrideFileName(tile);
    const full = path.join(overridesDir, fileName);
    const existing = readJson(full, []);
    const from = Math.max(...strips.map(driveLaneCount));
    const name = strips.find((s) => s.name)?.name || `the ${strips[0].cls.replace(/_link$/, '').replace('_', ' ')} ${edge}`;
    const patch = {
      issue: lanesIssueId(edge), action: 'set_lanes',
      target: { ids: [edge], anchor: { lat: Math.round(geo.lat * 1e7) / 1e7, lon: Math.round(geo.lon * 1e7) / 1e7 }, tolerance_m: 15 },
      params: { on: edge, lanes, from: 'ahead' },
      why: note || `Lane count set to ${lanes} in the map inspector`, by: 'owner', source: 'inspector', date: today(),
    };
    const merged = mergePatch(existing, tile, patch);
    fs.mkdirSync(overridesDir, { recursive: true });
    fs.writeFileSync(full, JSON.stringify(merged.patches, null, 2) + '\n');
    const entry = { id: `m${Date.now().toString(36)}`, ts: new Date().toISOString(), text: lanesInboxText(name, x, z, from, lanes, note, merged.patch.id, fileName), source: 'inspector' };
    fs.mkdirSync(path.dirname(inboxFile), { recursive: true });
    fs.appendFileSync(inboxFile, JSON.stringify(entry) + '\n');
    return [200, { ok: true, patch: merged.patch, file: fileName, inbox: entry.id }];
  }

  // the roads of context.json, for the ids a drawing names (parsed once per file version)
  let roadsCache = { mtime: 0, roads: [] };
  const loadRoads = () => {
    const f = path.join(dataDir, 'context.json');
    const m = fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0;
    if (m !== roadsCache.mtime) roadsCache = { mtime: m, roads: m ? mapRoads(readJson(f, null)) : [] };
    return roadsCache.roads;
  };

  /** A feature the owner drew on the map (P1-045): an add patch in the override file of the first point's tile. */
  async function addFeature(body) {
    const input = { kind: String(body.kind ?? ''), points: Array.isArray(body.points) ? body.points.map((p) => [Number(p?.[0]), Number(p?.[1])]) : [], settings: body.settings ?? {}, reference: { link: String(body.reference?.link ?? ''), date: String(body.reference?.date ?? '') }, note: String(body.note ?? '') };
    const problems = addInputProblems(input);
    if (problems.length) return [400, { error: problems.join(' ') }];
    const layer = loadLanes();
    if (!layer?.origin || !layer?.offset) return [404, { error: 'The map has no frame yet. Run "npm run bake -- pilot --stage lanes --offline" first.' }];
    const toGeo = (x, z) => worldToGeo(x - layer.offset[0], z - layer.offset[1], layer.origin);
    const made = buildAddPatch(input, { date: today(), toGeo, roads: loadRoads() });
    const [x0, z0] = input.points[0];
    const tile = worldTile(x0, z0);
    const fileName = overrideFileName(tile);
    const full = path.join(overridesDir, fileName);
    const existing = readJson(full, []);
    const id = nextPatchId(existing, tile);
    const patch = { id, ...made, issue: `add:${id}` };
    // the same check the bake makes when it reads the file: a patch it would refuse is never written
    const bad = patchProblems(patch);
    if (bad.length) return [400, { error: `The patch would not be valid: ${bad.join('; ')}` }];
    const merged = mergePatch(existing, tile, patch);
    fs.mkdirSync(overridesDir, { recursive: true });
    fs.writeFileSync(full, JSON.stringify(merged.patches, null, 2) + '\n');
    const entry = { id: `m${Date.now().toString(36)}`, ts: new Date().toISOString(), text: addInboxText(kindInfo(input.kind), x0, z0, input.points.length, merged.patch.id, fileName, input.note), source: 'inspector' };
    fs.mkdirSync(path.dirname(inboxFile), { recursive: true });
    fs.appendFileSync(inboxFile, JSON.stringify(entry) + '\n');
    return [200, { ok: true, patch: merged.patch, file: fileName, inbox: entry.id }];
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
        if (!/^(issues\.json|context\.json|lanes\.json|health\.json|tiles\/[\w.-]+)$/.test(rel)) return send(res, 404, 'not found', 'text/plain'), true;
        return serveStatic(res, dataDir, rel) || send(res, 404, 'not found', 'text/plain'), true;
      }
      if (req.method === 'GET' && p.startsWith('/inspector/')) {
        const rel = p.slice('/inspector/'.length);
        if (!/^(web\/[\w.-]+|lib\.ts|lanes\.ts|adds\.ts|ktl1\.ts|describe\.ts)$/.test(rel) || rel.includes('.test.')) return send(res, 404, 'not found', 'text/plain'), true;
        return serveStatic(res, HERE, rel, { stripTs: true }) || send(res, 404, 'not found', 'text/plain'), true;
      }
      if (req.method === 'GET' && p === '/favicon.ico') return send(res, 204, '', 'text/plain'), true;
      if (!p.startsWith('/api/inspector/')) return false;
      if (req.method === 'GET' && p === '/api/inspector/status') {
        const f = ready() ? loadIssues() : null;
        return send(res, 200, { ready: ready(), counts: f ? { issues: f.issues.length } : null, layers: { lanes: fs.existsSync(path.join(dataDir, 'lanes.json')), health: fs.existsSync(path.join(dataDir, 'health.json')) } }), true;
      }
      if (req.method === 'GET' && p === '/api/inspector/picks') return send(res, 200, picks()), true;
      if (req.method === 'POST' && p === '/api/inspector/pick') {
        const [code, body] = await pick(JSON.parse((await readBody(req)).toString() || '{}'));
        return send(res, code, body), true;
      }
      if (req.method === 'POST' && p === '/api/inspector/set-lanes') {
        const [code, body] = await setLanes(JSON.parse((await readBody(req)).toString() || '{}'));
        return send(res, code, body), true;
      }
      if (req.method === 'POST' && p === '/api/inspector/add') {
        const [code, body] = await addFeature(JSON.parse((await readBody(req)).toString() || '{}'));
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
