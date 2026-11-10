# Architecture (as built)

Layout follows `harness/design/TECH.md`. This file lists what actually exists. Update it when you add a module (builders do this as part of every task that adds one).

<!-- Template. The planner writes "How the pieces fit" and the source map in ADOPT mode by reading the adopted code.
Then one section per system, named so docs/READ_MAP.md can point at it, each with: what it does, the main files, the
contracts it keeps, how it is verified (scenario, test), and the task id that added or changed it. -->

## How the pieces fit

Scaffold, as found 2026-11-10. `index.html` loads `src/main.ts`, which creates the three.js WebGL renderer, the scene, the box car and the chase camera, installs `window.__game` (`src/debug/hooks.ts`, debug part only with `?debug=1`) and runs a variable step `requestAnimationFrame` loop: sim dt from the hook clock, `stepCar` (`src/car.ts`), camera follow, render, `hooks.frameDone`. No scenes, no asset loading, no physics yet. The real module map is written after the Phase 0 architecture sign-off.

## Source map

| Path | What |
|---|---|
| `index.html` | Canvas `#game`, `#hud` hint text. |
| `src/main.ts` | Renderer, scene, car mesh, chase camera, frame loop, hook wiring. |
| `src/car.ts` | Kinematic car model, `forward(heading)` axis rule (east +X, north -Z). |
| `src/geo/projection.ts` | Lat/lon to world metres and back (`geoToWorld`, `worldToGeo`), WGS84 transverse Mercator around India Gate; east +X, north -Z. Provisional until the architecture sign-off. Tests in `projection.test.ts`. |
| `src/debug/hooks.ts` | `window.__game` hook contract and the sim clock. |
| `game/project.godot` | The Godot 4.7.2 project (P0-024): Forward+, 60 Hz physics, InputMap actions throttle, brake, steer_left, steer_right. |
| `game/scenes/main.tscn` | Stand-in scene: `Main` with the world root `World` (environment, sun, ground, road strip, red north post at 0, 3, -50, the car) and `ChaseCamera`. |
| `game/scripts/car_model.gd` | Port of `src/car.ts`: kinematic car, `forward(heading)` (0 is -Z, PI/2 is +X). Pure, tested. |
| `game/scripts/car.gd`, `chase_camera.gd` | The car node (input to model on `SimClock.sim_tick`, `rotation.y = -heading`, group `player`, `place()` for staging) and the chase camera (10 m back, 4.5 m up, looks 6 m ahead). |
| `game/core/game_args.gd` | Autoload `GameArgs`: parses the user args after `--` (`--debug`, `--debug-port`, `--verify`, `--quality`, `--style`, `--scene`, `--arch`, `--lockstep`, `--mute`), the scene id table `SCENES`, adds the debug server only with `--debug`. |
| `game/core/sim_clock.gd` | Autoload `SimClock`: fixed 1/60 s sim tick from an accumulator, time scale, sim hold; every stepping system connects to `sim_tick(dt)`. |
| `game/core/game_events.gd` | Autoload `GameEvents`: ring buffer of the last 200 game events `{seq, t, w, type, data}`. |
| `game/debug/` | The debug server (P0-025): `debug_server.gd` (TCP JSON hooks, snapshot after every drawn frame, debug overlay), `debug_logger.gd` (unexpected errors to `error` events), `frame_probe.gd` (per frame logic time), `perf_stats.gd`. Only exists with `--debug`. |
| `game/geo/projection.gd` | Port of `src/geo/projection.ts`; returns floats (Vector3 is 32 bit). |
| `game/tests/` | Headless test runner `run_tests.gd`, assert helper `check.gd`, suites `test_*.gd`. |

## Systems

### Driving (scaffold)
`src/car.ts`: throttle and steer in, position, heading and speed out; pure, unit tested (`src/car.test.ts`). Verified by `hooks_contract` and the unit tests.

### Debug hooks
Godot: `game/debug/debug_server.gd` serves every hook plus shot, quality and quit over TCP JSON lines on 127.0.0.1 (docs/GAME_HOOKS.md "Godot transport"); `GameArgs` adds it only with `--debug`. Sim time comes from `SimClock`, events from `GameEvents`. Verified by `game/tests/test_debug.gd` and `harness/bin/godotsmoke.mjs`.
Browser (until P0-027): `src/debug/hooks.ts`: state, clock, frames, input, perf, load, teleport, camera, time scale, sim hold, events, hud. Verified by the `hooks_contract` scenario and `src/debug/hooks.test.ts`.

## Tooling (outside `src/`)

| Path | What |
|---|---|
| `harness/bin/godot.mjs` | Finds the pinned Godot (kit.config.json "godot"), checks its version, downloads a portable copy into `tools/godot/` only when none matches. `--version`, `path`, `check`, `test`, `frame <png>` (Movie Maker), `run --`. Tests: `godot.test.mjs`. |
| `harness/bin/godotclient.mjs` | Client for the Godot debug server: `launchGame()` (spawns the pinned Godot with engine and game args, connects), `GodotDebugClient` (`call(method, ...args)`, latest `snapshot`, `events`, `waitSnapshot`), `freePort`, `portOpen`. Tests: `godotclient.test.mjs`. |
| `harness/bin/godotsmoke.mjs` | Smoke test of the debug server: no port without `--debug`, every hook's shape, the sim hold, shot and quit; writes `harness/reports/godot/smoke.json` and `smoke_shot.png`. |
| `tools/fixtures/gen_projection_points.mjs` | Writes `harness/data/fixtures/projection_points.json` from the TS projection, for the GDScript cross-check. |
| `harness/bin/task.mjs` | The only writer of `harness/state/backlog.json`: status, next, start, done, fail, phases, gates, inbox, milestones, sign-off. |
| `harness/bin/signoffs.mjs` | The three Phase 0 sign-offs (style, architecture, game design) as one table: state keys, commands, phase flags, status lines, gate reasons; read by `task.mjs` and the dashboard. Tests: `signoffs.test.mjs`. |
| `harness/bin/verify.mjs` | Builds, serves the build, runs scenarios and milestone play scripts in Chromium, judges budgets, writes `harness/reports/latest.json` and shots. `--quick`, `--only`, `--milestone`, `--all`, `--repeat`. |
| `harness/bin/browser.mjs` | Static server, Chromium launch (GPU first, then software GL), page open with console capture, `waitReady`, `debugCall`, the step runner. |
| `harness/bin/shoot.mjs` | Ad hoc screenshots and play-throughs. |
| `harness/bin/lookproof.mjs` | Look proof sets, compare against the approved reference, side by side sheets, perf per view. |
| `harness/bin/perfbudget.mjs`, `perfgate.mjs`, `gpucost.mjs` | Budgets from `perf_budgets.json`, the frame time gate, the stable GPU cost. |
| `harness/bin/quickset.mjs`, `harness/verify/quick.json` | The `--quick` scenario set. |
| `harness/bin/freshreport.mjs`, `lib.mjs treeHash` | Reuse of a quick run on the identical tree. |
| `harness/bin/gatecheck.mjs`, `gateretry.mjs`, `harness/verify/shared_paths.json` | Phase gate paths: the full run, or a retry when no shared file changed. |
| `harness/bin/milestoneset.mjs` | Which milestones count for which gate. |
| `harness/bin/flakecheck.mjs`, `cliguard.mjs` | Repeat runs with pass counts; name checks before any run. |
| `harness/bin/snapshot.mjs`, `lane.mjs`, `sweep.mjs`, `playcopy.mjs` | Worktrees: verify snapshot, lane 2, regression sweep, the dashboard's stable play copy. |
| `harness/bin/dashboard.mjs`, `notice.mjs`, `assets.mjs`, `ingest.mjs` | The owner's dashboard, its notices, asset requests and uploads. |
| `harness/bin/budgetwait.mjs`, `waitpredicate.mjs`, `shotretry.mjs`, `pageretry.mjs`, `screencast.mjs`, `frameseq.mjs`, `seqsheet.mjs`, `shotdiff.mjs`, `tmpclean.mjs`, `docpaths.mjs` | Load-safe waits and retries, screen recording and frame sequences, contact sheets, pixel diffs, temp cleanup, doc path checks. |
