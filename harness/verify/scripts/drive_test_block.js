// P1-018: the game starts on the committed test block (--tiles=test: 9 baked tiles of the ITO flyover and Connaught Place),
// the car stands on a lane of it, and a throttle drive moves it along its heading on the block's ground. Input only.
const S = window.__sim;
const D = S.D;
await S.frames(3);
const st = D.state();
const w = st.world;
const problems = [];
if (!w) return S.failed(`state().world is empty: the block did not load (args ${JSON.stringify(st.args || null)})`);
S.log('block', w);
if (w.tiles !== 9) problems.push(`${w.tiles} tiles loaded, the test block has 9`);
if (w.errors.length) problems.push(`tile errors: ${w.errors.join('; ')}`);
if (!(w.colliderTriangles > 50000)) problems.push(`only ${w.colliderTriangles} collider triangles`);
if (!(w.lanes > 500)) problems.push(`only ${w.lanes} lane pieces`);
const p0 = st.player;
if (!(p0.pos[1] > 150 && p0.pos[1] < 300)) problems.push(`the car stands at y ${p0.pos[1]}, not on the Delhi ground (about 206 m)`);
if (!(Math.abs(p0.pos[0]) > 100 || Math.abs(p0.pos[2]) > 100)) problems.push(`the car is still near the origin: ${JSON.stringify(p0.pos)}`);
await S.press('throttle', 1, 3);
await S.shot('drive_test_block');
const p1 = D.state().player;
const d = Math.hypot(p1.pos[0] - p0.pos[0], p1.pos[2] - p0.pos[2]);
S.log('drove', { from: p0.pos, to: p1.pos, d, heading: p1.heading, speed: p1.speed });
if (!(d > 10)) problems.push(`the car moved only ${d.toFixed(2)} m in 3 s of throttle`);
const along = (p1.pos[0] - p0.pos[0]) * Math.sin(p0.heading) - (p1.pos[2] - p0.pos[2]) * Math.cos(p0.heading);
if (!(along > 0.95 * d)) problems.push(`the car left its heading: ${along.toFixed(2)} m along of ${d.toFixed(2)} m`);
if (Math.abs(p1.pos[1] - p0.pos[1]) > 0.01) problems.push(`the car changed height: ${p0.pos[1]} to ${p1.pos[1]}`);
return problems.length ? S.failed(problems.join('; ')) : S.ok({ tiles: w.tiles, loadMs: w.loadMs, moved: d });
