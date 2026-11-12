// Lane-level road model of the bake (ARCH_OPTIONS LN1, MAP_REPAIR.md "Lane-level road model"): the types every
// road step shares, and the Delhi class defaults. Feasibility prototype of P0-019: plain data, modelled on OpenDRIVE.
//
// A road is a list of strips. A strip is a run of stations along a reference line; every station has a frame
// (a point and the unit vector to its left), a height, and the lateral position of every lane border. So a taper,
// a lane drop or a gore is only numbers: a lane's width function is the distance between two borders along s.
// Left is the left of the station order (walking from station 0 to the last one); lanes are listed left to right.
// Plane coordinates are district metres: x east, z south (north is -Z). The left of a direction (dx, dz) is (dz, -dx).
import type { P2 } from '../geom.ts';

export type LaneType = 'drive' | 'parking' | 'gore' | 'kerb' | 'footpath' | 'planter' | 'median';

export interface LaneDef {
  type: LaneType;
  /** 1: traffic runs with the station order, -1 against it, 0 no traffic. */
  dir: 1 | -1 | 0;
  /** Nominal width in metres. */
  width: number;
  /** Height of the lane surface above the carriageway (a kerb, a footpath). */
  raise: number;
  /** gali: the one shared lane of an old city lane, narrower than MIN_DRIVE_LANE_M by design (never below GALI_MIN_LANE_M). */
  tag?: 'gali';
}

/** Lanes left to right and the lateral position of the leftmost border (positive is left of the reference line). */
export interface CrossSection {
  lanes: LaneDef[];
  offset: number;
}

export interface Station extends P2 {
  /** Unit vector to the left of the station order. */
  nx: number;
  nz: number;
  /** Metres along the source edge. */
  s: number;
  /** Carriageway height (metres above the geoid), set by the elevation solver. */
  h: number;
  /** Ground model height under the reference point. */
  g: number;
  /** Lateral position of every lane border, left to right: lanes.length + 1 numbers, falling. */
  b: number[];
  layer: number;
  bridge: boolean;
  /** 0 at grade, 1 a walled ramp on fill, 2 a deck on piers. Set after the solve. */
  structure: 0 | 1 | 2;
  /** Height of the edge kerbs here: a kerb at grade, a parapet on a structure. */
  edgeRaise: number;
}

export type StripKind = 'road' | 'taper' | 'zone';

export interface Strip {
  id: string;
  /** Source graph edge (a zone names its node). */
  edge: string;
  kind: StripKind;
  cls: string;
  link: boolean;
  name: string;
  ways: string[];
  lanes: LaneDef[];
  st: Station[];
  hero: string | null;
  /** Width of the lane rows where it tapers: the two ends in metres, for the taper check. */
  taper?: { length: number; shift: number; needed: number };
}

export type StripEnd = 'start' | 'end';

/** Two strip ends that meet: the same cross-section seen from both. Lane pairs are indices into each strip's lanes. */
export interface Joint {
  a: { strip: number; end: StripEnd };
  b: { strip: number; end: StripEnd };
  lanes: [number, number][];
  /** What made it: a section change along one edge, a split or merge zone. */
  kind: 'section' | 'split';
}

export interface JunctionArm {
  strip: number;
  end: StripEnd;
  /** Metres from the node to the cut. */
  cut: number;
}

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface JunctionBand {
  /** Closed ring of the raised corner (kerb and footpath), with heights of its top. */
  ring: V3[];
  /** How many ring points, from the start, are the kerb line facing the carriageway. */
  inner: number;
  raise: number;
  /** Per ring point k: the edge from k to k + 1 gets a face down to the carriageway (not the outer edge, where the ground meets the top). */
  skirt: boolean[];
}

export interface Junction {
  id: string;
  nodes: number[];
  centre: P2;
  h: number;
  arms: JunctionArm[];
  /** J1: built from lane edges with corner arcs. J2: the plain fallback polygon. */
  method: 'J1' | 'J2';
  ring: V3[];
  bands: JunctionBand[];
  corners: { radius: number; kind: 'fillet' | 'through' | 'gap' }[];
  /** Connecting lanes: from an incoming lane to an outgoing lane, as [strip, lane] pairs. */
  connections: { from: [number, number]; to: [number, number] }[];
  why?: string;
}

export interface ClassDefaults {
  /** Drive lanes of a one-way carriageway and of a two-way road. */
  oneWay: number;
  twoWay: number;
  laneWidth: number;
  /** Footpath on each side (0 for none). */
  footpath: number;
  /** Taper: metres of length per metre of lateral shift. */
  taper: number;
  maxGrade: number;
  cornerRadius: number;
}

/** Delhi defaults per class when OSM has no lanes or width tag (it has them on under 9 percent of ways). */
export const CLASS_DEFAULTS: Readonly<Record<string, ClassDefaults>> = {
  motorway: { oneWay: 3, twoWay: 6, laneWidth: 3.5, footpath: 0, taper: 15, maxGrade: 0.05, cornerRadius: 12 },
  trunk: { oneWay: 3, twoWay: 6, laneWidth: 3.5, footpath: 0, taper: 15, maxGrade: 0.05, cornerRadius: 12 },
  primary: { oneWay: 3, twoWay: 4, laneWidth: 3.5, footpath: 2, taper: 15, maxGrade: 0.05, cornerRadius: 10 },
  secondary: { oneWay: 2, twoWay: 4, laneWidth: 3.3, footpath: 2, taper: 10, maxGrade: 0.06, cornerRadius: 9 },
  tertiary: { oneWay: 2, twoWay: 2, laneWidth: 3.3, footpath: 1.8, taper: 10, maxGrade: 0.07, cornerRadius: 7.5 },
  unclassified: { oneWay: 1, twoWay: 2, laneWidth: 3, footpath: 0, taper: 6, maxGrade: 0.08, cornerRadius: 5 },
  residential: { oneWay: 1, twoWay: 2, laneWidth: 3, footpath: 0, taper: 6, maxGrade: 0.08, cornerRadius: 5 },
  living_street: { oneWay: 1, twoWay: 1, laneWidth: 3.5, footpath: 0, taper: 6, maxGrade: 0.08, cornerRadius: 4 },
  service: { oneWay: 1, twoWay: 1, laneWidth: 3.5, footpath: 0, taper: 6, maxGrade: 0.08, cornerRadius: 4 },
  // a foot way has no steps in the lane model: on a foot bridge it climbs at the steepest a person walks without them
  // (1:10; P1-035: at 8 percent the Salimgarh foot bridge, 7.7 m over a railway, ended 1.09 m in the air)
  pedestrian: { oneWay: 1, twoWay: 1, laneWidth: 4, footpath: 0, taper: 6, maxGrade: 0.1, cornerRadius: 3 },
  road: { oneWay: 1, twoWay: 2, laneWidth: 3, footpath: 0, taper: 6, maxGrade: 0.08, cornerRadius: 5 },
};
/** A ramp or slip road without a lanes tag: one wide lane. Ramps may be steeper than the main line. */
export const LINK_LANE_WIDTH = 4.5;
export const LINK_MAX_GRADE = 0.06;
export const KERB_WIDTH = 0.3;
export const KERB_RAISE = 0.15;
export const PARAPET_RAISE = 0.9;
/** A deck's depth under the carriageway and the headroom a road under it needs (IRC: 5.5 m). */
export const DECK_DEPTH = 1.2;
export const HEADROOM = 5.5;
/** Gap between two carriageways at the physical nose of a gore: two kerbs and the nose between them. */
export const NOSE_GAP = 1;
/** No driving lane is narrower than this (m), except the one shared lane of a gali. */
export const MIN_DRIVE_LANE_M = 2.4;
/** The narrowest a gali lane may be (m): an auto rickshaw is 1.3 m wide and needs a hand's width each side. */
export const GALI_MIN_LANE_M = 1.8;
/** Every connecting lane path through a junction turns on at least this radius (m). */
export const MIN_TURN_RADIUS_M = 4;

export const classDefaults = (cls: string): ClassDefaults => CLASS_DEFAULTS[cls] ?? (CLASS_DEFAULTS['road'] as ClassDefaults);

export const lane = (type: LaneType, width: number, dir: 1 | -1 | 0 = 0, raise?: number): LaneDef => ({
  type, dir, width, raise: raise ?? (type === 'kerb' || type === 'footpath' || type === 'planter' || type === 'median' ? KERB_RAISE : 0),
});

export const csWidth = (cs: CrossSection): number => cs.lanes.reduce((s, l) => s + l.width, 0);

/** Border positions of a cross-section, left to right. */
export function csBorders(cs: CrossSection): number[] {
  const b = [cs.offset];
  for (const l of cs.lanes) b.push((b[b.length - 1] as number) - l.width);
  return b;
}

/** The same cross-section seen walking the other way. */
export function flipCS(cs: CrossSection): CrossSection {
  const lanes = cs.lanes.slice().reverse().map((l) => ({ ...l, dir: (l.dir === 0 ? 0 : -l.dir) as 1 | -1 | 0 }));
  return { lanes, offset: csWidth(cs) - cs.offset };
}

const FLUSH: readonly LaneType[] = ['drive', 'parking', 'gore'];

/**
 * The carriageway of a cross-section: the run of flush lanes around the drive lanes, as lane indices [first, last].
 * Everything left of it and right of it is edge (kerb, planter, footpath, a parking bay behind a planter).
 */
export function coreRange(lanes: readonly LaneDef[]): [number, number] {
  let first = lanes.findIndex((l) => l.type === 'drive');
  if (first < 0) return [0, lanes.length - 1];
  let last = first;
  for (let i = lanes.length - 1; i >= 0; i--) {
    if ((lanes[i] as LaneDef).type === 'drive') {
      last = i;
      break;
    }
  }
  while (first > 0 && FLUSH.includes((lanes[first - 1] as LaneDef).type) && (lanes[first - 1] as LaneDef).type !== 'parking') first--;
  while (last < lanes.length - 1 && FLUSH.includes((lanes[last + 1] as LaneDef).type) && (lanes[last + 1] as LaneDef).type !== 'parking') last++;
  return [first, last];
}

export interface TagInfo {
  cls: string;
  link: boolean;
  oneway: boolean;
  lanes: number | null;
  width: number | null;
}

/**
 * Cross-section from tags or class defaults, centred on the reference line. Left-hand traffic: on a two-way road
 * the lanes left of the centre run with the way, the lanes right of it against it.
 */
export function defaultCrossSection(t: TagInfo): CrossSection {
  const d = classDefaults(t.cls);
  let count = t.lanes ?? (t.link ? 1 : t.oneway ? d.oneWay : d.twoWay);
  count = Math.max(1, Math.min(8, Math.round(count)));
  let w = t.link && t.lanes === null ? LINK_LANE_WIDTH : d.laneWidth;
  if (t.width !== null && t.width > 2) w = Math.max(2.5, Math.min(5, t.width / count));
  const drive: LaneDef[] = [];
  if (t.oneway || count === 1) {
    for (let i = 0; i < count; i++) drive.push(lane('drive', w, t.oneway ? 1 : 0));
  } else {
    const fwd = Math.ceil(count / 2);
    for (let i = 0; i < fwd; i++) drive.push(lane('drive', w, 1));
    for (let i = fwd; i < count; i++) drive.push(lane('drive', w, -1));
  }
  const foot = t.link ? 0 : d.footpath;
  const left: LaneDef[] = foot > 0 ? [lane('footpath', foot), lane('kerb', KERB_WIDTH)] : [lane('kerb', KERB_WIDTH)];
  const right: LaneDef[] = foot > 0 ? [lane('kerb', KERB_WIDTH), lane('footpath', foot)] : [lane('kerb', KERB_WIDTH)];
  const lanes = [...left, ...drive, ...right];
  const driveWidth = drive.reduce((s, l) => s + l.width, 0);
  return { lanes, offset: driveWidth / 2 + left.reduce((s, l) => s + l.width, 0) };
}

export const maxGrade = (cls: string, link: boolean): number => (link ? Math.max(LINK_MAX_GRADE, classDefaults(cls).maxGrade) : classDefaults(cls).maxGrade);
