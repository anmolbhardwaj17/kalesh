#!/usr/bin/env node
// City perf base line (P1-026): collects the readings of the city perf scenarios and look views into one table, prints the
// per system numbers against the signed `systems` and `world` blocks of perf_budgets.json and writes them to
// perf_budgets.json `measured.city_base`. P2 (dressing) is judged against it.
//   node harness/bin/citybase.mjs [--no-write]
// Inputs (verify.mjs overwrites harness/reports/latest.json on every run, so every run of this tool first copies what
// latest.json holds of city_path_* and city_base_systems into harness/reports/city_base/raw.json, which accumulates):
//   node harness/bin/verify.mjs --only "city_path_*,city_base_systems" --no-checks --no-build   then run this tool
//   node harness/bin/lookproof.mjs --set city_afternoon --perf --scene-kind city --query light=afternoon (and city_golden: light=golden)
//   node harness/bin/lookproof.mjs --set city_systems --group city_systems --perf --scene-kind city --query light=afternoon
// The GPU cost of every number is the ballast cost (a ballast frame minus the ballast alone, ballast.mjs). Per system GPU
// ms are differences of ablation views (stream layers hides the drawn meshes of buildings or ground_roads): buildings = all
// minus no_buildings, roads and ground = all minus no_roads, the look stack (sky, shadows, SSAO, grade) = sky_only.
import fs from 'node:fs';
import path from 'node:path';
import { R, readJSON, writeJSON, nowISO, git } from './lib.mjs';

const WRITE = !process.argv.includes('--no-write');
const RAW = R('harness', 'reports', 'city_base', 'raw.json');
const BUDGETS = R('harness', 'verify', 'perf_budgets.json');
const LP = R('harness', 'look_proof');
const r2 = (v) => (v == null || Number.isNaN(v) ? null : Math.round(v * 100) / 100);
const fmt = (v, d = 2) => (v == null ? '-' : Number(v).toFixed(d));

const raw = readJSON(RAW, { paths: {}, systems: null });
const latest = readJSON(R('harness', 'reports', 'latest.json'), null);
if (latest?.scenarios) {
  for (const [name, sc] of Object.entries(latest.scenarios)) {
    const ps = latest.perfSummary?.[name];
    if (/^city_path_/.test(name) && sc.summary && ps) {
      raw.paths[name] = { at: latest.finishedAt, commit: latest.commit, ok: sc.ok, gate: ps.gateReason || ps.frameGate, gpuCostMs: ps.gpuCost?.ms ?? null, cpuP95: ps.cpuMs?.p95 ?? null, frameP95: ps.frameP95 ?? null, fps: ps.fps ?? null,
        drawCalls: ps.drawCalls, triangles: ps.triangles, gpuMB: ps.gpuMB, load: ps.load, bound: ps.bound, script: sc.summary };
    }
    if (name === 'city_base_systems' && sc.summary) raw.systems = { at: latest.finishedAt, commit: latest.commit, ok: sc.ok, load: latest.perfSummary?.[name]?.load || null, ...sc.summary };
  }
  writeJSON(RAW, raw);
}

const budgets = readJSON(BUDGETS, {});
const sets = {};
for (const s of ['city_afternoon', 'city_golden', 'city_systems']) sets[s] = readJSON(path.join(LP, s, 'perf.json'), null);

const lines = [];
const out = (s = '') => { lines.push(s); console.log(s); };
const frameWarn = budgets.frameMs?.warn ?? 10;
const frameFail = budgets.frameMs?.fail ?? 12;
const city = budgets.scenes?.city || {};

// ---- 1. the vehicle paths
out('CITY PERF BASE (P1-026)');
out('');
out(`1. Fixed vehicle paths (scripted drive, perf window with the GPU ballast; frame p95 warn ${frameWarn} fail ${frameFail} ms, draw calls warn ${city.drawCalls?.warn} fail ${city.drawCalls?.fail})`);
out('   path           km/h  gpu cost ms  cpu p95  frame p95  fps    calls   Mtris  gpuMB  load        gate');
const pathRows = [];
for (const [name, p] of Object.entries(raw.paths).sort()) {
  const m = name.match(/^city_path_(.+)_(\d+)$/);
  pathRows.push({ name, path: m[1], kmh: Number(m[2]), ...p });
  out(`   ${m[1].padEnd(14)} ${String(m[2]).padStart(4)}  ${fmt(p.gpuCostMs).padStart(11)}  ${fmt(p.cpuP95).padStart(7)}  ${fmt(p.frameP95).padStart(9)}  ${fmt(p.fps, 0).padStart(4)}  ${String(p.drawCalls).padStart(6)}  ${fmt(p.triangles / 1e6).padStart(5)}  ${fmt(p.gpuMB, 0).padStart(5)}  ${p.load ? `${p.load.avg1}/${p.load.cores}` : '-'}  ${p.gate}`);
}
const worst = (k) => pathRows.reduce((a, r) => (r[k] != null && (a == null || r[k] > a) ? r[k] : a), null);
const misses = pathRows.filter((r) => r.frameP95 > frameWarn || r.drawCalls > (city.drawCalls?.warn ?? 1e9) || /fail|warn/i.test(String(r.gate)) && !/^ok/i.test(String(r.gate)));

// ---- 2. look views of the city
out('');
out('2. City look views (lookproof --perf --scene-kind city)');
const viewRows = {};
for (const s of ['city_afternoon', 'city_golden']) {
  const f = sets[s];
  if (!f) { out(`   ${s}: no perf.json`); continue; }
  out(`   ${s}: ${f.machine || '?'}; ${f.renderer || '?'} (${f.renderingDriver || '?'}), ${f.gpuAdapter || '?'}, Godot ${f.godotVersion || '?'}; host load ${f.load?.avg1}/${f.load?.cores}`);
  viewRows[s] = {};
  for (const [v, row] of Object.entries(f.rows || {})) {
    viewRows[s][v] = { gpuCostMs: row.gpuCostMs, frameP95: row.frameP95, drawCalls: row.drawCalls, trianglesM: r2(row.triangles / 1e6), verdict: row.verdict, hostLoad: row.hostLoad };
    out(`     ${v.padEnd(20)} gpu cost ${fmt(row.gpuCostMs).padStart(5)} ms  frame p95 ${fmt(row.frameP95).padStart(5)}  ${String(row.drawCalls).padStart(5)} calls  ${fmt(row.triangles / 1e6).padStart(5)} Mtris  ${row.verdict}`);
  }
}

// ---- 3. the per system table
out('');
out('3. Per system readings against the signed systems block (ms)');
const ab = sets.city_systems?.rows || null;
const sysGpu = {};
if (ab) {
  for (const [tag, label] of [['cp', 'Connaught Place street eye'], ['busy', 'Chandni Chowk 40 m']]) {
    // the median of the ballast frame cost: its p95 jumps by about 1 ms from run to run, the p50 by about 0.3 ms
    const g = (k) => ab[`sys_${tag}_${k}`]?.frameCostP50 ?? null;
    const all = g('all'); const noB = g('no_buildings'); const noR = g('no_roads'); const sky = g('sky_only');
    const bld = all != null && noB != null ? r2(all - noB) : null;
    const rg = all != null && noR != null ? r2(all - noR) : null;
    sysGpu[tag] = {
      view: label, total: all, buildings: bld, roadsGround: rg,
      // the look stack is what is left of the whole frame (a near empty frame with only the sky reads wrong with the ballast, sky_only is kept for the record)
      look: all != null ? r2(all - Math.max(0, bld ?? 0) - Math.max(0, rg ?? 0)) : null, skyOnlyRaw: sky,
      drawCalls: ab[`sys_${tag}_all`]?.drawCalls ?? null, hostLoad: ab[`sys_${tag}_all`]?.hostLoad ?? null,
    };
  }
}
const mx = (k) => { const v = Object.values(sysGpu).map((s) => s[k]).filter((x) => x != null); return v.length ? Math.max(...v) : null; };
const sys = raw.systems;
const budget = budgets.systems || {};
const rows = [];
const row = (system, side, measured, line, how) => { rows.push({ system, side, measuredMs: measured, budgetMs: line, how }); out(`   ${(side + ' ' + system).padEnd(30)} ${fmt(measured).padStart(6)}  line ${fmt(line, 1).padStart(4)}  ${measured != null && line != null ? (measured <= line ? 'inside' : 'OVER') : '-'}  ${how}`); };
row('look stack', 'GPU', mx('look'), budget.gpuMs?.look?.ms, 'sky, sun shadows, SSAO, glow, grade: the whole frame less the two systems below, worst of 2 views');
row('roads and ground', 'GPU', mx('roadsGround'), budgets.world?.gpuMs?.roadsAndGround, 'ablation (frame cost p50): all minus ground_roads hidden, worst of 2 views');
row('buildings (shells)', 'GPU', mx('buildings'), budgets.world?.gpuMs?.generatedBuildings, 'ablation (frame cost p50): all minus buildings hidden, worst of 2 views; shells only, no kit modules yet; reads 0 within noise');
row('city total (3 systems)', 'GPU', mx('total'), budget.gpuMs?.total?.ms, 'all visible, worst of 2 views; line is the total GPU line');
row('city, worst path', 'GPU', worst('gpuCostMs'), budget.gpuMs?.total?.ms, 'worst of the 12 city_path scenarios');
row('streaming attach', 'CPU', sys?.attachMs?.p99 ?? null, budget.cpuMs?.streamingAttach?.ms, 'attach queue work per frame, p99, real drive 80 km/h');
row('streaming core', 'CPU', sys?.coreMs?.p99 ?? null, budget.cpuMs?.streamingAttach?.ms, 'whole streaming step per frame, p99');
row('physics step', 'CPU', sys?.physicsMs?.p50 ?? null, budget.cpuMs?.physics?.ms, 'TIME_PHYSICS_PROCESS monitor, p50 (refreshes once a second), real drive');
row('vehicles', 'CPU', sys?.vehicleScriptUsPerTick != null ? r2(sys.vehicleScriptUsPerTick / 1000) : null, budget.cpuMs?.vehicles?.ms, 'player vehicle script per tick, mean over the run (one car, no traffic yet)');
row('render CPU', 'CPU', sys?.renderCpuMs?.p95 ?? null, budget.cpuMs?.render?.ms, 'render setup and draw list CPU, p95, real drive');
out(`   (CPU readings from city_base_systems: ${sys ? `${sys.driveM} m of the ITO flyover in ${sys.simS} s, ${sys.frames} frames, frame p95 ${fmt(sys.frameMs?.p95)} ms, host load ${sys.hostLoad ? `${sys.hostLoad.avg1}/${sys.hostLoad.cores}` : '?'}` : 'not run'})`);
for (const [tag, s] of Object.entries(sysGpu)) out(`   ablation ${s.view}: all ${fmt(s.total)}, buildings ${fmt(s.buildings)}, roads+ground ${fmt(s.roadsGround)}, look stack ${fmt(s.look)} ms (sky-only run read ${fmt(s.skyOnlyRaw)}, not used), ${s.drawCalls} draw calls, host load ${s.hostLoad ? `${s.hostLoad.avg1}/${s.hostLoad.cores}` : '?'}`);

out('');
out(`Misses against the signed lines: ${misses.length ? misses.map((r) => `${r.name} (frame p95 ${fmt(r.frameP95)} ms, ${r.drawCalls} calls, ${r.gate})`).join('; ') : 'none (every path inside frame p95 warn 10 ms and city draw calls warn 2,500)'}`);

if (WRITE) {
  const b = readJSON(BUDGETS, {});
  const f = sets.city_afternoon;
  b.measured = b.measured || {};
  b.measured.city_base = {
    _doc: 'City perf base line (P1-026, tools: harness/bin/citybase.mjs). The full pilot tiles under the default look (stylised B), afternoon, shell buildings and no dressing, kit, crowds or traffic: P2 is judged against these numbers. GPU cost is the ballast cost (ballast.mjs).',
    at: nowISO(), commit: git('rev-parse --short HEAD'),
    machine: f?.machine || null, renderer: f?.renderer || null, renderingDriver: f?.renderingDriver || null, gpuAdapter: f?.gpuAdapter || null, godotVersion: f?.godotVersion || null,
    hostLoad: { paths: pathRows.map((r) => r.load?.avg1).filter((x) => x != null).sort((a, c) => a - c).filter((_, i, a) => i === 0 || i === a.length - 1), looks: f?.load || null, cores: f?.load?.cores || null },
    paths: Object.fromEntries(pathRows.map((r) => [`${r.path}_${r.kmh}`, { gpuCostMs: r.gpuCostMs, cpuP95Ms: r.cpuP95, frameP95Ms: r.frameP95, fps: r.fps, drawCalls: r.drawCalls, trianglesM: r2(r.triangles / 1e6), gpuMB: r2(r.gpuMB), hostLoad: r.load?.avg1 ?? null, gate: r.gate, streamAttachP99Ms: r.script?.attachMs?.p99 ?? null, laps: r.script?.laps ?? null }])),
    pathsWorst: { gpuCostMs: worst('gpuCostMs'), frameP95Ms: worst('frameP95'), drawCalls: worst('drawCalls'), trianglesM: r2((worst('triangles') || 0) / 1e6), gpuMB: r2(worst('gpuMB')) },
    views: viewRows,
    systems: { gpuMs: sysGpu, table: rows, cpuSource: sys ? { driveM: sys.driveM, simS: sys.simS, frames: sys.frames, frameMs: sys.frameMs, hostLoad: sys.hostLoad } : null },
    misses: misses.map((r) => ({ path: r.name, frameP95Ms: r.frameP95, drawCalls: r.drawCalls, gate: r.gate })),
  };
  writeJSON(BUDGETS, b);
  out(`wrote measured.city_base to ${path.relative(process.cwd(), BUDGETS)}`);
}
