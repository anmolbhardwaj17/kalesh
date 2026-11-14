// What the generator reads from an area profile (P2-009): the merged profile or rule archetype (profiles.ts) turned
// into numbers once: the building mix, the floor count distribution built from p10, p50 and p90, the setback and
// frontage ranges, the wall colours as swatches, wear and the facade habits. Pure.
import { mergeArchetype, mergeProfile } from './profiles.ts';
import type { AreaData, Merged } from './profiles.ts';
import { LEVEL_DENSITY, getPath, isObj } from './schema.ts';
import type { Level } from './schema.ts';

export interface ProfileView {
  /** "area:<area id>" or "rule:<archetype>". */
  key: string;
  kind: 'area' | 'rule';
  id: string;
  archetype: string;
  /** Building types with their shares, sorted by name; empty when the profile generates nothing. */
  mix: [string, number][];
  floors: { p10: number; p50: number; p90: number };
  /** Share of each floor count (index = floors). */
  pmf: number[];
  setback: [number, number];
  frontage: [number, number];
  /** Wall colours: the palette word and its swatch as 0xRRGGBB. */
  colours: { word: string; rgb: number }[];
  wear: number;
  /** Shops on the street frontage of the ground floor. */
  shops: boolean;
  /** How often an upper bay is a balcony and how often a roof edge carries a parapet railing (0 to 1). */
  balcony: number;
  parapet: number;
  /**
   * Buildings stand wall to wall on the street line (no setback to speak of, or the profile says shops on every street
   * frontage): free frontage is cut into lots. Elsewhere only a hole in a row is.
   */
  continuous: boolean;
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const pair = (v: unknown, d: [number, number]): [number, number] => (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number' ? [v[0], v[1]] : d);
const hex = (s: string): number => parseInt(s.replace('#', ''), 16) & 0xffffff;
const level = (v: unknown, d: number): number => (typeof v === 'string' && v in LEVEL_DENSITY ? LEVEL_DENSITY[v as Level] : d);

/** The anchors of the floor count quantile function: (share below, floors), piecewise linear, never falling. */
export function floorAnchors(f: { p10: number; p50: number; p90: number }): [number, number][] {
  const lo = Math.max(1, f.p10 - 1);
  const hi = f.p90 + Math.max(1, Math.round((f.p90 - f.p50) / 2));
  return [[0, lo], [0.1, f.p10], [0.5, f.p50], [0.9, f.p90], [1, hi]];
}

/** Floors for a uniform draw u in [0, 1): the quantile function rounded to a whole floor. */
export function floorsFor(f: { p10: number; p50: number; p90: number }, u: number): number {
  const a = floorAnchors(f);
  for (let i = 0; i + 1 < a.length; i++) {
    const [u0, v0] = a[i] as [number, number];
    const [u1, v1] = a[i + 1] as [number, number];
    if (u <= u1 || i + 2 === a.length) return Math.max(1, Math.floor(v0 + ((v1 - v0) * Math.min(1, Math.max(0, (u - u0) / (u1 - u0)))) + 0.5));
  }
  return f.p50;
}

/** The share of every floor count under `floorsFor` (index = floors; the list ends at the tallest). */
export function floorPmf(f: { p10: number; p50: number; p90: number }): number[] {
  const a = floorAnchors(f);
  // measure of the draws whose quantile is under x
  const below = (x: number): number => {
    let m = 0;
    for (let i = 0; i + 1 < a.length; i++) {
      const [u0, v0] = a[i] as [number, number];
      const [u1, v1] = a[i + 1] as [number, number];
      if (v1 <= v0) m += v0 < x ? u1 - u0 : 0;
      else if (x >= v1) m += u1 - u0;
      else if (x > v0) m += ((x - v0) / (v1 - v0)) * (u1 - u0);
    }
    return m;
  };
  const hi = (a[a.length - 1] as [number, number])[1];
  const out: number[] = [];
  for (let k = 0; k <= hi; k++) out.push(k === hi ? 1 - below(k - 0.5) : Math.max(0, below(k + 0.5) - below(k - 0.5)));
  return out;
}

export function viewOf(m: Merged, kind: 'area' | 'rule', palette: Readonly<Record<string, string>>): ProfileView {
  const v = m.values;
  const mixRaw = getPath(v, 'buildings.mix');
  const mix: [string, number][] = isObj(mixRaw) ? Object.entries(mixRaw).filter((e): e is [string, number] => typeof e[1] === 'number' && e[1] > 0).sort((a, b) => (a[0] < b[0] ? -1 : 1)) : [];
  const fl = getPath(v, 'buildings.floors');
  const floors = isObj(fl) ? { p10: num(fl.p10, 2), p50: num(fl.p50, 4), p90: num(fl.p90, 8) } : { p10: 2, p50: 4, p90: 8 };
  const words = getPath(v, 'buildings.colours');
  const colours = (Array.isArray(words) ? words : []).filter((w): w is string => typeof w === 'string' && typeof palette[w] === 'string').map((word) => ({ word, rgb: hex(palette[word] as string) }));
  if (!colours.length) colours.push({ word: 'cream', rgb: hex(palette['cream'] ?? '#e8dcc0') });
  const setback = pair(getPath(v, 'buildings.setback_m'), [0, 3]);
  const gf = String(getPath(v, 'buildings.ground_floor') ?? '');
  const railings = getPath(v, 'house_railings');
  const freq = (k: string, d: number): number => (isObj(railings) && isObj(railings[k]) ? level((railings[k] as { frequency?: unknown }).frequency, d) : d);
  return {
    key: `${kind}:${m.id}`, kind, id: m.id, archetype: m.archetype, mix, floors, pmf: floorPmf(floors), setback, frontage: pair(getPath(v, 'buildings.frontage_m'), [6, 20]), colours,
    wear: Math.min(1, Math.max(0, num(getPath(v, 'wear'), 0.4))), shops: /shop|shutter|market|stall|store/i.test(gf), balcony: freq('balcony_grilles', 0.5), parapet: freq('roof_parapets', 0.5),
    continuous: setback[1] <= 1 || /every street frontage|shutter to shutter|wall to wall/i.test(gf),
  };
}

/** Every profile view of the data: one per drawn area, one per archetype (for the ground the rules cover). */
export function allViews(data: AreaData): Map<string, ProfileView> {
  const out = new Map<string, ProfileView>();
  for (const id of Object.keys(data.profiles).sort()) {
    const v = viewOf(mergeProfile(data, id), 'area', data.palette);
    out.set(v.key, v);
  }
  for (const name of Object.keys(data.archetypes).sort()) {
    const v = viewOf(mergeArchetype(data, name), 'rule', data.palette);
    out.set(v.key, v);
  }
  return out;
}
