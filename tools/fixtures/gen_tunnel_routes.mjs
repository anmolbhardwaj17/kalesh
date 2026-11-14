#!/usr/bin/env node
// Writes harness/data/fixtures/tunnel_routes.json: one drive through every car tunnel and underpass of the baked pilot
// (P2-032), read from the tunnel mouths of the folder's infra.json (records `theads`, tools/bake/infra/tunnels.ts) and
// the lane graph of the tiles (tools/fixtures/lanegraph.mjs). For each mouth a lane enters (its direction against the
// mouth's outward normal), the route starts 70 m back on the approach, follows the straightest `next` link (a full
// lane before a taper lane opening beside it) through the tunnel and ends 60 m past the last mouth it passes (at most 1,600 m). A mouth a route already passes is not
// started again; a mouth no route passes is an exit only and gets a drive from 400 m back inside it. Pedestrian
// subways (SUB-S4) are P2-031. The scenario tunnel_drive (harness/verify/scripts/
// tunnel_drive.js) stages the car at each start and drives the route with real inputs.
// World metres [x, y, z] (east +X, north -Z). Rerun after a bake that changes game/world/tiles.hash:
//   node tools/fixtures/gen_tunnel_routes.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLaneGraph, thin, lengthOf, allows } from './lanegraph.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TILES = path.join(ROOT, 'game', 'world', 'tiles');
const OUT = path.join(ROOT, 'harness', 'data', 'fixtures', 'tunnel_routes.json');
const { index, pieces } = readLaneGraph(TILES);
const infra = JSON.parse(fs.readFileSync(path.join(TILES, 'infra.json'), 'utf8'));

const heads = [];
for (const [tile, recs] of Object.entries(infra.tiles)) {
  for (const h of recs.theads ?? []) {
    if (h.v === 'SUB-S4') continue;
    heads.push({ tile, v: h.v, name: h.name, x: (h.a[0] + h.b[0]) / 2, z: (h.a[1] + h.b[1]) / 2, y: h.floor, n: h.n, w: Math.hypot(h.b[0] - h.a[0], h.b[1] - h.a[1]) });
  }
}

/** True when a polyline passes a mouth: a segment within half its width plus 3 m of its middle, at its floor (2 m). */
function passes(pts, h) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const abx = b[0] - a[0];
    const abz = b[2] - a[2];
    const L2 = abx * abx + abz * abz;
    const t = L2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((h.x - a[0]) * abx + (h.z - a[2]) * abz) / L2));
    const d = Math.hypot(h.x - (a[0] + abx * t), h.z - (a[2] + abz * t));
    if (d < h.w / 2 + 3 && Math.abs(a[1] + (b[1] - a[1]) * t - h.y) < 2) return true;
  }
  return false;
}

const dir = (a, b) => { const d = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1; return [(b[0] - a[0]) / d, (b[2] - a[2]) / d]; };
const endDir = (p) => dir(p.pts[p.pts.length - 2], p.pts[p.pts.length - 1]);
const startDir = (p) => dir(p.pts[0], p.pts[1]);

/** The car lane entering a mouth: a segment within half the mouth's width of its middle, at its floor, heading in. */
function entering(h, sign = 1) {
  let best = null;
  for (const p of pieces.values()) {
    if (p.kind !== 'lane' || !allows(p, 'car') || p.pts.length < 2) continue;
    for (let i = 0; i + 1 < p.pts.length; i++) {
      const a = p.pts[i];
      const b = p.pts[i + 1];
      const abx = b[0] - a[0];
      const abz = b[2] - a[2];
      const L2 = abx * abx + abz * abz;
      if (L2 < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((h.x - a[0]) * abx + (h.z - a[2]) * abz) / L2));
      const qx = a[0] + abx * t;
      const qz = a[2] + abz * t;
      const qy = a[1] + (b[1] - a[1]) * t;
      const d = Math.hypot(h.x - qx, h.z - qz);
      if (d > h.w / 2 + 0.5 || Math.abs(qy - h.y) > 1.5) continue;
      const L = Math.sqrt(L2);
      const into = sign * (-(abx / L) * h.n[0] - (abz / L) * h.n[1]);
      if (into < 0.7) continue;
      if (!best || d < best.d) best = { id: p.id, i, t, d };
    }
  }
  return best;
}

/** Points of a piece chain walked backwards from piece `id` point `i` for `m` metres (straightest back link). */
function backFrom(id, i, m) {
  let p = pieces.get(id);
  const out = p.pts.slice(0, i + 1).reverse();
  let len = lengthOf(out);
  while (len < m && p.back.length) {
    const s = startDir(p);
    let pick = null;
    let bestDot = -2;
    for (const b of p.back) {
      const q = pieces.get(b);
      if (!q || q.kind !== 'lane' || !allows(q, 'car')) continue;
      const e = endDir(q);
      const dot = e[0] * s[0] + e[1] * s[1] + (q.widthM >= 2.5 ? 0.25 : 0);
      if (dot > bestDot) { bestDot = dot; pick = q; }
    }
    if (!pick) break;
    p = pick;
    const pts = [...p.pts].reverse();
    out.push(...pts.slice(1));
    len = lengthOf(out);
  }
  return out.reverse();
}

/** Forward from piece `id` point `i` along the straightest `next` link until 60 m past the last mouth passed. */
function forwardFrom(id, i) {
  let p = pieces.get(id);
  const out = p.pts.slice(i);
  let lastMouth = 0;
  const seen = new Set([id]);
  const passMouths = () => {
    if (out.length < 2) return;
    const len = lengthOf(out);
    const seg = out.slice(-2);
    for (const h of heads) if (passes(seg, h)) lastMouth = len;
  };
  for (;;) {
    passMouths();
    const len = lengthOf(out);
    if (len > 1600 || (lastMouth > 0 && len - lastMouth > 60)) break;
    const e = endDir(p);
    let pick = null;
    let bestDot = -2;
    for (const n of p.next) {
      const q = pieces.get(n);
      if (!q || seen.has(n) || q.kind !== 'lane' || !allows(q, 'car')) continue;
      const s = startDir(q);
      // the straightest, but a full lane over a taper lane opening beside it (a 1.75 m taper runs along the wall)
      const dot = e[0] * s[0] + e[1] * s[1] + (q.widthM >= 2.5 ? 0.25 : 0);
      if (dot > bestDot) { bestDot = dot; pick = q; }
    }
    if (!pick) break;
    p = pick;
    seen.add(p.id);
    for (const q of p.pts.slice(1)) {
      out.push(q);
      passMouths();
    }
  }
  return out;
}

const routes = {};
const covered = new Set();
const report = [];
heads.sort((a, b) => a.x - b.x || a.z - b.z);
heads.forEach((h, k) => {
  if (covered.has(k)) return;
  const e = entering(h);
  if (!e) {
    report.push({ mouth: k, v: h.v, at: [Math.round(h.x), Math.round(h.z)], entered: false });
    return;
  }
  const back = backFrom(e.id, e.i, 70);
  const fwd = forwardFrom(e.id, e.i + 1);
  const pts = thin([...back, ...fwd].filter((q, i, all) => i === 0 || Math.hypot(q[0] - all[i - 1][0], q[2] - all[i - 1][2]) > 0.05), 0.25);
  const through = [];
  heads.forEach((g, j) => {
    if (passes(pts, g)) {
      covered.add(j);
      through.push(j);
    }
  });
  const id = `${h.v.toLowerCase()}_${Math.round(h.x)}_${Math.round(-h.z)}`;
  routes[id] = { variant: h.v, name: h.name || '', mouth: [Math.round(h.x * 100) / 100, Math.round(h.y * 100) / 100, Math.round(h.z * 100) / 100], widthM: Math.round(Math.min(...through.map((j) => heads[j].w)) * 100) / 100, mouths: through.length, lengthM: Math.round(lengthOf(pts)), yRange: [Math.min(...pts.map((q) => q[1])), Math.max(...pts.map((q) => q[1]))], points: pts };
  report.push({ mouth: k, v: h.v, at: [Math.round(h.x), Math.round(h.z)], entered: true, route: id, through });
});
// a mouth no route passed is an exit only: drive to it from 400 m back inside the tunnel and 60 m out
heads.forEach((h, k) => {
  if (covered.has(k)) return;
  const e = entering(h, -1);
  if (!e) return;
  const back = backFrom(e.id, e.i, 400);
  const p = pieces.get(e.id);
  const fwd = p.pts.slice(e.i + 1);
  let q = p;
  while (lengthOf(fwd) < 60 && q.next.length) {
    const n = q.next.map((id) => pieces.get(id)).find((c) => c && c.kind === 'lane' && allows(c, 'car'));
    if (!n) break;
    q = n;
    fwd.push(...n.pts.slice(1));
  }
  const pts = thin([...back, ...fwd].filter((r, i, all) => i === 0 || Math.hypot(r[0] - all[i - 1][0], r[2] - all[i - 1][2]) > 0.05), 0.25);
  const through = [];
  heads.forEach((g, j) => {
    if (passes(pts, g)) {
      covered.add(j);
      through.push(j);
    }
  });
  const id = `${h.v.toLowerCase()}_${Math.round(h.x)}_${Math.round(-h.z)}_out`;
  routes[id] = { variant: h.v, name: h.name || '', mouth: [Math.round(h.x * 100) / 100, Math.round(h.y * 100) / 100, Math.round(h.z * 100) / 100], widthM: Math.round(Math.min(...through.map((j) => heads[j].w)) * 100) / 100, mouths: through.length, lengthM: Math.round(lengthOf(pts)), yRange: [Math.min(...pts.map((r) => r[1])), Math.max(...pts.map((r) => r[1]))], points: pts };
});
const out = {
  _doc: 'Drives through every car tunnel and underpass of the baked pilot (P2-032), written by tools/fixtures/gen_tunnel_routes.mjs from the tunnel mouths in game/world/tiles/infra.json and the lane graph. routes: from 70 m before a mouth a lane enters, through the tunnel, to 60 m past the last mouth it passes (mouth: the first mouth\'s middle at the road; mouths: how many mouths it passes). mouths: every mouth and the route that passes it. Rerun after a bake that changes game/world/tiles.hash.',
  bakeHash: index.bakeHash,
  routes,
  mouths: heads.map((h, k) => ({ k, v: h.v, name: h.name || '', at: [Math.round(h.x * 10) / 10, Math.round(h.z * 10) / 10], passedBy: Object.keys(routes).filter((r) => passes(routes[r].points, h)) })),
};
fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
console.log(`tunnel routes: ${Object.keys(routes).length} routes (${Object.values(routes).map((r) => `${r.variant} ${r.lengthM} m`).join(', ')}); mouths ${heads.length}, passed ${out.mouths.filter((m) => m.passedBy.length).length}`);
for (const m of out.mouths) if (!m.passedBy.length) console.log(`  mouth not passed: ${m.v} ${m.name} at ${m.at.join(', ')}`);
