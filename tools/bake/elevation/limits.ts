// Limits of the elevation solver (P1-013, MAP_REPAIR.md "Elevation solver"): what a height profile may never do,
// per road class. Grades come from the lane model's class table (model.ts maxGrade). The rest is here, in one
// place, so the solver, the checks and the tests read the same numbers. Pure.
import { DECK_DEPTH, HEADROOM, maxGrade } from '../roads/model.ts';

export { DECK_DEPTH, HEADROOM, maxGrade };

/**
 * Smallest radius of a vertical curve (crest or sag) in metres, by class: the profile's second derivative never
 * exceeds 1 / radius. City design speeds: 500 m is K = 5 m per percent of grade change (about 50 km/h), 150 m is a
 * hump a car takes at 25 km/h. The Phase 0 flyover at ITO came out at 650 m at its tightest.
 */
const CURVE_RADIUS_M: Readonly<Record<string, number>> = {
  motorway: 500, trunk: 500, primary: 500, secondary: 400, tertiary: 300,
  unclassified: 150, residential: 150, living_street: 150, service: 150, road: 150,
  // a foot way keeps no sight distance: its crests and sags are a walking ramp's landings (P1-035)
  pedestrian: 30,
};
/** Ramps and slip roads turn tighter than the main line. */
export const LINK_CURVE_RADIUS_M = 250;

export const minCurveRadius = (cls: string, link: boolean): number => {
  const r = CURVE_RADIUS_M[cls] ?? 150;
  return link ? Math.min(r, LINK_CURVE_RADIUS_M) : r;
};

/** A road over a road, between the two carriageways: the headroom under the deck (IRC: 5.5 m) plus the deck itself. */
export const ROAD_OVER_ROAD_M = HEADROOM + DECK_DEPTH;
/** The same where the two centre lines cross and over a junction's centre, with the prototype's 0.3 m to spare (the Phase 0 decks keep their height). */
export const ROAD_OVER_ROAD_CENTRE_M = ROAD_OVER_ROAD_M + 0.3;
/** A road over a railway line: the wires need 6.5 m above the rail, plus the deck. */
export const RAIL_HEADROOM_M = 6.5;
export const ROAD_OVER_RAIL_M = RAIL_HEADROOM_M + DECK_DEPTH;
/** A railway bridge over a road: the road's headroom plus the girders and the ballast. */
export const RAIL_DECK_DEPTH_M = 1.5;
export const RAIL_OVER_ROAD_M = HEADROOM + RAIL_DECK_DEPTH_M;
/**
 * A railway bridge over a road stands on an embankment: the rail is this far above the ground model there (the
 * 60 m smoothing flattens a 15 m wide embankment away). The road dips for the rest, as Minto Road does.
 */
export const RAIL_EMBANKMENT_M = 4.5;
/** Deck over water: the underside of a bridge stays this far above the water (flood level and a margin). */
export const WATER_CLEARANCE_M = 2.5;
export const DECK_OVER_WATER_M = WATER_CLEARANCE_M + DECK_DEPTH;
/** A tunnel's carriageway lies this far under the ground model: the headroom and the roof. */
export const TUNNEL_ROOF_M = 1.2;
export const TUNNEL_COVER_M = HEADROOM + TUNNEL_ROOF_M;
/**
 * Crossfall: the two carriageways of one street, both at grade, never differ by more than this share of the
 * distance between their centre lines (IRC 86: 4 percent superelevation in a city).
 */
export const CROSSFALL_MAX = 0.04;
/** A junction surface never slopes more than this from an arm's cut to its centre. */
export const JUNCTION_SLOPE_MAX = 0.05;

/** Where a structure begins and ends: a road within this of the ground model is at grade. */
export const AT_GRADE_M = 0.6;
/** A road this far off the ground model is on (or in) a structure for certain. */
export const STRUCTURE_M = 2;
/** Above this a raised road stands on piers (a deck); under it, on fill between walls. */
export const DECK_MIN_M = 3;

/** A metro viaduct (P1-035): rail top to the underside of its girder, a 2 m box girder and the track plinth. */
export const METRO_DECK_DEPTH_M = 2.5;
/** Rail level of a viaduct over nothing in particular: a road at grade fits under it anywhere (it runs over streets). */
export const METRO_VIADUCT_M = HEADROOM + METRO_DECK_DEPTH_M;
/** The steepest a metro ramp climbs (Delhi Metro: 4 percent on its elevated ramps). */
export const METRO_MAX_GRADE = 0.04;
/** A foot over bridge: walking surface to the underside of its truss. */
export const FOOT_BRIDGE_DEPTH_M = 1;
/** Half the width of a foot bridge's deck. */
export const FOOT_BRIDGE_HALF_WIDTH_M = 1.5;
