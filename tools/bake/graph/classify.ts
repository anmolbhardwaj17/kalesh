// Road classes of the block graph with the Delhi defaults (MAP_REPAIR.md "Pipeline" step 2): class, lanes, width,
// footpaths and the traffic side. OSM has a lanes tag on under 9 percent of the pilot's road ways and a width tag on
// under 4 percent, so most values come from the class defaults of the lane model (tools/bake/roads/model.ts). Delhi
// keeps left: a carriageway of a divided street has its footpath on the left and the median on the right. Pure.
import type { Tags } from '../osm.ts';
import { LINK_LANE_WIDTH, classDefaults } from '../roads/model.ts';

/** How a road carries traffic: a two-way road, a lone one-way street, or one carriageway of a divided street. */
export type Carriageway = 'two_way' | 'one_way' | 'paired';

export interface RoadClass {
  cls: string;
  link: boolean;
  carriageway: Carriageway;
  /** Delhi drives on the left (every road; kept on the record so the lane model never guesses). */
  traffic: 'left';
  lanes: number;
  lanesFrom: 'tag' | 'class';
  laneWidth: number;
  /** Carriageway width in metres (kerb to kerb for this carriageway). */
  width: number;
  widthFrom: 'tag' | 'lanes';
  /** Footpath width in metres on the left and on the right of the direction of the edge (0 for none). */
  footpath: { left: number; right: number };
  footpathFrom: 'tag' | 'class';
}

const num = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const m = /^\s*(\d+(?:\.\d+)?)/.exec(v);
  return m ? Number(m[1]) : null;
};

/** The lanes a carriageway carries from its tags (lanes, or lanes:forward plus lanes:backward), or null. */
export function taggedLanes(tags: Tags): number | null {
  const lanes = num(tags['lanes']);
  if (lanes !== null && lanes >= 1 && lanes <= 12) return Math.round(lanes);
  const f = num(tags['lanes:forward']);
  const b = num(tags['lanes:backward']);
  if (f !== null && b !== null && f + b >= 1 && f + b <= 12) return Math.round(f + b);
  return null;
}

/** Footpath sides from the sidewalk tags: metres per side, or null when the way has no sidewalk tag at all. */
export function taggedFootpaths(tags: Tags, width: number): { left: number; right: number } | null {
  const side = (v: string | undefined): number | null => (v === undefined ? null : v === 'yes' ? width : 0);
  const both = tags['sidewalk'] ?? tags['sidewalk:both'];
  let left: number | null = null;
  let right: number | null = null;
  if (both !== undefined) {
    // "separate" is a footway drawn as its own way: none on this carriageway
    left = both === 'both' || both === 'left' || both === 'yes' ? width : 0;
    right = both === 'both' || both === 'right' || both === 'yes' ? width : 0;
  }
  left = side(tags['sidewalk:left']) ?? left;
  right = side(tags['sidewalk:right']) ?? right;
  if (left === null && right === null) return null;
  return { left: left ?? 0, right: right ?? 0 };
}

/**
 * Classifies one edge. `tags` are the tags of its longest way piece; `reversed` says the edge runs against the way's
 * own direction (a two-way way read backwards swaps its left and right sidewalk tags).
 */
export function classifyRoad(cls: string, link: boolean, carriageway: Carriageway, tags: Tags, reversed = false): RoadClass {
  const d = classDefaults(cls);
  const tagged = taggedLanes(tags);
  const lanes = tagged ?? (link ? 1 : carriageway === 'two_way' ? d.twoWay : d.oneWay);
  const laneWidth = link && tagged === null ? LINK_LANE_WIDTH : d.laneWidth;
  const w = num(tags['width']);
  const width = w !== null && w > 1 && w < 60 ? w : Math.round(lanes * laneWidth * 10) / 10;
  const fpWidth = d.footpath > 0 ? d.footpath : 1.5;
  const fromTag = taggedFootpaths(tags, fpWidth);
  let footpath: { left: number; right: number };
  if (fromTag) footpath = reversed ? { left: fromTag.right, right: fromTag.left } : fromTag;
  else if (link || d.footpath === 0) footpath = { left: 0, right: 0 };
  // left-hand traffic: the median of a divided street is on the right of each carriageway
  else if (carriageway === 'paired') footpath = { left: d.footpath, right: 0 };
  else footpath = { left: d.footpath, right: d.footpath };
  return {
    cls, link, carriageway, traffic: 'left', lanes, lanesFrom: tagged === null ? 'class' : 'tag', laneWidth, width, widthFrom: w !== null && w > 1 && w < 60 ? 'tag' : 'lanes',
    footpath, footpathFrom: fromTag ? 'tag' : 'class',
  };
}
