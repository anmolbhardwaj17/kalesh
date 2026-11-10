// Input only: throttle plus steer right from heading 0. The heading grows (clockwise, toward east) and x becomes positive.
const S = window.__sim;
const D = S.D;
await D.load('scaffold');
await S.frames(2);
const p0 = D.state().player;
D.input('throttle', 1);
D.input('steer', 1);
await S.waitSim(1.5);
D.input('throttle', 0);
D.input('steer', 0);
await S.shot('drive_turn_right');
const p1 = D.state().player;
S.log('after 1.5 s throttle and steer right', { x: p1.pos[0], z: p1.pos[2], heading: p1.heading });
const problems = [];
if (!(p1.heading > p0.heading + 0.1)) problems.push(`heading did not grow: ${p1.heading.toFixed(3)} rad`);
if (!(p1.pos[0] > 1)) problems.push(`x is ${p1.pos[0].toFixed(2)} m, want positive (east is +X)`);
if (!(p1.pos[2] < 0)) problems.push(`z is ${p1.pos[2].toFixed(2)} m, the car should have moved north before curving east`);
return problems.length ? S.failed(problems.join('; ')) : S.ok({ heading: p1.heading, x: p1.pos[0], z: p1.pos[2] });
