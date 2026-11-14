// P2-045: the route line keeps to the pieces the player's mode may use. Start: spawn pin chandni_chowk_east (--spawn),
// in the auto on Netaji Subhash Marg at the Red Fort end of Chandni Chowk. The target is a point on Chandni Chowk main
// road (car-free in the day: walkers, cycle rickshaws and emergency only). Pass: in the auto the route is found, uses
// only pieces an auto may use and ends short of the car-free street at the nearest point it may reach (clipped); the
// same request on foot (gps plan) walks in; F gets the player out and the line routes again for the walker within 1 s
// and now reaches the target piece; the ribbon is drawn while a target is set. Shots city_access_gps_auto (the auto's
// chase camera with the ribbon) and city_access_gps_foot.
const S = window.__sim;
const D = S.D;
const data = window.__scriptData || {};
const target = data.routes && data.routes.chandni_main_target;
if (!target) return S.failed('needs city_routes.json with routes.chandni_main_target');
await S.until(() => D.state().world && D.state().world.ready, { sim: 10, label: 'the city ring is attached' });
if (D.state().world.spawn.pin !== 'chandni_chowk_east') return S.failed(`started at ${D.state().world.spawn.pin}, not chandni_chowk_east`);
const problems = [];
const set = await D.gps('set', { to: target.at });
const r = set.route;
S.log('auto route', { mode: set.mode, ok: r.ok, clipped: r.clipped, lengthM: r.lengthM, pieces: r.pieces.length, closedToCars: r.closedToCars, end: r.end, targetModes: r.targetModes, reason: r.reason });
if (set.mode !== 'auto') problems.push(`the route is for ${set.mode}, not the auto`);
if (!r.ok) problems.push(`no auto route (${r.reason})`);
if (!r.allUsable || r.closedToCars > 0) problems.push(`the auto route uses ${r.closedToCars} car-free pieces (allUsable ${r.allUsable})`);
if (!r.clipped || r.targetModes.includes('auto')) problems.push(`the auto route is not cut short of the car-free target (clipped ${r.clipped}, target modes ${r.targetModes})`);
const endOff = Math.hypot(r.end[0] - target.at[0], r.end[2] - target.at[2]);
if (!(endOff <= target.nearestAutoM + 1)) problems.push(`the auto route ends ${endOff.toFixed(1)} m from the target, the nearest point an auto reaches is ${target.nearestAutoM} m`);
await S.waitSim(0.5);
await S.shot('city_access_gps_auto');
const p0 = D.state().player;
const walkPlan = await D.gps('plan', { from: p0.pos, to: target.at, mode: 'foot' });
S.log('foot plan', { ok: walkPlan.ok, clipped: walkPlan.clipped, lengthM: walkPlan.lengthM, closedToCars: walkPlan.closedToCars });
if (!walkPlan.ok || walkPlan.clipped || walkPlan.endPiece !== walkPlan.targetPiece) problems.push(`on foot the route does not reach the target piece (${walkPlan.reason})`);
// out of the auto: the line routes again for the walker
D.input('enter_exit', 1);
await S.until(() => D.state().player.mode === 'foot', { sim: 6, label: 'out of the auto' });
D.input('enter_exit', 0);
const tOut = D.clock().t;
let foot = await D.gps('info');
while (foot.mode !== 'foot' && D.clock().t - tOut < 3) {
  await S.waitSim(0.05);
  foot = await D.gps('info');
}
const lag = D.clock().t - tOut;
if (foot.mode !== 'foot') return S.failed(`the route line still routes for ${foot.mode} 3 s after getting out`);
S.log('foot route', { lagS: lag, ok: foot.route.ok, clipped: foot.route.clipped, lengthM: foot.route.lengthM, closedToCars: foot.route.closedToCars });
if (lag > 1.0) problems.push(`the walker's route came ${lag.toFixed(2)} s after getting out`);
if (!foot.route.ok || foot.route.clipped || !foot.route.allUsable) problems.push(`the walker's route does not reach the target (${foot.route.reason})`);
await S.waitSim(1);
await S.shot('city_access_gps_foot');
await D.gps('clear');
if (problems.length) return S.failed(problems.join('; '));
return S.ok({ autoM: Math.round(r.lengthM), autoEndOffM: Math.round(endOff * 10) / 10, footM: Math.round(foot.route.lengthM) });
