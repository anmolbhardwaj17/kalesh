// Performance budgets, read from harness/verify/perf_budgets.json (Phase 0 style discovery measures a baseline on the target
// machine and writes the numbers there; the owner signs them off with the style). verify.mjs judges every perf window and
// every page load against them; lookproof.mjs --perf writes a before and after table with the same numbers.
//
// File format (every key optional; missing keys fall back to DEFAULTS):
//   {
//     "status": "draft" | "signed",          signed = agreed in Phase 0 (decisions.md has the quote)
//     "target": "M1 MacBook Air, 1080p, medium preset",
//     "windowMs": 3000,                      length of one perf window (debug.perf(ms))
//     "frameMs": { "warn": 16.6, "fail": 22 },   p95 frame time (the larger of CPU and GPU, perfgate.mjs)
//     "fpsFloor": 45,                        average fps under this fails
//     "loadMs": { "warn": 4000, "fail": 12000 },  page open to window.__game.ready
//     "presets": {                           per quality preset (scenario `quality`), "default" for scenarios without one
//       "default": { "drawCalls": { "warn": 300, "fail": 600 }, "triangles": { "warn": 500000, "fail": 1500000 }, "gpuMB": { "warn": 256, "fail": 512 } }
//     }
//   }
//     "scenes": {                            per scene KIND: the draw call, triangle and video memory budgets
//       "look": { "drawCalls": {...}, "triangles": {...}, "gpuMB": {...} },   stand-in look scenes, lookproof sets (the default kind)
//       "city": { "drawCalls": {...}, ... }                                    streamed city scenes (real tiles, crowds, traffic)
//     }
// A scenario (`scene: "city"`) or a lookproof run (`--scene-kind city`) names its kind; none means "look". The kind's block
// replaces the preset's limits for the keys it carries (a city scene needs no copy of the block in its own `budget`). Frame time,
// fps floor and load do not depend on the kind. SCENE_KINDS lists the kinds.
// A scenario may carry its own `budget` object with the same keys (frameMs, fpsFloor, loadMs, drawCalls, triangles, gpuMB)
// to tighten or loosen one number for that scene; say why in its `_note`.
// Software GL (no GPU) never judges frame time or fps: the numbers mean nothing there.
import path from 'node:path';
import { ROOT, readJSON, config } from './lib.mjs';
import { frameTimeGate } from './perfgate.mjs';

export const SCENE_KINDS = ['look', 'city'];
export const DEFAULT_SCENE_KIND = 'look';
const SCENE_KEYS = ['drawCalls', 'triangles', 'gpuMB'];

export const DEFAULTS = {
  status: 'default',
  windowMs: 3000,
  frameMs: { warn: 16.6, fail: 22 },
  fpsFloor: 45,
  loadMs: { warn: 5000, fail: 15000 },
  presets: { default: { drawCalls: { warn: 400, fail: 1000 }, triangles: { warn: 750000, fail: 2000000 }, gpuMB: { warn: 384, fail: 768 } } },
};

/** The budgets with defaults filled in, plus `gateOpts` for perfgate.frameTimeGate and `source` for the report. */
export function loadBudgets(file = path.join(ROOT, config().perfBudgetsFile || 'harness/verify/perf_budgets.json')) {
  const raw = readJSON(file, null);
  return normalize(raw, raw ? path.relative(ROOT, file) : 'built-in defaults (no perf_budgets.json)');
}

export function normalize(raw, source = 'inline') {
  const b = { ...DEFAULTS, ...(raw || {}) };
  b.frameMs = { ...DEFAULTS.frameMs, ...(raw?.frameMs || {}) };
  b.loadMs = { ...DEFAULTS.loadMs, ...(raw?.loadMs || {}) };
  b.presets = { ...DEFAULTS.presets, ...(raw?.presets || {}) };
  b.scenes = raw?.scenes && typeof raw.scenes === 'object' ? raw.scenes : {};
  b.frameMsWarn = b.frameMs.warn;
  b.frameMsFail = b.frameMs.fail;
  b.gateOpts = { warnMs: b.frameMs.warn, failMs: b.frameMs.fail, fpsFloor: b.fpsFloor };
  b.source = `${source}${b.status ? ` (${b.status})` : ''}`;
  return b;
}

const num = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * The scene kind to judge with: an explicit `sceneKind`, else the scenario's `scene`, else "look". Returns { kind, unknown }
 * (an unknown name is judged as look and reported as a warning).
 */
export function resolveSceneKind(sceneKind, scenario) {
  const asked = sceneKind ?? scenario?.scene ?? null;
  if (asked == null || asked === '') return { kind: DEFAULT_SCENE_KIND, unknown: null };
  return SCENE_KINDS.includes(asked) ? { kind: asked, unknown: null } : { kind: DEFAULT_SCENE_KIND, unknown: String(asked) };
}

/** The draw call, triangle and video memory limits for a quality preset and a scene kind (see the file format above). */
export function sceneLimits(budgets, kind = DEFAULT_SCENE_KIND, quality = null) {
  const preset = { ...(budgets.presets.default || {}), ...(budgets.presets[quality] || {}) };
  const scene = budgets.scenes?.[kind] || {};
  const out = {};
  for (const k of SCENE_KEYS) {
    // The look kind keeps the quality preset first (the older rule); every other kind's own block wins over the preset.
    out[k] = kind === DEFAULT_SCENE_KIND ? (preset[k] || scene[k]) : (scene[k] || preset[k]);
  }
  return out;
}

/** One limit check: value against {warn, fail}. Pushes into fails / warnings. */
function limit(name, value, lim, unit, fails, warnings) {
  if (!num(value) || !lim) return;
  if (num(lim.fail) && value > lim.fail) fails.push(`${name} ${Math.round(value * 10) / 10}${unit} is over the fail budget ${lim.fail}${unit}`);
  else if (num(lim.warn) && value > lim.warn) warnings.push(`${name} ${Math.round(value * 10) / 10}${unit} is over the warn budget ${lim.warn}${unit}`);
}

/**
 * Judge one page against the budgets. perf: the debug.perf block (or null); loadMs: page open to ready; quality: the
 * scenario's preset; sceneKind: "look" or "city" (default: scenario.scene, else look); scenario: its own `budget`
 * overrides. Returns { fails: [], warnings: [], frame, sceneKind } (frame = the
 * perfgate verdict, or null when no perf was measured).
 */
export function judgeBudgets({ perf = null, loadMs = null, quality = null, sceneKind = null, budgets = normalize(null), software = false, scenario = {} }) {
  const fails = [];
  const warnings = [];
  const o = scenario?.budget || {};
  const { kind, unknown } = resolveSceneKind(sceneKind, scenario);
  if (unknown) warnings.push(`scene kind "${unknown}" is not one of ${SCENE_KINDS.join(', ')}: judged as ${kind}`);
  const limits = sceneLimits(budgets, kind, quality);
  const lim = (k) => o[k] || limits[k];
  limit('load time', loadMs, o.loadMs || budgets.loadMs, ' ms', fails, warnings);
  let frame = null;
  if (perf) {
    if (!software) {
      const opts = { ...budgets.gateOpts, ...(o.frameMs ? { warnMs: o.frameMs.warn, failMs: o.frameMs.fail } : {}), ...(num(o.fpsFloor) ? { fpsFloor: o.fpsFloor } : {}) };
      frame = frameTimeGate(perf, opts);
      if (frame.level === 'fail') fails.push(`frame time: ${frame.message}`);
      else if (frame.level === 'warn') warnings.push(`frame time: ${frame.message}`);
    }
    limit('draw calls', perf.drawCalls, lim('drawCalls'), '', fails, warnings);
    limit('triangles', perf.triangles, lim('triangles'), '', fails, warnings);
    const gpuMB = num(perf.gpuMB) ? perf.gpuMB : num(perf.textureMB) ? perf.textureMB + (perf.renderbufferMB || 0) : null;
    limit('GPU memory', gpuMB, lim('gpuMB'), ' MB', fails, warnings);
  }
  return { fails, warnings, frame, sceneKind: kind };
}
