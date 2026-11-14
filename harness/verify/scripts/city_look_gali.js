// P1-026 look view gali_foot: Bittu in a gali off Chandni Chowk at the on-foot play camera. The auto is staged (teleport) on
// the main road at the gali's mouth, F gets the player out and he walks into the gali with real inputs (the same route
// as city_chandni_walk) and stops about 40 m in. The look proof holds the sim after this script.
const S = window.__sim;
const D = S.D;
const g = window.__scriptData.walks.chandni_gali;
const road = window.__scriptData.routes.chandni_main.points;
// road[6]: about 30 m east of the gali mouth
const at = road[6];
await D.teleport([at[0], at[1], at[2]]);
await S.waitSim(1);
D.input('enter_exit', 1);
await S.until(() => D.state().player.mode === 'foot', { sim: 6, label: 'out of the auto' });
D.input('enter_exit', 0);
await S.waitSim(0.6);
const out = D.state().player;
const car = out.pos;
// west along the road to the gali's line (the old detour south of the road went through a building corner, stuck at
// 53 of 165 m), then 40 m up the gali (point 6, its start, toward point 7)
const g6 = g.points[6];
const g7 = g.points[7];
const k = 40 / Math.hypot(g7[0] - g6[0], g7[2] - g6[2]);
const deep = [g6[0] + (g7[0] - g6[0]) * k, g6[1] + (g7[1] - g6[1]) * k, g6[2] + (g7[2] - g6[2]) * k];
// (out of the auto he stands at its back: step 2.5 m north, clear of it, first)
const pts = [car, [car[0] + 1, car[1], car[2] - 2.5], [g6[0], car[1], car[2] - 2.5], deep];
const res = await S.walk(pts, { gait: 'jog', label: 'into the gali', maxOffM: 5 });
await S.waitSim(1);
return S.ok({ walkedM: Math.round(res.s), end: res.end.pos });
