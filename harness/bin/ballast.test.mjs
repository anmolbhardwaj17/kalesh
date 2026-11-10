import { describe, it, expect } from 'vitest';
import { nextBallastSize, ballastCost, ballastPerf, calibrateBallast, ballastText } from './ballast.mjs';

describe('nextBallastSize', () => {
  it('stops in range, grows when short, shrinks when long', () => {
    expect(nextBallastSize(1000, 15)).toBe(null);
    expect(nextBallastSize(1000, 6)).toBe(2500);
    expect(nextBallastSize(1000, 11)).toBe(1500);
    expect(nextBallastSize(1000, 30)).toBe(500);
    expect(nextBallastSize(1000, null)).toBe(1500);
  });
});

describe('ballastCost', () => {
  it('uses the GPU p95 with the ballast and the frame cost as the cross-check', () => {
    const c = ballastCost({ gpuMs: { p50: 7, p95: 7.456 }, frameMs: { p50: 20.1, p95: 21 } }, { frameMs: { p50: 13.0, p95: 13.6 } }, 900);
    expect(c).toMatchObject({ ms: 7.46, source: 'ballast-gpu', gpuP95: 7.46, frameCostP50: 7.1, frameCostP95: 7.4, blankFrameP50: 13, n: 900 });
  });
  it('falls back to the frame cost where the driver has no GPU timer (Metal)', () => {
    const c = ballastCost({ frameMs: { p50: 18, p95: 19 } }, { frameMs: { p50: 13, p95: 13.5 } });
    expect(c).toMatchObject({ ms: 5.5, source: 'ballast-frame', gpuP95: null, frameCostP50: 5 });
  });
  it('has no cost with neither', () => {
    expect(ballastCost({}, {}).ms).toBe(null);
  });
});

/** A fake debug client: frame p50 is `blank` alone (3D off) or `blank + scene` with the ballast on. */
function fakeClient({ scene = 5, ballastMs = 13, gpu = true } = {}) {
  const st = { n: 0, blank: false, calls: [] };
  return {
    st,
    async call(method, ...args) {
      st.calls.push([method, ...args]);
      if (method === 'bench') {
        if (args[0] === 'ballast') st.n = args[1].n;
        if (args[0] === 'blank') st.blank = args[1].on;
        return {};
      }
      if (method === 'perf') {
        const busy = st.n > 0;
        const f = busy ? ballastMsFor(st.n, ballastMs) + (st.blank ? 0 : scene) : 8.33;
        return { frameMs: { p50: f, p95: f + 0.5 }, ...(gpu ? { gpuMs: { p50: busy ? scene : 6.5, p95: busy ? scene + 0.3 : 6.6 } } : {}) };
      }
      throw new Error(`unexpected ${method}`);
    },
  };
}
const ballastMsFor = (n, at) => (n / 1200) * (at * 0.6) + at * 0.4;

describe('ballastPerf', () => {
  it('adds gpuCost and keeps the capped reading, and switches the ballast off', async () => {
    const client = fakeClient();
    const plain = { gpuMs: { p50: 6.5, p95: 6.6 }, cpuMs: { p95: 1 } };
    const out = await ballastPerf(client, plain, { windowMs: 1000 });
    expect(out.gpuMsCapped).toEqual(plain.gpuMs);
    expect(out.gpuCost.source).toBe('ballast-gpu');
    expect(out.gpuCost.ms).toBeCloseTo(5.3, 1);
    expect(out.gpuCost.frameCostP50).toBeCloseTo(5, 1);
    expect(client.st.n).toBe(0);
    expect(client.st.blank).toBe(false);
  });
  it('reports an error instead of throwing, still switching the ballast off', async () => {
    const client = fakeClient();
    const orig = client.call.bind(client);
    client.call = async (m, ...a) => { if (m === 'perf') throw new Error('gone'); return orig(m, ...a); };
    const out = await ballastPerf(client, { cpuMs: { p95: 1 } });
    expect(out.gpuCost.error).toMatch(/gone/);
    expect(out.cpuMs.p95).toBe(1);
  });
  it('starts from the cached size for a key', async () => {
    const client = fakeClient({ ballastMs: 6 });
    const cache = {};
    const n = await calibrateBallast(client, cache, 'vulkan');
    const calls = client.st.calls.length;
    expect(cache.vulkan).toBe(n);
    await calibrateBallast(client, cache, 'vulkan');
    expect(client.st.calls.length - calls).toBeLessThan(calls);
  });
});

describe('ballastText', () => {
  it('reads as a line', () => {
    expect(ballastText({ ms: 7.4, gpuP95: 7.4, frameCostP50: 7.1 })).toBe('ballast gpu p95 7.4 ms, frame cost p50 7.1 ms');
    expect(ballastText({ error: 'x' })).toBe('ballast n/a (x)');
  });
});
