// The landmark registry (P2-005): the join on ids with the flagged name fallback, the source agreement rule, the tier
// rules (owner list over score, edit over both, the score's order on a fixture of ten), block, district, far and area,
// the respect and underground classes, the edits, the same hash twice, and the schema of every committed file of
// harness/data/landmarks/ with the owner's three heroes and Jama Masjid.
import { describe, expect, it } from 'vitest';
import { projector } from '../../geo/projection';
import { ringCentroid } from '../geom';
import type { OsmElement } from '../osm';
import { haversine, osmLandmarks, seenRoads } from './osm';
import { AGREE_M, buildRegistry, entryId, pretty } from './registry';
import type { RegistryInput } from './registry';
import { entryProblems, listProblems, markersProblems, overridesProblems, WORSHIP_WORDS } from './schema';
import { SCORE, proposeTier, resolveTier } from './tier';
import type { ScoreInput } from './tier';
import type { Edit, Entry, ListEntry, WikidataItem } from './types';
import { itemsFromCache, itemsFromRows, parsePoint, reduceEntity, wikidataOnlyReject } from './wikidata';

const ORIGIN = { lat: 28.612894, lon: 77.229446 };
const proj = projector(ORIGIN);
/** A point `east` and `north` metres from the origin, as [lat, lon]. */
const at = (east: number, north: number): [number, number] => {
  const g = proj.toGeo(east, -north);
  return [g.lat, g.lon];
};

/** A tiny OSM extract in metres around the origin. */
class Osm {
  readonly elements: OsmElement[] = [];
  private next = 1;
  node(east: number, north: number, tags?: Record<string, string>): number {
    const [lat, lon] = at(east, north);
    const id = this.next++;
    this.elements.push({ type: 'node', id, lat, lon, ...(tags ? { tags } : {}) });
    return id;
  }
  /** A square footprint of side `size` centred on (east, north). */
  square(east: number, north: number, size: number, tags: Record<string, string>): number {
    const h = size / 2;
    const ids = [this.node(east - h, north - h), this.node(east + h, north - h), this.node(east + h, north + h), this.node(east - h, north + h)];
    const id = this.next++;
    this.elements.push({ type: 'way', id, nodes: [...ids, ids[0] as number], tags });
    return id;
  }
  road(points: [number, number][], tags: Record<string, string>): number {
    const ids = points.map(([e, n]) => this.node(e, n));
    const id = this.next++;
    this.elements.push({ type: 'way', id, nodes: ids, tags });
    return id;
  }
}

const wd = (qid: string, label: string, east: number, north: number, sitelinks: number, more: Partial<WikidataItem> = {}): WikidataItem => {
  const [lat, lon] = at(east, north);
  return { qid, label, labelHi: null, lat, lon, sitelinks, asi: null, inception: null, heightM: null, instanceOf: [], heritage: [], commons: null, ...more };
};

/** A stage of 4 km by 4 km around the origin with one focus district in its north-east quarter. */
function input(osm: Osm, wikidata: WikidataItem[], more: Partial<RegistryInput> = {}, include: string[] = []): RegistryInput {
  const ring = (x0: number, n0: number, x1: number, n1: number): [number, number][] => [[x0, n0], [x1, n0], [x1, n1], [x0, n1], [x0, n0]].map(([e, n]) => {
    const [lat, lon] = at(e as number, n as number);
    return [lon, lat] as [number, number];
  });
  return {
    stage: 'test', block: 'centre', origin: ORIGIN, originName: 'India Gate', offset: { x: 600, z: 400 }, outline: ring(-2000, -2000, 2000, 2000), districts: [{ id: 'north_east', coords: ring(0, 0, 2000, 2000) }],
    osm: osmLandmarks(osm.elements, new Set(include)).landmarks, osmBase: '2026-11-11T00:00:00Z', wikidata, notFetched: [], roads: seenRoads(osm.elements, (lat, lon) => proj.toWorld(lat, lon), { names: ['Hero Road'], ways: [] }),
    areaAt: (x) => (x >= 0 ? { kind: 'area', id: 'east_side', archetype: 'mixed_midrise' } : { kind: 'rule', id: 'old_city_dense', archetype: 'old_city_dense' }),
    underground: { underground: [], surface: [] }, list: { landmarks: [] }, overrides: { edits: [] }, ...more,
  };
}
const edit = (id: string, target: Edit['target'], set: Edit['set'], action: Edit['action'] = 'set'): Edit => ({ id, target, action, ...(set ? { set } : {}), why: 'read on the satellite view of the site on 2026-11-13', by: 'test', source: 'hand check', date: '2026-11-13' });
const byName = (entries: Entry[], name: string): Entry => {
  const e = entries.find((x) => x.name.en === name);
  if (!e) throw new Error(`no entry ${name}`);
  return e;
};

describe('landmark sources', () => {
  it('reads OSM landmark objects with their footprint centre and area, and leaves roads, labels and plain shops out', () => {
    const o = new Osm();
    const gate = o.square(100, 200, 20, { historic: 'monument', name: 'Old Gate', wikidata: 'Q1' });
    o.node(300, 300, { tourism: 'museum', name: 'Small Museum' });
    o.node(0, 0, { amenity: 'cafe', name: 'Cafe' });
    o.node(50, 50, { place: 'suburb', name: 'A Suburb', wikidata: 'Q9' });
    o.road([[0, 0], [100, 0]], { highway: 'primary', name: 'Some Road', wikidata: 'Q8' });
    const plain = o.square(-300, 0, 30, { building: 'yes' });
    const { landmarks, skipped } = osmLandmarks(o.elements);
    expect(landmarks.map((l) => l.name).sort()).toEqual(['Old Gate', 'Small Museum']);
    const g = landmarks.find((l) => l.id === `way/${gate}`)!;
    expect(g.hasFootprint).toBe(true);
    expect(g.areaM2).toBeGreaterThan(395);
    expect(g.areaM2).toBeLessThan(405);
    expect(g.ring).toHaveLength(4);
    const [lat, lon] = at(100, 200);
    expect(haversine(g.lat, g.lon, lat, lon)).toBeLessThan(0.05);
    expect(skipped.map((s) => s.name).sort()).toEqual(['A Suburb', 'Some Road']);
    // an object named by id (the owner list, an edit) is taken whatever its tags say
    expect(osmLandmarks(o.elements, new Set([`way/${plain}`])).landmarks.some((l) => l.id === `way/${plain}`)).toBe(true);
    expect(haversine(28.6, 77.2, 28.601, 77.2)).toBeCloseTo(111.2, 0);
  });

  it('reads Wikidata rows and entities into one item per id', () => {
    const cell = (value: string) => ({ value });
    const rows = [
      { item: cell('http://www.wikidata.org/entity/Q45957'), itemLabel: cell('Red Fort'), coord: cell('Point(77.2402 28.6558)'), sitelinks: cell('76'), height: cell('33'), instLabel: cell('fort'), heritageLabel: cell('World Heritage Site') },
      { item: cell('http://www.wikidata.org/entity/Q45957'), itemLabel: cell('Red Fort'), coord: cell('Point(77.2402 28.6558)'), sitelinks: cell('76'), height: cell('33'), instLabel: cell('fort'), heritageLabel: cell('Monument of National Importance'), asi: cell('N-DL-1') },
      { item: cell('http://www.wikidata.org/entity/Q7'), itemLabel: cell('Q7'), coord: cell('Point(77.2 28.6)'), sitelinks: cell('0') },
    ];
    const items = itemsFromRows(rows);
    expect(items.map((i) => i.qid)).toEqual(['Q7', 'Q45957']);
    expect(items[1]).toMatchObject({ label: 'Red Fort', lat: 28.6558, lon: 77.2402, sitelinks: 76, heightM: 33, asi: 'N-DL-1', instanceOf: ['fort'], heritage: ['Monument of National Importance', 'World Heritage Site'] });
    expect(items[0]!.label).toBe('');
    expect(parsePoint('Point(77.2295 28.6129)')).toEqual([28.6129, 77.2295]);
    expect(parsePoint('nonsense')).toBeNull();
    const snak = (value: unknown) => ({ mainsnak: { datavalue: { value } }, rank: 'normal' });
    const ent = reduceEntity('Q5', {
      labels: { en: { value: 'Tall Tower' }, hi: { value: 'मीनार' } }, sitelinks: { enwiki: {}, hiwiki: {} },
      claims: { P625: [snak({ latitude: 28.5, longitude: 77.1 })], P2048: [snak({ amount: '+72.5', unit: 'http://www.wikidata.org/entity/Q11573' }), snak({ amount: '+100', unit: 'http://www.wikidata.org/entity/Q3710' })], P31: [snak({ id: 'Q200' })], P1371: [snak('N-DL-9')], P571: [snak({ time: '+1199-00-00T00:00:00Z' })] },
    });
    expect(ent).toMatchObject({ label: 'Tall Tower', labelHi: 'मीनार', lat: 28.5, lon: 77.1, sitelinks: 2, heightM: 72.5, asi: 'N-DL-9', instanceIds: ['Q200'], inception: '1199-00-00T00:00:00Z' });
    expect(reduceEntity('Q6', { missing: '' }).missing).toBe(true);
    expect(itemsFromCache({ items: { Q5: ent, Q6: reduceEntity('Q6', undefined) }, labels: { Q200: 'minaret' } })).toEqual([expect.objectContaining({ qid: 'Q5', instanceOf: ['minaret'] })]);
  });

  it('keeps a Wikidata item with no OSM object only when it is a structure some register or Wikipedia knows', () => {
    expect(wikidataOnlyReject(wd('Q1', 'A Mosque', 0, 0, 3, { instanceOf: ['mosque'] }))).toBeNull();
    expect(wikidataOnlyReject(wd('Q2', 'A Listed Mound', 0, 0, 0, { asi: 'N-DL-3' }))).toBeNull();
    expect(wikidataOnlyReject(wd('Q3', 'An Attack', 0, 0, 9, { instanceOf: ['bomb attack'] }))).toMatch(/not a structure/);
    expect(wikidataOnlyReject(wd('Q4', 'A Constituency', 0, 0, 12, { instanceOf: ['Lok Sabha constituency'] }))).toMatch(/not a structure/);
    expect(wikidataOnlyReject(wd('Q5', 'A Pump', 0, 0, 0, { instanceOf: ['gas station'] }))).toMatch(/not a structure/);
    expect(wikidataOnlyReject(wd('Q6', 'A Hostel', 0, 0, 0, { instanceOf: ['building'] }))).toMatch(/no register/);
    expect(wikidataOnlyReject(wd('Q7', 'No Class', 0, 0, 5))).toMatch(/no class/);
    expect(wikidataOnlyReject(wd('Q8', 'A Fire', 0, 0, 5, { instanceOf: ['structure fire'] }))).toMatch(/not a structure/);
  });
});

describe('landmark join (LM1)', () => {
  const o = new Osm();
  const gate = o.square(100, 100, 20, { historic: 'memorial', name: 'Great Gate', wikidata: 'Q1' });
  const gatePart = o.node(105, 100, { tourism: 'attraction', name: 'Great Gate viewpoint', wikidata: 'Q1' });
  const wall = o.square(-500, 300, 40, { historic: 'fort', name: 'Old Fort Wall' });
  const museum = o.node(-800, -800, { tourism: 'museum', name: 'Small Museum', wikidata: 'Q3' });
  const statue = o.node(400, -400, { historic: 'memorial', name: 'Leader Statue', wikidata: 'Q50' });
  o.node(420, -400, { name: 'Leader Cafe', amenity: 'cafe', wikidata: 'Q50' });
  const lost = o.node(900, 900, { historic: 'tomb', name: 'Tagged Tomb', wikidata: 'Q77' });
  o.node(-600, 600, { tourism: 'museum', name: 'Ministry Museum', wikidata: 'Q70' });
  o.node(-620, 600, { shop: 'beverages', name: 'Brand Shop', wikidata: 'Q70' });
  const items = [
    wd('Q1', 'Great Gate', 104, 103, 30), wd('Q2', 'Old Fort Wall', -480, 310, 3, { asi: 'N-DL-1' }), wd('Q3', 'Small Museum', -800, -700, 1), wd('Q4', 'Lost Tomb', 1500, -1500, 2, { asi: 'N-DL-2', instanceOf: ['tomb'] }),
    wd('Q50', 'A Leader', 0, 0, 200, { lat: null, lon: null, instanceOf: ['human'] }), wd('Q60', 'A Riot', 10, 10, 20, { instanceOf: ['riot'] }), wd('Q70', 'A Ministry', 0, 0, 25, { lat: null, lon: null, instanceOf: ['ministry'] }), wd('Q61', 'Far Away Wall', 5000, 5000, 9, { instanceOf: ['wall'] }),
  ];
  const res = buildRegistry(input(o, items, { notFetched: ['Q77'] }));
  const e = (name: string) => byName(res.entries, name);

  it('joins on the wikidata tag, one landmark per item, the footprint first', () => {
    const g = e('Great Gate');
    expect(g).toMatchObject({ match: 'wikidata_tag', ids: { wikidata: 'Q1', osm: `way/${gate}`, asi: null }, place: 'ok', parts: [`node/${gatePart}`] });
    expect(g.evidence).toContain(`OSM way/${gate}`);
    expect(g.evidence).toContain('Wikidata Q1');
    expect(g.evidence).toContain('joined on the OSM wikidata tag');
    expect(g.agreement).toMatchObject({ ok: true, inside_footprint: true });
    expect(res.entries.filter((x) => x.ids.wikidata === 'Q1')).toHaveLength(1);
  });

  it('matches by name and distance only as a fallback, and flags every such match', () => {
    const w = e('Old Fort Wall');
    expect(w).toMatchObject({ match: 'name_distance', ids: { wikidata: 'Q2', osm: `way/${wall}`, asi: 'N-DL-1' }, issue: `R-LM-02:way/${wall}:Q2` });
    expect(w.flags).toContain('fallback_name_match');
    expect(w.evidence).toContain('fallback');
    expect(res.entries.filter((x) => x.match === 'name_distance').every((x) => x.flags.includes('fallback_name_match') && x.issue !== undefined)).toBe(true);
    expect(res.issues.find((i) => i.id === w.issue)).toMatchObject({ rule: 'R-LM-02', status: 'open', landmark: w.id });
  });

  it('holds an entry whose sources disagree by more than 50 m and lists it in the issues', () => {
    const m = e('Small Museum');
    expect(m.agreement).toMatchObject({ ok: false, inside_footprint: false });
    expect(m.agreement!.osm_to_wikidata_m).toBeGreaterThan(AGREE_M);
    expect(m.flags).toContain('sources_disagree_over_50m');
    expect(m.place).toBe('held');
    const issue = res.issues.find((i) => i.id === `R-LM-01:node/${museum}:Q3`)!;
    expect(issue).toMatchObject({ rule: 'R-LM-01', status: 'open', block: 'centre', features: [`node/${museum}`, 'Q3'] });
    // world metres: block metres plus the block offset; the tile of the one 250 m grid
    expect(issue.x).toBeCloseTo(-800 + 600, 0);
    expect(issue.z).toBeCloseTo(800 + 400, 0);
    expect(issue.tile).toEqual([Math.floor(issue.x / 250), Math.floor(issue.z / 250)]);
    expect(issue.proposals.length).toBeGreaterThanOrEqual(2);
    // every disagreement is an issue, and nothing else is an R-LM-01
    const disagree = res.entries.filter((x) => x.agreement && !x.agreement.ok).map((x) => x.issue).sort();
    expect(res.issues.filter((i) => i.rule === 'R-LM-01').map((i) => i.id).sort()).toEqual(disagree);
    expect(JSON.parse(res.issuesText).issues.map((i: { id: string }) => i.id)).toEqual(res.issues.map((i) => i.id));
  });

  it('does not take the fame of a person a statue is tagged with, and drops what is only a subject tag', () => {
    const s = e('Leader Statue');
    expect(s).toMatchObject({ match: 'none', ids: { wikidata: null, osm: `node/${statue}` }, score: 0, tier: 'marker' });
    expect(s.flags).toContain('wikidata_tag_names_a_subject');
    expect(res.entries.some((x) => x.name.en === 'Leader Cafe')).toBe(false);
    expect(res.rejected.some((r) => r.name === 'Leader Cafe' && /names a person/.test(r.why))).toBe(true);
    // a body housed here (no place of its own in Wikidata): the id stays, its fame is not counted
    const m = e('Ministry Museum');
    expect(m).toMatchObject({ match: 'wikidata_tag', ids: { wikidata: 'Q70' }, score: 0, agreement: null });
    expect(m.flags).toContain('wikidata_item_has_no_coordinate');
    expect(res.rejected.some((r) => r.name === 'Brand Shop' && /a body or a brand/.test(r.why))).toBe(true);
  });

  it('keeps Wikidata-only structures as unplaced markers, rejects events, and flags an item it could not fetch', () => {
    expect(e('Lost Tomb')).toMatchObject({ match: 'none', place: 'unplaced', tier: 'marker', ids: { wikidata: 'Q4', osm: null, asi: 'N-DL-2' }, footprint: null });
    expect(e('Lost Tomb').flags).toContain('wikidata_only_no_osm_object');
    expect(res.rejected.some((r) => r.id === 'Q60' && /not a structure/.test(r.why))).toBe(true);
    expect(res.entries.some((x) => x.ids.wikidata === 'Q60')).toBe(false);
    expect(e('Tagged Tomb')).toMatchObject({ ids: { wikidata: 'Q77', osm: `node/${lost}` }, match: 'none' });
    expect(e('Tagged Tomb').flags).toContain('wikidata_item_not_fetched');
    // outside the stage outline and on no owner list: not in this stage's registry
    expect(res.entries.some((x) => x.ids.wikidata === 'Q61')).toBe(false);
    expect(res.stats.outsideStage).toBe(1);
  });

  it('gives every entry a source id, an evidence line, its block, district, far flag and area id', () => {
    for (const x of res.entries) {
      expect(x.ids.osm ?? x.ids.wikidata, x.id).toBeTruthy();
      expect(x.evidence.length, x.id).toBeGreaterThan(25);
      expect(x).toMatchObject({ block: 'centre', far: false });
      expect(x.area, x.id).not.toBeNull();
      expect(entryProblems(x.tier === 'marker' ? x : { _generated: 'by the test build', ...x }, x.id, x.tier === 'marker')).toEqual([]);
    }
    expect(e('Great Gate')).toMatchObject({ district: 'north_east', area: { kind: 'area', id: 'east_side' } });
    expect(e('Old Fort Wall')).toMatchObject({ district: null, area: { kind: 'rule', id: 'old_city_dense' } });
  });

  it('gives the same files and the same hash twice, and another hash when a source changes', () => {
    const again = buildRegistry(input(o, items, { notFetched: ['Q77'] }));
    expect(again.hash).toBe(res.hash);
    expect(again.files).toEqual(res.files);
    expect(again.issuesText).toBe(res.issuesText);
    // the order of the sources does not matter
    const shuffled = input(o, [...items].reverse(), { notFetched: ['Q77'] });
    shuffled.osm = [...shuffled.osm].reverse();
    expect(buildRegistry(shuffled).hash).toBe(res.hash);
    const moved = items.map((i) => (i.qid === 'Q1' ? wd('Q1', 'Great Gate', 104, 104, 30) : i));
    expect(buildRegistry(input(o, moved, { notFetched: ['Q77'] })).hash).not.toBe(res.hash);
    expect(Object.keys(res.files)).toContain('harness/data/landmarks_markers.json');
    expect(markersProblems(JSON.parse(res.files['harness/data/landmarks_markers.json']!))).toEqual([]);
  });
});

describe('source agreement (50 m rule)', () => {
  it('accepts a Wikidata point inside a large footprint however far from the centre, and flags one outside and over 50 m away', () => {
    const o = new Osm();
    o.square(0, 0, 400, { historic: 'castle', name: 'Big Fort', wikidata: 'Q1' });
    o.square(1000, 0, 20, { historic: 'monument', name: 'Small Arch', wikidata: 'Q2' });
    o.square(-1000, 0, 20, { historic: 'monument', name: 'Near Arch', wikidata: 'Q3' });
    const res = buildRegistry(input(o, [wd('Q1', 'Big Fort', 150, 120, 5), wd('Q2', 'Small Arch', 1000, 70, 5), wd('Q3', 'Near Arch', -1000, 40, 5)]));
    const fort = byName(res.entries, 'Big Fort');
    expect(fort.agreement!.osm_to_wikidata_m).toBeGreaterThan(150);
    expect(fort.agreement).toMatchObject({ inside_footprint: true, ok: true });
    expect(fort.place).toBe('ok');
    expect(byName(res.entries, 'Small Arch')).toMatchObject({ place: 'held', agreement: { inside_footprint: false, ok: false } });
    expect(byName(res.entries, 'Near Arch')).toMatchObject({ place: 'ok', agreement: { inside_footprint: false, ok: true } });
    expect(res.issues.map((i) => i.landmark)).toEqual([byName(res.entries, 'Small Arch').id]);
    expect(res.stats).toMatchObject({ held: 1, issues: { 'R-LM-01 open': 1 } });
  });

  it('an edit that checks the position by hand settles the issue: it stays listed, the entry is placed', () => {
    const o = new Osm();
    const arch = o.square(1000, 0, 20, { historic: 'monument', name: 'Small Arch', wikidata: 'Q2' });
    const [lat, lon] = at(1000, 0);
    const res = buildRegistry(input(o, [wd('Q2', 'Small Arch', 1000, 70, 5)], { overrides: { edits: [edit('ed1', { osm: `way/${arch}` }, { lat, lon, position_checked: true })] } }));
    const e = byName(res.entries, 'Small Arch');
    expect(e).toMatchObject({ place: 'ok', position: { source: 'hand' }, edits: ['ed1'] });
    expect(e.position.footprint_centre_offset_m).toBeLessThan(0.1);
    expect(e.flags).toEqual(expect.arrayContaining(['sources_disagree_over_50m', 'position_checked_by_hand']));
    expect(res.issues).toHaveLength(1);
    expect(res.issues[0]).toMatchObject({ rule: 'R-LM-01', status: 'overridden' });
  });
});

describe('tiers', () => {
  const base: ScoreInput = { sitelinks: 0, asi: null, footprintM2: 0, hasObject: true, arterialM: null, heroRoadM: null, station: false };

  it('the score orders a fixture of ten landmarks as expected', () => {
    const fixture: [string, Partial<ScoreInput>, number, string][] = [
      ['world famous fort on a hero road', { sitelinks: 76, asi: 'N-DL-1', footprintM2: 650000, heroRoadM: 20 }, 95, 'signature'],
      ['listed gate on an arterial', { sitelinks: 12, asi: 'N-DL-2', arterialM: 15 }, 64, 'signature'],
      ['famous observatory off the main roads', { sitelinks: 25, footprintM2: 6000 }, 50, 'signature'],
      ['listed tomb in a lane', { sitelinks: 4, asi: 'N-DL-3' }, 38, 'marker'],
      ['metro station', { sitelinks: 8, station: true }, 36, 'signature'],
      ['stadium on an arterial', { sitelinks: 9, footprintM2: 30000, arterialM: 40 }, 38, 'marker'],
      ['well known museum', { sitelinks: 14 }, 28, 'marker'],
      ['big park on a hero road', { footprintM2: 46000, heroRoadM: 5 }, 25, 'marker'],
      ['temple on an arterial', { arterialM: 30 }, 10, 'marker'],
      ['a named shrine in a lane', {}, 0, 'marker'],
    ];
    const scored = fixture.map(([name, c]) => ({ name, ...proposeTier({ ...base, ...c }) }));
    expect(scored.map((s) => [s.name, s.score, s.tier])).toEqual(fixture.map(([name, , score, tier]) => [name, score, tier]));
    const order = [...scored].sort((a, b) => b.score - a.score).map((s) => s.name);
    expect(order).toEqual([
      'world famous fort on a hero road', 'listed gate on an arterial', 'famous observatory off the main roads', 'listed tomb in a lane', 'stadium on an arterial',
      'metro station', 'well known museum', 'big park on a hero road', 'temple on an arterial', 'a named shrine in a lane',
    ]);
    // the score never names a hero, sitelinks stop counting at the cap, and a road only counts within the seen distance
    expect(scored.some((s) => s.tier === 'hero')).toBe(false);
    expect(proposeTier({ ...base, sitelinks: 500 }).score).toBe(SCORE.sitelinkCap);
    expect(proposeTier({ ...base, arterialM: SCORE.seenM + 1 }).score).toBe(0);
    // fame alone is not a building: with no OSM object it stays a marker whatever the score
    expect(proposeTier({ ...base, sitelinks: 76, asi: 'N-DL-1', hasObject: false })).toMatchObject({ score: 70, tier: 'marker' });
  });

  it('the owner list wins over the score, and an edit wins over both', () => {
    const low = proposeTier(base);
    const high = proposeTier({ ...base, sitelinks: 76, asi: 'N-DL-1' });
    expect(resolveTier(low, null, null)).toMatchObject({ tier: 'marker', from: 'score' });
    expect(resolveTier(low, { tier: 'hero', said: 'named by the owner' }, null)).toMatchObject({ tier: 'hero', from: 'owner_list' });
    expect(resolveTier(high, { tier: 'marker', said: 'the owner wants it plain' }, null)).toMatchObject({ tier: 'marker', from: 'owner_list' });
    expect(resolveTier(low, { tier: 'hero', said: 'named by the owner' }, { tier: 'signature', why: 'no model yet', id: 'ed1' })).toMatchObject({ tier: 'signature', from: 'override' });
    expect(resolveTier(high, null, { tier: 'marker', why: 'closed to the public', id: 'ed2' })).toMatchObject({ tier: 'marker', from: 'override' });
  });

  it('the build applies the same order: score, then the owner list by id, then an edit', () => {
    const o = new Osm();
    o.road([[-900, 30], [900, 30]], { highway: 'primary', name: 'Main Road' });
    o.road([[-900, 530], [900, 530]], { highway: 'tertiary', name: 'Hero Road' });
    const plain = o.square(0, 0, 20, { historic: 'monument', name: 'Plain Stone', wikidata: 'Q1' });
    const famous = o.square(300, 0, 80, { historic: 'castle', name: 'Famous Fort', wikidata: 'Q2' });
    o.square(-300, 500, 20, { historic: 'monument', name: 'Hero Road Stone', wikidata: 'Q3' });
    o.square(600, 1200, 20, { historic: 'monument', name: 'Lane Stone', wikidata: 'Q4' });
    const items = [wd('Q1', 'Plain Stone', 0, 0, 1), wd('Q2', 'Famous Fort', 300, 0, 40, { asi: 'N-DL-7' }), wd('Q3', 'Hero Road Stone', -300, 500, 1), wd('Q4', 'Lane Stone', 600, 1200, 1)];
    const scored = buildRegistry(input(o, items));
    expect(byName(scored.entries, 'Plain Stone')).toMatchObject({ tier: 'marker', tier_from: 'score', score: 2 + SCORE.arterial });
    expect(byName(scored.entries, 'Famous Fort')).toMatchObject({ tier: 'signature', tier_from: 'score', score: 40 + SCORE.asi + SCORE.bigFootprint + SCORE.arterial });
    expect(byName(scored.entries, 'Hero Road Stone').score).toBe(2 + SCORE.heroRoad);
    expect(byName(scored.entries, 'Lane Stone').score).toBe(2);
    expect(Object.keys(scored.files).sort()).toEqual([`harness/data/landmarks/${entryId('Famous Fort', 'Q2')}.json`, 'harness/data/landmarks_markers.json']);

    // the owner list claims by id (the name in the list is not the OSM name) and wins over the score, both ways
    const list: ListEntry[] = [
      { id: 'the_stone', name: 'The Stone of the City', tier: 'hero', ids: { wikidata: 'Q1' }, said: 'named by the owner in the interview' },
      { id: 'the_fort', name: 'That Fort', tier: 'marker', ids: { osm: `way/${famous}` }, said: 'the owner wants it plain' },
    ];
    const listed = buildRegistry(input(o, items, { list: { landmarks: list } }));
    expect(byName(listed.entries, 'Plain Stone')).toMatchObject({ id: 'the_stone', tier: 'hero', tier_from: 'owner_list' });
    expect(byName(listed.entries, 'Famous Fort')).toMatchObject({ id: 'the_fort', tier: 'marker', tier_from: 'owner_list' });
    expect(byName(listed.entries, 'Plain Stone').tier_reason).toContain('named by the owner in the interview');

    // an edit wins over the owner list and over the score
    const edits = [edit('ed1', { id: 'the_stone' }, { tier: 'signature' }), edit('ed2', { osm: `way/${famous}` }, { tier: 'hero' }), edit('ed3', { wikidata: 'Q4' }, { tier: 'signature' })];
    const edited = buildRegistry(input(o, items, { list: { landmarks: list }, overrides: { edits } }));
    expect(byName(edited.entries, 'Plain Stone')).toMatchObject({ tier: 'signature', tier_from: 'override' });
    expect(byName(edited.entries, 'Famous Fort')).toMatchObject({ tier: 'hero', tier_from: 'override' });
    expect(byName(edited.entries, 'Lane Stone')).toMatchObject({ tier: 'signature', tier_from: 'override' });
    expect(edited.stats.staleEdits).toEqual([]);
    expect(plain).toBeGreaterThan(0);
  });
});

describe('owner list, far landmarks and edits', () => {
  it('joins the two ids of an owner list line by hand and lists a landmark outside the stage with its real bearing', () => {
    const o = new Osm();
    const park = o.square(-200, 200, 100, { leisure: 'park', name: 'Circle Park' });
    const list: ListEntry[] = [
      { id: 'the_circle', name: 'The Circle', tier: 'hero', ids: { wikidata: 'Q10', osm: `way/${park}` }, said: 'named by the owner as a first hero' },
      { id: 'far_tower', name: 'Far Tower', tier: 'signature', hero_later: true, block_planned: 'south', ids: { wikidata: 'Q20' }, said: 'on the owner list, a hero later' },
      { id: 'gone', name: 'Gone', tier: 'signature', ids: { wikidata: 'Q99' }, said: 'on the owner list, not in the data' },
    ];
    const res = buildRegistry(input(o, [wd('Q10', 'The Circle district', -195, 205, 30, { instanceOf: ['central business district'] }), wd('Q20', 'Far Tower', 6000, 0, 90, { instanceOf: ['minaret'], heightM: 72.5 })], { list: { landmarks: list }, notFetched: ['Q99'] }, [`way/${park}`]));
    const c = res.entries.find((e) => e.id === 'the_circle')!;
    expect(c).toMatchObject({ match: 'owner_list', tier: 'hero', ids: { wikidata: 'Q10', osm: `way/${park}` }, far: false, block: 'centre' });
    expect(c.flags).toContain('joined_by_owner_list');
    expect(c.evidence).toContain('owner list line the_circle');
    const far = res.entries.find((e) => e.id === 'far_tower')!;
    expect(far).toMatchObject({ far: true, block: null, block_planned: 'south', district: null, area: null, tier: 'signature', hero_later: true, height_m: 72.5, height_source: 'wikidata', place: 'unplaced' });
    expect(far.bearing_deg).toBeCloseTo(90, 0);
    expect(far.distance_m).toBeGreaterThan(5990);
    expect(far.distance_m).toBeLessThan(6010);
    expect(far.flags).toContain('far_backdrop_only');
    expect(entryProblems({ _generated: 'by the test build', ...far }, 'far_tower')).toEqual([]);
    // a line that finds nothing is a problem the build reports, never a silent gap
    expect(res.problems).toEqual([expect.stringContaining('owner list gone: no candidate carries Q99 (Wikidata was not reachable')]);
  });

  it('an edit sets a hand height with its evidence, replaces an OSM footprint by a ring read from a photo, removes a landmark, and a stale edit is reported', () => {
    const o = new Osm();
    const hall = o.square(0, 0, 30, { historic: 'building', name: 'Old Hall', 'building:levels': '3' });
    const junk = o.square(500, 0, 30, { historic: 'yes', name: 'Not A Monument' });
    const ring = [at(-30, -20), at(30, -20), at(30, 20), at(-30, 20)];
    const edits: Edit[] = [
      edit('h1', { osm: `way/${hall}` }, { height_m: 24, height_source: 'reference', height_evidence: 'photo set old_hall_2019: eaves counted against the 3 m door' }),
      edit('f1', { osm: `way/${hall}` }, { footprint: { source: 'satellite', ring } }),
      edit('r1', { osm: `way/${junk}` }, undefined, 'remove'),
      edit('s1', { wikidata: 'Q404' }, { tier: 'hero' }),
    ];
    const before = byName(buildRegistry(input(o, [])).entries, 'Old Hall');
    expect(before).toMatchObject({ height_m: 9.6, height_source: 'osm_levels', confidence: { height: 'low' } });
    const res = buildRegistry(input(o, [], { overrides: { edits } }));
    const h = byName(res.entries, 'Old Hall');
    expect(h).toMatchObject({ height_m: 24, height_source: 'reference', footprint: { source: 'satellite', area_m2: 2400 }, confidence: { height: 'high', footprint: 'high' }, edits: ['h1', 'f1'] });
    expect(h.height_evidence).toContain('photo set old_hall_2019');
    expect(h.footprint!.evidence).toContain('replaces the OSM shape');
    expect(h.flags).toContain('footprint_from_photo_or_satellite');
    expect(res.entries.some((e) => e.name.en === 'Not A Monument')).toBe(false);
    expect(res.rejected.some((r) => r.name === 'Not A Monument' && r.why.startsWith('edit r1'))).toBe(true);
    expect(res.stats.staleEdits).toEqual(['s1']);
  });
});

describe('respect rule, underground and stations', () => {
  const o = new Osm();
  const mosque = o.square(0, 0, 40, { amenity: 'place_of_worship', religion: 'muslim', name: 'Friday Mosque' });
  o.node(300, 0, { amenity: 'place_of_worship', name: 'Lane Shrine' });
  const station = o.square(-400, 0, 60, { building: 'train_station', name: 'Circle Station', layer: '-2', wikidata: 'Q30' });
  const market = o.square(-400, 400, 80, { landuse: 'retail', name: 'Under Market', wikidata: 'Q31' });
  o.node(600, 600, { railway: 'station', station: 'subway', name: 'High Station', wikidata: 'Q32' });
  const items = [
    wd('Q30', 'Circle Station', -400, 0, 6, { instanceOf: ['metro station', 'underground station'] }), wd('Q31', 'Under Market', -400, 400, 9, { instanceOf: ['market'] }),
    wd('Q32', 'High Station', 600, 600, 4, { instanceOf: ['elevated station'] }), wd('Q33', 'Hill Temple', 900, -900, 3, { instanceOf: ['Hindu temple'] }),
  ];
  const plainStation = o.node(900, 300, { railway: 'station', station: 'subway', name: 'Plain Station' });
  const res = buildRegistry(input(o, items, {
    underground: { underground: [{ id: `way/${market}`, why: 'the market is under the park' }], surface: [] },
    infrastructure: [{ id: `way/${station}`, variant: 'MET-STN-UG', kind: 'underground feature' }, { id: `way/${station}`, variant: 'MET-STN-UG', kind: 'metro', mode: 'underground', line: 'Yellow Line' }, { id: `node/${plainStation}`, variant: 'MET-STN-EL', kind: 'metro', mode: 'elevated', line: 'Blue Line' }],
  }));

  it('every place of worship carries the no-combat field, whichever source says it is one', () => {
    for (const name of ['Friday Mosque', 'Lane Shrine', 'Hill Temple']) expect(byName(res.entries, name).worship, name).toMatchObject({ combat_arena: false });
    expect(byName(res.entries, 'Friday Mosque')).toMatchObject({ worship: { religion: 'muslim' }, ids: { osm: `way/${mosque}` } });
    expect(byName(res.entries, 'Lane Shrine').worship!.religion).toBe('unknown');
    expect(byName(res.entries, 'Hill Temple').worship!.religion).toBe('hindu');
    expect(res.stats.worship).toBe(3);
    expect(res.entries.filter((e) => !e.worship).every((e) => !WORSHIP_WORDS.test(e.kind) && !WORSHIP_WORDS.test(e.type))).toBe(true);
    // the schema refuses a place of worship without the field
    const broken = { ...byName(res.entries, 'Friday Mosque') } as Record<string, unknown>;
    delete broken['worship'];
    expect(entryProblems(broken, 'broken', true)).toEqual(['broken: a place of worship must carry worship.combat_arena false']);
  });

  it('underground structures are their own class: no shell, no height', () => {
    expect(byName(res.entries, 'Circle Station')).toMatchObject({ underground: { shell: 'none' }, station: { style: 'underground' }, height_m: null, tier: 'signature', ids: { osm: `way/${station}` } });
    expect(byName(res.entries, 'Under Market')).toMatchObject({ underground: { shell: 'none', why: expect.stringContaining('underground.json') }, height_m: null });
    expect(byName(res.entries, 'High Station')).toMatchObject({ station: { style: 'elevated', network: 'Delhi Metro' }, tier: 'signature' });
    expect(byName(res.entries, 'High Station').underground).toBeUndefined();
    expect(res.stats.underground).toBe(2);
  });

  it('a station takes its kit variant from the infrastructure variant map by OSM id, and its style when nothing else says it', () => {
    expect(byName(res.entries, 'Circle Station').infrastructure).toEqual({ variant: 'MET-STN-UG', line: 'Yellow Line', from: expect.stringContaining(`variant_map.json stations, way/${station}`) });
    expect(byName(res.entries, 'Plain Station')).toMatchObject({ station: { style: 'elevated', style_from: expect.stringContaining('infrastructure variant map') }, infrastructure: { variant: 'MET-STN-EL', line: 'Blue Line' } });
    expect(byName(res.entries, 'High Station').infrastructure).toBeUndefined();
  });
});

describe('landmark file checks', () => {
  it('pretty keeps rings on one line per point and ends with a new line', () => {
    expect(pretty({ ring: [[28.5, 77.1], [28.6, 77.2]], n: 1 })).toBe('{\n  "ring": [\n    [28.5, 77.1],\n    [28.6, 77.2]\n  ],\n  "n": 1\n}\n');
  });

  it('the schema names what is wrong with an entry, a list line and an edit', () => {
    const o = new Osm();
    o.square(0, 0, 20, { historic: 'monument', name: 'Stone', wikidata: 'Q1' });
    const good = { _generated: 'by the test build', ...byName(buildRegistry(input(o, [wd('Q1', 'Stone', 0, 0, 30, { asi: 'N-DL-1' })])).entries, 'Stone') } as Record<string, unknown>;
    expect(entryProblems(good, 'stone')).toEqual([]);
    expect(entryProblems({ ...good, ids: { wikidata: null, osm: null, asi: null } }, 'x')).toContain('x: no source id: an entry needs an OSM id or a Wikidata id');
    expect(entryProblems({ ...good, evidence: 'trust me' }, 'x')).toContain('x: the evidence line must name its source id (OSM way/..., Wikidata Q...)');
    expect(entryProblems({ ...good, tier: 'hero', tier_from: 'score' }, 'x')).toContain('x: a hero is named by the owner or an edit, never by the score');
    expect(entryProblems({ ...good, height_m: 12, height_source: 'none' }, 'x')).toContain('x: height_m and height_source do not agree (null goes with "none")');
    expect(entryProblems({ ...good, far: true }, 'x').length).toBeGreaterThan(0);
    expect(entryProblems({ ...good, area: null }, 'x')).toContain('x: a landmark inside the stage needs its area id');
    expect(listProblems({ _doc: 'the owner list of the test, long enough', landmarks: [{ id: 'a', name: 'A', tier: 'hero', ids: {}, said: 'named by the owner in the interview' }] })).toEqual(['landmark_list.json a: ids needs a wikidata or an osm id (a line joins by id, never by name)']);
    expect(overridesProblems({ _doc: 'the edits of the test, long enough', edits: [{ id: 'e', target: { id: 'a' }, action: 'set', set: { height_m: 12, colour: 'red' }, why: 'short', by: 'me', source: 'x', date: 'today' }] })).toEqual([
      'landmarks.overrides.json e: why must be an evidence line (what was read, where, when)', 'landmarks.overrides.json e: by, source and date (YYYY-MM-DD) are needed',
      expect.stringContaining('set.colour is not a field an edit can set'),
    ]);
  });
});

// ------------------------------------------------------------------ the committed registry of the pilot

const FILES = import.meta.glob('/harness/data/landmarks/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const DATA = import.meta.glob(['/harness/data/landmarks_markers.json', '/harness/data/landmark_list.json', '/harness/data/landmarks.overrides.json'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const landmarkFiles = Object.entries(FILES).map(([file, text]) => ({ file: file.replace(/^\//, ''), entry: JSON.parse(text) as Entry & { _generated: string } }));
const markers = JSON.parse(DATA['/harness/data/landmarks_markers.json'] as string) as { count: number; markers: Entry[] };
const all: Entry[] = [...landmarkFiles.map((f) => f.entry), ...markers.markers];
const get = (id: string): Entry => {
  const e = landmarkFiles.find((f) => f.entry.id === id)?.entry;
  if (!e) throw new Error(`harness/data/landmarks/${id}.json is missing`);
  return e;
};

describe('the pilot registry files (harness/data/landmarks/)', () => {
  it('every file in harness/data/landmarks/ passes the schema and is named by its id', () => {
    expect(landmarkFiles.length).toBeGreaterThan(20);
    const problems: string[] = [];
    for (const { file, entry } of landmarkFiles) {
      if (file !== `harness/data/landmarks/${entry.id}.json`) problems.push(`${file}: the file name is not the id ${entry.id}`);
      problems.push(...entryProblems(entry, file));
    }
    expect(problems).toEqual([]);
    expect(markersProblems(markers)).toEqual([]);
    expect(listProblems(JSON.parse(DATA['/harness/data/landmark_list.json'] as string))).toEqual([]);
    expect(overridesProblems(JSON.parse(DATA['/harness/data/landmarks.overrides.json'] as string))).toEqual([]);
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
  });

  it('holds at least 300 candidates, each with a source id and an evidence line', () => {
    expect(all.length).toBeGreaterThanOrEqual(300);
    for (const e of all) {
      expect(e.ids.osm ?? e.ids.wikidata, e.id).toMatch(/^(Q\d+|(node|way|relation)\/\d+)$/);
      expect(e.evidence, e.id).toMatch(/(OSM (node|way|relation)\/\d+|Wikidata Q\d+)/);
    }
  });

  it('holds the three heroes of the owner and Jama Masjid, with tier, hand height and a hand-checked position within 5 m of the OSM footprint centre', () => {
    const want: [string, string, string, number][] = [['cp_circle', 'hero', 'way/164675825', 11.5], ['india_gate', 'hero', 'way/361709652', 42], ['red_fort', 'hero', 'way/264863907', 33], ['jama_masjid', 'signature', 'way/295323609', 41]];
    for (const [id, tier, ringRef, height] of want) {
      const e = get(id);
      expect(e, id).toMatchObject({ tier, tier_from: 'owner_list', height_m: height, height_source: 'reference', far: false, block: 'centre', place: 'ok', position: { source: 'hand', ref: ringRef }, footprint: { source: 'osm', ref: ringRef } });
      expect(e.height_evidence, id).toMatch(/read 2026-11-13|hero road spec/);
      expect(e.position.evidence, id).toContain(`OSM ${id === 'jama_masjid' ? 'relation/3926057' : ringRef}`);
      expect(e.flags, id).toContain('position_checked_by_hand');
      // the centre of the OSM footprint, worked out here from the ring in the file, not taken from the build
      const ring = (e.footprint!.ring as [number, number][]).map(([lat, lon]) => proj.toWorld(lat, lon));
      const c = ringCentroid(ring);
      const g = proj.toGeo(c.x, c.z);
      expect(haversine(e.lat, e.lon, g.lat, g.lon), `${id}: metres from the OSM footprint centre`).toBeLessThan(5);
      expect(e.district, id).toBeTruthy();
      // the heroes stand in drawn areas; Jama Masjid stands between them, on a rule cell of the old city
      expect(e.area?.kind, id).toBe(id === 'jama_masjid' ? 'rule' : 'area');
    }
    expect(all.filter((e) => e.tier === 'hero').map((e) => e.id).sort()).toEqual(['cp_circle', 'india_gate', 'red_fort']);
    expect(get('jama_masjid')).toMatchObject({ hero_later: true, worship: { religion: 'muslim', combat_arena: false } });
  });

  it('flags every name-fallback match and lists every entry whose sources disagree by more than 50 m as an issue', () => {
    const named = all.filter((e) => e.match === 'name_distance');
    expect(named.length).toBeGreaterThan(0);
    for (const e of named) {
      expect(e.flags, e.id).toContain('fallback_name_match');
      expect(e.issue, e.id).toMatch(/^R-LM-0[12]:/);
    }
    const disagree = all.filter((e) => e.agreement && !e.agreement.ok);
    expect(disagree.length).toBeGreaterThan(0);
    for (const e of disagree) {
      expect(e.agreement!.osm_to_wikidata_m, e.id).toBeGreaterThan(50);
      expect(e.agreement!.inside_footprint, e.id).toBe(false);
      expect(e.issue, e.id).toBe(`R-LM-01:${e.ids.osm}:${e.ids.wikidata}`);
      expect(e.flags, e.id).toContain('sources_disagree_over_50m');
      expect(e.place === 'held' || e.flags.includes('position_checked_by_hand'), e.id).toBe(true);
    }
    // nothing over 50 m and outside its footprint slips through without the flag
    for (const e of all) if (e.agreement && e.agreement.osm_to_wikidata_m > 50 && !e.agreement.inside_footprint) expect(e.flags, e.id).toContain('sources_disagree_over_50m');
  });

  it('every place of worship entry carries the no-combat field', () => {
    const worship = all.filter((e) => e.worship);
    expect(worship.length).toBeGreaterThan(50);
    for (const e of worship) expect(e.worship, e.id).toMatchObject({ combat_arena: false });
    for (const e of all) if (WORSHIP_WORDS.test(e.kind) || WORSHIP_WORDS.test(e.type)) expect(e.worship, e.id).toMatchObject({ combat_arena: false });
  });

  it('gives every landmark its block, district and area, lists the far landmarks with their real bearing, and keeps underground structures out of shells', () => {
    for (const e of all.filter((x) => !x.far)) {
      expect(e.block, e.id).toBe('centre');
      expect(e.area, e.id).not.toBeNull();
    }
    const far = all.filter((e) => e.far);
    expect(far.map((e) => e.id).sort()).toEqual(['akshardham', 'humayuns_tomb', 'lotus_temple', 'qutub_minar', 'rashtrapati_bhavan']);
    // real bearings from India Gate: Qutub Minar to the south-south-west, Akshardham due east, Rashtrapati Bhavan due west
    expect(get('qutub_minar')).toMatchObject({ block: null, block_planned: 'qutub_mehrauli', height_m: 72.5 });
    expect(get('qutub_minar').bearing_deg).toBeGreaterThan(195);
    expect(get('qutub_minar').bearing_deg).toBeLessThan(210);
    expect(get('qutub_minar').distance_m).toBeGreaterThan(10000);
    expect(get('akshardham').bearing_deg).toBeGreaterThan(85);
    expect(get('akshardham').bearing_deg).toBeLessThan(95);
    expect(get('rashtrapati_bhavan').bearing_deg).toBeGreaterThan(265);
    expect(get('rashtrapati_bhavan').bearing_deg).toBeLessThan(280);
    for (const e of far) expect(e.height_m, e.id).toBeGreaterThan(30);
    // Rajiv Chowk is underground: no shell, no height
    const rajiv = all.filter((e) => /^Rajiv Chowk$/.test(e.name.en) && e.station);
    expect(rajiv.length).toBeGreaterThan(0);
    for (const e of rajiv) expect(e, e.id).toMatchObject({ underground: { shell: 'none' }, height_m: null });
    expect(all.find((e) => e.ids.osm === 'way/1393736849')).toMatchObject({ underground: { shell: 'none' } });
  });
});
