// The pin list data/SOURCES.json (P1-007, MAP_REPAIR.md "Sources"): one entry per downloaded file with its hash,
// licence and credit text, and the licence table of the sources the bake reads. Pure: tools/bake/sources/pinfile.ts
// reads and writes the file.

/** One pinned download. `file` is repo-relative; sha256 and bytes are of the local file. */
export interface Pin {
  file: string;
  bytes: number;
  sha256: string;
  date: string;
  url: string;
  licence: string;
  licenceUrl?: string;
  credit: string;
  note?: string;
  /** The bake stage that fetched it (bench pins from P0-018 have none). */
  stage?: string;
  /** The box the file covers, in degrees, when it was cut to a box. */
  box?: { south: number; west: number; north: number; east: number };
  [extra: string]: unknown;
}

export interface SourcesFile {
  _doc?: string;
  files: Record<string, Pin>;
  unreachable: Record<string, { url: string; date: string; error: string }>;
}

/** A source the bake reads, with its licence row (checked at the source by P0-018, harness/bench/pilot_data/licences.mjs). */
export interface LicenceRow {
  licence: string;
  licenceUrl: string;
  credit: string;
  /** Shipped in the game (its data ends up in tiles). FABDEM is never shipped and never read by the bake. */
  shipped: boolean;
}

export type SourceKind = 'osm' | 'osm_turns' | 'overture_buildings' | 'gedtm30' | 'glo30' | 'wikidata';

export const SOURCE_KINDS: readonly SourceKind[] = ['osm', 'osm_turns', 'overture_buildings', 'gedtm30', 'glo30', 'wikidata'];

/** The licence rows of the bake sources (osm_turns, P1-032: the turn restrictions and turn lanes of the same OSM, its own small query), copied from the checked table (licences.mjs rows of the same id). */
export const LICENCES: Readonly<Record<SourceKind, LicenceRow>> = {
  osm: { licence: 'ODbL 1.0', licenceUrl: 'https://www.openstreetmap.org/copyright', credit: '© OpenStreetMap contributors', shipped: true },
  osm_turns: { licence: 'ODbL 1.0', licenceUrl: 'https://www.openstreetmap.org/copyright', credit: '© OpenStreetMap contributors', shipped: true },
  overture_buildings: { licence: 'ODbL 1.0', licenceUrl: 'https://docs.overturemaps.org/attribution/', credit: '© OpenStreetMap contributors, Overture Maps Foundation', shipped: true },
  gedtm30: { licence: 'CC BY 4.0', licenceUrl: 'https://zenodo.org/api/records/18887460', credit: 'GEDTM30: Ho, Y.-F. et al., OpenLandMap, CC BY 4.0, doi 10.5281/zenodo.18887460', shipped: true },
  glo30: {
    licence: 'Copernicus DEM licence (free of charge, any use including commercial, with the notice)',
    licenceUrl: 'https://registry.opendata.aws/copernicus-dem/',
    credit: '© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved',
    shipped: true,
  },
  wikidata: { licence: 'CC0 1.0', licenceUrl: 'https://www.wikidata.org/wiki/Wikidata:Copyright', credit: 'none needed (Wikidata, CC0)', shipped: true },
};

/** Sources that must never be read by the bake (non-commercial or share-alike data, decisions.md "Architecture answers, round 1"). */
export const FORBIDDEN = /fabdem/i;

const HEX64 = /^[0-9a-f]{64}$/;

/** Problems of the pin list: an entry without a licence or a credit line, a bad hash, a bad size. Empty when fine. */
export function pinProblems(src: SourcesFile): string[] {
  const out: string[] = [];
  if (!src || typeof src !== 'object' || !src.files || typeof src.files !== 'object') return ['no "files" object'];
  for (const [id, p] of Object.entries(src.files)) {
    if (typeof p.licence !== 'string' || p.licence.trim().length < 2) out.push(`${id}: no licence`);
    if (typeof p.credit !== 'string' || p.credit.trim().length < 2) out.push(`${id}: no credit line`);
    if (typeof p.sha256 !== 'string' || !HEX64.test(p.sha256)) out.push(`${id}: sha256 is not 64 hex characters`);
    if (!Number.isInteger(p.bytes) || p.bytes <= 0) out.push(`${id}: bytes ${String(p.bytes)} is not a positive integer`);
    if (typeof p.file !== 'string' || !p.file.startsWith('data/')) out.push(`${id}: file ${String(p.file)} is not under data/`);
    if (typeof p.url !== 'string' || p.url.length < 4) out.push(`${id}: no url`);
  }
  return out;
}

/** The pin id of a stage's file for a source kind. GLO-30 is one 1 degree tile shared by every stage that lies in it. */
export function pinId(stage: string, kind: SourceKind): string {
  return kind === 'glo30' ? 'glo30' : `${stage}_${kind}`;
}
