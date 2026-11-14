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
import { buildNameIndex, classWords, describeIssue, distToLine, fixWords, humanise, whereWords } from '../describe.ts';
import { LANE_TYPE_WORDS, NEAR_FOCUS_M, borderAt, driveLaneCount, laneItems, lanesIssueId, lanesSummary, metres, nearestStrip, sectionParts, sourceWords, stripWidths, isOwnerLanes } from '../lanes.ts';
import { ADD_KINDS, BARRIER_KINDS, MEDIAN_TYPES, ROAD_CLASSES, addInputProblems, kindInfo } from '../adds.ts';
import { HEADLINES, accessSummary, applyHeadlines, headlineWords, headlines, nearestAccessStrip, reasonWords, stripsOfEdge } from '../access.ts';
import { accessLayer, contextLayer, groundLayer, laneMarksLayer, lanesLayer } from './layers.js';
import { Minimap } from './minimap.js';
import { LANE_FILL, LANE_MARK, MAJOR, MAP, MATERIAL_COLOURS, OFFSET_MATERIALS, PROP_COLOURS, SEV } from './theme.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const state = {
  ready: false, issues: [], byId: new Map(), rules: {}, picks: {}, filter: 'all', search: '', selected: null, proposal: null,
  view: 'top', flying: false, places: [], source: '', markerIndex: [], hidden: new Set(), names: buildNameIndex(null, []),
  desc: new Map(), buildings: [], under: [], outline: [], hover: null, layers: { lanes: true, laneMarks: true, buildings: true, grid: true },
  // the lanes tab (P1-025): the lanes layer file, the lanes record of health.json, the listed split zones and taper findings
  accSel: null, accRules: { owner: [], judge: 0 },
  tab: 'issues', laneFile: null, health: null, laneItems: [], laneFilter: 'all', laneSel: null, lanePicks: {}, laneFocus: null,
  // the draw tool (P1-045): what is being drawn, its clicked points (world metres), its settings and reference
  add: {
    kind: 'add_way', points: [], note: '', link: '', date: new Date().toISOString().slice(0, 10), saved: [],
    settings: { highway: 'service', lanes: 1, oneway: false, name: '', medianWidth: 1.2, type: 'kerb', footWidth: 2, barrier: 'barricade' },
  },
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
const drawGroup = new THREE.Group();
scene.add(flatGroup, tileGroup, highlightGroup, markerGroup, lineGroup, drawGroup);
const lineMaterials = new Set();
const layers = { ground: null, context: null, lanes: null, laneMarks: null, access: null };

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
  if (layers.laneMarks) { layers.laneMarks.enabled = state.layers.laneMarks && state.layers.lanes; lastView = ''; }
  if (laneDots) laneDots.visible = state.layers.laneMarks && state.layers.lanes;
  if (layers.context) layers.context.buildings.visible = state.layers.buildings;
  if (layers.context) layers.context.underground.visible = state.layers.buildings;
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
  // underground structures (P1-041): "Underground: Rajiv Chowk metro station", shown with the buildings layer
  for (const u of state.under) {
    const el = document.createElement('div');
    el.className = 'place under';
    el.dataset.under = u.id;
    el.textContent = u.n;
    host.appendChild(el);
  }
}

/** Underground labels show close up only (under 3.5 km) and with the buildings layer; they sit just under the middle so a place label there stays readable. */
function placeUnderLabels(r, dist) {
  for (const u of state.under) {
    const el = document.querySelector(`.place.under[data-under="${CSS.escape(u.id)}"]`);
    if (!el) continue;
    const s = state.layers.buildings && dist < 3500 ? project(u.x, 0, u.z) : null;
    if (!s) { el.style.display = 'none'; continue; }
    el.style.display = '';
    el.style.left = `${s.x - r.left}px`;
    el.style.top = `${s.y - r.top + 26}px`;
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
  const spot = sel ? [sel.x, (sel.y ?? 0) + 1, sel.z] : state.laneSel ? [state.laneSel.point[0], 1, state.laneSel.point[1]] : null;
  const sp = spot && project(spot[0], spot[1], spot[2]);
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
  placeUnderLabels(r, camera.position.distanceTo(controls.target));
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
  layers.laneMarks?.update(dist);
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
  $('#add').hidden = state.tab !== 'add';
  $('#access').hidden = state.tab !== 'access';
  if (state.tab === 'access') {
    $('#empty').hidden = true; $('#issue').hidden = true; $('#lane').hidden = true;
    renderAccess();
    return;
  }
  if (state.tab === 'add') {
    $('#empty').hidden = true; $('#issue').hidden = true; $('#lane').hidden = true;
    renderAdd();
    return;
  }
  const i = state.selected && state.byId.get(state.selected);
  $('#empty').hidden = !!i || !!state.laneSel;
  $('#issue').hidden = !i;
  $('#lane').hidden = !!i || !state.laneSel;
  if (!i) return;
  const d = describe(i);
  const pick = state.picks[i.id];
  const cls = statusClass(i);
  const kicker = pick ? 'You picked a fix' : i.decided === 'judge' ? 'Decided from the top view' : i.status === 'overridden' ? 'Your fix is in the map' : isHigh(i) ? 'High impact, needs you' : i.decided === 'policy' ? 'Decided by a rule' : i.status === 'auto_repaired' ? 'Fixed by itself' : i.status === 'explained' ? 'Looks like the real road' : 'Needs you';
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
    ${d.question ? `<div class="block ask"><h4>The question for you</h4><p>${esc(d.question)}</p></div>` : ''}
    ${d.settled ? `<div class="block fix"><h4>How it was settled</h4><p>${esc(d.settled)}</p></div>` : ''}
    ${d.fix ? `<div class="block fix"><h4>${d.question ? 'Most likely answer' : 'Suggested fix'}</h4><p>${esc(d.fix)}</p></div>` : ''}
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
  state.laneSel = null;
  markLaneRow();
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
  state.accSel = null;
  state.laneSel = null;
  markLaneRow();
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

// ------------------------------------------------------------------ the lanes tab (P1-025)

const roadLabel = (st) => st.name || `Unnamed ${classWords(st.cls)}`;
const LANE_KIND_WORDS = { zone: 'Split zone', taper: 'Taper finding', road: 'Road section' };
const kmWords = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);

let laneDots = null;
function buildLaneDots() {
  if (laneDots) { markerGroup.remove(laneDots); laneDots.geometry.dispose(); }
  const items = state.laneItems;
  const pos = new Float32Array(items.length * 3);
  const col = new Float32Array(items.length * 3);
  const size = new Float32Array(items.length).fill(13);
  const alpha = new Float32Array(items.length).fill(1);
  const kind = new Float32Array(items.length).fill(1);
  const c = new THREE.Color();
  items.forEach((it, k) => { pos.set([it.x, 1, it.z], k * 3); c.set(LANE_MARK[it.kind]); col.set([c.r, c.g, c.b], k * 3); });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('col', new THREE.BufferAttribute(col, 3));
  g.setAttribute('size', new THREE.BufferAttribute(size, 1));
  g.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
  g.setAttribute('kind', new THREE.BufferAttribute(kind, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  laneDots = new THREE.Points(g, dotMaterial);
  laneDots.frustumCulled = false;
  laneDots.renderOrder = 9;
  markerGroup.add(laneDots);
  laneDots.visible = state.layers.laneMarks && state.layers.lanes;
  dirty = true;
}

function setupLanes(file, health) {
  state.laneFile = file;
  state.health = health;
  state.laneStrips = new Map(file.strips.map((st) => [st.id, st]));
  state.laneFocus = state.places.find((p) => p.id === 'ito_crossing') ?? null;
  state.laneItems = laneItems(file, health, state.laneFocus);
  layers.laneMarks = laneMarksLayer(file, state.laneItems.map((i) => ({ strip: i.strip, kind: i.kind })));
  flatGroup.add(layers.laneMarks.group);
  buildLaneDots();
  $('#lanesTab').hidden = false;
  if (file.strips.some((st) => st.acc)) {
    layers.access = accessLayer(file);
    flatGroup.add(layers.access.group);
    $('#accessTab').hidden = false;
    renderAccessHead();
  }
  $('#laneMarkCount').textContent = state.laneItems.length;
  $('#lanesSummary').textContent = lanesSummary(health, file.strips.length);
  renderLaneList();
  applyLayers();
}

function setTab(tab) {
  if (tab === 'lanes' && !state.laneFile) return;
  if (tab === 'access' && !layers.access) return;
  state.tab = tab;
  for (const b of document.querySelectorAll('#tabs [data-tab]')) b.classList.toggle('on', b.dataset.tab === tab);
  $('#issuesHead').hidden = tab !== 'issues';
  $('#list').hidden = tab !== 'issues';
  $('#lanesHead').hidden = tab !== 'lanes';
  $('#laneList').hidden = tab !== 'lanes';
  $('#addHead').hidden = tab !== 'add';
  $('#addList').hidden = tab !== 'add';
  $('#accessHead').hidden = tab !== 'access';
  $('#accessList').hidden = tab !== 'access';
  if (layers.access) { layers.access.group.visible = tab === 'access'; dirty = true; }
  if (tab === 'access') renderAccessList();
  mapEl.classList.toggle('drawing', tab === 'add');
  if (tab === 'add') { renderAddKinds(); renderAddList(); }
  drawSketch();
  renderDetail();
}

const nearFocus = (it) => it.fromFocus <= NEAR_FOCUS_M;
function visibleLaneItems() {
  return state.laneItems.filter((it) => state.laneFilter === 'all' || (state.laneFilter === 'near' ? nearFocus(it) : it.kind === state.laneFilter));
}

function renderLaneList() {
  if (!state.laneFile) return;
  const all = state.laneItems;
  const near = all.filter(nearFocus).length;
  const focusName = state.laneFocus ? state.laneFocus.name.replace(/^the /, '') : '';
  const defs = [['all', 'All', all.length], ['zone', 'Split zones', all.filter((i) => i.kind === 'zone').length], ['taper', 'Taper findings', all.filter((i) => i.kind === 'taper').length]];
  if (state.laneFocus) defs.push(['near', `Near ${focusName}`, near]);
  $('#laneChips').innerHTML = defs.map(([k, label, n]) => `<button type="button" data-lfilter="${k}" class="${state.laneFilter === k ? 'on' : ''}" title="${esc(label)}"><span class="l">${esc(label)}</span> <span class="n">${n.toLocaleString('en')}</span></button>`).join('');
  const rows = visibleLaneItems();
  const groups = state.laneFocus ? [['near', `Near ${state.laneFocus.name}`, rows.filter(nearFocus)], ['far', 'Elsewhere on the map', rows.filter((i) => !nearFocus(i))]] : [['far', 'All', rows]];
  let html = '';
  for (const [g, label, list] of groups) {
    if (!list.length) continue;
    html += `<div class="divider" data-group="${g}">${esc(label)} (${list.length.toLocaleString('en')})</div>`;
    for (const it of list) {
      const sel = state.laneSel?.item && state.laneSel.item.id === it.id;
      html += `<div class="row ${it.kind}${sel ? ' sel' : ''}" role="listitem" data-lane="${esc(it.id)}">`
        + `<div class="t">${esc(it.title)}</div><div class="b"><span class="dist">${state.laneFocus ? esc(kmWords(it.fromFocus)) : ''}</span></div>`
        + `<div class="s">${esc(it.detail)}</div><div class="kmeta">${esc(LANE_KIND_WORDS[it.kind])} · ${esc(it.id)}</div></div>`;
    }
  }
  const top = $('#laneList').scrollTop;
  $('#laneList').innerHTML = html || '<div class="none">Nothing here.</div>';
  $('#laneList').scrollTop = top;
}

function markLaneRow() {
  for (const r of document.querySelectorAll('#laneList .row.sel')) r.classList.remove('sel');
  const id = state.laneSel?.item?.id;
  if (id) $(`#laneList .row[data-lane="${CSS.escape(id)}"]`)?.classList.add('sel');
}

function drawLaneHighlight(sel) {
  clearGroup(highlightGroup);
  clearGroup(lineGroup);
  if (sel) {
    const pts = sel.strip.ref;
    if (pts.length > 1) {
      highlightGroup.add(polyline(pts, 1.2, { color: new THREE.Color(SEV.open), linewidth: 13, opacity: 0.22 }, 15));
      highlightGroup.add(polyline(pts, 1.2, { color: new THREE.Color(0x110d0a), linewidth: 6, opacity: 0.9 }, 16));
      highlightGroup.add(polyline(pts, 1.2, { color: new THREE.Color(0xffd27a), linewidth: 3, opacity: 1 }, 17));
    }
  }
  dirty = true;
}

/** Selects a lane section: from a list item (flies there) or from a click on the map (stays put). */
function showLane(strip, point, item, { fly = true } = {}) {
  state.selected = null;
  state.proposal = null;
  markSelectedRow();
  drawProposals(null, null);
  const at = Math.max(0, Math.min(strip.ref.length - 1, nearestIndex(strip, point)));
  state.laneSel = { strip, point, item: item ?? state.laneItems.find((i) => i.strip === strip.id) ?? null, at, draft: driveLaneCount(strip), noteDraft: '' };
  renderDetail();
  renderLane();
  markLaneRow();
  drawLaneHighlight(state.laneSel);
  const where = whereWords(state.names, point[0], point[1]);
  $('#selLabel').innerHTML = `${esc(roadLabel(strip))}${where ? `<small>${esc(where)}</small>` : ''}`;
  if (fly) flyTo([point[0], 0, point[1]], state.view === 'top' ? 150 : 120);
  $(`#laneList .row[data-lane="${CSS.escape(state.laneSel.item?.id ?? '')}"]`)?.scrollIntoView({ block: 'nearest' });
}
function nearestIndex(strip, point) {
  let best = 0; let bd = Infinity;
  strip.ref.forEach(([x, z], k) => { const d = Math.hypot(x - point[0], z - point[1]); if (d < bd) { bd = d; best = k; } });
  return best;
}

function selectLaneItem(id) {
  const it = state.laneItems.find((i) => i.id === id);
  const strip = it && state.laneStrips.get(it.strip);
  if (it && strip) showLane(strip, [it.x, it.z], it);
}

function pickLaneAt(x, z) {
  const hit = nearestStrip(state.laneFile.strips, x, z, 3);
  if (hit) showLane(hit.strip, [x, z], null, { fly: false });
  return hit?.strip.id ?? null;
}

function renderLane() {
  const sel = state.laneSel;
  const el = $('#lane');
  if (!sel) { el.innerHTML = ''; return; }
  const st = sel.strip;
  const kind = st.kind === 'zone' ? 'zone' : sel.item?.kind === 'taper' || st.taper ? 'taper' : 'road';
  const w = stripWidths(st);
  const count = driveLaneCount(st);
  const src = sourceWords(st.from ?? (st.kind === 'zone' ? 'zone' : undefined), st.by);
  const owner = state.lanePicks[lanesIssueId(st.edge)];
  const b = borderAt(st, sel.at);
  const lanes = sectionParts(st.lanes, b).map(({ type, dir, widthM: wd }) => {
    const colour = `#${(LANE_FILL[type] ?? LANE_FILL.drive).toString(16).padStart(6, '0')}`;
    const way = type === 'drive' && dir === 0 ? '<span class="d">both ways</span>' : '';
    return `<div class="ln"><i style="background:${colour}"></i><span>${esc(LANE_TYPE_WORDS[type] ?? type)}${way}</span><span class="w">${(Math.round(wd * 100) / 100).toFixed(2)} m</span></div>`;
  }).join('');
  const kicker = { zone: 'Split zone', taper: 'Taper finding', road: 'Road section' }[kind];
  const sev = kind === 'zone' ? LANE_MARK.zone : kind === 'taper' ? LANE_MARK.taper : 'var(--accent)';
  const where = whereWords(state.names, sel.point[0], sel.point[1]);
  let extra = '';
  if (kind === 'zone') {
    const z = state.laneFile.zones.find((q) => q.id === st.id);
    extra = `<div class="block"><h4>${z?.kind === 'diverge' ? 'The road splits here' : 'Two roads merge here'}</h4><p>${z ? `The painted island is ${Math.round(z.noseM * 10) / 10} m long from the split point to its nose. ` : ''}The lanes of both branches run side by side with an island between them.</p></div>`;
  }
  if (st.taper) {
    const [len, shift, need] = st.taper;
    extra += `<div class="block"><h4>Lane widths change here</h4><p>Over ${Math.round(len * 10) / 10} m the lanes shift ${Math.round(shift * 10) / 10} m. A road of this class needs ${Math.round(need * 10) / 10} m for that.</p>${sel.item?.kind === 'taper' ? `<p class="measured">${esc(sel.item.detail)}</p>` : ''}</div>`;
  }
  const canSet = st.kind !== 'zone';
  const set = canSet ? `<h3>Change the lane count</h3>
    ${owner ? `<div class="msg msg-saved">You set this road to ${owner.params?.lanes ?? '?'} lanes (overrides/${esc(owner.file)}). The next bake uses it. You can change it again.</div>` : ''}
    <div class="setrow"><span class="l">Driving lanes</span><span class="stepper"><button type="button" id="lanesDown" aria-label="One lane fewer"${sel.draft <= 1 ? ' disabled' : ''}>&minus;</button><output id="lanesNow">${sel.draft}</output><button type="button" id="lanesUp" aria-label="One lane more"${sel.draft >= 12 ? ' disabled' : ''}>+</button></span></div>
    <textarea id="laneNote" placeholder="Why, for example: three lanes each way at the ITO crossing, I counted them on the street photo.">${esc(sel.noteDraft)}</textarea>
    <div class="actions"><button type="button" class="primary" id="laneSave"${sel.draft === count && !sel.noteDraft.trim() ? ' disabled' : ''}>Save lane count</button><button type="button" class="secondary" id="laneOpenGame">Open in game</button></div>
    <div id="lmsg" class="msg" hidden></div>`
    : `<p class="where">A split zone has no lane count of its own. Click one of the roads beside it to change its lanes.</p><div class="actions"><button type="button" class="secondary" id="laneOpenGame">Open in game</button></div><div id="lmsg" class="msg" hidden></div>`;
  el.innerHTML = `
    <div class="kicker" style="--sev:${sev}"><i class="dot" style="background:${sev}"></i>${esc(kicker)}</div>
    <h2>${esc(roadLabel(st))}</h2>
    ${where ? `<p class="where">${esc(where)}</p>` : ''}
    <p class="rule-id">${esc(st.id)} · ${esc(classWords(st.cls))}${st.hero ? ` · hero road ${esc(st.hero)}` : ''}${st.bridge ? ' · on a bridge' : ''}</p>
    <div class="stats lane-stats">
      <div class="stat"><span class="l">Driving lanes</span><span class="v">${count}</span></div>
      <div class="stat"><span class="l">Lane width</span><span class="v">${esc(metres(w.lane))}</span></div>
      <div class="stat"><span class="l">Whole road</span><span class="v">${esc(metres(w.total))}</span></div>
    </div>
    <div class="block"><h4>Where the lane count comes from</h4><div class="srcline">${esc(src.label)}<span class="tag${isOwnerLanes(st.by) ? ' you' : ''}">${esc(st.from ?? st.kind)}</span></div><p>${esc(src.long)}</p></div>
    ${extra}
    <h3>Across the road, left to right</h3>
    <div class="lane-sec">${lanes}</div>
    ${set}
    <div class="ids">${esc(st.id)}<br>edge ${esc(st.edge)} · x ${Math.round(sel.point[0])}, z ${Math.round(sel.point[1])}</div>`;
}

function laneMessage(text, bad = false) {
  const m = $('#lmsg');
  if (!m) return;
  m.hidden = !text; m.textContent = text; m.className = `msg${bad ? ' bad' : ''}`;
}

async function saveLanes() {
  const sel = state.laneSel;
  if (!sel) return;
  const res = await fetch('/api/inspector/set-lanes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ edge: sel.strip.edge, lanes: sel.draft, x: sel.point[0], z: sel.point[1], note: sel.noteDraft }) });
  const body = await res.json();
  if (!res.ok) { laneMessage(body.error || 'Could not save.', true); return; }
  state.lanePicks[lanesIssueId(sel.strip.edge)] = { patch: body.patch.id, action: body.patch.action, why: body.patch.why, file: body.file, params: body.patch.params };
  renderLane();
  laneMessage(`Saved. Patch ${body.patch.id} is in overrides/${body.file}. The next bake of that tile uses ${sel.draft} lanes here. Claude sees it in the inbox.`);
}

// ------------------------------------------------------------------ the access tab (P2-043)

function renderAccessHead() {
  const s = accessSummary(state.laneFile.strips);
  const r = s.byReason;
  $('#accessSummary').textContent = `${s.edges.toLocaleString('en')} roads, ${s.carFree.toLocaleString('en')} closed to cars. Decided by: ${['rule', 'context', 'width', 'osm_tag', 'judge', 'owner'].filter((k) => r[k]).map((k) => `${({ rule: 'Delhi rules', context: 'common sense', width: 'too narrow', osm_tag: 'map data tags', judge: 'the judge pass', owner: 'your edits' })[k]} ${r[k]}`).join(', ')}.`;
}

async function loadAccessRules() {
  try { state.accRules = await getJson('/api/inspector/access'); } catch { state.accRules = { owner: [], judge: 0 }; }
}

function renderAccessList() {
  const el = $('#accessList');
  const o = state.accRules.owner;
  el.innerHTML = `<div class="row-note small">${state.accRules.judge} judge decisions and ${o.length} edits of yours are in the access rules file.</div>`
    + o.map((r) => `<div class="row" role="listitem"><span class="t">${esc(r.id.replace(/^owner_/, '').replace(/_/g, ' '))}</span><span class="s small">${esc(HEADLINES.map((h) => `${h === 'car' ? 'cars' : h === 'two_wheeler' ? 'scooters' : 'walkers'} ${r.modes.includes(h) ? 'yes' : 'no'}`).join(', '))}</span></div>`).join('');
}

function pickAccessAt(x, z) {
  const hit = nearestAccessStrip(state.laneFile.strips, x, z, 4);
  if (!hit) return null;
  showAccess(hit.strip, [x, z]);
  return hit.strip.edge;
}

function showAccess(strip, point) {
  const strips = stripsOfEdge(state.laneFile.strips, strip.edge);
  state.accSel = { strip, strips, point, want: headlines(strip.acc.m), noteDraft: '', saved: null };
  state.selected = null;
  state.laneSel = null;
  renderAccess();
  drawAccessHighlight(state.accSel);
  const where = whereWords(state.names, point[0], point[1]);
  $('#selLabel').innerHTML = `${esc(roadLabel(strip))}${where ? `<small>${esc(where)}</small>` : ''}`;
}

function drawAccessHighlight(sel) {
  clearGroup(highlightGroup);
  clearGroup(lineGroup);
  if (sel) {
    for (const st of sel.strips) {
      if (st.ref.length < 2) continue;
      highlightGroup.add(polyline(st.ref, 1.2, { color: new THREE.Color(SEV.open), linewidth: 13, opacity: 0.22 }, 15));
      highlightGroup.add(polyline(st.ref, 1.2, { color: new THREE.Color(0x110d0a), linewidth: 6, opacity: 0.9 }, 16));
      highlightGroup.add(polyline(st.ref, 1.2, { color: new THREE.Color(0xffd27a), linewidth: 3, opacity: 1 }, 17));
    }
  }
  dirty = true;
}

function renderAccess() {
  const el = $('#access');
  const sel = state.accSel;
  if (!sel) {
    el.innerHTML = `<div class="empty"><div class="empty-mark" aria-hidden="true"></div><h2>Pick a road</h2><p>Click any road on the map. You see who may use it and why, and you can change it.</p></div>`;
    return;
  }
  const st = sel.strip;
  const a = st.acc;
  const why = reasonWords(a.r);
  const was = headlines(a.m);
  const changed = HEADLINES.some((h) => sel.want[h] !== was[h]);
  const own = state.accRules.owner.find((r) => r.id.endsWith(st.edge.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')));
  const rows = HEADLINES.map((h) => `<div class="setrow acc-row"><span class="l">${esc(headlineWords(h))}</span><span class="seg"><button type="button" data-acc="${h}" data-v="1" class="${sel.want[h] ? 'on' : ''}">May use</button><button type="button" data-acc="${h}" data-v="0" class="${sel.want[h] ? '' : 'on'}">Not allowed</button></span></div>`).join('');
  $('#access').innerHTML = `
    <div class="kicker" style="--sev:var(--accent)"><i class="dot" style="background:var(--accent)"></i>Road access</div>
    <h2>${esc(roadLabel(st))}</h2>
    <p class="rule-id">${esc(st.edge)} · ${esc(classWords(st.cls))}</p>
    <div class="block"><h4>Decided by: ${esc(why.label)}${a.rule ? ` <span class="tag${a.r === 'owner' ? ' you' : ''}">${esc(a.rule)}</span>` : ''}</h4><p>${esc(a.why)}</p>${a.hours ? `<p class="measured">Only ${esc(a.hours)}</p>` : ''}<p class="small">${esc(why.long)}</p></div>
    <h3>Who may use it</h3>
    ${own ? `<div class="msg msg-saved">You already set this road (${esc(own.id)}). Saving again replaces it.</div>` : ''}
    ${rows}
    <p class="small">Cycles and emergency vehicles keep what the road has now: ${esc(a.m.filter((m) => m === 'cycle' || m === 'emergency').join(', ') || 'neither')}.</p>
    <textarea id="accNote" placeholder="Why, for example: I walked this lane, a car cannot pass the shop stalls.">${esc(sel.noteDraft)}</textarea>
    <div class="actions"><button type="button" class="primary" id="accSave"${changed || sel.noteDraft.trim() ? '' : ' disabled'}>Save access</button></div>
    <div id="accMsg" class="msg" ${sel.saved ? '' : 'hidden'}>${sel.saved ? esc(sel.saved.text) : ''}</div>
    <div class="ids">edge ${esc(st.edge)} · x ${Math.round(sel.point[0])}, z ${Math.round(sel.point[1])}</div>`;
}

async function saveAccess() {
  const sel = state.accSel;
  if (!sel) return;
  const res = await fetch('/api/inspector/set-access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ edge: sel.strip.edge, want: sel.want, x: sel.point[0], z: sel.point[1], note: sel.noteDraft }) });
  const body = await res.json();
  if (!res.ok) { sel.saved = { text: body.error || 'Could not save.', ok: false }; renderAccess(); const m = $('#accMsg'); if (m) m.className = 'msg bad'; return; }
  // the page shows the new modes at once; the bake makes them real
  for (const s of sel.strips) s.acc = { ...s.acc, m: body.modes, r: 'owner', rule: body.rule.id, why: body.rule.why };
  sel.saved = { text: `Saved as rule ${body.rule.id} in the access rules file (by owner). The next bake uses it. Claude sees it in the inbox.`, ok: true };
  await loadAccessRules();
  renderAccessHead();
  renderAccessList();
  renderAccess();
}

async function openLaneInGame() {
  const sel = state.laneSel;
  if (!sel) return;
  laneMessage('Asking the game...');
  try {
    const res = await fetch('/api/inspector/open-in-game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: sel.point[0], z: sel.point[1] }) });
    const body = await res.json();
    laneMessage(body.message ?? 'Done.', !body.ok);
  } catch { laneMessage('Could not reach the inspector server.', true); }
}

// ------------------------------------------------------------------ the draw tool (P1-045)

/** What the drawing becomes: the input of /api/inspector/add (and of addInputProblems, the same check the server makes). */
function addInput() {
  const a = state.add;
  const s = a.settings;
  const settings = a.kind === 'add_way' ? { highway: s.highway, lanes: s.lanes, oneway: !!s.oneway, name: s.name }
    : a.kind === 'add_median' ? { width: s.medianWidth, type: s.type }
    : a.kind === 'add_footpath' ? { width: s.footWidth }
    : a.kind === 'add_barrier' ? { kind: s.barrier } : {};
  return { kind: a.kind, points: a.points.map(([x, z]) => [Math.round(x * 100) / 100, Math.round(z * 100) / 100]), settings, reference: { link: a.link.trim(), date: a.date }, note: a.note };
}

function renderAddKinds() {
  $('#addKinds').innerHTML = ADD_KINDS.map((k) => `<button type="button" data-kind="${k.kind}" class="${state.add.kind === k.kind ? 'on' : ''}"><span class="l">${esc(k.label)}</span></button>`).join('');
  $('#addHelp').textContent = kindInfo(state.add.kind).help;
}

function setAddKind(kind) {
  const info = kindInfo(kind);
  if (!info) return;
  state.add.kind = kind;
  // a point kind keeps one click; a line kind keeps them all
  if (!info.line) state.add.points = state.add.points.slice(-1);
  renderAddKinds();
  drawSketch();
  renderAdd();
}

function addPoint(x, z) {
  const info = kindInfo(state.add.kind);
  if (info.line) state.add.points.push([x, z]); else state.add.points = [[x, z]];
  drawSketch();
  renderAdd();
}

function drawSketch() {
  clearGroup(drawGroup);
  const pts = state.tab === 'add' ? state.add.points : [];
  if (pts.length) {
    const info = kindInfo(state.add.kind);
    const colour = new THREE.Color(0xffb224);
    if (pts.length > 1) {
      drawGroup.add(polyline(pts, 1.4, { color: new THREE.Color(0x110d0a), linewidth: 7, opacity: 0.9 }, 18));
      drawGroup.add(polyline(pts, 1.4, { color: colour, linewidth: 3.5, opacity: 1 }, 19));
    }
    // each click as a small cross, sized for the view
    const r = Math.max(1.2, camera.position.distanceTo(controls.target) * 0.012);
    for (const [x, z] of pts) {
      for (const seg of [[[x - r, z], [x + r, z]], [[x, z - r], [x, z + r]]]) drawGroup.add(polyline(seg, 1.5, { color: info.line ? new THREE.Color(0xffffff) : colour, linewidth: 3, opacity: 1 }, 20));
    }
  }
  dirty = true;
}

function updateAddSave() {
  const btn = $('#addSave');
  if (!btn) return;
  const problems = addInputProblems(addInput());
  btn.disabled = problems.length > 0;
  const why = $('#addWhy');
  if (why) why.textContent = problems.join(' ');
}

function addMessage(text, bad = false) {
  const m = $('#amsg');
  if (!m) return;
  m.hidden = !text; m.textContent = text; m.className = `msg${bad ? ' bad' : ''}`;
}

const option = (v, now, label = v) => `<option value="${esc(v)}"${v === now ? ' selected' : ''}>${esc(label)}</option>`;

function renderAdd() {
  const a = state.add;
  const s = a.settings;
  const info = kindInfo(a.kind);
  let fields = '';
  if (a.kind === 'add_way') {
    fields = `<label class="field"><span>Road type</span><select data-set="highway">${ROAD_CLASSES.map((c) => option(c, s.highway, classWords(c))).join('')}</select></label>
      <div class="setrow"><span class="l">Driving lanes</span><span class="stepper"><button type="button" id="lanesStepDown" aria-label="One lane fewer"${s.lanes <= 1 ? ' disabled' : ''}>&minus;</button><output>${s.lanes}</output><button type="button" id="lanesStepUp" aria-label="One lane more"${s.lanes >= 8 ? ' disabled' : ''}>+</button></span></div>
      <label class="field check"><input type="checkbox" data-set="oneway"${s.oneway ? ' checked' : ''}><span>One way, in the order of the clicks</span></label>
      <label class="field"><span>Name (optional)</span><input type="text" data-set="name" value="${esc(s.name)}" placeholder="For example: Supreme Court service lane"></label>`;
  } else if (a.kind === 'add_median') {
    fields = `<label class="field"><span>Median width (m)</span><input type="number" min="0.3" max="30" step="0.1" data-set="medianWidth" value="${s.medianWidth}"></label>
      <label class="field"><span>Kind of divider</span><select data-set="type">${MEDIAN_TYPES.map((t) => option(t, s.type, { kerb: 'Raised kerb', planter: 'Planter with plants', barrier: 'Concrete barrier', painted: 'Painted lines only' }[t])).join('')}</select></label>`;
  } else if (a.kind === 'add_footpath') {
    fields = `<label class="field"><span>Footpath width (m)</span><input type="number" min="0.6" max="10" step="0.1" data-set="footWidth" value="${s.footWidth}"></label>`;
  } else if (a.kind === 'add_barrier') {
    fields = `<label class="field"><span>Kind of barrier</span><select data-set="barrier">${BARRIER_KINDS.map((k) => option(k, s.barrier, { barricade: 'Barricade', bollards: 'Bollards', gate: 'Gate', wall: 'Wall' }[k])).join('')}</select></label>`;
  }
  const n = a.points.length;
  const ptsWords = n ? `${n} point${n === 1 ? '' : 's'} clicked${info.line && n > 1 ? `, ${Math.round(a.points.slice(1).reduce((m, p, k) => m + Math.hypot(p[0] - a.points[k][0], p[1] - a.points[k][1]), 0))} m long` : ''}` : 'No points yet. Click on the map.';
  $('#add').innerHTML = `
    <div class="kicker" style="--sev:var(--accent)"><i class="dot" style="background:var(--accent)"></i>Add to the map</div>
    <h2>${esc(info.label)}</h2>
    <p class="where">${esc(info.help)}</p>
    <div class="addform">
      <p class="pts" id="addPts">${esc(ptsWords)}</p>
      ${fields}
      <h3>Reference</h3>
      <label class="field"><span>Photo or satellite link</span><input type="url" data-set="link" value="${esc(a.link)}" placeholder="https://"></label>
      <label class="field"><span>Date you looked at it</span><input type="date" data-set="date" value="${esc(a.date)}"></label>
      <h3>Your note (optional)</h3>
      <textarea data-set="note" placeholder="For example: the satellite view shows a divider along the whole road.">${esc(a.note)}</textarea>
    </div>
    <div class="actions">
      <button type="button" class="primary" id="addSave" disabled>Save</button>
      <button type="button" class="secondary" id="addUndo"${n ? '' : ' disabled'}>Undo point</button>
      <button type="button" class="secondary" id="addClear"${n ? '' : ' disabled'}>Clear</button>
    </div>
    <p class="where" id="addWhy"></p>
    <div id="amsg" class="msg" hidden></div>`;
  updateAddSave();
}

function renderAddList() {
  const list = state.add.saved;
  $('#addList').innerHTML = list.length
    ? `<div class="divider">Saved this time (${list.length})</div>${list.map((it) => `<div class="row" role="listitem" data-x="${it.x}" data-z="${it.z}"><div class="t">${esc(it.label)}</div><div class="s">${esc(it.why)}</div><div class="kmeta">${esc(it.patch)} · overrides/${esc(it.file)}</div></div>`).join('')}`
    : '<div class="none">Nothing drawn yet. Saved drawings show here.</div>';
}

async function saveAdd() {
  const input = addInput();
  if (addInputProblems(input).length) return;
  const res = await fetch('/api/inspector/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const body = await res.json();
  if (!res.ok) { addMessage(body.error || 'Could not save.', true); return; }
  const [x, z] = input.points[0];
  state.add.saved.unshift({ patch: body.patch.id, file: body.file, label: kindInfo(input.kind).label, why: body.patch.why, x, z });
  state.add.points = [];
  state.add.note = '';
  drawSketch();
  renderAdd();
  renderAddList();
  addMessage(`Saved. Patch ${body.patch.id} is in overrides/${body.file}. The next bake adds it. Claude sees it in the inbox.`);
  state.add.last = body;
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
$('#access').addEventListener('click', (e) => {
  const b = e.target.closest('[data-acc]');
  if (b && state.accSel) { state.accSel.want[b.dataset.acc] = b.dataset.v === '1'; state.accSel.saved = null; renderAccess(); return; }
  if (e.target.closest('#accSave')) saveAccess();
});
$('#access').addEventListener('input', (e) => { if (e.target.id === 'accNote' && state.accSel) { state.accSel.noteDraft = e.target.value; const b = $('#accSave'); if (b) b.disabled = !(HEADLINES.some((h) => state.accSel.want[h] !== headlines(state.accSel.strip.acc.m)[h]) || state.accSel.noteDraft.trim()); } });
$('#tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
$('#laneChips').addEventListener('click', (e) => { const b = e.target.closest('[data-lfilter]'); if (b) { state.laneFilter = b.dataset.lfilter; renderLaneList(); } });
$('#laneList').addEventListener('click', (e) => { const r = e.target.closest('.row'); if (r) selectLaneItem(r.dataset.lane); });
$('#lane').addEventListener('click', (e) => {
  const sel = state.laneSel;
  if (!sel) return;
  const step = (d) => { sel.draft = Math.min(12, Math.max(1, sel.draft + d)); renderLane(); };
  if (e.target.closest('#lanesUp')) step(1);
  else if (e.target.closest('#lanesDown')) step(-1);
  else if (e.target.closest('#laneSave')) saveLanes();
  else if (e.target.closest('#laneOpenGame')) openLaneInGame();
});
$('#lane').addEventListener('input', (e) => {
  if (e.target.id !== 'laneNote' || !state.laneSel) return;
  state.laneSel.noteDraft = e.target.value;
  const save = $('#laneSave');
  if (save) save.disabled = state.laneSel.draft === driveLaneCount(state.laneSel.strip) && !e.target.value.trim();
});
$('#addKinds').addEventListener('click', (e) => { const b = e.target.closest('[data-kind]'); if (b) setAddKind(b.dataset.kind); });
$('#add').addEventListener('click', (e) => {
  if (e.target.closest('#addUndo')) { state.add.points.pop(); drawSketch(); renderAdd(); }
  else if (e.target.closest('#addClear')) { state.add.points = []; drawSketch(); renderAdd(); }
  else if (e.target.closest('#addSave')) saveAdd();
  else if (e.target.closest('#lanesStepDown')) { state.add.settings.lanes = Math.max(1, state.add.settings.lanes - 1); renderAdd(); }
  else if (e.target.closest('#lanesStepUp')) { state.add.settings.lanes = Math.min(8, state.add.settings.lanes + 1); renderAdd(); }
});
$('#add').addEventListener('input', (e) => {
  const t = e.target;
  const a = state.add;
  if (!t.dataset.set) return;
  const v = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) : t.value;
  if (t.dataset.set === 'link') a.link = v; else if (t.dataset.set === 'date') a.date = v; else if (t.dataset.set === 'note') a.note = v; else a.settings[t.dataset.set] = v;
  updateAddSave();
});
$('#addList').addEventListener('click', (e) => { const r = e.target.closest('[data-x]'); if (r) flyTo([Number(r.dataset.x), 0, Number(r.dataset.z)], 160); });
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
    if (state.tab === 'lanes') {
      const ids = [...document.querySelectorAll('#laneList .row')].map((r) => r.dataset.lane);
      if (!ids.length) return;
      const at = ids.indexOf(state.laneSel?.item?.id);
      selectLaneItem(ids[at < 0 ? 0 : Math.min(ids.length - 1, Math.max(0, at + (k === 'j' ? 1 : -1)))]);
      e.preventDefault();
      return;
    }
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
  if (state.tab === 'add') {
    const r = mapEl.getBoundingClientRect();
    const g = groundAt(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    if (g) addPoint(g.x, g.z);
    return;
  }
  if (state.tab === 'access' && state.laneFile) {
    const r = mapEl.getBoundingClientRect();
    const g = groundAt(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    if (g) pickAccessAt(g.x, g.z);
    return;
  }
  const hit = nearestIssue(e.clientX, e.clientY, 14);
  if (hit) { select(hit.id); return; }
  // no issue under the click: the lane section under it, when the lanes layer is on and close enough to read
  if (state.laneFile && state.layers.lanes && camera.position.distanceTo(controls.target) < 2200) {
    const r = mapEl.getBoundingClientRect();
    const g = groundAt(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    if (g) pickLaneAt(g.x, g.z);
  }
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
  state.picks = {};
  for (const [k, v] of Object.entries(picks)) if (!k.startsWith('add:')) (k.startsWith('lanes:') ? state.lanePicks : state.picks)[k] = v;
  state.places = index.places ?? [];
  state.source = file.source;
  state.outline = context?.outline ?? [];
  state.names = buildNameIndex(context, state.places);
  state.under = context?.underground ?? [];
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
    flatGroup.add(layers.context.buildings, layers.context.underground, layers.context.roads);
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
      const laneFile = await getJson('/inspector/data/lanes.json');
      const health = status.layers.health ? await getJson('/inspector/data/health.json').then((h) => h.lanes ?? null).catch(() => null) : null;
      layers.lanes = lanesLayer(laneFile);
      flatGroup.add(layers.lanes.group);
      setupLanes(laneFile, health);
      lastView = '';
      applyLayers();
    } catch (e) { banner(`The lanes layer could not be read: ${e.message}`); }
  }
  await loadAccessRules();
  state.lanesReady = true;
}

// A hook for the tests and for Claude: read the page the way a person sees it.
window.__inspector = {
  state: () => ({
    ready: state.ready, view: state.view, flying: state.flying, selected: state.selected, proposal: state.proposal,
    issueCount: state.issues.length, listCount: document.querySelectorAll('#list .row').length,
    camera: { target: controls.target.toArray(), distance: camera.position.distanceTo(controls.target), position: camera.position.toArray() },
    picks: Object.keys(state.picks), lanes: layers.lanes ? layers.lanes.counts : null, lanesReady: !!state.lanesReady,
    layersOn: { ...state.layers }, lanesVisible: layers.lanes ? layers.lanes.group.visible : null, tab: state.tab,
  }),
  listIds: () => [...document.querySelectorAll('#list .row')].map((r) => r.dataset.id),
  highIds: () => state.issues.filter((i) => isHigh(i) && !state.picks[i.id]).map((i) => i.id),
  places: () => Object.fromEntries(state.places.map((p) => [p.id, project(p.x, 0, p.z)])),
  /** Underground structures (P1-041): id, label, kind, middle and whether the label is on screen. */
  underground: () => state.under.map((u) => { const el = document.querySelector(`.place.under[data-under="${CSS.escape(u.id)}"]`); return { id: u.id, label: u.n, kind: u.k, x: u.x, z: u.z, shown: !!el && el.style.display !== 'none' }; }),
  issueScreen: (id) => { const i = state.byId.get(id); return i ? project(i.x, (i.y ?? 0) + 1, i.z) : null; },
  select: (id, opts) => select(id, opts),
  issue: (id) => state.byId.get(id) ?? null,
  /** The plain words of an issue card: title (what and where), problem, fix. */
  describe: (id) => { const i = state.byId.get(id); return i ? describe(i) : null; },
  /** The lanes tab (P1-025): what the list shows, the selected lane section, the same numbers as the health report. */
  lanes: {
    tab: (t) => setTab(t),
    items: () => state.laneItems.map(({ kind, id, x, z, title }) => ({ kind, id, x, z, title })),
    counts: () => ({
      zones: state.laneItems.filter((i) => i.kind === 'zone').length, tapers: state.laneItems.filter((i) => i.kind === 'taper').length,
      rows: document.querySelectorAll('#laneList .row').length, summary: $('#lanesSummary').textContent,
      health: state.health ? { zones: state.health.zones?.zones ?? null, tapers: state.health.tapers?.violations ?? null, findings: state.health.tapers?.findings?.length ?? null } : null,
    }),
    select: (id) => selectLaneItem(id),
    selected: () => (state.laneSel ? { strip: state.laneSel.strip.id, edge: state.laneSel.strip.edge, lanes: driveLaneCount(state.laneSel.strip), from: state.laneSel.strip.from ?? null, by: state.laneSel.strip.by ?? null, item: state.laneSel.item?.id ?? null } : null),
    pickAt: (x, z) => (state.laneFile ? pickLaneAt(x, z) : null),
    screen: (x, z) => project(x, 0, z),
    strips: () => state.laneFile?.strips ?? [],
  },
  /** The access tab (P2-043): the tab, the selected road, the switches, the last saved answer. */
  access: {
    tab: () => setTab('access'),
    pickAt: (x, z) => (state.laneFile ? pickAccessAt(x, z) : null),
    screen: (x, z) => project(x, 0, z),
    selected: () => (state.accSel ? { edge: state.accSel.strip.edge, modes: state.accSel.strip.acc.m, reason: state.accSel.strip.acc.r, rule: state.accSel.strip.acc.rule ?? null, want: { ...state.accSel.want }, saved: state.accSel.saved?.text ?? null, saveEnabled: !!$('#accSave') && !$('#accSave').disabled } : null),
    counts: () => ({ overlay: layers.access?.counts ?? null, summary: $('#accessSummary')?.textContent ?? '', owner: state.accRules.owner.length, judge: state.accRules.judge }),
    set: (h, v) => { if (state.accSel) { state.accSel.want[h] = !!v; renderAccess(); } },
    note: (t) => { if (state.accSel) { state.accSel.noteDraft = t; renderAccess(); } },
    save: () => saveAccess(),
  },
  /** The draw tool (P1-045): the tab, what is drawn, and the last saved answer of the server. */
  add: {
    tab: () => setTab('add'),
    kind: (k) => setAddKind(k),
    state: () => ({ kind: state.add.kind, points: state.add.points.map((p) => [...p]), input: addInput(), problems: addInputProblems(addInput()), saved: state.add.saved.length, last: state.add.last ?? null, saveEnabled: !!$('#addSave') && !$('#addSave').disabled }),
    screen: (x, z) => project(x, 0, z),
  },
  /** Fly the camera to a world spot (top view keeps north up). */
  view: (x, z, distance) => flyTo([x, 0, z], distance ?? camera.position.distanceTo(controls.target)),
};

init().catch((e) => { banner(`The inspector could not start: ${e.message}`); state.error = e.message; $('#loading').classList.add('done'); });
