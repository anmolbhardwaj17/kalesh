import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { accessFileProblems, readAccessZones } from './accessio.ts';
import { accessText, formatJson } from '../graph/accessfile.mjs';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const file = JSON.parse(fs.readFileSync(path.join(ROOT, 'harness', 'data', 'access.json'), 'utf8'));

describe('harness/data/access.json (P2-043)', () => {
  it('is valid: every rule has its reference, reason and modes; every zone a ring or circles', () => {
    expect(accessFileProblems(file)).toEqual([]);
  });

  it('has the forecourt and government gate rules with their zones, and its judge decisions say why and cite their sheet', () => {
    const ids = file.rules.map((r: { id: string }) => r.id);
    expect(ids).toEqual(expect.arrayContaining(['metro_forecourt_foot', 'lutyens_government_gates']));
    const zones = Object.fromEntries(file.zones.map((z: { id: string }) => [z.id, z]));
    expect(zones['metro_forecourts'].circles.length).toBeGreaterThan(50);
    expect(zones['lutyens_government'].ring.length).toBeGreaterThanOrEqual(4);
    for (const r of file.rules.filter((x: { by: string }) => x.by === 'judge')) {
      expect(r.why.length).toBeGreaterThanOrEqual(20);
      expect(r.refs[0]).toMatch(/harness\/reports\/access\//);
    }
  });

  it('refuses a rule that names a zone the file does not define, and a zone with both a ring and circles', () => {
    const bad = { zones: [], rules: [{ id: 'r', by: 'rule', why: 'a sentence that says why', refs: ['x'], modes: ['foot'], match: { zones: ['nope'] } }] };
    expect(accessFileProblems(bad).join()).toMatch(/zone nope/);
    const both = { zones: [{ id: 'z', why: 'a sentence that says why', refs: ['x'], ring: [[0, 0], [0, 1], [1, 1], [0, 0]], circles: [{ name: 'a', lat: 1, lon: 1, radiusM: 5 }] }], rules: [] };
    expect(accessFileProblems(both).join()).toMatch(/ring.*or circles/);
  });

  it('zone tests: a ring holds the middle of an edge, circles hold the whole edge', () => {
    const project = (lat: number, lon: number) => ({ x: lon * 100, z: -lat * 100 });
    const zones = readAccessZones(ROOT, project);
    // the lutyens ring in these units: lat 28.6 is z -2860; the Rashtrapati Bhavan estate is inside
    const lut = zones.get('lutyens_government');
    expect(lut?.({ all: [], mid: project(28.612, 77.2) })).toBe(true);
    expect(lut?.({ all: [], mid: project(28.7, 77.2) })).toBe(false);
    const metro = zones.get('metro_forecourts');
    const c = file.zones.find((z: { id: string }) => z.id === 'metro_forecourts').circles[0];
    const at = project(c.lat, c.lon);
    expect(metro?.({ all: [at, { x: at.x + 0.05, z: at.z }], mid: at })).toBe(true);
    expect(metro?.({ all: [at, { x: at.x + 90, z: at.z }], mid: at })).toBe(false);
  });

  it('the file writer keeps the hand-kept shape: a rewrite of the file is the same text', () => {
    expect(accessText(file)).toBe(fs.readFileSync(path.join(ROOT, 'harness', 'data', 'access.json'), 'utf8'));
    expect(formatJson({ a: [1, 2], b: 'x' })).toBe('{ "a": [1, 2], "b": "x" }');
  });
});
