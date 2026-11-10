#!/usr/bin/env node
// Ad hoc screenshots and play-throughs of the game. Read the resulting PNGs with the Read tool. kit.config.json "target"
// picks the driver (driver.mjs): godot launches the pinned Godot windowed (godotdriver.mjs), web serves the build in Chromium.
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, R, parseArgs, config } from './lib.mjs';
import { npmRun } from './browser.mjs';
import { loadDriver } from './driver.mjs';

const HELP = `shoot.mjs: screenshots of the game (target godot: the pinned Godot, windowed, with -- --debug --verify;
target web: serves the build folder, public/ first for new assets)

  --build                 run npm run build first (godot: the headless import; otherwise uses the existing build)
  --args "--scene=x --lockstep"              godot: extra game args after -- (docs/GAME_HOOKS.md "Args")
  --query "a=1&b"         godot: page params as game args (--a=1 --b); web: use --url
  --url "<path?query>"    web: page to open (default "index.html?<pageQuery from kit.config.json>")
  --play                  web: open /play/ on the dashboard instead (http://localhost:<port>/play/)
  --load L01 [--opts '{"checkpoint":1}']     window.__game.debug.load(id, opts)  (a level, scene or milestone)
  --teleport "x,y,z" | anchor_name           window.__game.debug.teleport(...)
  --camera "x,y,z;tx,ty,tz" | pose_name      window.__game.debug.setCamera(...) (applied after --keys)
  --quality low|medium|high                  the start preset (godot --quality=<q>; web &quality=<q>)
  --hud off                                  window.__game.debug.hud(false)
  --wait 1500             ms to wait before the first shot (default 1200)
  --input "move:0,1:1500 jump:1:100"         action:value[:holdMs] via debug.input (space separated; number, true/false or "x,y")
  --keys "KeyW:1500 Space Enter"             web: raw keyboard: key[:holdMs] (godot: use --input)
  --eval "<js expression>"                   run in the page (several: separate with ';;')
  --script harness/verify/scripts/x.js       a page-side script (async function body, returns {ok, reason, log}); may call await window.__shot(name)
  --frames 4 --every 500  a sequence of shots (animation checks)
  --out name              file name (default shot_<time>) -> harness/reports/shots/<name>.png
  --size 1280x720 | --headed | --dpr 2     (--headed and --dpr: web only)
Order: --load, --teleport, --keys, --camera, --hud, --script, --eval, --wait, --input, shots.
Prints the screenshot paths, console errors and debug.state(). Hook contract: docs/GAME_HOOKS.md.`;

const args = parseArgs(process.argv.slice(2));
if (process.argv.length <= 2 || args.help) { console.log(HELP); process.exit(0); }
const CFG = config();
const DRV = await loadDriver(CFG);
const GODOT = DRV.kind === 'godot';
const str = (v) => (v === undefined || v === true ? undefined : String(v));

async function main() {
  if (args.build) { const b = npmRun('build'); if (!b.ok) { console.log(`build failed:\n${b.tail}`); process.exit(1); } }
  const built = GODOT ? R(CFG.buildDir) : R(CFG.buildDir, 'index.html');
  if ((GODOT || !args.play) && !fs.existsSync(built)) { console.log(`${CFG.buildDir}${GODOT ? '' : '/index.html'} missing: run with --build`); process.exit(1); }
  const [w, h] = String(args.size || '1280x720').split('x').map(Number);
  const server = args.play || GODOT ? null : await DRV.startServer();
  const { browser, gl } = await DRV.launch({ headed: !!args.headed });
  let target;
  if (GODOT) target = { quality: str(args.quality), query: str(args.query), args: (str(args.args) || '').split(/\s+/).filter(Boolean) };
  else {
    const base = args.play ? `http://localhost:${CFG.dashboardPort}/play/` : server.url;
    target = base + (str(args.url) ? str(args.url).replace(/^\//, '') : `index.html?${CFG.pageQuery}`);
    if (str(args.quality)) target += `${target.includes('?') ? '&' : '?'}quality=${encodeURIComponent(str(args.quality))}`;
  }
  const { page, log } = await DRV.openPage(browser, target, { width: w, height: h, dpr: str(args.dpr) ? Number(args.dpr) : 1 });
  const { waitReady, debugCall, runStep } = DRV;
  const ctx = { page, shotsDir: PATHS.shots, shots: [], perf: null };
  const problems = [];
  const step = async (s) => { const r = await runStep(ctx, s); if (!r.ok) problems.push(r.error); else if (s.eval) console.log(`eval ${s.eval} => ${JSON.stringify(r.value) ?? 'undefined'}`); return r; };
  const xyz = (v) => v.split(',').map(Number);
  try {
    const ready = await waitReady(page);
    if (!ready.ok) problems.push(ready.reason);
    else {
      if (str(args.load)) await step({ call: 'load', args: [str(args.load), str(args.opts) ? JSON.parse(str(args.opts)) : {}], timeout: 90000 });
      if (str(args.teleport)) await step({ call: 'teleport', args: [str(args.teleport).includes(',') ? xyz(str(args.teleport)) : str(args.teleport)] });
      if (str(args.keys)) for (const tok of str(args.keys).split(/\s+/).filter(Boolean)) { const [key, ms] = tok.split(':'); await step(ms ? { hold: key, ms: Number(ms) } : { key }); }
      if (str(args.camera)) {
        const c = str(args.camera);
        await step({ call: 'setCamera', args: [c.includes(';') ? (() => { const [p, t] = c.split(';').map(xyz); return { pos: p, target: t }; })() : c] });
      }
      if (args.hud === 'off') await step({ call: 'hud', args: [false] });
      if (str(args.script)) {
        const r = await step({ script: str(args.script), timeout: Number(args.scriptTimeout || 180000) });
        console.log(`script ${args.script}: ${r.ok ? 'ok' : 'FAIL ' + r.error}${r.value?.log ? '\n' + r.value.log.join('\n') : ''}`);
      }
      if (str(args.eval)) for (const e of str(args.eval).split(';;')) await step({ eval: e });
      await page.waitForTimeout(Number(args.wait || 1200));
      if (str(args.input)) for (const tok of str(args.input).split(/\s+/).filter(Boolean)) {
        const [action, value, ms] = tok.split(':');
        const v = value === undefined ? 1 : value === 'true' ? true : value === 'false' ? false : value.includes(',') ? xyz(value) : Number(value);
        await step({ input: action, value: v, ms: ms ? Number(ms) : 0 });
      }
    }
    const name = str(args.out) || `shot_${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const frames = Number(args.frames || 1);
    for (let i = 0; i < frames; i++) { await step({ shot: frames > 1 ? `${name}_${i + 1}` : name }); if (i < frames - 1) await page.waitForTimeout(Number(args.every || 500)); }
    const st = await debugCall(page, 'state', [], 5000);
    await page.close(); // a Godot run's last output lines (errors at quit) reach the log on close
    console.log(`${GODOT ? 'driver: godot,' : 'webgl:'} ${gl.renderer}${gl.software ? ' (software)' : ''}`);
    console.log(`screenshots:\n${ctx.shots.map((s) => '  ' + s).join('\n')}`);
    console.log(`state: ${st.ok ? JSON.stringify(st.value) : st.error}`);
    console.log(`console errors: ${log.errors.length}${log.errors.length ? '\n' + log.errors.slice(0, 10).map((e) => '  ' + e.text).join('\n') : ''}`);
    if (log.failedRequests.length) console.log(`failed requests:\n${[...new Set(log.failedRequests)].slice(0, 10).map((r) => '  ' + r).join('\n')}`);
    if (problems.length) console.log(`problems:\n${problems.map((p) => '  ' + p).join('\n')}`);
  } finally { await page.close().catch(() => undefined); await browser.close(); await server?.close(); }
  process.exitCode = problems.length || log.errors.length ? 1 : 0;
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
