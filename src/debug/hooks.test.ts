import { describe, expect, it } from 'vitest';
import { SimClock } from './hooks';

describe('SimClock', () => {
  it('advances by dt times scale', () => {
    const c = new SimClock();
    c.scale = 2;
    c.advance(0.5);
    expect(c.t).toBeCloseTo(1);
  });
  it('holds exactly at the requested time and stays held', () => {
    const c = new SimClock();
    c.holdAt = 0.25;
    for (let i = 0; i < 10; i++) c.advance(0.1);
    expect(c.t).toBe(0.25);
    expect(c.paused).toBe(true);
    c.paused = false;
    c.advance(0.1);
    expect(c.t).toBeCloseTo(0.35);
  });
});
