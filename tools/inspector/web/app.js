// Map inspector page (P1-001, P1-011, restyled in P1-039). Reads the production issues.json of the bake
// (harness/reports/map/), its context.json (the repaired roads with names, building footprints, the stage outline),
// the lane model's lanes.json when the server has it, and the KTL1 tiles of /inspector/data/tiles/ when there are any.
// Draws them with three.js on a dark map, lists the issues sorted by impact with plain words for each (describe.ts)
// and writes the owner's pick through /api/inspector/pick.
// Coordinates: world metres (the one world grid of 250 m tiles), east +X, north -Z, up +Y, no mirroring. The top
// view looks straight down with the camera slightly south of its target, so north is up on screen.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { readKtl1 } from '../ktl1.ts';
import { actionWords, filterIssues, isHigh, niceScale, searchIssues, sortIssues, worldTile } from '../lib.ts';
import { buildNameIndex, describeIssue, distToLine, fixWords, humanise } from '../describe.ts';
import { contextLayer, groundLayer, lanesLayer } from './layers.js';
import { Minimap } from './minimap.js';
import { MAJOR, MAP, MATERIAL_COLOURS, OFFSET_MATERIALS, PROP_COLOURS, SEV } from './theme.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const state = {
  ready: false, issues: [], byId: new Map(), rules: {}, picks: {}, filter: 'all', search: '', selected: null, proposal: null,
  view: 'top', flying: false, places: [], source: '', markerIndex: [], hidden: new Set(), names: buildNameIndex(null, []),
  desc: new Map(), buildings: [], outline: [], hover: null, layers: { lanes: true, buildings: true, grid: true },
};

// ------------------------------------------------------------------ three.js scene

const mapEl = $('#map');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
mapEl.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(MAP.outside);
scene.add(new THREE.HemisphereLight(0xfff3e0, 0x3a332a, 1.4));
const sun = new THREE.DirectionalLight(0xffe2b8, 1.5);
sun.position.set(-300, 500, -200);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(45, 1, 1, 60000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.14;
controls.zoomToCursor = true;
controls.zoomSpeed = 1.15;
controls.minDistance = 12;
controls.maxDistance = 14000;
controls.maxPolarAngle = Math.PI * 0.48;
let dirty = true;
controls.addEventListener('change', () => { dirty = true; });
const flatGroup = new THREE.Group();
const tileGroup = new THREE.Group();
const markerGroup = new THREE.Group();
const highlightGroup = new THREE.Group();
const lineGroup = new THREE.Group();
scene.add(flatGroup, tileGroup, highlightGroup, markerGroup, lineGroup);
const lineMaterials = new Set();
const layers = { ground: null, context: null, lanes: null };

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

// Issue markers: one Points object, size in pixels, drawn over everything. kind 0 high (red core, dark ring, glow),
// 1 needs you (marigold disc), 2 fixed by itself (small mint ring), 3 you picked (blue disc, light centre), 4 fix end.
const dotMaterial = new THREE.ShaderMaterial({
  transparent: true, depthTest: false, depthWrite: false,
  uniforms: { uPR: { value: renderer.getPixelRatio() } },
  vertexShader: `attribute float size; attribute vec3 col; attribute float alpha; attribute float kind;
    varying vec3 vC; varying float vA; varying float vK; uniform float uPR;
    void main() { vC = col; vA = alpha; vK = kind; gl_PointSize = size * uPR; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `varying vec3 vC; varying float vA; varying float vK;
    float disc(float r, float d, float aa) { return 1.0 - smoothstep(r - aa, r + aa, d); }
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      if (d > 1.0) discard;
      float aa = max(fwidth(d), 0.02);
      vec3 dark = vec3(0.067, 0.051, 0.039);
      vec3 rgb; float a;
      if (vK < 0.5) {
        float core = disc(0.48, d, aa); float ring = disc(0.64, d, aa);
        float halo = 0.45 * (1.0 - smoothstep(0.64, 1.0, d));
        rgb = mix(vC, mix(dark, vC, core), ring); a = max(ring, halo);
      } else if (vK > 1.5 && vK < 2.5) {
        float band = smoothstep(0.42 - aa, 0.42 + aa, d) * disc(0.78, d, aa);
        float rim = disc(0.98, d, aa);
        rgb = mix(dark, vC, band); a = max(band, rim * 0.55);
      } else {
        float core = disc(0.66, d, aa); float ring = disc(0.94, d, aa);
        rgb = mix(dark, vC, core);
        if (vK > 2.5 && vK < 3.5) rgb = mix(vec3(0.96, 0.94, 0.89), rgb, smoothstep(0.24, 0.3, d));
        a = ring;
      }
      gl_FragColor = vec4(rgb, a * vA);
    }`,
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
const rgb = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
const DOT = { high: { c: rgb(SEV.high), s: 22, a: 1, k: 0, z: 3 }, open: { c: rgb(SEV.open), s: 13, a: 1, k: 1, z: 1 }, auto: { c: rgb(SEV.auto), s: 10, a: 0.8, k: 2, z: 0 }, picked: { c: rgb(SEV.picked), s: 15, a: 1, k: 3, z: 2 } };

let dots = null;
function buildDots() {
  if (dots) { markerGroup.remove(dots); dots.geometry.dispose(); }
  // the least urgent first, so the high impact ones draw on top
  const order = [...state.issues].sort((a, b) => DOT[statusClass(a)].z - DOT[statusClass(b)].z);
  const n = order.length;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const alpha = new Float32Array(n);
  const kind = new Float32Array(n);
  state.markerIndex = order;
  order.forEach((i, k) => {
    const cls = statusClass(i);
    const d = DOT[cls];
    pos.set([i.x, (i.y ?? 0) + 1, i.z], k * 3);
    col.set(d.c, k * 3);
    size[k] = d.s;
    alpha[k] = state.hidden.has(cls) ? 0 : d.a;
    kind[k] = d.k;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('col', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  g.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
  g.setAttribute('kind', new THREE.BufferAttribute(kind, 1));
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
    const mat = new THREE.MeshLambertMaterial({ color: MATERIAL_COLOURS[m.material] ?? 0x8a8277, side: THREE.DoubleSide, polygonOffset: OFFSET_MATERIALS.has(m.material), polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    group.add(new THREE.Mesh(g, mat));
  }
  tileGroup.add(group);
}

function applyLayers() {
  if (layers.lanes) layers.lanes.group.visible = state.layers.lanes;
  if (layers.context) layers.context.buildings.visible = state.layers.buildings;
  if (layers.ground) layers.ground.grid.visible = state.layers.grid;
  for (const b of document.querySelectorAll('#layerRows [data-layer]')) b.classList.toggle('on', !!state.layers[b.dataset.layer]);
  dirty = true;
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
function flyTo(target, dist, ms) {
  const from = controls.target.clone();
  const to = new THREE.Vector3(...target);
  const d0 = camera.position.distanceTo(controls.target);
  // longer flights take a little longer, so a jump across the map still reads as a move
  const span = from.distanceTo(to) + Math.abs(dist - d0);
  flight = { t0: performance.now(), ms: ms ?? Math.min(1100, 450 + span * 0.12), from, to, d0, d1: dist, dir: new THREE.Vector3().subVectors(camera.position, controls.target).normalize() };
  state.flying = true;
}
function stepFlight(now) {
  if (!flight) return;
  const k = Math.min(1, (now - flight.t0) / flight.ms);
  const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  controls.target.lerpVectors(flight.from, flight.to, e);
  // zoom on a log scale, so a long zoom in does not rush at the end
  const d = Math.exp(Math.log(flight.d0) + (Math.log(flight.d1) - Math.log(flight.d0)) * e);
  camera.position.copy(controls.target).addScaledVector(flight.dir, d);
  controls.update();
  dirty = true;
  if (k >= 1) { flight = null; state.flying = false; }
}

function fitAll() {
  const xs = state.outline.length ? state.outline.map((p) => p[0]) : state.issues.map((i) => i.x).concat(state.places.map((p) => p.x));
  const zs = state.outline.length ? state.outline.map((p) => p[1]) : state.issues.map((i) => i.z).concat(state.places.map((p) => p.z));
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dz = ((maxZ - minZ) * 1.1) / (2 * t);
  const dx = ((maxX - minX) * 1.1) / (2 * t * camera.aspect);
  setView('top');
  flyTo([(minX + maxX) / 2, 0, (minZ + maxZ) / 2], Math.max(dz, dx, 200), 600);
}

function zoomBy(f) {
  const d = camera.position.distanceTo(controls.target);
  flyTo(controls.target.toArray(), Math.min(controls.maxDistance, Math.max(controls.minDistance, d * f)), 260);
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

const ray = new THREE.Raycaster();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
/** The ground point (y 0) under normalised device coordinates, or null above the horizon. */
function groundAt(nx, ny) {
  ray.setFromCamera(new THREE.Vector2(nx, ny), camera);
  const out = new THREE.Vector3();
  return ray.ray.intersectPlane(ground, out) ? out : null;
}

function placeLabels() {
  const r = mapEl.getBoundingClientRect();
  const sel = state.selected && state.byId.get(state.selected);
  const sp = sel && project(sel.x, (sel.y ?? 0) + 1, sel.z);
  for (const p of state.places) {
    const el = $(`.place[data-place="${p.id}"]`);
    const s = project(p.x, 0, p.z);
    if (!el) continue;
    if (!s) { el.style.display = 'none'; continue; }
    el.style.display = '';
    el.style.left = `${s.x - r.left}px`;
    el.style.top = `${s.y - r.top}px`;
    // a place label right under the selection label steps back
    el.style.opacity = sp && Math.abs(s.x - sp.x) < 150 && sp.y - s.y > -16 && sp.y - s.y < 90 ? '0.25' : '';
  }
  const ring = $('#ring');
  const label = $('#selLabel');
  ring.hidden = !sp;
  label.hidden = !sp;
  if (sp) {
    ring.style.left = `${sp.x - r.left}px`; ring.style.top = `${sp.y - r.top}px`;
    const lx = Math.min(r.width - 120, Math.max(120, sp.x - r.left));
    label.style.left = `${lx}px`; label.style.top = `${sp.y - r.top}px`;
  }
  const hr = $('#hoverRing');
  const hi = state.hover && state.hover !== state.selected && state.byId.get(state.hover);
  const hp = hi && project(hi.x, (hi.y ?? 0) + 1, hi.z);
  hr.hidden = !hp;
  if (hp) { hr.style.left = `${hp.x - r.left}px`; hr.style.top = `${hp.y - r.top}px`; }
  // the compass needle follows the camera azimuth: north is up in the top view
  const az = Math.atan2(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
  $('#compass span').style.transform = `rotate(${(az * 180) / Math.PI}deg)`;
}

let lastView = '';
function updateReadouts() {
  const dist = camera.position.distanceTo(controls.target);
  const key = `${camera.position.toArray().map((v) => v.toFixed(1))}|${mapEl.clientWidth}x${mapEl.clientHeight}`;
  if (key === lastView) return;
  lastView = key;
  const mpp = (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / (mapEl.clientHeight || 1);
  const sc = niceScale(mpp, 90);
  $('#scaleBar').style.width = `${Math.round(sc.px)}px`;
  $('#scaleText').textContent = sc.label;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => groundAt(x, y)).filter(Boolean).map((p) => [p.x, p.z]);
  minimap.setView(corners.length >= 3 ? corners : null, [controls.target.x, controls.target.z]);
  layers.context?.update(dist);
  layers.lanes?.update(dist);
}

// ------------------------------------------------------------------ the selected issue on the map

function trackLine(m) { lineMaterials.add(m); m.resolution.set(mapEl.clientWidth, mapEl.clientHeight); return m; }
function clearGroup(group) {
  for (const c of [...group.children]) { group.remove(c); c.geometry?.dispose(); if (c.material) { lineMaterials.delete(c.material); c.material.dispose?.(); } }
}
function polyline(pts, y, opts, order) {
  const g = new LineGeometry();
  g.setPositions(pts.flatMap(([x, z]) => [x, y, z]));
  const line = new Line2(g, trackLine(new LineMaterial({ transparent: true, depthTest: false, ...opts })));
  line.renderOrder = order;
  line.frustumCulled = false;
  return line;
}

/** The map things an issue is about: its roads (from the edge ids) and, for a building rule, the footprint under it. */
function featureShapes(issue) {
  const lines = [];
  for (const f of issue.features) { const r = state.names.roads.get(f); if (r && r.pts.length > 1) lines.push(r.pts); }
  if (issue.rule.startsWith('R-BLDG')) {
    let best = null; let bd = 25;
    for (const b of state.buildings) {
      if (issue.x < b.minX - bd || issue.x > b.maxX + bd || issue.z < b.minZ - bd || issue.z > b.maxZ + bd) continue;
      const d = distToLine(issue.x, issue.z, b.ring);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) lines.push([...best.ring, best.ring[0]]);
  }
  return lines;
}

function drawHighlight(issue) {
  clearGroup(highlightGroup);
  if (!issue) return;
  const y = (issue.y ?? 0) + 1.2;
  for (const pts of featureShapes(issue)) {
    highlightGroup.add(polyline(pts, y, { color: new THREE.Color(SEV.open), linewidth: 13, opacity: 0.22 }, 15));
    highlightGroup.add(polyline(pts, y, { color: new THREE.Color(0x110d0a), linewidth: 6, opacity: 0.9 }, 16));
    highlightGroup.add(polyline(pts, y, { color: new THREE.Color(0xffd27a), linewidth: 3, opacity: 1 }, 17));
  }
  dirty = true;
}

/** Camera distance that frames the issue's roads and fixes near it (the target stays on the issue). */
function frameDistance(issue) {
  let r = 30;
  const pts = featureShapes(issue).flat().concat(issue.proposals.flatMap((p) => p.preview.map((q) => [q.x, q.z])));
  for (const [x, z] of pts) { const d = Math.hypot(x - issue.x, z - issue.z); if (d < 320) r = Math.max(r, d); }
  const aspect = Math.min(1, camera.aspect || 1);
  return Math.min(900, Math.max(140, (r * 1.35) / (Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect)));
}

function drawProposals(issue, selectedIndex) {
  clearGroup(lineGroup);
  if (!issue) { dirty = true; return; }
  const y = (issue.y ?? 0) + 1.5;
  issue.proposals.forEach((p, k) => {
    const colour = new THREE.Color(PROP_COLOURS[k % PROP_COLOURS.length]);
    const chosen = selectedIndex === null || selectedIndex === k;
    const pts = p.preview.map((q) => [q.x, q.z]);
    if (pts.length >= 2) {
      lineGroup.add(polyline(pts, y, { color: new THREE.Color(0x0c0a08), linewidth: chosen ? 8 : 5, opacity: chosen ? 0.85 : 0.4 }, 20 + k * 2));
      lineGroup.add(polyline(pts, y, { color: colour, linewidth: chosen ? 4.5 : 2.5, opacity: chosen ? 1 : 0.45 }, 21 + k * 2));
    }
    const last = p.preview[p.preview.length - 1] ?? { x: issue.x, z: issue.z };
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([last.x, y, last.z], 3));
    g.setAttribute('col', new THREE.Float32BufferAttribute([colour.r, colour.g, colour.b], 3));
    g.setAttribute('size', new THREE.Float32BufferAttribute([chosen ? 16 : 11], 1));
    g.setAttribute('alpha', new THREE.Float32BufferAttribute([chosen ? 1 : 0.6], 1));
    g.setAttribute('kind', new THREE.Float32BufferAttribute([4], 1));
    const pt = new THREE.Points(g, dotMaterial);
    pt.renderOrder = 40 + k;
    pt.frustumCulled = false;
    lineGroup.add(pt);
  });
  dirty = true;
}

// ------------------------------------------------------------------ list and detail

const ruleTitle = (i) => state.rules[i.rule] ?? i.rule;
function describe(i) {
  let d = state.desc.get(i.id);
  if (!d) { d = describeIssue(i, state.names, ruleTitle(i)); state.desc.set(i.id, d); }
  return d;
}
const pct = (v) => `${Math.round(v * 100)}%`;
const STATUS_WORDS = { high: 'High impact', open: 'Needs you', auto: 'Fixed by itself', picked: 'You picked a fix' };

function renderChips() {
  const all = state.issues;
  const picked = pickedIds();
  const defs = [['all', 'All', all.length], ['needs', 'Needs you', filterIssues(all, 'needs', picked).length], ['auto', 'Fixed by itself', filterIssues(all, 'auto', picked).length], ['picked', 'You picked', picked.size]];
  $('#chips').innerHTML = defs.map(([k, label, n]) => `<button type="button" data-filter="${k}" class="${state.filter === k ? 'on' : ''}" title="${label}"><span class="l">${label}</span> <span class="n">${n.toLocaleString('en')}</span></button>`).join('');
}

function renderLegend() {
  const counts = { high: 0, open: 0, auto: 0, picked: 0 };
  for (const i of state.issues) counts[statusClass(i)]++;
  const words = { high: 'High impact', open: 'Needs you', auto: 'Fixed by itself', picked: 'You picked' };
  $('#sevRows').innerHTML = ['high', 'open', 'auto', 'picked'].map((k) => `<button type="button" data-sev="${k}" class="${state.hidden.has(k) ? 'off' : ''}" title="Show or hide these on the map"><i class="dot ${k}"></i>${words[k]}<span class="c">${counts[k].toLocaleString('en')}</span></button>`).join('');
}

const GROUP_LABEL = { high: 'High impact, look at these first', open: 'Needs you', picked: 'You picked', auto: 'Fixed by itself or left as it is' };
function groupOf(i, picked) {
  if (picked.has(i.id)) return 'picked';
  if (isHigh(i)) return 'high';
  return i.status === 'auto_repaired' || i.status === 'explained' ? 'auto' : 'open';
}

function rowHtml(i) {
  const d = describe(i);
  const cls = statusClass(i);
  const best = i.proposals.reduce((b, p) => (!b || p.confidence > b.confidence ? p : b), null);
  return `<div class="row ${cls}${state.selected === i.id ? ' sel' : ''}" role="listitem" data-id="${esc(i.id)}">`
    + `<div class="t">${esc(d.title)}</div>`
    + `<div class="b"><span class="imp">${i.impact.toFixed(2)}</span><span class="meter"><i style="width:${Math.round(i.impact * 100)}%"></i></span></div>`
    + `<div class="s">${esc(d.problem)}${best ? ` <span style="color:var(--accent)">Fix: ${esc(fixWords(best.action))}.</span>` : ''}</div>`
    // the measured detail tells apart cards on one spot with one rule (four lane changes along one street)
    + `<div class="m"><span class="rule" title="${esc(ruleTitle(i))}">${esc(i.rule)} · ${esc(d.detail || ruleTitle(i))}</span></div></div>`;
}

function visibleRows() {
  const picked = pickedIds();
  const rows = searchIssues(filterIssues(sortIssues(state.issues), state.filter, picked), state.search, (i) => `${ruleTitle(i)} ${describe(i).title} ${describe(i).problem}`);
  return { rows, picked };
}

function renderList() {
  const { rows, picked } = visibleRows();
  // the queue order of lib.ts, with what you already picked after what still needs you
  const buckets = { high: [], open: [], picked: [], auto: [] };
  for (const i of rows) buckets[groupOf(i, picked)].push(i);
  let html = '';
  for (const g of ['high', 'open', 'picked', 'auto']) {
    if (!buckets[g].length) continue;
    html += `<div class="divider" data-group="${g}">${GROUP_LABEL[g]} (${buckets[g].length.toLocaleString('en')})</div>`;
    for (const i of buckets[g]) html += rowHtml(i);
  }
  const top = $('#list').scrollTop;
  $('#list').innerHTML = html || `<div class="none">${state.search ? 'No issue matches that search.' : 'Nothing here.'}</div>`;
  $('#list').scrollTop = top;
  renderChips();
  renderLegend();
}

function markSelectedRow() {
  for (const r of document.querySelectorAll('#list .row.sel')) r.classList.remove('sel');
  if (state.selected) $(`.row[data-id="${CSS.escape(state.selected)}"]`)?.classList.add('sel');
}

function renderDetail() {
  const i = state.selected && state.byId.get(state.selected);
  $('#empty').hidden = !!i;
  $('#issue').hidden = !i;
  if (!i) return;
  const d = describe(i);
  const pick = state.picks[i.id];
  const cls = statusClass(i);
  const kicker = pick ? 'You picked a fix' : i.status === 'overridden' ? 'Your fix is in the map' : isHigh(i) ? 'High impact, needs you' : i.status === 'auto_repaired' ? 'Fixed by itself' : i.status === 'explained' ? 'Looks like the real road' : 'Needs you';
  let bestK = -1;
  i.proposals.forEach((p, k) => { if (bestK < 0 || p.confidence > i.proposals[bestK].confidence) bestK = k; });
  const props = i.proposals.map((p, k) => `<button type="button" class="prop${state.proposal === k ? ' sel' : ''}" data-prop="${k}"><span class="sw" style="background:${PROP_COLOURS[k % PROP_COLOURS.length]}"></span><span><span class="h"><span>${esc(actionWords(p.action))}${k === bestK && i.proposals.length > 1 ? '<span class="best">Most likely</span>' : ''}</span><span class="c">${pct(p.confidence)} sure</span></span><span class="r">${esc(humanise(p.reasoning, state.names))}</span><span class="meter" style="--sev:${PROP_COLOURS[k % PROP_COLOURS.length]}"><i style="width:${pct(p.confidence)}"></i></span></span></button>`).join('');
  const hasProps = i.proposals.length > 0;
  $('#issue').innerHTML = `
    <div class="kicker" style="--sev:var(--${cls})"><i class="dot ${cls}"></i>${esc(kicker)}</div>
    <h2>${esc(d.what)}</h2>
    ${d.where ? `<p class="where">${esc(d.where)}</p>` : ''}
    <p class="rule-id">${esc(i.rule)} · ${esc(ruleTitle(i))}</p>
    <div class="stats">
      <div class="stat" style="--sev:var(--${cls})"><span class="l">Impact</span><span class="v">${i.impact.toFixed(2)}</span><span class="meter"><i style="width:${pct(i.impact)}"></i></span></div>
      <div class="stat"><span class="l">Area</span><span class="v">${esc(i.district ?? 'no area')}</span></div>
      <div class="stat"><span class="l">Tile</span><span class="v">${i.tile[0]}_${i.tile[1]}</span></div>
    </div>
    <div class="block"><h4>What is wrong</h4><p>${esc(d.problem)}</p>${d.detail ? `<p class="measured">Measured: ${esc(d.detail)}</p>` : ''}</div>
    ${d.fix ? `<div class="block fix"><h4>Suggested fix</h4><p>${esc(d.fix)}</p></div>` : ''}
    ${pick ? `<div class="msg msg-saved">Saved: "${esc(actionWords(pick.action))}" in overrides/${esc(pick.file)}. You can pick again to change it.</div>` : ''}
    ${hasProps ? `<h3>Pick a fix. Each one is drawn on the map in its colour.</h3>${props}` : '<p class="where">No fix was proposed. Write what you want below.</p>'}
    <h3>Your note (optional)</h3>
    <textarea id="note" placeholder="For example: the radial joins the outer circle here, I checked a street photo."></textarea>
    <div class="actions">
      <button type="button" class="primary" id="save" disabled>Use this fix</button>
      <button type="button" class="secondary" id="openGame">Open in game</button>
    </div>
    <div id="msg" class="msg" hidden></div>
    <div class="ids">${esc(i.id)}<br>${cls} · x ${Math.round(i.x)}, z ${Math.round(i.z)}</div>`;
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
  markSelectedRow();
  renderDetail();
  drawHighlight(i);
  drawProposals(i, null);
  const d = describe(i);
  $('#selLabel').innerHTML = `${esc(d.what)}${d.where ? `<small>${esc(d.where)}</small>` : ''}`;
  if (fly) flyTo([i.x, i.y ?? 0, i.z], state.view === 'top' ? frameDistance(i) : frameDistance(i) * 0.8);
  $(`.row[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
}

function clearSelection() {
  state.selected = null;
  state.proposal = null;
  markSelectedRow();
  renderDetail();
  drawHighlight(null);
  drawProposals(null, null);
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
let searchTimer = 0;
$('#search').addEventListener('input', (e) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.search = e.target.value; renderList(); }, 120); });
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
$('#zoomIn').addEventListener('click', () => zoomBy(0.6));
$('#zoomOut').addEventListener('click', () => zoomBy(1 / 0.6));
$('#sevRows').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sev]');
  if (!b) return;
  const k = b.dataset.sev;
  if (state.hidden.has(k)) state.hidden.delete(k); else state.hidden.add(k);
  buildDots();
  renderLegend();
});
$('#layerRows').addEventListener('click', (e) => { const b = e.target.closest('[data-layer]'); if (b) { state.layers[b.dataset.layer] = !state.layers[b.dataset.layer]; applyLayers(); } });

document.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'escape') clearSelection();
  else if (k === 'f') fitAll();
  else if (k === 't') setView('top');
  else if (k === '3') setView('3d');
  else if (k === '+' || k === '=') zoomBy(0.6);
  else if (k === '-') zoomBy(1 / 0.6);
  else if (k === 'j' || k === 'k') {
    const ids = [...document.querySelectorAll('#list .row')].map((r) => r.dataset.id);
    if (!ids.length) return;
    const at = ids.indexOf(state.selected);
    const next = at < 0 ? 0 : Math.min(ids.length - 1, Math.max(0, at + (k === 'j' ? 1 : -1)));
    select(ids[next]);
  } else return;
  e.preventDefault();
});

// A click on the map picks the nearest dot within 14 px; a drag pans.
let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; flight = null; state.flying = false; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) { down = null; return; }
  down = null;
  const hit = nearestIssue(e.clientX, e.clientY, 14);
  if (hit) select(hit.id);
});
let hoverAt = null;
renderer.domElement.addEventListener('pointermove', (e) => { hoverAt = { x: e.clientX, y: e.clientY, buttons: e.buttons }; });
renderer.domElement.addEventListener('pointerleave', () => { hoverAt = null; state.hover = null; $('#tip').hidden = true; mapEl.classList.remove('pointing'); $('#coords').textContent = 'Move over the map'; });

function updateHover() {
  if (!hoverAt) return;
  const { x, y, buttons } = hoverAt;
  hoverAt = null;
  const r = mapEl.getBoundingClientRect();
  const g = groundAt(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  if (g) { const t = worldTile(g.x, g.z); $('#coords').textContent = `x ${Math.round(g.x)}  z ${Math.round(g.z)}  tile ${t[0]}_${t[1]}`; }
  const near = buttons ? null : nearestIssue(x, y, 12);
  // the selected issue has its own label: no tooltip on top of it
  const hit = near && near.id !== state.selected ? near : null;
  state.hover = hit?.id ?? null;
  mapEl.classList.toggle('pointing', !!near);
  const tip = $('#tip');
  tip.hidden = !hit;
  if (!hit) return;
  const d = describe(hit);
  tip.style.setProperty('--sev', `var(--${statusClass(hit)})`);
  tip.innerHTML = `<b>${esc(d.what)}</b><span>${esc(d.problem)}</span><br><em>${STATUS_WORDS[statusClass(hit)]} · ${hit.impact.toFixed(2)}</em>`;
  const left = x - r.left + 16;
  tip.style.left = `${Math.min(left, r.width - 310)}px`;
  tip.style.top = `${Math.max(8, y - r.top + 14)}px`;
}

function nearestIssue(cx, cy, radius) {
  let best = null;
  let bestScore = Infinity;
  const picked = pickedIds();
  for (const i of state.issues) {
    if (state.hidden.size && state.hidden.has(statusClass(i))) continue;
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
  if (!flight && controls.update()) dirty = true;
  const dist = camera.position.distanceTo(controls.target);
  const near = Math.max(1, dist * 0.01);
  const far = dist * 40 + 2000;
  if (Math.abs(near - camera.near) > 0.01 * near || Math.abs(far - camera.far) > 0.01 * far) { camera.near = near; camera.far = far; camera.updateProjectionMatrix(); dirty = true; }
  updateHover();
  if (dirty) {
    updateReadouts();
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

const minimap = new Minimap($('#minimap'), (x, z) => flyTo([x, 0, z], camera.position.distanceTo(controls.target)));

async function init() {
  const status = await getJson('/api/inspector/status');
  if (!status.ready) throw new Error('There is no map report yet. Run "npm run bake -- pilot --stage repair --offline" once, then reload this page.');
  const [file, index, picks, context] = await Promise.all([getJson('/inspector/data/issues.json'), getJson('/inspector/data/tiles/index.json').catch(() => ({ tiles: [], places: [] })), getJson('/api/inspector/picks'), getJson('/inspector/data/context.json').catch(() => null)]);
  state.issues = file.issues;
  state.byId = new Map(file.issues.map((i) => [i.id, i]));
  state.rules = file.rules;
  state.picks = picks;
  state.places = index.places ?? [];
  state.source = file.source;
  state.outline = context?.outline ?? [];
  state.names = buildNameIndex(context, state.places);
  state.buildings = (context?.buildings ?? []).map((b) => {
    const ring = [];
    for (let k = 0; k + 2 < b.length; k += 3) ring.push([b[k], b[k + 2]]);
    const xs = ring.map((p) => p[0]); const zs = ring.map((p) => p[1]);
    return { ring, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
  });
  $('#source').textContent = file.source;
  $('#source').title = file.source;
  $('#sub').textContent = `${file.issues.length.toLocaleString('en')} issues in the ${file.block ?? 'pilot'} block`;
  labelPlaces();
  const xs = state.issues.map((i) => i.x).concat(state.outline.map((p) => p[0]));
  const zs = state.issues.map((i) => i.z).concat(state.outline.map((p) => p[1]));
  layers.ground = groundLayer(state.outline, { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) });
  flatGroup.add(layers.ground.group);
  if (context) {
    layers.context = contextLayer(context);
    flatGroup.add(layers.context.buildings, layers.context.roads);
  }
  buildDots();
  renderList();
  resize();
  minimap.setData({
    outline: state.outline,
    roads: (context?.roads ?? []).map((r) => { const pts = []; for (let k = 0; k + 2 < r.p.length; k += 3) pts.push([r.p[k], r.p[k + 2]]); return { major: MAJOR.has(r.k), pts }; }),
    issues: state.issues, places: state.places, isHigh,
  });
  camera.position.set(0, 8000, 1);
  controls.target.set(0, 0, 0);
  setView('top');
  fitAll();
  requestAnimationFrame(frame);
  $('#loading').classList.add('done');
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
  // the lanes layer (P1-012) is big (about 10 MB): it comes last and only when the server has it
  if (status.layers?.lanes) {
    try {
      layers.lanes = lanesLayer(await getJson('/inspector/data/lanes.json'));
      flatGroup.add(layers.lanes.group);
      lastView = '';
      applyLayers();
    } catch (e) { banner(`The lanes layer could not be read: ${e.message}`); }
  }
  state.lanesReady = true;
}

// A hook for the tests and for Claude: read the page the way a person sees it.
window.__inspector = {
  state: () => ({
    ready: state.ready, view: state.view, flying: state.flying, selected: state.selected, proposal: state.proposal,
    issueCount: state.issues.length, listCount: document.querySelectorAll('#list .row').length,
    camera: { target: controls.target.toArray(), distance: camera.position.distanceTo(controls.target), position: camera.position.toArray() },
    picks: Object.keys(state.picks), lanes: layers.lanes ? layers.lanes.counts : null, lanesReady: !!state.lanesReady,
  }),
  listIds: () => [...document.querySelectorAll('#list .row')].map((r) => r.dataset.id),
  highIds: () => state.issues.filter((i) => isHigh(i) && !state.picks[i.id]).map((i) => i.id),
  places: () => Object.fromEntries(state.places.map((p) => [p.id, project(p.x, 0, p.z)])),
  issueScreen: (id) => { const i = state.byId.get(id); return i ? project(i.x, (i.y ?? 0) + 1, i.z) : null; },
  select: (id, opts) => select(id, opts),
  issue: (id) => state.byId.get(id) ?? null,
  /** The plain words of an issue card: title (what and where), problem, fix. */
  describe: (id) => { const i = state.byId.get(id); return i ? describe(i) : null; },
  /** Fly the camera to a world spot (top view keeps north up). */
  view: (x, z, distance) => flyTo([x, 0, z], distance ?? camera.position.distanceTo(controls.target)),
};

init().catch((e) => { banner(`The inspector could not start: ${e.message}`); state.error = e.message; $('#loading').classList.add('done'); });
