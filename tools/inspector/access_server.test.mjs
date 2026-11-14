// The access tab's server part (P2-043): an owner edit lands in access.json as an owner rule, replaces an earlier one for
// the same road, and the file stays valid; the page lists it. Runs on a small lanes layer in a temp folder.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accessFileProblems } from '../bake/sources/accessio.ts';
import { startInspector } from './serve.mjs';

let tmp = '';
let server = null;
const post = async (p, body) => { const r = await fetch(new URL(p, server.url), { method: 'POST', body: JSON.stringify(body) }); return { code: r.status, body: await r.json() }; };

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'access-test-'));
  const data = path.join(tmp, 'data');
  fs.mkdirSync(data);
  const strip = { id: 'w9.0_0', edge: 'w9.0', kind: 'road', cls: 'residential', name: 'Dariba Kalan', hero: null, bridge: false, lanes: [['drive', 0]], ref: [[100, 100], [130, 100]], n: [[0, -1], [0, -1]], b: [-1.8, 1.8], acc: { m: ['two_wheeler', 'cycle', 'foot', 'emergency'], r: 'context', why: 'an old city gali', rule: 'old_city_galis', ways: ['way/9'] } };
  fs.writeFileSync(path.join(data, 'lanes.json'), JSON.stringify({ version: 1, origin: { lat: 28.6129, lon: 77.2294 }, offset: [621.6, 467.2], strips: [strip], zones: [], junctions: [], ends: [] }));
  fs.writeFileSync(path.join(data, 'issues.json'), JSON.stringify({ issues: [] }));
  fs.writeFileSync(path.join(tmp, 'access.json'), JSON.stringify({ rules: [{ id: 'j1', by: 'judge', why: 'a judge decision about a lane', refs: ['sheet'], modes: ['foot'], match: { ways: ['way/1'] } }] }));
  server = await startInspector({ dataDir: data, overridesDir: path.join(tmp, 'overrides'), inboxFile: path.join(tmp, 'inbox.jsonl'), accessFile: path.join(tmp, 'access.json'), date: '2026-11-14' });
});
afterAll(async () => { await server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

describe('access edits in the inspector server (P2-043)', () => {
  it('writes an owner rule into access.json with by owner, replaces it on a second save, keeps the judge rule, and tells the inbox', async () => {
    const want = { car: true, two_wheeler: true, foot: true };
    const r = await post('/api/inspector/set-access', { edge: 'w9.0', want, x: 110, z: 100, note: 'cars do pass here, I saw a van' });
    expect(r.code).toBe(200);
    expect(r.body.modes).toEqual(['car', 'auto', 'two_wheeler', 'cycle', 'foot', 'emergency']);
    const file = JSON.parse(fs.readFileSync(path.join(tmp, 'access.json'), 'utf8'));
    expect(accessFileProblems(file)).toEqual([]);
    const owner = file.rules.filter((x) => x.by === 'owner');
    expect(owner).toHaveLength(1);
    expect(owner[0]).toMatchObject({ id: 'owner_w9_0', why: 'cars do pass here, I saw a van', match: { ways: ['way/9'] } });
    expect(file.rules.some((x) => x.id === 'j1')).toBe(true);
    // a second save for the same road replaces the first
    const again = await post('/api/inspector/set-access', { edge: 'w9.0', want: { car: false, two_wheeler: false, foot: true }, x: 110, z: 100, note: '' });
    expect(again.code).toBe(200);
    const f2 = JSON.parse(fs.readFileSync(path.join(tmp, 'access.json'), 'utf8'));
    expect(f2.rules.filter((x) => x.by === 'owner')).toHaveLength(1);
    expect(f2.rules.find((x) => x.by === 'owner').modes).toEqual(['cycle', 'foot', 'emergency']);
    const inbox = fs.readFileSync(path.join(tmp, 'inbox.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(inbox).toHaveLength(2);
    expect(inbox[0].text).toMatch(/by owner/);
    const list = await (await fetch(new URL('/api/inspector/access', server.url))).json();
    expect(list.owner.map((x) => x.id)).toEqual(['owner_w9_0']);
    expect(list.judge).toBe(1);
  });

  it('refuses a road the layer does not have and an incomplete answer', async () => {
    expect((await post('/api/inspector/set-access', { edge: 'nope', want: { car: true, two_wheeler: true, foot: true } })).code).toBe(404);
    expect((await post('/api/inspector/set-access', { edge: 'w9.0', want: { car: true } })).code).toBe(400);
  });
});
