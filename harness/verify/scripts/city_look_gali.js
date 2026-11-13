// P1-026 look view gali_foot: Bittu in a gali off Chandni Chowk at the on-foot play camera. The auto is staged (teleport) on
// the main road at the gali's mouth, F gets the player out and he walks into the gali with real inputs (the same route
// as city_chandni_walk) and stops about 60 m in. The look proof holds the sim after this script.
const S = window.__sim;
const D = S.D;
const g = window.__scriptData.walks.chandni_gali;
const road = window.__scriptData.routes.chandni_main.points;
const at = road[3];
await D.teleport([at[0], at[1], at[2]]);
await S.waitSim(1);
D.input('enter_exit', 1);
await S.until(() => D.state().player.mode === 'foot', { sim: 6, label: 'out of the auto' });
D.input('enter_exit', 0);
await S.waitSim(0.6);
const out = D.state().player;
const car = out.pos;
const rear = [g.points[0][0] + 1.5, g.points[0][1], g.points[0][2] + 6];
const pts = [car, [car[0], car[1], car[2] + 6], rear, g.points[0], g.points[1], g.points[2]];
const res = await S.walk(pts, { gait: 'jog', label: 'into the gali', maxOffM: 5 });
await S.waitSim(1);
return S.ok({ walkedM: Math.round(res.s), end: res.end.pos });
