// The one seeded random generator of the bake (ARCH_OPTIONS EB1, TECH.md "World pipeline": "every random pick is
// seeded from the world tile and a parcel id"). Pure and deterministic: the same seed gives the same sequence on every
// machine, because it uses only 32-bit integer maths (Math.imul and unsigned shifts).
//
//   const r = rngFor(tileX, tileZ, parcelId);   // or rngFor(tileX, tileZ, parcelId, 'trees') for a second stream
//   r.next() in [0, 1), r.int(lo, hi) inclusive, r.range(a, b), r.pick(list), r.chance(p)
//
// No other file of the bake may call Math.random (tools/bake/purity.test.ts).

/** Final mix of MurmurHash3: spreads every input bit over the whole word. */
function fmix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** 32-bit hash of a string (FNV-1a over UTF-16 code units, then the Murmur mix). */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return fmix32(h);
}

/** Mixes one more 32-bit word into a running hash (order matters: (a, b) and (b, a) differ). */
function combine(h: number, v: number): number {
  return fmix32((Math.imul(h ^ (v >>> 0), 0x9e3779b1) + 0x7f4a7c15) >>> 0);
}

/**
 * The seed of one parcel: its world tile (x, z) and its id inside the tile, plus an optional stream name so two
 * systems that pick for the same parcel (buildings, trees, life points) do not share a sequence.
 */
export function seedFor(tileX: number, tileZ: number, parcelId: string | number, stream = ''): number {
  if (!Number.isInteger(tileX) || !Number.isInteger(tileZ)) throw new Error(`seedFor: tile ${tileX}, ${tileZ} is not a pair of integers`);
  let h = 0x6b43a9b5;
  h = combine(h, tileX | 0);
  h = combine(h, tileZ | 0);
  h = combine(h, typeof parcelId === 'number' ? hashString(`#${parcelId}`) : hashString(parcelId));
  if (stream) h = combine(h, hashString(stream));
  return h;
}

export interface Rand {
  /** The seed this generator started from. */
  readonly seed: number;
  /** A float in [0, 1) with 32 random bits. */
  next(): number;
  /** An integer in [lo, hi], both ends included. */
  int(lo: number, hi: number): number;
  /** A float in [a, b). */
  range(a: number, b: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** One element of a non-empty list. */
  pick<T>(list: readonly T[]): T;
  /** A shuffled copy (Fisher-Yates). */
  shuffle<T>(list: readonly T[]): T[];
}

/** sfc32 (Chris Doty-Humphrey's small fast counting generator), its four words filled by splitmix32 from the seed. */
export function rng(seed: number): Rand {
  let s = seed >>> 0;
  const split = (): number => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
    return (z ^ (z >>> 16)) >>> 0;
  };
  let a = split();
  let b = split();
  let c = split();
  let d = split();
  const u32 = (): number => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t;
  };
  // let the counter run a few rounds so nearby seeds have spread apart before the first value
  for (let i = 0; i < 12; i++) u32();
  const next = (): number => u32() / 4294967296;
  const r: Rand = {
    seed: seed >>> 0,
    next,
    int: (lo, hi) => {
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || hi < lo) throw new Error(`rand.int(${lo}, ${hi}): need integers with lo <= hi`);
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    range: (x, y) => x + next() * (y - x),
    chance: (p) => next() < p,
    pick: <T>(list: readonly T[]): T => {
      if (list.length === 0) throw new Error('rand.pick: empty list');
      return list[Math.floor(next() * list.length)] as T;
    },
    shuffle: <T>(list: readonly T[]): T[] => {
      const out = list.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const t = out[i] as T;
        out[i] = out[j] as T;
        out[j] = t;
      }
      return out;
    },
  };
  return r;
}

/** The generator of one parcel: `rng(seedFor(tileX, tileZ, parcelId, stream))`. */
export function rngFor(tileX: number, tileZ: number, parcelId: string | number, stream = ''): Rand {
  return rng(seedFor(tileX, tileZ, parcelId, stream));
}
