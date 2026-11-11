// Plan of the physics architecture bench (P0-017; harness/design/ARCH_OPTIONS.md rows P, C, V, F, K, LANG, CB, TR, FP).
// Run by node harness/bench/arch.mjs physics. The scene is game/bench/physics/ (--arch=physics:<tokens>). Every setup
// is a CPU bench (gpu: false): the test runs inside the game over many frames (bench('run', {test}), then
// bench('poll')) and answers its own numbers; the runner adds a shot, the engine errors and the host load.
// The physics engine is the project setting physics/3d/physics_engine, set per run through the runner's
// override.cfg (`project`). Tests run at time scale 4 on the C1 clock, which the clock setup proves to give the
// same result as scale 1.
import { spawnSync } from 'node:child_process';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const JOLT = { physics: { '3d/physics_engine': 'Jolt Physics' } };
const GODOT = { physics: { '3d/physics_engine': 'GodotPhysics3D' } };
const base = { gpu: false, driver: 'metal', paths: [], project: JOLT };

const setups = [
  // P: the engines. 200 static and 30 dynamic bodies, 1000 rays per second.
  { ...base, id: 'engine_default', option: 'P (DEFAULT)', group: 'engines', tokens: 'engines', project: undefined, test: 'engines', note: 'the project as it is (physics/3d/physics_engine = DEFAULT): shows what DEFAULT resolves to' },
  { ...base, id: 'engine_jolt', option: 'P1', group: 'engines', tokens: 'engines', test: 'engines', note: 'Jolt Physics' },
  { ...base, id: 'engine_godot', option: 'P2', group: 'engines', tokens: 'engines', project: GODOT, test: 'engines', note: 'GodotPhysics3D' },
  // C: the sim clock
  { ...base, id: 'clock', option: 'C1', group: 'clock', tokens: 'clock', test: 'clock', note: 'hold, time scale 0.25, 1 and 4, three replays each; C2 as the contrast' },
  // V: vehicles on the KEEP tune
  { ...base, id: 'vehicle_v1', option: 'V1', group: 'vehicle', tokens: 'vehicle+v1', test: 'vehicle', opts: { kind: 'v1' }, note: 'VehicleBody3D, KEEP tune' },
  { ...base, id: 'vehicle_v2', option: 'V2', group: 'vehicle', tokens: 'vehicle+v2', test: 'vehicle', opts: { kind: 'v2' }, note: 'our raycast vehicle on a RigidBody3D, KEEP tune' },
  { ...base, id: 'vehicle_auto', option: 'V2 (3 wheels)', group: 'vehicle', tokens: 'vehicle+auto', test: 'vehicle', opts: { kind: 'auto' }, note: 'three wheel auto on V2, a first-guess tune' },
  // K: colliders per 250 m tile
  { ...base, id: 'colliders', option: 'K1, K3', group: 'colliders', tokens: 'colliders', test: 'colliders', note: 'K1 one triangle mesh of everything against K3 surfaces plus one shell per building; 200 loads off the main thread' },
  // F: on foot
  { ...base, id: 'onfoot', option: 'F1', group: 'onfoot', tokens: 'onfoot', test: 'onfoot', note: 'CharacterBody3D capsule with a step-up: kerb, stairs, ramp at walk, jog and sprint' },
  // CB: combat
  { ...base, id: 'combat', option: 'CB1', group: 'combat', tokens: 'combat', test: 'combat', note: 'hitscan rays against 100 characters with three hit zones; 10 ragdolls on kerbs and stairs' },
  // LANG, TR: scripting cost
  { ...base, id: 'agents', option: 'LANG1', group: 'scripting', tokens: 'agents', test: 'agents', note: 'GDScript tick of 200 pedestrians and 30 traffic agents on packed arrays, one ray each' },
  { ...base, id: 'traffic_v2', option: 'TR2', group: 'scripting', tokens: 'traffic+v2', test: 'traffic', opts: { kind: 'v2' }, note: '30 physics traffic cars on V2' },
  { ...base, id: 'traffic_v1', option: 'TR2 (V1)', group: 'scripting', tokens: 'traffic+v1', test: 'traffic', opts: { kind: 'v1' }, note: '30 physics traffic cars on VehicleBody3D, for the engine-side cost per vehicle' },
  // FP: the same runs 7000 m from the origin on both axes
  { ...base, id: 'far_vehicle_v2', option: 'FP1', group: 'far', tokens: 'vehicle+v2+far', test: 'vehicle', opts: { kind: 'v2' }, note: 'V2 at 7000 m from the origin on both axes' },
  { ...base, id: 'far_vehicle_v1', option: 'FP1', group: 'far', tokens: 'vehicle+v1+far', test: 'vehicle', opts: { kind: 'v1' }, note: 'V1 at 7000 m' },
  { ...base, id: 'far_onfoot', option: 'FP1', group: 'far', tokens: 'onfoot+far', test: 'onfoot', note: 'the character runs at 7000 m' },
  // Not asked for, cheap to add: the vehicle, character and ragdoll runs on Godot Physics
  { ...base, id: 'colliders_sep_thread', option: 'K1, K3 (physics thread)', group: 'p2', must: false, tokens: 'colliders', project: { physics: { '3d/physics_engine': 'Jolt Physics', '3d/run_on_separate_thread': true } }, test: 'colliders', opts: { loads: 20 }, note: 'the collider loads with physics/3d/run_on_separate_thread on: where the mesh build lands then' },
  { ...base, id: 'vehicle_v2_godot', option: 'V2 on P2', group: 'p2', must: false, tokens: 'vehicle+v2', project: GODOT, test: 'vehicle', opts: { kind: 'v2' }, note: 'V2 on GodotPhysics3D' },
  { ...base, id: 'onfoot_godot', option: 'F1 on P2', group: 'p2', must: false, tokens: 'onfoot', project: GODOT, test: 'onfoot', note: 'the character runs on GodotPhysics3D' },
  { ...base, id: 'combat_godot', option: 'CB1 on P2', group: 'p2', must: false, tokens: 'combat', project: GODOT, test: 'combat', note: 'hitscan and ragdolls on GodotPhysics3D' },
];

const notMeasured = [
  { id: 'n1_n2_navmesh', option: 'N1, N2', reason: 'if time item, did not fit the time box (one build round and one fix round went to the eight MUST items)', estimate: 'ARCH_OPTIONS.md: N1 1 to 5 ms to add a region and no bake at load; N2 80 to 400 ms per 250 m tile on a thread' },
  { id: 'k2_heightmap', option: 'K2', reason: 'if time item, did not fit the time box; it also only applies with terrain option TF2 (a grid ground)', estimate: 'ARCH_OPTIONS.md: 3 to 10 ms build, under 1 MB' },
  { id: 'lang2_gdextension', option: 'LANG2', reason: 'if time item, not built: scons is not on this Mac and a godot-cpp build in a venv under tools/ did not fit the time box. The LANG1 numbers decide whether it is needed at all', estimate: 'ARCH_OPTIONS.md: 10 to 50 times faster in the ported loop' },
  { id: 'c3_kinematic', option: 'C3', reason: 'not a bench item (ARCH_OPTIONS.md lists no bench for it)', estimate: 'no cost' },
];

/** Starts a test in the bench scene and waits for its result. */
export async function runTest(game, test, opts = {}, timeoutMs = 900000) {
  await game.client.call('bench', 'run', { test, ...opts });
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await sleep(400);
    const p = await game.client.call('bench', 'poll', { test });
    if (p.done) return p.result;
    const err = game.log.find((l) => /^SCRIPT ERROR/.test(l));
    if (err) throw new Error(`test ${test} stopped on a script error: ${game.log.slice(game.log.indexOf(err), game.log.indexOf(err) + 3).join(' | ')}`);
    if (game.client.closed) throw new Error(`the game closed during test ${test}`);
  }
  throw new Error(`test ${test} did not finish in ${timeoutMs} ms`);
}

const r = (v, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

/** One line for the runner's log per test. */
export function line(test, res) {
  try {
    if (test === 'engines') return `${res.engine}: step p95 ${res.step.busy.p95} ms (p50 ${res.step.busy.p50}), 1000 rays ${res.rays.msPer1000.p50} ms`;
    if (test === 'clock') return `C1 holds: ${res.c1.holds} (hold ${res.c1.hold.ticksToStop} ticks, spread ${res.c1.scale.maxSpreadMm} mm)`;
    if (test === 'vehicle') return `${res.kind}: 0-100 ${res.straight.zeroTo100S} s, top ${res.straight.topSpeedKmh} km/h, brake ${res.straight.brakeDistanceM} m, R ${res.turns.map((t) => t.radiusM).join('/')} m, ${res.cpu.scriptUsPerTick} us`;
    if (test === 'colliders') return `attach K1 ${res.k1.attachCallMs.p50} ms, K3 ${res.k3.attachCallMs.p50} ms (thread ${res.k1.threadMs.p50} / ${res.k3.threadMs.p50} ms), max error K1 ${res.k1.ownerRule.maxErrorM} K3 ${res.k3.ownerRule.maxErrorM} m, ${res.k1.memory?.mbPerCollider} / ${res.k3.memory?.mbPerCollider} MB`;
    if (test === 'onfoot') return `${res.speeds.map((s) => `${s.name} ${s.meanSpeed} m/s (${s.worstErrorPct}%, ${s.snags} snags)`).join(', ')}`;
    if (test === 'combat') return `1000 rays ${res.rays.msPer1000.p50} ms, ragdolls step p95 ${res.ragdolls.step.p95} ms, stable ${res.ragdolls.stable}`;
    if (test === 'agents') return `all ${res.all.ms.p50} ms (p95 ${res.all.ms.p95}), quarter ${res.quarter.ms.p50} ms (p95 ${res.quarter.ms.p95})`;
    if (test === 'traffic') return `${res.kind} x${res.cars}: script ${res.scriptMsPerTick} ms, step p50 ${res.step.p50} ms, per car ${res.perCarMs} ms`;
  } catch { /* a missing field only loses the log line */ }
  return '';
}

/** Resident memory of a process in MB (ps), or null. */
function rssMB(pid) {
  const out = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).stdout;
  const kb = Number(String(out || '').trim());
  return Number.isFinite(kb) && kb > 0 ? kb / 1024 : null;
}

/** Collider memory: attach `copies` colliders of a kind, keep them, and read the growth of the process. */
async function colliderMemory(game, kind, copies) {
  await sleep(500);
  const before = rssMB(game.proc.pid);
  const res = await runTest(game, 'colliders', { memory: kind, copies });
  await sleep(500);
  const after = rssMB(game.proc.pid);
  return {
    copies, triangles: res.triangles, faceDataMB: res.faceDataMB, processGrowthMB: r(after - before, 1), mbPerCollider: r((after - before) / copies, 2),
    note: 'growth of the game process (resident memory from ps) after attaching the copies, divided by the copies; it holds the vertex array copy and the engine\'s mesh tree',
  };
}

const extra = {};
for (const s of setups) {
  extra[s.id] = async (ctx, game, row) => {
    let memory = null;
    if (s.test === 'colliders') {
      // memory first, in the fresh process: later loads free memory that the process keeps, which would hide growth
      await runTest(game, 'colliders', { memory: 'prepare' });
      memory = { k3: await colliderMemory(game, 'k3', 8) };
      await runTest(game, 'colliders', { memory: 'free' });
      memory.k1 = await colliderMemory(game, 'k1', 4);
      await runTest(game, 'colliders', { memory: 'free' });
    }
    const res = await runTest(game, s.test, s.opts || {});
    if (s.test === 'colliders') {
      res.k3.memory = memory.k3;
      res.k1.memory = memory.k1;
      const errors = game.log.filter((l) => /^(ERROR|SCRIPT ERROR|USER ERROR)/.test(l)).length;
      res.offMainThread.engineErrorLines = errors;
      res.offMainThread.safe = errors === 0 && res.offMainThread.rayFailures === 0;
      if (res.separateThread) {
        res.offMainThread.buildRunsOn = 'the physics thread (physics/3d/run_on_separate_thread): the attach call returns at once, and the frame after it waits for the build (worstFrameAfterAttachMs)';
      } else if (res.k1.threadMs.p50 < 1 && res.k1.attachCallMs.p50 > 5) {
        res.offMainThread.buildRunsOn = 'the main thread: the shape calls made on the worker thread return in microseconds (they are queued), and the mesh tree is built when the body is attached (attachCallMs)';
      } else {
        res.offMainThread.buildRunsOn = 'the worker thread';
      }
    }
    row.test = s.test;
    row.results = res;
    row.line = line(s.test, res);
  };
}

const pick = (report, id) => (report.setups[id] && !report.setups[id].failed ? report.setups[id].results : null);

/** Per cent difference of b against a. */
const pct = (a, b) => (typeof a === 'number' && typeof b === 'number' && a !== 0 ? r(((b - a) / Math.abs(a)) * 100, 1) : null);

function vehicleRow(v) {
  if (!v) return null;
  const s = v.straight;
  return {
    engine: v.engine, zeroTo100S: s.zeroTo100S, zeroTo60S: s.zeroTo60S, topSpeedKmh: s.topSpeedKmh, brakeFromKmh: s.brakeFromKmh, brakeDistanceM: s.brakeDistanceM,
    turns: v.turns.map((t) => ({ targetKmh: t.targetKmh, heldKmh: t.heldKmh, radiusM: t.radiusM, lateralG: t.lateralG, slipAngleDeg: t.slipAngleDeg, maxRollDeg: t.maxRollDeg })),
    kerbSquare: v.kerbSquare, kerbSide: v.kerbSide, flyover: v.flyover, junction: v.junction,
    latencyTicks: s.latencyTicksToVelocity, latencyTicksToPosition: s.latencyTicksToPosition, scriptUsPerTick: v.cpu.scriptUsPerTick,
    restNoise: { bodyYP2pMm: v.rest.bodyYMm.p2p, wheelContactNoiseStdMm: v.rest.wheelContactNoiseStdMm, wheelContactNoiseP2pMm: v.rest.wheelContactNoiseP2pMm, rideHeightM: v.rest.rideHeightM },
    cruiseNoise: { bodyYStdMm: v.cruise.bodyYMm.std, bodyYP2pMm: v.cruise.bodyYMm.p2p, lateralXP2pMm: v.cruise.lateralXMm.p2p, wheelContactNoiseStdMm: v.cruise.wheelContactNoiseStdMm, wheelContactNoiseP2pMm: v.cruise.wheelContactNoiseP2pMm },
  };
}

/** The sections P0-020 reads: one per MUST item, built from the setup rows. */
export function summarise(report) {
  const out = {};
  const eD = pick(report, 'engine_default');
  const eJ = pick(report, 'engine_jolt');
  const eG = pick(report, 'engine_godot');
  const eng = (e) => (e ? { engine: e.engine, stepMs: e.step.busy, stepMsIdle: e.step.idle, activeBodies: e.bodies, raysMsPer1000: e.rays.msPer1000, raysMsPerFrameAt1000PerSecond: e.rays.msPerFrameAt1000PerSecond, rayHitShare: e.rays.hitShare } : null);
  out.engines = {
    defaultResolvesTo: eD ? eD.engine : null, projectSetting: report.setups.engine_default?.scene?.engineSetting ?? null,
    p1Jolt: eng(eJ), p2GodotPhysics: eng(eG), projectDefault: eng(eD),
    stepP95RatioGodotOverJolt: eJ && eG ? r(eG.step.busy.p95 / eJ.step.busy.p95, 2) : null,
    load: '200 static bodies and 30 dynamic bodies (boxes, spheres, capsules) that never sleep and are thrown again every 3 s; 1000 rays per batch',
  };
  const c = pick(report, 'clock');
  out.clock = c ? { c1Holds: c.c1.holds, verdict: c.verdict, hold: c.c1.hold, timeScale: c.c1.scale, c2Contrast: c.c2 } : null;
  const v1 = pick(report, 'vehicle_v1');
  const v2 = pick(report, 'vehicle_v2');
  const va = pick(report, 'vehicle_auto');
  const t2 = pick(report, 'traffic_v2');
  const t1 = pick(report, 'traffic_v1');
  out.vehicles = {
    tune: v2 ? v2.tune : v1 ? v1.tune : null, autoTune: va ? va.tune : null,
    v1VehicleBody3D: vehicleRow(v1), v2RaycastVehicle: vehicleRow(v2), v2ThreeWheelAuto: vehicleRow(va),
    cpuMsPerVehicle: {
      v1: t1 ? { scriptMs: t1.scriptMsPerCar, engineMs: t1.engineMsPerCar, totalMs: t1.perCarMs } : null,
      v2: t2 ? { scriptMs: t2.scriptMsPerCar, engineMs: t2.engineMsPerCar, totalMs: t2.perCarMs } : null,
      note: 'from the 30 car traffic runs: script time of sim_step per car, plus the growth of the physics step per car',
    },
    v2OnGodotPhysics: vehicleRow(pick(report, 'vehicle_v2_godot')),
    notes: [
      v1 && v2 ? `V1 rides ${r((v2.rest.rideHeightM - v1.rest.rideHeightM) * 1000, 0)} mm lower than V2 and the tune (${v1.rest.rideHeightM} m against ${v2.rest.rideHeightM} m, design ${v2.rideHeightDesign} m): VehicleBody3D starts its wheel ray one radius above the connection point and scales the hit distance, so its suspension length is not the real one` : null,
      v1 && v2 ? `input to motion: V1 ${v1.straight.latencyTicksToVelocity} ticks, V2 ${v2.straight.latencyTicksToVelocity} tick` : null,
      'V1 has no side stiffness per axle (the tune has 1.2 front, 1.1 rear) and is built for four wheel layouts; the three wheel auto runs on V2 only',
      'the flyover has one open 4 cm joint: a wheel ray that falls into it loses contact for a tick (airborneTicks, bottomedTicks), which depends on where the wheel is when it crosses',
    ].filter(Boolean),
  };
  const k = pick(report, 'colliders');
  const kt = pick(report, 'colliders_sep_thread');
  const colliderRow = (c) => ({
    triangles: c.triangles, boxShapes: c.boxShapes, loads: c.loads, threadMs: c.threadMs, attachCallMs: c.attachCallMs, worstFrameAfterAttachMs: c.worstFrameAfterAttachMs,
    memoryMBPerTile: c.memory?.mbPerCollider ?? null, faceDataMB: c.faceDataMB, rayFailures: c.rayFailures, ownerRule: c.ownerRule,
    serverWay: c.serverWay, chunks16: c.chunks16 ?? null,
  });
  out.colliders = k ? {
    tile: k.tile, k1: colliderRow(k.k1), k3: colliderRow(k.k3), offMainThread: k.offMainThread, ownerRuleTargetM: 0.05,
    withPhysicsOnItsOwnThread: kt ? {
      k1: { attachCallMs: kt.k1.attachCallMs, worstFrameAfterAttachMs: kt.k1.worstFrameAfterAttachMs },
      k3: { attachCallMs: kt.k3.attachCallMs, worstFrameAfterAttachMs: kt.k3.worstFrameAfterAttachMs, chunks16: kt.k3.chunks16 },
      offMainThread: kt.offMainThread,
    } : null,
  } : null;
  const f = pick(report, 'onfoot');
  out.onFoot = f ? { speeds: f.speeds, passes: f.passes, capsule: f.capsule, cpuUsPerCharacterTick: f.cpuUsPerCharacterTick, onGodotPhysics: pick(report, 'onfoot_godot')?.speeds ?? null } : null;
  const cb = pick(report, 'combat');
  const cbg = pick(report, 'combat_godot');
  out.combat = cb ? { rays: cb.rays, hitZones: cb.zones, moveCharactersMsPerTick: cb.moveMsPerTick, ragdolls: cb.ragdolls, onGodotPhysics: cbg ? { rays: cbg.rays, ragdolls: cbg.ragdolls } : null } : null;
  const a = pick(report, 'agents');
  out.scripting = {
    lang1AgentTick: a ? { agents: a.agents, allAtOnce: a.all, quarterPerTick: a.quarter, perAgentUs: a.perAgentUs, note: a.note } : null,
    tr2ThirtyPhysicsCars: t2 ? { cars: t2.cars, scriptMsPerTick: t2.scriptMsPerTick, stepMs: t2.step, stepMsWithoutCars: t2.stepBase, totalMsPerTick: t2.totalMsPerTick, perCarMs: t2.perCarMs, heldKmh: t2.heldKmh } : null,
    tr2OnVehicleBody3D: t1 ? { cars: t1.cars, scriptMsPerTick: t1.scriptMsPerTick, stepMs: t1.step, stepMsWithoutCars: t1.stepBase, totalMsPerTick: t1.totalMsPerTick, perCarMs: t1.perCarMs, heldKmh: t1.heldKmh } : null,
  };
  const fv2 = pick(report, 'far_vehicle_v2');
  const fv1 = pick(report, 'far_vehicle_v1');
  const ff = pick(report, 'far_onfoot');
  const farVehicle = (near, far) => (near && far ? {
    origin: vehicleRow(near), at7000m: vehicleRow(far),
    wheelContactNoiseStdMm: { rest: [near.rest.wheelContactNoiseStdMm, far.rest.wheelContactNoiseStdMm], cruise: [near.cruise.wheelContactNoiseStdMm, far.cruise.wheelContactNoiseStdMm] },
    bodyYJitterP2pMm: { rest: [near.rest.bodyYMm.p2p, far.rest.bodyYMm.p2p], cruise: [near.cruise.bodyYMm.p2p, far.cruise.bodyYMm.p2p] },
    horizontalJitterAtRestP2pMm: { x: [near.rest.bodyXMm.p2p, far.rest.bodyXMm.p2p], z: [near.rest.bodyZMm.p2p, far.rest.bodyZMm.p2p] },
    changePct: { zeroTo100S: pct(near.straight.zeroTo100S, far.straight.zeroTo100S), topSpeedKmh: pct(near.straight.topSpeedKmh, far.straight.topSpeedKmh), brakeDistanceM: pct(near.straight.brakeDistanceM, far.straight.brakeDistanceM), radiusM: near.turns.map((t, i) => pct(t.radiusM, far.turns[i]?.radiusM)) },
  } : null);
  out.floatPrecision = {
    note: 'pairs are [at the origin, 7000 m from the origin on both axes]; a 32-bit float steps by 0.49 mm at 7000 m',
    v2: farVehicle(v2, fv2), v1: farVehicle(v1, fv1),
    character: f && ff ? { origin: f.speeds, at7000m: ff.speeds, flatWalkYJitterP2pMm: [f.flatJitter?.yP2pMm ?? null, ff.flatJitter?.yP2pMm ?? null], standingJitterP2pMm: [f.flatJitter?.standingP2pMm ?? null, ff.flatJitter?.standingP2pMm ?? null], passes: [f.passes, ff.passes] } : null,
  };
  return out;
}

export default {
  name: 'physics',
  scene: 'game/bench/physics/physics_bench.tscn',
  defaults: { resolution: '1280x720', windowMs: 0, warmMs: 0 },
  howMeasured: [
    'Every number is CPU time or a sim result; no GPU number is in this report, so the 120 fps window cap and the ballast do not matter here.',
    'Physics step time: a probe node with the last physics priority marks the end of all script callbacks; the next physics frame of the same rendered frame starts right after the server step, so the gap is the step plus the body state sync. Timing windows run at time scale 4 (two or more physics frames per rendered frame).',
    'Script times are Time.get_ticks_usec() around the measured code.',
    'Tests run on the C1 clock at time scale 4 (the clock setup proves scale 0.25, 1 and 4 give the same result). Inputs are throttle, brake and steer for vehicles and a walk direction for characters; nothing writes positions except staging at the start of a probe.',
    'The physics engine is set per run with the project setting physics/3d/physics_engine (override.cfg written by the runner). Every setup except engine_default and the P2 rows runs on Jolt Physics.',
  ],
  setups, notMeasured, extra,
  after(ctx, report) {
    report.sections = summarise(report);
    const engines = {};
    for (const [id, row] of Object.entries(report.setups)) if (row.scene?.engine) engines[id] = row.scene.engine;
    report.physicsEngines = {
      offered: ['Jolt Physics', 'GodotPhysics3D'], projectSetting: report.setups.engine_default?.scene?.engineSetting ?? 'DEFAULT',
      defaultResolvesTo: report.sections.engines.defaultResolvesTo, usedBySetup: engines,
    };
  },
};
