// Proves the debug part of the hook contract is off without ?debug=1 (docs/GAME_HOOKS.md "Rules"): the same page opened with
// no params has window.__game (ready and version) but window.__game.debug is undefined. Runs in the page as an async body;
// it opens a same-origin iframe on the game's own URL minus the query.
const S = window.__sim;
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
