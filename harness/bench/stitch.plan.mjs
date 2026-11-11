// Plan of the stitch bench scene (P0-029; harness/design/ARCH_OPTIONS.md rows X, FP, DC, SC, FL, LP). Run by
// node harness/bench/arch.mjs stitch, which harness/bench/stitch.mjs starts after it has baked the stitched world
// (game/bench/stitch/gen/: 250 m T1 tiles and index.json; every count in harness/reports/arch/stitch_bake.json).
// The scene is game/bench/stitch/ (--arch=stitch). One setup: it loads the world, takes one shot per camera pose
// (tops look straight down with north up, eye poses are at player height), reads the landmark pins and the node
// transforms back from the engine, and runs the FP1 pan: 24 frames of a slow pan at the district farthest from the
// world origin, then the same frames with the world moved so that this place sits at the engine origin. before()
// folds the bake's numbers into the report, so harness/reports/arch/stitch.json holds everything P0-020 needs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GEN = path.join(ROOT, 'game', 'bench', 'stitch', 'gen');
const BAKE = path.join(ROOT, 'harness', 'reports', 'arch', 'stitch_bake.json');
const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

const setups = [
  { id: 'world', option: 'X1 FP1 DC3 SC1 FL1 LP2', group: 'world', tokens: 'world', gpu: false, driver: 'metal', paths: [], shot: false, resolution: '1600x1000', note: 'the pilot districts at their offsets with the edge bands, the three authored connectors and every port closure' },
];

const raw = async (file) => (await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true }));

/** Mean absolute difference (0 to 255) and the share of pixels that differ by more than 16 in any channel. */
function diff(a, b) {
  let sum = 0;
  let changed = 0;
  const n = a.data.length / 3;
  for (let i = 0; i < a.data.length; i += 3) {
    const d0 = Math.abs(a.data[i] - b.data[i]);
    const d1 = Math.abs(a.data[i + 1] - b.data[i + 1]);
    const d2 = Math.abs(a.data[i + 2] - b.data[i + 2]);
    sum += d0 + d1 + d2;
    if (d0 > 16 || d1 > 16 || d2 > 16) changed++;
  }
  return { mean: sum / (n * 3), changedShare: changed / n };
}

const stats = (rows) => ({
  frames: rows.length,
  meanAbs: round(rows.reduce((s, r) => s + r.mean, 0) / rows.length, 4), meanAbsMin: round(Math.min(...rows.map((r) => r.mean)), 4), meanAbsMax: round(Math.max(...rows.map((r) => r.mean)), 4),
  changedShare: round(rows.reduce((s, r) => s + r.changedShare, 0) / rows.length, 6), changedShareMax: round(Math.max(...rows.map((r) => r.changedShare)), 6),
});

/** The difference of two frames, eight times stronger, as a picture to look at. */
async function diffPicture(a, b, file) {
  const out = Buffer.alloc(a.data.length);
  for (let i = 0; i < a.data.length; i++) out[i] = Math.min(255, Math.abs(a.data[i] - b.data[i]) * 8);
  await sharp(out, { raw: { width: a.info.width, height: a.info.height, channels: 3 } }).png().toFile(file);
}

const extra = {
  world: async (ctx, game, row) => {
    const index = readJson(path.join(GEN, 'index.json'));
    if (!index) throw new Error('no baked world: run node harness/bench/stitch.mjs (it bakes, then starts this bench)');
    const call = async (cmd, opts = {}) => {
      const r = await game.client.call('bench', cmd, opts);
      if (r && r.error) throw new Error(r.error);
      return r;
    };
    const info = await call('info');
    if (info.error) throw new Error(info.error);
    row.scene = info;
    row.shots = [];
    for (const pose of index.poses) {
      await call('pose', { name: pose.name });
      await game.client.call('frames', 12);
      const file = path.join(ctx.shotDir, `${pose.name}.png`);
      await game.client.call('shot', file);
      row.shots.push({ pose: pose.name, kind: pose.kind, file: path.relative(ROOT, file), note: pose.note });
    }
    // landmarks as the engine has them: tile origin (a node position) plus the pin's own vertices
    const pins = (await call('pins')).pins;
    const byName = new Map(pins.map((p) => [p.name, p]));
    let max = 0;
    let missing = 0;
    const perLandmark = {};
    for (const want of index.pins) {
      const got = byName.get(want.name);
      if (!got) {
        missing++;
        continue;
      }
      const d = Math.hypot(got.x - want.x, got.z - want.z);
      max = Math.max(max, d);
      perLandmark[want.landmark] = Math.max(perLandmark[want.landmark] ?? 0, d);
    }
    row.landmarksInEngine = { pins: index.pins.length, missing, maxErrorM: round(max, 5), perLandmarkMaxM: Object.fromEntries(Object.entries(perLandmark).map(([k, v]) => [k, round(v, 5)])), note: 'the pin position in the running game (node position of the tile plus the mesh centre, 32-bit floats) against district offset plus projection' };
    row.transforms = await call('transforms');

    // FP1: the slow pan at the far district, then the same frames with that place at the engine origin
    if (index.pan) {
      const pan = index.pan;
      const dir = path.join(ctx.shotDir, 'pan');
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const modes = [
        { id: 'far', x: 0, z: 0, what: 'the world as baked: the camera is at its true distance from the origin' },
        { id: 'near', x: pan.tileOrigin[0], z: pan.tileOrigin[2], what: 'the world moved so that the camera tile sits at the engine origin' },
        { id: 'near2', x: pan.tileOrigin[0] + 500, z: pan.tileOrigin[2] - 250, what: 'the world moved by another 500 m and 250 m: the yardstick for what a move alone changes (shadow texel phase)' },
      ];
      const frames = {};
      for (const m of modes) {
        await call('rebase', { x: m.x, z: m.z });
        frames[m.id] = [];
        for (let k = 0; k < pan.frames; k++) {
          await call('pan', { step: k });
          await game.client.call('frames', 3);
          const file = path.join(dir, `${m.id}_${String(k).padStart(2, '0')}.png`);
          await game.client.call('shot', file);
          frames[m.id].push(file);
        }
      }
      await call('rebase', { x: 0, z: 0 });
      const consecutive = {};
      const cross = { farVsNear: [], nearVsNear2: [] };
      let worst = null;
      let prev = {};
      for (let k = 0; k < pan.frames; k++) {
        const now = {};
        for (const m of modes) now[m.id] = await raw(frames[m.id][k]);
        for (const m of modes) if (k > 0) (consecutive[m.id] ??= []).push(diff(prev[m.id], now[m.id]));
        const fn = diff(now.far, now.near);
        cross.farVsNear.push(fn);
        cross.nearVsNear2.push(diff(now.near, now.near2));
        if (!worst || fn.mean > worst.mean) worst = { mean: fn.mean, k, a: now.far, b: now.near };
        prev = now;
      }
      const diffFile = path.join(ctx.shotDir, 'pan_far_vs_near_diff.png');
      await diffPicture(worst.a, worst.b, diffFile);
      const c = Object.fromEntries(Object.entries(consecutive).map(([k, v]) => [k, stats(v)]));
      const fvn = stats(cross.farVsNear);
      const nvn = stats(cross.nearVsNear2);
      // shimmer shows as frames that change more from one to the next at the far place than at the origin
      const extraMotion = round(c.far.meanAbs - Math.max(c.near.meanAbs, c.near2.meanAbs), 4);
      const extraStill = round(fvn.meanAbs - nvn.meanAbs, 4);
      const visible = extraMotion > 0.05 || fvn.changedShare > Math.max(nvn.changedShare * 3, 0.002);
      // an even pan changes every frame by the same amount: the spread of the frame to frame change is the jitter
      const spread = (x) => round((x.meanAbsMax - x.meanAbsMin) / x.meanAbs, 2);
      row.fp1Pan = {
        pose: pan.pose, district: pan.district, distanceFromOriginM: pan.distanceFromOriginM, frames: pan.frames, stepMm: round(Math.hypot(...pan.stepM) * 1000, 2), yawStepDeg: pan.yawStepDeg,
        modes: modes.map((m) => ({ id: m.id, movedBy: [m.x, m.z], what: m.what })),
        frameToFrame: c, farAgainstNear: fvn, nearAgainstNear2: nvn, extraChangeFrameToFrameAtFar: extraMotion, extraDifferenceFarOverYardstick: extraStill,
        stepSpread: { far: spread(c.far), near: spread(c.near), near2: spread(c.near2), note: '(largest less smallest frame to frame change) over the mean: 0 is a perfectly even pan' },
        shimmerVisible: visible,
        reading: visible
          ? `the far frames differ from the frames at the engine origin by more than a move of the world alone explains: shimmer at ${pan.distanceFromOriginM} m from the origin`
          : `no shimmer or shadow crawl to see at ${pan.distanceFromOriginM} m from the origin: frame k at the far place differs from frame k at the engine origin by less than two moved worlds differ from each other. What can be measured: the pan is less even at the far place (frame to frame change ${c.far.meanAbsMin} to ${c.far.meanAbsMax} against ${c.near.meanAbsMin} to ${c.near.meanAbsMax} near the origin), because a 2 mm camera step lands on a 0.24 mm grid there. That is under a pixel at this step size`,
        files: { frames: path.relative(ROOT, dir), first: path.relative(ROOT, frames.far[0]), last: path.relative(ROOT, frames.far[pan.frames - 1]), worstDifference: path.relative(ROOT, diffFile), worstFrame: worst.k },
        note: 'frameToFrame: mean absolute difference (0 to 255) between one pan frame and the next, per mode. farAgainstNear: frame k at the far place against frame k with the world moved to the engine origin; nearAgainstNear2 is the same comparison between two moved worlds, both near the origin. changedShare is the share of pixels that differ by more than 16 of 255. The worst far against near pair is saved eight times stronger as a picture.',
      };
    }
    await call('pose', { name: 'top_all' });
    row.line = `${info.tiles} tiles, ${info.triangles} triangles, ${row.shots.length} shots, pins max ${row.landmarksInEngine.maxErrorM} m (${missing} missing), nodes not identity ${row.transforms.notIdentity} of ${row.transforms.checked}${row.fp1Pan ? `, pan far frame to frame ${row.fp1Pan.frameToFrame.far.meanAbs} (near ${row.fp1Pan.frameToFrame.near.meanAbs}), far against near ${row.fp1Pan.farAgainstNear.meanAbs} (yardstick ${row.fp1Pan.nearAgainstNear2.meanAbs}), shimmer ${row.fp1Pan.shimmerVisible ? 'VISIBLE' : 'none'}` : ''}`;
  },
};

export default {
  name: 'stitch',
  scene: 'game/bench/stitch/',
  defaults: { resolution: '1600x1000', windowMs: 1000, warmMs: 500 },
  howMeasured: 'The stitch code (tools/bake/stitch/, TypeScript, run by node harness/bench/stitch.mjs) bakes the whole stitched world twice in one Node process; bake.ms is the second run. Counts are read from the finished data: ports from the roads cut at the clip line, closures one per port, connector grades and clearances from the lane model that built them, landmark positions from the T1 tile bytes. The Godot run loads the 250 m tiles (each placed by its origin only), takes one shot per pose, reads the landmark pins and node transforms back from the engine, and runs a slow pan of 24 frames at the far district three times: as baked, and twice with the whole world moved so that the place sits near the engine origin.',
  setups,
  extra,
  before: async (ctx, report) => {
    const bake = readJson(BAKE);
    if (!bake) throw new Error('harness/reports/arch/stitch_bake.json is missing: run node harness/bench/stitch.mjs');
    const { writtenBy, at, node, ...rest } = bake;
    Object.assign(report, rest, { bake: { ...rest.bake, at, node, writtenBy } });
  },
  // the counts the acceptance names, in one place: the bake's numbers and what the engine read back
  after: async (ctx, report) => {
    const w = report.setups?.world;
    const c = report.checks;
    report.summary = {
      openBoundaryPorts: c.openBoundaryPorts, portsWaitingForAConnector: c.portsWaitingForAConnector,
      connectorGradeViolations: c.connectorGradeViolations, connectorRadiusViolations: c.connectorRadiusViolations, connectorViolationsByClass: c.connectorViolationsByClass,
      sc2: report.connectors.sc2?.tried ? { ratio: report.connectors.sc2.ratio, radiusViolations: report.connectors.sc2.radius.violations, gradeViolations: report.connectors.sc2.grade?.violations ?? null, sunk: report.connectors.sc2.sunk ?? null, firstRatioWithASunkCrossStreet: (report.connectors.sc2.sweep || []).find((t) => t.sunk > 0)?.ratio ?? null } : null,
      overlappingClipPolygons: c.overlappingClipPolygons, minGapM: c.minGapM,
      landmarkErrorMaxM: { tiles: c.landmarkErrorMaxM, engine: w?.landmarksInEngine?.maxErrorM ?? null },
      relativeLayout: { maxDistanceErrorM: c.relativeLayout.maxDistanceErrorM, maxBearingErrorDeg: c.relativeLayout.maxBearingErrorDeg, redFortNorthEastOfJamaMasjid: c.relativeLayout.redFortNorthEastOfJamaMasjid },
      rotation: { districtTransformsNotPureTranslation: c.rotation.notPureTranslation, mirrored: c.rotation.mirrored, forbiddenKeysInData: c.rotation.forbiddenKeysInData.length, engineNodesNotIdentity: w?.transforms?.notIdentity ?? null, engineNodesChecked: w?.transforms?.checked ?? null },
      x1AgainstX2MaxM: report.coordinates.maxDifferenceM, x1AgainstX2PerDistrictM: Object.fromEntries(report.coordinates.perDistrict.map((d) => [d.district, d.maxM])),
      portsPerDistrict: Object.fromEntries(Object.entries(report.clip.perDistrict).map(([id, v]) => [id, { dc1: v.dc1.ports, dc2: v.dc2.ports, dc1ByClass: v.dc1.byClass, dc2ByClass: v.dc2.byClass }])),
      portsTotal: { dc1: report.clip.totals.dc1Ports, dc2: report.clip.totals.dc2Ports },
      shareOfPortsClosedAutomatically: report.filler.totals.autoShare, shareNeedingAnAuthoredConnector: report.filler.totals.needAuthoredShare,
      edgeBandShareOfDistrictTileBytes: report.clip.dc3.share,
      bakeMs: report.bake.ms.total,
      fp1: w?.fp1Pan ? { district: w.fp1Pan.district, distanceFromOriginM: w.fp1Pan.distanceFromOriginM, shimmerVisible: w.fp1Pan.shimmerVisible, reading: w.fp1Pan.reading } : null,
      shots: (w?.shots || []).map((s) => s.file),
    };
  },
  notMeasured: [
    { id: 'filler_blocks', option: 'FL1', reason: 'generated filler blocks from area profiles along connectors were not built: the area profile generator does not exist yet. The bench has filler ground, the river band and the port closures', estimate: 'ARCH_OPTIONS puts a filler tile at 20 to 40 percent of a district tile' },
    { id: 'fl2', option: 'FL2', reason: 'open land only was not built as its own setup: it is FL1 without the street nets, and the report lists every port by closure kind, so the FL2 count can be read from it (every street net port becomes a gate, a wall or a loop)', estimate: 'no extra cost' },
    { id: 'sc3', option: 'SC3', reason: 'drawing connectors in the map inspector is a later editor feature', estimate: 'L' },
    { id: 'one_graph', option: 'SC1', reason: 'a connector and the district road it meets are two meshes that end on the same port; the lane model was not run over a district and its connectors as one graph', estimate: 'the lane model work of the map repair pilot' },
    { id: 'ito_district', option: 'MC', reason: 'the ITO pilot district is not placed in this bench (the task names Connaught Place with India Gate, Chandni Chowk and Laxmi Nagar); its data is used for the SC2 trial only', estimate: 'the same steps as the four frames here' },
  ],
};
