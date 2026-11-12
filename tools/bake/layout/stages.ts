// Bake stages (P1-007, TECH.md "World layout" Stages): a stage is a named outline inside a block, with a margin, a data
// folder and the sources it reads. Defined in harness/data/districts.json under "stages". Pure: the driver passes the
// parsed districts.json and the outline text in.
import { FORBIDDEN, pinId } from '../pins.ts';
import type { SourceKind } from '../pins.ts';
import { SOURCE_KINDS } from '../pins.ts';
import { outlineAreaKm2, outlineBox, readOutline } from './outline.ts';
import type { GeoBox, Outline } from './outline.ts';

export interface StageDef {
  name: string;
  block: string;
  /** Path of the outline GeoJSON, relative to harness/data/. */
  outline: string;
  /** Extra data fetched around the outline on every side (m). */
  marginM: number;
  /** Folder of the stage's downloads (repo-relative, under the gitignored data/). */
  dataDir: string;
  /** Folder the tile step writes (repo-relative, gitignored); default game/world/tiles, the folder the game reads. */
  tiles?: string;
  sources: string[];
  ground: { primary: string; smoothM: number; fallback: string };
}

export interface DistrictsWithStages {
  blocks: { id: string; frameOrigin: { lat: number; lon: number } }[];
  stages?: Record<string, StageDef | string>;
}

export interface StageSource {
  kind: SourceKind;
  /** Pin id in data/SOURCES.json. */
  id: string;
  /** Where a new download is written (repo-relative). A pin of the same id may point at another file it keeps. */
  file: string;
  /** The box the file must cover; null for a whole-tile file (GLO-30). */
  box: GeoBox | null;
}

export interface StagePlan {
  id: string;
  def: StageDef;
  origin: { lat: number; lon: number };
  outline: Outline;
  areaKm2: number;
  /** Outline box plus the margin: the one continuous extract of every box-cut source. */
  box: GeoBox;
  sources: StageSource[];
}

/** The stage definitions of districts.json (keys starting with `_` are notes). */
export function stageDefs(file: DistrictsWithStages): Record<string, StageDef> {
  const out: Record<string, StageDef> = {};
  for (const [k, v] of Object.entries(file.stages ?? {})) if (!k.startsWith('_') && typeof v === 'object') out[k] = v;
  return out;
}

/** The 1 degree Copernicus tile name that holds a box ("N28_E077"); throws when the box spans two tiles. */
export function glo30Tile(box: GeoBox): string {
  const lat = Math.floor(box.south);
  const lon = Math.floor(box.west);
  if (Math.floor(box.north) !== lat || Math.floor(box.east) !== lon) throw new Error('the stage box spans two GLO-30 tiles: not supported yet');
  return `${lat >= 0 ? 'N' : 'S'}${String(Math.abs(lat)).padStart(2, '0')}_${lon >= 0 ? 'E' : 'W'}${String(Math.abs(lon)).padStart(3, '0')}`;
}

const FILE_OF: Record<SourceKind, (dir: string, box: GeoBox) => string> = {
  osm: (dir) => `${dir}/osm.json`,
  overture_buildings: (dir) => `${dir}/overture_buildings.json`,
  gedtm30: (dir) => `${dir}/gedtm30_window.json`,
  glo30: (_dir, box) => `data/dem/glo30_${glo30Tile(box)}.tif`,
  wikidata: (dir) => `${dir}/wikidata.json`,
};

/** Resolves a stage name into its plan. `outlineText` is the GeoJSON named by the stage's `outline`. */
export function stagePlan(file: DistrictsWithStages, id: string, outlineText: string): StagePlan {
  const def = stageDefs(file)[id];
  if (!def) throw new Error(`no stage "${id}" in harness/data/districts.json (stages: ${Object.keys(stageDefs(file)).join(', ') || 'none'})`);
  const block = file.blocks.find((b) => b.id === def.block);
  if (!block) throw new Error(`stage ${id}: block "${def.block}" is not in districts.json`);
  const outline = readOutline(outlineText, id);
  const box = outlineBox(outline.coords, def.marginM);
  const sources: StageSource[] = [];
  for (const name of def.sources) {
    if (FORBIDDEN.test(name)) throw new Error(`stage ${id}: source "${name}" is never read by the bake (non-commercial data)`);
    if (!(SOURCE_KINDS as readonly string[]).includes(name)) throw new Error(`stage ${id}: unknown source "${name}" (known: ${SOURCE_KINDS.join(', ')})`);
    const kind = name as SourceKind;
    sources.push({ kind, id: pinId(id, kind), file: FILE_OF[kind](def.dataDir, box), box: kind === 'glo30' ? null : box });
  }
  return { id, def, origin: block.frameOrigin, outline, areaKm2: outlineAreaKm2(outline.coords), box, sources };
}
