// P2-007: the pop finder of popcheck.mjs on made-up frame to frame changes.
import { describe, expect, it } from 'vitest';
import { findPops } from './popcheck.mjs';

describe('popcheck findPops', () => {
  it('a smooth run has no pop', () => {
    expect(findPops([1.2, 1.4, 1.1, 1.3, 1.5, 1.2]).pops).toEqual([]);
  });
  it('a jump well over its neighbours is a pop, with its frame', () => {
    const r = findPops([1.2, 1.4, 1.1, 9.5, 1.3, 1.2]);
    expect(r.pops).toEqual([{ at: 4, diff: 9.5 }]);
    expect(r.median).toBeCloseTo(1.2);
  });
  it('tiny changes are never pops, however still the rest is', () => {
    expect(findPops([0.1, 0.1, 0.1, 2.0, 0.1]).pops).toEqual([]);
  });
});
