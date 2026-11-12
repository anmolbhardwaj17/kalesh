import { describe, expect, it } from 'vitest';
import { buildNameIndex, compass, describeIssue, humanise, nearestNamedRoad, spotOf, whereWords } from './describe.ts';
import type { DescribeIssue } from './describe.ts';

// A small plan: Janpath runs north-south at x = 0, an unnamed service road leaves it east at z = -100, Rajiv Chowk is
// the place 120 m south of the service road. North is -Z.
const ctx = {
  roads: [
    { id: 'w1.0', k: 'primary', w: 14, p: [0, 0, 0, 0, 0, -400], n: 'Janpath' },
    { id: 'w2.0', k: 'service', w: 4, p: [5, 0, -100, 80, 0, -100] },
    { id: 'w3.0', k: 'trunk', w: 20, p: [-300, 0, 0, -300, 0, -400], n: 'Ring Road', r: 'NH44' },
  ],
  named: [{ id: 'way/9', n: 'Palika Bazaar', x: 40, z: -60, k: 'marketplace' }, { id: 'way/10', n: 'Some House', x: 500, z: 500, k: 'house' }],
};
const idx = buildNameIndex(ctx, [{ name: 'Rajiv Chowk', x: 40, z: 20 }]);
const issue = (over: Partial<DescribeIssue>): DescribeIssue => ({ rule: 'R-ROAD-01', x: 60, z: -100, features: ['w2.0', 'w1.0', 'n123456'], note: 'gap 5 m', proposals: [{ action: 'connect', confidence: 0.6, reasoning: 'The end of w2.0 stops 5 m from w1.0 at n123456: join them' }, { action: 'terminate', confidence: 0.4, reasoning: 'A real dead end' }], ...over });

describe('issue descriptions (P1-039)', () => {
  it('names an unnamed road by its class and the nearest named road, and places it from the nearest landmark', () => {
    const d = describeIssue(issue({}), idx);
    expect(d.what).toBe('Unnamed service road off Janpath');
    expect(d.where).toMatch(/^\d+ m north(-east)? of (Rajiv Chowk|Palika Bazaar)$/);
    expect(d.title).toBe(`${d.what}, ${d.where}`);
  });
  it('says the problem in plain words and the fix with names, not ids', () => {
    const d = describeIssue(issue({}), idx);
    expect(d.problem).toBe('The road stops just short of another road instead of joining it.');
    expect(d.fix).toBe('Join it up: the end of the service road stops 5 m from Janpath at the junction: join them');
    expect(d.fix).not.toMatch(/w\d|n\d/);
  });
  it('uses the real name and ref of a named road', () => {
    expect(describeIssue(issue({ rule: 'R-TERR-03', features: ['w3.0'], x: -300, z: -200 }), idx).what).toBe('Ring Road (NH44)');
  });
  it('names a building by its footprint name or by its road', () => {
    expect(describeIssue(issue({ rule: 'R-BLDG-01', features: ['way/9', 'w1.0'], x: 30, z: -60 }), idx).what).toBe('Palika Bazaar (marketplace)');
    expect(describeIssue(issue({ rule: 'R-BLDG-01', features: ['overture/abc-1', 'w1.0'], x: 3, z: -60 }), idx).what).toBe('A building on Janpath');
  });
  it('a junction, a station and a hero road', () => {
    expect(describeIssue(issue({ rule: 'R-JUNC-03', features: ['n1234', 'n5678'], x: 2, z: -300 }), idx).what).toBe('A junction on Janpath');
    expect(describeIssue(issue({ rule: 'R-RAIL-02', features: ['node/1', 'street'], note: 'Rajiv Chowk: the nearest street is 123 m away' }), idx).what).toBe('Rajiv Chowk station');
    expect(describeIssue(issue({ rule: 'R-HERO-01', features: ['hero/cp'], note: 'Connaught Place, Middle Circle: 13 edges, no spec file' }), idx).what).toBe('Connaught Place, Middle Circle');
  });
  it('falls back to the rule title and to class words when the file has no names (written before P1-039)', () => {
    const bare = buildNameIndex({ roads: [{ k: 'service', w: 4, p: [0, 0, 0, 10, 0, 0] }] }, []);
    const d = describeIssue(issue({ rule: 'R-NEW-01' }), bare, 'Something new');
    expect(d.what).toBe('A junction');
    expect(d.where).toBe('');
    expect(d.problem).toBe('Something new.');
  });
  it('helpers: compass, where words, nearest named road, humanise', () => {
    expect([compass(0, -1), compass(1, 0), compass(0, 1), compass(-1, -1)]).toEqual(['north', 'east', 'south', 'north-west']);
    expect(whereWords(idx, 41, 15)).toBe('at Rajiv Chowk');
    expect(whereWords(idx, 40, 1220)).toBe('1.2 km south of Rajiv Chowk');
    expect(nearestNamedRoad(idx, 20, -50)?.name).toBe('Janpath');
    expect(nearestNamedRoad(idx, 20, -50, 250, new Set(['Janpath']))).toBeNull();
    expect(humanise('keep way/9, drop overture/ab-1 at junction n99999', idx)).toBe('keep Palika Bazaar, drop the building at the junction');
  });
  it('places a building issue where its road piece meets the building, so pieces of one footprint read apart', () => {
    const plan = buildNameIndex({ roads: [
      { id: 'w5.1', k: 'primary', w: 10, p: [-50, 0, -100, -50, 0, 100], n: 'Inner Circle' },
      { id: 'w5.2', k: 'primary', w: 10, p: [50, 0, -100, 50, 0, 100], n: 'Inner Circle' },
    ] }, [{ name: 'Central Park', x: 0, z: 0 }]);
    const a = issue({ rule: 'R-BLDG-01', features: ['overture/big', 'w5.1'], x: 0, z: 0 });
    const b = issue({ rule: 'R-BLDG-01', features: ['overture/big', 'w5.2'], x: 0, z: 0 });
    expect(spotOf(a, plan)).toEqual([-50, 0]);
    expect(describeIssue(a, plan).where).toBe('50 m west of Central Park');
    expect(describeIssue(b, plan).where).toBe('50 m east of Central Park');
    expect(spotOf(issue({}), plan)).toEqual([60, -100]);
  });
  it('steers by landmarks, not by shops or bare numbers', () => {
    const plan = buildNameIndex({ named: [{ id: 'way/1', n: '19 Dal Chawal Masale', x: 0, z: 0, k: 'retail' }, { id: 'way/2', n: '2', x: 1, z: 1, k: 'commercial' }, { id: 'way/3', n: 'A-Block', x: 200, z: 0, k: 'commercial' }] }, []);
    expect(whereWords(plan, 0, 0)).toBe('200 m west of A-Block');
  });
});
