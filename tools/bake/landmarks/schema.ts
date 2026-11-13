// Schema checks of the landmark registry files (P2-005): a landmark file of harness/data/landmarks/, the generated
// landmarks_markers.json, the owner list landmark_list.json and the edits landmarks.overrides.json. Each check
// returns the problems as plain lines, empty when the file is fine. Pure.
import { MATCHES, TIERS } from './types.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, min = 1): v is string => typeof v === 'string' && v.trim().length >= min;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const ID = /^[a-z0-9_]+$/;
const QID = /^Q\d+$/;
const OSM_ID = /^(node|way|relation)\/\d+$/;
const HEIGHT_SOURCES = ['reference', 'wikidata', 'osm', 'osm_levels', 'none'];
const POSITION_SOURCES = ['osm_footprint_centre', 'osm_node', 'wikidata', 'hand'];
const PLACES = ['ok', 'held', 'unplaced'];
/** Words in a kind or a type that mean a place of worship: such an entry must carry the worship block. */
export const WORSHIP_WORDS = /\b(place_of_worship|mosque|masjid|temple|mandir|church|cathedral|gurdwara|gurudwara|dargah|synagogue|house of worship)\b/i;

const pair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]) && Math.abs(v[0]) <= 90 && Math.abs(v[1]) <= 180;

/** Problems of one registry entry. `marker` rows leave out licence_notes, art and the footprint ring. */
export function entryProblems(e: unknown, label: string, marker = false): string[] {
  const out: string[] = [];
  const bad = (m: string): void => {
    out.push(`${label}: ${m}`);
  };
  if (!isObj(e)) return [`${label}: not an object`];
  if (!isStr(e['id']) || !ID.test(e['id'])) bad(`id "${String(e['id'])}" is not lower case letters, digits and underscores`);
  const name = e['name'];
  if (!isObj(name) || !isStr(name['en']) || !(name['hi'] === null || isStr(name['hi']))) bad('name needs en (text) and hi (text or null)');
  const ids = e['ids'];
  if (!isObj(ids)) bad('ids is missing');
  else {
    if (!(ids['wikidata'] === null || (isStr(ids['wikidata']) && QID.test(ids['wikidata'])))) bad(`ids.wikidata "${String(ids['wikidata'])}" is not a Wikidata id`);
    if (!(ids['osm'] === null || (isStr(ids['osm']) && OSM_ID.test(ids['osm'])))) bad(`ids.osm "${String(ids['osm'])}" is not an OSM id`);
    if (!(ids['asi'] === null || isStr(ids['asi']))) bad('ids.asi is not text or null');
    if (ids['wikidata'] === null && ids['osm'] === null) bad('no source id: an entry needs an OSM id or a Wikidata id');
  }
  if (!isStr(e['match']) || !(MATCHES as readonly string[]).includes(e['match'])) bad(`match "${String(e['match'])}" is not one of ${MATCHES.join(', ')}`);
  if (!Array.isArray(e['sources']) || e['sources'].length === 0 || !e['sources'].every((s) => s === 'osm' || s === 'wikidata' || s === 'asi')) bad('sources must list osm, wikidata or asi');
  if (!isStr(e['evidence'], 25) || !/(OSM (node|way|relation)\/\d+|Wikidata Q\d+)/.test(e['evidence'])) bad('the evidence line must name its source id (OSM way/..., Wikidata Q...)');
  if (!isNum(e['lat']) || !isNum(e['lon']) || e['lat'] < 27.5 || e['lat'] > 29.5 || e['lon'] < 76 || e['lon'] > 78.5) bad(`lat, lon (${String(e['lat'])}, ${String(e['lon'])}) is not a place in or around Delhi`);
  const pos = e['position'];
  if (!isObj(pos) || !isStr(pos['source']) || !POSITION_SOURCES.includes(pos['source']) || !isStr(pos['ref']) || !isStr(pos['evidence'], 15)) bad('position needs source, ref and an evidence line');
  const fp = e['footprint'];
  if (fp !== null) {
    if (!isObj(fp) || !isStr(fp['source']) || !['osm', 'photo', 'satellite'].includes(fp['source']) || !isStr(fp['ref']) || !isNum(fp['area_m2']) || fp['area_m2'] <= 0) bad('footprint needs source (osm, photo or satellite), ref and a positive area_m2');
    else if (!marker && !(Array.isArray(fp['ring']) && fp['ring'].length >= 3 && fp['ring'].every(pair))) bad('footprint.ring needs three or more [lat, lon] pairs');
    else if (fp['source'] !== 'osm' && !isStr(fp['evidence'], 25)) bad('a footprint from a photo or satellite view needs its evidence line');
  }
  const h = e['height_m'];
  if (!(h === null || (isNum(h) && h > 0 && h < 400))) bad(`height_m ${String(h)} is not null or a height in metres`);
  if (!isStr(e['height_source']) || !HEIGHT_SOURCES.includes(e['height_source'])) bad(`height_source "${String(e['height_source'])}" is not one of ${HEIGHT_SOURCES.join(', ')}`);
  if ((h === null) !== (e['height_source'] === 'none')) bad('height_m and height_source do not agree (null goes with "none")');
  if (!isStr(e['height_evidence'], 15)) bad('height_evidence is missing');
  if (!(e['era'] === null || isStr(e['era']))) bad('era is not text or null');
  if (!isStr(e['type'])) bad('type is missing');
  if (!isStr(e['kind'])) bad('kind is missing');
  if (!isStr(e['tier']) || !(TIERS as readonly string[]).includes(e['tier'])) bad(`tier "${String(e['tier'])}" is not one of ${TIERS.join(', ')}`);
  if (marker && e['tier'] !== 'marker') bad('a row of the markers file must be a marker');
  if (!marker && e['tier'] === 'marker') bad('a marker has no file of its own');
  if (!isStr(e['tier_from']) || !['override', 'owner_list', 'score'].includes(e['tier_from'])) bad('tier_from must be override, owner_list or score');
  if (e['tier'] === 'hero' && e['tier_from'] === 'score') bad('a hero is named by the owner or an edit, never by the score');
  if (!isStr(e['tier_reason'], 10)) bad('tier_reason is missing');
  if (!isNum(e['score'])) bad('score is missing');
  if (typeof e['far'] !== 'boolean') bad('far must be true or false');
  if (e['far'] === true) {
    if (e['block'] !== null) bad('a far landmark has no block');
    if (!isNum(e['bearing_deg']) || e['bearing_deg'] < 0 || e['bearing_deg'] >= 360 || !isNum(e['distance_m']) || e['distance_m'] <= 0 || !isStr(e['bearing_from'], 10)) bad('a far landmark needs bearing_deg, distance_m and bearing_from');
    if (e['district'] !== null) bad('a far landmark has no district');
  } else {
    if (!isStr(e['block'])) bad('block is missing');
    if (!(e['district'] === null || isStr(e['district']))) bad('district is not text or null');
  }
  const area = e['area'];
  if (!(area === null || (isObj(area) && isStr(area['id']) && (area['kind'] === 'area' || area['kind'] === 'rule') && isStr(area['archetype'])))) bad('area needs id, kind (area or rule) and archetype, or null');
  if (e['far'] === false && area === null) bad('a landmark inside the stage needs its area id');
  const flags = e['flags'];
  if (!Array.isArray(flags) || !flags.every((f) => isStr(f))) bad('flags must be a list of text');
  const has = (f: string): boolean => Array.isArray(flags) && flags.includes(f);
  if (!isStr(e['place']) || !PLACES.includes(e['place'])) bad(`place "${String(e['place'])}" is not one of ${PLACES.join(', ')}`);
  if (e['match'] === 'name_distance' && !has('fallback_name_match')) bad('a name and distance match must carry the flag fallback_name_match');
  if (e['match'] === 'name_distance' && !isStr(e['issue'])) bad('a name and distance match must have its issue');
  const ag = e['agreement'];
  if (!(ag === null || (isObj(ag) && isNum(ag['osm_to_wikidata_m']) && pair(ag['wikidata']) && typeof ag['inside_footprint'] === 'boolean' && typeof ag['ok'] === 'boolean'))) bad('agreement is malformed');
  if (isObj(ag) && ag['ok'] === false) {
    if (!has('sources_disagree_over_50m')) bad('sources that disagree must carry the flag sources_disagree_over_50m');
    if (!isStr(e['issue']) || !e['issue'].startsWith('R-LM-01:')) bad('sources that disagree must have an R-LM-01 issue');
    if (e['place'] !== 'held' && !has('position_checked_by_hand')) bad('sources that disagree: the entry must be held until an edit checks its position');
  }
  // respect rule: every place of worship carries the no-combat field
  const worship = e['worship'];
  if (worship !== undefined && !(isObj(worship) && worship['combat_arena'] === false && isStr(worship['religion']) && isStr(worship['rule'], 10))) bad('worship must be { religion, combat_arena: false, rule }');
  if (worship === undefined && (WORSHIP_WORDS.test(String(e['kind'])) || WORSHIP_WORDS.test(String(e['type'])))) bad('a place of worship must carry worship.combat_arena false');
  const under = e['underground'];
  if (under !== undefined) {
    if (!(isObj(under) && under['shell'] === 'none' && isStr(under['why'], 10))) bad('underground must be { why, shell: "none" }');
    if (h !== null) bad('an underground structure has no height above the ground');
  }
  const st = e['station'];
  if (st !== undefined && !(isObj(st) && isStr(st['network']) && isStr(st['style']) && ['underground', 'elevated', 'surface', 'unknown'].includes(st['style']) && isStr(st['style_from']))) bad('station must be { network, style, style_from }');
  const infra = e['infrastructure'];
  if (infra !== undefined && !(isObj(infra) && isStr(infra['variant']) && isStr(infra['from'], 10))) bad('infrastructure must be { variant, from }');
  const conf = e['confidence'];
  if (!isObj(conf) || !isStr(conf['position']) || !isStr(conf['footprint']) || !isStr(conf['height'])) bad('confidence needs position, footprint and height');
  if (!marker) {
    if (!isStr(e['licence_notes'], 10)) bad('licence_notes is missing');
    if (!isObj(e['art']) || !isStr(e['art']['status'])) bad('art.status is missing');
    if (!isStr(e['_generated'], 10)) bad('the _generated line is missing (a landmark file is written by the build, edits go in landmarks.overrides.json)');
  }
  return out;
}

/** Problems of harness/data/landmarks_markers.json. */
export function markersProblems(file: unknown): string[] {
  if (!isObj(file)) return ['landmarks_markers.json: not an object'];
  const out: string[] = [];
  if (!isStr(file['_doc'], 20) || !isStr(file['stage']) || !isStr(file['block']) || !isStr(file['osm_base']) || !isStr(file['licence_notes'], 10)) out.push('landmarks_markers.json: the header needs _doc, stage, block, osm_base and licence_notes');
  const rows = file['markers'];
  if (!Array.isArray(rows)) return [...out, 'landmarks_markers.json: markers is not a list'];
  if (file['count'] !== rows.length) out.push(`landmarks_markers.json: count ${String(file['count'])} is not the number of rows ${rows.length}`);
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const id = isObj(r) && isStr(r['id']) ? r['id'] : `row ${i}`;
    if (seen.has(id)) out.push(`landmarks_markers.json: id ${id} is there twice`);
    seen.add(id);
    out.push(...entryProblems(r, `marker ${id}`, true));
  });
  return out;
}

/** Problems of the owner list harness/data/landmark_list.json. */
export function listProblems(file: unknown): string[] {
  if (!isObj(file) || !Array.isArray(file['landmarks'])) return ['landmark_list.json: needs a landmarks list'];
  const out: string[] = [];
  if (!isStr(file['_doc'], 20)) out.push('landmark_list.json: _doc is missing');
  const seen = new Set<string>();
  for (const l of file['landmarks'] as unknown[]) {
    if (!isObj(l) || !isStr(l['id']) || !ID.test(l['id'])) {
      out.push('landmark_list.json: a line has no valid id');
      continue;
    }
    const lab = `landmark_list.json ${l['id']}`;
    if (seen.has(l['id'])) out.push(`${lab}: the id is there twice`);
    seen.add(l['id']);
    if (!isStr(l['name'])) out.push(`${lab}: name is missing`);
    if (!isStr(l['tier']) || !(TIERS as readonly string[]).includes(l['tier'])) out.push(`${lab}: tier is not one of ${TIERS.join(', ')}`);
    const ids = l['ids'];
    if (!isObj(ids) || (ids['wikidata'] === undefined && ids['osm'] === undefined)) out.push(`${lab}: ids needs a wikidata or an osm id (a line joins by id, never by name)`);
    else {
      if (ids['wikidata'] !== undefined && !(isStr(ids['wikidata']) && QID.test(ids['wikidata']))) out.push(`${lab}: ids.wikidata is not a Wikidata id`);
      if (ids['osm'] !== undefined && !(isStr(ids['osm']) && OSM_ID.test(ids['osm']))) out.push(`${lab}: ids.osm is not an OSM id`);
    }
    if (!isStr(l['said'], 15)) out.push(`${lab}: said must record who named it and where`);
    if (l['hero_later'] !== undefined && typeof l['hero_later'] !== 'boolean') out.push(`${lab}: hero_later must be true or false`);
    if (l['block_planned'] !== undefined && !isStr(l['block_planned'])) out.push(`${lab}: block_planned must be a block id`);
  }
  return out;
}

const SET_KEYS = ['tier', 'name', 'type', 'era', 'height_m', 'height_source', 'height_evidence', 'lat', 'lon', 'position_checked', 'position_evidence', 'join_checked', 'footprint', 'front', 'extent', 'references'];

/** Problems of the edits file harness/data/landmarks.overrides.json. */
export function overridesProblems(file: unknown): string[] {
  if (!isObj(file) || !Array.isArray(file['edits'])) return ['landmarks.overrides.json: needs an edits list'];
  const out: string[] = [];
  if (!isStr(file['_doc'], 20)) out.push('landmarks.overrides.json: _doc is missing');
  const seen = new Set<string>();
  for (const e of file['edits'] as unknown[]) {
    if (!isObj(e) || !isStr(e['id'])) {
      out.push('landmarks.overrides.json: an edit has no id');
      continue;
    }
    const lab = `landmarks.overrides.json ${e['id']}`;
    if (seen.has(e['id'])) out.push(`${lab}: the id is there twice`);
    seen.add(e['id']);
    const t = e['target'];
    if (!isObj(t) || !(isStr(t['id']) || (isStr(t['wikidata']) && QID.test(t['wikidata'])) || (isStr(t['osm']) && OSM_ID.test(t['osm'])))) out.push(`${lab}: target needs a registry id, a Wikidata id or an OSM id`);
    if (e['action'] !== 'set' && e['action'] !== 'remove') out.push(`${lab}: action must be set or remove`);
    if (!isStr(e['why'], 25)) out.push(`${lab}: why must be an evidence line (what was read, where, when)`);
    if (!isStr(e['by']) || !isStr(e['source']) || !isStr(e['date']) || !/^\d{4}-\d{2}-\d{2}$/.test(e['date'])) out.push(`${lab}: by, source and date (YYYY-MM-DD) are needed`);
    const s = e['set'];
    if (e['action'] === 'set') {
      if (!isObj(s) || Object.keys(s).length === 0) {
        out.push(`${lab}: a set edit needs its set fields`);
        continue;
      }
      for (const k of Object.keys(s)) if (!SET_KEYS.includes(k)) out.push(`${lab}: set.${k} is not a field an edit can set (${SET_KEYS.join(', ')})`);
      if (s['tier'] !== undefined && !(isStr(s['tier']) && (TIERS as readonly string[]).includes(s['tier']))) out.push(`${lab}: set.tier is not one of ${TIERS.join(', ')}`);
      if (s['height_m'] !== undefined && !(isNum(s['height_m']) && s['height_m'] > 0 && s['height_m'] < 400)) out.push(`${lab}: set.height_m is not a height in metres`);
      if (s['height_source'] !== undefined && !(isStr(s['height_source']) && HEIGHT_SOURCES.includes(s['height_source']) && s['height_source'] !== 'none')) out.push(`${lab}: set.height_source is not a source`);
      if ((s['lat'] === undefined) !== (s['lon'] === undefined)) out.push(`${lab}: set.lat and set.lon go together`);
      if (s['lat'] !== undefined && !(isNum(s['lat']) && isNum(s['lon']))) out.push(`${lab}: set.lat and set.lon must be numbers`);
      const f = s['footprint'];
      if (f !== undefined) {
        if (!isObj(f) || !isStr(f['source']) || !['osm', 'photo', 'satellite'].includes(f['source'])) out.push(`${lab}: set.footprint.source must be osm, photo or satellite`);
        else if (f['source'] === 'osm' && !(isStr(f['ref']) && OSM_ID.test(f['ref']))) out.push(`${lab}: an osm footprint needs ref (an OSM id)`);
        else if (f['source'] !== 'osm' && !(Array.isArray(f['ring']) && f['ring'].length >= 3 && f['ring'].every(pair))) out.push(`${lab}: a photo or satellite footprint needs a ring of three or more [lat, lon] pairs`);
      }
    }
  }
  return out;
}
