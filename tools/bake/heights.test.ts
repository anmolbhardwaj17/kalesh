import { describe, expect, it } from 'vitest';
import { projector } from '../geo/projection';
import { parseArgs } from './cli';
import type { HeightGrid } from './ground';
import { filteredGround, gedtmGrid, pickGround, smoothedGround } from './heights';
import { groundInvariants } from './invariants';

const ORIGIN = { lat: 28.63, lon: 77.23 };
const proj = projector(ORIGIN);
const CELL = 1 / 3600; // one arc second, about 30 m

/** A grid around ORIGIN: height = 210 + 0.01 * (metres east) + extra(i, j). */
function grid(n: number, extra: (i: number, j: number) => number = () => 0): HeightGrid {
  const west = ORIGIN.lon - (n / 2) * CELL;
  const north = ORIGIN.lat + (n / 2) * CELL;
  const data = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const p = proj.toWorld(north - (j + 0.5) * CELL, west + (i + 0.5) * CELL);
      data[j * n + i] = 210 + 0.01 * p.x + extra(i, j);
    }
  }
  return { west, north, dLon: CELL, dLat: -CELL, width: n, height: n, data, cellCentre: true };
}
const BOX = { minX: -600, maxX: 600, minZ: -600, maxZ: 600 };

describe('ground model (heights.ts)', () => {
  it('reads a GEDTM30 window: scale, offset and no data', () => {
    const g = gedtmGrid({ west: 77, north: 29, dLon: CELL, dLat: -CELL, width: 2, height: 1, scale: 0.1, offset: 0, noData: -32768, values: [2150, -32768] });
    expect(g.data[0]).toBeCloseTo(215, 4);
    expect(Number.isNaN(g.data[1])).toBe(true);
    expect(g.cellCentre).toBe(true);
  });

  it('GS1: GEDTM30 smoothed over 60 m keeps a gentle slope and flattens 1 m cell noise', () => {
    const noisy = grid(80, (i, j) => (((i * 7 + j * 13) % 5) - 2) * 0.5);
    const g = smoothedGround(noisy, proj, BOX);
    expect(g.source).toBe('gedtm30');
    expect(g.stats.holes).toBe(0);
    let worst = 0;
    for (let x = -500; x <= 500; x += 50) for (let z = -500; z <= 500; z += 50) worst = Math.max(worst, Math.abs(g.at(x, z) - (210 + 0.01 * x)));
    expect(worst).toBeLessThan(0.35);
    // neighbouring 15 m steps along a line never jump
    let step = 0;
    for (let x = -500; x < 500; x += 15) step = Math.max(step, Math.abs(g.at(x + 15, 0) - g.at(x, 0)));
    expect(step).toBeLessThan(0.3);
  });

  it('GS2: GLO-30 through the filter drops a block of roofs that stands 12 m up', () => {
    const roofs = grid(80, (i, j) => (i >= 38 && i <= 42 && j >= 38 && j <= 42 ? 12 : 0));
    const g = filteredGround(roofs, proj, BOX);
    expect(g.source).toBe('glo30');
    expect(g.stats.dropped).toBeGreaterThan(10);
    expect(Math.abs(g.at(0, 0) - 210)).toBeLessThan(1);
    // the plain smoothing would keep the roofs in
    expect(smoothedGround(roofs, proj, BOX).at(0, 0) - 210).toBeGreaterThan(3);
  });

  it('picks GEDTM30 first, GLO-30 when the window is missing, and fails with neither', () => {
    expect(pickGround({ gedtm30: grid(60), glo30: grid(60) }, proj, BOX).source).toBe('gedtm30');
    expect(pickGround({ gedtm30: null, glo30: grid(60) }, proj, BOX).source).toBe('glo30');
    expect(() => pickGround({ gedtm30: null, glo30: null }, proj, BOX)).toThrow(/no ground source/);
  });

  it('the ground invariant passes Delhi heights and fails a unit fault', () => {
    const g = smoothedGround(grid(60), proj, BOX);
    expect(groundInvariants(g)[0]!.ok).toBe(true);
    const tenfold = smoothedGround(grid(60, () => 1900), proj, BOX);
    expect(groundInvariants(tenfold)[0]!.ok).toBe(false);
  });
});

describe('bake command line (cli.ts)', () => {
  it('reads a stage, the step, tiles, out and the switches', () => {
    expect(parseArgs(['pilot'])).toEqual({ target: 'pilot', steps: ['sources', 'ground', 'graph', 'repair', 'lanes', 'elevation', 'tiles'], tiles: null, out: null, force: false, offline: false });
    expect(parseArgs(['pilot', '--stage', 'sources']).steps).toEqual(['sources']);
    expect(parseArgs(['pilot', '--stage', 'ground']).steps).toEqual(['sources', 'ground']);
    expect(parseArgs(['pilot', '--tiles', '3_-4,0_0', '--out', 'x/tiles']).tiles).toEqual([{ x: 3, z: -4 }, { x: 0, z: 0 }]);
    expect(parseArgs(['pilot', '--out', 'x/tiles']).out).toBe('x/tiles');
    expect(parseArgs(['--offline', 'pilot']).offline).toBe(true);
  });

  it('refuses what it cannot read', () => {
    expect(() => parseArgs([])).toThrow(/usage/);
    expect(() => parseArgs(['pilot', '--stage', 'roads'])).toThrow(/unknown step/);
    expect(() => parseArgs(['pilot', '--tiles', '3,4'])).toThrow(/x_z/);
    expect(() => parseArgs(['pilot', 'centre'])).toThrow(/one stage or block/);
    expect(() => parseArgs(['pilot', '--frob'])).toThrow(/unknown option/);
    expect(() => parseArgs(['pilot', '--force', '--offline'])).toThrow();
    expect(() => parseArgs(['pilot', '--out'])).toThrow(/needs a value/);
  });
});
