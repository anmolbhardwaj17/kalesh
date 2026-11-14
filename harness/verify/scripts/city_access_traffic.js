// P2-045: traffic keeps to the access modes near Chandni Chowk. Start: spawn pin chandni_chowk_east (--spawn), the
// auto at rest on Netaji Subhash Marg at the Red Fort end of Chandni Chowk. The traffic stand-in starts (traffic('start'):
// 30 cars, autos and scooters within 260 m, on lane pieces of the loaded tiles) and runs 45 s of sim. Every 3 s the
// script reads each agent's piece and that piece's modes (independent of the game's own audit). Pass: no car or auto
// ever on a piece closed to it or to cars; the game's audit agrees (bad 0, no car or auto entry into a car-free piece);
// scooters rode two-wheeler galis; the agents moved on (median over 60 m). Shot city_access_traffic at 20 s.
const S = window.__sim;
const D = S.D;
await S.until(() => D.state().world && D.state().world.ready, { sim: 10, label: 'the city ring is attached' });
if (D.state().world.spawn.pin !== 'chandni_chowk_east') return S.failed(`started at ${D.state().world.spawn.pin}, not chandni_chowk_east`);
const start = await D.traffic('start', { count: 30, radius: 260, seed: 5 });
S.log('start', { count: start.count, modes: start.agents.map((a) => a.mode).join(' ') });
if (start.count < 25) return S.failed(`only ${start.count} of 30 agents put down`);
const problems = [];
let samples = 0;
let galiScooters = 0;
for (let k = 1; k <= 15; k++) {
  await S.waitSim(3);
  const info = await D.traffic('info');
  for (const a of info.agents) {
    samples++;
    if (!a.modes.includes(a.mode)) problems.push(`${k * 3} s: agent ${a.id} (${a.mode}) on ${a.piece}, open to ${a.modes}`);
    if ((a.mode === 'car' || a.mode === 'auto') && !a.modes.includes('car')) problems.push(`${k * 3} s: ${a.mode} ${a.id} on car-free ${a.piece}`);
    if (a.mode === 'two_wheeler' && !a.modes.includes('car')) galiScooters++;
  }
  if (k === 7) await S.shot('city_access_traffic');
}
const info = await D.traffic('info');
const au = info.audit;
const dists = info.agents.map((a) => a.dist).sort((a, b) => a - b);
const median = dists[Math.floor(dists.length / 2)];
S.log('audit', { ticks: au.ticks, checks: au.checks, bad: au.bad, entries: au.entries, closedToCars: au.closedToCars, spawned: au.spawned, putDown: au.putDown, samples, galiScooters, medianM: median });
if (au.bad !== 0) problems.push(`the game's audit counts ${au.bad} agent ticks on closed pieces (${JSON.stringify(au.badList)})`);
if ((au.closedToCars.car || 0) + (au.closedToCars.auto || 0) > 0) problems.push(`cars or autos entered car-free pieces (${JSON.stringify(au.closedToCars)})`);
if (!((au.closedToCars.two_wheeler || 0) > 0)) problems.push('no scooter rode a two-wheeler gali');
if (!(median > 60)) problems.push(`the agents hardly moved (median ${median} m in 45 s)`);
await D.traffic('stop');
if (problems.length) return S.failed(problems.slice(0, 8).join('; '));
return S.ok({ samples, galiScooters, entries: au.entries, closedToCars: au.closedToCars, medianM: Math.round(median) });
