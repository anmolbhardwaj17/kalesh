import { describe, it, expect } from 'vitest';
import { measure, luma } from './shadecheck.mjs';

// a w x h frame: the top half sky, the bottom half split into sunlit and shaded ground of the given colours
function frame(w, h, shade, sun) {
  const d = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = y < h / 2 ? [200, 210, 230] : x < w / 2 ? shade : sun;
      d.set(c, (y * w + x) * 3);
    }
  }
  return d;
}

describe('shadecheck measure', () => {
  it('finds the shade pixels of the ground band and their blue minus red', () => {
    const m = measure(frame(40, 20, [40, 40, 70], [180, 160, 130]), 40, 20, 0.55);
    expect(m.shade).toEqual([40, 40, 70]);
    expect(m.blueMinusRed).toBe(30);
  });
  it('reads a neutral warm grey shade as not blue', () => {
    const m = measure(frame(40, 20, [62, 61, 58], [180, 160, 130]), 40, 20, 0.55);
    expect(m.blueMinusRed).toBe(-4);
    expect(m.nearBlack).toBe(0);
  });
  it('display luma of black and white', () => {
    expect(luma(0, 0, 0)).toBe(0);
    expect(luma(255, 255, 255)).toBeCloseTo(1, 6);
  });
});
