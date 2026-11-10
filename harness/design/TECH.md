# Dilli Darshan: Technical Architecture

<!-- Template. The planner fills it in ADOPT mode from the code as found (facts with file paths), then keeps it current.
Builders read the sections docs/READ_MAP.md lists for their area. Contracts here are binding: a builder who changes one
updates this file and adds a decisions.md entry. -->

## Stack (as found)

<!-- Engine or renderer and version (three.js, Babylon, PlayCanvas, Pixi, raw WebGL or WebGPU), language and strictness,
bundler, physics, audio, UI layer, test runner, lint, Node version. What may be added and what must not (for example "no
new runtime dependency without a decisions.md entry"). -->

## npm scripts

<!-- The scripts the harness needs and what each does. verify.mjs runs `typecheck`, `test` and `build` when they exist;
`build` must write index.html into the build folder (kit.config.json buildDir). -->

| Script | Does |
|---|---|
| `build` | |
| `typecheck` | |
| `test` | |
| `dev` | |

## Source layout

<!-- Folder by folder, one line each. docs/ARCHITECTURE.md has the module map. -->

## Core contracts

<!-- The interfaces every part of the game relies on, one subsection each: the main loop and fixed timestep, scenes or
levels (load, unload, anchors), the player, input actions, save format and migration, assets by id (below), audio buses,
UI layers, the debug hooks (docs/GAME_HOOKS.md). -->

### Main loop and time

### Scenes and levels

### Input

### Save

### Assets

<!-- Assets are referenced by id. The game reads public/assets/manifest.json ({images, audio, models}: id -> {path}) and
uses a procedural placeholder for any id with no file yet (colour, pattern, simple mesh, a beep). New ids are registered
with harness/bin/assets.mjs; uploads go through the dashboard and harness/bin/ingest.mjs. -->

### Audio

### Debug hooks

<!-- Where window.__game lives (for example src/debug/), and that it is listed in harness/verify/shared_paths.json. -->

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

<!-- What the adopted code does that the harness or the style will need changed, with file paths. -->
