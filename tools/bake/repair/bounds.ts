// Auto-repair bounds (ARCH_OPTIONS AR1, MAP_REPAIR.md "Auto-repair bounds"), in one place. A repair applies on its own
// only at confidence 0.8 or more and a low impact. Low impact means exactly: a join of 5 m or less; a missing bridge
// layer tag; a building reaching 1.5 m or less into a class-default road width (the width gives way, the building
// stays); an exact duplicate footprint; a height outlier of 3 m or less; a sideways carriageway shift of 2.5 m or
// less (a slip road redraw of 2.5 m or less is such a shift; a lane count taken from the road ahead is one below
// primary class). Never automatic: anything on a hero road, a one-way with no pair (marked explained, never
// changed), a slip road redraw over 2.5 m, a change of lane count on a motorway, trunk or primary road. Pure.
import { AUTO_CONFIDENCE } from '../rules/types.ts';
import type { Issue, Measure, Proposal } from '../rules/types.ts';

export const BOUNDS = {
  /** A join up to this long (m). */
  joinM: 5,
  /** A building reaching up to this far (m) into a class-default road width. */
  buildingIntoRoadM: 1.5,
  /** A height outlier up to this size (m). */
  heightOutlierM: 3,
  /** A sideways carriageway shift, or a slip road redraw, up to this far (m). */
  carriagewayShiftM: 2.5,
} as const;

/** Classes on which a lane count never changes without a person. */
export const LANE_COUNT_NEVER: ReadonlySet<string> = new Set(['motorway', 'trunk', 'primary']);

/** Measures are compared in millimetres, so 5.0 m is in and 5.1 m is out whatever the float noise. */
const within = (v: number, limit: number): boolean => Math.round(v * 1000) <= Math.round(limit * 1000);

/** Is a change of this size a low impact one? */
export function isLowImpact(m: Measure): boolean {
  switch (m.kind) {
    case 'join': return within(m.m, BOUNDS.joinM);
    case 'bridge_layer_tag': return true;
    case 'building_into_road': return m.classDefault && m.fits && within(m.m, BOUNDS.buildingIntoRoadM);
    case 'duplicate_footprint': return m.exact;
    case 'height_outlier': return within(m.m, BOUNDS.heightOutlierM);
    case 'carriageway_shift': return within(m.m, BOUNDS.carriagewayShiftM);
    case 'slip_redraw': return within(m.m, BOUNDS.carriagewayShiftM);
    case 'lane_count': return !LANE_COUNT_NEVER.has(m.cls);
    default: return false;
  }
}

export type Decision =
  | { mode: 'auto'; proposal: Proposal; why: string }
  | { mode: 'explained'; proposal: null; why: string }
  | { mode: 'queued'; proposal: Proposal | null; why: string };

/** What the bake does with an issue: repair it on its own, mark it explained and leave it, or queue it for a person. */
export function decide(i: Pick<Issue, 'proposals' | 'hero' | 'status'>): Decision {
  if (i.status === 'explained' || i.proposals.some((p) => p.measure.kind === 'one_way_no_pair')) return { mode: 'explained', proposal: null, why: 'explained, never changed' };
  let top: Proposal | null = null;
  for (const p of i.proposals) if (!top || p.confidence > top.confidence) top = p;
  if (i.hero) return { mode: 'queued', proposal: top, why: `on the hero road ${i.hero}: never repaired automatically` };
  const auto = i.proposals.find((p) => p.confidence >= AUTO_CONFIDENCE && p.lowImpact);
  if (auto) return { mode: 'auto', proposal: auto, why: 'confidence 0.8 or more and a low impact' };
  return { mode: 'queued', proposal: top, why: top && top.confidence >= AUTO_CONFIDENCE ? 'over the low impact bound' : 'confidence under 0.8' };
}
