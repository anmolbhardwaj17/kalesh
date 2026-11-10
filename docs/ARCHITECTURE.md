# Architecture (as built)

Layout follows `harness/design/TECH.md`. This file lists what actually exists. Update it when you add a module (builders do this as part of every task that adds one).

<!-- Template. The planner writes "How the pieces fit" and the source map in ADOPT mode by reading the adopted code.
Then one section per system, named so docs/READ_MAP.md can point at it, each with: what it does, the main files, the
contracts it keeps, how it is verified (scenario, test), and the task id that added or changed it. -->

## How the pieces fit

The game is a Godot 4.7.2 project in `game/`. `scenes/main.tscn` is a stand-in scene (ground, road strip, north post, box car, chase camera). The car node reads input and steps `car_model.gd` on `SimClock.sim_tick` (a fixed 1/60 s tick), the chase camera follows. With the user arg `--debug`, `GameArgs` adds the debug server (`game/debug/`) that serves `window.__game` style hooks over TCP to the harness. No scenes, no asset loading, no physics yet. The real module map is written after the Phase 0 architecture sign-off. The earlier three.js scaffold (`src/`, `index.html`, Vite) was retired in P0-027; `tools/geo/` holds the reference projection for the offline bake.

## Source map

| Path | What |
|---|---|
| `tools/geo/projection.ts` | Lat/lon to world metres and back (`geoToWorld`, `worldToGeo`), WGS84 transverse Mercator around India Gate; east +X, north -Z. Provisional until the architecture sign-off. Tests in `projection.test.ts`; `projection.fixture.test.ts` keeps `harness/data/fixtures/projection_points.json` in step. Used by the offline bake tooling; GDScript port in `game/geo/projection.gd`. |
| `game/project.godot` | The Godot 4.7.2 project (P0-024): Forward+, 60 Hz physics, InputMap actions throttle, brake, steer_left, steer_right. |
| `game/scenes/main.tscn` | Stand-in scene: `Main` with the world root `World` (environment, sun, ground, road strip, red north post at 0, 3, -50, the car) and `ChaseCamera`. |
| `game/scripts/car_model.gd` | Kinematic car model (ported from the retired three.js scaffold), `forward(heading)` (0 is -Z, PI/2 is +X). Pure, tested. |
| `game/scripts/car.gd`, `chase_camera.gd` | The car node (input to model on `SimClock.sim_tick`, `rotation.y = -heading`, group `player`, `place()` for staging) and the chase camera (10 m back, 4.5 m up, looks 6 m ahead). |
| `game/core/game_args.gd` | Autoload `GameArgs`: parses the user args after `--` (`--debug`, `--debug-port`, `--verify`, `--quality`, `--style`, `--scene`, `--arch`, `--lockstep`, `--mute`), the scene id table `SCENES`, adds the debug server only with `--debug`. |
| `game/core/sim_clock.gd` | Autoload `SimClock`: fixed 1/60 s sim tick from an accumulator, time scale, sim hold; every stepping system connects to `sim_tick(dt)`. |
| `game/core/game_events.gd` | Autoload `GameEvents`: ring buffer of the last 200 game events `{seq, t, w, type, data}`. |
| `game/debug/` | The debug server (P0-025): `debug_server.gd` (TCP JSON hooks, snapshot after every drawn frame, debug overlay), `debug_logger.gd` (unexpected errors to `error` events), `frame_probe.gd` (per frame logic time), `perf_stats.gd`. Only exists with `--debug`. |
| `game/geo/projection.gd` | Port of `tools/geo/projection.ts`; returns floats (Vector3 is 32 bit). |
| `game/tests/` | Headless test runner `run_tests.gd`, assert helper `check.gd`, suites `test_*.gd`. |

## Systems

### Driving (scaffold)
`game/scripts/car_model.gd`: throttle and steer in, position, heading and speed out; pure, unit tested (`game/tests/test_car.gd`). Verified by `hooks_contract` and the unit tests.

### Debug hooks
Godot: `game/debug/debug_server.gd` serves every hook plus shot, quality and quit over TCP JSON lines on 127.0.0.1 (docs/GAME_HOOKS.md "Godot transport"); `GameArgs` adds it only with `--debug`. Sim time comes from `SimClock`, events from `GameEvents`. Verified by `game/tests/test_debug.gd` and `harness/bin/godotsmoke.mjs`.
The hook contract is checked on every `verify --quick` by the `hooks_contract` scenario.

## Tooling (outside `game/`)

| Path | What |
|---|---|
| `harness/bin/godot.mjs` | Finds the pinned Godot (kit.config.json "godot"), checks its version, downloads a portable copy into `tools/godot/` only when none matches. `--version`, `path`, `check`, `test`, `parse` (loads every `.gd`, `game/tests/parse_all.gd`), `frame <png>` (Movie Maker), `run --`. Tests: `godot.test.mjs`. |
| `harness/bin/godotclient.mjs` | Client for the Godot debug server: `launchGame()` (spawns the pinned Godot with engine and game args, connects), `GodotDebugClient` (`call(method, ...args)`, latest `snapshot`, `events`, `waitSnapshot`), `freePort`, `portOpen`. Tests: `godotclient.test.mjs`. |
| `harness/bin/driver.mjs` | Picks the driver from kit.config.json `target` (`godot` or `web`; `HARNESS_TARGET` overrides). verify.mjs and shoot.mjs get launch, openPage, waitReady, debugCall and runStep from it. |
| `harness/bin/godotdriver.mjs` | The Godot driver (P0-026): one Godot run per scenario (windowed at the scenario size, or headless), the scenario steps, shots through the debug server's `shot(path)`, console errors from ERROR lines and `error` events, `probeNoDebug` for hooks_no_debug. |
| `harness/bin/godotshim.mjs` | The window shim page-side scripts run in (a node vm): `window.__game` whose sync hooks read the newest snapshot and whose other hooks are server requests. Tests: `godotshim.test.mjs`. |
| `harness/bin/godotsmoke.mjs` | Smoke test of the debug server: no port without `--debug`, every hook's shape, the sim hold, shot and quit; writes `harness/reports/godot/smoke.json` and `smoke_shot.png`. |
| `tools/fixtures/gen_projection_points.mjs` | Writes `harness/data/fixtures/projection_points.json` from the TS projection, for the GDScript cross-check. |
| `harness/bin/task.mjs` | The only writer of `harness/state/backlog.json`: status, next, start, done, fail, phases, gates, inbox, milestones, sign-off. |
| `harness/bin/signoffs.mjs` | The three Phase 0 sign-offs (style, architecture, game design) as one table: state keys, commands, phase flags, status lines, gate reasons; read by `task.mjs` and the dashboard. Tests: `signoffs.test.mjs`. |
| `harness/bin/verify.mjs` | Builds (Godot: the headless import), runs scenarios and milestone play scripts through the target's driver (Godot runs, or the served build in Chromium), judges budgets, writes `harness/reports/latest.json` and shots. `--quick`, `--only`, `--milestone`, `--all`, `--repeat`. |
| `harness/bin/browser.mjs` | The web driver (target `web`, kept for a later web demo): static server, Chromium launch (GPU first, then software GL), page open with console capture, `waitReady`, `debugCall`, the step runner. |
| `harness/bin/shoot.mjs` | Ad hoc screenshots and play-throughs. |
| `harness/bin/lookproof.mjs` | Look proof sets on the active driver (Godot: one game run per view, `--query` becomes game args), compare against the approved reference, side by side sheets, perf per view. `perf.json` quotes machine, Godot version, renderer (Forward+ or Mobile), GPU adapter and load. Tests: `lookproof.test.mjs`. |
| `harness/bin/perfbudget.mjs`, `perfgate.mjs`, `gpucost.mjs` | Budgets from `perf_budgets.json`, the frame time gate, the stable GPU cost. |
| `harness/bin/quickset.mjs`, `harness/verify/quick.json` | The `--quick` scenario set. |
| `harness/bin/freshreport.mjs`, `lib.mjs treeHash` | Reuse of a quick run on the identical tree. |
| `harness/bin/gatecheck.mjs`, `gateretry.mjs`, `harness/verify/shared_paths.json` | Phase gate paths: the full run, or a retry when no shared file changed. |
| `harness/bin/milestoneset.mjs` | Which milestones count for which gate. |
| `harness/bin/flakecheck.mjs`, `cliguard.mjs` | Repeat runs with pass counts; name checks before any run. |
| `harness/bin/snapshot.mjs`, `lane.mjs`, `sweep.mjs` | Worktrees: verify snapshot, lane 2, regression sweep. |
| `harness/bin/playcopy.mjs` | `npm run play`: the newest verified commit's `game/` unpacked (`git archive`) and imported under `harness/reports/play/<sha>/`, opened in the pinned Godot. `--verified` or a commit builds a copy, `--status` lists copies. Tests: `playcopy.test.mjs`. |
| `harness/bin/dashboard.mjs`, `notice.mjs`, `assets.mjs`, `ingest.mjs` | The owner's dashboard, its notices, asset requests and uploads. |
| `harness/bin/budgetwait.mjs`, `waitpredicate.mjs`, `shotretry.mjs`, `pageretry.mjs`, `screencast.mjs`, `frameseq.mjs`, `seqsheet.mjs`, `shotdiff.mjs`, `tmpclean.mjs`, `docpaths.mjs` | Load-safe waits and retries, screen recording and frame sequences, contact sheets, pixel diffs, temp cleanup, doc path checks. |
