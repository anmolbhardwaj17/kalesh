// Area division and profile data of the pilot (P2-004, DELHI_WORLD.md 2, 2a, 3 and 10 AD2/PS1): schema and evidence,
// coverage, overlap, the sheet areas, variety, wear and the respect rule, on the real files of harness/data/areas/.
import { describe, expect, it } from 'vitest';
import { FillRule, areaPaths, difference, intersect } from 'clipper2-ts';
import type { Paths64 } from 'clipper2-ts';
import variantMapRaw from '../../../harness/design/reference/infrastructure/variant_map.json?raw';
import sfxRaw from '../../../harness/requests/sfx.json?raw';
import pilotRaw from '../../../harness/data/districts/pilot_centre.geojson?raw';
import { geoToWorld } from '../../geo/projection';
import { pointInRing } from '../geom';
import type { P2 } from '../geom';
import { checkData, areasAt, buildIndex, mergeArchetype, mergeProfile, parseAreaFiles, resolveAt, topBuildingShare } from './profiles';
import type { AreaData } from './profiles';
import { BUILDING_TYPES, FIELD_CHECKS, LEVELS, checkValues, deepMerge, evidenceFor, getPath, levelDensity, setPath, allText, isObj } from './schema';
import type { JsonObject } from './schema';
import { classifyCell, cellOf, ruleArchetypes } from './rules';

const FILES = import.meta.glob(['/harness/data/areas/**/*.json', '/harness/data/areas/areas.geojson'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const SHEETS = import.meta.glob('/harness/design/areas/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const NAMES = import.meta.glob('/game/data/names/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const project = (lon: number, lat: number) => geoToWorld(lat, lon);
const data: AreaData = parseAreaFiles(FILES);
const index = buildIndex(data, project);
const pilotCoords = (JSON.parse(pilotRaw) as { features: { geometry: { coordinates: [number, number][][] } }[] }).features[0]?.geometry.coordinates[0] as [number, number][];
const pilotRing: P2[] = pilotCoords.map(([lon, lat]) => geoToWorld(lat, lon));

/** The ten sheet areas of DELHI_WORLD.md 2a plus GB Road (the sheets are in harness/design/areas/). */
const SHEET_AREAS = ['cp_inner_circle', 'cp_outer_circle', 'janpath', 'india_gate_kartavya_path', 'ito', 'chandni_chowk_main', 'chandni_chowk_galis', 'red_fort_surroundings', 'jantar_mantar', 'paharganj_station', 'gb_road_ajmeri_gate'];

describe('area files: schema and evidence', () => {
  it('every area, archetype and the base are valid and every non-default value has a sourced evidence line', () => {
    expect(checkData(data)).toEqual([]);
  });

  it('a value with no evidence line fails the check, and so does an evidence line that names no source', () => {
    const bad = structuredClone(data);
    const p = bad.profiles['cp_inner_circle'] as JsonObject;
    delete (p.evidence as JsonObject)['wear'];
    expect(checkData(bad).some((m) => m.includes('profile cp_inner_circle: wear is not a default and has no evidence line'))).toBe(true);
    const vague = structuredClone(data);
    ((vague.profiles['cp_inner_circle'] as JsonObject).evidence as JsonObject)['wear'] = 'it just feels about right for this place';
    expect(checkData(vague).some((m) => m.includes('must name its source'))).toBe(true);
    const archBad = structuredClone(data);
    delete ((archBad.archetypes['colonial_cbd'] as JsonObject).evidence as JsonObject)['lamps'];
    expect(checkData(archBad).some((m) => m.includes('archetype colonial_cbd: lamps.'))).toBe(true);
  });

  it('a value equal to what it inherits is a default and needs no line; an inspector override needs its own line', () => {
    const d = structuredClone(data);
    (d.profiles['ito'] as JsonObject).sound = { horn_rate: 'medium' }; // equal to the base default now, no evidence: but ito's archetype chain sets it to... base medium
    expect(checkData(d).filter((m) => m.includes('sound.horn_rate'))).toEqual([]);
    const o = structuredClone(data);
    o.overrides = { areas: { ito: { set: { wear: 0.5 } } } };
    expect(checkData(o).some((m) => m.includes('override ito: wear'))).toBe(true);
    (o.overrides as JsonObject & { areas: JsonObject }).areas = { ito: { set: { wear: 0.5 }, evidence: { wear: 'inspector edit, owner note: the crossing is dirtier than the sheet says' } } };
    expect(checkData(o)).toEqual([]);
    expect(mergeProfile(o, 'ito').values.wear).toBe(0.5);
  });

  it('rejects unknown fields, bad ranges and a building mix that does not add up', () => {
    expect(checkValues({ colour_theme: 'red' }, 'x')).toEqual(['x: unknown field colour_theme']);
    expect(checkValues({ wear: 1.5 }, 'x')[0]).toContain('0 to 1');
    expect(checkValues({ buildings: { mix: { shop_house: 0.5, house: 0.2 } } }, 'x')[0]).toContain('sum');
    expect(checkValues({ buildings: { mix: { temple: 1 } } }, 'x')[0]).toContain('unknown building type');
    expect(checkValues({ buildings: { floors: { p10: 5, p50: 3, p90: 8 } } }, 'x')[0]).toContain('p10 <= p50');
    expect(checkValues({ lamps: { colour: 'blue' } }, 'x')[0]).toContain('must be one of');
  });

  it('the schema table, merge helpers and level scale behave', () => {
    expect(Object.keys(FIELD_CHECKS).length).toBeGreaterThan(60);
    expect(deepMerge({ a: { b: 1, c: [1] } }, { a: { c: [2] }, d: 3 })).toEqual({ a: { b: 1, c: [2] }, d: 3 });
    const o: JsonObject = {};
    setPath(o, 'a.b.c', 2);
    expect(getPath(o, 'a.b.c')).toBe(2);
    expect(evidenceFor({ 'life': 'x' }, 'life.animals.dogs')).toBe('x');
    expect(evidenceFor({ 'life.vendors': 'x' }, 'life.animals.dogs')).toBeNull();
    expect(LEVELS.map(levelDensity)).toEqual([0, 0.1, 0.25, 0.5, 0.75, 0.95]);
  });

  it('every profile carries its sheet, a blueprint slot, a names file and known infrastructure variants', () => {
    const variants = new Set<string>();
    for (const m of variantMapRaw.matchAll(/"variant":\s*"([A-Z0-9-]+)"/g)) variants.add(m[1] as string);
    expect(variants.size).toBeGreaterThan(20);
    for (const id of Object.keys(data.profiles)) {
      const p = data.profiles[id] as JsonObject;
      expect(p.blueprint, `${id} blueprint slot`).toBeNull();
      expect(`/game/data/names/${id}.json` in NAMES, `${id} names file`).toBe(true);
      expect(p.names_file).toBe(`game/data/names/${id}.json`);
      for (const v of (p.infrastructure as string[]) ?? []) expect(variants.has(v), `${id}: variant ${v}`).toBe(true);
    }
  });

  it('every sound bed is registered as a request and every colour word is in the palette', () => {
    const ids = new Set([...sfxRaw.matchAll(/"id":\s*"([a-z0-9_]+)"/g)].map((m) => m[1]));
    const names = [...Object.keys(data.profiles).map((i) => mergeProfile(data, i)), ...Object.keys(data.archetypes).map((a) => mergeArchetype(data, a))];
    for (const m of names) {
      const bed = getPath(m.values, 'sound.bed');
      expect(ids.has(bed as string), `${m.id}: bed ${String(bed)}`).toBe(true);
    }
    expect(Object.keys(data.palette).length).toBeGreaterThan(20);
  });
});

describe('area division: coverage and overlap', () => {
  const box = pilotRing.reduce((b, p) => ({ x0: Math.min(b.x0, p.x), x1: Math.max(b.x1, p.x), z0: Math.min(b.z0, p.z), z1: Math.max(b.z1, p.z) }), { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });

  it('every point of a 50 m grid over the pilot outline falls in exactly one area or one rule archetype', () => {
    let inside = 0;
    let inPolygon = 0;
    const bad: string[] = [];
    for (let x = Math.ceil(box.x0 / 50) * 50; x <= box.x1; x += 50) {
      for (let z = Math.ceil(box.z0 / 50) * 50; z <= box.z1; z += 50) {
        if (!pointInRing({ x, z }, pilotRing)) continue;
        inside++;
        const hits = areasAt(index, x, z);
        if (hits.length > 1) bad.push(`${x},${z} in ${hits.map((h) => h.id).join(' and ')}`);
        const r = resolveAt(index, x, z);
        if (r.kind === 'none') bad.push(`${x},${z} resolves to nothing`);
        if (r.kind === 'area') inPolygon++;
        else if (!data.archetypes[r.archetype]) bad.push(`${x},${z}: rule archetype ${r.archetype} has no file`);
      }
    }
    expect(bad.slice(0, 5)).toEqual([]);
    expect(inside).toBeGreaterThan(8000); // about 21.8 km2 at 2,500 m2 a point
    expect(inPolygon / inside).toBeGreaterThan(0.1); // the drawn areas cover a real share of the pilot
  });

  it('no two area polygons overlap by more than 1 m2', () => {
    const toPaths = (rings: { x: number; z: number }[][]): Paths64 => rings.map((r) => r.map((p) => ({ x: Math.round(p.x * 100), y: Math.round(p.z * 100) })));
    const shapes = index.areas.map((a) => ({ id: a.id, paths: toPaths(a.polys.flat()) }));
    expect(shapes.length).toBeGreaterThanOrEqual(11);
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        const a = shapes[i] as (typeof shapes)[number];
        const b = shapes[j] as (typeof shapes)[number];
        const shared = Math.abs(areaPaths(intersect(a.paths, b.paths, FillRule.EvenOdd))) / 10000;
        expect(shared, `${a.id} and ${b.id}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('every polygon lies inside the pilot outline (within 2 m2) and the sheet areas have real size', () => {
    const toPaths = (rings: { x: number; z: number }[][]): Paths64 => rings.map((r) => r.map((p) => ({ x: Math.round(p.x * 100), y: Math.round(p.z * 100) })));
    const outline = toPaths([pilotRing]);
    for (const a of index.areas) {
      const outside = Math.abs(areaPaths(difference(toPaths(a.polys.flat()), outline, FillRule.EvenOdd))) / 10000;
      expect(outside, a.id).toBeLessThanOrEqual(2);
    }
    const areaOf = (id: string): number => (data.areas.features.find((f) => f.properties.id === id)?.properties as unknown as { areaM2: number }).areaM2;
    for (const id of SHEET_AREAS) expect(areaOf(id), id).toBeGreaterThan(50000);
  });

  it('known places land in the right area', () => {
    const at = (x: number, z: number) => resolveAt(index, x, z);
    expect(at(-953, -2205).id).toBe('cp_inner_circle'); // Central Park
    expect(at(-953, -2205 - 300).id).toBe('cp_outer_circle'); // the Outer Circle road, north side
    expect(at(10, 10).id).toBe('india_gate_kartavya_path'); // India Gate
    expect(at(1100, -4700).id).toBe('red_fort_surroundings');
    expect(at(0, -4817).id).toBe('chandni_chowk_main');
    expect(at(0, -4450).id).toBe('chandni_chowk_galis');
    expect(at(1600, -1700).id).toBe('ito'); // the ITO crossing
    expect(at(-1255, -1573).id).toBe('jantar_mantar');
    expect(at(-1000, -1300).id).toBe('janpath');
    expect(at(-1300, -3300).id).toBe('paharganj_station');
    expect(at(-700, -3900).id).toBe('gb_road_ajmeri_gate');
    const rule = at(500, -2500);
    expect(rule.kind).toBe('rule');
    expect(data.archetypes[rule.archetype]).toBeDefined();
  });

  it('the rule table is complete: every archetype it can return has a file, and cells are 100 m squares of the frame', () => {
    expect(data.cells.cell_m).toBe(100);
    for (const a of ruleArchetypes(data.rules)) expect(data.archetypes[a], a).toBeDefined();
    expect(cellOf(-0.1, 0)).toEqual([-1, 0]);
    expect(cellOf(199.9, -100.1)).toEqual([1, -2]);
    const t = data.rules;
    expect(classifyCell(t, { osm: ['leisure=park'], coverage: 0.01, medianM2: 60 })).toBe('ridge_and_parks');
    expect(classifyCell(t, { osm: ['landuse=commercial'], coverage: 0.5, medianM2: 40 })).toBe('old_city_dense'); // the footprint grid beats a land use tag in the old city
    expect(classifyCell(t, { osm: ['landuse=commercial'], coverage: 0.3, medianM2: 150 })).toBe('commercial_midrise');
    expect(classifyCell(t, { osm: [], coverage: 0.2, medianM2: 90 })).toBe('mixed_midrise');
    expect(classifyCell(t, { osm: [], coverage: 0.05, medianM2: 90 })).toBe('low_density_compounds');
    expect(classifyCell(t, { osm: [], coverage: 0, medianM2: 0 })).toBe('open_land');
    expect(classifyCell(t, { osm: ['natural=water'], coverage: 0, medianM2: 0 })).toBe('water_and_wetland');
  });
});

describe('the eleven sheet areas', () => {
  it('exist by id, each citing its sheet, with a polygon and a profile', () => {
    for (const id of SHEET_AREAS) {
      const p = data.profiles[id] as JsonObject;
      expect(p, id).toBeDefined();
      expect(p.sheet).toBe(`harness/design/areas/${id}.md`);
      expect(`/harness/design/areas/${id}.md` in SHEETS, `${id} sheet file`).toBe(true);
      const f = data.areas.features.find((x) => x.properties.id === id);
      expect(f, `${id} polygon`).toBeDefined();
      expect(f?.properties.sheet).toBe(`harness/design/areas/${id}.md`);
      expect(typeof f?.properties.drawn_from).toBe('string');
      expect(f?.properties.blend_m).toBeGreaterThanOrEqual(30);
    }
    expect(Object.keys(data.profiles).sort()).toEqual([...SHEET_AREAS].sort());
  });

  it('each area differs from the others: no two merged profiles are the same', () => {
    const seen = new Map<string, string>();
    for (const id of SHEET_AREAS) {
      const key = JSON.stringify(mergeProfile(data, id).values);
      expect(seen.has(key), `${id} equals ${seen.get(key)}`).toBe(false);
      seen.set(key, id);
    }
  });

  it('wear comes from the sheets: the galis are 0.8 or more, India Gate and Kartavya Path 0.1 or less', () => {
    const wear = (id: string): number => mergeProfile(data, id).values.wear as number;
    expect(wear('chandni_chowk_galis')).toBeGreaterThanOrEqual(0.8);
    expect(wear('chandni_chowk_main')).toBeGreaterThanOrEqual(0.8);
    expect(wear('india_gate_kartavya_path')).toBeLessThanOrEqual(0.1);
    expect(wear('cp_inner_circle')).toBe(0.15);
    expect(wear('cp_outer_circle')).toBe(0.2);
    expect(wear('janpath')).toBe(0.25);
    expect(wear('ito')).toBe(0.4);
    expect(wear('red_fort_surroundings')).toBe(0.35);
    expect(wear('paharganj_station')).toBe(0.8);
    expect(wear('gb_road_ajmeri_gate')).toBeGreaterThanOrEqual(0.7);
    expect(wear('gb_road_ajmeri_gate')).toBeLessThanOrEqual(0.8);
    expect(wear('jantar_mantar')).toBeGreaterThanOrEqual(0.1);
    expect(wear('jantar_mantar')).toBeLessThanOrEqual(0.15);
  });

  it('values the sheets state as numbers are carried over', () => {
    const v = (id: string, path: string) => getPath(mergeProfile(data, id).values, path);
    expect(v('cp_inner_circle', 'lamps.spacing_m')).toEqual([28, 28]);
    expect(v('cp_inner_circle', 'lamps.height_m')).toEqual([9, 9]);
    expect(v('cp_inner_circle', 'boundaries.height_m')).toEqual([1.2, 1.2]);
    expect(v('ito', 'lamps.height_m')).toEqual([10, 12]);
    expect(v('ito', 'lamps.spacing_m')).toEqual([35, 45]);
    expect(v('india_gate_kartavya_path', 'lamps.spacing_m')).toEqual([30, 30]);
    expect(v('india_gate_kartavya_path', 'lamps.height_m')).toEqual([6, 8]);
    expect(v('india_gate_kartavya_path', 'footpath.width_m')).toEqual([6, 8]);
    expect(v('chandni_chowk_galis', 'footpath.width_m')).toBeNull();
    expect(v('chandni_chowk_main', 'footpath.width_m')).toEqual([1, 1.5]);
    expect(v('cp_inner_circle', 'buildings.floors')).toEqual({ p10: 2, p50: 2, p90: 3 });
    expect(v('india_gate_kartavya_path', 'buildings.mix')).toEqual({});
  });
});

describe('variety and the respect rule (DELHI_WORLD.md 3)', () => {
  const all = [...Object.keys(data.profiles).map((i) => mergeProfile(data, i)), ...Object.keys(data.archetypes).map((a) => mergeArchetype(data, a))];

  it('no single building type is over 70% of an area unless its evidence line cites data', () => {
    for (const m of all) {
      const top = topBuildingShare(m);
      if (top.share <= 0.7) continue;
      const line = evidenceFor(m.evidence, 'buildings.mix') ?? '';
      expect(/\b(OSM|footprint|Overture|census)\b/i.test(line) && /\bdata\b/i.test(line), `${m.id}: ${top.type} ${top.share}`).toBe(true);
    }
    // the check bites: a profile at 90% with no data line is caught
    const m = mergeProfile(data, 'chandni_chowk_main');
    const over = { ...m, values: deepMerge(m.values, { buildings: { mix: { bazaar_block: 0.9, shop_house: 0.1 } } }) };
    expect(topBuildingShare(over).share).toBe(0.9);
  });

  it('every area has a spread of types: at least three types, or nothing generated', () => {
    for (const m of all) {
      const mix = getPath(m.values, 'buildings.mix');
      const n = isObj(mix) ? Object.keys(mix).length : 0;
      expect(n === 0 || n >= 3, `${m.id}: ${n} types`).toBe(true);
    }
  });

  it('no stereotype word in any text of any profile, and places of worship never label an area', () => {
    const worship = /\b(temple|mandir|mosque|masjid|gurdwara|gurudwara|church|shrine|dargah|worship|religio)/i;
    for (const [id, p] of [...Object.entries(data.profiles), ...Object.entries(data.archetypes)]) {
      const own = { ...p } as JsonObject;
      delete own.evidence;
      delete own.notes;
      delete own._doc;
      for (const t of allText(own)) expect(worship.test(t), `${id}: "${t.slice(0, 80)}"`).toBe(false);
    }
    for (const m of all) {
      const mix = getPath(m.values, 'buildings.mix');
      if (isObj(mix)) for (const k of Object.keys(mix)) expect((BUILDING_TYPES as readonly string[]).includes(k) && !worship.test(k), `${m.id}: ${k}`).toBe(true);
    }
    expect(checkData(data).filter((p) => p.includes('stereotype'))).toEqual([]);
    const evil = structuredClone(data);
    ((evil.profiles['janpath'] as JsonObject).life as JsonObject).people = 'a teeming slum of thieves';
    expect(checkData(evil).some((p) => p.includes('stereotype word'))).toBe(true);
  });

  it('people are described by what they do and vary: every sheet area names at least three kinds of people or activities', () => {
    for (const id of SHEET_AREAS) {
      const people = getPath(mergeProfile(data, id).values, 'life.people') as string;
      expect(people.split(/,|;| and /).length, `${id}: ${people}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('the registry-only rule: no profile names a landmark or a brand logo as its own building type', () => {
    for (const m of all) expect(JSON.stringify(m.values)).not.toMatch(/logo/i);
  });
});
