import { describe, it, expect } from 'vitest';
import { STILL_DIFF, judgeTicks, lumaDiff, phaseAt, phaseClass, playStalls, resample, stallAt, withSpans } from './frameseq.mjs';

// P4-071: the transition frame sequences (one frame every 150 ms) and their judge.
const T0 = 1_700_000_000;
const frame = (ms, black = false) => ({ t: T0 + ms / 1000, black });

describe('frameseq', () => {
  it('maps page phases to judge classes', () => {
    expect(phaseClass('loading')).toBe('loading');
    expect(phaseClass('results')).toBe('card');
    expect(phaseClass('credits')).toBe('card');
    expect(phaseClass('card')).toBe('card');
    expect(phaseClass('beat')).toBe('play');
    expect(phaseClass('cutscene')).toBe('play');
    expect(phaseClass('play')).toBe('play');
  });

  it('finds the phase at a wall time', () => {
    const ph = [{ w: 1000, phase: 'play' }, { w: 2000, phase: 'beat' }, { w: 3000, phase: 'results' }];
    expect(phaseAt(ph, 500)).toBe('play');
    expect(phaseAt(ph, 2000)).toBe('beat');
    expect(phaseAt(ph, 2999)).toBe('beat');
    expect(phaseAt(ph, 9000)).toBe('results');
    expect(phaseAt([], 1)).toBe('play');
  });

  it('resamples to one tick every 150 ms with the frame on screen and its age', () => {
    const frames = [frame(0), frame(100), frame(400), frame(1000)];
    const ticks = resample(frames, T0 + 0.95, 150);
    expect(ticks.map((k) => k.ms)).toEqual([0, 150, 300, 450, 600, 750, 900]);
    expect(ticks.map((k) => k.index)).toEqual([0, 1, 1, 2, 2, 2, 2]);
    expect(ticks[2].staleMs).toBe(200);
    expect(ticks[5].staleMs).toBe(350);
  });

  it('passes a short dip to black and fails a long one outside the loading screen', () => {
    const short = resample([frame(0), frame(150, true), frame(450), frame(900)], T0 + 0.9, 150);
    expect(judgeTicks(short).longestBlackMs).toBe(300);
    expect(judgeTicks(short).ok).toBe(true);
    const long = resample([frame(0), frame(150, true), frame(250, true), frame(400, true), frame(550, true), frame(700, true), frame(900)], T0 + 0.9, 150);
    const j = judgeTicks(long);
    expect(j.ok).toBe(false);
    expect(j.longestBlackMs).toBe(750);
  });

  it('allows black and a still picture under the loading screen, a still card, and fails a frozen game', () => {
    const frames = [frame(0), frame(100, true), frame(1500), frame(1600), frame(2600)];
    const phases = [{ w: (T0 + 0.05) * 1000, phase: 'loading' }, { w: (T0 + 1.55) * 1000, phase: 'results' }, { w: (T0 + 2.58) * 1000, phase: 'play' }];
    const ok = judgeTicks(resample(frames, T0 + 2.6, 150, phases));
    expect(ok.ok).toBe(true);
    const frozenPhases = [{ w: (T0 + 0.05) * 1000, phase: 'loading' }, { w: (T0 + 1.55) * 1000, phase: 'play' }];
    const bad = judgeTicks(resample(frames, T0 + 2.6, 150, frozenPhases));
    expect(bad.ok).toBe(false);
    expect(bad.frozenMs).toBeGreaterThan(500);
    expect(bad.phases.map((p) => p.phase)).toEqual(['loading', 'play']);
  });

  // P4-091: Chromium keeps sending frames while the main thread is frozen, so arrival time alone read a 1.2 s freeze as 14 ms.
  const img = (seed, n = 64) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + seed * 11) % 256);
  const live = (ms, seed) => ({ t: T0 + ms / 1000, black: false, luma: img(seed) });

  it('measures the mean luma difference in levels', () => {
    expect(lumaDiff(img(1), img(1))).toBe(0);
    expect(lumaDiff(Uint8Array.from([10, 20]), Uint8Array.from([11, 22]))).toBe(1.5);
    expect(lumaDiff(img(1), undefined)).toBe(Infinity);
    expect(lumaDiff(img(1, 4), img(1, 8))).toBe(Infinity);
  });

  it('fails a run of identical frames that keep arriving (a frozen main thread)', () => {
    const frames = [];
    // A changing game for 600 ms, then 1.2 s of the same picture sent every 16 ms, then the game moves again.
    for (let ms = 0; ms < 600; ms += 16) frames.push(live(ms, ms));
    for (let ms = 600; ms < 1800; ms += 16) frames.push(live(ms, 600));
    for (let ms = 1800; ms < 2400; ms += 16) frames.push(live(ms, ms));
    const ticks = resample(frames, T0 + 2.4, 150);
    expect(Math.max(...ticks.map((k) => k.staleMs))).toBeLessThan(20);
    const j = judgeTicks(ticks);
    expect(j.ok).toBe(false);
    expect(j.frozenMs).toBeGreaterThanOrEqual(1050);
    expect(j.frozenAtMs).toBeGreaterThanOrEqual(600);
    expect(j.frozenAtMs).toBeLessThanOrEqual(750);
  });

  it('treats a near identical picture (a small CSS animation over a frozen game) as still, a moving game as live', () => {
    const base = img(3, 1000);
    const nudge = (k) => { const a = Uint8Array.from(base); for (let i = 0; i < 10; i++) a[i] = (a[i] + k) % 256; return a; };
    const frames = [];
    // 1.2 s of a frozen picture with 1% of its pixels pulsing by 1 to 3 levels (mean diff at most 0.02, under STILL_DIFF).
    for (let ms = 0, n = 0; ms < 1200; ms += 16, n++) frames.push({ t: T0 + ms / 1000, black: false, luma: nudge(1 + (n % 3)) });
    const frozen = judgeTicks(resample(frames, T0 + 1.2, 150));
    expect(frozen.ok).toBe(false);
    // The same, but the whole picture drifts by 0.07 levels a tick (the stillest live game measured: an idle player at the end of
    // M05's end beat): a live game.
    const moving = [];
    for (let ms = 0; ms < 1200; ms += 16) moving.push({ t: T0 + ms / 1000, black: false, luma: Float32Array.from(base, (v) => v + ms * (0.07 / 150)) });
    const live2 = judgeTicks(resample(moving, T0 + 1.2, 150));
    expect(STILL_DIFF).toBeLessThan(0.07);
    expect(live2.ok).toBe(true);
  });

  it('does not count a still card or loading screen into the game freeze', () => {
    const frames = [];
    for (let ms = 0; ms < 3000; ms += 16) frames.push(live(ms, 7));
    const phases = [{ w: T0 * 1000, phase: 'results' }, { w: (T0 + 1.5) * 1000, phase: 'loading' }, { w: (T0 + 2.7) * 1000, phase: 'play' }];
    const j = judgeTicks(resample(frames, T0 + 3.0, 150, phases));
    expect(j.ok).toBe(true);
    expect(j.frozenMs).toBeLessThanOrEqual(300);
  });
  // P4-096: under load the screencast sends a third of the frames; a static cutscene shot of a live game showed the same picture
  // for over a second (arrival age 1119 and 1295 ms). With the page's stalls given, only a stall of the page itself counts.
  it('passes a static shot with few frames while the page kept drawing, and fails one where the page stalled', () => {
    // 1.4 s of the same picture, a frame every 400 ms (a static shot under load), then the game moves again.
    const frames = [];
    for (let ms = 0; ms < 1400; ms += 400) frames.push(live(ms, 5));
    for (let ms = 1400; ms < 2000; ms += 16) frames.push(live(ms, ms));
    // Without the page's stalls: the old judge fails it (the flake).
    expect(judgeTicks(resample(frames, T0 + 2.0, 150)).ok).toBe(false);
    // The page drew all along (no stalls): a still shot, not a freeze.
    const live1 = judgeTicks(resample(frames, T0 + 2.0, 150, [], { stalls: [] }));
    expect(live1.ok).toBe(true);
    expect(live1.frozenMs).toBe(0);
    // A short hitch (120 ms) inside the still shot: no freeze either.
    const hitch = judgeTicks(resample(frames, T0 + 2.0, 150, [], { stalls: [{ w0: (T0 + 0.5) * 1000, w1: (T0 + 0.62) * 1000 }] }));
    expect(hitch.ok).toBe(true);
    expect(hitch.frozenMs).toBeLessThanOrEqual(120);
    // The page drew nothing for 1.2 s (a busy main thread): a freeze, about as long as the stall.
    const stalled = judgeTicks(resample(frames, T0 + 2.0, 150, [], { stalls: [{ w0: (T0 + 0.1) * 1000, w1: (T0 + 1.3) * 1000 }] }));
    expect(stalled.ok).toBe(false);
    expect(stalled.frozenMs).toBeGreaterThanOrEqual(1050);
    expect(stalled.problems[0]).toMatch(/drew no new frame/);
    expect(stallAt([{ w0: 10, w1: 20 }, { w0: 30, w1: 40 }], 35)).toEqual({ w0: 30, w1: 40 });
    expect(stallAt([{ w0: 10, w1: 20 }], 25)).toBeNull();
  });

  it('a page stall fails identical frames that keep arriving (the busy loop negative control) and counts only play time', () => {
    const frames = [];
    for (let ms = 0; ms < 600; ms += 16) frames.push(live(ms, ms));
    for (let ms = 600; ms < 1800; ms += 16) frames.push(live(ms, 600));
    for (let ms = 1800; ms < 2400; ms += 16) frames.push(live(ms, ms));
    const stalls = [{ w0: (T0 + 0.6) * 1000, w1: (T0 + 1.8) * 1000 }];
    const j = judgeTicks(resample(frames, T0 + 2.4, 150, [], { stalls }));
    expect(j.ok).toBe(false);
    expect(j.frozenMs).toBeGreaterThanOrEqual(1050);
    // The same stall, but the loading screen covered its first second: only the play part after it counts.
    const phases = [{ w: T0 * 1000, phase: 'play' }, { w: (T0 + 0.55) * 1000, phase: 'loading' }, { w: (T0 + 1.55) * 1000, phase: 'play' }];
    const k = judgeTicks(resample(frames, T0 + 2.4, 150, phases, { stalls }));
    expect(k.ok).toBe(true);
    expect(k.frozenMs).toBeLessThanOrEqual(300);
  });

  // P4-097: a region swap in one long task: the once-a-frame sampler saw play before and after it, never loading (the screen
  // came in on the compositor), so the stall read as a 600 ms freeze in play. The load log's span fixes the label.
  it('lays load spans over the samples and counts only the play part of each page stall', () => {
    const w = (s) => (T0 + s) * 1000;
    const phases = [{ w: w(0), phase: 'play' }, { w: w(2.0), phase: 'reveal' }, { w: w(2.3), phase: 'play' }];
    const merged = withSpans(phases, [{ w0: w(0.8), w1: w(1.9) }]);
    expect(merged.map((p) => p.phase)).toEqual(['play', 'loading', 'play', 'reveal', 'play']);
    expect(phaseAt(merged, w(1.2))).toBe('loading');
    expect(phaseAt(merged, w(1.95))).toBe('play');
    expect(withSpans(phases, [])).toEqual(phases);
    expect(phaseClass('reveal')).toBe('play');
    // The stall from 0.85 to 2.05 s: 1.05 s under the load, 0.15 s after the screen started to leave.
    const [s] = playStalls([{ w0: w(0.85), w1: w(2.05) }], merged);
    expect(s.ms).toBe(1200);
    expect(s.playMs).toBeGreaterThanOrEqual(145);
    expect(s.playMs).toBeLessThanOrEqual(155);
    expect(s.phase).toBe('loading');
    // Without the span the whole stall was play (the mislabel).
    expect(playStalls([{ w0: w(0.85), w1: w(2.05) }], phases)[0].playMs).toBe(1200);
    // The judge: frames identical through the stall pass once the span is laid over.
    const frames = [];
    for (let ms = 0; ms < 850; ms += 16) frames.push(live(ms, ms));
    for (let ms = 850; ms < 2050; ms += 16) frames.push(live(ms, 850));
    for (let ms = 2050; ms < 2600; ms += 16) frames.push(live(ms, ms));
    const stalls = [{ w0: w(0.85), w1: w(2.05) }];
    expect(judgeTicks(resample(frames, T0 + 2.6, 150, phases, { stalls })).ok).toBe(false);
    expect(judgeTicks(resample(frames, T0 + 2.6, 150, merged, { stalls })).ok).toBe(true);
  });
});
