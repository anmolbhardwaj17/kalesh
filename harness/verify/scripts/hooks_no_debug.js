// Proves the debug part of the hook contract is off without ?debug=1 (docs/GAME_HOOKS.md "Rules"): the same page opened with
// no params has window.__game (ready and version) but window.__game.debug is undefined. Runs in the page as an async body;
// on the web target it opens a same-origin iframe on the game's own URL minus the query.
const S = window.__sim;
// Godot target (P0-026): there is no page URL. The driver launches the game headless WITHOUT --debug and probes the port
// it would have used and the default port (godotdriver.mjs probeNoDebug); nothing may answer, and no debug server line.
if (typeof window.__probeNoDebug === 'function') {
  const r = await window.__probeNoDebug();
  S.log('no-debug game', r);
  const problems = [];
  if (!r.booted) problems.push('the game without --debug never printed its boot line');
  else if (!/debug=false/.test(r.bootLine)) problems.push(`boot line is not debug=false: ${r.bootLine}`);
  if (r.open) problems.push(`a port answered without --debug (asked ${r.port}, default ${r.defaultPort})`);
  if (r.debugServerLine) problems.push('the debug server started without --debug');
  if (r.errors.length) problems.push(`ERROR lines: ${r.errors.slice(0, 2).join(' | ')}`);
  return problems.length ? S.failed(problems.join('; ')) : S.ok({ bootLine: r.bootLine, probes: r.probes, port: r.port, defaultPort: r.defaultPort });
}
const url = location.origin + location.pathname;
const frame = document.createElement('iframe');
frame.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:200px;opacity:0;pointer-events:none';
frame.src = url;
document.body.appendChild(frame);
try {
  const t0 = performance.now();
  let g = null;
  while (performance.now() - t0 < 20000) {
    g = frame.contentWindow && frame.contentWindow.__game;
    if (g && g.ready === true) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!g || g.ready !== true) return S.failed('the page without ?debug=1 never became ready (window.__game.ready)');
  const problems = [];
  if (typeof g.version !== 'string') problems.push('window.__game.version is not a string');
  if (g.debug !== undefined) problems.push('window.__game.debug exists without ?debug=1');
  if ('debug' in g) problems.push('window.__game has a debug key without ?debug=1');
  S.log('no-debug page', { ready: g.ready, version: g.version, keys: Object.keys(g) });
  return problems.length ? S.failed(problems.join('; ')) : S.ok({ keys: Object.keys(g) });
} finally {
  frame.remove();
}
