// Loaders of the pilot data bench (P0-018): the pinned downloads in data/pilot/ turned into the bake's typed model
// (tools/bake/). Used by census.mjs and tiles.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { projector } from '../../../tools/geo/projection.ts';
import { buildMap } from '../../../tools/bake/osm.ts';
import { footprint } from '../../../tools/bake/buildings.ts';
import { sampleGrid } from '../../../tools/bake/ground.ts';
import { PILOT, inBox, readJson } from './lib.mjs';

/** One pilot area: its OSM elements, the map model in the district frame (origin at the area centre), its box in metres. */
export function loadArea(area) {
  const file = path.join(PILOT, 'osm', `${area.id}.json`);
  if (!fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const proj = projector(area.centre);
  const map = buildMap(raw.elements, (lat, lon) => proj.toWorld(lat, lon));
  const a = proj.toWorld(area.bbox.north, area.bbox.west);
  const b = proj.toWorld(area.bbox.south, area.bbox.east);
  const box = { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
  return { area, raw, proj, map, box, boxAreaM2: (box.maxX - box.minX) * (box.maxZ - box.minZ), osmBase: raw.osm3s?.timestamp_osm_base || null };
}

const ringOf = (coords, proj) => coords.map(([lon, lat]) => proj.toWorld(lat, lon));

/** Outer rings of a GeoJSON Polygon or MultiPolygon. */
function outerRings(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates[0]];
  if (geom.type === 'MultiPolygon') return geom.coordinates.map((p) => p[0]);
  return [];
}

let overtureCache = null;
/** Every Overture building row of the pilot download (parsed once). */
export function overtureBuildingRows() {
  if (overtureCache) return overtureCache;
  const file = path.join(PILOT, 'overture', 'buildings.json');
  overtureCache = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  return overtureCache;
}

/** Overture buildings whose first vertex is inside the area box, as footprints with the row kept in `row`. */
export function overtureFootprints(ctx) {
  const rows = overtureBuildingRows();
  if (!rows) return null;
  const out = [];
  for (const row of rows) {
    const geom = typeof row.geojson === 'string' ? JSON.parse(row.geojson) : row.geojson;
    const rings = outerRings(geom);
    rings.forEach((ring, i) => {
      if (!ring?.length || !inBox(ctx.area.bbox, ring[0][1], ring[0][0])) return;
      const dataset = row.sources?.[0]?.dataset || 'unknown';
      const f = footprint(i === 0 ? `overture/${row.id}` : `overture/${row.id}#${i}`, `overture:${dataset}`, ringOf(ring, ctx.proj), {}, typeof row.height === 'number' ? row.height : null, typeof row.num_floors === 'number' ? row.num_floors : null);
      if (f) {
        f.row = row;
        out.push(f);
      }
    });
  }
  return out;
}

/** Google Open Buildings rows inside the area box with at least the given confidence. */
export function googleFootprints(ctx, minConfidence = 0.7) {
  const file = path.join(PILOT, 'buildings', 'google_open_buildings_pilot.csv');
  if (!fs.existsSync(file)) return null;
  const out = [];
  let below = 0;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  for (let n = 1; n < lines.length; n++) {
    const line = lines[n];
    if (!line) continue;
    const m = /^([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+),"?(POLYGON\s*\(\((.*?)\)\)|MULTIPOLYGON.*?)"?,(\S*)$/.exec(line);
    if (!m || !m[6]) continue;
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    if (!inBox(ctx.area.bbox, lat, lon)) continue;
    if (Number(m[4]) < minConfidence) {
      below++;
      continue;
    }
    const ring = m[6].split(',').map((p) => {
      const [x, y] = p.trim().split(/\s+/).map(Number);
      return ctx.proj.toWorld(y, x);
    });
    const f = footprint(`google/${m[7] || n}`, 'google', ring);
    if (f) {
      f.confidence = Number(m[4]);
      out.push(f);
    }
  }
  out.belowConfidence = below;
  return out;
}

/** Microsoft footprints inside the area box. */
export function msFootprints(ctx) {
  const file = path.join(PILOT, 'buildings', 'ms_pilot.geojsonl');
  if (!fs.existsSync(file)) return null;
  const out = [];
  let n = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    n++;
    const f0 = JSON.parse(line);
    const ring = f0.geometry?.coordinates?.[0];
    if (!ring || !inBox(ctx.area.bbox, ring[0][1], ring[0][0])) continue;
    const h = f0.properties?.height;
    const f = footprint(`ms/${n}`, 'ms', ringOf(ring, ctx.proj), {}, typeof h === 'number' && h > 0 ? h : null);
    if (f) out.push(f);
  }
  return out;
}

/** Overture road segments (subtype road) that touch the area box: { id, cls, km, sources, row }. */
export function overtureSegments(ctx) {
  const file = path.join(PILOT, 'overture', 'segments.json');
  if (!fs.existsSync(file)) return null;
  const out = [];
  for (const row of JSON.parse(fs.readFileSync(file, 'utf8'))) {
    if (row.subtype !== 'road') continue;
    const geom = typeof row.geojson === 'string' ? JSON.parse(row.geojson) : row.geojson;
    if (geom?.type !== 'LineString') continue;
    if (!geom.coordinates.some(([lon, lat]) => inBox(ctx.area.bbox, lat, lon))) continue;
    const pts = ringOf(geom.coordinates, ctx.proj);
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    out.push({ id: row.id, cls: row.class, pts, km: len / 1000, datasets: [...new Set((row.sources || []).map((s) => s.dataset))], row });
  }
  return out;
}

/** A window of a local GeoTIFF height tile as a HeightGrid (tools/bake/ground.ts). */
async function tiffWindow(file, box, pad = 0.01) {
  const { fromFile } = await import('geotiff');
  const tiff = await fromFile(file);
  const image = await tiff.getImage();
  const [ox, oy] = image.getOrigin();
  const [rx, ry] = image.getResolution();
  const x0 = Math.max(0, Math.floor((box.west - pad - ox) / rx));
  const x1 = Math.min(image.getWidth(), Math.ceil((box.east + pad - ox) / rx));
  const y0 = Math.max(0, Math.floor((box.north + pad - oy) / ry));
  const y1 = Math.min(image.getHeight(), Math.ceil((box.south - pad - oy) / ry));
  const rasters = await image.readRasters({ window: [x0, y0, x1, y1] });
  const noData = image.getGDALNoData();
  const data = Float32Array.from(rasters[0], (v) => (noData !== null && v === noData ? NaN : v));
  const pixelIsPoint = image.getGeoKeys()?.GTRasterTypeGeoKey === 2;
  await tiff.close?.();
  return { west: ox + x0 * rx, north: oy + y0 * ry, dLon: rx, dLat: ry, width: x1 - x0, height: y1 - y0, data, cellCentre: !pixelIsPoint, pixelIsPoint };
}

/** The three height sources over a box: { gedtm, glo30, fabdem }, each a HeightGrid or null when not downloaded. */
export async function loadHeights(box) {
  const out = { gedtm: null, glo30: null, fabdem: null };
  const g = readJson(path.join(PILOT, 'dem', 'gedtm30_pilot_window.json'));
  if (g) {
    out.gedtm = { west: g.west, north: g.north, dLon: g.dLon, dLat: g.dLat, width: g.width, height: g.height, cellCentre: true, data: Float32Array.from(g.values, (v) => (v === g.noData || v > 1e30 ? NaN : v * g.scale + g.offset)) };
  }
  const glo = path.join(PILOT, 'dem', 'glo30_N28_E077.tif');
  if (fs.existsSync(glo)) out.glo30 = await tiffWindow(glo, box);
  const fab = path.join(PILOT, 'dem', 'fabdem_N28E077.tif');
  if (fs.existsSync(fab)) out.fabdem = await tiffWindow(fab, box);
  return out;
}

/** A sampler in district metres over a height grid: (x, z) -> metres or null. */
export function sampler(grid, proj) {
  return (x, z) => {
    const g = proj.toGeo(x, z);
    return sampleGrid(grid, g.lat, g.lon);
  };
}
