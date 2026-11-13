// Plan of the far float check (P1-029, follow-up of P1-008 and the physics bench FP1). Run by
// node harness/bench/arch.mjs far. The scene is game/bench/far/ (--arch=far): the production V2 car, the production
// on-foot character (with its humanoid) and a slow camera pan, each on the test course built 0, 7000, 8030, 9000 and
// 10000 m from the world origin on both axes (then 0 again as the noise floor of the pan). One CPU setup: the test runs
// inside the game over many frames (bench('run'), then bench('poll')).
import { runTest } from './physics.plan.mjs';

const r = (v, d = 2) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

const setups = [
  { id: 'far', option: 'FP1', group: 'far', tokens: 'far', gpu: false, driver: 'metal', paths: [], project: { physics: { '3d/physics_engine': 'Jolt Physics' } },
    note: 'production V2 car, on-foot character and a slow pan at 0, 7000, 8030, 9000 and 10000 m from the origin on both axes' },
];

const extra = {
  far: async (ctx, game, row) => {
    const res = await runTest(game, 'far', { dumpDir: process.env.FAR_DUMP_DIR || '' }, 1800000);
    row.test = 'far';
    row.results = res;
    row.line = summarise(res).lines.join(' | ');
  },
};

/** The table the decision line reads: one row per distance with the numbers that could degrade. */
export function summarise(res) {
  const offs = res.offsets.filter((o, i) => i < res.offsets.length - 1);
  const rows = offs.map((o) => {
    const v = o.vehicle;
    const c = o.character;
    return {
      offsetM: o.offsetM,
      wheelContactNoiseRestStdMm: v.rest.wheelContactNoiseStdMm,
      wheelContactNoiseRestP2pMm: v.rest.wheelContactNoiseP2pMm,
      bodyYRestP2pMm: v.rest.bodyYMm.p2p,
      bodyXRestP2pMm: v.rest.bodyXMm.p2p,
      bodyZRestP2pMm: v.rest.bodyZMm.p2p,
      wheelContactNoiseCruiseStdMm: v.cruise.wheelContactNoiseStdMm,
      bodyYCruiseP2pMm: v.cruise.bodyYMm.p2p,
      lateralCruiseP2pMm: v.cruise.lateralXMm.p2p,
      zeroTo100S: v.straight.zeroTo100S,
      brakeFrom100M: v.straight.brakeFrom100M,
      radius40M: v.turns[0].radiusM,
      radius80M: v.turns[1].radiusM,
      footWalkYP2pMm: c.flat.walkYP2pMm,
      footStandingP2pMm: c.flat.standingP2pMm,
      jogMeanMs: c.course[0].meanSpeed,
      sprintMeanMs: c.course[1].meanSpeed,
      snags: c.course[0].snags + c.course[1].snags,
    };
  });
  const lines = rows.map((x) => `${x.offsetM} m: wheel noise ${x.wheelContactNoiseRestStdMm} mm, body y ${x.bodyYRestP2pMm} mm, 0-100 ${x.zeroTo100S} s, brake ${x.brakeFrom100M} m, R ${x.radius40M}/${x.radius80M} m, foot y ${x.footWalkYP2pMm} mm`);
  return { rows, lines };
}

export default {
  name: 'far',
  scene: 'game/bench/far/far_bench.tscn',
  defaults: { resolution: '1280x720', windowMs: 0, warmMs: 0 },
  howMeasured: [
    'CPU and sim numbers only; no GPU time. The scene runs the game\'s own SimClock at time scale 4 for the vehicle and the character and at 1 for the pan.',
    'Vehicle: game/vehicles/vehicle.gd with the car tune, driven by throttle, brake and steer only. Character: game/characters/on_foot.gd with the humanoid, driven by a walk direction.',
    'Noise is the spread (std, peak to peak) of suspension length per wheel and of body position relative to the placed world origin.',
    'Pan: 24 frames, the camera 2 mm and 0.01 degrees further per frame, 320x180 grey frames; the first and the last offset are both 0, so their difference is the noise floor.',
  ],
  setups, notMeasured: [], extra,
  after(ctx, report) {
    const res = report.setups.far?.results;
    if (res) report.sections = { table: summarise(res).rows, pan: res.pan.perOffset.map((p) => ({ ...p })) };
    void r;
  },
};
