// Map inspector: the flat map layers (P1-039). Ground and stage edge, the 250 m tile grid, the OSM plan (road ribbons,
// network lines, building footprints) of context.json and the lane surfaces and painted lines of the lane model's
// lanes.json (tools/bake/roads/laneout.ts lanesLayer). All of it is flat map data, so it is drawn without the depth
// test in a fixed order (renderOrder), under the KTL1 tiles and the markers. World metres, east +X, north -Z.
import * as THREE from 'three';
import { laneBorder } from '../lib.ts';
import { CENTRE_LINE, LANE_FILL, LANE_LINE, LANE_MARK, MAJOR, MAP, NET_MAJOR, NET_MINOR, ROAD_FILL } from './theme.js';

/** Layer order, lowest first. */
export const ORDER = { ground: -60, grid: -55, buildings: -50, ribbons: -40, lanes: -35, laneLines: -30, laneMarks: -28, buildingEdges: -25, network: -20, edge: -15 };

function flat(obj, order) {
  obj.renderOrder = order;
  obj.frustumCulled = false;
  const ms = Array.isArray(obj.material) ? obj.material : [obj.material];
  for (const m of ms) { m.depthTest = false; m.depthWrite = false; }
  return obj;
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Ground inside the stage outline, the dashed stage edge and the tile grid around it. */
export function groundLayer(outline, bounds) {
  const group = new THREE.Group();
  if (outline.length > 2) {
    const shape = outline.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(shape, []);
    const pos = new Float32Array(tris.length * 9);
    tris.forEach((t, k) => t.forEach((v, j) => pos.set([shape[v].x, 0, shape[v].y], k * 9 + j * 3)));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    group.add(flat(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: MAP.ground, side: THREE.DoubleSide })), ORDER.ground));
    const eg = new THREE.BufferGeometry().setFromPoints(outline.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    const edge = new THREE.Line(eg, new THREE.LineDashedMaterial({ color: MAP.edge, dashSize: 40, gapSize: 25, transparent: true, opacity: 0.55 }));
    edge.computeLineDistances();
    group.add(flat(edge, ORDER.edge));
  }
  const S = 250;
  const x0 = Math.floor(bounds.minX / S) * S - S; const x1 = Math.ceil(bounds.maxX / S) * S + S;
  const z0 = Math.floor(bounds.minZ / S) * S - S; const z1 = Math.ceil(bounds.maxZ / S) * S + S;
  const pts = [];
  for (let x = x0; x <= x1; x += S) pts.push(x, 0, z0, x, 0, z1);
  for (let z = z0; z <= z1; z += S) pts.push(x0, 0, z, x1, 0, z);
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const grid = flat(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: MAP.grid, transparent: true, opacity: 1 })), ORDER.grid);
  group.add(grid);
  return { group, grid };
}

/** The OSM plan: road ribbons to scale with round joins, network lines for the far view, building footprints. */
export function contextLayer(ctx) {
  const roads = new THREE.Group();
  const buildings = new THREE.Group();
  const pos = [];
  const col = [];
  const net = [];
  const netCol = [];
  const c = new THREE.Color();
  const major = new THREE.Color(NET_MAJOR);
  const minor = new THREE.Color(NET_MINOR);
  const disc = (x, y, z, r) => {
    const n = r > 6 ? 14 : 10;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2; const a1 = ((k + 1) / n) * Math.PI * 2;
      pos.push(x, y, z, x + Math.cos(a0) * r, y, z + Math.sin(a0) * r, x + Math.cos(a1) * r, y, z + Math.sin(a1) * r);
      for (let j = 0; j < 3; j++) col.push(c.r, c.g, c.b);
    }
  };
  for (const r of ctx.roads ?? []) {
    const p = r.p;
    const half = Math.max(1.4, r.w / 2);
    c.setHex(ROAD_FILL[r.k] ?? 0x423f39);
    const nc = MAJOR.has(r.k) ? major : minor;
    for (let k = 0; k + 5 < p.length; k += 3) {
      const ax = p[k]; const ay = p[k + 1]; const az = p[k + 2]; const bx = p[k + 3]; const by = p[k + 4]; const bz = p[k + 5];
      const dx = bx - ax; const dz = bz - az; const len = Math.hypot(dx, dz) || 1;
      const nx = (-dz / len) * half; const nz = (dx / len) * half;
      pos.push(ax + nx, ay, az + nz, ax - nx, ay, az - nz, bx + nx, by, bz + nz, bx + nx, by, bz + nz, ax - nx, ay, az - nz, bx - nx, by, bz - nz);
      for (let j = 0; j < 6; j++) col.push(c.r, c.g, c.b);
      net.push(ax, ay, az, bx, by, bz);
      netCol.push(nc.r, nc.g, nc.b, nc.r, nc.g, nc.b);
    }
    for (let k = 0; k + 2 < p.length; k += 3) disc(p[k], p[k + 1], p[k + 2], half);
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  rg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  roads.add(flat(new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })), ORDER.ribbons));
  const ng = new THREE.BufferGeometry();
  ng.setAttribute('position', new THREE.Float32BufferAttribute(net, 3));
  ng.setAttribute('color', new THREE.Float32BufferAttribute(netCol, 3));
  const network = flat(new THREE.LineSegments(ng, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 1 })), ORDER.network);
  roads.add(network);

  const fill = [];
  const edges = [];
  for (const b of ctx.buildings ?? []) {
    const shape = [];
    for (let k = 0; k + 2 < b.length; k += 3) shape.push(new THREE.Vector2(b[k], b[k + 2]));
    if (shape.length < 3) continue;
    for (const t of THREE.ShapeUtils.triangulateShape(shape, [])) for (const v of t) fill.push(shape[v].x, 0, shape[v].y);
    for (let k = 0; k < shape.length; k++) { const a = shape[k]; const q = shape[(k + 1) % shape.length]; edges.push(a.x, 0, a.y, q.x, 0, q.y); }
  }
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.Float32BufferAttribute(fill, 3));
  buildings.add(flat(new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: MAP.buildingFill, side: THREE.DoubleSide })), ORDER.buildings));
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3));
  const buildingEdges = flat(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: MAP.buildingEdge, transparent: true, opacity: 1 })), ORDER.buildingEdges);
  buildings.add(buildingEdges);

  return {
    roads, buildings,
    /** Network lines fade out as the lanes and ribbons take over close up; building edges fade in. */
    update(dist) {
      network.material.opacity = 0.25 + 0.75 * smooth(250, 1400, dist);
      buildingEdges.material.opacity = 1 - 0.6 * smooth(1500, 4000, dist);
    },
  };
}

/** Dashes along a polyline (points [x, z]): `on` metres painted, `off` metres gap. Pushes segment pairs into out. */
function dashes(pts, on, off, out) {
  let carry = 0; // distance into the current dash period
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i]; const [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    let s = 0;
    while (s < len) {
      const inOn = carry < on;
      const step = Math.min(len - s, inOn ? on - carry : on + off - carry);
      if (inOn) {
        const t0 = s / len; const t1 = (s + step) / len;
        out.push(ax + (bx - ax) * t0, 0, az + (bz - az) * t0, ax + (bx - ax) * t1, 0, az + (bz - az) * t1);
      }
      s += step;
      carry = (carry + step) % (on + off);
    }
  }
}

/** The lane model's lanes layer: every lane as a surface coloured by its type, and the painted lines between lanes. */
export function lanesLayer(file) {
  let nv = 0; let ni = 0;
  for (const s of file.strips) { nv += s.ref.length * 2 * s.lanes.length; ni += Math.max(0, s.ref.length - 1) * 6 * s.lanes.length; }
  const pos = new Float32Array(nv * 3);
  const col = new Uint8Array(nv * 3);
  const idx = new Uint32Array(ni);
  const laneLines = [];
  const centreLines = [];
  const c = new THREE.Color();
  let v = 0; let i = 0;
  for (const s of file.strips) {
    const n = s.ref.length;
    const perPoint = Array.isArray(s.b[0]);
    const off = (pt, k) => (perPoint ? s.b[pt][k] : s.b[k]);
    const at = (pt, k) => { const o = off(pt, k); return [s.ref[pt][0] + s.n[pt][0] * o, s.ref[pt][1] + s.n[pt][1] * o]; };
    s.lanes.forEach(([type], j) => {
      c.setHex(LANE_FILL[type] ?? LANE_FILL.drive);
      const base = v;
      for (let pt = 0; pt < n; pt++) {
        const [lx, lz] = at(pt, j); const [rx, rz] = at(pt, j + 1);
        pos.set([lx, 0, lz, rx, 0, rz], v * 3);
        col.set([c.r * 255, c.g * 255, c.b * 255, c.r * 255, c.g * 255, c.b * 255], v * 3);
        v += 2;
      }
      for (let pt = 0; pt + 1 < n; pt++) {
        const a = base + pt * 2;
        idx.set([a, a + 1, a + 2, a + 2, a + 1, a + 3], i);
        i += 6;
      }
    });
    for (let k = 1; k < s.lanes.length; k++) {
      const kind = laneBorder(s.lanes[k - 1], s.lanes[k]);
      if (!kind) continue;
      const line = Array.from({ length: n }, (_, pt) => at(pt, k));
      if (kind === 'centre') for (let pt = 0; pt + 1 < n; pt++) centreLines.push(line[pt][0], 0, line[pt][1], line[pt + 1][0], 0, line[pt + 1][1]);
      else dashes(line, 3, 4.5, laneLines);
    }
  }
  const group = new THREE.Group();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  const surfaces = flat(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 1 })), ORDER.lanes);
  group.add(surfaces);
  const mk = (arr, colour) => {
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    return flat(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.8 })), ORDER.laneLines);
  };
  const lane = mk(laneLines, LANE_LINE);
  const centre = mk(centreLines, CENTRE_LINE);
  group.add(lane, centre);
  return {
    group,
    counts: { strips: file.strips.length, laneLines: laneLines.length / 6, centreLines: centreLines.length / 6 },
    /** Lanes show close up: the painted lines from about 700 m camera distance in, the surfaces from about 2.5 km. */
    update(dist) {
      const lines = 1 - smooth(350, 800, dist);
      lane.material.opacity = 0.62 * lines;
      centre.material.opacity = 0.9 * lines;
      lane.visible = centre.visible = lines > 0.01;
      const surf = 1 - smooth(1500, 2600, dist);
      surfaces.material.opacity = surf;
      surfaces.visible = surf > 0.01;
    },
  };
}

/**
 * Split zones and taper findings on the lanes layer: a tinted ribbon over the whole cross section of the strip and a
 * line along its two outer borders, teal for a split zone and coral for a taper finding. `marks` is a list of
 * { strip, kind } with kind "zone" or "taper".
 */
export function laneMarksLayer(file, marks) {
  const byId = new Map(file.strips.map((s) => [s.id, s]));
  const rib = { pos: [], idx: [], col: [] };
  const edges = [];
  const c = new THREE.Color();
  for (const m of marks) {
    const s = byId.get(m.strip);
    if (!s) continue;
    const n = s.ref.length;
    const perPoint = Array.isArray(s.b[0]);
    const row = (pt) => (perPoint ? s.b[pt] : s.b);
    const at = (pt, o) => [s.ref[pt][0] + s.n[pt][0] * o, s.ref[pt][1] + s.n[pt][1] * o];
    c.set(LANE_MARK[m.kind]);
    const base = rib.pos.length / 3;
    const left = []; const right = [];
    for (let pt = 0; pt < n; pt++) {
      const b = row(pt);
      const l = at(pt, b[0] + 0.6); const r = at(pt, b[b.length - 1] - 0.6);
      left.push(l); right.push(r);
      rib.pos.push(l[0], 0, l[1], r[0], 0, r[1]);
      rib.col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    for (let pt = 0; pt + 1 < n; pt++) { const a = base + pt * 2; rib.idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    for (const side of [left, right]) for (let pt = 0; pt + 1 < n; pt++) edges.push(side[pt][0], 0, side[pt][1], side[pt + 1][0], 0, side[pt + 1][1], m.kind === 'zone' ? 0 : 1);
  }
  const group = new THREE.Group();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(rib.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(rib.col, 3));
  g.setIndex(rib.idx);
  const ribbon = flat(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.42 })), ORDER.laneMarks);
  // the edge lines: two line sets, one colour each (a segment list has seven numbers per segment here: the last is the kind)
  const lineSet = (kind, colour) => {
    const arr = [];
    for (let k = 0; k + 6 < edges.length; k += 7) if (edges[k + 6] === kind) arr.push(edges[k], edges[k + 1], edges[k + 2], edges[k + 3], edges[k + 4], edges[k + 5]);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    return flat(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: colour, transparent: true, opacity: 0.95 })), ORDER.laneMarks + 1);
  };
  const zl = lineSet(0, LANE_MARK.zone);
  const tl = lineSet(1, LANE_MARK.taper);
  group.add(ribbon, zl, tl);
  const api = {
    group,
    /** Set by the page from the layer toggle; update() applies it. */
    enabled: true,
    update(dist) {
      const k = 1 - smooth(1200, 2400, dist);
      ribbon.material.opacity = 0.42 * k;
      zl.material.opacity = tl.material.opacity = 0.95 * k;
      group.visible = k > 0.01 && api.enabled;
    },
  };
  return api;
}
