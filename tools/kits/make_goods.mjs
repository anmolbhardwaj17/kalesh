// Shop goods behind the shop fronts (P2-048 fix round: the shelves read as flat colour blocks): three 256 px cells per
// kit in the trim atlas (make_textures.mjs, row 768: goods A, goods B, goods C), each a lit shop interior with goods a
// passer-by recognises by the shop kind of the area (signboards.md "Per area"). The kit shader picks one of the three
// per bay. Simple shapes with a little shading, no text, no brands. Full shop interiors come later (P2-056).

/** The three goods of each kit, in cell order (A, B, C). */
export const GOODS_BY_KIT = {
  bazaar: ['sweets', 'cloth', 'ribbons'],
  gali: ['sacks', 'utensils', 'ribbons'],
  hardware: ['motors', 'pipes', 'cartons'],
  hotel: ['hangers', 'bags', 'phones'],
  market: ['brass', 'hangers', 'cloth'],
  colonnade: ['books', 'hangers', 'phones'],
  office: ['books', 'cartons', 'phones'],
  lutyens: ['books', 'brass', 'cartons'],
};

function rngOf(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
const f = (v) => Math.round(v * 10) / 10;
const rect = (x, y, w, h, fill, extra = '') => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${fill}" ${extra}/>`;
const circ = (x, y, rr, fill, extra = '') => `<circle cx="${f(x)}" cy="${f(y)}" r="${f(rr)}" fill="${fill}" ${extra}/>`;
const ell = (x, y, rx, ry, fill, extra = '') => `<ellipse cx="${f(x)}" cy="${f(y)}" rx="${f(rx)}" ry="${f(ry)}" fill="${fill}" ${extra}/>`;

/** The interior: dark back wall, a warm tube light glow at the top, shelf boards at the given heights (0..1 of the cell). */
function room(x, y, id, shelves, wall = '#2e261f') {
  let s = `<defs><linearGradient id="g${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff2cf" stop-opacity="0.32"/><stop offset="0.55" stop-color="#fff2cf" stop-opacity="0.06"/><stop offset="1" stop-color="#000" stop-opacity="0.25"/></linearGradient>`;
  s += `<linearGradient id="m${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7d8288"/><stop offset="0.35" stop-color="#e9edf0"/><stop offset="0.6" stop-color="#a9aeb3"/><stop offset="1" stop-color="#6b7075"/></linearGradient></defs>`;
  s += rect(x, y, 256, 256, wall);
  // the tube light along the top
  s += rect(x + 30, y + 3, 196, 5, '#fffbe8') + rect(x + 26, y + 8, 204, 3, '#9a8f7a');
  for (const k of shelves) s += rect(x, y + k * 256, 256, 5, '#6b4a33') + rect(x, y + k * 256 + 5, 256, 2, '#1e1712');
  return s;
}
const light = (x, y, id) => rect(x, y, 256, 256, `url(#g${id})`);

// ------------------------------------------------------------------ the goods
function sweets(x, y, r, id) {
  let s = room(x, y, id, [0.2, 0.4], '#3a2a22');
  // boxed sweets on the shelves: red, gold and pink boxes with a ribbon stripe
  for (const [row, h] of [[0.2, 34], [0.4, 34]]) {
    let cx = x + 6;
    while (cx < x + 246) {
      const w = 22 + r() * 14;
      const c = pick(r, ['#b3261e', '#d9a527', '#c2185b', '#e8e0c8', '#8e1b2b']);
      const hh = h - r() * 10;
      s += rect(cx, y + row * 256 - hh, w - 3, hh, c) + rect(cx, y + row * 256 - hh * 0.55, w - 3, 3, '#f2d16b') + rect(cx, y + row * 256 - hh, w - 3, 3, '#ffffff', 'opacity="0.25"');
      cx += w;
    }
  }
  // the glass counter: two rows of steel trays heaped with sweets
  const cy = y + 118;
  s += rect(x, cy, 256, 138, '#4a3a2c') + rect(x + 4, cy + 4, 248, 128, '#20262a');
  const kinds = [['#e8a33a', 'ball'], ['#f3ede0', 'diamond'], ['#e07a1f', 'ring'], ['#7aa84a', 'diamond'], ['#f2c64f', 'ball'], ['#a8572a', 'ball'], ['#f6e7c1', 'roll'], ['#d65a7a', 'ball']];
  for (let row = 0; row < 2; row++)
    for (let k = 0; k < 4; k++) {
      const tx = x + 10 + k * 61;
      const ty = cy + 14 + row * 60;
      s += rect(tx, ty + 30, 54, 16, `url(#m${id})`, 'rx="3"');
      const [c, kind] = kinds[(k + row * 4 + Math.floor(r() * 2)) % kinds.length];
      for (let j = 0; j < 9; j++)
        for (let i = 0; i < 5 - (j % 2); i++) {
          const px = tx + 7 + i * 10 + (j % 2) * 5;
          const py = ty + 34 - j * 3.4;
          if (j > 5 && (i === 0 || i === 4)) continue;
          if (kind === 'ball') s += circ(px, py, 4.6, c) + circ(px - 1.4, py - 1.4, 1.4, '#ffffff', 'opacity="0.35"');
          else if (kind === 'diamond') s += `<polygon points="${f(px)},${f(py - 4)} ${f(px + 5)},${f(py)} ${f(px)},${f(py + 4)} ${f(px - 5)},${f(py)}" fill="${c}" stroke="#c9ccd0" stroke-width="0.8"/>`;
          else if (kind === 'ring') s += circ(px, py, 3.8, 'none', `stroke="${c}" stroke-width="2.4"`);
          else s += rect(px - 4, py - 2.5, 8, 5, c, 'rx="2"');
        }
    }
  // glass: a pale sheen and the front edge
  s += rect(x + 4, cy + 4, 248, 128, '#bfe3ee', 'opacity="0.12"') + `<polygon points="${x + 20},${cy + 6} ${x + 70},${cy + 6} ${x + 30},${cy + 130} ${x + 4},${cy + 130}" fill="#ffffff" opacity="0.08"/>`;
  s += rect(x, cy + 62, 256, 3, '#8f969b');
  return s + light(x, y, id);
}

function cloth(x, y, r, id) {
  let s = room(x, y, id, [0.22, 0.44, 0.66], '#3b2f27');
  const cols = ['#b3261e', '#e6b422', '#2c3e70', '#7a4a8c', '#3a7d44', '#d6336c', '#0f6e74', '#f1ecdf', '#8e1b2b', '#f08c2e'];
  // folded saree and suit stacks: thin folds with a gold border
  for (const k of [0.22, 0.44, 0.66]) {
    let cx = x + 4;
    while (cx < x + 244) {
      const w = 26 + r() * 10;
      const n = 5 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        const c = pick(r, cols);
        const fy = y + k * 256 - (i + 1) * 5.2;
        s += rect(cx, fy, w - 3, 4.6, c) + rect(cx, fy + 3.2, w - 3, 1.2, '#e9c45a', 'opacity="0.8"');
      }
      cx += w;
    }
  }
  // the gaddi: a white sheet over the floor seat with bolts of cloth standing on it
  s += rect(x, y + 200, 256, 56, '#ece6d6') + rect(x, y + 200, 256, 3, '#c9c2b0');
  for (let i = 0; i < 9; i++) {
    const bx = x + 8 + i * 27;
    const c = pick(r, cols);
    s += rect(bx, y + 176, 20, 30, c, 'rx="3"') + ell(bx + 10, y + 177, 10, 3, '#000', 'opacity="0.25"') + rect(bx + 3, y + 178, 3, 26, '#ffffff', 'opacity="0.18"');
  }
  return s + light(x, y, id);
}

function ribbons(x, y, r, id) {
  let s = room(x, y, id, [0.32, 0.6], '#3a2c24');
  // hanging tassels and lace from a rail at the top
  s += rect(x, y + 14, 256, 3, '#8a7a5a');
  for (let i = 0; i < 26; i++) {
    const c = pick(r, ['#e9c45a', '#c0c4c8', '#d6336c', '#b3261e', '#3a7d44', '#2c3e70', '#f08c2e']);
    const len = 30 + r() * 40;
    s += rect(x + 4 + i * 9.6, y + 17, 3, len, c) + circ(x + 5.5 + i * 9.6, y + 17 + len, 3, c);
  }
  // reels of gota and lace on two shelves and the counter
  for (const [k, n] of [[0.32, 9], [0.6, 9]]) {
    for (let row = 0; row < 2; row++)
      for (let i = 0; i < n; i++) {
        const c = pick(r, ['#e9c45a', '#d8d2c0', '#c2185b', '#b3261e', '#2c6e49', '#7a4a8c', '#e07a1f', '#c0c4c8']);
        const cx = x + 15 + i * 28 + (row % 2) * 6;
        const cy = y + k * 256 - 11 - row * 21;
        s += circ(cx, cy, 10, c) + circ(cx, cy, 3.5, '#3a2c24') + circ(cx - 3, cy - 3, 3, '#ffffff', 'opacity="0.3"');
      }
  }
  s += rect(x, y + 196, 256, 60, '#6b4a33') + rect(x, y + 196, 256, 4, '#8a6447');
  for (let i = 0; i < 7; i++) s += rect(x + 10 + i * 35, y + 186, 28, 12, pick(r, ['#e9c45a', '#c0c4c8', '#d6336c', '#f1ecdf']), 'rx="2"');
  return s + light(x, y, id);
}

function sacks(x, y, r, id) {
  let s = room(x, y, id, [0.2, 0.4], '#33281f');
  // tins and jars of spices on the shelves
  for (const k of [0.2, 0.4]) {
    for (let i = 0; i < 11; i++) {
      const cx = x + 6 + i * 23;
      const c = pick(r, ['#c0392b', '#e6b422', '#8d5a3b', '#3a7d44', '#d35400', '#6b3e26']);
      if (r() < 0.5) s += rect(cx, y + k * 256 - 30, 18, 30, `url(#m${id})`, 'rx="2"') + rect(cx, y + k * 256 - 22, 18, 10, c);
      else s += rect(cx, y + k * 256 - 26, 18, 26, '#cfe0dc', 'opacity="0.55" rx="3"') + rect(cx + 2, y + k * 256 - 18, 14, 17, c, 'rx="2"');
    }
  }
  // open jute sacks on the floor, the mouths rolled down, heaped with dry fruit and spices
  const heaps = [['#c48a4a', 'nut'], ['#efe1bf', 'nut'], ['#b3261e', 'chilli'], ['#e0a91f', 'powder'], ['#5a2f3a', 'nut'], ['#8a5a2e', 'nut'], ['#d9c27a', 'nut']];
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 4; i++) {
      const bx = x + 6 + i * 62 + row * 30 - (row ? 0 : 0);
      if (bx > x + 220) continue;
      const by = y + 132 + row * 62;
      const [c, kind] = heaps[(i + row * 3 + Math.floor(r() * 3)) % heaps.length];
      s += `<path d="M${bx},${by + 64} L${bx + 4},${by + 14} L${bx + 54},${by + 14} L${bx + 58},${by + 64} Z" fill="#b08a5a"/>`;
      for (let k = 0; k < 4; k++) s += rect(bx + 6, by + 24 + k * 10, 46, 1.4, '#8a6a42');
      s += ell(bx + 29, by + 15, 29, 7, '#c9a46e') + ell(bx + 29, by + 14, 24, 5, c);
      s += `<path d="M${bx + 7},${by + 14} Q${bx + 29},${by - 8} ${bx + 51},${by + 14} Z" fill="${c}"/>`;
      for (let k = 0; k < 18; k++) {
        const px = bx + 12 + r() * 34;
        const py = by + 2 + r() * 12 + Math.abs(px - bx - 29) * 0.2;
        if (kind === 'nut') s += ell(px, py, 2.6, 1.6, '#000', 'opacity="0.22"') + ell(px - 0.6, py - 0.6, 2.2, 1.3, '#ffffff', 'opacity="0.18"');
        else if (kind === 'chilli') s += rect(px - 3, py - 1, 6, 2, '#7a1010', 'rx="1"');
      }
    }
  return s + light(x, y, id);
}

function utensils(x, y, r, id) {
  let s = room(x, y, id, [0.24, 0.48], '#2f2a26');
  const steel = `url(#m${id})`;
  // stacks of steel plates and bowls on the shelves
  for (const k of [0.24, 0.48]) {
    for (let i = 0; i < 7; i++) {
      const cx = x + 20 + i * 36;
      if (r() < 0.5) for (let j = 0; j < 8; j++) s += ell(cx, y + k * 256 - 4 - j * 3.6, 15, 3.4, steel, 'stroke="#5c6166" stroke-width="0.5"');
      else s += `<path d="M${cx - 14},${y + k * 256 - 30} L${cx + 14},${y + k * 256 - 30} L${cx + 10},${y + k * 256 - 2} L${cx - 10},${y + k * 256 - 2} Z" fill="${steel}"/>` + ell(cx, y + k * 256 - 30, 14, 3, '#dfe3e6');
    }
  }
  // big pots and buckets on the floor, ladles hanging
  for (let i = 0; i < 5; i++) {
    const cx = x + 26 + i * 52;
    const w = 20 + r() * 6;
    const top = y + 150 + r() * 20;
    s += `<path d="M${cx - w},${top} L${cx + w},${top} Q${cx + w + 4},${y + 236} ${cx + w - 6},${y + 246} L${cx - w + 6},${y + 246} Q${cx - w - 4},${y + 236} ${cx - w},${top} Z" fill="${steel}"/>` + ell(cx, top, w, 5, '#e6eaec') + ell(cx, top, w - 3, 3.5, '#4a4f53');
  }
  for (let i = 0; i < 12; i++) s += rect(x + 10 + i * 20, y + 70, 2, 34, '#b9bec2') + ell(x + 11 + i * 20, y + 106, 5, 3.4, steel);
  return s + light(x, y, id);
}

function motors(x, y, r, id) {
  let s = room(x, y, id, [0.24, 0.48, 0.72], '#2c2a27');
  // electric motors: a finned body, an end bell, a shaft and a base; pumps in red
  for (const k of [0.24, 0.48, 0.72]) {
    for (let i = 0; i < 5; i++) {
      const bx = x + 6 + i * 50;
      const by = y + k * 256;
      const pump = r() < 0.3;
      const c = pump ? '#b3261e' : pick(r, ['#2f5d8a', '#2e6b4f', '#3a6fa8', '#5f6a72']);
      const w = 34;
      const h = 30 + r() * 6;
      s += rect(bx + 2, by - 6, w + 4, 6, '#444') + rect(bx, by - 6 - h, w, h, c, 'rx="4"');
      for (let j = 0; j < 6; j++) s += rect(bx + 3 + j * 5.4, by - 4 - h, 2, h - 4, '#000', 'opacity="0.22"');
      s += rect(bx + w - 2, by - 6 - h * 0.85, 8, h * 0.7, '#8a9096', 'rx="3"') + rect(bx + w + 6, by - 6 - h * 0.55, 6, 4, '#c9ccd0');
      s += rect(bx + 4, by - h - 2, 12, 7, '#d8d2c0') + rect(bx, by - 6 - h, w, 4, '#ffffff', 'opacity="0.2"');
    }
  }
  // cartons along the floor
  for (let i = 0; i < 6; i++) s += rect(x + 4 + i * 42, y + 200 - (i % 2) * 10, 38, 56 + (i % 2) * 10, '#a77a4a') + rect(x + 10 + i * 42, y + 214 - (i % 2) * 10, 22, 12, '#efe9dc') + rect(x + 4 + i * 42, y + 200 - (i % 2) * 10, 38, 3, '#7a5432');
  return s + light(x, y, id);
}

function pipes(x, y, r, id) {
  let s = room(x, y, id, [0.5], '#2e2b28');
  // V-belts and hoses hanging from pegs along the top
  for (let i = 0; i < 9; i++) {
    const cx = x + 16 + i * 28;
    s += rect(cx - 1, y + 14, 3, 6, '#aaa') + ell(cx, y + 50, 10, 30, 'none', `stroke="${i % 3 === 2 ? '#2f5d8a' : '#151515'}" stroke-width="${i % 3 === 2 ? 5 : 3.5}"`);
  }
  // bins of fittings on the shelf: elbows, tees and valves in brass, steel and PVC
  for (let i = 0; i < 8; i++) {
    const bx = x + 4 + i * 31;
    const by = y + 128;
    s += rect(bx, by - 26, 28, 26, '#3a5f8a') + rect(bx, by - 26, 28, 4, '#5d82ad');
    const c = pick(r, ['#c9a227', '#b8bdc2', '#e9e7e0', '#d8d2c0']);
    for (let j = 0; j < 4; j++) s += `<path d="M${bx + 4 + j * 6},${by - 26} q 3,-6 6,0" fill="none" stroke="${c}" stroke-width="3.2"/>`;
  }
  // pipe lengths racked flat on the lower wall: GI, PVC, CPVC
  for (let i = 0; i < 12; i++) {
    const py = y + 142 + i * 9;
    const c = pick(r, ['#9aa0a6', '#e9e7e0', '#d9cf9a', '#6c7278', '#efefef', '#3a6fa8']);
    s += rect(x, py, 256, 6.5, c) + rect(x, py, 256, 1.6, '#ffffff', 'opacity="0.35"') + rect(x, py + 5, 256, 1.5, '#000', 'opacity="0.3"');
  }
  s += rect(x + 20, y + 136, 8, 120, '#4a3a2c') + rect(x + 228, y + 136, 8, 120, '#4a3a2c');
  return s + light(x, y, id);
}

function cartons(x, y, r, id) {
  let s = room(x, y, id, [0.3, 0.6], '#2e2924');
  // stacked cartons with white labels and printed bands, files on top
  for (const [k, h] of [[0.3, 50], [0.6, 50], [1.0, 70]]) {
    let cx = x + 2;
    while (cx < x + 250) {
      const w = 30 + r() * 26;
      const hh = h - r() * 14;
      const by = y + k * 256 - (k === 1 ? 0 : 0);
      const c = pick(r, ['#a77a4a', '#b8895a', '#9b6c3e', '#c49a68']);
      s += rect(cx, by - hh, w - 2, hh, c) + rect(cx, by - hh, w - 2, 3, '#7a5432') + rect(cx + w * 0.3, by - hh, 4, hh, '#d8c49a', 'opacity="0.6"');
      if (r() < 0.7) s += rect(cx + 5, by - hh * 0.6, w * 0.45, hh * 0.28, '#f1ede2') + rect(cx + 7, by - hh * 0.55, w * 0.3, 2, '#333', 'opacity="0.6"');
      if (r() < 0.35) s += rect(cx, by - hh * 0.3, w - 2, 5, pick(r, ['#b3261e', '#1d3f8f', '#2c6e49']));
      cx += w;
    }
  }
  return s + light(x, y, id);
}

function hangers(x, y, r, id) {
  let s = room(x, y, id, [0.92], '#38302a');
  const cols = ['#b3261e', '#e6b422', '#2c3e70', '#7a4a8c', '#3a7d44', '#d6336c', '#f1ecdf', '#1c1c1e', '#0f6e74', '#f08c2e', '#6f94c4'];
  // two rails of shirts and kurtas on hangers
  for (const [ry, len] of [[22, 70], [112, 78]]) {
    s += rect(x, y + ry, 256, 3, '#b9bec2');
    for (let i = 0; i < 12; i++) {
      const cx = x + 12 + i * 21;
      const c = pick(r, cols);
      s += `<path d="M${cx},${y + ry} l -9,6 l 18,0 z" fill="none" stroke="#9aa0a6" stroke-width="1.2"/>`;
      s += `<path d="M${cx - 10},${y + ry + 6} L${cx + 10},${y + ry + 6} L${cx + 14},${y + ry + 18} L${cx + 10},${y + ry + 20} L${cx + 9},${y + ry + len} L${cx - 9},${y + ry + len} L${cx - 10},${y + ry + 20} L${cx - 14},${y + ry + 18} Z" fill="${c}"/>`;
      s += rect(cx - 0.6, y + ry + 8, 1.2, len - 10, '#000', 'opacity="0.2"') + rect(cx - 10, y + ry + 6, 20, 3, '#ffffff', 'opacity="0.15"');
    }
  }
  // shoes and folded jeans on the low shelf
  for (let i = 0; i < 10; i++) s += rect(x + 6 + i * 25, y + 222, 20, 13, pick(r, ['#2c3e70', '#1c1c1e', '#5d4037', '#f1ecdf', '#b3261e']), 'rx="5"');
  return s + light(x, y, id);
}

function bags(x, y, r, id) {
  // (fix round 3: the bags were flat rounded rectangles) a slat wall of backpacks and shoulder bags hung on hooks, each
  // with a top handle, a rounded body shaded from the light side to the dark side, a front pocket with a zip, side
  // straps and its shadow on the wall; duffels rolled on a shelf; trolley cases with ribs, handles and wheels below
  let s = room(x, y, id, [0.62], '#3a332c');
  s += `<defs><linearGradient id="bs${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0.3"/><stop offset="0.3" stop-color="#fff" stop-opacity="0.04"/><stop offset="0.7" stop-color="#000" stop-opacity="0.08"/><stop offset="1" stop-color="#000" stop-opacity="0.45"/></linearGradient>`;
  s += `<linearGradient id="bv${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.16"/><stop offset="0.5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.4"/></linearGradient></defs>`;
  for (let i = 0; i < 10; i++) s += rect(x, y + 12 + i * 15, 256, 1.5, '#000', 'opacity="0.2"') + rect(x, y + 13.5 + i * 15, 256, 1, '#fff', 'opacity="0.05"');
  const cols = ['#6b4a33', '#2c3e70', '#b3261e', '#26262a', '#3a7d44', '#c48a4a', '#7a4a8c', '#d9a514', '#0f6e74', '#8a8f96'];
  for (let row = 0; row < 2; row++)
    for (let i = 0; i < 5; i++) {
      const w = 34 + r() * 8;
      const h = 44 + r() * 10;
      const cx = x + 27 + i * 50 + (row % 2) * 6 + (r() - 0.5) * 6;
      const cy = y + 20 + row * 70;
      const c = pick(r, cols);
      const body = `M${f(cx - w / 2 + 5)},${f(cy + 8)} Q${f(cx)},${f(cy + 1)} ${f(cx + w / 2 - 5)},${f(cy + 8)} Q${f(cx + w / 2 + 2)},${f(cy + 12)} ${f(cx + w / 2 + 1)},${f(cy + h * 0.6)} Q${f(cx + w / 2 + 1)},${f(cy + h + 4)} ${f(cx + w / 2 - 8)},${f(cy + h + 5)} L${f(cx - w / 2 + 8)},${f(cy + h + 5)} Q${f(cx - w / 2 - 1)},${f(cy + h + 4)} ${f(cx - w / 2 - 1)},${f(cy + h * 0.6)} Q${f(cx - w / 2 - 2)},${f(cy + 12)} ${f(cx - w / 2 + 5)},${f(cy + 8)} Z`;
      // the shadow on the wall, the hook and the handle loop
      s += `<path d="${body}" fill="#000" opacity="0.4" transform="translate(4 5)"/>`;
      s += rect(cx - 1.5, cy - 8, 3, 9, '#b9bec2') + `<path d="M${f(cx - 8)},${f(cy + 8)} Q${f(cx)},${f(cy - 10)} ${f(cx + 8)},${f(cy + 8)}" fill="none" stroke="#17171a" stroke-width="3"/>`;
      s += `<path d="${body}" fill="${c}"/><path d="${body}" fill="url(#bs${id})"/><path d="${body}" fill="url(#bv${id})"/>`;
      // the front pocket: a darker panel that stands out, its zip, a light upper lip
      const pw = w * 0.72;
      const ph = h * 0.42;
      s += rect(cx - pw / 2, cy + h * 0.52, pw, ph, '#000', 'opacity="0.26" rx="6"') + rect(cx - pw / 2, cy + h * 0.52, pw, 2.2, '#fff', 'opacity="0.28" rx="1"');
      s += `<path d="M${f(cx - pw / 2 + 3)},${f(cy + h * 0.62)} Q${f(cx)},${f(cy + h * 0.56)} ${f(cx + pw / 2 - 3)},${f(cy + h * 0.62)}" fill="none" stroke="#d8d2c0" stroke-width="1.3"/>`;
      // the main zip round the top and the side straps
      s += `<path d="M${f(cx - w / 2 + 3)},${f(cy + h * 0.36)} Q${f(cx)},${f(cy + 8)} ${f(cx + w / 2 - 3)},${f(cy + h * 0.36)}" fill="none" stroke="#000" stroke-width="1.4" opacity="0.5"/>`;
      s += rect(cx - w / 2 - 1, cy + h * 0.45, 3, h * 0.4, '#111', 'opacity="0.55"') + rect(cx + w / 2 - 2, cy + h * 0.45, 3, h * 0.4, '#111', 'opacity="0.55"');
      if (r() < 0.5) s += rect(cx - 5, cy + h * 0.7, 10, 6, pick(r, ['#f1ecdf', '#e6b422', '#b3261e']), 'rx="1"');
    }
  // duffels rolled on the shelf: a barrel with an end cap and two straps
  for (let i = 0; i < 4; i++) {
    const bx = x + 6 + i * 63;
    const by = y + 0.62 * 256 - 24;
    const c = pick(r, cols);
    s += rect(bx, by, 56, 24, c, 'rx="11"') + rect(bx, by, 56, 24, `url(#bv${id})`, 'rx="11"') + ell(bx + 50, by + 12, 6, 11.5, '#000', 'opacity="0.3"');
    s += rect(bx + 14, by, 4, 24, '#111', 'opacity="0.55"') + rect(bx + 34, by, 4, 24, '#111', 'opacity="0.55"') + rect(bx + 6, by + 3, 40, 2.5, '#fff', 'opacity="0.22" rx="1"');
  }
  // trolley cases standing on the floor
  for (let i = 0; i < 5; i++) {
    const c = pick(r, ['#2c3e70', '#b3261e', '#26262a', '#6b7075', '#7a4a8c', '#0f6e74']);
    const h = 56 + (i % 2) * 14 + r() * 6;
    const w = 40 + (i % 3) * 3;
    const bx = x + 5 + i * 50;
    const by = y + 250 - h;
    s += rect(bx + 4, by + 5, w, h, '#000', 'opacity="0.35" rx="6"');
    s += rect(bx + w * 0.3, by - 12, 2.5, 13, '#9aa0a6') + rect(bx + w * 0.64, by - 12, 2.5, 13, '#9aa0a6') + rect(bx + w * 0.26, by - 15, w * 0.48, 4, '#222', 'rx="2"');
    s += rect(bx, by, w, h, c, 'rx="6"') + rect(bx, by, w, h, `url(#bs${id})`, 'rx="6"');
    for (let k = 1; k < 5; k++) s += rect(bx + (w * k) / 5 - 1, by + 5, 2, h - 10, '#000', 'opacity="0.28"') + rect(bx + (w * k) / 5 + 1, by + 5, 1, h - 10, '#fff', 'opacity="0.12"');
    s += rect(bx + 3, by + h * 0.5 - 1, w - 6, 2.5, '#000', 'opacity="0.4"') + rect(bx + w * 0.4, by + 4, w * 0.2, 4, '#17171a', 'rx="2"');
    s += circ(bx + 7, by + h + 2, 3.2, '#111') + circ(bx + w - 7, by + h + 2, 3.2, '#111');
  }
  return s + light(x, y, id);
}

function phones(x, y, r, id) {
  let s = room(x, y, id, [], '#2a2d33');
  // a wall of accessory packets on pegs: covers, chargers, earphones
  for (let row = 0; row < 5; row++)
    for (let i = 0; i < 10; i++) {
      const px = x + 6 + i * 25;
      const py = y + 16 + row * 26;
      const c = pick(r, ['#e9ecef', '#1d3f8f', '#b3261e', '#f2c230', '#2c6e49', '#1c1c1e', '#d6336c', '#0f7c7c']);
      s += rect(px + 9, py - 3, 2, 4, '#aaa') + rect(px, py, 20, 22, c, 'rx="1.5"') + rect(px + 4, py + 6, 12, 10, '#ffffff', 'opacity="0.35"');
    }
  // the glass counter with phones laid out, screens lit
  s += rect(x, y + 156, 256, 100, '#3c3f45') + rect(x + 4, y + 160, 248, 46, '#15181c');
  for (let i = 0; i < 11; i++) {
    const px = x + 10 + i * 22;
    s += rect(px, y + 168, 15, 30, '#0b0b0d', 'rx="2"') + rect(px + 1.5, y + 170.5, 12, 25, pick(r, ['#5aa0e6', '#48c78e', '#f2a65a', '#b48ef0', '#e6e6e6']), 'rx="1"');
  }
  s += rect(x + 4, y + 160, 248, 46, '#bfe3ee', 'opacity="0.12"') + rect(x, y + 206, 256, 4, '#8f969b');
  return s + light(x, y, id);
}

function books(x, y, r, id) {
  let s = room(x, y, id, [0.25, 0.5, 0.75, 0.995], '#3a2e26');
  const cols = ['#b3261e', '#1d3f8f', '#e6b422', '#2c6e49', '#f1ecdf', '#1c1c1e', '#7a4a8c', '#d35400', '#6f94c4', '#8e1b2b'];
  for (const k of [0.25, 0.5, 0.75, 0.995]) {
    let cx = x + 2;
    const by = y + k * 256;
    while (cx < x + 252) {
      if (r() < 0.1) {
        // a lying stack
        for (let j = 0; j < 5; j++) s += rect(cx, by - 6 - j * 6, 34, 5.4, pick(r, cols));
        cx += 36;
        continue;
      }
      const w = 5 + r() * 6;
      const h = 34 + r() * 18;
      const c = pick(r, cols);
      s += rect(cx, by - h, w - 0.8, h, c) + rect(cx + 1, by - h * 0.8, w - 3, 2, '#f2d16b', 'opacity="0.7"') + rect(cx, by - h, 1, h, '#ffffff', 'opacity="0.15"');
      cx += w;
    }
  }
  return s + light(x, y, id);
}

function brass(x, y, r, id) {
  let s = room(x, y, id, [0.3, 0.6], '#3a2c22');
  s += `<defs><radialGradient id="b${id}" cx="0.35" cy="0.35" r="0.7"><stop offset="0" stop-color="#ffe9a0"/><stop offset="0.5" stop-color="#c9962e"/><stop offset="1" stop-color="#6b4a12"/></radialGradient></defs>`;
  // brass pots, plates and lamps on the shelves
  for (const k of [0.3, 0.6]) {
    for (let i = 0; i < 8; i++) {
      const cx = x + 16 + i * 31;
      const by = y + k * 256;
      const t = Math.floor(r() * 3);
      if (t === 0) s += ell(cx, by - 14, 12, 13, `url(#b${id})`) + rect(cx - 5, by - 32, 10, 6, '#b8862a');
      else if (t === 1) s += circ(cx, by - 18, 14, `url(#b${id})`) + circ(cx, by - 18, 7, '#a8761f', 'opacity="0.6"');
      else s += `<path d="M${cx - 12},${by - 10} Q${cx},${by + 2} ${cx + 12},${by - 10} Z" fill="url(#b${id})"/>` + rect(cx - 2, by - 34, 4, 24, '#b8862a') + ell(cx, by - 36, 8, 3, '#d9a83f');
    }
  }
  // stoles and scarves hanging on the lower wall, patterned
  for (let i = 0; i < 11; i++) {
    const c = pick(r, ['#b3261e', '#e6b422', '#2c3e70', '#7a4a8c', '#3a7d44', '#d6336c', '#0f6e74', '#f08c2e']);
    const sx = x + 4 + i * 23;
    s += rect(sx, y + 164, 20, 92, c);
    for (let j = 0; j < 5; j++) s += rect(sx, y + 174 + j * 17, 20, 3, '#f1ecdf', 'opacity="0.55"');
    s += rect(sx + 18, y + 164, 2, 92, '#000', 'opacity="0.25"');
  }
  s += rect(x, y + 160, 256, 4, '#b9bec2');
  return s + light(x, y, id);
}

const DRAW = { sweets, cloth, ribbons, sacks, utensils, motors, pipes, cartons, hangers, bags, phones, books, brass };

/** The SVG of the three goods cells of a kit at their atlas places (row 768: x 256, 512 and 768). */
export function goodsSvg(kitId) {
  const list = GOODS_BY_KIT[kitId] || GOODS_BY_KIT.market;
  let s = '';
  list.forEach((kind, i) => {
    const x = 256 + i * 256;
    const y = 768;
    const id = `${kitId}${i}`;
    s += `<clipPath id="c${id}"><rect x="${x}" y="${y}" width="256" height="256"/></clipPath>`;
    s += `<g clip-path="url(#c${id})">${DRAW[kind](x, y, rngOf(9001 + i * 77 + kitId.length * 13), id)}</g>`;
  });
  return s;
}
