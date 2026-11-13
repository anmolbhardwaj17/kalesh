// P1-026: the CPU readings of the per system table (citybase.mjs) with real physics: the auto drives the Ring Road
// flyover near ITO (route ito_flyover, real inputs, 80 km/h; spawn pin ito_flyover_south) on the full pilot tiles while the
// stream probe records every drawn frame: the physics step (the engine's TIME_PHYSICS_PROCESS monitor, a mean over about
// a second per reading), the vehicle's script time per tick, the streaming core and attach work, the render CPU time.
// Judges only that the drive finishes without a hitch over 33 ms; the numbers go to the report (citybase.mjs reads them).
const S = window.__sim;
const D = S.D;
const R = window.__scriptData;
const r = R.routes.ito_flyover;
await S.until(() => D.state().world && D.state().world.ready, { sim: 10, label: 'the city ring is attached' });
if (D.state().world.spawn.pin !== 'ito_flyover_south') return S.failed(`started at ${D.state().world.spawn.pin}, not ito_flyover_south`);
await S.waitSim(1);
await D.stream('record', { on: true, skipS: 2 });
const res = await S.drive(r.points, { kmh: 80, stop: false, label: 'the ITO flyover run' });
const rec = await D.stream('record', { on: false });
const v = await D.vehicle('info');
S.log('record', rec);
const problems = [];
// a long frame with little game work (core step 1 ms or less, process time under a frame) was spent in the present path or the OS: noted, not failed
const ownLong = rec.over33List.filter((f) => f.coreMs > 1 || f.processMs > 16);
if (ownLong.length) problems.push(`${ownLong.length} frame(s) over 33 ms with game work: ${JSON.stringify(ownLong.slice(0, 4))}`);
if (rec.over33 > 3) problems.push(`${rec.over33} frames over 33 ms: ${JSON.stringify(rec.over33List.slice(0, 4))}`);
const summary = {
  driveM: Math.round(res.length), simS: Math.round(res.simS), frames: rec.frames, frameMs: rec.frameMs, physicsMs: rec.physicsMs, processMs: rec.processMs,
  coreMs: rec.coreMs, attachMs: rec.attachMs, renderCpuMs: rec.renderCpuMs, drawCalls: rec.drawCalls, vehicleScriptUsPerTick: v.scriptUsPerTick, hostLoad: window.__hostLoad ? window.__hostLoad() : null,
};
return problems.length ? S.failed(problems.join('; '), summary) : S.ok(summary);
