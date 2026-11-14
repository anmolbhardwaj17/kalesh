import { describe, expect, it } from 'vitest';
import { barrierStops, classModes, conditional, edgeAccess, graphAccess, tagModes } from './access.ts';
import type { AccessContext, AccessEdge, AccessRule } from './access.ts';
import { POST_R, carriagewayRuns, postOffsets, transitionLines, widestGap } from '../mesh/barriers.ts';
import type { EdgeAccess } from './access.ts';
import type { LaneDef, Station, Strip } from '../roads/model.ts';

const ctx = (over: Partial<AccessContext> = {}): AccessContext => ({ rules: [], openAt: () => null, areaAt: () => null, barriers: new Map(), ...over });
const edge = (over: Partial<AccessEdge> = {}): AccessEdge => ({ id: 'w1.0', cls: 'residential', link: false, name: '', width: 6, tags: {}, ways: ['way/1'], pts: [{ x: 0, z: 0 }, { x: 100, z: 0 }], ...over });

describe('access modes of a road (P2-042)', () => {
  it('class defaults: a pedestrian street has no cars, a main road no walkers on its lanes, a motorway cars only', () => {
    expect(classModes('pedestrian')).toEqual(['cycle', 'foot', 'emergency']);
    expect(classModes('primary')).toEqual(['car', 'auto', 'two_wheeler', 'cycle', 'emergency']);
    expect(classModes('motorway')).toEqual(['car', 'emergency']);
    expect(classModes('residential')).toContain('foot');
  });

  it('reads OSM tags from the general key to the specific one, with a daytime conditional', () => {
    expect(tagModes(classModes('tertiary'), { motor_vehicle: 'no' }).modes).toEqual(['cycle', 'emergency']);
    expect(tagModes(classModes('service'), { access: 'no', foot: 'yes' }).modes).toEqual(['foot', 'emergency']);
    expect(tagModes(classModes('service'), { access: 'private' }).private).toBe(true);
    expect(tagModes(classModes('service'), { access: 'private' }).modes).toContain('car');
    expect(conditional('no @ (09:00-21:00)')).toEqual({ value: 'no', hours: '09:00-21:00' });
    const day = tagModes(classModes('tertiary'), { 'motor_vehicle:conditional': 'no @ 09:00-21:00' });
    expect(day.modes).not.toContain('car');
    expect(day.hours).toBe('09:00-21:00');
    // a general yes never opens a pedestrian street to cars
    expect(tagModes(classModes('pedestrian'), { access: 'yes' }).modes).not.toContain('car');
  });

  it('common sense: width, surface and a way inside a park', () => {
    const narrow = edgeAccess(edge({ width: 1.8 }), ctx());
    expect(narrow.reason).toBe('width');
    expect(narrow.modes).toEqual(['two_wheeler', 'cycle', 'foot']);
    expect(edgeAccess(edge({ width: 1.4 }), ctx()).modes).toEqual(['cycle', 'foot']);
    expect(edgeAccess(edge({ tags: { surface: 'dirt' } }), ctx()).reason).toBe('surface');
    const park = edgeAccess(edge({ cls: 'service' }), ctx({ openAt: () => 'leisure=park' }));
    expect(park).toMatchObject({ reason: 'context', modes: ['cycle', 'foot', 'emergency'] });
    // a stadium is not foot first; a tertiary road through a park keeps its cars
    expect(edgeAccess(edge({ cls: 'service' }), ctx({ openAt: () => 'leisure=stadium' })).reason).toBe('class');
    expect(edgeAccess(edge({ cls: 'tertiary' }), ctx({ openAt: () => 'leisure=park' })).modes).toContain('car');
  });

  it('a barrier node that stops cars closes the way to cars; an open gate does not', () => {
    expect(barrierStops('bollard', {})).toEqual({ car: true, twoWheeler: false });
    expect(barrierStops('gate', {})).toEqual({ car: false, twoWheeler: false });
    expect(barrierStops('lift_gate', { locked: 'yes' }).car).toBe(true);
    const a = edgeAccess(edge({ cls: 'service' }), ctx({ barriers: new Map([['w1.0', [{ id: 'n9', kind: 'bollard', stopsCar: true, stopsTwoWheeler: false }]]]) }));
    expect(a.reason).toBe('osm_barrier');
    expect(a.modes).toEqual(['two_wheeler', 'cycle', 'foot']);
  });

  it('rules: a Delhi rule decides, the judge and the owner override it, a rule never opens a narrow way to cars', () => {
    const cc: AccessRule = { id: 'cc', by: 'rule', kind: 'rule', why: 'non-motorised zone', refs: ['x'], modes: ['cycle', 'foot', 'emergency'], hours: '09:00-21:00', barrier: 'bollards', match: { name: '^Chandni Chowk$' } };
    const owner: AccessRule = { id: 'own', by: 'owner', why: 'owner says cars may go', refs: ['inbox'], modes: ['car', 'cycle', 'foot'], match: { ways: ['way/1'] } };
    const a = edgeAccess(edge({ cls: 'tertiary', name: 'Chandni Chowk' }), ctx({ rules: [cc] }));
    expect(a).toMatchObject({ reason: 'rule', rule: 'cc', barrier: 'bollards', hours: '09:00-21:00', modes: ['cycle', 'foot', 'emergency'] });
    // the owner entry comes first in the file and still wins
    expect(edgeAccess(edge({ cls: 'tertiary', name: 'Chandni Chowk' }), ctx({ rules: [owner, cc] }))).toMatchObject({ reason: 'owner', rule: 'own' });
    const wide: AccessRule = { id: 'g', by: 'rule', kind: 'context', why: 'galis', refs: ['x'], modes: ['car', 'two_wheeler'], match: { classes: ['residential'] } };
    expect(edgeAccess(edge({ width: 2 }), ctx({ rules: [wide] })).modes).toEqual(['two_wheeler']);
    // a circle and an area match
    const hex: AccessRule = { id: 'h', by: 'rule', why: 'inside the hexagon', refs: ['x'], modes: ['foot'], match: { within: { x: 50, z: 0, r: 60 } } };
    expect(edgeAccess(edge(), ctx({ rules: [hex] })).rule).toBe('h');
    expect(edgeAccess(edge({ pts: [{ x: 0, z: 0 }, { x: 200, z: 0 }] }), ctx({ rules: [hex] })).rule).toBeUndefined();
    const old: AccessRule = { id: 'o', by: 'rule', kind: 'context', why: 'old city galis', refs: ['x'], modes: ['two_wheeler', 'foot'], match: { archetypes: ['old_city_lanes'] } };
    expect(edgeAccess(edge(), ctx({ rules: [old], areaAt: () => ({ id: 'cc_galis', archetype: 'old_city_lanes' }) }))).toMatchObject({ reason: 'context', rule: 'o' });
  });

  it('an OSM access=no on a real road closes it with bollards; the record counts by mode and reason', () => {
    const a = edgeAccess(edge({ cls: 'secondary', width: 13, tags: { access: 'no' } }), ctx());
    expect(a).toMatchObject({ reason: 'osm_tag', barrier: 'bollards' });
    const edges = [
      { id: 'a', name: '', pts: [{ x: 0, z: 0 }, { x: 1000, z: 0 }], len: 1000, pieces: [{ way: 'way/1' }], road: { cls: 'primary', link: false, width: 7 } },
      { id: 'b', name: '', pts: [{ x: 0, z: 0 }, { x: 500, z: 0 }], len: 500, pieces: [{ way: 'way/2' }], road: { cls: 'residential', link: false, width: 2 } },
    ];
    const { access, record } = graphAccess(edges, ctx());
    expect(access.get('b')?.reason).toBe('width');
    expect(record.byMode.car).toEqual({ edges: 1, km: 1 });
    expect(record.byReason.width).toEqual({ edges: 1, km: 0.5, closedToCars: 1 });
    expect(record.carFree).toEqual({ edges: 1, km: 0.5 });
  });
});

describe('bollard lines (P2-042)', () => {
  it('posts across a carriageway leave no gap a car fits through, and skip the median', () => {
    const lanes = [{ type: 'footpath' }, { type: 'drive' }, { type: 'drive' }, { type: 'median' }, { type: 'drive' }, { type: 'footpath' }] as LaneDef[];
    const b = [9, 7, 3.5, 0, -0.5, -4, -6];
    const runs = carriagewayRuns(lanes, b);
    expect(runs).toEqual([[7, 0], [-0.5, -4]]);
    const offs = runs.map(([l, r]) => postOffsets(l, r));
    expect(widestGap(runs, offs)).toBeLessThanOrEqual(1.3);
    expect(offs[0]?.length).toBeGreaterThanOrEqual(5);
    // the outer posts keep under half a metre to the kerb
    expect(7 - (offs[0]?.[0] as number) - POST_R).toBeLessThan(0.5);
  });

  const strip = (id: string, edge: string, pts: [number, number][]): Strip => ({
    id, edge, kind: 'road', cls: 'tertiary', link: false, name: '', ways: [], hero: null, lanes: [{ type: 'drive', dir: 1, width: 3.3, raise: 0 }, { type: 'drive', dir: -1, width: 3.3, raise: 0 }],
    st: pts.map(([x, z]) => ({ x, z, nx: 0, nz: -1, s: 0, h: 0, g: 0, b: [3.3, 0, -3.3], layer: 0, bridge: false, structure: 0, edgeRaise: 0.15 }) as Station),
  });
  const closedAcc: EdgeAccess = { modes: ['cycle', 'foot', 'emergency'], reason: 'rule', why: 'cc', rule: 'cc', barrier: 'bollards' };
  const carAcc: EdgeAccess = { modes: ['car', 'auto', 'two_wheeler', 'cycle', 'emergency'], reason: 'class', why: 'class' };

  it('the end of a closed street gets its line across the closed way; the middle gets lines across the car mouths', () => {
    // a junction at x 0: the closed street leaves east and west, a car road leaves south
    const strips = [strip('w', 'cc.0', [[-5, 0], [-50, 0]]), strip('e', 'cc.1', [[5, 0], [50, 0]]), strip('s', 'car.0', [[0, 5], [0, 50]])];
    const access = new Map([['cc.0', closedAcc], ['cc.1', closedAcc], ['car.0', carAcc]]);
    const arms = [{ strip: 0, end: 'start' as const }, { strip: 1, end: 'start' as const }, { strip: 2, end: 'start' as const }];
    const mid = transitionLines({ strips, joints: [], junctions: [{ id: 'j', arms }], access });
    expect(mid.map((t) => `${t.strip}:${t.side}`)).toEqual(['2:mouth']);
    // the closed street ends at the junction (only its east arm): the line is across it
    const end = transitionLines({ strips, joints: [], junctions: [{ id: 'j', arms: [arms[1]!, arms[2]!] }], access });
    expect(end.map((t) => `${t.strip}:${t.side}`)).toEqual(['1:closed']);
    // no car arm, no line
    expect(transitionLines({ strips, joints: [], junctions: [{ id: 'j', arms: [arms[0]!, arms[1]!] }], access })).toEqual([]);
  });
});
