// Landmark registry, first pass (ARCH_OPTIONS LM1, DELHI_WORLD.md section 1 and 10): join OSM objects to Wikidata on
// the wikidata tag, fall back to name and distance (flagged), propose a tier from a score, and measure how far the
// OSM footprint centre lies from the Wikidata coordinate.
import type { OsmElement } from './osm.ts';

export interface WikidataItem {
  qid: string;
  label: string;
  labelHi: string | null;
  lat: number;
  lon: number;
  sitelinks: number;
  asi: string | null;
  inception: string | null;
  heightM: number | null;
  instanceOf: string[];
  heritage: string[];
  commons: string | null;
}

export interface OsmLandmark {
  /** "way/1", "node/2" or "relation/3". */
  id: string;
  name: string;
  wikidata: string | null;
  lat: number;
  lon: number;
  hasFootprint: boolean;
  areaM2: number;
  kind: string;
}

export type Tier = 'hero' | 'signature' | 'marker';

export interface Candidate {
  id: string;
  name: string;
  nameHi: string | null;
  ids: { wikidata: string | null; osm: string | null; asi: string | null };
  lat: number;
  lon: number;
  sources: string[];
  /** How OSM and Wikidata were joined: the wikidata tag, a name and distance match (flagged), or not at all. */
  match: 'wikidata_tag' | 'name_distance' | 'none';
  hasFootprint: boolean;
  footprintM2: number;
  /** Metres between the OSM centre and the Wikidata coordinate; null when one side is missing. */
  osmToWikidataM: number | null;
  flags: string[];
  score: number;
  tier: Tier;
  tierReason: string;
  kind: string;
  sitelinks: number;
  heightM: number | null;
  inception: string | null;
}

const EARTH = 6371008.8;

/** Great circle distance in metres between two WGS84 points. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(a)));
}

const LANDMARK_TAGS: readonly [string, readonly string[] | null][] = [
  ['historic', null], ['tourism', ['attraction', 'museum', 'viewpoint', 'gallery']], ['amenity', ['place_of_worship']],
  ['railway', ['station']], ['station', ['subway']], ['shop', ['mall']], ['leisure', ['stadium', 'park', 'garden']], ['barrier', ['city_wall']],
];

function landmarkKind(tags: Readonly<Record<string, string>>): string | null {
  for (const [key, values] of LANDMARK_TAGS) {
    const v = tags[key];
    if (v !== undefined && v !== 'no' && (values === null || values.includes(v))) return `${key}=${v}`;
  }
  return null;
}

/** OSM objects that may be landmarks: anything with a wikidata tag, and named objects with a landmark tag. */
export function osmLandmarks(elements: readonly OsmElement[]): OsmLandmark[] {
  const nodes = new Map<number, { lat: number; lon: number }>();
  const ways = new Map<number, OsmElement>();
  for (const e of elements) {
    if (e.type === 'node' && e.lat !== undefined && e.lon !== undefined) nodes.set(e.id, { lat: e.lat, lon: e.lon });
    else if (e.type === 'way' && (!ways.has(e.id) || e.tags)) ways.set(e.id, e);
  }
  const ringOf = (ids: readonly number[]): { lat: number; lon: number; area: number; closed: boolean } | null => {
    const pts = ids.map((id) => nodes.get(id)).filter((p): p is { lat: number; lon: number } => p !== undefined);
    if (pts.length === 0) return null;
    const lat0 = pts[0]?.lat ?? 0;
    const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
    const kz = 110540;
    let a = 0;
    let cx = 0;
    let cz = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i] as { lat: number; lon: number };
      const q = pts[(i + 1) % pts.length] as { lat: number; lon: number };
      const w = p.lon * kx * (q.lat * kz) - q.lon * kx * (p.lat * kz);
      a += w;
      cx += (p.lon + q.lon) * w;
      cz += (p.lat + q.lat) * w;
    }
    const closed = ids.length >= 4 && ids[0] === ids[ids.length - 1];
    if (!closed || Math.abs(a) < 1e-6) {
      return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length, area: 0, closed: false };
    }
    return { lat: cz / (3 * a), lon: cx / (3 * a), area: Math.abs(a) / 2, closed: true };
  };
  const out: OsmLandmark[] = [];
  const seen = new Set<string>();
  for (const e of elements) {
    const tags = e.tags;
    if (!tags) continue;
    const wikidata = tags['wikidata'] ?? null;
    const kind = landmarkKind(tags);
    const name = tags['name:en'] ?? tags['name'] ?? '';
    if (!wikidata && !(kind && name)) continue;
    if (tags['highway'] !== undefined || tags['route'] !== undefined || tags['boundary'] !== undefined) continue;
    const id = `${e.type}/${e.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    let geo: { lat: number; lon: number; area: number; closed: boolean } | null = null;
    if (e.type === 'node' && e.lat !== undefined && e.lon !== undefined) geo = { lat: e.lat, lon: e.lon, area: 0, closed: false };
    else if (e.type === 'way') geo = ringOf(e.nodes ?? []);
    else if (e.type === 'relation') {
      let best: { lat: number; lon: number; area: number; closed: boolean } | null = null;
      for (const m of e.members ?? []) {
        if (m.type !== 'way' || m.role === 'inner') continue;
        const g = ringOf(ways.get(m.ref)?.nodes ?? []);
        if (g && (!best || g.area > best.area)) best = g;
      }
      geo = best;
    }
    if (!geo) continue;
    out.push({ id, name, wikidata, lat: geo.lat, lon: geo.lon, hasFootprint: geo.closed, areaM2: Math.round(geo.area), kind: kind ?? (tags['building'] !== undefined ? `building=${tags['building']}` : 'other') });
  }
  return out;
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export interface JoinOptions {
  /** Names the owner listed: these are heroes when found. */
  heroes: readonly string[];
  /** Named by the pilot's design (a district is named after it): signature at least. */
  signatures: readonly string[];
  /** Fallback match radius in metres for a name match without a wikidata tag. */
  nameRadius: number;
}

/** Tier from the score: owner names win, then ASI listing and fame, then footprint size. */
export function proposeTier(c: Pick<Candidate, 'name' | 'ids' | 'sitelinks' | 'footprintM2' | 'kind'>, opts: JoinOptions): { score: number; tier: Tier; reason: string } {
  const n = norm(c.name);
  const named = (list: readonly string[]) => list.some((h) => n === norm(h));
  let score = Math.min(40, c.sitelinks * 2);
  const why: string[] = [];
  if (c.sitelinks > 0) why.push(`${c.sitelinks} sitelinks`);
  if (c.ids.asi) {
    score += 30;
    why.push(`ASI ${c.ids.asi}`);
  }
  if (c.footprintM2 >= 5000) {
    score += 10;
    why.push('large footprint');
  }
  const station = c.kind === 'railway=station' || c.kind === 'station=subway';
  if (station) return { score: score + 20, tier: 'signature', reason: ['metro or rail station: signature kit per station style', ...why].join('; ') };
  if (named(opts.heroes)) return { score: score + 100, tier: 'hero', reason: ['named by the owner', ...why].join('; ') };
  if (named(opts.signatures)) return { score: score + 50, tier: 'signature', reason: ['named in the pilot design', ...why].join('; ') };
  // fame alone is not a building: a Wikidata item with no OSM object and no ASI id may be a district, an event or a body
  if (score >= 40 && (c.ids.osm || c.ids.asi)) return { score, tier: 'signature', reason: why.join('; ') };
  if (score >= 40) return { score, tier: 'marker', reason: [...why, 'Wikidata only: check that it is a place before it is built'].join('; ') };
  return { score, tier: 'marker', reason: why.join('; ') || 'named place with a landmark tag' };
}

/** LM1: join OSM landmarks and Wikidata items on the wikidata tag; name and distance only as a flagged fallback. */
export function joinLandmarks(osm: readonly OsmLandmark[], wikidata: readonly WikidataItem[], opts: JoinOptions): Candidate[] {
  const byQid = new Map<string, WikidataItem>();
  for (const w of wikidata) byQid.set(w.qid, w);
  const usedQ = new Set<string>();
  const out: Candidate[] = [];
  const make = (o: OsmLandmark | null, w: WikidataItem | null, match: Candidate['match']): Candidate => {
    const flags: string[] = [];
    const d = o && w ? Math.round(haversine(o.lat, o.lon, w.lat, w.lon) * 10) / 10 : null;
    if (d !== null && d > 50) flags.push('osm_wikidata_over_50m');
    if (match === 'name_distance') flags.push('fallback_name_match');
    if (o && o.wikidata && !w) flags.push('wikidata_tag_not_in_box_query');
    const base = {
      name: o?.name || w?.label || '', ids: { wikidata: w?.qid ?? o?.wikidata ?? null, osm: o?.id ?? null, asi: w?.asi ?? null },
      sitelinks: w?.sitelinks ?? 0, footprintM2: o?.areaM2 ?? 0, kind: o?.kind ?? (w?.instanceOf[0] ?? 'wikidata item'),
    };
    const t = proposeTier(base, opts);
    return {
      id: (base.ids.wikidata ?? base.ids.osm ?? base.name).toLowerCase().replace(/[^a-z0-9]+/g, '_'), name: base.name, nameHi: w?.labelHi ?? null, ids: base.ids,
      lat: o?.hasFootprint ? o.lat : w?.lat ?? o?.lat ?? 0, lon: o?.hasFootprint ? o.lon : w?.lon ?? o?.lon ?? 0,
      sources: [...(o ? ['osm'] : []), ...(w ? ['wikidata'] : []), ...(w?.asi ? ['asi'] : [])], match, hasFootprint: o?.hasFootprint ?? false, footprintM2: base.footprintM2,
      osmToWikidataM: d, flags, score: t.score, tier: t.tier, tierReason: t.reason, kind: base.kind, sitelinks: base.sitelinks, heightM: w?.heightM ?? null, inception: w?.inception ?? null,
    };
  };
  // an OSM object with a footprint beats a node with the same wikidata tag
  const sorted = osm.slice().sort((a, b) => Number(b.hasFootprint) - Number(a.hasFootprint) || b.areaM2 - a.areaM2 || (a.id < b.id ? -1 : 1));
  const rest: OsmLandmark[] = [];
  for (const o of sorted) {
    if (!o.wikidata) {
      rest.push(o);
      continue;
    }
    if (usedQ.has(o.wikidata)) continue; // a second OSM object of the same item (a part, a node)
    usedQ.add(o.wikidata);
    out.push(make(o, byQid.get(o.wikidata) ?? null, byQid.has(o.wikidata) ? 'wikidata_tag' : 'none'));
  }
  for (const o of rest) {
    const n = norm(o.name);
    let hit: WikidataItem | null = null;
    if (n) {
      for (const w of wikidata) {
        if (usedQ.has(w.qid) || norm(w.label) !== n) continue;
        if (haversine(o.lat, o.lon, w.lat, w.lon) <= opts.nameRadius) {
          hit = w;
          break;
        }
      }
    }
    if (hit) usedQ.add(hit.qid);
    out.push(make(o, hit, hit ? 'name_distance' : 'none'));
  }
  for (const w of wikidata) if (!usedQ.has(w.qid)) out.push(make(null, w, 'none'));
  out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  return out;
}

/** Median, 90th percentile and count over 50 m of the OSM centre to Wikidata distances. */
export function distanceStats(cands: readonly Candidate[]): { n: number; medianM: number | null; p90M: number | null; over50: number; maxM: number | null } {
  const d = cands.map((c) => c.osmToWikidataM).filter((v): v is number => v !== null).sort((a, b) => a - b);
  if (d.length === 0) return { n: 0, medianM: null, p90M: null, over50: 0, maxM: null };
  return { n: d.length, medianM: d[Math.floor((d.length - 1) * 0.5)] as number, p90M: d[Math.floor((d.length - 1) * 0.9)] as number, over50: d.filter((v) => v > 50).length, maxM: d[d.length - 1] as number };
}
