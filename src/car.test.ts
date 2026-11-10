import { describe, expect, it } from 'vitest';
import { forward, stepCar, type CarState } from './car';

const run = (s: CarState, throttle: number, steer: number, secs: number) => {
  let c = s;
  for (let i = 0; i < secs * 60; i++) c = stepCar(c, { throttle, steer }, 1 / 60);
  return c;
};
const start: CarState = { x: 0, z: 0, heading: 0, speed: 0 };

describe('coordinates', () => {
  it('heading 0 faces north (-Z), heading PI/2 faces east (+X)', () => {
    const [nx, nz] = forward(0);
    expect(nx).toBeCloseTo(0);
    expect(nz).toBeCloseTo(-1);
    const [ex, ez] = forward(Math.PI / 2);
    expect(ex).toBeCloseTo(1);
    expect(ez).toBeCloseTo(0);
  });
});

describe('car', () => {
  it('throttle at heading 0 drives north', () => {
    const c = run(start, 1, 0, 2);
    expect(c.z).toBeLessThan(-5);
    expect(Math.abs(c.x)).toBeLessThan(1e-6);
  });
  it('steering right while driving north turns toward east', () => {
    const c = run(start, 1, 1, 2);
    expect(c.heading).toBeGreaterThan(0);
    expect(c.x).toBeGreaterThan(0);
  });
  it('stops on its own with no input', () => {
    const c = run({ ...start, speed: 10 }, 0, 0, 20);
    expect(Math.abs(c.speed)).toBeLessThan(0.05);
  });
});
