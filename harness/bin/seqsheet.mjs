// Frame sequence contact sheets (P2-107, scenario move_proof): one PNG per move with one row per preset (and pose), a
// header with the frame times, a label column with the row's own numbers, and an optional plot strip on top (top-down paths
// with equal axes, or a value over time), so the presets compare at a glance.
//
// Used two ways:
//   - browser.mjs step `{sheets: true}`: draws every sheet a page script returned in `summary.sheets` (and writes its
//     `summary.files` text files) into the shots folder.
//   - CLI, to redraw from a report without running the game again:
//       node harness/bin/seqsheet.mjs [--report harness/reports/latest.json] [--scenario move_proof] [--shots <dir>] [--out <dir>]
//
// Sheet spec: {name, title, subtitle?, times: [label per column], tile?: [w, h], rows: [{label, sub?, note?, shots: [shot
// names without .png], crop?: [x, y, w, h] fractions of the frame, gap?: true (space above the row)}], plot?: {kind:
// 'path' | 'xy', title?, xLabel?, yLabel?, height?, series: [{label, color, pts: [[x, y], ...]}], marks?: [{x, y, r?,
// label?}], bounds?: [x0, y0, x1, y1]}}. A missing shot draws an empty tile marked "missing".
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { PATHS } from './lib.mjs';

const BG = '#16181c';
const FG = '#e8e4da';
const DIM = '#9a968c';
const LABEL_W = 300;
const HEAD_H = 92;
const COL_H = 30;
const GAP = 14;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Text lines as an SVG buffer (width x height, left aligned at x 12). */
function textSvg(w, h, lines, o = {}) {
  const parts = lines.map((l, i) => {
    const size = l.size ?? 18;
    const y = l.y ?? 26 + i * 24;
    return `<text x="${l.x ?? 12}" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="${l.bold ? 700 : 400}" fill="${l.color ?? FG}"${l.anchor ? ` text-anchor="${l.anchor}"` : ''}>${esc(l.text)}</text>`;
  });
  return Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="${o.bg ?? BG}"/>${parts.join('')}</svg>`);
}

/** Nice round tick step for a span. */
function tickStep(span, n = 6) {
  const raw = span / n;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

/** The plot strip as an SVG buffer, `w` wide. Paths keep equal axes (meters stay square); xy plots fill the box. */
function plotSvg(plot, w) {
  const all = plot.series.flatMap((s) => s.pts).concat((plot.marks || []).map((m) => [m.x, m.y]));
  if (all.length === 0) return null;
  let [x0, y0, x1, y1] = plot.bounds || [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))];
  if (!plot.bounds) {
    const px = (x1 - x0) * 0.04 || 0.1;
    const py = (y1 - y0) * 0.08 || 0.1;
    x0 -= px; x1 += px; y0 -= py; y1 += py;
  }
  const padL = 70, padR = 30, padT = 44, padB = 46;
  const maxH = plot.height ?? 360;
  let pw = w - padL - padR - LABEL_W;
  let ph = maxH - padT - padB;
  if (plot.kind === 'path') {
    // Equal axes: shrink whichever side is too long for the other.
    const s = Math.min(pw / (x1 - x0), ph / (y1 - y0));
    pw = (x1 - x0) * s;
    ph = (y1 - y0) * s;
  }
  const h = Math.round(ph + padT + padB);
  const ox = LABEL_W + padL + ((w - LABEL_W - padL - padR) - pw) / 2;
  const X = (x) => ox + ((x - x0) / (x1 - x0)) * pw;
  // Paths: +y of the data is drawn up (north up when y is world z).
  const Y = (y) => padT + ph - ((y - y0) / (y1 - y0)) * ph;
  const out = [];
  out.push(`<rect width="${w}" height="${h}" fill="${BG}"/>`);
  out.push(`<rect x="${ox}" y="${padT}" width="${pw}" height="${ph}" fill="#202329" stroke="#3a3e46"/>`);
  const sx = tickStep(x1 - x0, plot.kind === 'path' ? 12 : 10);
  const sy = tickStep(y1 - y0, 5);
  for (let v = Math.ceil(x0 / sx) * sx; v <= x1 + 1e-9; v += sx) {
    out.push(`<line x1="${X(v)}" y1="${padT}" x2="${X(v)}" y2="${padT + ph}" stroke="#2c3038"/>`);
    out.push(`<text x="${X(v)}" y="${padT + ph + 20}" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="${DIM}" text-anchor="middle">${+v.toFixed(3)}</text>`);
  }
  for (let v = Math.ceil(y0 / sy) * sy; v <= y1 + 1e-9; v += sy) {
    out.push(`<line x1="${ox}" y1="${Y(v)}" x2="${ox + pw}" y2="${Y(v)}" stroke="#2c3038"/>`);
    out.push(`<text x="${ox - 8}" y="${Y(v) + 5}" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="${DIM}" text-anchor="end">${+v.toFixed(3)}</text>`);
  }
  if (plot.zeroY && y0 < 0 && y1 > 0) out.push(`<line x1="${ox}" y1="${Y(0)}" x2="${ox + pw}" y2="${Y(0)}" stroke="#596070" stroke-dasharray="6 4"/>`);
  for (const m of plot.marks || []) {
    out.push(`<circle cx="${X(m.x)}" cy="${Y(m.y)}" r="${m.r ?? 6}" fill="#e0b23a" stroke="#16181c" stroke-width="2"/>`);
    if (m.label) out.push(`<text x="${X(m.x)}" y="${Y(m.y) - 10}" font-family="Helvetica, Arial, sans-serif" font-size="13" fill="#e0b23a" text-anchor="middle">${esc(m.label)}</text>`);
  }
  for (const s of plot.series) {
    if (s.pts.length < 2) continue;
    const d = s.pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
    out.push(`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width ?? 3}" stroke-linejoin="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`);
    for (const p of s.dots || []) out.push(`<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="4" fill="${s.color}"/>`);
  }
  // Legend and titles in the label column.
  const lines = [];
  if (plot.title) lines.push(`<text x="12" y="30" font-family="Helvetica, Arial, sans-serif" font-size="18" font-weight="700" fill="${FG}">${esc(plot.title)}</text>`);
  plot.series.filter((s) => s.label).forEach((s, i) => {
    const y = 64 + i * 26;
    lines.push(`<rect x="12" y="${y - 12}" width="28" height="6" fill="${s.color}"/>`);
    lines.push(`<text x="50" y="${y - 3}" font-family="Helvetica, Arial, sans-serif" font-size="16" fill="${FG}">${esc(s.label)}</text>`);
  });
  if (plot.xLabel) out.push(`<text x="${ox + pw}" y="${padT + ph + 40}" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="${DIM}" text-anchor="end">${esc(plot.xLabel)}</text>`);
  if (plot.yLabel) out.push(`<text x="${ox}" y="${padT - 12}" font-family="Helvetica, Arial, sans-serif" font-size="14" fill="${DIM}">${esc(plot.yLabel)}</text>`);
  return { buf: Buffer.from(`<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${out.join('')}${lines.join('')}</svg>`), h };
}

/** One tile: the shot cropped (fractions) and fitted to the tile, or a "missing" tile. */
async function tile(file, crop, tw, th) {
  if (!fs.existsSync(file)) return sharp(textSvg(tw, th, [{ text: `missing ${path.basename(file)}`, size: 14, color: '#d06050' }], { bg: '#301818' })).png().toBuffer();
  let img = sharp(file);
  if (crop) {
    const meta = await sharp(file).metadata();
    const [cx, cy, cw, ch] = crop;
    img = img.extract({ left: Math.round(cx * meta.width), top: Math.round(cy * meta.height), width: Math.round(cw * meta.width), height: Math.round(ch * meta.height) });
  }
  return img.resize(tw, th, { fit: 'cover' }).png().toBuffer();
}

/** Draws one sheet from the shots in `dir` into `out`/<name>.png; returns the file path. */
export async function drawSheet(spec, dir, out = dir) {
  const [tw, th] = spec.tile || [288, 162];
  const cols = Math.max(...spec.rows.map((r) => r.shots.length), spec.times ? spec.times.length : 0);
  const W = LABEL_W + cols * (tw + 4) + 12;
  const comps = [];
  let y = 0;
  comps.push({ input: textSvg(W, HEAD_H, [
    { text: spec.title, size: 30, bold: true, y: 40 },
    ...(spec.subtitle ? [{ text: spec.subtitle, size: 18, color: DIM, y: 72 }] : []),
  ]), left: 0, top: y });
  y += HEAD_H;
  if (spec.plot) {
    const p = plotSvg(spec.plot, W);
    if (p) { comps.push({ input: p.buf, left: 0, top: y }); y += p.h + 6; }
  }
  if (spec.times) {
    const lines = spec.times.map((t, i) => ({ text: t, size: 16, color: DIM, x: LABEL_W + i * (tw + 4) + tw / 2, y: 21, anchor: 'middle' }));
    comps.push({ input: textSvg(W, COL_H, [{ text: spec.timesLabel || 'time after the input', size: 15, color: DIM, y: 21 }, ...lines]), left: 0, top: y });
    y += COL_H;
  }
  for (const r of spec.rows) {
    if (r.gap) y += GAP;
    const lines = [{ text: r.label, size: 24, bold: true, y: 34, color: r.color || FG }];
    if (r.sub) lines.push({ text: r.sub, size: 17, color: DIM, y: 60 });
    (Array.isArray(r.note) ? r.note : r.note ? [r.note] : []).forEach((n, i) => lines.push({ text: n, size: 15, y: 88 + i * 21 }));
    comps.push({ input: textSvg(LABEL_W, th, lines), left: 0, top: y });
    for (let i = 0; i < r.shots.length; i++) {
      comps.push({ input: await tile(path.join(dir, `${r.shots[i]}.png`), r.crop, tw, th), left: LABEL_W + i * (tw + 4), top: y });
    }
    y += th + 4;
  }
  const H = y + 8;
  const file = path.join(out, `${spec.name}.png`);
  fs.mkdirSync(out, { recursive: true });
  await sharp({ create: { width: W, height: H, channels: 3, background: BG } }).composite(comps).png().toFile(file);
  return file;
}

/** Draws every sheet of a script result's summary and writes its text files; returns the written paths. */
export async function drawAll(summary, dir, out = dir) {
  const written = [];
  for (const spec of summary.sheets || []) written.push(await drawSheet(spec, dir, out));
  for (const f of summary.files || []) {
    const file = path.join(out, path.basename(f.name));
    fs.writeFileSync(file, f.text);
    written.push(file);
  }
  return written;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
  const report = JSON.parse(fs.readFileSync(path.resolve(opt('report', PATHS.reportLatest)), 'utf8'));
  const name = opt('scenario', 'move_proof');
  const sc = report.scenarios && report.scenarios[name];
  if (!sc || !sc.summary || !sc.summary.sheets) { console.error(`seqsheet: no sheets in scenario ${name} of the report`); process.exit(1); }
  const shots = path.resolve(opt('shots', PATHS.shots));
  const files = await drawAll(sc.summary, shots, path.resolve(opt('out', shots)));
  for (const f of files) console.log(f);
}
