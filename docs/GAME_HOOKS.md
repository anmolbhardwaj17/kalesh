# Game hook contract (`window.__game`)

What the game must expose so the harness can drive it: verify scenarios, play scripts, shots, look proofs and perf budgets all go through this object. The ADOPT phase adds it to the existing game as its first task. Scenario `hooks_contract` (`harness/verify/scripts/hooks_contract.js`) checks it on every `verify --quick`.

## Rules

- The debug part exists only when the page URL has `debug=1`. Without it, `window.__game` may exist (ready and version only) but `window.__game.debug` must be undefined, and the game plays exactly as before.
- `verify=1` hides every debug overlay (FPS meters, input boxes, inspector panels) so they never appear in shots.
- Hooks drive the game the way a player could (inputs, camera, time) or read it. Play scripts never write positions or flags to skip work; `teleport` exists for staging scenes and look proofs, never inside a milestone play script.
- Every hook returns plain JSON-able data (the harness copies results with `JSON.parse(JSON.stringify(v))`).
- Expected situations never call `console.error`: any console error fails verification.
- Keep the hook code in one folder (for example `src/debug/`) and list it in `harness/verify/shared_paths.json`: a change there can break every scenario.

## Page params

| Param | Meaning |
|---|---|
| `debug=1` | Turns on `window.__game.debug`. |
| `verify=1` | Hides debug overlays; the harness always sets it (kit.config.json `pageQuery`). |
| `quality=<preset>` | Starts on that quality preset (low, medium, high, or the game's names). Scenarios with `quality` use it; perf budgets are per preset. |
| `lockstep=1` | Optional. Every rendered frame runs a fixed slice of sim, so a loaded page runs slower instead of catching up in bursts. Use for scenarios whose script steers or reads AI timing. |
| `style=<name>` | Phase 0 style tests: renders the game in a candidate style. Default look when absent. |
| `mute=1` | Optional. Master volume 0 (a negative control for audio checks). |

## Required

```ts
window.__game = {
  ready: boolean,            // true once the first playable frame is drawn and input works
  version: string,           // build id or package version
  debug: {
    state(): { scene: string, level?: string | null, milestone?: { id: string, done: boolean, failed?: boolean } | null,
               player?: { pos: [number, number, number], grounded?: boolean } | null, [k: string]: unknown },
    clock(): { t: number, scale: number, paused: boolean },   // sim time in seconds, time scale, paused flag
    frames(n: number): Promise<void>,                         // resolves after n rendered frames
    input(action: string, value: number | boolean | [number, number]): void,  // the game's action layer, not raw keys
    perf(ms: number): Promise<{
      cpuMs: { p50: number, p95: number, max: number },       // work inside the frame (update + render submit)
      gpuMs?: { p50: number, p95: number, max: number },      // EXT_disjoint_timer_query_webgl2 when available
      gpuNote?: string,                                        // why gpuMs is missing
      p95FrameMs: number,                                      // rAF interval p95
      avgFps: number,
      drawCalls: number, triangles: number,                    // renderer.info per frame (average or max over the window)
      textureMB?: number, renderbufferMB?: number, gpuMB?: number,
    }>,
    load(id: string, opts?: object): Promise<void>,            // load a level, scene or milestone start (opts: checkpoint, time, weather...)
    teleport(where: [number, number, number] | string): boolean,  // staging only (anchors by name where the game has them)
    setCamera(pose: { pos: [number, number, number], target: [number, number, number] } | string | null): void,  // null hands back to the game camera
    timeScale(n: number): void,
    hold(opts?: { at?: number, release?: boolean, cancel?: boolean }): { paused: boolean, t: number, at: number | null },
                                                               // sim hold: {at} pauses the sim exactly at sim time `at`,
                                                               // {release} resumes, {cancel} clears a pending hold, no args reads it
    events(): Array<{ t: number, w: number, type: string, data?: unknown }>,  // recent game events, a ring buffer; t sim s, w wall ms
    hud(on: boolean): void,
  }
}
```

Event types the harness reads when present: `checkpoint`, `objective_complete`, `milestone:done`, `milestone:failed`, `ai:state`, `dialogue:line`. Name the rest after the game.

## Optional (used when present)

| Hook | Used by |
|---|---|
| `shotProblems(name): string[]` | Every shot: what is wrong on screen now (the player under the HUD, a subtitle over the player, a debug overlay on). Each string fails the step. |
| `gpuBench({ n, reps }): number[]` | `gpucost.mjs`: draws the current frame n times between GPU syncs, reps times, and returns ms per rep; the stable GPU cost replaces the noisy timer p95 in the frame time gate. |
| `quality(name?)` | Read or switch the quality preset at run time. |
| `save(op, data?)` | Read, write or clear the save for persistence checks. |
| `ui(what)` | UI state for menu and transition checks (for example `ui('transition')` gives the current phase: loading, card, play). |

## How each harness number is measured

| Number | Source |
|---|---|
| Load time | page open to `ready === true` (verify.mjs), judged by `perf_budgets.json loadMs`. |
| Frame time p95 | `perf(ms).cpuMs.p95` and `gpuMs.p95` (or the gpuBench cost), the larger counts (`perfgate.mjs`). |
| fps | `perf(ms).avgFps`, secondary: the display caps it. |
| Draw calls, triangles | `perf(ms).drawCalls`, `.triangles`. |
| GPU memory | `perf(ms).gpuMB`, or `textureMB + renderbufferMB`. |

## Minimal three.js sketch

```ts
if (new URLSearchParams(location.search).get('debug') === '1') {
  const times: number[] = [];
  let simT = 0, scale = 1, holdAt: number | null = null, paused = false;
  const frameWaiters: Array<() => void> = [];
  // in the loop: if (!paused) { simT += dt * scale; if (holdAt !== null && simT >= holdAt) { simT = holdAt; paused = true; } }
  //              after render: times.push(cpuMs); frameWaiters.splice(0).forEach((f) => f());
  (window as any).__game.debug = {
    state: () => ({ scene: currentScene, level: levelId, player: { pos: player.position.toArray() } }),
    clock: () => ({ t: simT, scale, paused }),
    frames: (n: number) => new Promise<void>((r) => { let k = n; const tick = () => (--k <= 0 ? r() : frameWaiters.push(tick)); frameWaiters.push(tick); }),
    input: (a: string, v: unknown) => actions.set(a, v),
    perf: async (ms: number) => { /* collect cpu ms per frame and renderer.info.render.calls/triangles for ms, return stats */ },
    load: (id: string) => loadLevel(id), teleport: (p: number[]) => { player.position.fromArray(p); return true; },
    setCamera: (pose: any) => { /* override the camera until null */ }, timeScale: (n: number) => { scale = n; },
    hold: (o: any = {}) => { if (o.cancel) holdAt = null; if (o.release) paused = false; if (o.at !== undefined) holdAt = o.at; return { paused, t: simT, at: holdAt }; },
    events: () => eventRing.slice(), hud: (on: boolean) => { hudRoot.hidden = !on; },
  };
}
```

The kit's self-test sample (`KIT_README.md`, "Self-test") is a complete small example.
