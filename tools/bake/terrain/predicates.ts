// Exact predicates of the ground triangulation (P1-015). Every coordinate is a whole number of quarter millimetres
// (UNITS per metre), and a stage is under 8 km across, so a difference is under 2^26 and the turn test is exact in
// plain doubles. The circle test is of the fourth degree: it runs in doubles with an error bound and falls back to
// BigInt when the sign is not certain. Pure.

/** Whole units per metre: a quarter of a millimetre. A millimetre (the road mesh's rounding) is four units. */
export const UNITS = 4000;

export const toUnits = (m: number): number => Math.round(m * UNITS);

/** Twice the signed area of a, b, c in the x, z plane: positive when c lies on the left of a to b (the face set's turning sense). Exact. */
export function orient(ax: number, az: number, bx: number, bz: number, cx: number, cz: number): number {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

const ICC_BOUND = 1.2e-15;
let exactCalls = 0;
/** How often the circle test needed whole number arithmetic (a report number). */
export const incircleExactCalls = (): number => exactCalls;

/** Positive when d lies inside the circle through a, b, c (which turn the positive way), negative outside, 0 on it. Exact sign. */
export function incircle(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number): number {
  const adx = ax - dx;
  const adz = az - dz;
  const bdx = bx - dx;
  const bdz = bz - dz;
  const cdx = cx - dx;
  const cdz = cz - dz;
  const bc1 = bdx * cdz;
  const bc2 = cdx * bdz;
  const ca1 = cdx * adz;
  const ca2 = adx * cdz;
  const ab1 = adx * bdz;
  const ab2 = bdx * adz;
  const al = adx * adx + adz * adz;
  const bl = bdx * bdx + bdz * bdz;
  const cl = cdx * cdx + cdz * cdz;
  const det = al * (bc1 - bc2) + bl * (ca1 - ca2) + cl * (ab1 - ab2);
  const perm = (Math.abs(bc1) + Math.abs(bc2)) * al + (Math.abs(ca1) + Math.abs(ca2)) * bl + (Math.abs(ab1) + Math.abs(ab2)) * cl;
  if (det > ICC_BOUND * perm || -det > ICC_BOUND * perm) return det;
  exactCalls++;
  const A = BigInt(adx);
  const B = BigInt(adz);
  const C = BigInt(bdx);
  const D = BigInt(bdz);
  const E = BigInt(cdx);
  const F = BigInt(cdz);
  const big = (A * A + B * B) * (C * F - E * D) + (C * C + D * D) * (E * B - A * F) + (E * E + F * F) * (A * D - C * B);
  return big > 0n ? 1 : big < 0n ? -1 : 0;
}
