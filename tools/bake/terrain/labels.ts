// Labels of the constrained edges of the ground triangulation (P1-015). An edge can be the edge of several things
// at once (a road edge that is also a park edge and lies on a tile line), so a label is one packed number: for each
// channel how many shapes have their inside on the left of the edge minus how many have it on the right (5 bits,
// -15 to 15), and one bit for a tile line. Crossing an edge from its left to its right lowers every count by the
// edge's numbers: that is how a triangle knows what it lies in. Pure.

export const CH_ROAD = 0;
export const CH_BUILDING = 1;
export const CH_WATER = 2;
export const CH_OUTLINE = 3;
export const CH_OPEN = 4;
export const CHANNELS = 5;
export const GRID_BIT = 1 << 25;
const BIAS = 16;
const ZERO = BIAS | (BIAS << 5) | (BIAS << 10) | (BIAS << 15) | (BIAS << 20);

/** A label with `w` in one channel (the inside on the left: 1). */
export const label = (channel: number, w: number): number => ZERO + (w << (channel * 5));
export const GRID_LABEL = ZERO | GRID_BIT;

export const channelOf = (lab: number, channel: number): number => ((lab >> (channel * 5)) & 31) - BIAS;

/** The same edge seen from its other end. */
export function flipLabel(lab: number): number {
  let out = lab & GRID_BIT;
  for (let c = 0; c < CHANNELS; c++) out |= Math.min(31, 2 * BIAS - ((lab >> (c * 5)) & 31)) << (c * 5);
  return out;
}

/** Two labels on one edge. */
export function joinLabels(a: number, b: number): number {
  let out = (a | b) & GRID_BIT;
  for (let c = 0; c < CHANNELS; c++) out |= Math.max(1, Math.min(31, ((a >> (c * 5)) & 31) + ((b >> (c * 5)) & 31) - BIAS)) << (c * 5);
  return out;
}
