// End to end in a temp folder (P1-011 acceptance): a pick written by the inspector server is read by the next bake,
// and the issue shows as fixed by an override in the health numbers. The map is a small synthetic one so this runs
// everywhere; the same flow on the real pilot centre is in tools/bake/repair/pilot_repair.test.mjs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { issueRecords, repairGraph } from '../bake/repair/engine.ts';
import { mapCounts } from '../bake/report/health.ts';
import { readOverrides } from '../bake/sources/overridesio.ts';
import { lanesLayer } from '../bake/roads/laneout.ts';
import { buildLaneModel } from '../bake/roads/network.ts';
import { Sketch, flat, testEnv } from '../bake/testmap.ts';
import { ORIGIN, projector } from '../geo/projection.ts';
import { startInspector } from './serve.mjs';

/** A road along north 0 and a side road that stops 12 m short of it: a queued issue with a join and a dead end. */
function nearMiss() {
  const s = new Sketch();
  s.way([[0, 0], [100, 0]], { highway: 'residential' });
  s.way([[50, 60], [50, 12]], { highway: 'residential' });
  return s;
}

describe('a pick in the inspector is read by the next bake', () => {
  let tmp = '';
  let server = null;
  beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pick-to-bake-')); });
  afterAll(async () => {
    await server?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('the picked issue is fixed by override in the counts of the next bake, and the pick file is untouched by it', async () => {
    const s = nearMiss();
    const env = testEnv({ nodeTags: s.nodeTags() });
    // bake 1: no overrides. The report folder holds issues.json in the record format the inspector reads.
    const first = repairGraph(s.graph(), env);
    const issue = first.issues.find((i) => i.rule === 'R-ROAD-01');
    expect(issue.status).toBe('open');
    expect(mapCounts(first)).toMatchObject({ found: 1, leftOpen: 1, fixedByOverrides: 0, staleOverrides: 0 });
    const data = path.join(tmp, 'map');
    fs.mkdirSync(data);
    fs.writeFileSync(path.join(data, 'issues.json'), JSON.stringify({ version: 1, block: 'test', source: 'test', rules: { 'R-ROAD-01': 'Dangling end' }, issues: issueRecords(first.issues) }));
    // the owner picks the dead end (the second proposal) in the inspector
    const overrides = path.join(tmp, 'overrides');
    const inbox = path.join(tmp, 'inbox.jsonl');
    server = await startInspector({ dataDir: data, overridesDir: overrides, inboxFile: inbox, gamePort: 1, date: '2026-11-12' });
    const base = server.url.replace('/inspector/', '');
    const res = await fetch(`${base}/api/inspector/pick`, { method: 'POST', body: JSON.stringify({ issue: issue.id, proposal: 1, note: 'a real dead end' }) });
    expect(res.status).toBe(200);
    const { file } = await res.json();
    expect(file).toBe('0_-1.json'); // the issue is 12 m north of the origin: z is -12, tile row -1
    const written = fs.readFileSync(path.join(overrides, file), 'utf8');
    // bake 2 reads the file the server wrote
    const entries = readOverrides(tmp, overrides);
    expect(entries).toHaveLength(1);
    expect(entries[0].patch).toMatchObject({ source: 'inspector', by: 'owner', action: 'terminate', issue: issue.id, why: 'a real dead end' });
    const second = repairGraph(s.graph(), env, { overrides: { entries, project: flat } });
    expect(second.issues.find((i) => i.rule === 'R-ROAD-01').status).toBe('overridden');
    const counts = mapCounts(second);
    expect(counts).toMatchObject({ found: 1, fixedByOverrides: 1, leftOpen: 0, staleOverrides: 0, repairedAuto: 0 });
    expect(second.overrides).toMatchObject([{ outcome: 'fixed', resolution: 'by_id', file: '0_-1.json' }]);
    expect(second.graph.edges).toHaveLength(2); // the owner's dead end: no provisional join
    expect(fs.readFileSync(path.join(overrides, file), 'utf8')).toBe(written);
    // the next report carries the issue as settled, and the inspector shows it as picked (status overridden)
    expect(issueRecords(second.issues)[0]).toMatchObject({ status: 'overridden' });
  });

  it('a lane count set on the page (set_lanes) changes that road in the next bake of its tile', async () => {
    // one tertiary street, 100 m, no lanes tag: the class default of 2 driving lanes
    const s = new Sketch();
    s.way([[0, 0], [100, 0]], { highway: 'tertiary', name: 'Test Marg' });
    const env = testEnv({ nodeTags: s.nodeTags() });
    const proj = projector(ORIGIN);
    const project = (lat, lon) => proj.toWorld(lat, lon);
    const bakeLanes = (entries) => {
      const r = repairGraph(s.graph(), env, entries.length ? { overrides: { entries, project } } : {});
      const b = buildLaneModel({ nodes: r.graph.nodes, edges: r.graph.edges, marks: r.graph.marks, wayLanes: new Map() });
      return { r, b, layer: lanesLayer(b, 'test', { x: 0, z: 0 }, ORIGIN) };
    };
    const drive = (layer, edge) => layer.strips.filter((q) => q.edge === edge && q.kind === 'road').map((q) => q.lanes.filter((l) => l[0] === 'drive').length);
    const first = bakeLanes([]);
    const edge = first.layer.strips.find((q) => q.kind === 'road').edge;
    expect(drive(first.layer, edge)).toEqual([2]);
    expect(first.layer.strips.find((q) => q.edge === edge)).toMatchObject({ from: 'class', name: 'Test Marg' });
    expect(first.layer.origin).toEqual({ lat: ORIGIN.lat, lon: ORIGIN.lon });
    // the page writes the patch through the server, from a click at the middle of the road
    const data = path.join(tmp, 'map2');
    fs.mkdirSync(data);
    fs.writeFileSync(path.join(data, 'lanes.json'), JSON.stringify(first.layer));
    const overrides = path.join(tmp, 'overrides2');
    const inbox = path.join(tmp, 'inbox2.jsonl');
    const srv = await startInspector({ dataDir: data, overridesDir: overrides, inboxFile: inbox, gamePort: 1, date: '2026-11-13' });
    try {
      const base = srv.url.replace('/inspector/', '');
      const post = (body) => fetch(`${base}/api/inspector/set-lanes`, { method: 'POST', body: JSON.stringify(body) });
      expect((await post({ edge, lanes: 0, x: 50, z: 0 })).status).toBe(400);
      expect((await post({ edge: 'w999.0', lanes: 3, x: 50, z: 0 })).status).toBe(404);
      const res = await post({ edge, lanes: 3, x: 50, z: 0, note: 'three lanes, counted on a photo' });
      expect(res.status).toBe(200);
      const { file, patch } = await res.json();
      expect(file).toBe('0_0.json');
      expect(patch).toMatchObject({ issue: `lanes:${edge}`, action: 'set_lanes', source: 'inspector', by: 'owner', params: { on: edge, lanes: 3, from: 'ahead' }, target: { ids: [edge] } });
      // setting it again replaces the patch
      expect((await post({ edge, lanes: 4, x: 50, z: 0 })).status).toBe(200);
      expect((await post({ edge, lanes: 3, x: 50, z: 0, note: 'three lanes, counted on a photo' })).status).toBe(200);
      expect(JSON.parse(fs.readFileSync(path.join(overrides, file), 'utf8'))).toHaveLength(1);
      const lines = fs.readFileSync(inbox, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      expect(lines).toHaveLength(3);
      expect(lines[0].text).toMatch(/^Map inspector: I set the lane count of Test Marg at x 50, z 0 from 2 to 3\. Note: three lanes, counted on a photo\. Patch ov_0_0_0001 is in overrides\/0_0\.json\.$/);
      // the next bake reads the file: the same road has 3 driving lanes and says the count is the owner's
      const entries = readOverrides(tmp, overrides);
      expect(entries).toHaveLength(1);
      const second = bakeLanes(entries);
      expect(second.r.overrides).toMatchObject([{ outcome: 'fixed', resolution: 'by_id', file: '0_0.json' }]);
      expect(drive(second.layer, edge)).toEqual([3]);
      expect(second.layer.strips.find((q) => q.edge === edge)).toMatchObject({ from: 'repair', by: `lanes:${edge}` });
    } finally {
      await srv.close();
    }
  });
});
