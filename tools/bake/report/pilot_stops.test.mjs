// The bake stops before it writes a tile when the map is wrong (P1-017 acceptance): a deliberately mirrored block (a
// scale of -1 on the centre block's frame, what the old game did with worldGroup.scale.x = -1) stops at rule
// R-STITCH before any step; a broken lane (a joint taken out of the lane model) stops at LANES-01. Each test bakes
// into its own temp folders through a changed copy of districts.json, so the stage files in data/pilot_centre/ and
// game/world/tiles/ are never touched. The broken lane test needs the pinned pilot data and skips without it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../cli.ts';
import { bake, offlineNet } from '../main.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const districts = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'harness/data/districts.json'), 'utf8'));
const pilotDir = path.join(ROOT, districts().stages.pilot.dataDir);
const missing = ['osm.json', 'overture_buildings.json', 'gedtm30_window.json'].filter((f) => !fs.existsSync(path.join(pilotDir, f)));

/** A temp stage: its own data folder (relative to the repo, as districts.json holds it), tile folder and report. */
function tempStage(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bake-stop-${name}-`));
  const d = districts();
  d.stages.pilot = { ...d.stages.pilot, dataDir: path.relative(ROOT, path.join(dir, 'data')), tiles: path.relative(ROOT, path.join(dir, 'tiles')) };
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  // the warm start of a partial bake, when a whole bake left its lane conflicts
  const conflicts = path.join(pilotDir, 'lane_conflicts.json');
  if (fs.existsSync(conflicts)) fs.copyFileSync(conflicts, path.join(dir, 'data', 'lane_conflicts.json'));
  return { dir, districts: d, healthFile: path.join(dir, 'report', 'health.json'), tiles: path.join(dir, 'tiles') };
}

async function stopped(args, opts) {
  let error = null;
  try {
    await bake(parseArgs(args), { root: ROOT, net: offlineNet, today: '2026-11-12', log: () => {}, ...opts });
  } catch (e) {
    error = e;
  }
  return { error, health: JSON.parse(fs.readFileSync(opts.healthFile, 'utf8')) };
}

const written = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.ktl') || f === 'index.json') : []);

describe('the bake stops before tiles', () => {
  it('a mirrored block stops at R-STITCH before the first step, with the reason', async () => {
    const t = tempStage('mirror');
    const centre = t.districts.blocks.find((b) => b.id === 'centre');
    centre.scale = { x: -1, z: 1 };
    const { error, health } = await stopped(['pilot', '--offline'], { districts: t.districts, healthFile: t.healthFile });
    expect(error?.name === 'BakeStop' || error?.constructor?.name === 'BakeStop').toBe(true);
    expect(health.stoppedBeforeTiles).toBe(true);
    expect(health.steps).toEqual([]);
    const failed = health.invariants.filter((i) => !i.ok);
    expect(failed.map((i) => i.id)).toContain('R-STITCH-01.data');
    expect(failed.find((i) => i.id === 'R-STITCH-01.data').detail).toMatch(/scale.*mirror/);
    expect(error.message).toContain('bake stopped before writing tiles');
    expect(written(t.tiles)).toEqual([]);
  });

  it.skipIf(missing.length > 0)(`a broken lane stops at LANES-01 before the tile step, with the reason${missing.length ? ` (skipped: pilot data missing: ${missing.join(', ')})` : ''}`, async () => {
    const t = tempStage('lane');
    let removed = null;
    // a partial bake of one tile: the same steps as a whole bake, one build each
    const { error, health } = await stopped(['pilot', '--tiles', '0_-8', '--offline'], {
      districts: t.districts, healthFile: t.healthFile, benchDir: path.join(t.dir, 'bench'),
      faults: { lanes: (b) => (removed = b.joints.splice(b.joints.findIndex((j) => j.kind === 'section'), 1)[0]) },
    });
    expect(removed).not.toBeNull();
    expect(error?.message).toContain('LANES-01.continuity');
    expect(health.stoppedBeforeTiles).toBe(true);
    expect(health.steps).toEqual(['sources', 'ground', 'graph', 'repair', 'lanes']);
    const inv = health.invariants.find((i) => i.id === 'LANES-01.continuity');
    expect(inv.ok).toBe(false);
    expect(inv.detail).toMatch(/lanes end with nothing after them/);
    expect(health.gates.laneContinuityBreaks).toBeGreaterThan(0);
    expect(written(t.tiles)).toEqual([]);
  }, 300000);
});
