// The lane graph of a baked tile folder (KTL1 header key `lanes`), for the route fixture tools
// (gen_stream_routes.mjs, gen_city_routes.mjs). Every point is world metres (tile origin plus the tile-relative point;
// east +X, north -Z). Reads files only; the routing and thinning are plain functions of the graph.
import fs from 'node:fs';
import path from 'node:path';

/** Cost factor of small roads in a route (a car keeps to the main roads). */
export const SMALL = { service: 4, residential: 2.5, living_street: 4, unclassified: 2, tertiary: 1.4, pedestrian: 6, track: 6 };

export const dirOf = (a, b) => { const d = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1; return [(b[0] - a[0]) / d, (b[2] - a[2]) / d]; };
const endDir = (p) => dirOf(p.pts[Math.max(0, p.pts.length - 2)], p.pts[p.pts.length - 1]);
const startDir = (p) => dirOf(p.pts[0], p.pts[Math.min(1, p.pts.length - 1)]);

export const lengthOf = (pts) => pts.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - pts[i][0], q[2] - pts[i][2]), 0);

/** Reads the index and every tile's lanes: {index, pieces: Map id -> {id, cls, kind, layer, widthM, next, back, pts, len}}. */
export function readLaneGraph(tilesDir) {
  const index = JSON.parse(fs.readFileSync(path.join(tilesDir, 'index.json'), 'utf8'));
  const pieces = new Map();
  for (const rec of index.tiles) {
    const buf = fs.readFileSync(path.join(tilesDir, rec.file));
    const headLen = buf.readUInt32LE(8);
    const header = JSON.parse(buf.subarray(12, 12 + headLen).toString('latin1'));
    const lanes = header.lanes;
    if (!lanes || !Array.isArray(lanes.list)) continue;
    const base = 12 + headLen + lanes.pts;
    const [ox, oy, oz] = header.origin;
    for (const l of lanes.list) {
      const pts = [];
      for (let i = 0; i < l.count; i++) {
        const at = base + (l.start + i) * 12;
        pts.push([ox + buf.readFloatLE(at), oy + buf.readFloatLE(at + 4), oz + buf.readFloatLE(at + 8)]);
      }
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);
      pieces.set(l.id, { id: l.id, cls: l.cls || '', kind: l.kind || '', layer: l.layer || 0, widthM: l.widthM || 0, next: l.next || [], back: l.back || [], pts, len, tile: rec.id });
    }
  }
  return { index, pieces };
}

/** The lane piece at grade nearest to a world point: {id, d, at: [x, y, z], i (point index)}. `accept(piece)` filters. */
export function nearest(pieces, x, z, { maxM = 400, minLen = 8, accept = null } = {}) {
  let best = null;
  for (const p of pieces.values()) {
    if (accept ? !accept(p) : (p.layer !== 0 || p.kind !== 'lane' || p.len < minLen || (SMALL[p.cls] || 1) > 2.5)) continue;
    p.pts.forEach((q, i) => {
      const d = Math.hypot(q[0] - x, q[2] - z);
      if (d < maxM && (!best || d < best.d)) best = { id: p.id, d, at: q, i };
    });
  }
  return best;
}

/** Dijkstra over `next` links from piece a to piece b (length, small roads and turns cost). The piece ids, or null. */
export function route(pieces, a, b, { turnCost = 60 } = {}) {
  const dist = new Map([[a, 0]]);
  const prev = new Map();
  const open = [[0, a]];
  const done = new Set();
  while (open.length) {
    let k = 0;
    for (let i = 1; i < open.length; i++) if (open[i][0] < open[k][0]) k = i;
    const [d, id] = open.splice(k, 1)[0];
    if (done.has(id)) continue;
    done.add(id);
    if (id === b) break;
    const p = pieces.get(id);
    for (const n of p.next) {
      const q = pieces.get(n);
      if (!q || done.has(n)) continue;
      const e = endDir(p);
      const s = startDir(q);
      const turn = 1 - (e[0] * s[0] + e[1] * s[1]);
      const nd = d + q.len * (SMALL[q.cls] || 1) + turn * turnCost;
      if (nd < (dist.get(n) ?? Infinity)) { dist.set(n, nd); prev.set(n, id); open.push([nd, n]); }
    }
  }
  if (!done.has(b)) return null;
  const ids = [b];
  while (ids[0] !== a) ids.unshift(prev.get(ids[0]));
  return ids;
}

/** The points of a chain of pieces, thinned: a point stays when it is over `tol` off the line of its neighbours. */
export function polyline(pieces, ids, tol = 0.25) {
  const all = [];
  for (const id of ids) for (const q of pieces.get(id).pts) {
    const last = all[all.length - 1];
    if (!last || Math.hypot(q[0] - last[0], q[1] - last[1], q[2] - last[2]) > 0.05) all.push(q);
  }
  return thin(all, tol);
}

/** Thins a point list the same way (a point stays when over `tol` off the line of its kept neighbour and the next one). */
export function thin(all, tol = 0.25) {
  const keep = [all[0]];
  for (let i = 1; i < all.length - 1; i++) {
    const a = keep[keep.length - 1];
    const b = all[i + 1];
    const q = all[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1;
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * (b[0] - a[0]) + (q[1] - a[1]) * (b[1] - a[1]) + (q[2] - a[2]) * (b[2] - a[2])) / (L * L)));
    const off = Math.hypot(q[0] - (a[0] + t * (b[0] - a[0])), q[1] - (a[1] + t * (b[1] - a[1])), q[2] - (a[2] + t * (b[2] - a[2])));
    if (off > tol || L > 60) keep.push(q);
  }
  keep.push(all[all.length - 1]);
  return keep.map((q) => q.map((v) => Math.round(v * 1000) / 1000));
}
