# Dilli Darshan: Technical Architecture

<!-- Template. The planner fills it in ADOPT mode from the code as found (facts with file paths), then keeps it current.
Builders read the sections docs/READ_MAP.md lists for their area. Contracts here are binding: a builder who changes one
updates this file and adds a decisions.md entry. -->

## Stack (as found)

Engine direction 2026-11-10 (decisions.md "Godot 4.7.2 pinned"): the game is Godot. The three.js scaffold (`src/`, `index.html`, Vite) was retired in P0-027 (decisions.md "Browser scaffold retired"); `harness/bin/browser.mjs` stays for a later web demo.

Godot (the game, from P0-024):
- Engine: Godot 4.7.2.stable, standard build (no .NET), pinned in `harness/kit.config.json` "godot". `node harness/bin/godot.mjs` finds it (env `GODOT`, then `tools/godot/`, then `/Applications/Godot.app`), checks the version and only on a machine without it downloads the official portable build into `tools/godot/` (gitignored, SHA512 checked). Nothing is installed globally.
- Project: `game/` (`project.godot`), Forward+ renderer, fixed 60 Hz physics tick, main scene `res://scenes/main.tscn`. The import cache `game/.godot/` is gitignored; the `*.gd.uid` files are committed.
- Language: GDScript (typed where it helps). C# is not used. GDExtension (C++) is an architecture option for heavy code only.
- Tests: a small headless runner in `game/tests/run_tests.gd` (no addon), suites `game/tests/test_*.gd`, run by `node harness/bin/godot.mjs test`, which `npm test` calls after vitest.
- Input: InputMap actions `throttle`, `brake`, `steer_left`, `steer_right` (keys W/S/A/D and arrows, gamepad triggers and left stick) in `project.godot`.
- Precision: GDScript floats are 64 bit, `Vector3` is 32 bit (about 0.4 mm at 25 km). Geo maths stays in floats.

Tooling (TypeScript and Node, offline bake and harness only):
- Language: TypeScript 5.9, strict, `noUncheckedIndexedAccess`, `noUnused*` (`tsconfig.json`, includes `tools/**/*.ts` only). `tools/geo/projection.ts` is the reference projection for the offline bake tooling.
- Tests: Vitest 5 (`vitest.config.ts`: `tools/**/*.test.ts` and `harness/bin/**/*.test.mjs`). No lint. No runtime dependencies: the game has none outside the engine.
- Dev tools: Playwright 1.65 (the web driver, kept) and sharp (look proof sheets) for the harness only.

- Rule: no new runtime dependency without a decisions.md entry (licence, size, why).

## npm scripts

<!-- The scripts the harness needs and what each does. verify.mjs runs `typecheck`, `test` and `build` when they exist. -->

kit.config.json `target` is `godot` (P0-026): verify.mjs and shoot.mjs run the Godot game through `harness/bin/godotdriver.mjs`. `build` is the headless Godot import, which fills the import folder `game/.godot/` (kit.config.json `buildDir`; gitignored). There is no export yet: verify runs the project from `game/` with the pinned engine. `srcDir` is `game`. The browser scaffold build is gone (P0-027); the web target and `browser.mjs` stay for a later web demo.

| Script | Does |
|---|---|
| `build` | `node harness/bin/godot.mjs check`: headless import of `game/` into `game/.godot/`, fails on any ERROR or SCRIPT ERROR line |
| `typecheck` | `tsc --noEmit` (`tools/**/*.ts`), `tsc --noEmit -p tsconfig.tools.json` (syntax of every `.mjs` in `harness/bin/` and `tools/`), then `godot.mjs parse` (loads every `.gd` under `game/`, `game/tests/parse_all.gd`) |
| `test` | `vitest run`, then `test:godot` |
| `test:godot` | `node harness/bin/godot.mjs test`: headless import of `game/`, then the GDScript tests |
| `godot:check` | the same as `build` |
| `godot:parse` | `node harness/bin/godot.mjs parse` on its own |
| `play` | `node harness/bin/playcopy.mjs --play`: opens the pinned Godot on the newest verified commit's `game/` copy under `harness/reports/play/` (builds the copy first when there is none; `playcopy.mjs --verified` refreshes it) |

## Source layout

- `game/`: the Godot project. `project.godot`, `scenes/main.tscn` (stand-in scene), `scripts/` (`car_model.gd` pure car model and the `forward(heading)` axis rule, `car.gd`, `chase_camera.gd`), `core/` (autoloads `GameArgs`, `SimClock`, `GameEvents`), `debug/` (the debug server, only with `--debug`), `geo/projection.gd`, `tests/` (headless GDScript suites).
- `tools/`: offline Node and TypeScript. `tools/geo/projection.ts` with `projection.test.ts` and `projection.fixture.test.ts`; `tools/fixtures/gen_projection_points.mjs`.
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

East is +X, north is -Z, up is +Y, 1 unit = 1 metre. Compass heading 0 = north, PI/2 = east (`forward()` in `game/scripts/car_model.gd`). No mirroring anywhere: no negative scale on world groups, no axis flips in physics. Tests: `game/tests/test_car.gd`, `test_scene.gd`.

Geographic projection: `tools/geo/projection.ts` (the GDScript port is `game/geo/projection.gd`) (`geoToWorld(lat, lon)` and `worldToGeo(x, z)`, origin `ORIGIN` = India Gate 28.612894 N, 77.229446 E). WGS84 transverse Mercator (Krüger series) with the central meridian through the origin, so scale error is about 0.2 m at 25 km and the round trip is under 1 cm. Provisional until the architecture sign-off. Tests: `tools/geo/projection.test.ts` (origin at 0,0; Connaught Place park at about -1246, -2062; Red Fort at about +1130, -4800; due north has x 0 and negative z; meridian arc against numerical integration; round trips). Godot scenarios: `drive_north`, `drive_turn_right`, `coords_north_marker`.

Godot port: `game/geo/projection.gd` (`geo_to_world(lat, lon)` returns `{x, z}` floats, `world_to_geo(x, z)` returns `{lat, lon}`), checked against `harness/data/fixtures/projection_points.json` (20 points generated from the TS code by `tools/fixtures/gen_projection_points.mjs`; `tools/geo/projection.fixture.test.ts` keeps the file in step with the TS code) within 0.01 m. The car rule is `forward(h)` in `game/scripts/car_model.gd`; a node faces -Z at rotation 0, so a car node uses `rotation.y = -heading`. Tests: `game/tests/test_projection.gd`, `test_car.gd`, `test_scene.gd` (no node under `World` has a negative scale or a mirrored global basis).
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

## Render pipeline

Signed look: stylised B (`stylised_b`), signed 2026-11-11 (STYLE_BIBLE.md). Renderer: Godot 4.7.2 Forward+ (Metal for play on the Mac, Vulkan through MoltenVK when GPU times are measured), 1920x1080 at render scale 1.0 or about 1080p upscaled (MetalFX or FSR) for the 60 fps target on the M2 Pro (decisions.md "Performance target"). Linear colour, Filmic tonemap, no TAA, no SDFGI, no SSR, no volumetric fog.

How the look is built (`game/render/`, all procedural, no art files yet):
- `style_runner.gd` restyles every scene from outside as it loads (SceneTree `node_added`, connected by the `GameArgs` autoload before the main scene): a WorldEnvironment gets the style's Environment, the DirectionalLight3D becomes the sun, MeshInstance3D materials are swapped by their stand-in key (`matte`, `road`, `satin`, ...), Label3D nodes go to the style's sign decoration. Scenes do not know about it. Args: `--style=<id>`, `--light=dawn|afternoon|golden|night` or `--time=<0..24>`, `--style-off=<tokens>` (cost measuring: volfog, shimmer, dressing, lights, textures, decals, ssao, ssil, glow, sunshadow, nopcss, noblend, split2, near80, dshadow, ssq, p34).
- `styles/stylised_b.gd` (extends `stylised_grime.gd`, which extends `stylised.gd`): environment and post, the surface shader layer (`shaders/surface_b.gdshader`: six generated tiling layers in a Texture2DArray plus the wear mask), the Delhi detail dressing laid from anchors the stand-in kit records (`Sink.anchor` in `scenes/standin/geo.gd`), per-area haze (`shaders/haze_b.gdshader`), the heat shimmer pass (`shaders/shimmer.gdshader`), decals, dust motes and the night lights. `styles/stylised_b.tres` holds the look numbers (`style_preset.gd`), `styles/light_<id>.tres` the light presets (`light_preset.gd`), `day_cycle.gd` the day curve.
- Day curve (`--time`): keys night 0 to 4.6 h, dawn 6.3, afternoon 15.0, golden 17.75, dusk 19.0, night from 20.5 h; every field blends (sun azimuth the short way round); the sun swaps to a faint moon at dusk and before dawn.

What each light sets (Environment and lights; numbers in STYLE_BIBLE.md "Lighting presets"):

| Setting | dawn | afternoon | golden | night |
|---|---|---|---|---|
| Sun | 7 degrees, pink, energy 1.9, ESE | 52 degrees, warm white, 2.3, SW | 12 degrees, orange, 2.6, WNW | moon, cool, 0.22 |
| Sky and haze | peach horizon, thick haze (fog 0.0042), contrast plus 0.08 | pale blue, dusty haze (0.0026) | grey-warm top, orange horizon and fog (0.0032) | dark blue, warm horizon glow, brown haze (0.0034) |
| Exposure, ambient | 1.15, 0.45 | 0.85, 0.5 | 1.0, 0.4 | 1.45, 0.32 plus a cool moonlit fill |
| Lights on | lamps half on, 12% windows | none | bulbs start to bloom, 8% windows | sodium lamps, one shop in three, headlights, 55% windows, neon |
| Extras | damp road look in the realistic reference only | heat shimmer pass (1 to 2 ms) | strongest bloom, no shimmer | shadow distance 160 m |

Post stack in order: SSAO (low), SSIL (low), sun-lit exponential fog with the depth haze box, Filmic tonemap and exposure, glow (softlight, threshold 1.0), adjustment (contrast 1.08, saturation 1.05), 3D LUT (33 cubed, per light split tone), heat shimmer (afternoon only). Sun shadows: 4 splits to 240 m, filtered with blur 1.6, no PCSS, no split blending (those two cost 2.8 ms).

What the lean path turns off (`_lean()`, P0-037; the realistic reference look keeps them): PCSS, split blending, the FogVolume and volumetric fog, full-quality SSAO and SSIL, real lights on every shop, shadows from small dressing, decals beyond 55 m.

Quality presets: one preset (default) for now. A later low preset (Mobile renderer or Forward+ with SSAO, SSIL, decals and dressing cut) is a performance task, not built.

The `--style` switches after the sign-off (decisions.md "Style bible and signed budgets"): `stylised_b` becomes the default look in the first task of the first phase; `stylised`, `stylised_grime` and `realistic` stay behind `--style=` as reference sets until the first phase gate, then `stylised` and `stylised_grime` are folded into `stylised_b.gd` and removed; `realistic` is kept as a documented reference until the upscaler decision is done. `--style=none` keeps the flat stand-in look for fast verification.

## Performance budgets

Signed 2026-11-11 in `harness/verify/perf_budgets.json` (status signed): the minimum machine is the Apple M2 Pro at 60 fps steady, about 1080p; look scenes p95 frame time warn 10.0 ms and fail 12.0 ms (graphics get about 10 to 11 ms so 5 to 6 ms stay for gameplay, AI, physics and streaming), average fps floor 55, draw calls warn 600 and fail 1000, triangles with shadow passes warn 6 M and fail 9 M, GPU memory warn 1200 MB and fail 2000 MB, load warn 3 s and fail 10 s. Measured stylised_b on the stand-ins: GPU p95 6.5 to 9.3 ms (worst view per light 7.75 to 9.29), 96 to 315 draw calls, 0.77 to 3.2 M triangles, load 1.06 to 1.33 s.

How they are measured: `debug.perf` windows in perf scenarios and `lookproof.mjs --set <name> --perf` (3 s window, sim held), judged by `perfbudget.mjs` (p95 of the larger of CPU and GPU). The Metal driver reports no GPU time, so GPU numbers use `HARNESS_GODOT_ARGS="--rendering-driver vulkan --disable-vsync"`. Judge on a calm machine (check `ps -r`: another GPU user adds 3 to 5 ms at night); a fail is rerun once; the first view after a shader change is not judged. Per-system and streamed-city budgets are added by the architecture record.

Cost of look features (Vulkan, M2 Pro, bazaar): sun PCSS 1.8 ms, shadow split blending 1 ms, SSIL about 1.5 ms (low quality kept), heat shimmer 1 to 2 ms, 40 omni lights in a narrow lane about 2 ms, per-area volumetric fog 0.3 to 1.3 ms, decals about 0.5 ms, glow and SSAO under the 0.5 ms noise. A look feature that adds more than 0.5 ms says so in its task and is measured with `--style-off=<token>`.

## Movement and camera (if the game has a moving player)

<!-- The tuning numbers and how they are measured (scenarios with sim timed scripts, frame sequences). -->

## Audio standard

## Known limits and debt (as found)

- Everything is a stand-in: flat ground, one road strip, box car, no world data, no physics, no audio.
- The stand-in scene, car and camera are small scripts; they change with the architecture sign-off.
