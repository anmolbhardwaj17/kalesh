// Map inspector lanes layer, the pure parts (P1-025): lane counts and widths of a strip, the plain words for where a
// count came from, the strip under a point, and the list of split zones and taper findings.
import { describe, expect, it } from 'vitest';
import { distAlong, driveLaneCount, laneItems, lanesInboxText, lanesIssueId, lanesSummary, metres, nearestStrip, sectionParts, sourceWords, stripWidths } from './lanes.ts';
import type { LaneStrip } from './lanes.ts';

/** A straight strip from (x0, z0) east for 100 m: kerb, two driving lanes, kerb; north is -z, so the left is -z. */
const strip = (id: string, x0: number, z0: number, over: Partial<LaneStrip> = {}): LaneStrip => ({
  id, edge: id.replace(/_\d+$/, ''), kind: 'road', cls: 'secondary', name: 'Test Marg', hero: null, bridge: false, from: 'class',
  lanes: [['kerb', 0], ['drive', 1], ['drive', 1], ['kerb', 0]],
  ref: [[x0, z0], [x0 + 50, z0], [x0 + 100, z0]], n: [[0, -1], [0, -1], [0, -1]], b: [4, 3.7, 0.4, -3.3, -3.6],
  ...over,
});

describe('lane counts and widths of a strip', () => {
  it('counts the driving lanes and measures them', () => {
    const s = strip('w1.0_0', 0, 0);
    expect(driveLaneCount(s)).toBe(2);
    const w = stripWidths(s);
    expect(w.lane[0]).toBeCloseTo(3.3, 5);
    expect(w.lane[1]).toBeCloseTo(3.7, 5);
    expect(w.drive[1]).toBeCloseTo(7.0, 5);
    expect(w.total[1]).toBeCloseTo(7.6, 5);
    expect(metres(w.total)).toBe('7.6 m');
  });
  it('a strip whose borders change along it gives a range', () => {
    const s = strip('w1.0_0', 0, 0, { b: [[4, 3.7, 0.4, -3.3, -3.6], [4, 3.7, 0.2, -3.5, -3.8], [4.4, 4, 0, -3.8, -4.1]] });
    const w = stripWidths(s);
    expect(w.total[0]).toBeCloseTo(7.6, 5);
    expect(w.total[1]).toBeCloseTo(8.5, 5);
    expect(metres(w.total)).toBe('7.6 to 8.5 m');
  });
});

describe('where a lane count came from, in words', () => {
  it('every source the bake records has its own words, and an owner override is told from a repair rule', () => {
    const labels = new Set<string>();
    for (const f of ['class', 'tag', 'street', 'pair', 'corridor', 'spec', 'fit', 'width', 'room', 'repair', 'zone', undefined]) {
      const w = sourceWords(f, undefined);
      expect(w.label.length).toBeGreaterThan(3);
      expect(w.long).not.toMatch(/—|–/);
      labels.add(w.label);
    }
    expect(labels.size).toBe(12);
    expect(sourceWords('class').label).toBe('Road type default');
    expect(sourceWords('spec').label).toBe('Hero road spec');
    expect(sourceWords('street').long).toMatch(/nearest stretch of the same street/);
    expect(sourceWords('repair', lanesIssueId('w1.0')).label).toBe('Your override');
    expect(sourceWords('repair', 'R-LANE-FIT-03:w1.0').label).toBe('Repair rule');
    expect(sourceWords('repair', 'R-LANE-FIT-03:w1.0').long).toContain('R-LANE-FIT-03');
  });
});

describe('the strip under a point', () => {
  const strips = [strip('w1.0_0', 0, 0), strip('w2.0_0', 0, 40), strip('w3.0_0', 500, 0)];
  it('finds the strip whose cross section is nearest and none far from every road', () => {
    expect(nearestStrip(strips, 30, 1)?.strip.id).toBe('w1.0_0');
    expect(nearestStrip(strips, 30, 38)?.strip.id).toBe('w2.0_0');
    expect(nearestStrip(strips, 560, -2)?.strip.id).toBe('w3.0_0');
    expect(nearestStrip(strips, 30, 20)).toBeNull();
    expect(nearestStrip(strips, 30, 6)?.strip.id).toBe('w1.0_0');
  });
  it('measures the distance along a polyline', () => {
    expect(distAlong(25, 3, [[0, 0], [50, 0]])).toEqual({ d: 3, at: 0 });
    expect(distAlong(80, 0, [[0, 0], [50, 0]]).d).toBe(30);
  });
});

describe('the split zones and taper findings list', () => {
  const strips = [
    strip('w1.0_0', 0, 0), strip('zone_diverge_1', 1000, 0, { kind: 'zone', edge: 'node/1', from: undefined }),
    strip('zone_merge_2', 2000, 0, { kind: 'zone', edge: 'node/2', name: '' }), strip('w9.0_2', 1100, 500, { kind: 'taper', taper: [10, 2, 20] }),
  ];
  const zones = [
    { id: 'zone_diverge_1', kind: 'diverge', node: [1000, 0] as [number, number], nose: [1020, 0] as [number, number], noseM: 20 },
    { id: 'zone_merge_2', kind: 'merge', node: [2000, 0] as [number, number], nose: [2010, 0] as [number, number], noseM: 10 },
  ];
  const health = { tapers: { tapers: 1, violations: 1, findings: [{ strip: 'w9.0_2', cls: 'secondary', lengthM: 10, shiftM: 2, neededM: 20, why: 'the lane count stays 3' }] }, zones: { zones: 2, diverges: 1, merges: 1 } };
  it('has one item per zone and per finding, nearest the focus first', () => {
    const items = laneItems({ strips, zones }, health, { x: 1900, z: 0 });
    expect(items).toHaveLength(zones.length + health.tapers.findings.length);
    expect(items[0]).toMatchObject({ id: 'zone_merge_2', kind: 'zone' });
    expect(items[0]?.title).toBe('Two roads merge into one');
    expect(items.find((i) => i.id === 'zone_diverge_1')?.title).toBe('Road splits in two on Test Marg');
    const taper = items.find((i) => i.kind === 'taper');
    expect(taper?.detail).toContain('A secondary road needs 20 m');
    expect(taper?.x).toBe(1150);
  });
  it('a finding for a strip the layer does not have is left out, so the page never lists what it cannot show', () => {
    const items = laneItems({ strips, zones }, { ...health, tapers: { ...health.tapers, findings: [{ ...health.tapers.findings[0]!, strip: 'gone' }] } }, null);
    expect(items.filter((i) => i.kind === 'taper')).toHaveLength(0);
  });
  it('the summary line is the health report counts', () => {
    expect(lanesSummary({ ...health, zones: { zones: 141, diverges: 66, merges: 75 }, tapers: { ...health.tapers, violations: 3 } }, 5721)).toBe('141 split zones (66 splits, 75 merges), 3 taper findings, 5,721 road sections');
    expect(lanesSummary(null, 12)).toBe('12 road sections');
  });
});

describe('the inbox line', () => {
  it('says what was set, where, and the patch, in plain words', () => {
    const t = lanesInboxText('Bahadur Shah Zafar Marg', 1793.2, -1229.6, 3, 4, ' three each way ', 'ov_7_-5_0001', '7_-5.json');
    expect(t).toBe('Map inspector: I set the lane count of Bahadur Shah Zafar Marg at x 1793, z -1230 from 3 to 4. Note: three each way. Patch ov_7_-5_0001 is in overrides/7_-5.json.');
    expect(t).not.toMatch(/—/);
  });
});

describe('sectionParts (P1-036)', () => {
  it('leaves out parts with no width and merges what is left side by side, but keeps driving lanes apart', () => {
    // a split zone before its nose: three painted islands of no width between the two branches
    const lanes: [string, number][] = [['kerb', 0], ['drive', 1], ['gore', 0], ['gore', 0], ['gore', 0], ['drive', 1], ['drive', 1], ['kerb', 0]];
    const b = [7.6, 7.3, 4.0, 4.0, 4.0, 4.0, 0.7, -2.6, -2.9];
    const parts = sectionParts(lanes, b);
    expect(parts.map((p) => p.type)).toEqual(['kerb', 'drive', 'drive', 'drive', 'kerb']);
    expect(parts.filter((p) => p.type === 'gore')).toHaveLength(0);
    // past the nose the island has width and is listed once
    const open = sectionParts(lanes, [8.6, 8.3, 5.0, 4.6, 4.4, 4.0, 0.7, -2.6, -2.9]);
    expect(open.filter((p) => p.type === 'gore')).toHaveLength(1);
    expect(open.find((p) => p.type === 'gore')?.widthM).toBeCloseTo(1.0, 6);
  });
});
