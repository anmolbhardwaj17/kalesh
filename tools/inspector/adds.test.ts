// The draw tool of the map inspector (P1-045): a drawing becomes an add patch the bake accepts (the same check the
// bake makes when it reads an override file), with the roads it touches named by id.
import { describe, expect, it } from 'vitest';
import { patchProblems } from '../bake/repair/overrides';
import { ADD_KINDS, addInboxText, addInputProblems, buildAddPatch, kindInfo, mapRoads, nearestRoad, roadsAlong } from './adds';
import type { AddInput, MapRoad } from './adds';

const roads: MapRoad[] = [
  { id: 'w1.0', pts: [[0, 0], [200, 0]] },
  { id: 'w2.0', pts: [[100, 0], [100, -150]] },
];
// a stand-in frame: 1 m = 1e-5 degrees, north is -z
const toGeo = (x: number, z: number) => ({ lat: 28.6 - z * 1e-5, lon: 77.2 + x * 1e-5 });
const ref = { link: 'https://example.org/photo', date: '2026-11-13' };
const input = (kind: string, points: [number, number][], settings: AddInput['settings'] = {}): AddInput => ({ kind, points, settings, reference: ref, note: '' });
const full = (i: AddInput) => ({ id: 'ov_0_0_0001', ...buildAddPatch(i, { date: '2026-11-13', toGeo, roads }), issue: 'add:ov_0_0_0001' });

describe('inspector draw tool', () => {
  it('names the roads near the drawn points', () => {
    expect(nearestRoad(roads, 50, 4, 15)).toMatchObject({ id: 'w1.0', d: 4 });
    expect(nearestRoad(roads, 50, 40, 15)).toBeNull();
    expect(roadsAlong(roads, [[20, 1], [180, 1]], 8)).toEqual(['w1.0']);
    expect(mapRoads({ roads: [{ id: 'w9.0', p: [1, 0, 2, 3, 0, 4] }, { p: [0, 0, 0] }] })).toEqual([{ id: 'w9.0', pts: [[1, 2], [3, 4]] }]);
  });

  it('says in plain words what a drawing still needs', () => {
    expect(addInputProblems({ ...input('add_median', [[0, 0]], { width: 2 }) })).toEqual(['Click at least two points on the map.']);
    expect(addInputProblems({ ...input('add_crossing', [[0, 0]]), reference: { link: '', date: '2026-11-13' } })).toEqual(['Add the link of the photo or satellite view this is drawn from.']);
    expect(addInputProblems(input('add_way', [[0, 0], [5, 5]], { lanes: 0 }))[0]).toMatch(/lane count/);
    expect(addInputProblems(input('add_tree', [[0, 0]]))).toEqual(['Pick what to add.']);
  });

  it('every kind makes a patch the bake accepts', () => {
    const drawings: AddInput[] = [
      input('add_way', [[60, 3], [60, 40], [80, 60]], { highway: 'service', lanes: 1, name: 'Drive' }),
      input('add_median', [[20, 0], [180, 0]], { width: 1.5, type: 'planter' }),
      input('add_footpath', [[20, 4], [180, 4]], { width: 2 }),
      input('add_crossing', [[150, 1]]),
      input('add_barrier', [[100, -80]], { kind: 'bollards' }),
    ];
    expect(drawings.map((d) => d.kind)).toEqual(ADD_KINDS.map((k) => k.kind));
    for (const d of drawings) {
      expect(addInputProblems(d)).toEqual([]);
      const p = full(d);
      expect(patchProblems(p)).toEqual([]);
      expect(p).toMatchObject({ action: d.kind, by: 'owner', source: 'inspector', reference: ref });
    }
  });

  it('a road joins the road under its first end by id and leaves its far end free', () => {
    const p = full(input('add_way', [[60, 3], [60, 40], [80, 60]], { highway: 'service', lanes: 1 }));
    expect(p.params).toMatchObject({ highway: 'service', lanes: 1, join_a: 'w1.0', join_b: 'none' });
    expect(p.target.ids).toEqual(['w1.0']);
    // latitude and longitude of each click, first one the anchor
    expect(p.params['path']).toBe('28.59997,77.2006;28.5996,77.2006;28.5994,77.2008');
    expect(p.target.anchor).toEqual({ lat: 28.59997, lon: 77.2006 });
  });

  it('a median names the road it runs along; a crossing and a barrier the road under the click', () => {
    expect(full(input('add_median', [[20, 0], [180, 0]], { width: 1.5 })).target.ids).toEqual(['w1.0']);
    const b = full(input('add_barrier', [[100, -80]], { kind: 'gate' }));
    expect(b.params).toMatchObject({ on: 'w2.0', kind: 'gate', at: '28.6008,77.201' });
  });

  it('writes a plain inbox line', () => {
    expect(addInboxText(kindInfo('add_median')!, 10.4, -20.6, 3, 'ov_0_-1_0002', '0_-1.json', ' wide planter ')).toBe('Map inspector: I drew a median at x 10, z -21 (3 points). Note: wide planter. Patch ov_0_-1_0002 is in overrides/0_-1.json.');
  });
});
