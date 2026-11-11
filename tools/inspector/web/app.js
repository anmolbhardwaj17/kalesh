// Map inspector page (P1-001, P1-011). Reads the production issues.json of the bake (harness/reports/map/), its
// context.json (a plan of the repaired roads and footprints, the stage outline) and the KTL1 tiles of
// /inspector/data/tiles/ when there are any, draws them with three.js, lists the issues sorted by impact and writes
// the owner's pick through /api/inspector/pick.
// Coordinates: world metres (the one world grid of 250 m tiles), east +X, north -Z, up +Y, no mirroring. The top
// view looks straight down with the camera slightly south of its target, so north is up on screen.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { readKtl1 } from '../ktl1.ts';
import { actionWords, filterIssues, isHigh, sortIssues } from '../lib.ts';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const PROP_COLOURS = ['#1f6fd0', '#e0662b', '#8a3fb8', '#1f9d5a', '#c2185b'];
const MATERIAL_COLOURS = { road: 0x77746d, footpath: 0xc2b9a6, kerb: 0x9a958a, ground: 0xd8d2b8, parking: 0xa6a69b, planter: 0x7fa65f, marking: 0xf3f1e8, hedge: 0x5a8a45, railing: 0x5d5d5d, colonnade: 0xe9dfc4 };
const OFFSET_MATERIALS = new Set(['marking', 'kerb', 'planter', 'hedge', 'railing']);

const state = {
  ready: false, issues: [], byId: new Map(), rules: {}, picks: {}, filter: 'all', selected: null, proposal: null,
  view: 'top', flying: false, places: [], source: '', markerIndex: [],
};

// ------------------------------------------------------------------ three.js scene

const mapEl = $('#map');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
mapEl.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe9e5da);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8576, 1.5));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
sun.position.set(-300, 500, -200);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(45, 1, 1, 60000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false;
controls.zoomToCursor = true;
controls.minDistance = 12;
controls.maxDistance = 14000;
controls.maxPolarAngle = Math.PI * 0.48;
let dirty = true;
controls.addEventListener('change', () => { dirty = true; });
const tileGroup = new THREE.Group();
const markerGroup = new THREE.Group();
const lineGroup = new THREE.Group();
const contextGroup = new THREE.Group();
scene.add(contextGroup, tileGroup, markerGroup, lineGroup);
const lineMaterials = [];

function resize() {
  const w = mapEl.clientWidth || 1;
  const h = mapEl.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  for (const m of lineMaterials) m.resolution.set(w, h);
  dirty = true;
}
new ResizeObserver(resize).observe(mapEl);

// Marker dots: one Points object, size in pixels, round with a white rim, drawn over everything.
const dotMaterial = new THREE.ShaderMaterial({
  transparent: true, depthTest: false, depthWrite: false,
  uniforms: { uPR: { value: renderer.getPixelRatio() } },
  vertexShader: 'attribute float size; attribute vec3 col; attribute float alpha; varying vec3 vC; varying float vA; uniform float uPR; void main(){ vC = col; vA = alpha; gl_PointSize = size * uPR; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'varying vec3 vC; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; vec3 c = d > 0.36 ? vec3(1.0) : vC; gl_FragColor = vec4(c, vA); }',
});

/** Issues the owner picked a fix for (a pick file) or that a bake has settled with a patch (status overridden). */
function pickedIds() {
  const out = new Set(Object.keys(state.picks));
  for (const i of state.issues) if (i.status === 'overridden') out.add(i.id);
  return out;
}

function statusClass(i) {
  if (state.picks[i.id] || i.status === 'overridden') return 'picked';
  if (isHigh(i)) return 'high';
  return i.status === 'auto_repaired' || i.status === 'explained' ? 'auto' : 'open';
}
const DOT = { high: { c: [0.84, 0.2, 0.17], s: 15, a: 1 }, open: { c: [0.94, 0.54, 0.09], s: 11, a: 1 }, auto: { c: [0.23, 0.62, 0.56], s: 7, a: 0.7 }, picked: { c: [0.17, 0.42, 0.83], s: 13, a: 1 } };

let dots = null;
function buildDots() {
  if (dots) { markerGroup.remove(dots); dots.geometry.dispose(); }
  const n = state.issues.length;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const alpha = new Float32Array(n);
  state.markerIndex = state.issues;
  state.issues.forEach((i, k) => {
    const d = DOT[statusClass(i)];
    pos.set([i.x, (i.y ?? 0) + 1, i.z], k * 3);
    col.set(d.c, k * 3);
    size[k] = d.s;
    alpha[k] = d.a;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('col', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  g.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  dots = new THREE.Points(g, dotMaterial);
  dots.frustumCulled = false;
  dots.renderOrder = 10;
  markerGroup.add(dots);
  dirty = true;
}

function addTile(entry, buffer) {
  const t = readKtl1(buffer);
  const group = new THREE.Group();
  group.position.set(entry.origin[0], entry.origin[1], entry.origin[2]);
  for (const m of t.meshes) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.nrm, 3));
    // the tile winds triangles clockwise (the engine's front face), three.js wants counter clockwise: swap two corners
    const idx = new Uint32Array(m.idx.length);
    for (let k = 0; k + 2 < m.idx.length; k += 3) { idx[k] = m.idx[k]; idx[k + 1] = m.idx[k + 2]; idx[k + 2] = m.idx[k + 1]; }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.MeshLambertMaterial({ color: MATERIAL_COLOURS[m.material] ?? 0xbbbbbb, side: THREE.DoubleSide, polygonOffset: OFFSET_MATERIALS.has(m.material), polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    group.add(new THREE.Mesh(g, mat));
  }
  tileGroup.add(group);
}

const ROAD_COLOURS = { motorway: 0x8a867c, trunk: 0x8a867c, primary: 0x948f84, secondary: 0x9d988c, tertiary: 0xaba698, unclassified: 0xb4afa1, residential: 0xb9b4a6, living_street: 0xbdb8aa, service: 0xc3beb0, pedestrian: 0xc9c3b5 };

/** The plan behind the issues: OSM roads as ribbons (width to scale) with a thin line on top, and building outlines. */
function addContext(ctxFile) {
  const rib = [];
  const lines = [];
  for (const r of ctxFile.roads ?? []) {
    const p = r.p;
    const half = Math.max(1.2, r.w / 2);
    const col = new THREE.Color(ROAD_COLOURS[r.k] ?? 0xb4afa1);
    for (let k = 0; k + 5 < p.length; k += 3) {
      const ax = p[k]; const ay = p[k + 1]; const az = p[k + 2]; const bx = p[k + 3]; const by = p[k + 4]; const bz = p[k + 5];
      const dx = bx - ax; const dz = bz - az; const len = Math.hypot(dx, dz) || 1;
      const nx = (-dz / len) * half; const nz = (dx / len) * half;
      rib.push([ax + nx, ay, az + nz, ax - nx, ay, az - nz, bx + nx, by, bz + nz, bx - nx, by, bz - nz, col]);
      lines.push(ax, ay + 0.15, az, bx, by + 0.15, bz);
    }
  }
  const pos = new Float32Array(rib.length * 18);
  const colr = new Float32Array(rib.length * 18);
  rib.forEach((q, n) => {
    const tri = [0, 1, 2, 2, 1, 3];
    tri.forEach((v, t) => { pos.set(q.slice(v * 3, v * 3 + 3), n * 18 + t * 3); colr.set([q[12].r, q[12].g, q[12].b], n * 18 + t * 3); });
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  m.frustumCulled = false;
  contextGroup.add(m);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  contextGroup.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x7a766b })));
  const outline = [];
  for (const b of ctxFile.buildings ?? []) {
    for (let k = 0; k + 5 < b.length; k += 3) outline.push(b[k], b[k + 1] + 0.1, b[k + 2], b[k + 3], b[k + 4] + 0.1, b[k + 5]);
    const n = b.length;
    if (n >= 6) outline.push(b[n - 3], b[n - 2] + 0.1, b[n - 1], b[0], b[1] + 0.1, b[2]);
  }
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(outline, 3));
  contextGroup.add(new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: 0xb2ab98 })));
  // the outline of the baked stage, so the edge of the map is on the page
  const edge = ctxFile.outline ?? [];
  if (edge.length > 1) {
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(edge.flatMap(([x, z]) => [x, 0.4, z]), 3));
    contextGroup.add(new THREE.Line(eg, new THREE.LineBasicMaterial({ color: 0x1f6fd0 })));
  }
  dirty = true;
}

function addGrid(bounds) {
  // the 250 m world tile grid, so the tile files of the overrides can be read off the map
  const S = 250;
  const x0 = Math.floor(bounds.minX / S) * S; const x1 = Math.ceil(bounds.maxX / S) * S;
  const z0 = Math.floor(bounds.minZ / S) * S; const z1 = Math.ceil(bounds.maxZ / S) * S;
  const pts = [];
  for (let x = x0; x <= x1; x += S) pts.push(x, -0.5, z0, x, -0.5, z1);
  for (let z = z0; z <= z1; z += S) pts.push(x0, -0.5, z, x1, -0.5, z);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xc9c3b2 })));
}

// ------------------------------------------------------------------ camera

function setView(view) {
  state.view = view;
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
  const dist = dir.length();
  const phi = view === 'top' ? 0.0005 : 0.95;
  const azimuth = view === 'top' ? 0 : Math.atan2(dir.x, dir.z);
  controls.enableRotate = view !== 'top';
  controls.mouseButtons = { LEFT: view === 'top' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  camera.position.set(controls.target.x + dist * Math.sin(phi) * Math.sin(azimuth), controls.target.y + dist * Math.cos(phi), controls.target.z + dist * Math.sin(phi) * Math.cos(azimuth));
  controls.update();
  $('#viewTop').classList.toggle('on', view === 'top');
  $('#view3d').classList.toggle('on', view === '3d');
  dirty = true;
}

let flight = null;
function flyTo(target, dist, ms = 700) {
  flight = { t0: performance.now(), ms, from: controls.target.clone(), to: new THREE.Vector3(...target), d0: camera.position.distanceTo(controls.target), d1: dist, dir: new THREE.Vector3().subVectors(camera.position, controls.target).normalize() };
  state.flying = true;
}
function stepFlight(now) {
  if (!flight) return;
  const k = Math.min(1, (now - flight.t0) / flight.ms);
  const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  controls.target.lerpVectors(flight.from, flight.to, e);
  const d = flight.d0 + (flight.d1 - flight.d0) * e;
  camera.position.copy(controls.target).addScaledVector(flight.dir, d);
  controls.update();
  dirty = true;
  if (k >= 1) { flight = null; state.flying = false; }
}

function fitAll() {
  const xs = state.issues.map((i) => i.x).concat(state.places.map((p) => p.x));
  const zs = state.issues.map((i) => i.z).concat(state.places.map((p) => p.z));
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dz = ((maxZ - minZ) * 1.12) / (2 * t);
  const dx = ((maxX - minX) * 1.12) / (2 * t * camera.aspect);
  setView('top');
  flyTo([(minX + maxX) / 2, 0, (minZ + maxZ) / 2], Math.max(dz, dx, 200), 500);
}

function labelPlaces() {
  const host = $('#labels');
  host.innerHTML = '';
  for (const p of state.places) {
    const el = document.createElement('div');
    el.className = 'place';
    el.dataset.place = p.id;
    el.textContent = p.name;
    host.appendChild(el);
  }
}

const v3 = new THREE.Vector3();
/** Client pixel position of a world point inside the map element, or null when behind the camera. */
function project(x, y, z) {
  v3.set(x, y, z).project(camera);
  if (v3.z > 1) return null;
  const r = mapEl.getBoundingClientRect();
  return { x: r.left + (v3.x * 0.5 + 0.5) * r.width, y: r.top + (-v3.y * 0.5 + 0.5) * r.height };
}

function placeLabels() {
  const r = mapEl.getBoundingClientRect();
  for (const p of state.places) {
    const el = $(`.place[data-place="${p.id}"]`);
    const s = project(p.x, 0, p.z);
    if (!el) continue;
    if (!s) { el.style.display = 'none'; continue; }
    el.style.display = '';
    el.style.left = `${s.x - r.left}px`;
    el.style.top = `${s.y - r.top}px`;
  }
  const ring = $('#ring');
  const sel = state.selected && state.byId.get(state.selected);
  const sp = sel && project(sel.x, (sel.y ?? 0) + 1, sel.z);
  ring.hidden = !sp;
  if (sp) { ring.style.left = `${sp.x - r.left}px`; ring.style.top = `${sp.y - r.top}px`; }
  // the compass needle follows the camera azimuth: north is up in the top view
  const az = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
  $('#compass span').style.transform = `rotate(${(az * 180) / Math.PI}deg)`;
}

// ------------------------------------------------------------------ proposals on the map

function clearLines() {
  for (const c of [...lineGroup.children]) { lineGroup.remove(c); c.geometry?.dispose(); }
  lineMaterials.length = 0;
}

function drawProposals(issue, selectedIndex) {
  clearLines();
  if (!issue) { dirty = true; return; }
  const y = (issue.y ?? 0) + 1.5;
  issue.proposals.forEach((p, k) => {
    const colour = new THREE.Color(PROP_COLOURS[k % PROP_COLOURS.length]);
    const chosen = selectedIndex === null || selectedIndex === k;
    if (p.preview.length >= 2) {
      const g = new LineGeometry();
      g.setPositions(p.preview.flatMap((q) => [q.x, y, q.z]));
      const m = new LineMaterial({ color: colour, linewidth: chosen ? 5 : 3, transparent: true, opacity: chosen ? 1 : 0.45, depthTest: false });
      m.resolution.set(mapEl.clientWidth, mapEl.clientHeight);
      lineMaterials.push(m);
      const line = new Line2(g, m);
      line.renderOrder = 20 + k;
      line.frustumCulled = false;
      lineGroup.add(line);
    }
    const last = p.preview[p.preview.length - 1] ?? { x: issue.x, z: issue.z };
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([last.x, y, last.z], 3));
    g.setAttribute('col', new THREE.Float32BufferAttribute([colour.r, colour.g, colour.b], 3));
    g.setAttribute('size', new THREE.Float32BufferAttribute([chosen ? 16 : 11], 1));
    g.setAttribute('alpha', new THREE.Float32BufferAttribute([chosen ? 1 : 0.6], 1));
    const pt = new THREE.Points(g, dotMaterial);
    pt.renderOrder = 30 + k;
    pt.frustumCulled = false;
    lineGroup.add(pt);
  });
  dirty = true;
}

// ------------------------------------------------------------------ list and detail

const ruleTitle = (i) => state.rules[i.rule] ?? i.rule;
function whereText(i) {
  const ew = i.x >= 0 ? 'east' : 'west';
  const ns = i.z <= 0 ? 'north' : 'south';
  return `${Math.round(Math.abs(i.x)).toLocaleString('en')} m ${ew} and ${Math.round(Math.abs(i.z)).toLocaleString('en')} m ${ns} of India Gate`;
}
const pct = (v) => `${Math.round(v * 100)}%`;

function renderChips() {
  const all = state.issues;
  const picked = pickedIds();
  const defs = [['all', 'All', all.length], ['needs', 'Needs you', filterIssues(all, 'needs', picked).length], ['auto', 'Fixed by itself', filterIssues(all, 'auto', picked).length], ['picked', 'You picked', picked.size]];
  $('#chips').innerHTML = defs.map(([k, label, n]) => `<button type="button" data-filter="${k}" class="${state.filter === k ? 'on' : ''}">${label} ${n}</button>`).join('');
}

const GROUP_LABEL = { high: 'High impact: look at these first', open: 'Needs you', picked: 'You picked', auto: 'Fixed by itself or left as it is (check them if you like)' };
function groupOf(i, picked) {
  if (picked.has(i.id)) return 'picked';
  if (isHigh(i)) return 'high';
  return i.status === 'auto_repaired' || i.status === 'explained' ? 'auto' : 'open';
}

function renderList() {
  const picked = pickedIds();
  const rows = filterIssues(sortIssues(state.issues), state.filter, picked);
  // the queue order of lib.ts, with what you already picked after what still needs you
  const buckets = { high: [], open: [], picked: [], auto: [] };
  for (const i of rows) buckets[groupOf(i, picked)].push(i);
  let html = '';
  for (const g of ['high', 'open', 'picked', 'auto']) {
    if (!buckets[g].length) continue;
    html += `<div class="divider" data-group="${g}">${GROUP_LABEL[g]} (${buckets[g].length})</div>`;
    for (const i of buckets[g]) {
      html += `<div class="row${state.selected === i.id ? ' sel' : ''}" role="listitem" data-id="${esc(i.id)}"><i class="dot ${statusClass(i)}"></i><div><div class="t">${esc(ruleTitle(i))}</div><div class="s">${esc(i.note || '')}${i.note ? ' · ' : ''}${esc(i.district ?? '')}</div></div><div class="b">${i.impact.toFixed(2)}</div></div>`;
    }
  }
  const top = $('#list').scrollTop;
  $('#list').innerHTML = html || '<div class="divider">Nothing here</div>';
  $('#list').scrollTop = top;
  renderChips();
}

function renderDetail() {
  const i = state.selected && state.byId.get(state.selected);
  $('#empty').hidden = !!i;
  $('#issue').hidden = !i;
  if (!i) return;
  const pick = state.picks[i.id];
  const cls = statusClass(i);
  const badge = pick ? '<span class="badge picked">You picked a fix</span>' : i.status === 'overridden' ? '<span class="badge picked">Your fix is in the map</span>' : isHigh(i) ? '<span class="badge high">High impact</span>' : i.status === 'auto_repaired' ? '<span class="badge auto">Fixed by itself</span>' : i.status === 'explained' ? '<span class="badge auto">Looks like the real road</span>' : '<span class="badge open">Needs you</span>';
  const props = i.proposals.map((p, k) => `<button type="button" class="prop${state.proposal === k ? ' sel' : ''}" data-prop="${k}"><span class="sw" style="background:${PROP_COLOURS[k % PROP_COLOURS.length]}"></span><span><span class="h"><span>${esc(actionWords(p.action))}</span><span class="c">${pct(p.confidence)} sure</span></span><span class="r">${esc(p.reasoning)}</span></span></button>`).join('');
  const hasProps = i.proposals.length > 0;
  $('#issue').innerHTML = `
    <h2>${esc(ruleTitle(i))}</h2>
    <div class="badges">${badge}<span class="badge">Impact ${i.impact.toFixed(2)}</span><span class="badge">${esc(i.district ?? '')}</span></div>
    <p class="where">${esc(whereText(i))}. Tile ${i.tile[0]}_${i.tile[1]}.</p>
    ${i.note ? `<p class="note">${esc(i.note)}</p>` : ''}
    ${pick ? `<div class="msg">Saved: "${esc(actionWords(pick.action))}" in overrides/${esc(pick.file)}. You can pick again to change it.</div>` : ''}
    ${hasProps ? `<h3>What should the map do here? The lines on the map show each fix.</h3>${props}` : '<p class="where">No fix was proposed. Write what you want below.</p>'}
    <h3>Your note (optional)</h3>
    <textarea id="note" placeholder="For example: the radial joins the outer circle here, I checked a street photo."></textarea>
    <div class="actions">
      <button type="button" class="primary" id="save" disabled>Use this fix</button>
      <button type="button" class="secondary" id="openGame">Open in game</button>
    </div>
    <div id="msg" class="msg" hidden></div>
    <div class="ids">${esc(i.id)}<br>${cls}</div>`;
  updateSave();
}

function updateSave() {
  const save = $('#save');
  if (!save) return;
  const note = ($('#note')?.value ?? '').trim();
  save.disabled = state.proposal === null && !note;
  save.textContent = state.proposal !== null ? 'Use this fix' : 'Save my note';
}
function message(text, bad = false) {
  const el = $('#msg');
  if (!el) return;
  el.hidden = !text;
  el.textContent = text;
  el.className = `msg${bad ? ' bad' : ''}`;
}

function select(id, { fly = true } = {}) {
  const i = state.byId.get(id);
  if (!i) return;
  state.selected = id;
  state.proposal = null;
  state.noteDraft = '';
  renderList();
  renderDetail();
  drawProposals(i, null);
  if (fly) {
    const top = state.view === 'top';
    flyTo([i.x, i.y ?? 0, i.z], top ? 140 : 110);
  }
  $(`.row[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
}

async function save() {
  const i = state.byId.get(state.selected);
  if (!i) return;
  const note = ($('#note')?.value ?? '').trim();
  const res = await fetch('/api/inspector/pick', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ issue: i.id, proposal: state.proposal, note }) });
  const body = await res.json();
  if (!res.ok) { message(body.error || 'Could not save.', true); return; }
  if (body.patch) {
    state.picks[i.id] = { patch: body.patch.id, action: body.patch.action, why: body.patch.why, file: body.file };
    buildDots();
    renderList();
    renderDetail();
    message(`Saved. Patch ${body.patch.id} is in overrides/${body.file}. Claude sees it in the inbox.`);
  } else {
    message('Note saved. Claude sees it in the inbox.');
  }
}

async function openInGame() {
  const i = state.byId.get(state.selected);
  if (!i) return;
  message('Asking the game...');
  try {
    const res = await fetch('/api/inspector/open-in-game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: i.x, z: i.z }) });
    const body = await res.json();
    message(body.message ?? 'Done.', !body.ok);
  } catch {
    message('Could not reach the inspector server.', true);
  }
}

// ------------------------------------------------------------------ events

$('#chips').addEventListener('click', (e) => { const b = e.target.closest('[data-filter]'); if (b) { state.filter = b.dataset.filter; renderList(); } });
$('#list').addEventListener('click', (e) => { const r = e.target.closest('.row'); if (r) select(r.dataset.id); });
$('#issue').addEventListener('click', (e) => {
  const p = e.target.closest('[data-prop]');
  if (p) { state.proposal = Number(p.dataset.prop); const i = state.byId.get(state.selected); drawProposals(i, state.proposal); renderDetail(); const n = $('#note'); if (n && state.noteDraft) n.value = state.noteDraft; updateSave(); return; }
  if (e.target.closest('#save')) save();
  if (e.target.closest('#openGame')) openInGame();
});
$('#issue').addEventListener('input', (e) => { if (e.target.id === 'note') { state.noteDraft = e.target.value; updateSave(); } });
$('#viewTop').addEventListener('click', () => setView('top'));
$('#view3d').addEventListener('click', () => setView('3d'));
$('#fit').addEventListener('click', fitAll);

// A click on the map picks the nearest dot within 14 px; a drag pans.
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
  const hit = nearestIssue(e.clientX, e.clientY, 14);
  if (hit) select(hit.id);
});
function nearestIssue(cx, cy, radius) {
  let best = null;
  let bestScore = Infinity;
  const picked = pickedIds();
  for (const i of state.issues) {
    const s = project(i.x, (i.y ?? 0) + 1, i.z);
    if (!s) continue;
    const d = Math.hypot(s.x - cx, s.y - cy);
    if (d > radius) continue;
    const score = d - (isHigh(i) && !picked.has(i.id) ? 6 : i.status === 'auto_repaired' ? -4 : 0);
    if (score < bestScore) { best = i; bestScore = score; }
  }
  return best;
}

function frame(now) {
  stepFlight(now);
  const dist = camera.position.distanceTo(controls.target);
  const near = Math.max(1, dist * 0.01);
  const far = dist * 40 + 2000;
  if (Math.abs(near - camera.near) > 0.01 * near || Math.abs(far - camera.far) > 0.01 * far) { camera.near = near; camera.far = far; camera.updateProjectionMatrix(); dirty = true; }
  if (dirty) {
    dotMaterial.uniforms.uPR.value = renderer.getPixelRatio();
    renderer.render(scene, camera);
    dirty = false;
  }
  placeLabels();
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ load

function banner(text) {
  const el = $('#status');
  el.hidden = !text;
  el.textContent = text || '';
}

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return r.json();
}

async function ensureData() {
  const s = await getJson('/api/inspector/status');
  if (!s.ready) throw new Error('There is no map report yet. Run "npm run bake -- pilot --stage repair --offline" once, then reload this page.');
}

async function init() {
  await ensureData();
  const [file, index, picks, context] = await Promise.all([getJson('/inspector/data/issues.json'), getJson('/inspector/data/tiles/index.json').catch(() => ({ tiles: [], places: [] })), getJson('/api/inspector/picks'), getJson('/inspector/data/context.json').catch(() => null)]);
  state.issues = file.issues;
  state.byId = new Map(file.issues.map((i) => [i.id, i]));
  state.rules = file.rules;
  state.picks = picks;
  state.places = index.places ?? [];
  state.source = file.source;
  $('#source').textContent = file.source;
  labelPlaces();
  const xs = state.issues.map((i) => i.x);
  const zs = state.issues.map((i) => i.z);
  addGrid({ minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) });
  if (context) addContext(context);
  buildDots();
  renderList();
  resize();
  camera.position.set(0, 8000, 1);
  controls.target.set(0, 0, 0);
  setView('top');
  fitAll();
  requestAnimationFrame(frame);
  // tiles load after the first picture, so the issues are on screen at once
  const failed = [];
  await Promise.all((index.tiles ?? []).map(async (t) => {
    try {
      const r = await fetch(`/inspector/data/tiles/${t.file}`);
      if (!r.ok) throw new Error(`answered ${r.status}`);
      addTile(t, await r.arrayBuffer());
    } catch (e) { failed.push(`${t.file}: ${e.message}`); }
  }));
  if (failed.length) banner(`Some tiles could not be read and are left out: ${failed.join('; ')}`);
  dirty = true;
  state.ready = true;
}

// A hook for the tests and for Claude: read the page the way a person sees it.
window.__inspector = {
  state: () => ({
    ready: state.ready, view: state.view, flying: state.flying, selected: state.selected, proposal: state.proposal,
    issueCount: state.issues.length, listCount: document.querySelectorAll('#list .row').length,
    camera: { target: controls.target.toArray(), distance: camera.position.distanceTo(controls.target), position: camera.position.toArray() },
    picks: Object.keys(state.picks),
  }),
  listIds: () => [...document.querySelectorAll('#list .row')].map((r) => r.dataset.id),
  highIds: () => state.issues.filter((i) => isHigh(i) && !state.picks[i.id]).map((i) => i.id),
  places: () => Object.fromEntries(state.places.map((p) => [p.id, project(p.x, 0, p.z)])),
  issueScreen: (id) => { const i = state.byId.get(id); return i ? project(i.x, (i.y ?? 0) + 1, i.z) : null; },
  select: (id, opts) => select(id, opts),
  issue: (id) => state.byId.get(id) ?? null,
};

init().catch((e) => { banner(`The inspector could not start: ${e.message}`); state.error = e.message; });
