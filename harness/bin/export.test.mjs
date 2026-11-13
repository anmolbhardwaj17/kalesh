import { describe, it, expect } from 'vitest';
import { sizeText, packName } from './export.mjs';

describe('export', () => {
  it('sizeText picks the unit', () => {
    expect(sizeText(512)).toBe('512 B');
    expect(sizeText(2048)).toBe('2.0 KB');
    expect(sizeText(360 * (1 << 20))).toBe('360.0 MB');
    expect(sizeText(3 * (1 << 30))).toBe('3.00 GB');
  });
  it('packName makes stage_<name>.pck and refuses an empty stage', () => {
    expect(packName('pilot')).toBe('stage_pilot.pck');
    expect(packName('South Delhi!')).toBe('stage_south_delhi.pck');
    expect(() => packName('')).toThrow();
  });
});
