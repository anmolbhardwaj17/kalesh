// The record and the checks of the area generator (P2-009): what the bake writes into health.json `areas` and the
// invariants of the acceptance. Pure.
import type { InvariantResult } from '../report/health.ts';
import type { CityStats, ParcelPlan } from './generator.ts';

/** Limits of the acceptance (P2-009). */
export const AREA_LIMITS = { floorDistance: 0.1, floorSample: 40, blendStep: 0.2, blendRise: 0.02, topShare: 0.75, topShareOverMix: 0.1 } as const;

export interface AreasRecord {
  stage: string;
  /** Part one: the parcels. */
  parcels: ParcelPlan['counts'];
  odd: Record<string, number>;
  infill: ParcelPlan['infill']['stats'];
  blueprints: { files: number; blocks: number; replaced: number };
  /** Part two (absent until the tile step). */
  city?: CityStats;
  transects?: { id: string; name: string; area: string; samples: number; maxStep: number; maxRise: number; from: number; to: number }[];
  offRoad?: { count: number; areaM2: number };
  placementBudgetBytes: number;
  files: Record<string, string | string[]>;
  ms: { parcels: number; city: number; parts: Record<string, number> };
}


export const mb = (b: number): string => `${(b / 1048576).toFixed(3)} MB`;

/** The checks of the acceptance on the record. */
export function areaInvariants(rec: AreasRecord): InvariantResult[] {
  const s = rec.city;
  if (!s) return [];
  const c = rec.parcels;
  const L = AREA_LIMITS;
  const accounted = c.in - c.dropped - c.replacedByBlueprint + c.blueprintBlocks + c.lots;
  const floorsOff = s.profiles.filter((p) => p.drawn >= L.floorSample && p.classDiff > L.floorDistance);
  const tested = s.profiles.filter((p) => p.drawn >= L.floorSample);
  const blendOff = (rec.transects ?? []).filter((t) => t.maxStep > L.blendStep || t.maxRise > L.blendRise);
  const typeOff = s.profiles.filter((p) => p.shells >= L.floorSample && p.topShare > Math.max(L.topShare, p.mixTop + L.topShareOverMix));
  const p = s.placements;
  return [
    { id: 'AREA-01.every_parcel', ok: accounted === c.out && s.shells + s.notAShape === c.out, detail: `${c.in} footprints: ${c.dropped} dropped as slivers or scraps and ${c.replacedByBlueprint} replaced by a blueprint (each with a log line), ${c.blueprintBlocks} blueprint blocks and ${c.lots} lots added: ${c.out} parcels, ${s.shells} shells and ${s.notAShape} log lines` },
    { id: 'AREA-02.osm_tags', ok: s.tagOverOne === 0, detail: `${s.tagged} OSM tagged buildings, largest difference ${s.tagMaxFloorDiff} floors` },
    { id: 'AREA-03.floors', ok: floorsOff.length === 0, detail: floorsOff.length === 0 ? `${tested.length} profiles with ${L.floorSample} shells or more: every floor class (up to p10, up to p50, up to p90, over) within ${Math.max(0, ...tested.map((x) => x.classDiff))} of its profile's share (limit ${L.floorDistance}); bin by bin the largest distance is ${Math.max(0, ...tested.map((x) => x.distanceAll))}` : floorsOff.map((x) => `${x.key}: a class ${x.classDiff} off on ${x.drawn} shells`).join('; ') },
    { id: 'AREA-04.blend', ok: blendOff.length === 0 && (rec.transects?.length ?? 0) > 0, detail: (rec.transects ?? []).map((t) => `${t.id}: step ${t.maxStep}, rise ${t.maxRise}`).join('; ') || 'no transect' },
    { id: 'AREA-05.variety', ok: s.variety.sameInTile === 0 && typeOff.length === 0, detail: `${s.variety.sameInTile} pairs side by side the same inside a tile (${s.variety.sameAcrossTiles} across a tile line)${typeOff.length ? `; one type over its share: ${typeOff.map((x) => `${x.key} ${x.topType} ${x.topShare}`).join(', ')}` : '; no type over 75 percent of a profile unless its own mix asks for it'}` },
    { id: 'AREA-06.off_the_road', ok: (rec.offRoad?.count ?? 1) === 0, detail: `${rec.offRoad?.count ?? '?'} parcels share more than 0.01 m2 with a road face` },
    { id: 'AREA-07.placement_bytes', ok: p.overBudget.length === 0, detail: `densest tile ${p.largest ? `${p.largest.id} ${mb(p.largest.bytes)}` : 'none'} (budget ${mb(rec.placementBudgetBytes)})` },
  ];
}
