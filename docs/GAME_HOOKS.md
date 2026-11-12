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
| `--style=<name>` | `style=` | The look. Absent: the signed stylised B (`stylised_b`, P1-002; architecture benches with `--arch` keep their own look and default to `none`). `none`: the flat stand-in look, no style code loaded (fast verification; scenarios that do not judge the look use it, see `harness/verify/scenarios.json` `_doc`). Reference sets until the P1 gate: `stylised` (look B), `stylised_grime` (B+D), `realistic`. Restyles every scene through `game/render/style_runner.gd`. `state().style` reports the look id. |
| `--light=<preset>` | `light=` | Pins the day clock to a light preset: `dawn` (6.3 h), `afternoon` (15.0), `golden` (17.75) or `night` (22.0); the look uses the preset itself. |
| `--time=<0..24>` | `time=` | Pins the day clock to that hour on the day-night curve (`game/render/day_cycle.gd`, keys are the light presets); overrides `--light`. Without `--time` or `--light` the day clock starts at 15:00 and runs. `state().time` reports the clock. |
| `--style-off=<a,b>` | `style-off=` | `stylised_b` features to switch off for cost measuring: `volfog`, `shimmer`, `dressing`, `lights`, `textures`, `decals`, `ssao`, `ssil`, `glow`, `sunshadow`; `ssq` keeps the default SSAO and SSIL quality, `nopcss`, `noblend`, `split2`, `near80` and `dshadow` test sun shadow options, and `p34` measures the whole P0-034 setup (no lean path). |
| `--scene=<id>` | | Start in that scene (ids in `GameArgs.SCENES`: `scaffold`, and the P0-009 stand-ins `street`, `landmarks`, `areas`). |
| `--arch=<name>[:setup]` | | Architecture bench: loads the bench scene of that name (`GameArgs.ARCH_SCENES`: `render` is `game/bench/render/`, `physics` is `game/bench/physics/`, `tiles` is `game/bench/tiles/`, `roads` is `game/bench/roads/`); the setup after the colon is read by the bench scene (`--arch=render:city+i3+lod`). `state().arch` reports the whole value. Run by `node harness/bench/arch.mjs <name>`. |
| `--tiles=<name>` | `tiles=` | Loads a whole baked tile folder into the scaffold scene (`game/world/block_loader.gd`, P1-018): `test` is the committed test block `game/world/test_tiles/` (9 tiles of the ITO flyover and Connaught Place, 9.8 MB, boots in about 1.5 s), `full` the gitignored pilot set `game/world/tiles/` (417 tiles, needs `npm run bake -- pilot`; a snapshot or play copy gets it only when it carries `game/world/tiles.hash`), or a `res://` folder. Hides the stand-in ground and stands the car on the longest lane at grade at its height. An unknown name or a missing folder is a log line and the stand-in ground stays. `state().world` reports it. Not read with `--arch`. |
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

Methods: `ping`, `state`, `clock`, `frames`, `input`, `perf`, `load`, `teleport`, `setCamera`, `timeScale`, `hold`, `events`, `hud`, `shot`, `quality`, `timeOfDay`, `bench`, `quit`. Shapes are the ones in "Required" below, with these Godot details:

- `state()`: `{scene, level, milestone: null, player: {pos, heading, speed, grounded}, camera: {pos, dir, fov, override}, hud, debugOverlay, quality, style, light, arch, lockstep, time, frame, world}`. `light` is the `--light` arg as given. `world` is null unless `--tiles` loaded a block: `{folder, bakeHash, tiles, triangles, colliderTriangles, loadMs, lanes, errors}`. `time` is the day clock: `{hour (0..24), clock ("15:00"), rate (game hours per sim second), pinned, lookHour (the hour the current scene's light was built for, null with --style=none), light (the look's light id: a preset name, `time 17.75` when pinned or `clock 15.00` when running)}`.
- `input(action, value)`: `throttle` and `steer` are composite (-1 to 1: negative presses `brake` or `steer_left`, positive `throttle` or `steer_right`). Any InputMap action name also works, with a strength 0 to 1 or a boolean. It goes through `Input.action_press`, the way a player's keys do.
- `frames(n)`: answers `{frame}` after n drawn frames (`RenderingServer.frame_post_draw`). Headless (`--headless`, nothing is drawn) a frame ends on `SceneTree.process_frame` instead, for frames, snapshots, load and quit; `perf` and `shot` answer an error there.
- `perf(ms)`: `cpuMs` is the game logic time of the frame (first physics or process callback to the last `_process`, measured by `game/debug/frame_probe.gd`) plus the viewport's measured render CPU time and frame setup time. `gpuMs` is the viewport's measured GPU time. `p95FrameMs` and `avgFps` come from the intervals between drawn frames. `drawCalls` and `triangles` are the max per frame of `RenderingServer` total draw calls and primitives in frame (`drawCallsAvg`, `trianglesAvg` too). `gpuMB` is video memory used (`textureMB`, `bufferMB` too). On macOS the default Metal driver gives no GPU time, so `gpuMs` is missing and `gpuNote` says why; with the engine arg `--rendering-driver vulkan` (MoltenVK) `gpuMs` is there.
- `perf(ms)` also answers `frameMs: {p50, p95, max}`, the intervals between drawn frames. Read GPU times with care on this Mac: a window is capped at 120 fps even with vsync off (seen since about midnight of 2026-11-11 IST), and under the cap a light scene reads about 6.5 ms of `gpuMs` whatever it costs (most likely the GPU clocks down). `lookproof --perf`, the verify perf gate and the benches keep the GPU busy with a ballast for a true reading (`harness/bin/ballast.mjs`, `bench('ballast')`); `gpuMs` of a plain window stays the capped reading.
- `bench(cmd, opts)`: two commands work in any scene, the rest are for architecture benches (`--arch=<name>`). `ballast` (`{n}`: a constant GPU load of n shader iterations per pixel in an offscreen viewport, `game/debug/gpu_ballast.gd`, 0 is off) and `blank` (`{on}`: the root viewport draws no 3D, so a window measures the ballast alone) give honest GPU readings under the 120 fps cap: `harness/bin/ballast.mjs` calibrates the ballast, reads `gpuMs` with the GPU kept busy and subtracts the ballast alone from the frame times (`gpuCost` in the perf block, used by `lookproof --perf` and the verify perf gate). Every other command goes to the bench scene's `bench_call(cmd, opts)` and is an error response in any other scene. The render bench (`game/bench/render/render_bench.gd`) knows `info` (ready, build time, world counts, viewport settings) and `path` and `pose` (`{name, seconds}` or `{name, t}`: start a camera path or hold a fixed view). The physics bench (`game/bench/physics/physics_bench.gd`) knows `info`, `run` (`{test, ...opts}`: starts one of its tests, which runs over many frames, and answers `{started}`), `poll` (`{test}`: `{running, done, result}`) and `pose` (`{name}` or `{pos, target}` in course coordinates). The tile format bench (`game/bench/tiles/tiles_bench.gd`) knows `info`, `run` (`{test: "load", format: t1|t2|t3, files, loads}`, `{test: "memory", format, files, copies}` or `{test: "free"}`), `poll` and `pose` (`{name}`: `overview` or `street`). The road bench (`game/bench/roads/roads_bench.gd`) knows `info`, `poses` (the pose names of the baked site), `pose` (`{name}`: a top pose looks straight down with north up, an eye pose is a perspective view) and `probe` (a ray down at the bake's probe points: `{points, hits, missing, missingList, maxErrorM}`). Never used by scenarios or play scripts; the harness uses ballast and blank only after a perf window, with the sim held or the scene static.
- `load(id)`: changes to the scene and answers `{scene}` two drawn frames later. Releases debug inputs and the debug camera. Unknown ids are an error response.
- `teleport([x, y, z])`: puts the player on the ground at x, z and stops it. A name looks for a node in the group `anchor` (none yet, so it answers false).
- `setCamera({pos, target})` adds a `DebugCamera` to the scene and makes it current; `null` frees it and hands back to the game camera.
- `hud(on)`: shows or hides the nodes in the group `hud`; answers `{hud, nodes}`.
- `shot(path)`: `path` must be absolute. Waits for the next drawn frame, saves the viewport image as PNG, answers `{path, width, height, frame}`. The window must be visible (not headless).
- `quality(name?)`: reads or sets the preset; answers `{preset, presets}`.
- `timeOfDay(opts?)`: reads or sets the day clock (`game/core/day_clock.gd`, autoload `DayClock`). `opts` is `{hour, rate, pin, reload}`, every field optional: `hour` sets the hour (wrapped into 0..24), `rate` the game hours per sim second (default 1/120: one game hour in two minutes of sim), `pin: true` stops the clock and `false` lets it run, `reload: true` reloads the current scene so its look is built at the new hour. Answers `state().time`. A change emits a `time:set` event. The look follows the clock when a scene loads (a move of a game minute or more builds the light again); inside a loaded scene the light stays as it was built (live relighting is a later task). The day clock steps on `SimClock.sim_tick`, so the time scale and the sim hold reach it. Bad args (a hour that is not a number, a negative rate) are an error response.
- `quit()`: answers, then quits with code 0 after the next drawn frame.

### Snapshot vs request

`state`, `clock`, `hold` (read) and `events` are cheap and change every frame, so the game pushes them in each snapshot. A driver answers the synchronous hooks from the newest snapshot (the harness-side event ring is the events of every snapshot it got). The harness driver (`harness/bin/godotdriver.mjs`, VERIFY.md "Godot runs") runs page-side scripts in a node vm with a `window.__game` shim built this way (`harness/bin/godotshim.mjs`). `frames`, `perf`, `load`, `shot`, `input`, `teleport`, `setCamera`, `timeScale`, `hold({...})`, `hud`, `quality`, `timeOfDay` and `quit` are requests: the answer comes in the response.

### Sim clock and hold

`game/core/sim_clock.gd` (autoload `SimClock`, C1 since P1-006) owns sim time for every system that steps: they connect to `SimClock.sim_tick(dt)` and step only there. One engine physics frame is one tick of exactly 1/60 s, so `t` is always a whole number of ticks. `timeScale(n)` sets `Engine.time_scale` and `Engine.physics_ticks_per_second` together (n 4 runs 240 physics frames per real second, n 0.25 runs 15; each still steps 1/60 s of sim and of physics); n 0 runs no ticks and stops the physics server, at the engine rates of n 1. `hold({at})` pauses on the last tick boundary at or before `at` (within one tick, never past it) and emits a `sim:hold` event. A held sim runs no ticks and the physics server is stopped (`PhysicsServer3D.set_active(false)`, only at the start of a physics frame, so a running tick keeps its step); frames keep drawing, and a release resumes exactly (an input script held and resumed ends within 0.0000 m of one never held, `game/tests/test_sim_clock.gd`). `clock().scale` is the scale as asked.

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
| `timeOfDay(opts?)` | Read or set the day clock `{hour, rate, pin, reload}` (Godot details above); `hooks_contract` checks it. |
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
