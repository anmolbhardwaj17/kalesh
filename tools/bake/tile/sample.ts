// A small production tile from made-up inputs (P1-016): a road quad with lane UVs and a kerb face, the ground under
// it, one building shell, two lane pieces and a pin, through the same writer as the bake (write.ts bakeTiles). The
// fixture harness/data/fixtures/tile_t1_sample.json is this tile (tools/fixtures/gen_tile_fixture.mjs), so the
// GDScript reader is checked on what the production writer writes. Pure.
import { MeshBuilder } from './standin.ts';
import type { SourceMesh } from './cutter.ts';
import type { GroundTile } from '../terrain/build.ts';
import { shellOf } from './shells.ts';
import type { Shell } from './shells.ts';
import { bakeTiles } from './write.ts';
import type { TileBakeResult, TileRecord } from './write.ts';
import type { LanePiece } from './lanes.ts';

/** Block metres to world metres of the sample (not whole metres, as the centre block's is not). */
export const SAMPLE_OFFSET = { x: 10.6, z: 20.2 };
export const SAMPLE_GROUND_Y = 210.5;

/** The inputs of the sample tile (world tile 0_0 = block x -10.6 to 239.4, z -20.2 to 229.8). */
export function sampleInputs(): { road: SourceMesh[]; ground: GroundTile[]; shells: Shell[]; lanes: LanePiece[] } {
  const o = SAMPLE_OFFSET;
  const y = SAMPLE_GROUND_Y;
  // a road 8 m wide along x at block z 40, 0.02 m over the ground, with a kerb face along its north edge
  const road = new MeshBuilder('road', 'road');
  road.quad([20, y + 0.02, 36], [200, y + 0.02, 36], [200, y + 0.02, 44], [20, y + 0.02, 44], [0, 1, 0]);
  const uv: number[] = [];
  const uv2: number[] = [];
  for (let i = 0; i < road.mesh.pos.length / 3; i++) {
    uv.push((road.mesh.pos[i * 3 + 2]! - 36) / 8, (road.mesh.pos[i * 3]! - 20) / 4);
    uv2.push(1, 2);
  }
  const kerb = new MeshBuilder('kerbface', 'kerbface');
  kerb.quad([20, y + 0.17, 36], [200, y + 0.17, 36], [200, y + 0.02, 36], [20, y + 0.02, 36], [0, 0, -1]);
  // the ground of the tile, x and z relative to the tile corner (the terrain step's form), y absolute
  const g = new MeshBuilder('ground', 'ground');
  g.quad([0, y, 0], [250, y, 0], [250, y, 250], [0, y, 250], [0, 1, 0]);
  const shell = shellOf({ id: 'b1', ring: [{ x: 60, z: 80 }, { x: 90, z: 80 }, { x: 90, z: 110 }, { x: 60, z: 110 }], height: null, levels: 2, tags: { building: 'yes' } }, () => y, () => y);
  const lane = (id: string, part: number, x0: number, x1: number, next: string[]): LanePiece => ({
    id: `${id}:${part}`, kind: 'lane', of: id, part, cls: 'primary', widthM: 3.5, layer: 0, next, tile: '0_0',
    pts: [x0 + o.x, y + 0.02, 38 + o.z, (x0 + x1) / 2 + o.x, y + 0.02, 38 + o.z, x1 + o.x, y + 0.02, 38 + o.z],
  });
  return {
    road: [{ ...road.mesh, uv, uv2 }, { ...kerb.mesh, uv: [], uv2: [] }],
    ground: [{ tx: 0, tz: 0, meshes: [g.mesh] }],
    shells: shell ? [shell] : [],
    lanes: [lane('s0.0', 0, 20, 110, ['s0.0:1']), lane('s0.0', 1, 110, 200, [])],
  };
}

/** The sample tile written by the production writer: its bytes and its index record. */
export function sampleProductionTile(): { bytes: Uint8Array; record: TileRecord; result: TileBakeResult } {
  const inputs = sampleInputs();
  let out: { bytes: Uint8Array; record: TileRecord } | null = null;
  const result = bakeTiles(
    { block: 'sample', offset: SAMPLE_OFFSET, ...inputs, pins: [{ id: 'sample_gate', name: 'Sample Gate', kind: 'place', x: 125.25, y: SAMPLE_GROUND_Y, z: 150.5 }] },
    (record, bytes) => (out = { bytes, record }),
  );
  if (!out) throw new Error(`the sample tile was not written: ${JSON.stringify(result.skipped)}`);
  const o = out as { bytes: Uint8Array; record: TileRecord };
  return { ...o, result };
}
