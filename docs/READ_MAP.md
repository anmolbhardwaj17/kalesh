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
- Source: `harness/bin/tileset.mjs` (P1-018: the full tile set for a snapshot or play copy, checked against the committed `game/world/tiles.hash`), `harness/bin/godot.mjs` (the pinned engine, headless check and tests, Movie Maker frame), `godotclient.mjs` and `godotsmoke.mjs` (the Godot debug server client and smoke test), `driver.mjs`, `godotdriver.mjs` and `godotshim.mjs` (how verify and shoot run the Godot game and its page-side scripts), `game/debug/` and `game/core/` (debug server, args, sim clock, events), `game/tests/run_tests.gd`, `harness/bin/verify.mjs`, `browser.mjs` (the web driver, kept for a later web demo), `playcopy.mjs` (npm run play), `shoot.mjs`, `lib.mjs`, `task.mjs`, `lookproof.mjs`, `perfbudget.mjs`, `perfgate.mjs`, `quickset.mjs`, `freshreport.mjs`, `gatecheck.mjs`, `gateretry.mjs`, `cliguard.mjs`; `harness/verify/scenarios.json`, `quick.json`, `shared_paths.json`, `perf_budgets.json`, `look_rules.json`, `scripts/`, `milestones/`; the game's debug hook folder.

## Rendering and look
Notes: `harness/state/knowledge/rendering-and-look.md`
- ARCH: "How the pieces fit", "Systems".
- TECH: "Render pipeline", "Performance budgets".
- STYLE: all sections that apply to the task.
- VERIFY: "Visual review rubric (verifier agent)", "Look proof workflow (`lookproof.mjs`)", "Perf probes".
- Source: `game/scenes/main.tscn` (environment, lights, scene), the stand-in scenes `game/scenes/standin/` (builder.gd sets their environment and sun; style tests restyle these); the look is stylised B by default (no `--style`); the game args `--style=<name>` (`none` is the flat stand-in look), `--light=<preset>` and `--time=<h>` (`game/core/game_args.gd`) switch it, and the day clock `game/core/day_clock.gd` picks the hour; their code is `game/render/` (`style_runner.gd`, `styles/<id>.gd` and `.tres`, `styles/light_<id>.tres`, `shaders/surface.gdshader`), tests `game/tests/test_style.gd`.

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
Notes: `harness/state/knowledge/driving-and-camera.md`
- ARCH: "Systems" (Driving), "Target module map" (rows `core/`, `vehicles/`, `camera/`).
- TECH: "Main loop and time (C1)", "Coordinates (binding, owner 2026-11-10)", "Vehicles (V2)", "Performance budgets" (CPU rows physics and vehicles).
- GAME: "Movement and camera feel".
- Source: `game/scripts/car_model.gd`, `car.gd`, `chase_camera.gd`, `game/tests/test_car.gd`; planned `game/vehicles/`, `game/camera/`, tunes in `game/data/vehicles/`. Bench versions of the clock, both vehicle options, the walker with its step-up and the colliders: `game/bench/physics/` (P0-017, `--arch=physics`; results in decisions_archive.md "Physics bench results (P0-017)").

## World, map data and bake
Notes: `harness/state/knowledge/world-and-map.md`
- ARCH: "Target module map" (the bake and tools table).
- TECH: "Coordinates (binding, owner 2026-11-10)", "World layout (signed 2026-11-11)", "Tile format (T1, `KTL1`)", "World pipeline (offline bake)".
- Design: `harness/design/MAP_REPAIR.md` (the sections for your task: "Pipeline", "District frames and stitching", "Connector format", "Rule engine", "Auto-repair bounds", "Elevation solver", "Lane-level road model", "Hero roads", "Junction mesh builder", "Terrain that fits the roads", "Verification"), `harness/design/DELHI_WORLD.md` (section 0 the signed map, 1 landmarks, 2 area profiles and 2a the pilot area sheets, 10 the signed pipeline), `harness/design/ARCH_OPTIONS.md` (the measured rows for your system by id, for the numbers behind a choice).
- Data (each once added): `harness/data/districts.json` (signed: blocks, method, focus and planned districts, corridors) and `harness/data/districts/`, `harness/data/connectors/`, `harness/data/overrides/`, `harness/data/hero_roads/`, `harness/data/landmarks/`, `harness/data/areas/`. Source data downloads live in the gitignored `data/` folder with `data/SOURCES.json`. Bake stages are `stages` in `districts.json`; the pilot centre outline is `harness/data/districts/pilot_centre.geojson`, its downloads `data/pilot_centre/`.
- Source: the production bake driver `tools/bake/main.ts` (`npm run bake -- pilot`, see TECH "npm scripts"), its source readers `tools/bake/sources/` (the only bake code that touches files and the network) and the pure parts it calls (`cli.ts`, `layout/`, `pins.ts`, `rand.ts`, `heights.ts`, `invariants.ts`, `report/health.ts`); `tools/geo/` (the reference projection and its tests), its Godot port `game/geo/projection.gd` with `game/tests/test_projection.gd` and the fixture `harness/data/fixtures/projection_points.json`, the offline bake under `tools/bake/` (rules in `tools/bake/rules/`, the lane model in `tools/bake/roads/` with `network.ts` as its entry (phases `netzones.ts`, `netclusters.ts`, `netstrips.ts`; edges that give way `edges.ts`; free ends clipped `clip.ts`; conflicts back to the repair `surfaces.ts`; the overlap finder `overlap.ts`; lane paths that stay on the junction `routes.ts`; split zones of three branches `split3.ts`), tests beside the code), the data bench drivers `harness/bench/pilot_data/` (`fetch.mjs`, `census.mjs`, `tiles.mjs`, boxes in `harness/bench/pilot_areas.json`), the tile bench scene `game/bench/tiles/` (`--arch=tiles`) with the T1 reader `tile_t1.gd`; other Godot bench scenes under `game/bench/<name>/` (game arg `--arch=<name>`). Results of the data bench: decisions_archive.md "Pilot data bench results (P0-018)". The lane-level road model prototype: `tools/bake/roads/` (tests `roads.test.ts`), driver `harness/bench/roads.mjs`, scene `game/bench/roads/` (`--arch=roads:ito|cp`), hero road specs `harness/data/hero_roads/`; results: decisions_archive.md "Road prototype results (P0-019)". The layout (P1-008): `tools/bake/layout/` (`placement.ts` blocks and the placement method, `gate.ts` rule R-STITCH, `grid.ts` the one 250 m world grid, `recentre.ts` the world origin and the recentre step, `geodesic.ts`, `pincheck.ts`, `edge.ts` and `closures.ts` for the map edge; tests `layout.test.ts`, `grid.test.ts`, `recentre.test.ts`, `edge.test.ts`), the tile cutter `tools/bake/tileset.ts`, the corridors `tools/bake/connectors/`; the block graph (P1-009) `tools/bake/graph/` (`build.ts`, `topology.ts`, `pairs.ts`, `classify.ts`, `features.ts`, `footprints.ts`, `underground.ts` (underground structures, P1-041, list `harness/data/underground.json`), `checks.ts`, `render.ts`; tests `graph.test.ts`, `pilot_graph.test.mjs`, fixture `harness/data/fixtures/pilot_divided_streets.json`) with its reader `tools/bake/sources/graphinput.ts`; the rule engine and auto-repair (P1-010) `tools/bake/rules/` (`context.ts`, `types.ts`, one file per rule area, `catalogue.ts`; tests `rules.test.ts`) and `tools/bake/repair/` (`bounds.ts`, `apply.ts`, `engine.ts`, `env.ts`, `feedback.ts` (the lane model's feedback, P1-033), `render.ts`; tests `repair.test.ts`, `pilot_repair.test.mjs`) with `tools/bake/sources/repairio.ts` and the hero list `harness/data/hero_list.json`; the overrides, issues.json and health report (P1-011) `tools/bake/repair/overrides.ts`, `tools/bake/sources/overridesio.ts`, `tools/bake/report/health.ts` and `report/inspector.ts`; the elevation solve (P1-013) `tools/bake/elevation/` (`solve.ts` is the entry; `profile.ts`, `crossings.ts`, `limits.ts`, `multipliers.ts`, `sparse.ts`, `structures.ts`, `checks.ts`, `elevout.ts`, `render.ts`, `input.ts`, `overhead.ts` (metro viaducts and foot bridges, P1-035); tests `elevation.test.ts`, `overhead.test.ts`, `pilot_elevation.test.mjs`, fixture `harness/data/fixtures/ito_phase0_profile.json`) with `tools/bake/sources/elevationio.ts`; the road and junction mesh (P1-014) `tools/bake/mesh/` (`build.ts` is the entry; `input.ts`, `faces.ts`, `stripfaces.ts`, `junctionfaces.ts`, `clip.ts`, `conform.ts`, `solids.ts`, `structures.ts`, `portal.ts` (portal piers, P1-036), `paint.ts`, `proof.ts`, `checks.ts`, `meshout.ts`, `render.ts`; tests `mesh.test.ts`, `portal.test.ts`, `pilot_mesh.test.mjs`) with `tools/bake/sources/meshio.ts`, shown by the road bench scene `game/bench/roads/` (`node harness/bench/arch.mjs roads`); the ground (P1-015) `tools/bake/terrain/` (`build.ts` is the entry; `collect.ts`, `predicates.ts`, `cdt.ts`, `cdtsegments.ts`, `labels.ts`, `triangulate.ts`, `surface.ts`, `checks.ts`, `terrainout.ts`; tests `cdt.test.ts`, `terrain.test.ts`, `budgets.test.mjs`, `pilot_terrain.test.mjs`), shown by the same bench scene; the tiles (P1-016) `tools/bake/tile/` (`write.ts` is the entry; `codec.ts`, `cutter.ts`, `colliders.ts`, `shells.ts`, `lanes.ts`, `checks.ts`, `tilesout.ts`, `sample.ts`, Phase 0 `standin.ts` and `glb.ts`; tests `tile.test.ts`, `fixture.test.ts`, `pilot_tiles.test.mjs`) with `tools/bake/sources/tilestage.ts`, the fixture `harness/data/fixtures/tile_t1_sample.json` (`node tools/fixtures/gen_tile_fixture.mjs`) and the GDScript test `game/tests/test_tiles.gd`; data `harness/data/districts.json`, `harness/data/districts/` (outlines and `places.json`), `harness/data/connectors/`. The island stitch prototype is retired (ARCH source map row "Stitch prototype, retired"); its results: decisions_archive.md "Map stitch results (P0-029)".

## Streaming and world runtime
Notes: `harness/state/knowledge/world-runtime.md`
- ARCH: "Target module map" (rows `world/streaming/`, `world/systems/`, `geo/`, `world/tiles/`).
- TECH: "World layout (signed 2026-11-11)", "Tile format (T1, `KTL1`)", "Streaming (ST1, TL1)", "Rendering of the city (I3, LD1, OC2, TX1)", "Performance budgets".
- Budgets: `harness/verify/perf_budgets.json` blocks `systems`, `world`, `streaming`, `scenes.city`.
- Source (P1-019): `game/world/world_stream.gd` (the scene's streamed city, boot, teleport), `game/world/streaming/` (`stream_core.gd`, `ring_plan.gd`, `attach_queue.gd`, `tile_reader.gd`, `tile_index.gd`), `game/world/systems/` (`ground_roads.gd`, `buildings.gd`, `colliders.gd`, `lanes.gd`, `tile_mesh.gd`), `game/geo/world_frame.gd`, the debug probes `game/debug/stream_probe.gd` (hook `stream`), tests `game/tests/test_streaming.gd`, scenario scripts `harness/verify/scripts/stream_200.js`, `stream_140.js`, `stream_teleport.js`, `stream_memory.js` and `drive_test_block.js`, routes `harness/data/fixtures/stream_routes.json` (`tools/fixtures/gen_stream_routes.mjs`). Bench readers: `game/bench/tiles/tile_t1.gd` (`--arch=tiles`) and `game/bench/render/` (`--arch=render`).
- HOOKS: "Godot transport" (`--tiles`, `state().world`, `ready`, `teleport`, `stream`).

## Characters, AI and combat
Notes: `harness/state/knowledge/characters-ai-combat.md`
- ARCH: "Target module map" (rows `characters/`, `ai/`, `combat/`).
- TECH: "On foot and combat (F1, CB1)", "Characters, crowds and navigation (N1, AN2, AL1)", "Performance budgets" (CPU rows).
- GAME: "Player verbs", "Combat and on foot", "Police and wanted", "Civilians and violence".
- Source: planned `game/characters/`, `game/ai/`, `game/combat/`; bench versions in `game/bench/physics/` (`walker.gd`, `ragdoll.gd`, `t_combat.gd`, `t_agents.gd`, `t_traffic.gd`) and the crowd in `game/bench/render/crowd.gd`.

## Story runtime (cutscenes, dialogue, subtitles)
Notes: `harness/state/knowledge/story-runtime.md`
- ARCH: "Target module map" (rows `story/`, `missions/`, `data/`).
- TECH: "Story runtime (CS2, DG1, LIP2 then LIP1, FC2, SB1, SK1)", "Save".
- GAME: "Mission system", "Camera, presentation and UI". STORY_OUTLINE.md section 5 for the talk rules.
- Source: planned `game/story/`, `game/missions/`, data in `game/data/cutscenes/` and `game/data/dialogue/`.

## Map inspector
Notes: `harness/state/knowledge/world-and-map.md`
- ARCH: "Target module map" (row `inspector/`).
- TECH: "Map inspector".
- Design: `harness/design/MAP_REPAIR.md` "Map inspector (human in the loop)", "Overrides format", "Issue record"; `harness/design/DELHI_WORLD.md` "Map inspector: area view".
- Source: `tools/inspector/` (`lib.ts`, `lanes.ts`, `describe.ts`, `ktl1.ts`, `server.mjs`, `serve.mjs`, `shots.mjs`, `web/app.js`, `web/layers.js`, `web/minimap.js`, `web/theme.js`, tests `describe.test.ts`, `lib.test.ts`, `lanes.test.ts`, `page.test.mjs`, `pick_to_bake.test.mjs`), served by `harness/bin/dashboard.mjs` at `/inspector/`; it reads the tiles and `issues.json` (file contract in the header of `adapter.mjs`) and writes `harness/data/overrides/<tileX>_<tileZ>.json` and the inbox (source `inspector`). Steps 1 (issues) and 2 (the lanes tab: `lanes.ts`, `laneMarksLayer` in `web/layers.js`, `POST /api/inspector/set-lanes`) are built; hero roads and landmarks are steps 3 and 4.

## Old game reference (read only)
- `/Users/apple/Desktop/code/delhi-drive`: never edit, build or install there. Read `harness/design/SALVAGE_AUDIT.md` first (written in Phase 0) instead of the old code.
