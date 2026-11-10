// Draws the composite map layout sketches (north up) and prints their totals.
// Run: node harness/design/map_sketches/make_sketches.mjs
// Every size and position here is an ESTIMATE for discussion (P0-028), not baked data.
// Coordinates are km in the game layout: x east, y north (the SVG flips y so north is up).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Real centres (lat, lon), estimates from public maps. Used for the placement offset.
const REAL = {
  D01: [28.6315, 77.2167], D02: [28.6271, 77.2166], D03: [28.6135, 77.2190], D04: [28.6290, 77.2430],
  D05: [28.6033, 77.2003], D06: [28.5960, 77.2280], D07: [28.6430, 77.2170], D08: [28.6480, 77.2240],
  D09: [28.6530, 77.2350], D10: [28.6670, 77.2280], D12: [28.6310, 77.2770], D13: [28.6730, 77.2890],
  D14: [28.6127, 77.2773], D15: [28.5700, 77.3230], D16: [28.5920, 77.2470], D17: [28.6420, 77.2020],
  D19: [28.5410, 77.1560], D20: [28.5245, 77.1855], D21: [28.5530, 77.1000], D22: [28.4950, 77.0890],
  D0778: [28.6455, 77.2205], D0102: [28.6295, 77.2167],
};
const KM_PER_DEG_LAT = 111.0;
const KM_PER_DEG_LON = 111.32 * Math.cos((28.63 * Math.PI) / 180);
const realKm = (id) => {
  const [lat, lon] = REAL[id];
  return [(lon - REAL.D01[1]) * KM_PER_DEG_LON, (lat - REAL.D01[0]) * KM_PER_DEG_LAT];
};

// group colours
const G = {
  core: '#f2c98a', old: '#e8a27c', east: '#c9b8e8', south: '#a9d4e6', story: '#b9dca0', ncr: '#9fc3f0',
};

// district: id, label lines, x0, y0 (south west corner, km), w, h, group
const d = (id, label, x0, y0, w, h, group, extra = {}) => ({ id, label, x0, y0, w, h, group, ...extra });

const LAYOUTS = {
  a: {
    title: 'Layout A: Compact core',
    subtitle: '12 districts, trimmed clips, the south pressed close',
    windFactor: 1.1,
    fillerKm2: 2.0,
    river: { x: 5.3, width: 0.4, y1: 5.3, y2: -0.2, bend: 0.15 },
    ringRoad: null,
    districts: [
      d('D0102', ['Connaught Place', '+ Jantar Mantar'], 2.0, 2.4, 1.2, 1.6, 'core'),
      d('D0778', ['Paharganj, station', '+ GB Road'], 1.6, 4.1, 1.8, 0.9, 'old'),
      d('D09', ['Chandni Chowk', 'Red Fort'], 3.5, 4.0, 1.4, 1.0, 'old'),
      d('D04', ['ITO, Pragati', 'Maidan'], 3.6, 2.6, 1.2, 1.0, 'core'),
      d('D03', ['India Gate'], 2.6, 1.5, 1.4, 0.8, 'core'),
      d('D05', ['Gymkhana', 'Lutyens'], 1.6, 1.5, 0.8, 0.8, 'story'),
      d('D06', ['Khan Market', 'Lodhi, Golf Club'], 2.6, 0.3, 1.4, 1.0, 'story'),
      d('D17', ['Haunted', 'ruin'], 0.8, 3.0, 0.6, 0.6, 'story'),
      d('D19', ['Vasant', 'Kunj'], 1.4, 0.1, 1.0, 0.8, 'south'),
      d('D21', ['IGI T3', 'Aerocity'], 0.0, 1.0, 1.4, 0.8, 'south'),
      d('D22', ['Cyber City', 'Gurugram'], 0.0, -0.5, 1.0, 0.8, 'ncr'),
      d('D12', ['Laxmi Nagar', 'East Delhi'], 5.7, 2.5, 1.0, 1.0, 'east'),
    ],
    connectors: [
      { name: 'Ring Road (river bank and south)', kind: 'ring', pts: [[4.95, 5.2], [4.95, 0.0], [1.2, 0.0]], lp: [2.6, -0.3] },
      { name: 'NH-48', kind: 'highway', pts: [[1.5, 2.3], [1.5, 0.9], [1.2, 0.0], [1.1, -0.6], [0.8, -1.0]], lp: [1.1, -0.85] },
      { name: 'Airport road', kind: 'highway', pts: [[1.5, 1.4], [1.4, 1.4]], label: false },
      { name: 'Janpath', kind: 'avenue', pts: [[2.6, 2.4], [2.9, 2.3]] },
      { name: 'Ridge Rd', kind: 'avenue', pts: [[2.0, 3.3], [1.4, 3.3]], lp: [1.45, 3.4] },
      { name: 'BSZ Marg', kind: 'avenue', pts: [[4.2, 3.6], [4.2, 4.0]] },
      { name: 'ITO bridge', kind: 'bridge', pts: [[4.8, 3.0], [5.7, 3.0]], lp: [5.0, 2.75] },
      { name: 'Nizamuddin bridge', kind: 'bridge', pts: [[4.95, 0.6], [5.9, 0.6], [6.2, 2.5]], lp: [5.1, 0.35] },
      { name: 'Lodhi Road', kind: 'avenue', pts: [[4.0, 0.8], [4.95, 0.8]] },
    ],
    route: { name: 'Cyber City to Laxmi Nagar', pts: [[0.5, -0.1], [1.15, -0.3], [1.2, 0.0], [4.95, 0.0], [4.95, 3.0], [6.2, 3.0]] },
  },
  b: {
    title: 'Layout B: Delhi shape (recommended)',
    subtitle: '15 districts plus the river, real compass directions, the Ring Road holds the core',
    windFactor: 1.1,
    fillerKm2: 3.2,
    river: { x: 6.95, width: 0.5, y1: 5.9, y2: -1.6, bend: 0.2 },
    ringRoad: { x1: 1.9, y1: -0.1, x2: 6.55, y2: 5.6, junction: [1.9, -0.1, 'Dhaula Kuan'] },
    districts: [
      d('D17', ['Haunted', 'ruin (Ridge)'], 2.05, 3.7, 0.8, 0.8, 'story'),
      d('D07', ['Paharganj', 'NDLS station'], 3.0, 4.4, 1.2, 0.9, 'old'),
      d('D08', ['GB Road'], 4.25, 4.75, 0.6, 0.5, 'old'),
      d('D09', ['Chandni Chowk', 'Red Fort', 'Jama Masjid'], 4.9, 4.3, 1.6, 1.1, 'old'),
      d('D0102', ['Connaught Place', '+ Jantar Mantar'], 3.1, 2.45, 1.2, 1.6, 'core'),
      d('D04', ['ITO, Pragati', 'Maidan, cop HQ'], 4.95, 2.8, 1.4, 1.2, 'core'),
      d('D05', ['Lutyens', 'Gymkhana'], 2.05, 1.6, 1.0, 0.9, 'story'),
      d('D03', ['India Gate, Kartavya Path'], 3.15, 1.45, 2.2, 0.8, 'core'),
      d('D06', ['Khan Market', 'Lodhi, Golf Club'], 3.3, 0.35, 1.4, 1.0, 'story'),
      d('D16', ['Nizamuddin', "Humayun's Tomb"], 5.05, 0.3, 1.2, 1.0, 'core'),
      d('D12', ['Laxmi Nagar', 'East Delhi'], 7.45, 2.7, 1.2, 1.0, 'east'),
      d('D20', ['Qutub Minar', 'Mehrauli'], 3.6, -1.4, 1.0, 1.0, 'south'),
      d('D19', ['Vasant Kunj'], 2.1, -1.45, 1.2, 1.0, 'south'),
      d('D21', ['IGI Airport T3', 'Aerocity'], -0.4, 0.4, 1.8, 1.0, 'south'),
      d('D22', ['Cyber City', 'Gurugram'], 0.1, -1.5, 1.2, 1.0, 'ncr'),
    ],
    connectors: [
      { name: 'NH-48', kind: 'highway', pts: [[1.9, -0.1], [1.6, -0.4], [1.3, -0.9], [0.5, -1.8]], lp: [0.55, -1.75] },
      { name: 'Airport road', kind: 'highway', pts: [[1.65, -0.3], [1.3, 0.4]], lp: [0.2, 0.15] },
      { name: 'MG Road', kind: 'highway', pts: [[3.6, -1.2], [3.3, -1.2]], label: false },
      { name: 'MG Road', kind: 'highway', pts: [[2.1, -1.2], [1.2, -1.2]], lp: [1.35, -1.4] },
      { name: 'Aurobindo Marg', kind: 'avenue', pts: [[4.1, -0.1], [4.1, -0.4]], lp: [4.2, -0.3] },
      { name: 'Barapullah (elevated)', kind: 'elevated', pts: [[5.05, 0.2], [3.0, 0.2]], lp: [3.0, 0.05] },
      { name: 'Janpath', kind: 'avenue', pts: [[3.9, 2.45], [3.9, 2.25]], lp: [4.0, 2.38] },
      { name: 'Barakhamba Rd', kind: 'avenue', pts: [[4.3, 3.6], [4.95, 3.6]] },
      { name: 'Minto Rd', kind: 'avenue', pts: [[4.0, 4.25], [4.4, 4.75]] },
      { name: 'BSZ Marg', kind: 'avenue', pts: [[5.6, 4.0], [5.6, 4.3]] },
      { name: 'Mathura Rd', kind: 'avenue', pts: [[5.8, 2.8], [5.8, 1.3]] },
      { name: 'Ridge Rd', kind: 'avenue', pts: [[2.85, 4.1], [3.1, 3.8]] },
      { name: 'ITO bridge', kind: 'bridge', pts: [[6.35, 3.3], [7.45, 3.3]], lp: [6.55, 3.05] },
      { name: 'Nizamuddin bridge', kind: 'bridge', pts: [[6.55, 0.8], [7.6, 0.8]] },
      { name: 'Pushta Rd', kind: 'avenue', pts: [[7.6, 0.8], [7.8, 2.7]] },
    ],
    route: { name: 'Cyber City to Laxmi Nagar', pts: [[0.7, -1.0], [1.3, -0.9], [1.6, -0.4], [1.9, -0.1], [6.55, -0.1], [6.55, 3.3], [8.05, 3.2]] },
  },
};

// Layout C: B plus the wider east bank and Noida
{
  const b = LAYOUTS.b;
  LAYOUTS.c = {
    ...b,
    title: 'Layout C: Delhi plus NCR',
    subtitle: '19 districts plus the river: B plus Kashmere Gate, Shahdara, Akshardham, Noida',
    fillerKm2: 3.6,
    river: { ...b.river, y1: 6.7, y2: -2.2 },
    districts: [
      ...b.districts,
      d('D10', ['Kashmere Gate', 'ISBT'], 4.95, 5.68, 1.0, 0.8, 'old'),
      d('D13', ['Shahdara', 'back lanes'], 7.45, 4.6, 1.2, 1.0, 'east'),
      d('D14', ['Akshardham'], 7.45, 1.2, 1.2, 1.0, 'east'),
      d('D15', ['Noida Sec 18', 'Film City'], 8.3, -1.3, 1.4, 1.0, 'ncr'),
    ],
    connectors: [
      ...b.connectors.filter((c) => c.name !== 'Pushta Rd'),
      { name: 'Loha Pul (old bridge)', kind: 'bridge', pts: [[6.5, 5.0], [7.45, 5.0]], lp: [6.55, 4.75] },
      { name: 'Pushta Rd', kind: 'avenue', pts: [[7.35, 4.6], [7.35, 0.8]], label: false },
      { name: 'DND Flyway', kind: 'highway', pts: [[6.55, -0.1], [7.3, -0.4], [8.3, -0.6]] },
      { name: 'NH-9', kind: 'highway', pts: [[8.65, 1.2], [8.9, -0.3]] },
    ],
    route: { name: 'Cyber City to Shahdara', pts: [[0.7, -1.0], [1.3, -0.9], [1.6, -0.4], [1.9, -0.1], [6.55, -0.1], [6.55, 5.0], [7.45, 5.0], [8.05, 5.1]] },
  };
}

const KIND = {
  ring: { stroke: '#d9822b', width: 6, dash: '' },
  highway: { stroke: '#c0392b', width: 4, dash: '' },
  bridge: { stroke: '#333333', width: 6, dash: '' },
  elevated: { stroke: '#8e44ad', width: 3, dash: '8 4' },
  avenue: { stroke: '#7f8c8d', width: 2.5, dash: '' },
};

const len = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

function totals(L) {
  const districtKm2 = L.districts.reduce((s, x) => s + x.w * x.h, 0);
  const xs = [], ys = [];
  for (const x of L.districts) { xs.push(x.x0, x.x0 + x.w); ys.push(x.y0, x.y0 + x.h); }
  xs.push(L.river.x - L.river.width / 2, L.river.x + L.river.width / 2); ys.push(L.river.y1, L.river.y2);
  const bbox = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  const riverKm2 = L.river.width * (L.river.y1 - L.river.y2);
  const landKm2 = districtKm2 + L.fillerKm2;
  const routeKm = len(L.route.pts) * L.windFactor;
  return {
    districts: L.districts.length,
    districtKm2: +districtKm2.toFixed(1),
    fillerAndConnectorsKm2: L.fillerKm2,
    landKm2: +landKm2.toFixed(1),
    riverKm2: +riverKm2.toFixed(1),
    detailBakeKm2: +(landKm2 + riverKm2).toFixed(1),
    bboxKm: [+(bbox.x1 - bbox.x0).toFixed(1), +(bbox.y1 - bbox.y0).toFixed(1)],
    terrainBakeKm2: +((bbox.x1 - bbox.x0 + 1) * (bbox.y1 - bbox.y0 + 1)).toFixed(0),
    longestRoute: L.route.name,
    routeKm: +routeKm.toFixed(1),
    min80: +((routeKm / 80) * 60).toFixed(1),
    min65: +((routeKm / 65) * 60).toFixed(1),
    tiles250m: Math.round((landKm2 + riverKm2) * 16),
    bbox,
  };
}

function svg(L, T) {
  const PX = 80; // px per km
  const M = 50; // margin px
  const top = 70; // title band
  const bottom = 90; // legend band
  const { bbox } = T;
  const W = Math.max(860, Math.round((bbox.x1 - bbox.x0) * PX + 2 * M + 40));
  const H = Math.round((bbox.y1 - bbox.y0) * PX + 2 * M + top + bottom);
  const X = (x) => +(M + (x - bbox.x0) * PX).toFixed(1);
  const Y = (y) => +(top + M + (bbox.y1 - y) * PX).toFixed(1);
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif">`);
  out.push(`<rect width="${W}" height="${H}" fill="#fbf8f1"/>`);
  out.push(`<text x="${M}" y="30" font-size="20" font-weight="bold" fill="#222">${L.title}</text>`);
  out.push(`<text x="${M}" y="52" font-size="13" fill="#555">${L.subtitle}. Sketch, every number is an estimate.</text>`);
  // filler hint: the playable area (light) inside bbox
  out.push(`<rect x="${X(bbox.x0) - 10}" y="${Y(bbox.y1) - 10}" width="${(bbox.x1 - bbox.x0) * PX + 20}" height="${(bbox.y1 - bbox.y0) * PX + 20}" fill="#efe9dc" stroke="#d6cdb8" stroke-dasharray="6 4"/>`);
  // river: a gently bending band
  const r = L.river;
  const steps = 24;
  const left = [], right = [];
  for (let i = 0; i <= steps; i++) {
    const y = r.y1 + ((r.y2 - r.y1) * i) / steps;
    const cx = r.x + r.bend * Math.sin((i / steps) * Math.PI * 2);
    left.push(`${X(cx - r.width / 2)},${Y(y)}`);
    right.unshift(`${X(cx + r.width / 2)},${Y(y)}`);
  }
  out.push(`<polygon points="${[...left, ...right].join(' ')}" fill="#7fb3d5" opacity="0.85"/>`);
  out.push(`<text x="${X(r.x) + 4}" y="${Y(r.y2) - 14}" font-size="13" fill="#1f4e79" font-style="italic" transform="rotate(-90 ${X(r.x) + 4} ${Y(r.y2) - 14})">Yamuna</text>`);
  // ring road
  if (L.ringRoad) {
    const g = L.ringRoad;
    out.push(`<rect x="${X(g.x1)}" y="${Y(g.y2)}" width="${(g.x2 - g.x1) * PX}" height="${(g.y2 - g.y1) * PX}" rx="40" fill="none" stroke="${KIND.ring.stroke}" stroke-width="${KIND.ring.width}" opacity="0.9"/>`);
    out.push(`<text x="${X(g.x1) + 50}" y="${Y(g.y2) - 8}" font-size="12" fill="#a0521a" font-weight="bold">Ring Road</text>`);
    if (g.junction) {
      const [jx, jy, jn] = g.junction;
      out.push(`<circle cx="${X(jx)}" cy="${Y(jy)}" r="7" fill="#fff" stroke="#c0392b" stroke-width="3"/><text x="${X(jx) + 10}" y="${Y(jy) + 4}" font-size="10.5" font-weight="bold" fill="#c0392b" stroke="#fbf8f1" stroke-width="3" paint-order="stroke">${jn}</text>`);
    }
  }
  // districts
  for (const x of L.districts) {
    const fx = X(x.x0), fy = Y(x.y0 + x.h), fw = x.w * PX, fh = x.h * PX;
    out.push(`<rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" fill="${G[x.group]}" stroke="#5a4a3a" stroke-width="1.5"/>`);
    const fs = x.w < 0.7 ? 10 : 11.5;
    const lines = [...x.label, `${(x.w * x.h).toFixed(1)} km2`];
    const cy = fy + fh / 2 - ((lines.length - 1) * (fs + 2)) / 2 + fs / 3;
    lines.forEach((t, i) => {
      const isSize = i === lines.length - 1;
      out.push(`<text x="${fx + fw / 2}" y="${(cy + i * (fs + 2)).toFixed(1)}" font-size="${isSize ? fs - 1.5 : fs}" text-anchor="middle" fill="${isSize ? '#6b5b4b' : '#222'}"${isSize ? '' : ' font-weight="bold"'}>${t}</text>`);
    });
  }
  // connectors on top
  for (const c of L.connectors) {
    const k = KIND[c.kind];
    const pts = c.pts.map((p) => `${X(p[0])},${Y(p[1])}`).join(' ');
    out.push(`<polyline points="${pts}" fill="none" stroke="${k.stroke}" stroke-width="${k.width}" stroke-linecap="round" stroke-linejoin="round"${k.dash ? ` stroke-dasharray="${k.dash}"` : ''}/>`);
    if (c.label !== false) {
      const a = c.pts[0], b = c.pts[1];
      let mx = (X(a[0]) + X(b[0])) / 2 + 5, my = (Y(a[1]) + Y(b[1])) / 2 - 5;
      if (c.lp) { mx = X(c.lp[0]); my = Y(c.lp[1]); }
      out.push(`<text x="${mx}" y="${my}" font-size="10.5" fill="${k.stroke}" font-weight="bold" stroke="#fbf8f1" stroke-width="3" paint-order="stroke">${c.name}</text>`);
    }
  }
  // longest route (dotted)
  out.push(`<polyline points="${L.route.pts.map((p) => `${X(p[0])},${Y(p[1])}`).join(' ')}" fill="none" stroke="#111" stroke-width="1.5" stroke-dasharray="2 4"/>`);
  // north arrow
  const nx = W - M - 10, ny = top + 20;
  out.push(`<polygon points="${nx},${ny} ${nx - 10},${ny + 28} ${nx},${ny + 21} ${nx + 10},${ny + 28}" fill="#222"/>`);
  out.push(`<text x="${nx}" y="${ny - 6}" font-size="15" font-weight="bold" text-anchor="middle">N</text>`);
  // scale bar 0..2 km
  const sx = M, sy = H - bottom + 30;
  out.push(`<rect x="${sx}" y="${sy}" width="${PX}" height="8" fill="#222"/><rect x="${sx + PX}" y="${sy}" width="${PX}" height="8" fill="#fff" stroke="#222"/>`);
  out.push(`<text x="${sx}" y="${sy - 5}" font-size="11">0</text><text x="${sx + PX - 8}" y="${sy - 5}" font-size="11">1 km</text><text x="${sx + 2 * PX - 8}" y="${sy - 5}" font-size="11">2 km</text>`);
  // legend
  const lx = sx + 2 * PX + 40;
  const leg = [['Ring Road', KIND.ring], ['Highway', KIND.highway], ['Bridge', KIND.bridge], ['Elevated', KIND.elevated], ['Main road', KIND.avenue]];
  leg.forEach(([n, k], i) => {
    const x = lx + i * 95;
    out.push(`<line x1="${x}" y1="${sy + 4}" x2="${x + 28}" y2="${sy + 4}" stroke="${k.stroke}" stroke-width="${k.width}"${k.dash ? ` stroke-dasharray="${k.dash}"` : ''}/><text x="${x + 33}" y="${sy + 8}" font-size="11">${n}</text>`);
  });
  out.push(`<line x1="${lx}" y1="${sy + 26}" x2="${lx + 28}" y2="${sy + 26}" stroke="#111" stroke-width="1.5" stroke-dasharray="2 4"/><text x="${lx + 33}" y="${sy + 30}" font-size="11">Longest drive: ${T.longestRoute}, about ${T.routeKm} km, ${T.min80} min at 80 km/h (est)</text>`);
  out.push(`<text x="${sx}" y="${sy + 30}" font-size="11" fill="#555">Land about ${T.landKm2} km2 (est)</text>`);
  out.push(`<text x="${sx}" y="${sy + 48}" font-size="10.5" fill="#777">Boxes: real districts at true scale, moved closer (translation only). Pale ground: filler from area profiles. Dashed edge: map boundary.</text>`);
  out.push('</svg>');
  return out.join('\n');
}

const report = {};
for (const [key, L] of Object.entries(LAYOUTS)) {
  const T = totals(L);
  fs.writeFileSync(path.join(here, `district_layout_${key}.svg`), svg(L, T));
  // placement offset per district: game centre minus real centre, both relative to CP (km)
  const cp = L.districts.find((x) => x.id === 'D01' || x.id === 'D0102');
  const cpc = [cp.x0 + cp.w / 2, cp.y0 + cp.h / 2];
  const offsets = L.districts.map((x) => {
    const g = [x.x0 + x.w / 2 - cpc[0], x.y0 + x.h / 2 - cpc[1]];
    const rk = realKm(x.id);
    return `${x.id} ${x.label.join(' ')}: moved ${(g[0] - rk[0]).toFixed(1)} km east, ${(g[1] - rk[1]).toFixed(1)} km north (real ${Math.hypot(...rk).toFixed(1)} km from CP, game ${Math.hypot(...g).toFixed(1)} km)`;
  });
  const { bbox, ...rest } = T;
  report[key] = { ...rest, offsets };
}
console.log(JSON.stringify(report, null, 1));
