// P2-042: a car is stopped by the bollards at the Red Fort end of Chandni Chowk (a non-motorised zone in the day).
// Start: spawn pin chandni_bollards_nsm (--spawn), in a car on Netaji Subhash Marg southbound. The car drives the route
// chandni_bollards (real inputs) and turns into Chandni Chowk, where the route runs on 28 m past the bollard line. Pass:
// the drive gets stuck at the line (it never ends), the car's middle stops 1 to 5 m short of the line (the posts stop
// its nose), never past it, at rest; the line has no gap a car fits through (city_routes.json bollards.maxGapM under
// 1.3 m). Shot city_access_bollards at the chase camera.
const S = window.__sim;
const D = S.D;
const data = window.__scriptData || {};
const r = data.routes && data.routes.chandni_bollards;
if (!r || !r.bollards) return S.failed('needs city_routes.json with routes.chandni_bollards.bollards (node tools/fixtures/gen_city_routes.mjs)');
await S.until(() => D.state().world && D.state().world.ready, { sim: 10, label: 'the city ring is attached' });
if (D.state().world.spawn.pin !== 'chandni_bollards_nsm') return S.failed(`started at ${D.state().world.spawn.pin}, not chandni_bollards_nsm`);
const b = r.bollards;
// how far along the route a point lies (the nearest segment), and on which side of the line
const along = (pos) => {
  let best = { off: Infinity, s: 0 };
  let run = 0;
  for (let i = 1; i < r.points.length; i++) {
    const p = r.points[i - 1];
    const q = r.points[i];
    const dx = q[0] - p[0];
    const dz = q[2] - p[2];
    const L2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((pos[0] - p[0]) * dx + (pos[2] - p[2]) * dz) / L2));
    const off = Math.hypot(pos[0] - (p[0] + dx * t), pos[2] - (p[2] + dz * t));
    if (off < best.off) best = { off, s: run + t * Math.sqrt(L2) };
    run += Math.sqrt(L2);
  }
  return best;
};
let maxS = 0;
let stuck = null;
let res = null;
try {
  res = await S.drive(r.points, {
    kmh: 20, minKmh: 10, stuckS: 6, label: 'into Chandni Chowk',
    onFrame: (f) => { maxS = Math.max(maxS, along(f.pos).s); },
  });
} catch (e) {
  stuck = String(e && e.message ? e.message : e);
}
await S.waitSim(1);
const p = D.state().player;
const at = along(p.pos);
maxS = Math.max(maxS, at.s);
S.log('stopped', { stuck, res, pos: p.pos, speed: p.speed, s: at.s, maxS, line: b });
await S.shot('city_access_bollards');
const problems = [];
if (!stuck || !/stuck/.test(stuck)) problems.push(`the car was not stopped (${stuck || `the drive ended after ${res ? res.s.toFixed(1) : '?'} m`})`);
if (maxS > b.atM - 1) problems.push(`the car's middle reached ${maxS.toFixed(2)} m along the route, the bollard line is at ${b.atM} m`);
if (maxS < b.atM - 5) problems.push(`the car stopped ${(b.atM - maxS).toFixed(1)} m short of the bollard line: something else stopped it`);
if (Math.abs(p.speed) > 0.3) problems.push(`the car still moves (${p.speed.toFixed(2)} m/s)`);
if (!(b.maxGapM <= 1.3)) problems.push(`the line leaves a ${b.maxGapM} m gap`);
if (problems.length) return S.failed(problems.join('; '), { maxS, line: b });
return S.ok({ stoppedShortM: Math.round((b.atM - maxS) * 100) / 100, line: b.id, gapM: b.maxGapM });
