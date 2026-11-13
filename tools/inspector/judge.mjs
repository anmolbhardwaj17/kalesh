#!/usr/bin/env node
// The top-view judge pass (P1-030, MAP_REPAIR.md "The owner queue is for genuine questions only"). What the rules
// cannot decide is looked at from above, the way a person would: each open issue of the last bake is drawn north up
// (roads with their widths, footprints, the features of the issue, its proposals as lines A, B, ...) beside the Esri
// World Imagery picture of the same box when the network answers. Whoever judges reads the sheets and writes one
// decision per issue; `apply` turns each into an override patch with the reasoning and the picture as its reference
// (by "judge", source "top-view"), which the bake applies like any patch. A site still unclear is marked "ask": it
// stays open for the owner, with the judge's note on its card.
//
//   node tools/inspector/judge.mjs sheets [--out harness/reports/map/judge] [--half 45] [--offline]
//       sheets of six sites and sites.json (number, issue, proposals, picture link)
//   node tools/inspector/judge.mjs apply <decisions.json> [--date 2026-11-13]
//       decisions.json: [{ "issue": "<id>", "pick": "A" | "B" | "ask", "why": "..." }]
//   node tools/inspector/judge.mjs site --at <x,z> --name <file.png> [--half 60] [--title "..."] [--context <context.json>] [--mark <x,z>]
//       one top view of any place (world metres), for before and after pictures
//
// Reads harness/reports/map/issues.json and context.json (world metres: east +X, north -Z); run a bake first.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { worldToGeo } from '../geo/projection.ts';
import { buildPatch, mergePatch, overrideFileName, worldTile } from './lib.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const MAPDIR = path.join(ROOT, 'harness', 'reports', 'map');
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(n);
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const LETTERS = 'ABCDEF';
const COLOURS = ['#0a8f3c', '#1565c0', '#8e24aa', '#ef6c00'];
const PANEL = 420;

/** The frame of the last bake: issues and context are world metres, block metres plus this offset. */
function frame() {
  const lanes = path.join(MAPDIR, 'lanes.json');
  if (fs.existsSync(lanes)) {
    // the layer file is big: its frame is in the first bytes
    const head = fs.readFileSync(lanes, 'utf8').slice(0, 400);
    const o = /"origin":\{"lat":([-\d.]+),"lon":([-\d.]+)\}/.exec(head);
    const off = /"offset":\[([-\d.]+),([-\d.]+)\]/.exec(head);
    if (o && off) return { origin: { lat: Number(o[1]), lon: Number(o[2]) }, offset: [Number(off[1]), Number(off[2])] };
  }
  return { origin: { lat: 28.612894, lon: 77.229446 }, offset: [621.6, 467.2] };
}
const FRAME = frame();
const geoOf = (x, z) => worldToGeo(x - FRAME.offset[0], z - FRAME.offset[1], FRAME.origin);

/** Roads and footprints of context.json in 100 m cells. */
function indexContext(ctx) {
  const cells = new Map();
  const put = (x0, z0, x1, z1, item) => {
    for (let i = Math.floor(x0 / 100); i <= Math.floor(x1 / 100); i++) {
      for (let j = Math.floor(z0 / 100); j <= Math.floor(z1 / 100); j++) {
        const k = `${i},${j}`;
        (cells.get(k) ?? cells.set(k, []).get(k)).push(item);
      }
    }
  };
  const pts = (p) => { const out = []; for (let k = 0; k + 2 < p.length; k += 3) out.push([p[k], p[k + 2]]); return out; };
  const box = (list) => [Math.min(...list.map((q) => q[0])), Math.min(...list.map((q) => q[1])), Math.max(...list.map((q) => q[0])), Math.max(...list.map((q) => q[1]))];
  for (const r of ctx.roads ?? []) {
    const line = pts(r.p);
    if (line.length < 2) continue;
    const b = box(line);
    put(b[0] - r.w, b[1] - r.w, b[2] + r.w, b[3] + r.w, { kind: 'road', id: r.id ?? '', cls: r.k, w: r.w, name: r.n ?? '', pts: line });
  }
  for (const ring of ctx.buildings ?? []) {
    const line = pts(ring);
    if (line.length < 3) continue;
    const b = box(line);
    put(b[0], b[1], b[2], b[3], { kind: 'building', pts: line });
  }
  return {
    near(x, z, half) {
      const seen = new Set();
      const out = [];
      for (let i = Math.floor((x - half) / 100); i <= Math.floor((x + half) / 100); i++) {
        for (let j = Math.floor((z - half) / 100); j <= Math.floor((z + half) / 100); j++) {
          for (const it of cells.get(`${i},${j}`) ?? []) if (!seen.has(it)) { seen.add(it); out.push(it); }
        }
      }
      return out;
    },
  };
}

const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);

/** One panel as SVG: the map (or the picture with the lines over it), `half` metres around the centre, north up. */
function panelSvg(idx, cx, cz, half, issue, sat, opts = {}) {
  const s = PANEL / (2 * half);
  const X = (x) => f1((x - cx + half) * s);
  const Y = (z) => f1((z - cz + half) * s);
  const line = (pts) => pts.map((q) => `${X(q[0])},${Y(q[1])}`).join(' ');
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${PANEL}" height="${PANEL}" viewBox="0 0 ${PANEL} ${PANEL}">`];
  const items = idx.near(cx, cz, half * 1.5);
  const named = new Set(issue?.features ?? []);
  if (sat) out.push(`<image x="0" y="0" width="${PANEL}" height="${PANEL}" preserveAspectRatio="none" xlink:href="data:image/jpeg;base64,${sat}"/>`);
  else {
    out.push(`<rect width="${PANEL}" height="${PANEL}" fill="#eef0e8"/>`);
    for (const b of items) if (b.kind === 'building') out.push(`<polygon points="${line(b.pts)}" fill="#d9c9a3" stroke="#a8946a" stroke-width="0.7"/>`);
    for (const r of items) if (r.kind === 'road') out.push(`<polyline points="${line(r.pts)}" fill="none" stroke="${MAJOR.has(r.cls) ? '#8d939c' : '#b4b8bf'}" stroke-width="${f1(Math.max(1.2, r.w * s))}" stroke-linecap="butt" stroke-linejoin="round"/>`);
  }
  for (const r of items) {
    if (r.kind !== 'road') continue;
    const hit = named.has(r.id);
    out.push(`<polyline points="${line(r.pts)}" fill="none" stroke="${hit ? '#ff6d00' : sat ? '#ffffff' : '#555b66'}" stroke-width="${hit ? 2.2 : sat ? 0.9 : 0.7}" ${hit ? '' : 'stroke-dasharray="5 3"'} opacity="${sat && !hit ? 0.75 : 1}"/>`);
  }
  if (issue) {
    issue.proposals.forEach((p, k) => {
      const c = COLOURS[k % COLOURS.length];
      const pv = (p.preview ?? []).map((q) => [q.x, q.z]);
      if (!pv.length) return;
      if (pv.length === 1) out.push(`<circle cx="${X(pv[0][0])}" cy="${Y(pv[0][1])}" r="${7 + k * 3}" fill="none" stroke="${c}" stroke-width="2.4"/>`);
      else out.push(`<polyline points="${line(pv)}" fill="${pv.length > 3 && !p.action.startsWith('connect') ? `${c}22` : 'none'}" stroke="${c}" stroke-width="2.6" ${k > 0 ? 'stroke-dasharray="7 4"' : ''}/>`);
      const at = pv[Math.floor(pv.length / 2)];
      out.push(`<text x="${f1(Number(X(at[0])) + 8 + k * 14)}" y="${f1(Number(Y(at[1])) - 8)}" font-family="Helvetica, Arial" font-size="17" font-weight="bold" fill="${c}" stroke="#fff" stroke-width="0.6">${LETTERS[k]}</text>`);
    });
    out.push(`<path d="M ${X(issue.x)} ${f1(Number(Y(issue.z)) - 9)} v 18 M ${f1(Number(X(issue.x)) - 9)} ${Y(issue.z)} h 18" stroke="#d50000" stroke-width="1.6"/>`);
  }
  for (const m of opts.marks ?? []) out.push(`<circle cx="${X(m[0])}" cy="${Y(m[1])}" r="16" fill="none" stroke="#d50000" stroke-width="2.4"/>`);
  // scale bar (20 m) and north
  out.push(`<rect x="10" y="${PANEL - 16}" width="${f1(20 * s)}" height="4" fill="#111"/><text x="10" y="${PANEL - 20}" font-family="Helvetica, Arial" font-size="11" fill="${sat ? '#fff' : '#111'}">20 m</text>`);
  out.push(`<text x="${PANEL - 22}" y="18" font-family="Helvetica, Arial" font-size="13" font-weight="bold" fill="${sat ? '#fff' : '#111'}">N ↑</text>`);
  out.push('</svg>');
  return out.join('');
}

/** Pixels of a picture of `half` metres around a point: the imagery is 0.27 m per pixel here and the server refuses a finer request. */
const satPx = (half) => Math.max(64, Math.min(640, Math.floor((2 * half) / 0.285)));
const satUrl = (x, z, half, px = satPx(half)) => {
  const a = geoOf(x - half, z + half);
  const b = geoOf(x + half, z - half);
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${a.lon.toFixed(7)},${a.lat.toFixed(7)},${b.lon.toFixed(7)},${b.lat.toFixed(7)}&bboxSR=4326&imageSR=3857&size=${px},${px}&format=jpg&f=image`;
};

/** The picture of a box as base64 jpeg, from the cache folder or the network; null when it cannot be had. */
async function satellite(x, z, half, cacheDir, offline) {
  const url = satUrl(x, z, half);
  const file = path.join(cacheDir, `${Math.round(x)}_${Math.round(z)}_${half}.jpg`);
  if (fs.existsSync(file)) return { b64: fs.readFileSync(file).toString('base64'), url };
  if (offline) return { b64: null, url };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'map-judge/1.0' }, signal: AbortSignal.timeout(20000) });
      const buf = Buffer.from(await res.arrayBuffer());
      if (res.ok && buf.length > 2000) {
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(file, buf);
        return { b64: buf.toString('base64'), url };
      }
    } catch {
      // try again
    }
  }
  return { b64: null, url };
}

/** One site: the map panel and the picture panel side by side under a title line. */
async function siteImage(idx, cx, cz, half, issue, title, lines, sat, opts) {
  const w = PANEL * 2 + 12;
  const head = 22 + lines.length * 15;
  const h = head + PANEL + 6;
  const text = [`<text x="4" y="16" font-family="Helvetica, Arial" font-size="14" font-weight="bold" fill="#111">${esc(title)}</text>`];
  lines.forEach((l, k) => text.push(`<text x="4" y="${33 + k * 15}" font-family="Helvetica, Arial" font-size="11.5" fill="${COLOURS[k % COLOURS.length]}">${esc(l)}</text>`));
  const base = sharp({ create: { width: w, height: h, channels: 3, background: '#ffffff' } });
  const parts = [{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${head}">${text.join('')}</svg>`), left: 0, top: 0 }];
  parts.push({ input: await sharp(Buffer.from(panelSvg(idx, cx, cz, half, issue, null, opts))).png().toBuffer(), left: 0, top: head });
  if (sat) parts.push({ input: await sharp(Buffer.from(panelSvg(idx, cx, cz, half, issue, sat, opts))).png().toBuffer(), left: PANEL + 12, top: head });
  else parts.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${PANEL}" height="${PANEL}"><rect width="${PANEL}" height="${PANEL}" fill="#ddd"/><text x="20" y="40" font-family="Helvetica, Arial" font-size="14">no picture (offline)</text></svg>`), left: PANEL + 12, top: head });
  return { buf: await base.composite(parts).png().toBuffer(), w, h };
}

const openIssues = () => readJson(path.join(MAPDIR, 'issues.json')).issues.filter((i) => i.status === 'open').sort((a, b) => (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : a.id < b.id ? -1 : 1));

async function sheets() {
  const out = path.resolve(ROOT, arg('--out', 'harness/reports/map/judge'));
  const half = Number(arg('--half', '45'));
  fs.mkdirSync(out, { recursive: true });
  const idx = indexContext(readJson(path.join(MAPDIR, 'context.json')));
  const issues = openIssues();
  const sites = [];
  const images = [];
  for (const [n, issue] of issues.entries()) {
    const sat = await satellite(issue.x, issue.z, half, path.join(out, 'sat'), has('--offline'));
    const lines = issue.proposals.map((p, k) => `${LETTERS[k]} (${p.confidence}) ${p.action}: ${p.reasoning}`.slice(0, 150));
    images.push(await siteImage(idx, issue.x, issue.z, half, issue, `#${n + 1}  ${issue.rule}  ${issue.note}`.slice(0, 110), lines, sat.b64, {}));
    sites.push({ n: n + 1, sheet: Math.floor(n / 6) + 1, issue: issue.id, rule: issue.rule, note: issue.note, x: issue.x, z: issue.z, lat: issue.lat, lon: issue.lon, picture: sat.url, hasPicture: sat.b64 !== null, proposals: issue.proposals.map((p, k) => ({ pick: LETTERS[k], action: p.action, params: p.params, confidence: p.confidence, reasoning: p.reasoning })) });
  }
  const files = [];
  for (let s = 0; s * 6 < images.length; s++) {
    const group = images.slice(s * 6, s * 6 + 6);
    const cw = Math.max(...group.map((g) => g.w));
    const ch = Math.max(...group.map((g) => g.h));
    const rows = Math.ceil(group.length / 2);
    const file = path.join(out, `sheet_${String(s + 1).padStart(2, '0')}.jpg`);
    await sharp({ create: { width: cw * 2 + 30, height: (ch + 14) * rows + 10, channels: 3, background: '#ffffff' } })
      .composite(group.map((g, k) => ({ input: g.buf, left: 10 + (k % 2) * (cw + 10), top: 10 + Math.floor(k / 2) * (ch + 14) }))).jpeg({ quality: 82 }).toFile(file);
    files.push(path.relative(ROOT, file));
  }
  fs.writeFileSync(path.join(out, 'sites.json'), JSON.stringify({ _doc: 'Sites of the top-view judge pass (tools/inspector/judge.mjs sheets): one per open issue of the last bake, in sheet order.', frame: FRAME, halfM: half, sites }, null, 1) + '\n');
  console.log(`judge: ${sites.length} open issues on ${files.length} sheets (${sites.filter((x) => x.hasPicture).length} with a picture)`);
  for (const f of files) console.log(`  ${f}`);
  console.log(`  ${path.relative(ROOT, path.join(out, 'sites.json'))}`);
}

function apply() {
  const file = args[1];
  if (!file) throw new Error('apply needs a decisions file');
  const date = arg('--date', new Date().toISOString().slice(0, 10));
  const decisions = readJson(path.resolve(file));
  const issues = new Map(readJson(path.join(MAPDIR, 'issues.json')).issues.map((i) => [i.id, i]));
  const dir = path.resolve(ROOT, arg('--overrides', 'harness/data/overrides'));
  const notesFile = path.resolve(ROOT, arg('--notes', 'harness/data/judge_notes.json'));
  const notes = fs.existsSync(notesFile) ? readJson(notesFile) : { _doc: 'Sites the top-view judge pass (tools/inspector/judge.mjs) could not decide: they stay open for the owner, with the reason on the card. The bake copies each note into issues.json.', notes: {} };
  const half = Number(arg('--half', '45'));
  let patched = 0;
  let asked = 0;
  for (const d of decisions) {
    const issue = issues.get(d.issue);
    if (!issue) throw new Error(`no such issue in the last bake: ${d.issue}`);
    if (!d.why || d.why.length < 12) throw new Error(`${d.issue}: a decision needs its reasoning`);
    if (d.pick === 'ask') {
      notes.notes[d.issue] = { note: d.why, date };
      asked++;
      continue;
    }
    const k = LETTERS.indexOf(d.pick);
    const proposal = issue.proposals[k];
    if (k < 0 || !proposal) throw new Error(`${d.issue}: no proposal ${d.pick}`);
    delete notes.notes[d.issue];
    const tile = worldTile(issue.x, issue.z);
    const full = path.join(dir, overrideFileName(tile));
    const existing = fs.existsSync(full) ? readJson(full) : [];
    const patch = { ...buildPatch(issue, { action: proposal.action, params: proposal.params, confidence: proposal.confidence, reasoning: proposal.reasoning, preview: [] }, { note: d.why, date, id: undefined, by: 'judge' }), source: 'top-view', reference: { link: satUrl(issue.x, issue.z, half), date, note: 'Esri World Imagery beside the map render of the site (tools/inspector/judge.mjs sheets)' } };
    delete patch.id;
    const merged = mergePatch(existing, tile, patch);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(full, JSON.stringify(merged.patches, null, 2) + '\n');
    patched++;
  }
  fs.writeFileSync(notesFile, JSON.stringify(notes, null, 2) + '\n');
  console.log(`judge: ${patched} patches written to ${path.relative(ROOT, dir)}, ${asked} sites left for the owner (${path.relative(ROOT, notesFile)})`);
}

async function site() {
  const [x, z] = String(arg('--at', '')).split(',').map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(z)) throw new Error('site needs --at <x,z> in world metres');
  const half = Number(arg('--half', '60'));
  const name = path.resolve(ROOT, arg('--name', 'harness/reports/map/site.png'));
  const idx = indexContext(readJson(path.resolve(ROOT, arg('--context', path.join(MAPDIR, 'context.json')))));
  const marks = args.flatMap((a, i) => (a === '--mark' ? [String(args[i + 1]).split(',').map(Number)] : []));
  const sat = has('--no-picture') ? { b64: null } : await satellite(x, z, half, path.join(MAPDIR, 'judge', 'sat'), has('--offline'));
  const img = await siteImage(idx, x, z, half, null, arg('--title', `${x}, ${z}`), [], sat.b64, { marks });
  fs.mkdirSync(path.dirname(name), { recursive: true });
  fs.writeFileSync(name, img.buf);
  console.log(path.relative(ROOT, name));
}

const cmd = args[0];
if (cmd === 'sheets') await sheets();
else if (cmd === 'apply') apply();
else if (cmd === 'site') await site();
else {
  console.log('usage: judge.mjs sheets | apply <decisions.json> | site --at <x,z> --name <file.png>');
  process.exit(cmd ? 1 : 0);
}
