// FD0 free drive (scaffold): boot, drive north 100 m with real inputs, turn right toward east, stop. Inputs and sim waits only.
const S = window.__sim;
const D = S.D;
await D.load('scaffold');
await S.until(() => D.state().scene === 'scaffold', { sim: 5, label: 'scene loaded' });
await S.shot('FD0_ready');
const pl = () => D.state().player;
// Beat 1: north along the road strip.
D.input('throttle', 1);
await S.until(() => pl().pos[2] < -100, { sim: 30, label: 'reached 100 m north' });
const north = pl();
S.log('beat 1: 100 m north', north);
if (Math.abs(north.pos[0]) > 1) { D.input('throttle', 0); return S.failed(`left the road strip: x ${north.pos[0].toFixed(2)} m`); }
await S.shot('FD0_north');
// Beat 2: turn right toward east (heading PI/2, compass clockwise).
D.input('steer', 1);
await S.until(() => pl().heading > Math.PI / 2 - 0.1, { sim: 20, label: 'heading reaches east' });
D.input('steer', 0);
S.log('beat 2: facing east', pl());
await S.shot('FD0_east');
const xAtTurn = pl().pos[0];
await S.waitSim(1);
if (!(pl().pos[0] > xAtTurn + 5)) { D.input('throttle', 0); return S.failed(`not moving east after the turn: x ${xAtTurn.toFixed(1)} -> ${pl().pos[0].toFixed(1)}`); }
// Beat 3: stop.
D.input('throttle', -1);
await S.until(() => Math.abs(pl().speed) < 0.5, { sim: 15, label: 'car stops' });
D.input('throttle', 0);
S.log('beat 3: stopped', pl());
await S.shot('FD0_stopped');
return S.ok({ simSeconds: D.clock().t, end: pl() });
