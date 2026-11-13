// The Wikidata cache of the landmark registry (P2-005): missing items are fetched once in batches, a second build
// makes no request, and an unreachable Wikidata is reported while the build goes on with what the cache holds.
import { describe, expect, it } from 'vitest';
import type { EntityCache } from '../landmarks/wikidata';
import { fillEntityCache } from './landmarksio';
import type { Net, NetResponse } from './net';

const snak = (value: unknown) => ({ mainsnak: { datavalue: { value } }, rank: 'normal' });
const entity = (label: string, cls: string) => ({ labels: { en: { value: label } }, sitelinks: { enwiki: {} }, claims: { P625: [snak({ latitude: 28.6, longitude: 77.2 })], P31: [snak({ id: cls })] } });

function fakeNet(answer: (url: string) => string | number): { net: Net; urls: string[] } {
  const urls: string[] = [];
  const net: Net = {
    request: async (url) => {
      urls.push(url);
      const a = answer(url);
      const res: NetResponse = { ok: typeof a === 'string', status: typeof a === 'string' ? 200 : a, headers: { get: () => null }, text: async () => String(a), arrayBuffer: async () => new ArrayBuffer(0) };
      return res;
    },
    tiffWindow: () => Promise.reject(new Error('not used')),
    duckdb: () => Promise.reject(new Error('not used')),
    pause: async () => {},
  };
  return { net, urls };
}

describe('landmark registry: the Wikidata item cache', () => {
  it('fetches the missing items and their class labels once, then makes no request', async () => {
    const { net, urls } = fakeNet((url) =>
      url.includes('props=labels%7Cclaims') ? JSON.stringify({ entities: { Q1: entity('Tall Tower', 'Q100'), Q2: entity('Old Gate', 'Q200'), Q3: { id: 'Q3', missing: '' } } }) : JSON.stringify({ entities: { Q100: { labels: { en: { value: 'minaret' } } }, Q200: { labels: { en: { value: 'city gate' } } } } }),
    );
    const cache: EntityCache = { items: {}, labels: {} };
    const lines: string[] = [];
    const got = await fillEntityCache(cache, ['Q2', 'Q1', 'Q3'], { net, log: (l) => lines.push(l) });
    expect(got).toEqual({ fetched: ['Q1', 'Q2', 'Q3'], notFetched: [], error: null });
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('ids=Q1%7CQ2%7CQ3');
    expect(cache.items['Q1']).toMatchObject({ label: 'Tall Tower', lat: 28.6, lon: 77.2, sitelinks: 1, instanceIds: ['Q100'] });
    expect(cache.items['Q3']!.missing).toBe(true);
    expect(cache.labels).toEqual({ Q100: 'minaret', Q200: 'city gate' });
    const again = await fillEntityCache(cache, ['Q1', 'Q2', 'Q3'], { net, log: () => {} });
    expect(again).toEqual({ fetched: [], notFetched: [], error: null });
    expect(urls).toHaveLength(2);
  });

  it('reports an unreachable Wikidata and goes on with the cache; an offline build makes no request', async () => {
    const { net, urls } = fakeNet(() => 429);
    const cache: EntityCache = { items: {}, labels: {} };
    const got = await fillEntityCache(cache, ['Q1'], { net, log: () => {} });
    expect(got.fetched).toEqual([]);
    expect(got.notFetched).toEqual(['Q1']);
    expect(got.error).toContain('HTTP 429');
    expect(urls.length).toBe(4);
    const off = await fillEntityCache(cache, ['Q1'], { net: null, log: () => {} });
    expect(off).toEqual({ fetched: [], notFetched: ['Q1'], error: 'offline build: no request made' });
  });
});
