import { describe, it, expect } from 'vitest';
import { planCleanup } from './tmpclean.mjs';

const H = 3600 * 1000;
const now = 100 * H;
const f = (size, hoursAgo) => ({ p: `f${hoursAgo}`, size, mtime: now - hoursAgo * H });

describe('tmpclean planCleanup', () => {
  it('does nothing under 80% of the limit', () => {
    expect(planCleanup([f(70, 5), f(9, 4)], { limit: 100, now }).remove).toEqual([]);
  });
  it('deletes oldest first until under 50%', () => {
    const plan = planCleanup([f(30, 1), f(30, 3), f(30, 2)], { limit: 100, now });
    expect(plan.remove.map((x) => x.p)).toEqual(['f3', 'f2']);
    expect(plan.after).toBe(30);
  });
  it('never deletes files changed in the last 30 minutes', () => {
    const plan = planCleanup([f(90, 0.1), f(5, 2)], { limit: 100, now });
    expect(plan.remove.map((x) => x.p)).toEqual(['f2']);
  });
});
