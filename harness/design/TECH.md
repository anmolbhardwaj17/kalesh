# Dilli Darshan: Technical Architecture

<!-- Template. The planner fills it in ADOPT mode from the code as found (facts with file paths), then keeps it current.
Builders read the sections docs/READ_MAP.md lists for their area. Contracts here are binding: a builder who changes one
updates this file and adds a decisions.md entry. -->

## Stack (as found)

Engine direction 2026-11-10 (decisions.md "Godot 4.7.2 pinned"): the game moves to Godot. The three.js scaffold in `src/` stays until the harness driver task (P0-026) ports its scenarios, then P0-027 retires it.

Godot (the game, from P0-024):
- Engine: Godot 4.7.2.stable, standard build (no .NET), pinned in `harness/kit.config.json` "godot". `node harness/bin/godot.mjs` finds it (env `GODOT`, then `tools/godot/`, then `/Applications/Godot.app`), checks the version and only on a machine without it downloads the official portable build into `tools/godot/` (gitignored, SHA512 checked). Nothing is installed globally.
- Project: `game/` (`project.godot`), Forward+ renderer, fixed 60 Hz physics tick, main scene `res://scenes/main.tscn`. The import cache `game/.godot/` is gitignored; the `*.gd.uid` files are committed.
- Language: GDScript (typed where it helps). C# is not used. GDExtension (C++) is an architecture option for heavy code only.
- Tests: a small headless runner in `game/tests/run_tests.gd` (no addon), suites `game/tests/test_*.gd`, run by `node harness/bin/godot.mjs test`, which `npm test` calls after vitest.
- Input: InputMap actions `throttle`, `brake`, `steer_left`, `steer_right` (keys W/S/A/D and arrows, gamepad triggers and left stick) in `project.godot`.
- Precision: GDScript floats are 64 bit, `Vector3` is 32 bit (about 0.4 mm at 25 km). Geo maths stays in floats.

Browser scaffold (until P0-027):
- Renderer: three.js 0.187 `WebGLRenderer` (antialias, pixel ratio capped at 2), no post processing, no shadows, default colour management.
- Language: TypeScript 5.9, strict, `noUncheckedIndexedAccess`, `noUnused*` (`tsconfig.json`, includes `src` only).
- Bundler: Vite 8 (`vite.config.ts`, base `./`, target es2022, out `dist/`). Bundle is about 535 kB (warning over 500 kB).
- Tests: Vitest 5 (`src/**/*.test.ts` and `harness/bin/**/*.test.mjs`). No lint.
- Dev tools: Playwright 1.65 and sharp for the harness only.
- `src/geo/projection.ts` stays as the reference projection for the offline bake tooling (`tools/`).

- Rule: no new runtime dependency without a decisions.md entry (licence, size, why).

## npm scripts

<!-- The scripts the harness needs and what each does. verify.mjs runs `typecheck`, `test` and `build` when they exist;
`build` must write index.html into the build folder (kit.config.json buildDir). -->

| Script | Does |
|---|---|
| `build` | `tsc --noEmit && vite build`, writes `dist/index.html` |
| `typecheck` | `tsc --noEmit` |
| `test` | `vitest run`, then `test:godot` |
| `test:godot` | `node harness/bin/godot.mjs test`: headless import of `game/`, then the GDScript tests |
| `godot:check` | `node harness/bin/godot.mjs check`: headless import, fails on any ERROR or SCRIPT ERROR line |
| `dev` | `vite` dev server |

## Source layout

- `index.html`: the canvas `#game` and a `#hud` div.
- `src/main.ts`: renderer, scene (ground, road strip, north post), box car, chase camera, the frame loop, hook install.
- `src/car.ts`: pure kinematic car model and the `forward(heading)` axis rule; tested in `src/car.test.ts`.
- `src/debug/hooks.ts`: `window.__game` (docs/GAME_HOOKS.md), sim clock with time scale and hold; tested in `src/debug/hooks.test.ts`.
- `public/`: empty (assets go to `public/assets/` with `manifest.json`).
- `game/`: the Godot project (`project.godot`, `scenes/`, `scripts/`, `geo/`, `tests/`). Module map in docs/ARCHITECTURE.md.
- `tools/`: offline bake tooling and fixture generators (Node, can import the TS reference code). `tools/godot/` holds a downloaded engine on machines without one (gitignored).

## Core contracts

<!-- The interfaces every part of the game relies on, one subsection each: the main loop and fixed timestep, scenes or
levels (load, unload, anchors), the player, input actions, save format and migration, assets by id (below), audio buses,
UI layers, the debug hooks (docs/GAME_HOOKS.md). -->

### Main loop and time

Godot: fixed sim tick of 1/60 s owned by the autoload `SimClock` (`game/core/sim_clock.gd`). Each engine physics frame adds `delta * scale` to an accumulator and runs whole ticks, emitting `sim_tick(dt)`. Every system that steps (the car now; later physics, AI and missions) connects to `sim_tick` and never steps in its own `_physics_process`, so the time scale and the sim hold reach all of them. A held sim runs no ticks while frames keep drawing. `--lockstep` sets `Engine.max_physics_steps_per_frame = 1`. Cameras follow on `_physics_process` with a higher `process_physics_priority`.

Browser scaffold (until P0-027): variable step `requestAnimationFrame`, dt capped at 0.1 s, scaled by `hooks.clock.advance(dt)` (time scale and sim hold).

### Coordinates (binding, owner 2026-11-10)

East is +X, north is -Z, up is +Y, 1 unit = 1 metre. Compass heading 0 = north, PI/2 = east (`forward()` in `src/car.ts`). No mirroring anywhere: no negative scale on world groups, no axis flips in physics. Tests: `src/car.test.ts` "coordinates".

Geographic projection: `src/geo/projection.ts` (`geoToWorld(lat, lon)` and `worldToGeo(x, z)`, origin `ORIGIN` = India Gate 28.612894 N, 77.229446 E). WGS84 transverse Mercator (Krüger series) with the central meridian through the origin, so scale error is about 0.2 m at 25 km and the round trip is under 1 cm. Provisional until the architecture sign-off. Tests: `src/geo/projection.test.ts` (origin at 0,0; Connaught Place park at about -1246, -2062; Red Fort at about +1130, -4800; due north has x 0 and negative z; meridian arc against numerical integration; round trips). Scenarios: `drive_north`, `drive_turn_right`, `coords_north_marker`.

Godot port: `game/geo/projection.gd` (`geo_to_world(lat, lon)` returns `{x, z}` floats, `world_to_geo(x, z)` returns `{lat, lon}`), checked against `harness/data/fixtures/projection_points.json` (20 points generated from the TS code by `tools/fixtures/gen_projection_points.mjs`; `src/geo/projection.fixture.test.ts` keeps the file in step with the TS code) within 0.01 m. The car rule is `forward(h)` in `game/scripts/car_model.gd`; a node faces -Z at rotation 0, so a car node uses `rotation.y = -heading`. Tests: `game/tests/test_projection.gd`, `test_car.gd`, `test_scene.gd` (no node under `World` has a negative scale or a mirrored global basis).
### Scenes and levels

### Input

### Save

### Assets

<!-- Assets are referenced by id. The game reads public/assets/manifest.json ({images, audio, models}: id -> {path}) and
uses a procedural placeholder for any id with no file yet (colour, pattern, simple mesh, a beep). New ids are registered
with harness/bin/assets.mjs; uploads go through the dashboard and harness/bin/ingest.mjs. -->

### Audio

### Debug hooks

Godot: `game/debug/` (debug server, logger, frame probe, perf stats), added under `/root` by `GameArgs` only with the user arg `--debug`. TCP JSON lines on 127.0.0.1, port `--debug-port` (default `kit.config.json` `godot.debugPort`, 47181). Contract and messages: docs/GAME_HOOKS.md "Godot transport". Client `harness/bin/godotclient.mjs`, smoke `harness/bin/godotsmoke.mjs`. `game/debug/` and `game/core/` are in `harness/verify/shared_paths.json`.

Browser scaffold: `src/debug/hooks.ts`, installed by `src/main.ts`; the `debug` part exists only with `?debug=1`.

## Render pipeline

<!-- Renderer settings (colour space, tone mapping, shadows, pixel ratio cap), post stack in order, quality presets and
what each turns on or off, the style switch (?style=) used in Phase 0 and what happened to it after sign-off. -->

## Performance budgets

<!-- The signed numbers (harness/verify/perf_budgets.json) per preset on the target machine, and the GPU ms each feature
may cost. How they are measured: debug.perf windows in perf scenarios, lookproof.mjs --perf, perfgate.mjs rules
(p95 frame time, the larger of CPU and GPU; a loaded machine downgrades a fail to "not judged"). -->

## Movement and camera (if the game has a moving player)

<!-- The tuning numbers and how they are measured (scenarios with sim timed scripts, frame sequences). -->

## Audio standard

## Known limits and debt (as found)

- Everything is a stand-in: flat ground, one road strip, box car, no world data, no physics, no audio.
- `src/main.ts` holds scene, car, camera and loop together; it will be split once the architecture is signed.
- Bundle over 500 kB in one chunk (three.js); code splitting comes with the architecture.
