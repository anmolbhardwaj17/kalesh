# Dilli Darshan: Technical Architecture

<!-- Template. The planner fills it in ADOPT mode from the code as found (facts with file paths), then keeps it current.
Builders read the sections docs/READ_MAP.md lists for their area. Contracts here are binding: a builder who changes one
updates this file and adds a decisions.md entry. -->

## Stack (as found)

As found 2026-11-10 (scaffold). Phase 0 architecture discovery decides the real stack; this section is rewritten after the architecture sign-off.
- Renderer: three.js 0.187 `WebGLRenderer` (antialias, pixel ratio capped at 2), no post processing, no shadows, default colour management.
- Language: TypeScript 5.9, strict, `noUncheckedIndexedAccess`, `noUnused*` (`tsconfig.json`, includes `src` only).
- Bundler: Vite 8 (`vite.config.ts`, base `./`, target es2022, out `dist/`). Bundle is about 535 kB (warning over 500 kB).
- Tests: Vitest 5 (`src/**/*.test.ts` and `harness/bin/**/*.test.mjs`). No lint.
- Physics, audio, UI framework, save: none yet.
- Dev tools: Playwright 1.65 and sharp for the harness only.
- Rule: no new runtime dependency without a decisions.md entry (licence, size, why).

## npm scripts

<!-- The scripts the harness needs and what each does. verify.mjs runs `typecheck`, `test` and `build` when they exist;
`build` must write index.html into the build folder (kit.config.json buildDir). -->

| Script | Does |
|---|---|
| `build` | `tsc --noEmit && vite build`, writes `dist/index.html` |
| `typecheck` | `tsc --noEmit` |
| `test` | `vitest run` |
| `dev` | `vite` dev server |

## Source layout

- `index.html`: the canvas `#game` and a `#hud` div.
- `src/main.ts`: renderer, scene (ground, road strip, north post), box car, chase camera, the frame loop, hook install.
- `src/car.ts`: pure kinematic car model and the `forward(heading)` axis rule; tested in `src/car.test.ts`.
- `src/debug/hooks.ts`: `window.__game` (docs/GAME_HOOKS.md), sim clock with time scale and hold; tested in `src/debug/hooks.test.ts`.
- `public/`: empty (assets go to `public/assets/` with `manifest.json`).

## Core contracts

<!-- The interfaces every part of the game relies on, one subsection each: the main loop and fixed timestep, scenes or
levels (load, unload, anchors), the player, input actions, save format and migration, assets by id (below), audio buses,
UI layers, the debug hooks (docs/GAME_HOOKS.md). -->

### Main loop and time

Variable step: `requestAnimationFrame`, dt capped at 0.1 s, scaled by `hooks.clock.advance(dt)` (time scale and sim hold). The car steps with the sim dt; render every frame. A fixed physics step is an architecture decision for Phase 0.

### Coordinates (binding, owner 2026-11-10)

East is +X, north is -Z, up is +Y, 1 unit = 1 metre. Compass heading 0 = north, PI/2 = east (`forward()` in `src/car.ts`). No mirroring anywhere: no negative scale on world groups, no axis flips in physics. Tests: `src/car.test.ts` "coordinates"; the geographic projection and its landmark test arrive with the P0 harness baseline task.
### Scenes and levels

### Input

### Save

### Assets

<!-- Assets are referenced by id. The game reads public/assets/manifest.json ({images, audio, models}: id -> {path}) and
uses a procedural placeholder for any id with no file yet (colour, pattern, simple mesh, a beep). New ids are registered
with harness/bin/assets.mjs; uploads go through the dashboard and harness/bin/ingest.mjs. -->

### Audio

### Debug hooks

`src/debug/hooks.ts`, installed by `src/main.ts`; the `debug` part exists only with `?debug=1`. Listed in `harness/verify/shared_paths.json`.

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
