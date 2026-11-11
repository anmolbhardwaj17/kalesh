# Read map

Which doc sections and source files to read for the area you touch. Heading text below is exact, so `grep -n "^#.*<heading>" <file>` finds it.

**Always read first:** `harness/state/knowledge.md` (core) and `harness/state/decisions.md` (both short), then the `Notes:` file of your area (`harness/state/knowledge/<area>.md`), then the brief. After that read only the sections listed for your area, plus any doc the brief names. Do not read whole design docs. Grep the code before opening whole files. For the reason behind a rule, grep `harness/state/decisions_archive.md`.

Docs: `docs/ARCHITECTURE.md` (ARCH), `harness/design/TECH.md` (TECH), `harness/design/GAME.md` (GAME), `harness/design/VERIFY.md` (VERIFY), `harness/design/STYLE_BIBLE.md` (STYLE), `docs/GAME_HOOKS.md` (HOOKS). Every visual task also reads VERIFY "Visual review rubric (verifier agent)", since the verifier fails against it.


## Verify scripts and harness tooling
Notes: `harness/state/knowledge/verify-and-harness-tooling.md`
- ARCH: "Tooling (outside `game/`)".
- TECH: "npm scripts", "Debug hooks".
- VERIFY: "Levels", "shoot.mjs behaviour", "Scenario options", "Speed", "Quick set", "Play scripts (anti-cheat for our own bot)", "Perf probes", "Look proof workflow (`lookproof.mjs`)", "Final gate".
- HOOKS: all.
- Also: `CLAUDE.md` (the loop), `.claude/agents/verifier.md` when changing what the verifier runs.
- Source: `harness/bin/godot.mjs` (the pinned engine, headless check and tests, Movie Maker frame), `godotclient.mjs` and `godotsmoke.mjs` (the Godot debug server client and smoke test), `driver.mjs`, `godotdriver.mjs` and `godotshim.mjs` (how verify and shoot run the Godot game and its page-side scripts), `game/debug/` and `game/core/` (debug server, args, sim clock, events), `game/tests/run_tests.gd`, `harness/bin/verify.mjs`, `browser.mjs` (the web driver, kept for a later web demo), `playcopy.mjs` (npm run play), `shoot.mjs`, `lib.mjs`, `task.mjs`, `lookproof.mjs`, `perfbudget.mjs`, `perfgate.mjs`, `quickset.mjs`, `freshreport.mjs`, `gatecheck.mjs`, `gateretry.mjs`, `cliguard.mjs`; `harness/verify/scenarios.json`, `quick.json`, `shared_paths.json`, `perf_budgets.json`, `look_rules.json`, `scripts/`, `milestones/`; the game's debug hook folder.

## Rendering and look
Notes: `harness/state/knowledge/rendering-and-look.md`
- ARCH: "How the pieces fit", "Systems".
- TECH: "Render pipeline", "Performance budgets".
- STYLE: all sections that apply to the task.
- VERIFY: "Visual review rubric (verifier agent)", "Look proof workflow (`lookproof.mjs`)", "Perf probes".
- Source: `game/scenes/main.tscn` (environment, lights, scene), the stand-in scenes `game/scenes/standin/` (builder.gd sets their environment and sun; style tests restyle these); the Phase 0 style tests switch the look with the game args `--style=<name>` and `--light=<preset>` (`game/core/game_args.gd`); their code is `game/render/` (`style_runner.gd`, `styles/<id>.gd` and `.tres`, `styles/light_<id>.tres`, `shaders/surface.gdshader`), tests `game/tests/test_style.gd`.

## UI and input
Notes: `harness/state/knowledge/ui-and-input.md`
- ARCH: "Source map".
- TECH: "Input".
- GAME: "Player verbs", "HUD", "Menus", "Accessibility".
- HUD: `harness/design/HUD.md` (components, layouts, motion, checkable rules; mockups in `harness/design/hud_mockups/`).
- STYLE: "UI".
- Source: the InputMap actions in `game/project.godot`, `game/scripts/car.gd` (input to the car); the HUD under `game/ui/` once added.

## Assets and ingest
Notes: `harness/state/knowledge/assets-and-ingest.md`
- TECH: "Assets".
- STYLE: "AI image prompts".
- Source: `harness/bin/assets.mjs`, `ingest.mjs`, `public/assets/manifest.json`, the game asset registry once added.

## Driving and camera
Notes: `harness/state/knowledge/driving-and-camera.md` (create on first gotcha)
- ARCH: "Systems" (Driving).
- TECH: "Main loop and time", "Coordinates (binding, owner 2026-11-10)".
- GAME: "Movement and camera feel".
- Source: `game/scripts/car_model.gd`, `car.gd`, `chase_camera.gd`, `game/tests/test_car.gd`. Bench versions of the clock, both vehicle options, the walker with its step-up and the colliders: `game/bench/physics/` (P0-017, `--arch=physics`; results in decisions.md "Physics bench results (P0-017)").

## World, map data and bake
Notes: `harness/state/knowledge/world-and-map.md` (create on first gotcha)
- TECH: "Coordinates (binding, owner 2026-11-10)" and the world sections written after the architecture sign-off.
- Design: `harness/design/MAP_REPAIR.md` (all), `harness/design/DELHI_WORLD.md` (section 0 composite map, 1 landmarks, 2 area profiles, 10 pipeline choices: read the section for your task), `harness/design/ARCH_OPTIONS.md` (the rows for your system by option id, "Budgets per system", "Bench tasks"; a draft until the architecture sign-off).
- Data (each once added): `harness/data/districts.json` and `harness/data/districts/`, `harness/data/connectors/`, `harness/data/overrides/`, `harness/data/hero_roads/`, `harness/data/landmarks/`, `harness/data/areas/`. Source data downloads live in the gitignored `data/` folder with `data/SOURCES.json`.
- Source: `tools/geo/` (the reference projection and its tests), its Godot port `game/geo/projection.gd` with `game/tests/test_projection.gd` and the fixture `harness/data/fixtures/projection_points.json`, the offline bake under `tools/bake/` (rules in `tools/bake/rules/`, tests beside the code), the data bench drivers `harness/bench/pilot_data/` (`fetch.mjs`, `census.mjs`, `tiles.mjs`, boxes in `harness/bench/pilot_areas.json`), the tile bench scene `game/bench/tiles/` (`--arch=tiles`) with the T1 reader `tile_t1.gd`; other Godot bench scenes under `game/bench/<name>/` (game arg `--arch=<name>`). Results of the data bench: decisions.md "Pilot data bench results (P0-018)". The lane-level road model prototype: `tools/bake/roads/` (tests `roads.test.ts`), driver `harness/bench/roads.mjs`, scene `game/bench/roads/` (`--arch=roads:ito|cp`), hero road specs `harness/data/hero_roads/`; results: decisions.md "Road prototype results (P0-019)".

## Old game reference (read only)
- `/Users/apple/Desktop/code/delhi-drive`: never edit, build or install there. Read `harness/design/SALVAGE_AUDIT.md` first (written in Phase 0) instead of the old code.
