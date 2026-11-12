// Underground structures (P1-041): the tag rules, the list, Overture copies following their OSM way, names from the
// station inside, and the rules: an underground footprint over a road raises nothing, the same footprint on the
// ground raises R-BLDG-01. A patch on an underground footprint is retired, not stale.
import { describe, expect, it } from 'vitest';
import { repairGraph } from '../repair/engine';
import { issuesRemovedByUnderground } from '../report/underground';
import { runRules } from '../rules/catalogue';
import type { Issue } from '../rules/types';
import { Sketch, flat, rulesOn, testEnv } from '../testmap';
import type { OvertureRow } from './footprints';
import { osmBelowGround, osmIdOfRecord, overtureBelowGround, undergroundLabel } from './underground';
import type { UndergroundList } from './underground';

/** A residential road along north 0 and a 60 m hall straddling it, with the hall's tags. */
function hallOverRoad(tags: Record<string, string>): { s: Sketch; hall: number } {
  const s = new Sketch();
  s.way([[-200, 0], [200, 0]], { highway: 'residential' });
  const hall = s.building([[-30, -30], [30, -30], [30, 30], [-30, 30]], tags);
  return { s, hall };
}
const issuesOn = (s: Sketch, list?: UndergroundList, overture: OvertureRow[] = []): Issue[] => {
  const g = s.graph(500, overture, list);
  return runRules(rulesOn(g, { nodeTags: s.nodeTags() }));
};
const square = (x0: number, n0: number, size: number): [number, number][] => [[x0, n0], [x0 + size, n0], [x0 + size, n0 + size], [x0, n0 + size], [x0, n0]];

describe('underground: the tags', () => {
  it('reads OSM tags', () => {
    expect(osmBelowGround({ building: 'train_station', layer: '-2' })).toBe('layer -2');
    expect(osmBelowGround({ building: 'yes', location: 'underground' })).toBe('location=underground');
    expect(osmBelowGround({ building: 'yes', level: '-1;-2' })).toBe('level -1;-2');
    expect(osmBelowGround({ building: 'yes', level: '0;-1' })).toBeNull(); // reaches the ground floor
    expect(osmBelowGround({ building: 'transportation', 'building:levels': '0', 'building:levels:underground': '2' })).toBe('no floors above ground, 2 below');
    expect(osmBelowGround({ building: 'yes', station: 'subway' })).toBe('a subway station building');
    expect(osmBelowGround({ building: 'yes', layer: '-1', location: 'surface' })).toBeNull(); // the mapper says on the surface
    expect(osmBelowGround({ building: 'yes', layer: '1', station: 'subway' })).toBeNull(); // an elevated station
    expect(osmBelowGround({ building: 'yes', tunnel: 'building_passage' })).toBeNull();
    expect(osmBelowGround({ building: 'yes', 'building:levels': '4' })).toBeNull();
  });

  it('reads Overture fields and record ids', () => {
    expect(overtureBelowGround({ level: -2, isUnderground: false, floors: null, floorsUnderground: 2 })).toBe('level -2 (Overture)');
    expect(overtureBelowGround({ level: null, isUnderground: true, floors: null, floorsUnderground: null })).toBe('is_underground (Overture)');
    expect(overtureBelowGround({ level: null, isUnderground: false, floors: 3, floorsUnderground: 2 })).toBeNull(); // a basement
    expect(osmIdOfRecord('w1158884368@4')).toBe('way/1158884368');
    expect(osmIdOfRecord('r8478230@8')).toBe('relation/8478230');
    expect(osmIdOfRecord('7JWVJ6J9+GPGG')).toBeNull();
  });
});

describe('underground: the rules never see it', () => {
  it('an underground footprint over a road raises nothing; the same footprint on the ground raises R-BLDG-01', () => {
    const under = hallOverRoad({ building: 'train_station', layer: '-2' });
    const g = under.s.graph();
    expect(g.footprints).toHaveLength(0);
    expect(g.underground.map((u) => [u.id, u.kind, u.reason])).toEqual([[`way/${under.hall}`, 'metro_station', 'tag: layer -2']]);
    expect(issuesOn(under.s).filter((i) => i.features.includes(`way/${under.hall}`))).toEqual([]);
    const ground = hallOverRoad({ building: 'train_station' });
    const hits = issuesOn(ground.s).filter((i) => i.features.includes(`way/${ground.hall}`));
    expect(hits.map((i) => i.rule)).toContain('R-BLDG-01');
    // the count the health report gives: what the class keeps off the raw graph
    const removed = issuesRemovedByUnderground(g, testEnv({ nodeTags: under.s.nodeTags() }));
    expect(removed.total).toBe(hits.length);
    expect(removed.byFeature).toEqual({ [`way/${under.hall}`]: hits.length });
  });

  it('the list puts an untagged footprint below ground and a tagged one back on the ground', () => {
    const a = hallOverRoad({});
    const list: UndergroundList = { underground: [{ id: `way/${a.hall}`, name: 'Rajiv Chowk metro station', kind: 'metro_station', why: 'Anmol: below ground' }], surface: [] };
    expect(issuesOn(a.s, list).filter((i) => i.features.includes(`way/${a.hall}`))).toEqual([]);
    const g = a.s.graph(500, [], list);
    expect(g.underground[0]).toMatchObject({ name: 'Rajiv Chowk metro station', by: 'list', reason: 'list: Anmol: below ground' });
    expect(undergroundLabel(g.underground[0]!)).toBe('Underground: Rajiv Chowk metro station');
    const b = hallOverRoad({ layer: '-1', name: 'Chhatta Chowk' });
    const back: UndergroundList = { underground: [], surface: [{ id: `way/${b.hall}`, why: 'a covered arcade at street level' }] };
    expect(b.s.graph(500, [], back).footprints.map((f) => f.tags['name'])).toEqual(['Chhatta Chowk']);
  });

  it('an Overture copy follows its OSM way, so it cannot bring a metro hall back as a building', () => {
    const s = new Sketch();
    const hall = s.building([[0, 0], [60, 0], [60, 60], [0, 60]], { building: 'train_station', layer: '-2' });
    const arcade = s.building([[200, 0], [260, 0], [260, 20], [200, 20]], { layer: '-1', name: 'Chhatta Chowk' });
    const rows: OvertureRow[] = [
      { id: 'st', sources: [{ dataset: 'OpenStreetMap', record_id: `w${hall}@4` }], level: -2, geojson: { type: 'Polygon', coordinates: [square(0, 0, 60)] } },
      { id: 'ar', sources: [{ dataset: 'OpenStreetMap', record_id: `w${arcade}@2` }], level: -1, geojson: { type: 'Polygon', coordinates: [[[200, 0], [260, 0], [260, 20], [200, 20], [200, 0]]] } },
      { id: 'kiosk', sources: [{ dataset: 'Google Open Buildings' }], geojson: { type: 'Polygon', coordinates: [square(20, 20, 6)] } },
    ];
    const list: UndergroundList = { underground: [], surface: [{ id: `way/${arcade}`, why: 'street level' }] };
    const g = s.graph(500, rows, list);
    // the station once, with its copy; the arcade on the ground once (OSM wins, its copy is a duplicate); the kiosk on top stays
    expect(g.underground.map((u) => [u.id, u.copies])).toEqual([[`way/${hall}`, ['overture/st']]]);
    expect(g.footprints.map((f) => f.id).sort()).toEqual(['overture/kiosk', `way/${arcade}`]);
  });

  it('names a hall after the metro station inside it, and keeps a listed land use way as a named feature', () => {
    const s = new Sketch();
    s.node(30, 30, { railway: 'station', station: 'subway', name: 'Rajiv Chowk' });
    s.building([[0, 0], [60, 0], [60, 60], [0, 60]], { building: 'train_station', layer: '-2' });
    const ids = [s.node(100, 0), s.node(140, 0), s.node(140, 40), s.node(100, 40)];
    const market = s.way([...ids, ids[0]!], { landuse: 'retail', name: 'Palika Bazar' });
    const list: UndergroundList = { underground: [{ id: `way/${market}`, name: 'Palika Bazaar', kind: 'market', why: 'the underground market' }, { id: 'way/999999', why: 'not in this extract' }], surface: [] };
    const g = s.graph(500, [], list);
    expect(g.underground.map((u) => [u.name, u.kind])).toEqual([['Rajiv Chowk metro station', 'metro_station'], ['Palika Bazaar', 'market']]);
    expect(g.undergroundMissing).toEqual(['way/999999']);
  });

  it('a metro station inside an underground hall needs no street next to it (R-RAIL-02)', () => {
    const make = (layer: string | null): Issue[] => {
      const s = new Sketch();
      s.way([[-400, 0], [400, 0]], { highway: 'residential' });
      s.way([[-400, 300], [400, 300]], { railway: 'subway', tunnel: 'yes', layer: '-2', name: 'Yellow Line' });
      s.node(0, 300, { railway: 'station', station: 'subway', name: 'Rajiv Chowk' });
      s.building([[-60, 240], [60, 240], [60, 360], [-60, 360]], { building: 'train_station', ...(layer ? { layer } : {}) });
      return issuesOn(s).filter((i) => i.rule === 'R-RAIL-02');
    };
    expect(make(null).map((i) => i.note)).toEqual(['Rajiv Chowk: the nearest street is 300 m away']);
    expect(make('-2')).toEqual([]);
  });
});

describe('underground: overrides', () => {
  it('a patch on an underground footprint is retired: kept in its file, not stale, not applied', () => {
    const { s, hall } = hallOverRoad({ building: 'train_station', layer: '-2' });
    const road = s.graph().edges[0]!.id;
    const patch = { id: 'ov_0_0_0001', issue: `R-BLDG-01:way/${hall}:${road}`, action: 'set_tag' as const, target: { ids: [`way/${hall}`, road], anchor: { lat: 0, lon: 0 }, tolerance_m: 15 }, params: { key: 'tunnel', value: 'building_passage', on: road, building: `way/${hall}` }, why: 'owner pick', by: 'owner' as const, source: 'inspector', date: '2026-11-12' };
    const r = repairGraph(s.graph(), testEnv({ nodeTags: s.nodeTags() }), { overrides: { entries: [{ file: '0_0.json', patch }], project: flat } });
    expect(r.overrides[0]).toMatchObject({ outcome: 'underground', resolution: 'underground' });
    expect(r.overrideCounts).toMatchObject({ patches: 1, stale: 0, applied: 0, underground: 1 });
    expect(JSON.stringify(r.graph.edges)).toBe(JSON.stringify(s.graph().edges)); // the road is as OSM drew it
    expect(r.issues.filter((i) => i.features.includes(`way/${hall}`))).toEqual([]);
  });
});
