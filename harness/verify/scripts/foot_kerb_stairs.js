// P1-022 feel probe: the course's kerb and stair lane at walk, jog and sprint: 10 kerb slabs (0.15 m), a 12 step stair
// (0.18 m risers) to a landing and a 1 in 8 ramp, north and south, each from three start offsets so the steps are met
// at every phase. Under 5 percent speed loss in every run (distance along the lane in the window over the time), no
// snag (no 0.2 s slower than 80 percent of the gait), every run comes out of its window. Sim ticks; input only.
const S = window.__sim;
const D = S.D;
await D.load('course');
D.timeScale(8);
await S.frames(2);
const problems = [];
const table = {};
for (const gait of ['walk', 'jog', 'sprint']) {
  for (const run of ['kerbs_north', 'kerbs_south', 'stairs_north', 'stairs_south']) {
    const r = await D.foot('run', { test: 'kerbs', gait, run });
    let loss = -Infinity;
    for (const x of r.runs) {
      loss = Math.max(loss, x.lossPct);
      if (!x.finished) problems.push(`${gait} ${run} offset ${x.offset}: stuck at ${JSON.stringify(x.trace && x.trace.slice(-1))}`);
      else if (x.snags) problems.push(`${gait} ${run} offset ${x.offset}: snag (slowest 0.2 s ${x.slowestWindowMs} m/s)`);
      if (!(x.lossPct < 5)) problems.push(`${gait} ${run} offset ${x.offset}: ${x.lossPct} percent speed loss`);
    }
    table[`${gait} ${run}`] = { worstLossPct: loss, meanMs: r.runs.map((x) => x.meanMs), steps: r.runs.map((x) => x.steps) };
  }
}
D.timeScale(1);
S.log('kerbs and stairs', table);
return problems.length ? S.failed(problems.slice(0, 8).join('; '), table) : S.ok(table);
