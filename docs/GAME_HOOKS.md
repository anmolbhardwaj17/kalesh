# Game hook contract (`window.__game`)

The game is Godot 4 (decisions.md 2026-11-10). The same hooks are served by an in-game debug server over TCP: see "Godot transport" below. `window.__game` and the page params describe the browser path, kept for the three.js scaffold until P0-027 and for a later web demo.

What the game must expose so the harness can drive it: verify scenarios, play scripts, shots, look proofs and perf budgets all go through this object. The ADOPT phase adds it to the existing game as its first task. Scenario `hooks_contract` (`harness/verify/scripts/hooks_contract.js`) checks it on every `verify --quick`.

## Rules

- The debug part exists only when the page URL has `debug=1`. Without it, `window.__game` may exist (ready and version only) but `window.__game.debug` must be undefined, and the game plays exactly as before.
- `verify=1` hides every debug overlay (FPS meters, input boxes, inspector panels) so they never appear in shots.
- Hooks drive the game the way a player could (inputs, camera, time) or read it. Play scripts never write positions or flags to skip work; `teleport` exists for staging scenes and look proofs, never inside a milestone play script.
- Every hook returns plain JSON-able data (the harness copies results with `JSON.parse(JSON.stringify(v))`).
- Expected situations never call `console.error`: any console error fails verification.
- Keep the hook code in one folder (`game/debug/` in Godot) and list it in `harness/verify/shared_paths.json`: a change there can break every scenario.

## Godot transport

The Godot game serves every hook from `game/debug/debug_server.gd`. `game/core/game_args.gd` (autoload `GameArgs`) adds it under `/root` as `DebugServer` only when the game starts with the user arg `--debug`. Without it no port opens, no debug node exists and the debug scripts are never loaded (checked by `game/tests/test_debug.gd` and `harness/bin/godotsmoke.mjs`). Client: `harness/bin/godotclient.mjs`.

### Args

Engine args go before `--`, game args after it. The harness always passes `--quit-after <frames>` as a safety net.

```
godot --path game --resolution 1280x720 --quit-after 12000 -- --debug --debug-port=47181 --verify
```

| Game arg | Replaces | Meaning |
|---|---|---|
| `--debug` | `debug=1` | Starts the debug server. |
| `--debug-port=N` | | Its port on 127.0.0.1. Default 47181 (`kit.config.json` `godot.debugPort`, the same as `DEFAULT_DEBUG_PORT` in `game_args.gd`). The harness picks a free port per run. |
| `--verify` | `verify=1` | Hides every debug overlay (the `DEBUG port fps sim` label). `state().debugOverlay` says if one shows. |
| `--quality=<preset>` | `quality=` | Start preset (low, medium, high). |
| `--style=<name>` | `style=` | Phase 0 style test: `stylised` (look B), `stylised_grime` (B+D) or `stylised_b` (B+D batch B: day-night, Delhi detail dressing, textures, haze, night lights). Restyles every scene through `game/render/style_runner.gd`. Absent: the default look, no style code loaded. `state().style` and `state().light` report it. |
| `--light=<preset>` | `light=` | Light preset for a style test: `dawn`, `afternoon` (default), `golden` or `night`. Ignored without `--style`. |
| `--time=<0..24>` | `time=` | Style test hour on the day-night curve (`game/render/day_cycle.gd`, keys are the light presets); overrides `--light`. `state().args.time` reports it. |
| `--style-off=<a,b>` | `style-off=` | `stylised_b` features to switch off for cost measuring: `volfog`, `shimmer`, `dressing`, `lights`, `textures`, `decals`, `ssao`, `ssil`, `glow`, `sunshadow`; `ssq` keeps the default SSAO and SSIL quality, `nopcss`, `noblend`, `split2`, `near80` and `dshadow` test sun shadow options, and `p34` measures the whole P0-034 setup (no lean path). |
| `--scene=<id>` | | Start in that scene (ids in `GameArgs.SCENES`: `scaffold`, and the P0-009 stand-ins `street`, `landmarks`, `areas`). |
| `--arch=<name>` | | Architecture bench. |
| `--lockstep` | `lockstep=1` | At most one engine physics frame per drawn frame (`Engine.max_physics_steps_per_frame = 1`), so a loaded machine runs slower and never catches up in bursts. |
| `--mute` | `mute=1` | Master bus muted. |

Resolution is the engine arg `--resolution WxH`. Both `--key=value` and `--key value` work. Args the game does not know are listed in `GameArgs.unknown`, never an error.

### Messages

TCP on 127.0.0.1, newline-delimited JSON (one UTF-8 JSON object per line).

| Direction | Message |
|---|---|
| client to game | `{"id": 7, "method": "state", "args": []}`. `id` is any number the client picks, one per call. `args` is the hook's argument list. |
| game to client | `{"type": "response", "id": 7, "ok": true, "result": ...}` or `{"type": "response", "id": 7, "ok": false, "error": "..."}`. |
| game to client, once on connect | `{"type": "hello", "protocol": 1, "version", "port", "methods": [...], "args": {...}, "ready", "frame", "headless", "renderer": {adapter, vendor, driver, method}}`. |
| game to client, after every drawn frame | `{"type": "snapshot", "frame", "w", "ready", "state", "clock", "hold", "events"}`. `events` holds only the events since the previous snapshot. |

Methods: `ping`, `state`, `clock`, `frames`, `input`, `perf`, `load`, `teleport`, `setCamera`, `timeScale`, `hold`, `events`, `hud`, `shot`, `quality`, `quit`. Shapes are the ones in "Required" below, with these Godot details:

- `state()`: `{scene, level, milestone: null, player: {pos, heading, speed, grounded}, camera: {pos, dir, fov, override}, hud, debugOverlay, quality, style, light, arch, lockstep, frame}`.
- `input(action, value)`: `throttle` and `steer` are composite (-1 to 1: negative presses `brake` or `steer_left`, positive `throttle` or `steer_right`). Any InputMap action name also works, with a strength 0 to 1 or a boolean. It goes through `Input.action_press`, the way a player's keys do.
- `frames(n)`: answers `{frame}` after n drawn frames (`RenderingServer.frame_post_draw`). Headless (`--headless`, nothing is drawn) a frame ends on `SceneTree.process_frame` instead, for frames, snapshots, load and quit; `perf` and `shot` answer an error there.
- `perf(ms)`: `cpuMs` is the game logic time of the frame (first physics or process callback to the last `_process`, measured by `game/debug/frame_probe.gd`) plus the viewport's measured render CPU time and frame setup time. `gpuMs` is the viewport's measured GPU time. `p95FrameMs` and `avgFps` come from the intervals between drawn frames. `drawCalls` and `triangles` are the max per frame of `RenderingServer` total draw calls and primitives in frame (`drawCallsAvg`, `trianglesAvg` too). `gpuMB` is video memory used (`textureMB`, `bufferMB` too). On macOS the default Metal driver gives no GPU time, so `gpuMs` is missing and `gpuNote` says why; with the engine arg `--rendering-driver vulkan` (MoltenVK) `gpuMs` is there.
- `load(id)`: changes to the scene and answers `{scene}` two drawn frames later. Releases debug inputs and the debug camera. Unknown ids are an error response.
- `teleport([x, y, z])`: puts the player on the ground at x, z and stops it. A name looks for a node in the group `anchor` (none yet, so it answers false).
- `setCamera({pos, target})` adds a `DebugCamera` to the scene and makes it current; `null` frees it and hands back to the game camera.
- `hud(on)`: shows or hides the nodes in the group `hud`; answers `{hud, nodes}`.
- `shot(path)`: `path` must be absolute. Waits for the next drawn frame, saves the viewport image as PNG, answers `{path, width, height, frame}`. The window must be visible (not headless).
- `quality(name?)`: reads or sets the preset; answers `{preset, presets}`.
- `quit()`: answers, then quits with code 0 after the next drawn frame.

### Snapshot vs request

`state`, `clock`, `hold` (read) and `events` are cheap and change every frame, so the game pushes them in each snapshot. A driver answers the synchronous hooks from the newest snapshot (the harness-side event ring is the events of every snapshot it got). The harness driver (`harness/bin/godotdriver.mjs`, VERIFY.md "Godot runs") runs page-side scripts in a node vm with a `window.__game` shim built this way (`harness/bin/godotshim.mjs`). `frames`, `perf`, `load`, `shot`, `input`, `teleport`, `setCamera`, `timeScale`, `hold({...})`, `hud`, `quality` and `quit` are requests: the answer comes in the response.

### Sim clock and hold

`game/core/sim_clock.gd` (autoload `SimClock`) owns sim time for every system that steps: they connect to `SimClock.sim_tick(dt)` and step only there. The tick is fixed at 1/60 s (`physics_ticks_per_second`). Each engine physics frame adds `delta * scale` to an accumulator and runs whole ticks, so `t` is always a whole number of ticks. `hold({at})` pauses on the last tick boundary at or before `at` (within one tick, never past it) and emits a `sim:hold` event. A held sim runs no ticks; frames keep drawing.

### Errors

Expected problems (unknown method, bad args, unknown scene or action) are error responses, never `push_error`. Unexpected engine or script errors are caught by `game/debug/debug_logger.gd` (a Godot `Logger`) and sent as `error` events `{kind, message, code, function, file, line}`, so they show in the snapshot `events`. Godot still prints them as `ERROR` lines, which `godot.mjs` and the smoke test fail on.

### Smoke test

`node harness/bin/godotsmoke.mjs` (add `--driver vulkan` for GPU times) runs the game without `--debug` and checks no port listens, then windowed with `--debug --verify`, calls every hook, checks each shape and the hold, saves `harness/reports/godot/smoke_shot.png` and writes `harness/reports/godot/smoke.json`.

## Page params (browser, the web demo path, later)

| Param | Meaning |
|---|---|
| `debug=1` | Turns on `window.__game.debug`. |
| `verify=1` | Hides debug overlays; the harness always sets it (kit.config.json `pageQuery`). |
| `quality=<preset>` | Starts on that quality preset (low, medium, high, or the game's names). Scenarios with `quality` use it; perf budgets are per preset. |
| `lockstep=1` | Optional. Every rendered frame runs a fixed slice of sim, so a loaded page runs slower instead of catching up in bursts. Use for scenarios whose script steers or reads AI timing. |
| `style=<name>` | Phase 0 style tests: renders the game in a candidate style. Default look when absent. |
| `light=<preset>` | With `style`: the light preset (`afternoon`, `golden`). |
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
