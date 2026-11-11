import { describe, expect, it } from 'vitest';
import { hashString, rng, rngFor, seedFor } from './rand';

const take = (seed: number, n: number): number[] => {
  const r = rng(seed);
  return Array.from({ length: n }, () => r.next());
};

describe('seeded random generator (rand.ts)', () => {
  it('the same seed gives the same sequence, also through rngFor', () => {
    expect(take(12345, 200)).toEqual(take(12345, 200));
    const a = rngFor(3, -7, 'parcel/42');
    const b = rngFor(3, -7, 'parcel/42');
    const sa = Array.from({ length: 50 }, () => [a.next(), a.int(0, 9), a.range(-1, 1), a.pick(['x', 'y', 'z'])]);
    const sb = Array.from({ length: 50 }, () => [b.next(), b.int(0, 9), b.range(-1, 1), b.pick(['x', 'y', 'z'])]);
    expect(sa).toEqual(sb);
  });

  it('is pinned: the first values of a known seed never change (a change reshuffles every baked city)', () => {
    const r = rngFor(0, 0, 'p1');
    const first = Array.from({ length: 3 }, () => Math.round(r.next() * 1e9));
    expect(first).toEqual(PINNED);
  });

  it('seeds of neighbouring tiles and parcels all differ, and so do their first values', () => {
    const seeds = new Map<number, string>();
    const firsts = new Set<number>();
    for (let x = -3; x <= 3; x++) {
      for (let z = -3; z <= 3; z++) {
        for (const p of ['a', 'b', 'p1', 'p2', 1, 2]) {
          const s = seedFor(x, z, p);
          expect(seeds.has(s), `${x},${z},${p} repeats the seed of ${seeds.get(s)}`).toBe(false);
          seeds.set(s, `${x},${z},${p}`);
          firsts.add(rng(s).next());
        }
      }
    }
    expect(firsts.size).toBe(seeds.size);
    // x and z are not interchangeable, a number id is not its string, a stream changes the seed
    expect(seedFor(1, 0, 'a')).not.toBe(seedFor(0, 1, 'a'));
    expect(seedFor(0, 0, 1)).not.toBe(seedFor(0, 0, '1'));
    expect(seedFor(0, 0, 'a', 'trees')).not.toBe(seedFor(0, 0, 'a'));
  });

  it('neighbouring sequences are not shifted copies of each other', () => {
    const a = take(seedFor(10, 10, 'p'), 64);
    const b = take(seedFor(11, 10, 'p'), 64);
    const shared = a.filter((v) => b.includes(v));
    expect(shared.length).toBe(0);
  });

  it('values are spread evenly over [0, 1) and ints cover their range', () => {
    const r = rng(seedFor(5, 5, 'spread'));
    const bins = new Array<number>(10).fill(0);
    let sum = 0;
    for (let i = 0; i < 20000; i++) {
      const v = r.next();
      expect(v >= 0 && v < 1).toBe(true);
      sum += v;
      bins[Math.floor(v * 10)]! += 1;
    }
    expect(Math.abs(sum / 20000 - 0.5)).toBeLessThan(0.01);
    for (const b of bins) expect(Math.abs(b - 2000)).toBeLessThan(200);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.int(-2, 2));
    expect([...seen].sort()).toEqual([-1, -2, 0, 1, 2].sort());
    expect(() => r.int(3, 1)).toThrow();
    expect(() => r.pick([])).toThrow();
    expect(() => seedFor(0.5, 0, 'x')).toThrow();
  });

  it('shuffle keeps every element and is repeatable', () => {
    const list = Array.from({ length: 20 }, (_, i) => i);
    const s1 = rng(7).shuffle(list);
    expect(s1).toEqual(rng(7).shuffle(list));
    expect([...s1].sort((p, q) => p - q)).toEqual(list);
    expect(s1).not.toEqual(list);
  });

  it('hashString spreads close strings apart', () => {
    expect(hashString('a')).not.toBe(hashString('b'));
    expect(hashString('')).toBe(hashString(''));
  });
});

const PINNED = [283999047, 400881047, 934046359];
