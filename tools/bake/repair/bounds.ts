// Auto-repair bounds (ARCH_OPTIONS AR1, MAP_REPAIR.md "Auto-repair bounds"), in one place. A repair applies on its own
// only at confidence 0.8 or more and a low impact. Low impact means exactly: a join of 5 m or less; a missing bridge
// layer tag; a building reaching 1.5 m or less into a class-default road width (the width gives way, the building
// stays); an exact duplicate footprint; a height outlier of 3 m or less; a sideways carriageway shift of 2.5 m or
// less (a slip road redraw of 2.5 m or less is such a shift; a lane count taken from the road ahead is one below
// primary class). Never automatic: anything on a hero road, a one-way with no pair (marked explained, never
// changed), a slip road redraw over 2.5 m, a change of lane count on a motorway, trunk or primary road. Pure.
import { AUTO_CONFIDENCE } from '../rules/types.ts';
import type { Issue, Measure, Proposal } from '../rules/types.ts';
import { topProposal } from '../rules/types.ts';

export const BOUNDS = {
  /** A join up to this long (m). */
  joinM: 5,
  /** A building reaching up to this far (m) into a class-default road width. */
  buildingIntoRoadM: 1.5,
  /** A height outlier up to this size (m). */
  heightOutlierM: 3,
  /** A sideways carriageway shift, or a slip road redraw, up to this far (m). */
  carriagewayShiftM: 2.5,
  /** A join the geometry supports (the end points at the road, nothing stands between them) up to this long (m), P1-030. */
  joinSupportedM: 8,
  /** A tunnel portal moved past a road crossing its mouth at grade, up to this far (m), P1-034. */
  portalM: 15,
} as const;

/** Classes on which a lane count never changes without a person. */
export const LANE_COUNT_NEVER: ReadonlySet<string> = new Set(['motorway', 'trunk', 'primary']);

/** Measures are compared in millimetres, so 5.0 m is in and 5.1 m is out whatever the float noise. */
const within = (v: number, limit: number): boolean => Math.round(v * 1000) <= Math.round(limit * 1000);

/** Is a change of this size a low impact one? */
export function isLowImpact(m: Measure): boolean {
  switch (m.kind) {
    case 'join': return within(m.m, BOUNDS.joinM) || (m.supported === true && within(m.m, BOUNDS.joinSupportedM));
    // P1-030, the owner 2026-11-13: basic fixes are the bake's own. A dead end the geometry does not support joining
    // is closed; an old city lane takes the width its buildings leave; a building on a road gives way (moved back,
    // cut or dropped once the road mesh is built); a way drawn twice is dropped; a hero road takes its own spec
    case 'dead_end': return true;
    case 'gali_width': return true;
    case 'building_gives_way': return true;
    case 'duplicate_way': return m.share >= 0.6;
    case 'hero_spec': return true;
    case 'bridge_layer_tag': return true;
    case 'building_into_road': return m.classDefault && m.fits && within(m.m, BOUNDS.buildingIntoRoadM);
    case 'duplicate_footprint': return m.exact;
    case 'height_outlier': return within(m.m, BOUNDS.heightOutlierM);
    case 'carriageway_shift': return within(m.m, BOUNDS.carriagewayShiftM);
    case 'slip_redraw': return within(m.m, BOUNDS.carriagewayShiftM);
    case 'portal': return within(m.m, BOUNDS.portalM);
    case 'lane_count': return !LANE_COUNT_NEVER.has(m.cls);
    default: return false;
  }
}

/** Fixes that never change a hero road's cross-section: they apply on a hero road too. */
export const HERO_SAFE: ReadonlySet<Measure['kind']> = new Set(['building_gives_way', 'duplicate_footprint', 'height_outlier', 'hero_spec', 'dead_end']);

export type Decision =
  | { mode: 'auto'; proposal: Proposal; why: string }
  | { mode: 'explained'; proposal: null; why: string }
  | { mode: 'queued'; proposal: Proposal | null; why: string };

/** What the bake does with an issue: repair it on its own, mark it explained and leave it, or queue it for a person. */
export function decide(i: Pick<Issue, 'proposals' | 'hero' | 'status' | 'heroSpec'>): Decision {
  if (i.status === 'explained' || i.proposals.some((p) => p.measure.kind === 'one_way_no_pair')) return { mode: 'explained', proposal: null, why: 'explained, never changed' };
  let top: Proposal | null = null;
  for (const p of i.proposals) if (!top || p.confidence > top.confidence) top = p;
  const auto = i.proposals.find((p) => p.confidence >= AUTO_CONFIDENCE && p.lowImpact);
  // a hero road with a spec file keeps its cross-section: only its own spec and fixes that leave the road alone apply
  if (i.hero && i.heroSpec !== false && !(auto && HERO_SAFE.has(auto.measure.kind))) return { mode: 'queued', proposal: top, why: `on the hero road ${i.hero}: never repaired automatically` };
  if (auto) return { mode: 'auto', proposal: auto, why: 'confidence 0.8 or more and a low impact' };
  return { mode: 'queued', proposal: top, why: top && top.confidence >= AUTO_CONFIDENCE ? 'over the low impact bound' : 'confidence under 0.8' };
}

/**
 * The policy table of P1-030 (the owner, 2026-11-13: "many of them would be very basic and can be handled by you
 * only"). An issue of one of these rules that the signed bounds would queue is settled by the bake: its top proposal
 * is the standard answer and goes into the map (the same patch that used to go in as provisional), with the reason
 * here on the record. Two kinds: fixes the rule measured itself (a shift, a lane count from the road ahead), and
 * notes for a later stage that decides the matter on its own whatever the mark says (the lane model's cluster rule,
 * the elevation solver). A rule not listed stays queued for the top-view judge pass, then for the owner.
 */
export const POLICY: Readonly<Record<string, string>> = {
  'R-TERR-03': 'the elevation solver works on the smoothed ground model whatever the size of an outlier in the raw height source: the profile is smoothed',
  'R-LANE-FIT-01': 'two carriageways need the room their lanes take: they move apart by what the rule measured',
  'R-LANE-FIT-02': 'a slip road leaves its main line at the taper rate of its class: it is redrawn by what the rule measured',
  'R-LANE-FIT-03': 'a lane count carries on along a street: the tagged count of the road ahead is taken',
  'R-ROAD-06': 'a lane count carries on along a street: the short piece takes the count of the road ahead',
  'R-LANE-01': 'lanes are conserved through a split or merge: the count that carries them is taken',
  'R-LANE-02': 'a piece too short for two tapers takes the lane count of the road ahead',
  'R-LANE-04': 'a diverge needs room for its gore: the branch moves by what the rule measured',
  'R-LANE-05': 'two roads beside each other need the room their lanes take: they move apart by what the rule measured',
  'R-JUNC-03': 'the lane model keeps or splits a node cluster by its own rule (P1-042): the mark changes nothing it builds',
  'R-ROAD-07': 'two carriageways within 16 m on one level are one divided street whatever their names: the pair is kept',
  'R-BRIDGE-03': 'the elevation solver holds the grade limit and lowers the road under a deck by itself: the mark records what it will do',
  'R-FOOT-02': 'a footpath cannot lie in another carriageway: it is left out on that side',
  'R-FOB-01': 'a foot bridge comes down to the nearest road: its stairs are linked to that road',
};

/** Rules whose proposals are only notes: a later stage (the lane model, the elevation solver) decides the matter itself. */
export const LATER_STAGE: ReadonlySet<string> = new Set(['R-TERR-03', 'R-JUNC-03', 'R-ROAD-07', 'R-BRIDGE-03']);

/**
 * The reason the bake settles a queued issue itself, or null when it stays queued. A hero road with a spec file is
 * never settled by this table (only its spec applies). The top proposal must be a clear first: a second proposal
 * within 0.1 of it is a real choice and goes to the judge pass.
 */
export function policyOf(i: Pick<Issue, 'rule' | 'proposals' | 'hero' | 'heroSpec'>): string | null {
  const why = POLICY[i.rule];
  if (!why) return null;
  if (i.hero && i.heroSpec !== false) return null;
  const top = topProposal(i);
  if (!top) return null;
  if (!LATER_STAGE.has(i.rule) && i.proposals.some((p) => p !== top && p.confidence > top.confidence - 0.1)) return null;
  return why;
}
