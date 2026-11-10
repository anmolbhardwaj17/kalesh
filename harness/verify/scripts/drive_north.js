// Input only: full throttle for 3 s of sim from heading 0 drives north. z falls by over 10 m, x stays under 0.5 m.
const S = window.__sim;
const D = S.D;
await D.load('scaffold');
await S.frames(2);
const p0 = D.state().player;
if (Math.abs(p0.pos[0]) > 1e-6 || Math.abs(p0.pos[2]) > 1e-6 || Math.abs(p0.heading) > 1e-6) return S.failed(`start is not the origin facing north: ${JSON.stringify(p0)}`);
await S.press('throttle', 1, 3);
await S.shot('drive_north');
const p1 = D.state().player;
const dz = p1.pos[2] - p0.pos[2];
S.log('after 3 s throttle', { x: p1.pos[0], z: p1.pos[2], heading: p1.heading, speed: p1.speed });
const problems = [];
if (!(dz < -10)) problems.push(`z fell only ${(-dz).toFixed(2)} m (want over 10 m, north is -Z)`);
if (!(Math.abs(p1.pos[0]) < 0.5)) problems.push(`x drifted ${p1.pos[0].toFixed(3)} m (want under 0.5 m)`);
return problems.length ? S.failed(problems.join('; ')) : S.ok({ z: p1.pos[2], x: p1.pos[0] });
