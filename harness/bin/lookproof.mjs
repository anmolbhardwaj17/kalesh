#!/usr/bin/env node
// Look proof: the same camera poses shot again and again, so a look change is judged against approved reference shots and
// style candidates are compared side by side with measured frame times. Phase 0 uses it for the style tests; later every
// task that changes the look runs --set and --compare.
//
//   node harness/bin/lookproof.mjs --check
//       validates harness/look_proof/poses.json (exit 1 on a problem)
//   node harness/bin/lookproof.mjs --set <name> [--views a,b] [--query "style=toon"] [--perf] [--no-build]
//       shoots every view of poses.json into harness/look_proof/<name>/<view>.png (+ shots.json). --query adds page params
//       (a style test task switches the look with one, for example ?style=toon). --perf also measures each view
//       (debug.perf, judged against harness/verify/perf_budgets.json) into harness/look_proof/<name>/perf.json.
//   node harness/bin/lookproof.mjs --approve <name>
//       makes that set the approved reference (harness/look_proof/approved/), recorded in approved.json. Only after the
//       owner said yes to it (Phase 0 sign-off, or a look task he accepted).
//   node harness/bin/lookproof.mjs --compare <name> [--against approved] [--tol-mean 6] [--tol-share 0.25] [--delta 40]
//       pixel compare of every shot against the reference (sharp): mean channel difference and the share of pixels that
//       moved more than --delta. Tolerances default from harness/verify/look_rules.json. Writes a side by side sheet per
//       view into harness/reports/look/. Exit 1 when a shot is over tolerance or missing.
//   node harness/bin/lookproof.mjs --sheet <setA,setB,...> [--out style_options]
//       one side by side contact sheet (a row per view, a column per set, with each set's frame time p95 under its label)
//       in harness/reports/look/<out>.jpg, 1600 px wide: the picture for STYLE_OPTIONS.md.
//
// poses.json: { "views": [ { "name": "start_area", "quality": "medium", "steps": [ <verify steps that stage the scene,
//   for example {"call": "loadLevel", "args": ["L01"]}, {"call": "setCamera", "args": [{"pos": [0,2,5], "target": [0,0,0]}]},
//   {"settle": 1} > ] } ] }. Steps use the same step format as scenarios (VERIFY.md).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, R, readJSON, writeJSON, nowISO, parseArgs, git, config } from './lib.mjs';
import { npmRun, startServer, launch, openPage, waitReady, runStep } from './browser.mjs';
import { loadBudgets, judgeBudgets } from './perfbudget.mjs';

const args = parseArgs(process.argv.slice(2), { booleans: ['check', 'perf', 'no-build'] });
const LP = R('harness', 'look_proof');
const POSES = path.join(LP, 'poses.json');
const LOOK_OUT = R('harness', 'reports', 'look');
const CFG = config();

function usage() { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 27).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); }

export function checkPoses(p) {
  const errs = [];
  if (!p || !Array.isArray(p.views) || !p.views.length) return ['poses.json needs a non empty "views" array'];
  const seen = new Set();
  p.views.forEach((v, i) => {
    if (!v.name || !/^[a-z0-9_]+$/.test(v.name)) errs.push(`view ${i + 1}: name must be snake_case`);
    if (seen.has(v.name)) errs.push(`view ${v.name}: duplicate name`);
    seen.add(v.name);
    if (!Array.isArray(v.steps)) errs.push(`view ${v.name}: steps must be an array`);
  });
  return errs;
}

async function sharpOrNull() { try { return (await import('sharp')).default; } catch { return null; } }

async function shootSet(name) {
  const poses = readJSON(POSES, null);
  const errs = checkPoses(poses);
  if (errs.length) { console.log(errs.join('\n')); process.exit(1); }
  const want = typeof args.views === 'string' ? new Set(args.views.split(',')) : null;
  const views = poses.views.filter((v) => !want || want.has(v.name));
  if (!args['no-build']) { const b = npmRun('build'); if (!b.ok) { console.log(`build failed:\n${b.tail}`); process.exit(1); } }
  const dir = path.join(LP, name);
  fs.mkdirSync(dir, { recursive: true });
  const server = await startServer();
  const { browser, gl } = await launch();
  const budgets = loadBudgets();
  const shots = readJSON(path.join(dir, 'shots.json'), { views: {} });
  const perf = readJSON(path.join(dir, 'perf.json'), { rows: {} });
  let bad = 0;
  try {
    for (const v of views) {
      const q = [CFG.pageQuery, v.quality ? `quality=${v.quality}` : '', typeof args.query === 'string' ? args.query : ''].filter(Boolean).join('&');
      const t0 = Date.now();
      const { page, log } = await openPage(browser, `${server.url}index.html?${q}`, { width: v.size?.[0] || 1280, height: v.size?.[1] || 720 });
      const ready = await waitReady(page);
      const loadMs = Date.now() - t0;
      const ctx = { page, shotsDir: dir, shots: [], perf: null };
      let err = ready.ok ? null : ready.reason;
      for (const st of ready.ok ? v.steps : []) { const r = await runStep(ctx, st); if (!r.ok) { err = r.error; break; } }
      if (!err) { const r = await runStep(ctx, { shot: v.name }); if (!r.ok) err = r.error; }
      if (!err && args.perf) {
        const r = await runStep(ctx, { perf: budgets.windowMs });
        if (r.ok && ctx.perf) {
          const j = judgeBudgets({ perf: ctx.perf, loadMs, quality: v.quality, budgets, software: gl.software });
          perf.rows[v.name] = { quality: v.quality || null, loadMs, cpuP95: ctx.perf.cpuMs?.p95 ?? null, gpuP95: ctx.perf.gpuMs?.p95 ?? null, fps: ctx.perf.avgFps ?? null, drawCalls: ctx.perf.drawCalls ?? null, triangles: ctx.perf.triangles ?? null, frameP95: j.frame?.p95 ?? null, verdict: j.fails.length ? 'FAIL' : j.warnings.length ? 'warn' : 'ok', notes: [...j.fails, ...j.warnings] };
        } else err = `perf: ${r.error}`;
      }
      if (log.errors.length && !err) err = `${log.errors.length} console error(s): ${log.errors[0].text}`;
      shots.views[v.name] = { file: `${v.name}.png`, at: nowISO(), query: q, error: err };
      console.log(`  ${v.name}: ${err ? 'FAIL ' + err : 'ok'}${perf.rows[v.name] && args.perf ? ` (p95 ${perf.rows[v.name].frameP95?.toFixed?.(1) ?? '-'} ms, ${perf.rows[v.name].drawCalls ?? '-'} calls, ${perf.rows[v.name].verdict})` : ''}`);
      if (err) bad++;
      await page.close();
    }
  } finally { await browser.close(); await server.close(); }
  shots.commit = git('rev-parse --short HEAD'); shots.gl = gl.renderer; shots.at = nowISO();
  writeJSON(path.join(dir, 'shots.json'), shots);
  if (args.perf) { perf.gl = gl.renderer; perf.budgets = budgets.source; writeJSON(path.join(dir, 'perf.json'), perf); }
  console.log(`LOOKPROOF SET ${name}: ${bad ? 'FAIL' : 'OK'} (${views.length} views) -> ${path.relative(ROOT, dir)}`);
  process.exitCode = bad ? 1 : 0;
}

function approve(name) {
  const src = path.join(LP, name);
  if (!fs.existsSync(src)) { console.log(`no set ${name}`); process.exit(2); }
  const dst = path.join(LP, 'approved');
  fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(src, dst, { recursive: true });
  writeJSON(path.join(LP, 'approved.json'), { from: name, at: nowISO(), commit: git('rev-parse --short HEAD') });
  console.log(`LOOKPROOF approved: ${name} is the reference now (harness/look_proof/approved)`);
}

/** Mean absolute channel difference (0..255) and the share of pixels whose largest channel moved more than delta. */
export function diffRaw(a, b, px, delta) {
  let sum = 0; let over = 0;
  for (let i = 0; i < px; i++) {
    let m = 0;
    for (let c = 0; c < 3; c++) { const d = Math.abs(a[i * 3 + c] - b[i * 3 + c]); sum += d; if (d > m) m = d; }
    if (m > delta) over++;
  }
  return { mean: sum / (px * 3), share: over / px };
}

async function compare(name) {
  const sharp = await sharpOrNull();
  if (!sharp) { console.log('lookproof --compare needs sharp: npm i -D sharp'); process.exit(2); }
  const rules = readJSON(R('harness', 'verify', 'look_rules.json'), {});
  const tolMean = Number(args['tol-mean'] ?? rules.tolMean ?? 6);
  const tolShare = Number(args['tol-share'] ?? rules.tolShare ?? 0.25);
  const delta = Number(args.delta ?? rules.delta ?? 40);
  const refName = typeof args.against === 'string' ? args.against : 'approved';
  const a = path.join(LP, name); const b = path.join(LP, refName);
  if (!fs.existsSync(b)) { console.log(`no reference set ${refName} (run --approve first)`); process.exit(2); }
  fs.mkdirSync(LOOK_OUT, { recursive: true });
  const names = fs.readdirSync(b).filter((n) => n.endsWith('.png')).sort();
  let bad = 0;
  console.log(`lookproof compare ${name} vs ${refName} (pass: mean <= ${tolMean}, share over ${delta} <= ${tolShare})`);
  for (const n of names) {
    const fa = path.join(a, n);
    if (!fs.existsSync(fa)) { console.log(`  ${n.padEnd(28)} MISSING in ${name}`); bad++; continue; }
    const W = 640; const H = 360;
    const raw = (f) => sharp(f).removeAlpha().resize(W, H, { fit: 'fill' }).raw().toBuffer();
    const [x, y] = await Promise.all([raw(fa), raw(path.join(b, n))]);
    const { mean, share } = diffRaw(x, y, W * H, delta);
    const ok = mean <= tolMean && share <= tolShare;
    if (!ok) bad++;
    const sheet = path.join(LOOK_OUT, `${path.basename(n, '.png')}_${name}_vs_${refName}.jpg`);
    await sharp({ create: { width: W * 2 + 10, height: H, channels: 3, background: '#222' } })
      .composite([{ input: await sharp(path.join(b, n)).resize(W, H, { fit: 'fill' }).png().toBuffer(), left: 0, top: 0 }, { input: await sharp(fa).resize(W, H, { fit: 'fill' }).png().toBuffer(), left: W + 10, top: 0 }])
      .jpeg({ quality: 82 }).toFile(sheet);
    console.log(`  ${n.padEnd(28)} mean ${mean.toFixed(2).padStart(6)}  share ${(share * 100).toFixed(1).padStart(5)}%  ${ok ? 'ok' : 'FAIL'}  sheet ${path.relative(ROOT, sheet)} (left ${refName}, right ${name})`);
  }
  console.log(bad ? `LOOKPROOF COMPARE FAIL (${bad})` : `LOOKPROOF COMPARE OK (${names.length} shots)`);
  process.exitCode = bad ? 1 : 0;
}

async function sheet(list) {
  const sharp = await sharpOrNull();
  if (!sharp) { console.log('lookproof --sheet needs sharp: npm i -D sharp'); process.exit(2); }
  const sets = list.split(',').map((s) => s.trim()).filter(Boolean);
  const views = [...new Set(sets.flatMap((s) => (fs.existsSync(path.join(LP, s)) ? fs.readdirSync(path.join(LP, s)).filter((n) => n.endsWith('.png')) : [])))].sort();
  const cw = Math.floor((1600 - 10 * (sets.length + 1)) / sets.length); const ch = Math.round(cw * 9 / 16); const head = 46;
  const H = head + views.length * (ch + 10) + 10;
  const comps = [];
  const label = (text, w, h, size = 18) => Buffer.from(`<svg width="${w}" height="${h}"><text x="6" y="${size + 4}" font-family="Helvetica" font-size="${size}" fill="#eee">${String(text).replace(/[<&]/g, '')}</text></svg>`);
  sets.forEach((s, i) => {
    const perf = readJSON(path.join(LP, s, 'perf.json'), null);
    const p95s = perf ? Object.values(perf.rows || {}).map((r) => r.frameP95).filter((x) => typeof x === 'number') : [];
    const p = p95s.length ? `, worst p95 ${Math.max(...p95s).toFixed(1)} ms` : '';
    comps.push({ input: label(`${s}${p}`, cw, head), left: 10 + i * (cw + 10), top: 4 });
  });
  for (const [r, v] of views.entries()) {
    for (const [i, s] of sets.entries()) {
      const f = path.join(LP, s, v);
      const left = 10 + i * (cw + 10); const top = head + r * (ch + 10);
      if (fs.existsSync(f)) comps.push({ input: await sharp(f).resize(cw, ch, { fit: 'cover' }).png().toBuffer(), left, top });
      else comps.push({ input: label(`${v}: missing`, cw, ch), left, top });
    }
  }
  fs.mkdirSync(LOOK_OUT, { recursive: true });
  const out = path.join(LOOK_OUT, `${typeof args.out === 'string' ? args.out : 'style_options'}.jpg`);
  await sharp({ create: { width: 1600, height: H, channels: 3, background: '#181818' } }).composite(comps).jpeg({ quality: 80 }).toFile(out);
  console.log(`LOOKPROOF SHEET ${path.relative(ROOT, out)} (${views.length} views x ${sets.length} sets)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  if (args.help || process.argv.length <= 2) usage();
  else if (args.check) { const e = checkPoses(readJSON(POSES, null)); console.log(e.length ? e.join('\n') : 'poses.json OK'); process.exitCode = e.length ? 1 : 0; }
  else if (typeof args.set === 'string') await shootSet(args.set);
  else if (typeof args.approve === 'string') approve(args.approve);
  else if (typeof args.compare === 'string') await compare(args.compare);
  else if (typeof args.sheet === 'string') await sheet(args.sheet);
  else usage();
}
