import { describe, expect, it } from 'vitest';
import raw from '../../../harness/data/fixtures/tile_t1_sample.json?raw';
import { decodeContent } from './codec';
import { sampleProductionTile } from './sample';

// harness/data/fixtures/tile_t1_sample.json is the cross-check for the GDScript tile reader
// (game/bench/tiles/tile_t1.gd, game/tests/test_tiles.gd). It must stay in step with the production tile writer:
// regenerate with `node tools/fixtures/gen_tile_fixture.mjs`.
interface Fixture {
  bytes: number;
  expect: { triangles: number; colliderTriangles: number; colliderChunks: number; lanes: number; pins: number };
  base64: string;
}
const fixture = JSON.parse(raw) as Fixture;

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = i + 1 < bytes.length ? (bytes[i + 1] as number) : 0;
    const c = i + 2 < bytes.length ? (bytes[i + 2] as number) : 0;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[c & 63] : '=';
  }
  return out;
}

describe('T1 tile fixture for the GDScript reader', () => {
  it('is what the production tile writer writes for the sample tile', () => {
    const { bytes, record } = sampleProductionTile();
    expect(bytes.length).toBe(fixture.bytes);
    expect(base64(bytes)).toBe(fixture.base64);
    expect(fixture.expect).toMatchObject({ triangles: record.triangles, colliderTriangles: record.colliderTriangles, colliderChunks: record.chunks, lanes: record.lanes, pins: record.pins });
    const t = decodeContent(bytes);
    expect(t.margin).toBe(250);
    expect(t.meshes.map((m) => m.material)).toEqual(['ground', 'road', 'kerb', 'building']);
  });
});
