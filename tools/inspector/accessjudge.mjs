#!/usr/bin/env node
// The access judge pass (P2-043, follows P2-042). Roads the access rules close to cars on common sense alone (an old city
// lane of 3 m or more: wide enough for a car on paper, a gali in fact?) are looked at from above, the way a person would:
// each site is a satellite picture (Esri World Imagery, 0.27 m per pixel) with the borderline edges drawn over it and
// numbered. Whoever judges reads the sheets and writes one decision per site; `apply` turns each into a rule of
// harness/data/access.json (by "judge", with the reason and the sheet as its reference). The bake reads the file and a
// judge decision wins over the rules (an owner edit wins over both: graph/access.ts).
//
//   node tools/inspector/accessjudge.mjs list [--min-width 3.0] [--radius 100]
//       the borderline edges, grouped into sites, written to harness/reports/access/borderline.json, count printed
//   node tools/inspector/accessjudge.mjs sheets [--per 9] [--half 70] [--offline] [--spot 30 --seed 7]
//       sheets of the sites (and spot-check.json plus its sheets for a seeded sample of the closed context edges)
//   node tools/inspector/accessjudge.mjs compare --site 34 --name harness/reports/access/before_after.png [--half 110] [--offline]
//       one site twice over its satellite picture: access before the judge pass (rules only) and after it
//   node tools/inspector/accessjudge.mjs apply <decisions.json> [--date 2026-11-14] [--set borderline|spot]
//       decisions.json: [{ "site": 12, "pick": "closed" | "open" | "walk" | "private", "why": "...", "edges": [1, 3] }]; edges (the numbers
//       on the sheet) limits the decision to those edges, else it holds for the whole site
//
// Reads data/pilot_centre/graph_repaired.json (the repaired graph of the last pilot bake) and runs the access step on it,
// so it needs no bake of its own. Block metres: origin India Gate, east +X, north -Z.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { projector } from '../geo/projection.ts';
import { runAccessStep } from '../bake/sources/accessio.ts';
import { readAccessFile, writeAccessFile } from '../bake/graph/accessfile.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const OUT = path.join(ROOT, 'harness', 'reports', 'access');
const GRAPH = path.join(ROOT, 'data', 'pilot_centre', 'graph_repaired.json');
const ACCESS = path.join(ROOT, 'harness', 'data', 'access.json');
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(n);
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The modes a decision gives: open (a road for every vehicle), closed (the old city gali), walk (walkers and cycles), private (open, never a through route). */
export const PICKS = {
  open: ['car', 'auto', 'two_wheeler', 'cycle', 'foot', 'emergency'],
  closed: ['two_wheeler', 'cycle', 'foot', 'emergency'],
  walk: ['cycle', 'foot', 'emergency'],
  // a drive inside a compound or society: every vehicle, never a through route for traffic
  private: ['car', 'auto', 'two_wheeler', 'cycle', 'foot', 'emergency'],
};

const OLD_CITY_RULES = new Set(['old_city_galis', 'old_city_dense_lanes']);
const mid = (e) => e.pts[Math.floor(e.pts.length / 2)];

/** The last pilot bake's repaired graph with the access step run on it. */
function loadAccess() {
  const g = JSON.parse(fs.readFileSync(GRAPH, 'utf8'));
  const proj = projector(g.origin);
  const r = runAccessStep(ROOT, (lat, lon) => proj.toWorld(lat, lon), g);
  return { g, proj, access: r.access, record: r.record };
}

/** A small deterministic generator (mulberry32) for the seeded spot check. */
function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Groups edges into sites: the first edge in north to south, west to east order takes every edge within `radius` of its middle. */
export function groupSites(edges, radius) {
  const order = [...edges].sort((a, b) => mid(a).z - mid(b).z || mid(a).x - mid(b).x);
  const done = new Set();
  const sites = [];
  for (const s of order) {
    if (done.has(s.id)) continue;
    const c = mid(s);
    const list = [];
    for (const f of order) {
      if (done.has(f.id)) continue;
      const m = mid(f);
      if (Math.hypot(m.x - c.x, m.z - c.z) <= radius) {
        done.add(f.id);
        list.push(f);
      }
    }
    sites.push(list);
  }
  return sites;
}

const edgeRecord = (e, a, proj) => {
  const step = Math.max(1, Math.floor(e.pts.length / 14));
  const pts = e.pts.filter((_, i) => i % step === 0 || i === e.pts.length - 1).map((p) => [Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10]);
  const m = mid(e);
  const geo = proj.toGeo(m.x, m.z);
  return { id: e.id, name: e.name || '', cls: e.road.cls, width: e.road.width, len: Math.round(e.len), ways: [...new Set(e.pieces.map((p) => p.way))], modes: a.modes, reason: a.reason, rule: a.rule ?? null, mid: [Math.round(m.x * 10) / 10, Math.round(m.z * 10) / 10], lat: Math.round(geo.lat * 1e7) / 1e7, lon: Math.round(geo.lon * 1e7) / 1e7, pts };
};

function siteRecord(n, list, proj, access) {
  const edges = list.map((e) => edgeRecord(e, access.get(e.id), proj));
  const xs = edges.map((e) => e.mid[0]);
  const zs = edges.map((e) => e.mid[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const geo = proj.toGeo(cx, cz);
  return { n, cx: Math.round(cx * 10) / 10, cz: Math.round(cz * 10) / 10, lat: Math.round(geo.lat * 1e7) / 1e7, lon: Math.round(geo.lon * 1e7) / 1e7, lengthM: edges.reduce((s, e) => s + e.len, 0), edges };
}

function list() {
  const minW = Number(arg('--min-width', '3.0'));
  const radius = Number(arg('--radius', '100'));
  const { g, proj, access } = loadAccess();
  const edges = g.edges.filter((e) => {
    const a = access.get(e.id);
    return a.reason === 'context' && a.rule !== undefined && OLD_CITY_RULES.has(a.rule) && e.road.width >= minW;
  });
  const sites = groupSites(edges, radius).map((s, i) => siteRecord(i + 1, s, proj, access));
  fs.mkdirSync(OUT, { recursive: true });
  const widths = { '3 to 4.5 m': 0, '4.5 m and wider': 0 };
  for (const e of edges) widths[e.road.width <= 4.5 ? '3 to 4.5 m' : '4.5 m and wider']++;
  const doc = { _doc: 'Borderline access edges of the last pilot bake (tools/inspector/accessjudge.mjs list): old city context rules (old_city_galis, old_city_dense_lanes) that close a lane of minWidthM or more to cars. A site is every such edge within radiusM of the first one (north to south, west to east).', minWidthM: minW, radiusM: radius, edges: edges.length, km: Math.round(edges.reduce((s, e) => s + e.len, 0) / 10) / 100, byWidth: widths, sites };
  fs.writeFileSync(path.join(OUT, 'borderline.json'), JSON.stringify(doc) + '\n');
  console.log(`borderline edges: ${edges.length} (${doc.km} km), ${widths['3 to 4.5 m']} of 3 to 4.5 m and ${widths['4.5 m and wider']} wider, in ${sites.length} sites`);
  console.log(path.relative(ROOT, path.join(OUT, 'borderline.json')));
}

/** The spot check: a seeded sample of the edges the old city context rules closed, narrow ones and wide ones. */
function spot() {
  const n = Number(arg('--spot', '30'));
  const { g, proj, access, record } = loadAccess();
  const all = g.edges.filter((e) => access.get(e.id).reason === 'context' && OLD_CITY_RULES.has(access.get(e.id).rule));
  const rand = rng(Number(arg('--seed', '7')));
  const pool = [...all];
  const pick = [];
  while (pick.length < n && pool.length) pick.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  pick.sort((a, b) => mid(a).z - mid(b).z || mid(a).x - mid(b).x);
  const sites = pick.map((e, i) => siteRecord(i + 1, [e], proj, access));
  fs.mkdirSync(OUT, { recursive: true });
  const doc = { _doc: 'Seeded sample of the edges the old city context rules close to cars (tools/inspector/accessjudge.mjs sheets --spot): each site is one edge.', seed: Number(arg('--seed', '7')), population: all.length, contextEdges: record.byReason.context.edges, sites };
  fs.writeFileSync(path.join(OUT, 'spot-check.json'), JSON.stringify(doc) + '\n');
  return doc;
}

// ---------------------------------------------------------------- the pictures

/** Pixels of a picture of `half` metres around a point: the imagery is 0.27 m per pixel here and the server refuses a finer request. */
const satPx = (half) => Math.max(64, Math.min(640, Math.floor((2 * half) / 0.285)));
const satUrl = (proj, cx, cz, half) => {
  const a = proj.toGeo(cx - half, cz + half);
  const b = proj.toGeo(cx + half, cz - half);
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${a.lon.toFixed(7)},${a.lat.toFixed(7)},${b.lon.toFixed(7)},${b.lat.toFixed(7)}&bboxSR=4326&imageSR=3857&size=${satPx(half)},${satPx(half)}&format=jpg&f=image`;
};

async function satellite(proj, cx, cz, half, offline) {
  const dir = path.join(OUT, 'sat');
  const file = path.join(dir, `${Math.round(cx)}_${Math.round(cz)}_${half}.jpg`);
  if (fs.existsSync(file)) return fs.readFileSync(file);
  if (offline) return null;
  const url = satUrl(proj, cx, cz, half);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'map-judge/1.0' }, signal: AbortSignal.timeout(20000) });
      const buf = Buffer.from(await res.arrayBuffer());
      if (res.ok && buf.length > 2000) {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, buf);
        return buf;
      }
    } catch {
      // try again
    }
  }
  return null;
}

const PANEL = 540;

/** One site as an image: the satellite picture with its edges drawn over it (colour by what the bake decided) and numbered. */
async function siteImage(site, half, photo, kind) {
  const s = PANEL / (2 * half);
  const X = (x) => f1((x - site.cx + half) * s);
  const Y = (z) => f1((z - site.cz + half) * s);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${PANEL}" height="${PANEL}" viewBox="0 0 ${PANEL} ${PANEL}">`];
  if (photo) out.push(`<image x="0" y="0" width="${PANEL}" height="${PANEL}" preserveAspectRatio="none" xlink:href="data:image/jpeg;base64,${photo.toString('base64')}"/>`);
  else out.push(`<rect width="${PANEL}" height="${PANEL}" fill="#ddd"/><text x="16" y="40" font-family="Helvetica" font-size="16">no picture (offline)</text>`);
  site.edges.forEach((e, k) => {
    const pts = e.pts.map((p) => `${X(p[0])},${Y(p[1])}`).join(' ');
    out.push(`<polyline points="${pts}" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="${f1(Math.max(2.2, e.width * s * 0.35) + 1.6)}" stroke-linecap="round"/>`);
    out.push(`<polyline points="${pts}" fill="none" stroke="#ff9100" stroke-width="${f1(Math.max(2.2, e.width * s * 0.35))}" stroke-opacity="0.9" stroke-linecap="round"/>`);
    const lx = Number(X(e.mid[0]));
    const ly = Number(Y(e.mid[1]));
    out.push(`<circle cx="${f1(lx)}" cy="${f1(ly - 9)}" r="9" fill="#fff" stroke="#111" stroke-width="1.2"/><text x="${f1(lx)}" y="${f1(ly - 4.5)}" text-anchor="middle" font-family="Helvetica" font-size="12" font-weight="bold" fill="#111">${k + 1}</text>`);
  });
  out.push(`<rect x="10" y="${PANEL - 16}" width="${f1(20 * s)}" height="4" fill="#fff"/><text x="10" y="${PANEL - 20}" font-family="Helvetica" font-size="11" fill="#fff" stroke="#000" stroke-width="0.4">20 m</text>`);
  out.push(`<text x="${PANEL - 22}" y="18" font-family="Helvetica" font-size="13" font-weight="bold" fill="#fff" stroke="#000" stroke-width="0.4">N ↑</text>`);
  out.push('</svg>');
  const widths = site.edges.map((e, k) => `${k + 1}:${e.width}m/${e.len}m${e.cls === 'service' ? 's' : e.cls === 'unclassified' ? 'u' : ''}`).join(' ');
  const names = [...new Set(site.edges.map((e) => e.name).filter(Boolean))].map((n) => n.slice(0, 20)).join(', ');
  const lines = [widths + (names ? `  | ${names}` : '')];
  const more = '';
  const head = 40;
  const text = `<svg xmlns="http://www.w3.org/2000/svg" width="${PANEL}" height="${head}"><rect width="100%" height="100%" fill="#222"/><text x="6" y="16" font-family="Helvetica" font-size="14" font-weight="bold" fill="#fff">${kind} ${site.n}  (${site.edges.length} edge${site.edges.length > 1 ? 's' : ''}, ${site.lengthM} m)</text><text x="6" y="33" font-family="Helvetica" font-size="10.5" fill="#ffd9a0">${esc(lines.join(' | ') + more).slice(0, 150)}</text></svg>`;
  const body = await sharp(Buffer.from(out.join(''))).png().toBuffer();
  return sharp({ create: { width: PANEL, height: PANEL + head, channels: 3, background: '#222' } }).composite([{ input: Buffer.from(text), left: 0, top: 0 }, { input: body, left: 0, top: head }]).png().toBuffer();
}

async function drawSheets(doc, name, kind, per, half, offline, proj) {
  const cols = Math.ceil(Math.sqrt(per));
  const files = [];
  const sheetOf = [];
  for (let s = 0; s * per < doc.sites.length; s++) {
    const group = doc.sites.slice(s * per, s * per + per);
    const imgs = [];
    for (const site of group) imgs.push(await siteImage(site, half, await satellite(proj, site.cx, site.cz, half, offline), kind));
    const rows = Math.ceil(group.length / cols);
    const file = path.join(OUT, `${name}_${String(s + 1).padStart(2, '0')}.jpg`);
    await sharp({ create: { width: cols * (PANEL + 8) + 8, height: rows * (PANEL + 48) + 8, channels: 3, background: '#111' } })
      .composite(imgs.map((b, k) => ({ input: b, left: 8 + (k % cols) * (PANEL + 8), top: 8 + Math.floor(k / cols) * (PANEL + 48) }))).jpeg({ quality: 80 }).toFile(file);
    files.push(path.relative(ROOT, file));
    for (const site of group) sheetOf.push({ n: site.n, sheet: s + 1 });
  }
  return { files, sheetOf };
}

async function sheets() {
  const per = Number(arg('--per', '9'));
  const half = Number(arg('--half', '70'));
  const offline = has('--offline');
  const file = path.join(OUT, 'borderline.json');
  if (!fs.existsSync(file)) throw new Error('run `list` first');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { proj } = loadAccess();
  let r = await drawSheets(doc, 'sheet', 'site', per, half, offline, proj);
  doc.perSheet = per;
  doc.halfM = half;
  fs.writeFileSync(file, JSON.stringify(doc) + '\n');
  console.log(`${doc.sites.length} sites on ${r.files.length} sheets: ${r.files[0]} to ${r.files[r.files.length - 1]}`);
  if (has('--spot')) {
    const sp = spot();
    r = await drawSheets(sp, 'spot', 'spot', per, half, offline, proj);
    sp.perSheet = per;
    sp.halfM = half;
    fs.writeFileSync(path.join(OUT, 'spot-check.json'), JSON.stringify(sp) + '\n');
    console.log(`${sp.sites.length} spot check sites on ${r.files.length} sheets: ${r.files[0]} to ${r.files[r.files.length - 1]}`);
  }
}

// ---------------------------------------------------------------- the decisions

/** The circle (lat, lon, radius) that holds every point of the edges, with 1.5 m to spare. */
function circleOf(edges, proj) {
  const pts = edges.flatMap((e) => e.pts);
  const cx = (Math.min(...pts.map((p) => p[0])) + Math.max(...pts.map((p) => p[0]))) / 2;
  const cz = (Math.min(...pts.map((p) => p[1])) + Math.max(...pts.map((p) => p[1]))) / 2;
  const r = Math.max(...pts.map((p) => Math.hypot(p[0] - cx, p[1] - cz))) + 1.5;
  const g = proj.toGeo(cx, cz);
  return { lat: Math.round(g.lat * 1e7) / 1e7, lon: Math.round(g.lon * 1e7) / 1e7, radiusM: Math.ceil(r) };
}

function apply() {
  const decisionsFile = args[1];
  if (!decisionsFile) throw new Error('apply needs a decisions file');
  const set = arg('--set', 'borderline');
  const date = arg('--date', new Date().toISOString().slice(0, 10));
  const doc = JSON.parse(fs.readFileSync(path.join(OUT, set === 'spot' ? 'spot-check.json' : 'borderline.json'), 'utf8'));
  const decisions = JSON.parse(fs.readFileSync(path.resolve(decisionsFile), 'utf8'));
  const { proj } = loadAccess();
  const file = readAccessFile(ACCESS);
  const idPrefix = set === 'spot' ? 'judge_spot' : 'judge_site';
  // every judge rule of this set is made again from the decisions: a second apply replaces the first
  file.rules = file.rules.filter((r) => !(r.by === 'judge' && r.id.startsWith(`${idPrefix}_`)));
  const sheetName = set === 'spot' ? 'spot' : 'sheet';
  let made = 0;
  // a decision for a whole site first, then the decisions for single edges of a site: a later rule of one rank wins, and two
  // neighbouring sites on one long street must not let the second site's whole-site rule undo the first site's exception
  const ordered = [...decisions].sort((a, b) => (a.edges ? 1 : 0) - (b.edges ? 1 : 0));
  for (const d of ordered) {
    const site = doc.sites.find((s) => s.n === d.site);
    if (!site) throw new Error(`no site ${d.site}`);
    if (!PICKS[d.pick]) throw new Error(`site ${d.site}: pick must be ${Object.keys(PICKS).join(', ')}`);
    if (!d.why || d.why.length < 20) throw new Error(`site ${d.site}: a decision needs its reasoning (a sentence)`);
    const chosen = d.edges ? d.edges.map((k) => site.edges[k - 1]) : site.edges;
    if (chosen.some((e) => !e)) throw new Error(`site ${d.site}: an edge number is not on the sheet`);
    const ways = [...new Set(chosen.flatMap((e) => e.ways))];
    const perWay = d.edges ? 'e' + d.edges.join('_') : '';
    file.rules.push({
      id: `${idPrefix}_${String(site.n).padStart(3, '0')}${perWay ? '_' + perWay : ''}_${d.pick}`,
      by: 'judge',
      kind: 'context',
      why: d.why,
      refs: [`harness/reports/access/${sheetName}_${String(Math.floor((site.n - 1) / (doc.perSheet ?? 9)) + 1).padStart(2, '0')}.jpg (site ${site.n}, Esri World Imagery, judged ${date})`, `harness/reports/access/${set === 'spot' ? 'spotcheck.md' : 'borderline.json'}`],
      modes: PICKS[d.pick],
      ...(d.pick === 'private' ? { private: true } : {}),
      barrier: 'none',
      match: { ways, within: circleOf(chosen, proj) },
    });
    made++;
  }
  writeAccessFile(ACCESS, file);
  console.log(`${made} judge rules written to harness/data/access.json (${set})`);
}

/** The access of every edge with the judge and owner decisions left out (the state before this pass). */
function loadAccessBefore() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'access-before-'));
  fs.mkdirSync(path.join(tmp, 'harness', 'data'), { recursive: true });
  fs.symlinkSync(path.join(ROOT, 'harness', 'data', 'areas'), path.join(tmp, 'harness', 'data', 'areas'));
  const file = readAccessFile(ACCESS);
  file.rules = file.rules.filter((r) => r.by === 'rule');
  writeAccessFile(path.join(tmp, 'harness', 'data', 'access.json'), file);
  const g = JSON.parse(fs.readFileSync(GRAPH, 'utf8'));
  const proj = projector(g.origin);
  const r = runAccessStep(tmp, (lat, lon) => proj.toWorld(lat, lon), g);
  fs.rmSync(tmp, { recursive: true, force: true });
  return r.access;
}

async function compare() {
  const n = Number(arg('--site', '1'));
  const half = Number(arg('--half', '110'));
  const name = path.resolve(ROOT, arg('--name', 'harness/reports/access/before_after.png'));
  const doc = JSON.parse(fs.readFileSync(path.join(OUT, 'borderline.json'), 'utf8'));
  const site = doc.sites.find((x) => x.n === n);
  if (!site) throw new Error(`no site ${n}`);
  const { g, proj, access: after } = loadAccess();
  const before = loadAccessBefore();
  const photo = await satellite(proj, site.cx, site.cz, doc.halfM ?? 140, has('--offline'));
  const px = 560;
  const s = px / (2 * half);
  // the picture was cut for halfM; show its middle part `half` metres around the site
  const full = doc.halfM ?? 140;
  const crop = photo ? await sharp(photo).metadata().then(async (m) => {
    const k = (m.width ?? px) / (2 * full);
    const w = Math.round(2 * half * k);
    const o = Math.round((full - half) * k);
    return sharp(photo).extract({ left: o, top: o, width: w, height: w }).resize(px, px).jpeg().toBuffer();
  }) : null;
  const X = (x) => f1((x - site.cx + half) * s);
  const Y = (z) => f1((z - site.cz + half) * s);
  const draw = (acc, title, note) => {
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${px}" height="${px + 54}" viewBox="0 0 ${px} ${px + 54}"><rect width="100%" height="100%" fill="#222"/>`];
    out.push(`<text x="8" y="20" font-family="Helvetica" font-size="16" font-weight="bold" fill="#fff">${esc(title)}</text><text x="8" y="42" font-family="Helvetica" font-size="12" fill="#ddd">${esc(note)}</text>`);
    if (crop) out.push(`<image x="0" y="54" width="${px}" height="${px}" xlink:href="data:image/jpeg;base64,${crop.toString('base64')}"/>`);
    for (const e of g.edges) {
      const m = e.pts[Math.floor(e.pts.length / 2)];
      if (Math.abs(m.x - site.cx) > half + 20 || Math.abs(m.z - site.cz) > half + 20) continue;
      const a = acc.get(e.id);
      const car = a.modes.includes('car');
      const colour = a.reason === 'judge' ? (car ? '#2ecc71' : '#b388ff') : car ? null : '#ff4d4f';
      if (!colour) continue;
      const pts = e.pts.map((p) => `${X(p.x)},${Number(Y(p.z)) + 54}`).join(' ');
      out.push(`<polyline points="${pts}" fill="none" stroke="#000" stroke-opacity="0.4" stroke-width="6" stroke-linecap="round"/><polyline points="${pts}" fill="none" stroke="${colour}" stroke-width="3.6" stroke-linecap="round"/>`);
    }
    out.push('</svg>');
    return sharp(Buffer.from(out.join(''))).png().toBuffer();
  };
  const A = await draw(before, 'Before: the old city rule', 'red: closed to cars. The rule closes every lane of the old city cell.');
  const B = await draw(after, 'After: the judge pass', 'red: closed by a rule or the width; violet: judged closed; green: judged open to cars');
  const caption = `<svg xmlns="http://www.w3.org/2000/svg" width="${px * 2 + 12}" height="30"><rect width="100%" height="100%" fill="#222"/><text x="8" y="20" font-family="Helvetica" font-size="13" fill="#fff">Site ${n} (${doc.sites.find((x) => x.n === n).edges.map((e) => e.name).filter(Boolean).slice(0, 3).join(', ') || 'unnamed lanes'}), Esri World Imagery, ${half * 2} m across, north up</text></svg>`;
  fs.mkdirSync(path.dirname(name), { recursive: true });
  await sharp({ create: { width: px * 2 + 12, height: px + 54 + 30, channels: 3, background: '#222' } }).composite([{ input: Buffer.from(caption), left: 0, top: 0 }, { input: A, left: 0, top: 30 }, { input: B, left: px + 12, top: 30 }]).png().toFile(name);
  console.log(path.relative(ROOT, name));
}

const cmd = args[0];
if (cmd === 'list') list();
else if (cmd === 'sheets') await sheets();
else if (cmd === 'apply') apply();
else if (cmd === 'compare') await compare();
else {
  console.log('usage: accessjudge.mjs list | sheets [--spot 30] | compare --site N | apply <decisions.json> [--set borderline|spot]');
  process.exit(cmd ? 1 : 0);
}
