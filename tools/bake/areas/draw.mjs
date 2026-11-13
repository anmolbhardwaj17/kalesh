// Area drawing script (P2-004, DELHI_WORLD.md 2 "Area division from open data", AD2). Run once to write
// harness/data/areas/areas.geojson from the hand-picked waypoints below; the geojson is the data of record afterwards
// (the inspector edits profile values in overrides.json, never these polygons).
//   node tools/bake/areas/draw.mjs [--write]
// Waypoints are bake-local metres (origin India Gate, +x east, -z north) read off the repaired road graph and the OSM
// outlines (data/pilot_centre/graph.json, read only): every boundary follows a road, a rail edge or an outline line.
// Overlaps are resolved by priority (earlier areas keep the ground), and every polygon is clipped to the pilot outline.
// This file may touch files (it is an .mjs script, not part of the pure bake); the bake never imports it.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { FillRule, JoinType, EndType, areaPaths, difference, inflatePaths, intersect, union } = require('clipper2-ts');
const { geoToWorld, worldToGeo } = await import('../../geo/projection.ts');

const SCALE = 10000;
const CP = [-953, -2205]; // centre of Central Park (circle fit through the Inner, Middle and Outer Circle road edges)

/** Hexagon ring road round India Gate (centre line points read off the graph render). */
const HEX = [[28, -294], [183, -367], [361, -289], [509, -133], [509, 167], [494, 233], [328, 311], [183, 378], [78, 378], [-133, 200], [-178, 133], [-172, -167], [-167, -178]];

/** @type {{id:string,name:string,archetype:string,sheet:string,blend_m:number,focus:string,drawn_from:string,parts:any[]}[]} Highest priority first. */
export const SPEC = [
  { id: 'cp_inner_circle', name: 'Connaught Place, Inner Circle and colonnades', archetype: 'colonial_cbd', sheet: 'harness/design/areas/cp_inner_circle.md', blend_m: 40, focus: 'cp', drawn_from: 'Middle Circle road (radius 235 m round the Central Park centre): the park, the inner colonnade ring and the radial mouths', parts: [{ disc: [CP, 235] }] },
  { id: 'cp_outer_circle', name: 'Connaught Place, Outer Circle and radials', archetype: 'colonial_cbd', sheet: 'harness/design/areas/cp_outer_circle.md', blend_m: 60, focus: 'cp', drawn_from: 'Middle Circle to 30 m outside the Outer Circle road (radius 350 m)', parts: [{ disc: [CP, 350] }] },
  { id: 'india_gate_kartavya_path', name: 'India Gate and Kartavya Path', archetype: 'ceremonial_avenue', sheet: 'harness/design/areas/india_gate_kartavya_path.md', blend_m: 90, focus: 'india_gate', drawn_from: 'the hexagon ring road round India Gate, and the Kartavya Path vista (lawns and canals either side) west to the pilot edge', parts: [{ poly: HEX }, { poly: [[-590, -153], [-172, -153], [-172, 87], [-590, 87]] }] },
  { id: 'red_fort_surroundings', name: 'Red Fort, moat and Lahori Gate plaza', archetype: 'heritage_fort_precinct', sheet: 'harness/design/areas/red_fort_surroundings.md', blend_m: 60, focus: 'chandni_chowk', drawn_from: 'Netaji Subhash Marg on the west, the Ring Road (Mahatma Gandhi Marg) on the north and east, the south wall at Delhi Gate', parts: [{ poly: [[730, -5280], [1230, -5280], [1477, -5020], [1477, -4330], [730, -4330]] }] },
  { id: 'chandni_chowk_main', name: 'Chandni Chowk, the main avenue', archetype: 'old_city_bazaar', sheet: 'harness/design/areas/chandni_chowk_main.md', blend_m: 40, focus: 'chandni_chowk', drawn_from: 'the Chandni Chowk road centre line from the west end to Netaji Subhash Marg, 50 m either side (the shop frontage)', parts: [{ corridor: [[[-603, -4851], [-300, -4835], [0, -4817], [265, -4803], [513, -4789], [713, -4777], [725, -4775]], 50] }] },
  { id: 'chandni_chowk_galis', name: 'Chandni Chowk, the galis', archetype: 'old_city_lanes', sheet: 'harness/design/areas/chandni_chowk_galis.md', blend_m: 40, focus: 'chandni_chowk', drawn_from: 'the lane fabric between Chandni Chowk (north), Esplanade and Jama Masjid Road (east), Chawri Bazar to Hauz Qazi (south) and the old city lane edge (west)', parts: [{ poly: [[-602, -4833], [511, -4772], [511, -4500], [383, -4444], [378, -4289], [289, -4278], [289, -4178], [86, -4169], [-1, -4131], [-110, -4089], [-212, -4047], [-277, -4024], [-367, -4144], [-472, -4256], [-567, -4556]] }] },
  { id: 'gb_road_ajmeri_gate', name: 'GB Road and Ajmeri Gate', archetype: 'old_city_bazaar', sheet: 'harness/design/areas/gb_road_ajmeri_gate.md', blend_m: 40, focus: 'none', drawn_from: 'the road from the station forecourt past Ajmeri Gate along Shraddhanand Road (GB Road), 45 m either side, and the Ajmeri Gate side station forecourt', parts: [{ corridor: [[[-570, -3250], [-570, -3690], [-632, -3809], [-742, -3973], [-848, -4141], [-930, -4275], [-1005, -4415]], 45] }, { poly: [[-700, -3480], [-560, -3480], [-560, -3200], [-700, -3200]] }] },
  { id: 'paharganj_station', name: 'Paharganj and the station concourse', archetype: 'old_city_bazaar', sheet: 'harness/design/areas/paharganj_station.md', blend_m: 60, focus: 'none', drawn_from: 'Desh Bandhu Gupta Road and the flyover (north), the rail yard edge (east), Main Bazar Road (south), the end of the hotel stacks (west)', parts: [{ poly: [[-1638, -3578], [-1005, -3469], [-1005, -3207], [-1069, -3207], [-1536, -3118], [-1638, -3144]] }] },
  { id: 'ito', name: 'ITO and the Vikas Marg crossing', archetype: 'institutional_offices', sheet: 'harness/design/areas/ito.md', blend_m: 90, focus: 'none', drawn_from: 'Bahadur Shah Zafar Marg and the Ring Road at ITO, the flyover loops east to the Yamuna side, Safdar Hashmi Marg and Todarmal Lane', parts: [{ poly: [[1150, -1900], [1980, -1900], [1980, -1360], [1150, -1360]] }] },
  { id: 'jantar_mantar', name: 'Jantar Mantar, Sansad Marg and Jantar Mantar Road', archetype: 'institutional_offices', sheet: 'harness/design/areas/jantar_mantar.md', blend_m: 60, focus: 'cp', drawn_from: 'the observatory garden, Sansad Marg from the Outer Circle to Patel Chowk (60 m either side) and the short Jantar Mantar Road', parts: [{ poly: [[-1365, -1663], [-1145, -1663], [-1145, -1483], [-1365, -1483]] }, { corridor: [[[-1146, -1915], [-1205, -1826], [-1276, -1716], [-1356, -1594], [-1384, -1557], [-1419, -1490], [-1457, -1418]], 60] }, { corridor: [[[-1339, -1316], [-1338, -1376], [-1327, -1458], [-1319, -1473]], 35] }] },
  { id: 'janpath', name: 'Janpath', archetype: 'commercial_midrise', sheet: 'harness/design/areas/janpath.md', blend_m: 60, focus: 'cp', drawn_from: 'Janpath from the Outer Circle south to the pilot edge, 75 m either side (the market row and the office blocks)', parts: [{ corridor: [[[-974, -1884], [-981, -1700], [-988, -1500], [-1000, -1300], [-1010, -1130], [-1020, -1000], [-1030, -900], [-1033, -850]], 75] }] },
];

const toPath = (ring) => ring.map(([x, z]) => ({ x: Math.round(x * SCALE), y: Math.round(z * SCALE) }));
const disc = ([cx, cz], r, n = 72) => Array.from({ length: n }, (_, k) => [cx + r * Math.cos((2 * Math.PI * k) / n), cz + r * Math.sin((2 * Math.PI * k) / n)]);
function partPaths(part) {
  if (part.poly) return [toPath(part.poly)];
  if (part.disc) return [toPath(disc(part.disc[0], part.disc[1]))];
  const [pts, half] = part.corridor;
  return inflatePaths([toPath(pts)], half * SCALE, JoinType.Round, EndType.Butt, 2);
}
const norm = (paths) => union(paths, FillRule.NonZero);

/** Result paths as GeoJSON polygons [outer, ...holes] in [lon, lat]. */
function toPolygons(paths) {
  if (!paths.length) return [];
  let big = 0;
  for (const p of paths) if (Math.abs(areaPaths([p])) > Math.abs(big)) big = areaPaths([p]);
  const outers = paths.filter((p) => Math.sign(areaPaths([p])) === Math.sign(big));
  const holes = paths.filter((p) => Math.sign(areaPaths([p])) !== Math.sign(big));
  const inside = (pt, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; };
  const ll = (p) => { const r = p.map((q) => { const g = worldToGeo(q.x / SCALE, q.y / SCALE); return [Math.round(g.lon * 1e7) / 1e7, Math.round(g.lat * 1e7) / 1e7]; }); r.push(r[0]); return r; };
  return outers.map((o) => [ll(o), ...holes.filter((h) => inside(h[0], o)).map(ll)]);
}

export function draw(pilotGeo) {
  const outline = [toPath(pilotGeo.map(([lon, lat]) => { const w = geoToWorld(lat, lon); return [w.x, w.z]; }))];
  let taken = [];
  const features = [];
  for (const a of SPEC) {
    let shape = norm(a.parts.flatMap(partPaths));
    shape = intersect(shape, outline, FillRule.NonZero);
    if (taken.length) shape = difference(shape, taken, FillRule.NonZero);
    taken = norm([...taken, ...shape]);
    const polys = toPolygons(shape);
    const { parts: _p, ...props } = a;
    features.push({ type: 'Feature', properties: { ...props, areaM2: Math.round(Math.abs(areaPaths(shape)) / (SCALE * SCALE)) }, geometry: polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys } });
  }
  return { type: 'FeatureCollection', _doc: 'Area polygons of the pilot centre (P2-004, DELHI_WORLD.md 2). WGS84 lon/lat. Hand-drawn along roads by tools/bake/areas/draw.mjs (waypoints and the road each follows are in its drawn_from line); clipped to the pilot outline; no two overlap. Anything inside the pilot outline and in no polygon takes the archetype of its 100 m cell in rule_cells.json (tools/bake/areas/rules.ts).', features };
}

if (process.argv[1] && process.argv[1].endsWith('draw.mjs')) {
  const pilot = JSON.parse(fs.readFileSync('harness/data/districts/pilot_centre.geojson', 'utf8')).features[0].geometry.coordinates[0];
  const out = draw(pilot);
  for (const f of out.features) console.log(f.properties.id.padEnd(28), String(f.properties.areaM2).padStart(9), 'm2', f.geometry.type);
  if (process.argv.includes('--write')) { fs.writeFileSync('harness/data/areas/areas.geojson', JSON.stringify(out, null, 1) + '\n'); console.log('written'); }
}
