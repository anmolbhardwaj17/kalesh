// Screen recording for transition checks (P2-112): records what the page really shows (Chrome DevTools screencast, the
// composited frames with their timestamps, overlays and WebGL canvas together) between __recStart and __recStop, then
// measures the longest stretch of PLAIN BLACK screen (a frozen or faded-out frame with nothing on it) and writes a
// frame sequence. Used by page-side verify scripts through functions browser.mjs exposes:
//   await window.__recStart('m01_m02')       starts recording
//   const r = await window.__recStop()        {frames, ms, longestBlackMs, blackFrames, sheet, frames: [...]} and writes
//                                             harness/reports/shots/<name>_seq.png (a contact sheet) and per frame JPEGs
//                                             under harness/reports/frames/<name>/.
// A frame counts as plain black when 90% of its pixels are darker than luma 0.04 and its mean is under 0.03. A frame
// stays on screen until the next one arrives, so a frozen main thread on a black frame counts for the whole freeze. The
// screencast also keeps sending near identical frames while the main thread is frozen (P4-091), so the frame sequence judge
// compares pictures (each frame's 160 x 90 luma) and not only arrival times.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ROOT } from './lib.mjs';
import { judgeTicks, playStalls, resample, withSpans } from './frameseq.mjs';

export const BLACK = { p90: 0.04, mean: 0.03 };

/** Luma stats of one encoded frame (any format sharp reads). */
export async function frameStats(buf) {
  const { data } = await sharp(buf).resize(160, 90, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const L = new Float32Array(data.length / 3);
  let sum = 0;
  for (let i = 0, j = 0; i < data.length; i += 3, j++) { L[j] = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255; sum += L[j]; }
  const sorted = Float32Array.from(L).sort();
  const mean = sum / L.length;
  const p90 = sorted[Math.floor(sorted.length * 0.9)];
  // P4-091: the 160 x 90 luma in levels (0..255), for the frame judge's still test (frameseq.mjs `lumaDiff`).
  const luma = Uint8Array.from(L, (v) => Math.round(v * 255));
  return { mean: +mean.toFixed(3), p90: +p90.toFixed(3), black: p90 < BLACK.p90 && mean < BLACK.mean, luma };
}

/**
 * Longest run of plain black screen in ms. `frames` are [{t (s), black}], sorted by time; `endT` is when recording stopped
 * (the last frame stays on screen until then). Pure, unit tested.
 */
export function longestBlack(frames, endT) {
  let best = 0, start = null, total = 0, count = 0;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    const until = i + 1 < frames.length ? frames[i + 1].t : endT;
    if (f.black) {
      count++;
      total += Math.max(0, until - f.t);
      if (start === null) start = f.t;
      best = Math.max(best, until - start);
    } else start = null;
  }
  return { longestMs: Math.round(best * 1000), totalMs: Math.round(total * 1000), blackFrames: count };
}

/** Starts a screencast on a Playwright page. Returns {stop(name, outDir)}. */
export async function startRecording(page, { maxWidth = 640, maxHeight = 400 } = {}) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  const t0 = Date.now() / 1000;
  cdp.on('Page.screencastFrame', (e) => {
    frames.push({ t: e.metadata && e.metadata.timestamp ? e.metadata.timestamp : Date.now() / 1000, data: Buffer.from(e.data, 'base64') });
    cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth, maxHeight, everyNthFrame: 1 });
  return {
    /**
     * `opts.everyMs` (P4-071): also a frame sequence, one frame every `everyMs` (frameseq.mjs): the frames under
     * frames/<name>/seq/, contact sheets `<name>_every<ms>_<n>.png` (48 ticks each, labelled with time and page phase), and
     * the judge (`opts.phases` from the page, `opts.blackMaxMs`, `opts.frozenMaxMs`).
     */
    async stop(name, shotsDir, opts = {}) {
      const endT = Date.now() / 1000;
      await cdp.send('Page.stopScreencast').catch(() => {});
      await cdp.detach().catch(() => {});
      frames.sort((a, b) => a.t - b.t);
      const stats = [];
      for (const f of frames) stats.push({ t: f.t, ...(await frameStats(f.data)) });
      const gap = longestBlack(stats, endT);
      const safe = String(name).replace(/[^a-zA-Z0-9_.-]/g, '_');
      const dir = path.join(ROOT, 'harness', 'reports', 'frames', safe);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const first = stats.length ? stats[0].t : t0;
      frames.forEach((f, i) => fs.writeFileSync(path.join(dir, `f${String(i).padStart(3, '0')}_${Math.round((f.t - first) * 1000)}ms${stats[i].black ? '_black' : ''}.jpg`), f.data));
      const sheet = frames.length ? await contactSheet(frames, stats, first, path.join(shotsDir, `${safe}_seq.png`)) : null;
      let sequence = null;
      if (opts.everyMs && frames.length) {
        const everyMs = Number(opts.everyMs);
        // P4-096: `opts.stalls` (the page's own stalls, wall ms): a still picture counts as frozen only where the page stalled.
        // P4-097: `opts.loads` (wall ms spans of the page's loads) are loading whatever the per frame samples said.
        const phases = withSpans(Array.isArray(opts.phases) ? opts.phases : [], Array.isArray(opts.loads) ? opts.loads : []);
        const ticks = resample(stats, endT, everyMs, phases, { stalls: Array.isArray(opts.stalls) ? opts.stalls : null });
        const judge = judgeTicks(ticks, { everyMs, ...(opts.blackMaxMs ? { blackMaxMs: opts.blackMaxMs } : {}), ...(opts.frozenMaxMs ? { frozenMaxMs: opts.frozenMaxMs } : {}) });
        const seqDir = path.join(dir, 'seq');
        fs.mkdirSync(seqDir, { recursive: true });
        ticks.forEach((k) => fs.writeFileSync(path.join(seqDir, `t${String(k.ms).padStart(5, '0')}_${k.phase}${k.black ? '_black' : ''}.jpg`), frames[k.index].data));
        const sheets = [];
        for (let s0 = 0, n = 0; s0 < ticks.length; s0 += 48, n++) sheets.push(await tickSheet(frames, ticks.slice(s0, s0 + 48), path.join(shotsDir, `${safe}_every${everyMs}_${n + 1}.png`)));
        // Timeline: `B` black, `~<ms>` a picture still that long (arrival age or still run, P4-091), `d<levels>` a small change,
        // `!<ms>` (P4-096) the page drew no new frame that long (the judged freeze age is the shorter of the two).
        sequence = { everyMs, ticks: ticks.length, sheets: sheets.map((f) => path.relative(ROOT, f)), dir: path.relative(ROOT, seqDir), ...judge, timeline: ticks.map((k) => { const st = Math.max(k.staleMs, k.stillMs); return `${k.ms}${k.black ? 'B' : ''}${st > 300 ? `~${st}` : ''}${k.stallMs > 0 ? `!${k.stallMs}` : ''}${k.diff !== null && k.diff < 0.5 ? `d${k.diff.toFixed(2)}` : ''}:${k.phase}`; }), stalls: Array.isArray(opts.stalls) ? opts.stalls.length : null };
        // P4-097: each page stall with the part of it the game was on screen for (ms from the first frame, longest in play first).
        const t0ms = stats[0].t * 1000;
        sequence.pageStalls = Array.isArray(opts.stalls) ? playStalls(opts.stalls, phases).map((s) => ({ atMs: Math.round(s.w0 - t0ms), ms: s.ms, playMs: s.playMs, phase: s.phase })) : null;
      }
      return {
        sequence,
        frames: frames.length,
        ms: Math.round((endT - first) * 1000),
        longestBlackMs: gap.longestMs,
        totalBlackMs: gap.totalMs,
        blackFrames: gap.blackFrames,
        sheet: sheet ? path.relative(ROOT, sheet) : null,
        dir: path.relative(ROOT, dir),
        timeline: stats.map((s) => ({ ms: Math.round((s.t - first) * 1000), mean: s.mean, black: s.black })),
      };
    },
  };
}

/** P4-071: a sheet of up to 48 ticks (8 x 6, 200 x 125 each): time, page phase, BLACK, and the age of a still picture. */
async function tickSheet(frames, ticks, file) {
  const cw = 200, ch = 125, cols = 8, rows = Math.ceil(ticks.length / cols);
  const tiles = [];
  for (let k = 0; k < ticks.length; k++) {
    const t = ticks[k];
    const img = await sharp(frames[t.index].data).resize(cw, ch, { fit: 'contain', background: '#000' }).png().toBuffer();
    const st = Math.max(t.staleMs, t.stillMs || 0);
    // P4-096: `frozen` when the page also drew no new frame (the judged age), else `still` (a static shot of a live game).
    const label = `${t.ms} ${t.phase}${t.black ? ' BLACK' : ''}${t.stallMs !== undefined && t.frozenMs > 300 ? ` frozen ${t.frozenMs}` : st > 300 ? ` still ${st}` : ''}`;
    const svg = Buffer.from(`<svg width="${cw}" height="${ch}" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="${cw}" height="16" fill="rgba(0,0,0,0.65)"/><text x="4" y="12" font-family="Helvetica" font-size="11" fill="#ffcc66">${label}</text></svg>`);
    tiles.push({ input: img, left: (k % cols) * cw, top: Math.floor(k / cols) * ch });
    tiles.push({ input: svg, left: (k % cols) * cw, top: Math.floor(k / cols) * ch });
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp({ create: { width: cols * cw, height: rows * ch, channels: 3, background: '#202020' } }).composite(tiles).png().toFile(file);
  return file;
}

/** A 4 x 3 contact sheet of 12 frames spread over the recording, each labelled with its time. */
async function contactSheet(frames, stats, first, file) {
  const n = Math.min(12, frames.length);
  const pick = [];
  for (let i = 0; i < n; i++) pick.push(Math.round((i * (frames.length - 1)) / Math.max(1, n - 1)));
  // A black frame, if there is one, always gets a tile (it replaces the nearest pick), so the sheet never hides it.
  const blackAt = stats.findIndex((s) => s.black);
  if (blackAt >= 0 && !pick.includes(blackAt)) {
    let near = 0;
    for (let k = 1; k < pick.length; k++) if (Math.abs(pick[k] - blackAt) < Math.abs(pick[near] - blackAt)) near = k;
    pick[near] = blackAt;
    pick.sort((a, b) => a - b);
  }
  const cw = 320, ch = 200, cols = 4, rows = Math.ceil(n / cols);
  const tiles = [];
  for (let k = 0; k < pick.length; k++) {
    const i = pick[k];
    const img = await sharp(frames[i].data).resize(cw, ch, { fit: 'contain', background: '#000' }).png().toBuffer();
    const label = `${Math.round((frames[i].t - first) * 1000)} ms${stats[i].black ? ' BLACK' : ''}`;
    const svg = Buffer.from(`<svg width="${cw}" height="${ch}" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="${cw}" height="22" fill="rgba(0,0,0,0.6)"/><text x="6" y="16" font-family="Helvetica" font-size="14" fill="#ffcc66">${label}</text></svg>`);
    tiles.push({ input: img, left: (k % cols) * cw, top: Math.floor(k / cols) * ch });
    tiles.push({ input: svg, left: (k % cols) * cw, top: Math.floor(k / cols) * ch });
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp({ create: { width: cols * cw, height: rows * ch, channels: 3, background: '#202020' } }).composite(tiles).png().toFile(file);
  return file;
}
