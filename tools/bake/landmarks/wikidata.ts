// Wikidata side of the landmark registry (P2-005, LM1): the SPARQL rows of the stage box (the pinned bake source
// wikidata.json) and single entities (the cache of items an OSM tag or the owner list names but the box query did
// not return) reduced to one shape, and the test of which Wikidata-only items are structures at all. Pure.
import type { WikidataItem } from './types.ts';

interface Cell {
  value: string;
}
/** One row of the SPARQL result (tools/bake/sources/readers.ts wikidataQuery). */
export type SparqlRow = Partial<Record<'item' | 'itemLabel' | 'hi' | 'coord' | 'sitelinks' | 'asi' | 'inception' | 'height' | 'instLabel' | 'heritageLabel' | 'commons', Cell>>;

const qidOf = (uri: string): string => uri.slice(uri.lastIndexOf('/') + 1);

/** "Point(77.2295 28.6129)" to [lat, lon]. */
export function parsePoint(wkt: string): [number, number] | null {
  const m = /^Point\(\s*(-?\d+(?:\.\d+)?(?:[eE]-?\d+)?)\s+(-?\d+(?:\.\d+)?(?:[eE]-?\d+)?)\s*\)$/.exec(wkt.trim());
  return m ? [Number(m[2]), Number(m[1])] : null;
}

const uniqSorted = (a: string[]): string[] => [...new Set(a)].sort();

/** The items of a SPARQL result: one per QID, whatever the row order (an item has one row per class and status). */
export function itemsFromRows(rows: readonly SparqlRow[]): WikidataItem[] {
  const by = new Map<string, SparqlRow[]>();
  for (const r of rows) {
    if (!r.item) continue;
    const q = qidOf(r.item.value);
    if (!/^Q\d+$/.test(q)) continue;
    let list = by.get(q);
    if (!list) by.set(q, (list = []));
    list.push(r);
  }
  const out: WikidataItem[] = [];
  for (const q of [...by.keys()].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
    const rs = by.get(q) as SparqlRow[];
    const pick = (k: keyof SparqlRow): string | null => uniqSorted(rs.map((r) => r[k]?.value).filter((v): v is string => v !== undefined))[0] ?? null;
    const all = (k: keyof SparqlRow): string[] => uniqSorted(rs.map((r) => r[k]?.value).filter((v): v is string => v !== undefined));
    const pt = parsePoint(pick('coord') ?? '');
    const heights = all('height').map(Number).filter((h) => Number.isFinite(h) && h > 0);
    const label = pick('itemLabel') ?? q;
    out.push({
      qid: q, label: /^Q\d+$/.test(label) ? '' : label, labelHi: pick('hi'), lat: pt ? pt[0] : null, lon: pt ? pt[1] : null, sitelinks: Number(pick('sitelinks') ?? 0) || 0, asi: pick('asi'),
      inception: pick('inception'), heightM: heights.length ? Math.max(...heights) : null, instanceOf: all('instLabel').filter((l) => !/^Q\d+$/.test(l)), heritage: all('heritageLabel').filter((l) => !/^Q\d+$/.test(l)), commons: pick('commons'),
    });
  }
  return out;
}

/** A cached entity (data/<stage>/wikidata_entities.json): the item with its class and status ids still unresolved. */
export interface CachedEntity extends Omit<WikidataItem, 'instanceOf' | 'heritage'> {
  instanceIds: string[];
  heritageIds: string[];
  /** True when Wikidata has no such item (deleted or a typing slip in the OSM tag). */
  missing?: boolean;
}

export interface EntityCache {
  _doc?: string;
  /** By QID. */
  items: Record<string, CachedEntity>;
  /** English labels of the class and status ids. */
  labels: Record<string, string>;
}

interface Snak {
  mainsnak?: { datavalue?: { value?: unknown } };
  rank?: string;
}
type Claims = Record<string, Snak[] | undefined>;

const values = (claims: Claims, p: string): unknown[] => {
  const all = (claims[p] ?? []).filter((s) => s.rank !== 'deprecated' && s.mainsnak?.datavalue?.value !== undefined);
  const preferred = all.filter((s) => s.rank === 'preferred');
  return (preferred.length ? preferred : all).map((s) => s.mainsnak?.datavalue?.value);
};

/** One entity of a wbgetentities answer (props labels, claims, sitelinks) to the cached shape. */
export function reduceEntity(qid: string, e: unknown): CachedEntity {
  const empty: CachedEntity = { qid, label: '', labelHi: null, lat: null, lon: null, sitelinks: 0, asi: null, inception: null, heightM: null, instanceIds: [], heritageIds: [], commons: null };
  const ent = e as { missing?: unknown; labels?: Record<string, { value?: string }>; claims?: Claims; sitelinks?: Record<string, unknown> } | undefined;
  if (!ent || ent.missing !== undefined || !ent.claims) return { ...empty, missing: true };
  const c = ent.claims;
  const coord = values(c, 'P625')[0] as { latitude?: number; longitude?: number } | undefined;
  const heights = values(c, 'P2048')
    .map((v) => {
      const q = v as { amount?: string; unit?: string };
      const n = Number(q.amount);
      // Q11573 is the metre; Q3710 the foot; Q174728 the centimetre
      const unit = (q.unit ?? '').slice((q.unit ?? '').lastIndexOf('/') + 1);
      return unit === 'Q11573' ? n : unit === 'Q3710' ? n * 0.3048 : unit === 'Q174728' ? n / 100 : NaN;
    })
    .filter((h) => Number.isFinite(h) && h > 0);
  const ids = (p: string): string[] => uniqSorted(values(c, p).map((v) => (v as { id?: string }).id).filter((v): v is string => typeof v === 'string'));
  const str = (p: string): string | null => {
    const v = values(c, p)[0];
    return typeof v === 'string' ? v : null;
  };
  const time = values(c, 'P571')[0] as { time?: string } | undefined;
  return {
    qid, label: ent.labels?.['en']?.value ?? '', labelHi: ent.labels?.['hi']?.value ?? null,
    lat: typeof coord?.latitude === 'number' ? coord.latitude : null, lon: typeof coord?.longitude === 'number' ? coord.longitude : null,
    sitelinks: Object.keys(ent.sitelinks ?? {}).length, asi: str('P1371'), inception: time?.time ? time.time.replace(/^\+/, '') : null,
    heightM: heights.length ? Math.round(Math.max(...heights) * 100) / 100 : null, instanceIds: ids('P31'), heritageIds: ids('P1435'), commons: str('P373'),
  };
}

/** Cached entities as items (class and status ids to their labels; an id with no label stays out). */
export function itemsFromCache(cache: EntityCache): WikidataItem[] {
  const out: WikidataItem[] = [];
  for (const q of Object.keys(cache.items).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))) {
    const e = cache.items[q] as CachedEntity;
    if (e.missing) continue;
    const lab = (ids: string[]): string[] => uniqSorted(ids.map((i) => cache.labels[i]).filter((l): l is string => !!l));
    out.push({ qid: q, label: e.label, labelHi: e.labelHi, lat: e.lat, lon: e.lon, sitelinks: e.sitelinks, asi: e.asi, inception: e.inception, heightM: e.heightM, instanceOf: lab(e.instanceIds), heritage: lab(e.heritageIds), commons: e.commons });
  }
  return out;
}

/** Wikidata class labels of things that stand on the ground and can be a landmark. */
const STRUCTURE = new RegExp(
  '\\b(' +
    [
      'temple', 'mandir', 'mosque', 'masjid', 'church', 'cathedral', 'gurdwara', 'gurudwara', 'dargah', 'shrine', 'synagogue', 'house of worship', 'tomb', 'mausoleum', 'grave', 'cemetery',
      'memorial', 'monument', 'museum', 'gallery', 'gate', 'fort', 'fortification', 'bastion', 'wall', 'tower', 'minaret', 'canopy', 'pavilion', 'naqqar khana', 'palace', 'haveli', 'stepwell',
      'observatory', 'market', 'bazaar', 'stadium', 'sports venue', 'cricket field', 'park', 'garden', 'library', 'theat(?:er|re)', 'cinema', 'convention cent(?:er|re)', 'venue',
      'station', 'bridge', 'weir', 'skyscraper', 'building', 'structure', 'house', 'dwelling', 'hotel', 'hospital', 'college', 'university', 'school', 'court', 'post office', 'mint', 'archives', 'square',
    ].join('|') +
    ')s?\\b',
  'i',
);
/** Class labels that hold one of the words above but are not a structure (an event, a body of people, a branch). */
const NOT_STRUCTURE = /\b(constituency|legislative house|upper house|house of the|session|organi[sz]ation|community|branch|gas station|radio station|attack|explosion|siege|battle|riot|invasion|sack|fire|collapse|crush|festival|exhibition|conference|edition|list article|destroyed)\b/i;

const WORSHIP_CLASS = /\b(temple|mandir|mosque|masjid|church|cathedral|gurdwara|gurudwara|dargah|shrine|synagogue|house of worship)\b/i;

/** True when one of the item's classes is a place of worship. */
export const isWorshipClass = (item: Pick<WikidataItem, 'instanceOf'>): boolean => item.instanceOf.some((l) => WORSHIP_CLASS.test(l) && !NOT_STRUCTURE.test(l));

/** True when the item is a person (Q5 by label): an OSM wikidata tag that names one names the subject of a statue. */
export const isPerson = (item: Pick<WikidataItem, 'instanceOf'>): boolean => item.instanceOf.some((l) => l === 'human');

/**
 * Why a Wikidata item with no OSM object stays out of the registry, or null when it is kept as a candidate. Kept: a
 * structure by class that some register or Wikipedia knows (an ASI id, a heritage status or at least one sitelink).
 * Fame alone is not a building: an event, a constituency, a company or a street has a coordinate too.
 */
export function wikidataOnlyReject(item: WikidataItem): string | null {
  if (item.lat === null || item.lon === null) return 'no coordinate';
  if (item.asi) return null; // listed by the ASI: a monument whatever its class
  const classes = item.instanceOf;
  if (classes.length === 0) return 'no class in Wikidata: cannot tell that it is a structure';
  const good = classes.filter((l) => STRUCTURE.test(l) && !NOT_STRUCTURE.test(l));
  if (good.length === 0) return `not a structure by class (${classes.join(', ')})`;
  if (item.sitelinks < 1 && item.heritage.length === 0) return `no register and no Wikipedia article names it (${good.join(', ')}, 0 sitelinks)`;
  return null;
}
