# Kalesh: Technical Architecture

Signed by Anmol on 2026-11-11: "Yes, I sign off on the architecture." (decisions.md "Architecture record (P0-022)"). This file is the binding design. The measured comparison behind every choice is in `ARCH_OPTIONS.md` (draft 2, P0-020; ids such as R1 or LN1 in brackets point at its rows). The module map is in `docs/ARCHITECTURE.md`. The map pipeline is in `MAP_REPAIR.md`, the world layers in `DELHI_WORLD.md`, the budgets in `harness/verify/perf_budgets.json`.

Contracts here are binding: a builder who changes one updates this file and adds a decisions.md entry. Builders read the sections `docs/READ_MAP.md` lists for their area.

## Signed design at a glance

| System | Signed choice | Measured on this M2 Pro |
|---|---|---|
| Engine and renderer | Godot 4.7.2 Forward+ with the stylised B look (R1); Metal for play on Mac, Vulkan on Windows (G1) | 2 km bench city at 140 km/h: GPU p95 7.06 ms, CPU 1.2 ms |
| Lighting | Sun, sky ambient, SSAO, SSIL low, reflection probes at hero places, vertex AO baked into tiles. No real-time GI (L1) | Look stack 3.55 ms. SDFGI would add 16.6 ms at speed |
| Resolution | Render at 1080p, bilinear stretch to the display (MetalFX spatial as a Mac setting), TAA as a settings switch, off by default (A4) | Stretch 0.43 to 0.51 ms. TAA 1.23 ms |
| Physics | Jolt, set by name in the project settings (P1) | Step p95 0.74 ms |
| Sim clock | One engine physics frame is one sim tick (C1) | Replays match to 0.0000 mm at time scale 0.25, 1 and 4 |
| Vehicles | Our own raycast vehicle on a Jolt rigid body, one model for auto, scooter, car and bus (V2) | 0.035 ms per car. Answers input in 1 tick |
| On foot | CharacterBody3D capsule with our own step-up (F1) | 0.032 ms per character, no snag on kerbs, stairs, ramps |
| Colliders | Exact triangle mesh for every drivable and walkable surface from the drawn vertices, one shell per building, attached in chunks of about 500 triangles (K3) | 0.33 ms p95 per chunk, error 0.00002 m |
| Game code | GDScript only, written data first (LANG1) | 230 agents think in 0.8 ms p95 |
| Map bake | Offline Node and TypeScript in `tools/bake/` (B1) | Dense tile 12 to 22 ms, ITO road site 0.6 s |
| Tile file | Our own binary tile `KTL1`, read on a worker thread (T1) | 0.89 MB dense tile, read 1.0 ms, attach 4.6 ms over frames |
| Coordinates | One transverse Mercator frame per block (X1); 32-bit floats, vertices relative to their tile (FP1) | Landmark error 0.006 mm; no jitter at 7 km |
| World layout | One seamless city: centre block at true scale, far districts on their real bearing at 0.5 of real distance (CG2, FL4, DC2, SC1) | Centre pairs exact. About 68 km2 and 1,090 tiles at first release (estimate) |
| Streaming | 250 m tiles on one world grid, three rings, worker read, 1 ms attach cap per frame (ST1, TL1) | Speed adds no GPU cost |
| Instancing and LOD | Unique shells, roads and ground merged per tile; repeated modules as MultiMesh per 125 m cell; three LOD levels by visibility range; no occlusion culling (I3, LD1, OC2) | LOD cuts 92% of triangles and 8.6 ms |
| Textures | VRAM compressed with mipmaps, both import sets, one Texture2DArray and one trim and decal atlas per kit (TX1) | 7 times less memory, 37 times faster loads |
| Characters | Navmesh from the lane model (N1); near people skinned, far people vertex animated (AN2); Quaternius CC0 library (AL1); hitscan with 3 hit zones and up to 8 ragdolls (CB1); traffic on lane rails (TR1) | 300 people 0.3 ms CPU, 0.9 ms GPU; rays 0.03 ms |
| Map repair | Rule engine in TypeScript (RE1), auto-repair of clear cases (AR1), override patches per world tile (OV1) | 1,052 pilot issues, 73% fix themselves, 27 big ones for Anmol |
| Roads and ground | Lane-level road model (LN1), whole-graph height solver (EL1), hero road specs (HR1), junction builder with an overlap proof (J3), ground cut to the road edge (TF2) | ITO and CP: 0 overlap, 0 height steps, 0 m road to ground gap |
| Sources | OSM roads (RS2), Overture buildings (BS1), GEDTM30 ground smoothed over 60 m (GS1) | All allow a later sale |
| World layers | Landmark registry (LM1, LS2, LP2, HM2), area profiles and a bake-time generator (AD2, PS1, AG1, KT2, EB1) | 351 pilot landmark candidates; placements 0.57 MB per dense tile |
| Map inspector | A small web page on the dashboard, issues first (MI1, IV1 in the order of IV3) | Step 1 (issues) built in P1-001; runs on the pilot census through an adapter until the production bake (P1-011) |
| Story runtime | Data-file cutscenes with one player (CS2), our own line player (DG1), jaw by loudness now and lip sync later (LIP2 then LIP1), face set on the leads (FC2), Hinglish and English subtitles (SB1), declared end states for skip (SK1) | Estimate under 0.5 ms |
| Verify and shipping | The Godot driver with bench scenes (VH2); unsigned Mac and Windows test builds (EM1, EW1) | Benches ran on it |

## Stack

Godot (the game):
- Engine: Godot 4.7.2.stable, standard build (single precision, no .NET), pinned in `harness/kit.config.json` "godot". `node harness/bin/godot.mjs` finds it (env `GODOT`, then `tools/godot/`, then `/Applications/Godot.app`), checks the version and only on a machine without it downloads the official portable build into `tools/godot/` (gitignored, SHA512 checked). Nothing is installed globally.
- Project: `game/` (`project.godot`), Forward+ renderer, fixed 60 Hz physics tick, main scene `res://scenes/main.tscn`. The import cache `game/.godot/` is gitignored; the `*.gd.uid` files are committed.
- Physics: Jolt, named in `project.godot` (`physics/3d/physics_engine="Jolt Physics"`, set in P1-006). The project default resolves to GodotPhysics3D on this build (measured), so the name must be set; `game/tests/test_sim_clock.gd` reads the setting back and checks the running space state is Jolt's.
- Language: GDScript, typed where it helps, written data first (packed arrays and server calls for crowds and traffic). No C#. No GDExtension: the measured numbers do not need it. A hot loop that misses its budget gets a decisions.md entry before any native code is considered.
- Tests: the headless runner `game/tests/run_tests.gd` (no addon), suites `game/tests/test_*.gd`, run by `node harness/bin/godot.mjs test`, which `npm test` calls after vitest.
- Input: InputMap actions in `project.godot` (today `throttle`, `brake`, `steer_left`, `steer_right`; keys W/S/A/D and arrows, gamepad triggers and left stick). Every action is remappable.

Tooling (offline bake, map inspector and harness):
- Node 22 and TypeScript 5.9, strict, `noUncheckedIndexedAccess`, `noUnused*` (`tsconfig.json` covers `tools/**/*.ts`). Node runs the `.ts` files directly; imports carry the `.ts` ending.
- Tests: Vitest 5 (`tools/**/*.test.ts`, `harness/bin/**/*.test.mjs`). No lint.
- Dev dependencies for the bake (decisions.md entries per package): `@duckdb/node-api` (MIT, reads Overture), `geotiff` (MIT, reads the height files), `clipper2-ts` 2.0.1-19 (BSL-1.0, polygon union for the junction overlap proof), `earcut` 3.2.4 with `@types/earcut` (ISC and MIT, polygon triangulation). Added when a task needs them, each with an entry: `flatbush` (ISC, spatial index), `meshoptimizer` (MIT, LOD index buffers), `three` (MIT, the map inspector page only).
- Harness only: Playwright 1.65 (the web driver and the inspector page tests), sharp (look proof sheets).
- Rule: no new runtime dependency in the game. No new dev dependency without a decisions.md entry (licence, size, why). None of the bake packages ships in the game.

## npm scripts

kit.config.json `target` is `godot` (P0-026): verify.mjs and shoot.mjs run the Godot game through `harness/bin/godotdriver.mjs`. `build` is the headless Godot import, which fills `game/.godot/` (kit.config.json `buildDir`; gitignored). There is no export yet: verify runs the project from `game/` with the pinned engine. `srcDir` is `game`. The web target and `browser.mjs` stay for a later web demo.

| Script | Does |
|---|---|
| `build` | `node harness/bin/godot.mjs check`: headless import of `game/` into `game/.godot/`, fails on any ERROR or SCRIPT ERROR line |
| `typecheck` | `tsc --noEmit` (`tools/**/*.ts`), `tsc --noEmit -p tsconfig.tools.json` (syntax of every `.mjs` in `harness/bin/` and `tools/`), then `godot.mjs parse` (loads every `.gd` under `game/`) |
| `test` | `vitest run`, then `test:godot` |
| `test:godot` | `node harness/bin/godot.mjs test`: headless import of `game/`, then the GDScript tests |
| `godot:check` | the same as `build` |
| `godot:parse` | `node harness/bin/godot.mjs parse` on its own |
| `play` | `node harness/bin/playcopy.mjs --play`: opens the pinned Godot on the newest verified commit's `game/` copy under `harness/reports/play/` |
| `bake` | `node tools/bake/main.ts <stage or block>` with `--stage <sources, ground, graph, repair, lanes, elevation, mesh, terrain or tiles>`, `--tiles x_z,...`, `--out <dir>`, `--force`, `--offline` (P1-007): the offline bake. `npm run bake -- pilot --stage sources` fetches or reuses every pinned file of the stage and prints its hash; the steps run in order and stop before tiles when an invariant fails; writes `harness/reports/map/health.json` (the graph step also writes `<dataDir>/graph.json` and the north-up picture `harness/reports/map/graph_<stage>.png`; the repair step writes `<dataDir>/graph_repaired.json`, `harness/reports/map/issues.json`, `repairs.jsonl` and the north-up picture `issues_<stage>.png`, prints the time per rule and stops the bake when a second run would still repair something; tiles to `game/world/tiles/` once the tile writer lands) |

## Source layout

- `game/`: the Godot project. What exists today is listed in `docs/ARCHITECTURE.md` "Source map"; the signed target layout is `docs/ARCHITECTURE.md` "Target module map".
- `tools/`: offline Node and TypeScript. `tools/geo/` (the reference projection), `tools/bake/` (map bake), `tools/inspector/` (the map inspector page), `tools/fixtures/`. `tools/godot/` holds a downloaded engine on machines without one (gitignored).
- `harness/data/`: versioned map data that people edit: `districts.json` and `districts/` (block and focus outlines), `connectors/`, `overrides/`, `hero_roads/`, `landmarks/`, `areas/`, `milestones.json`.
- `data/`: downloaded sources (gitignored) with the pin list `data/SOURCES.json` (versioned).
- `game/world/tiles/`: baked tiles (gitignored, rebuilt by the bake; a release build packs them per stage).
- `public/assets/`: art and audio files with `manifest.json`.

Module size rule (from the old game's 4,065 line tile manager): no file owns more than one of streaming, building, physics and cleanup. A GDScript file over 600 lines or a TypeScript file over 800 lines fails a test in `game/tests/test_module_size.gd` and `tools/module_size.test.ts` (P1-006). Files already over the limit sit on a named exception list in the test, each with the task that splits or retires it. Each streamed system registers its own build and dispose functions with the streaming core.

## Core contracts

### Main loop and time (C1)

One engine physics frame is one sim tick of 1/60 s. `SimClock` (`game/core/sim_clock.gd`) emits `sim_tick(dt)` from `_physics_process`; every system that steps (vehicles, characters, AI, missions, cutscenes, dialogue) connects to it and never steps in its own `_physics_process`.
- Time scale sets `Engine.time_scale` and `Engine.physics_ticks_per_second` together, so the step stays 1/60 s of sim time at any scale (slow motion, the verify fast-forward).
- The hold stops `SimClock` and calls `PhysicsServer3D.set_active(false)`, only at the start of a physics frame (stopped in the middle of a tick it is 269 mm off, measured). Frames keep drawing while held. Resume is exact (0.0000 mm against a run never held).
- `--lockstep` sets `Engine.max_physics_steps_per_frame = 1`. Cameras follow on `_physics_process` with a higher `process_physics_priority`.
- Built in P1-006 from the bench version `game/bench/physics/bench_clock.gd`. `game/tests/test_sim_clock.gd` replays one input script (the car plus a rigid body) at scale 0.25, 1 and 4 and with holds (inside a tick, between frames): all end within 0.001 m (measured 0.0000000 m). It also fails any `_physics_process` outside `game/bench/` except the clock and `*camera.gd` files.

### Coordinates (binding, owner 2026-11-10)

East is +X, north is -Z, up is +Y, 1 unit = 1 metre. Compass heading 0 = north, PI/2 = east (`forward()` in `game/scripts/car_model.gd`). No mirroring anywhere: no negative scale on world groups, no axis flips in physics. A node faces -Z at rotation 0, so a vehicle node uses `rotation.y = -heading`. Tests: `game/tests/test_car.gd`, `test_scene.gd` (no node under `World` has a negative scale or a mirrored basis).

Projection (signed): WGS84 transverse Mercator (Kruger series) with the central meridian through the frame origin. `tools/geo/projection.ts` is the one implementation for the tooling (`geoToWorld(lat, lon, origin)`, `worldToGeo(x, z, origin)`, `projector(origin)`); `game/geo/projection.gd` is its GDScript port, checked against `harness/data/fixtures/projection_points.json` within 0.01 m. Scale error about 0.2 m at 25 km; round trip under 1 cm. Tests: `tools/geo/projection.test.ts`, `projection.fixture.test.ts`, `game/tests/test_projection.gd`; scenarios `drive_north`, `drive_turn_right`, `coords_north_marker`.

### World layout (signed 2026-11-11)

One seamless open city with no bare ground (decisions.md "One seamless open city, no gaps"). Data: `harness/data/districts.json`.
- **Blocks.** A block is one continuous piece of the map with one frame and one road graph. The centre block covers Kashmere Gate to Nizamuddin, Karol Bagh and the Central Ridge to the east bank with Laxmi Nagar, the Yamuna and its floodplain drawn as the real place. Its frame origin is India Gate (28.612894 N, 77.229446 E). Each far district (Mehrauli with Qutub, Vasant Kunj, the airport, Cyber City; Noida later) is its own block with its own frame origin.
- **Placement.** `offset = pivot.world + factor * geoToWorld(origin, pivot)`, pivot India Gate. The centre block has factor 1.0, so every real place in it sits at its real position. Far blocks have factor 0.5 (owner answer): Cyber City 9.5 km from India Gate on its real bearing. A real point lands at `offset + geoToWorld(lat, lon, block origin)`. Translation only: no rotation, scale or mirror.
- **Gates (rule R-STITCH, `tools/bake/layout/gate.ts`, run in every bake before the first step; tests `tools/bake/layout/layout.test.ts`).** The file follows the placement method and no key can carry a rotation, a scale or a mirror. Every block is placed by a translation only (north on -Z, east on +X, determinant +1, no scale). Every pair of the centre places (`harness/data/districts/places.json`, 24 today) keeps its real bearing within 0.5 degrees and its distance within 0.5% against the geodesic (measured: 0.023 degrees and 0.00002% at worst). Each far block's frame origin is on its real bearing from India Gate within 0.1 degree at 0.5 of its real distance within 0.5%. Placed outlines of different blocks never overlap and stay 250 m apart. The map box is under 16 km wide and no position is more than 8,192 m from the world origin, today and after the recentre. A centre place paired with a far place may be off by up to about 20 degrees; far places are exact as seen from India Gate.
- **Focus districts** are outlines inside a block where hand attention goes (hero roads, hand-drawn area profiles, inspector review). They are not cuts: streets run through them. Between them is real city from the same sources, with archetype profiles chosen by rule.
- **Corridors** to far blocks are authored connectors (`MAP_REPAIR.md` "Connector format") with generated city from the neighbouring profiles on both sides. A real road is never shortened inside the centre.
- **World origin** is fixed by where the pivot sits: India Gate at world (621.6, 467.2) today (the centre of the old layout C map box). The first bake that includes a far block (P8) runs the recentre step (`tools/bake/layout/recentre.ts`, written and tested in P1-008): one vector is subtracted from every stored position (the pivot, tiles, pins, mission anchors, connector points, saves). The vector is a whole number of 250 m tiles, so no tile is cut again, and it puts the origin on the centre of the smallest circle round the map. Measured with every planned block placed: map box 13.03 by 13.37 km; that circle has a radius of 7.98 km (Cyber City, Laxmi Nagar and Kashmere Gate set it); after the recentre the farthest position is 8.03 km out. The centre of the map box is not used: it would leave Cyber City 9.0 km out. Every record set carries the pivot position it was written with, so an old save is moved exactly once.
- **World grid.** One grid of 250 m tiles (`tools/bake/layout/grid.ts`): a tile id `<tileX>_<tileZ>` comes from world metres only, tile (0, 0) has its north-west corner on the world origin. The tile cutter, the overrides files, the `--tiles` option and the inspector all use it.
- **Far blocks** have checked frame origins (Qutub Minar, DLF Promenade, Terminal 3, DLF Cyber Hub, read from OpenStreetMap) and compact outlines in `harness/data/districts/<id>.geojson` (1.7 to 2.9 km2). A far block is true scale inside but sits at half its real distance, so it must stay small: Aerocity is left out of the airport block because it would land on the Vasant Kunj malls.
- **Height.** A block has one ground model and one height solve. A far block keeps its real ground with one height offset solved over all its joins.
- **Records.** Every tile, landmark, mission anchor and spawn point stores its block id and position; missions are written in world metres of the signed layout.
- **Stages.** Pilot: the pilot centre (Connaught Place with Jantar Mantar, India Gate, ITO with Pragati Maidan, Chandni Chowk with Red Fort, Paharganj with the station, GB Road and everything between, about 20 km2). First release: the rest of the centre block with Laxmi Nagar, then the far south with its corridors (about 68 km2 in all). Later: Noida, Shahdara, Akshardham.

Float precision (FP1): 32-bit floats, world origin at the centre of the smallest circle round the map (after the recentre step), vertices stored relative to their 250 m tile. Measured: no shimmer, jitter or vehicle drift at 7 km. A float keeps 0.49 mm steps up to 8,192 m and 0.98 mm beyond, so the reach limit of rule R-STITCH is 8,192 m. A map wider than 16 km or a position farther out than that is not allowed without a new measurement.

### Tile format (T1, `KTL1`)

Written by `tools/bake/tile/` (codec `codec.ts`, production writer `write.ts`, bake step `tiles` into `<stage data folder>/tiles/` with `index.json`: tiles, blocks, bytes, the bake hash, skipped tiles), read by the game's tile reader (`game/world/streaming/tile_reader.gd` since P1-019; the bench scenes keep `game/bench/tiles/tile_t1.gd`) and by the map inspector. Little endian:
- bytes 0 to 3 `KTL1`, u32 version, u32 header length, then a JSON header padded to 4 bytes, then the payload of float32 and uint32 arrays, each 4-byte aligned. The reader turns each array into a packed array in one call: no per-vertex script work.
- Header: `tile` (block id, x, z, size 250), `origin` (block metres of the tile's north-west corner at its lowest ground height; every vertex is relative to it), and arrays with their payload offsets: `meshes` (name, material, positions, normals, UVs, indices; one per material), `colliders` (chunks of about 500 triangles), `placements` (module id, MultiMesh transforms, custom data with tint and grime wear), and from the production bake `nav` (navmesh polygons), `lanes` (the lane graph for traffic and pursuit), `life` (seeded spawn points for people, vendors, animals and parked two-wheelers), `pins` (landmark and mission anchors).
- Production (P1-016): `lanes` holds the lane graph cut at the tile lines (pieces `<lane>:<k>` with `next`/`back`, one float32 point array); `pins` the named places with tile-relative positions; meshes may carry `uv` (lane UV) and `uv2` (border codes); `margin` is 250 m; `nav` and `life` are null and `placements` empty until P2 and P3. Every vertex is snapped to 1/1024 m in world metres before the tile origin (whole metres) is taken off, so stored numbers are exact float32 and a vertex two tiles share is the same point in both. Colliders: chunks of about 500 triangles, at most 600, from the drawn vertices of every solid material (not paint, water or ceilings), one building shell per chunk, the deck joint strips included. Building shells go whole to the tile of their centroid; one that would reach more than 200 m past it is cut into parts per tile.
- Rules: the version is checked and a wrong one fails loudly; a magnitude check on load rejects any vertex outside the tile plus a margin (the old game's silent coordinate faults); a tile has a byte budget (1.5 MB average, 4 MB worst). A bad tile never empties the world: it is reported and skipped.
- One world grid of 250 m tiles; tiles ignore district outlines. Overrides are filed per world tile.

### Streaming (ST1, TL1)

- Three rings: full detail to about 375 m, block shells to about 900 m, one far skyline mesh per 1 km cell always loaded. Tiles are picked by distance and heading.
- A WorkerThreadPool task reads and builds each tile (1.0 ms for a dense tile). The main thread attaches at most 1 ms of work per frame: meshes in one step, then collider chunks (at most 3 a frame, none in a mesh step frame).
- Each system (roads and ground, buildings, dressing, colliders, navmesh, lanes, life, landmarks) registers build and dispose functions with its own budget. Unload uses a hysteresis ring and a memory cap.
- Collider rule: Jolt builds a mesh shape on the main thread when the body enters the space, whatever thread made the shape (measured). Colliders arrive in chunks; a tile collider in one piece is a 17 ms frame.
- Gate: no frame over 33 ms while streaming at 200 km/h (measured in the first streaming task).

Built in P1-019 (`game/world/streaming/`, `game/world/systems/`, `game/world/world_stream.gd`, `game/geo/world_frame.gd`; tests `game/tests/test_streaming.gd`):
- **One job per file.** `stream_core.gd` owns the tile states (READING, ATTACHING, LIVE, DISPOSING) and the registry; `ring_plan.gd` chooses tiles (pure); `attach_queue.gd` times the main thread steps; `tile_reader.gd` reads a file; `tile_index.gd` reads the index; each system builds its own part. The core never reads, times or builds.
- **A system** is an object with `id`, `lane`, `exclusive`, `per_frame`, `budget_ms`, `prepare(tile)` (worker thread: resources only, no nodes; `{error}` refuses the tile), `attach(tile, part)` and `dispose(tile, part)` (main thread, one small step each call, true when done). Registered today, in this order: `ground_roads` (lane mesh), `buildings` (mesh), `colliders` (lane collider, 3 a frame), `lanes` (data).
- **Choice.** A tile is wanted when its square is within 375 m of the focus or of the lead point (2 s ahead on the heading, at most 150 m); tiles nearest the lead point load first. A loaded tile is kept to 500 m (hysteresis 125 m). Cap: 40 tiles and 96 MB of tile files; over it the farthest go first, and a wanted tile is never dropped for another wanted tile. At most 4 files are read at once. The far rings (shells to 900 m, the skyline per 1 km cell) are `register_ring(ring, system)` hooks with `ring_enter` and `ring_exit`; nothing registers before P2.
- **Attach.** Steps run in rank order while the time used plus 1.5 times the usual cost of such a step fits 1 ms; the first step of a frame always runs. A frame that attached a mesh attaches no collider chunk. Dispose steps run after attach steps, first when over the cap.
- **Burst.** `warp(pos)` (the first load, a teleport, later a respawn or a mission start under a fade) lifts the cap to 8 ms a frame and the 3 chunk limit until the ring round the focus is live. While playing the cap always holds.
- **Colliders** are PhysicsServer3D static bodies with no node (one per chunk, the shape made on the worker). Meshes are one MeshInstance3D per tile and system with a surface per material, so the style runner can restyle them by surface material.
- **Bad tiles.** A wrong version, an array outside the file, a mesh, lane point or pin outside the tile plus its margin, or a file that holds another tile: one line in `state().world.errors`, a `tile_bad` signal, never read again; the ring counts it as settled, so the world still loads and `ready` still comes.
- **Headless** runs read on the main thread: the dummy renderer's mesh storage is not thread safe (two worker threads making meshes end in "wrong RID" errors; 540 threaded reads with the real renderer raise none).
- **Leaving the scene.** The core unloads everything when it leaves the tree (it waits for running reads, frees the bodies). The core is the city's first child, so tile nodes have left the tree before it; a tile node that already left is queued, never freed in place (freeing it while the parent removes its children deleted it twice: an abort at quit, fixed in P1-019, regression test `test_leaving_the_scene_with_tiles_loaded`).
- **Measured** on the M2 Pro, full pilot tiles, stand-in look, Metal (2026-11-12): 60 s at 200 km/h from India Gate to the Red Fort (scenario `stream_200`): 7,199 frames, worst frame 10.4 ms, 0 over 33 ms, streaming work p99 0.65 ms a frame (worst 1.10), at most 3 chunks a frame, 58 tiles read and 56 unloaded, a tile reads and prepares in 2.0 ms on average (worst 4.7), 22 tiles held at most, 230 draw calls at most, 145 k triangles, 92 MB video memory. At 140 km/h (`stream_140`) the frame costs 1.7 ms p95 (frame cost with the GPU ballast), CPU 0.7 ms p95, 187 draw calls. A teleport (`stream_teleport`) answers in 75 to 150 ms with 14 or 15 tiles and 320 to 560 chunks attached; the collider is within 0.0001 m of the drawn surface. Five minutes round an 8.1 km lap (`stream_memory`, time scale 4): 293 tiles read, 288 unloaded, 30 held at most, process memory after lap 1 changes by -20 to +7 MB, engine memory by +1 MB, the object count back at the start is the same (1,949). Launch to ready 0.8 s on the pilot. The mesh buffers of a tile reach the GPU in one flush of up to 3.5 ms on the main thread (in the mesh step or at the draw); P2 splits it per surface if tiles grow.

### Rendering of the city (I3, LD1, OC2, TX1)

- Unique building shells, roads and ground are merged per tile and material. Repeated facade modules, props, trees, poles and parked vehicles are MultiMesh per module per 125 m cell.
- LOD by visibility ranges: modules to about 180 m, a merged block shell per cell from 180 to 700 m, the skyline beyond. Mesh LOD index buffers are made in the bake (meshoptimizer). Hero landmarks keep their own LOD chain and a far silhouette. The cross-fade between levels is measured in the first streaming task.
- Grime wear and tint travel in the MultiMesh custom data (the per-instance shader uniform has room for about 4,096 instances only).
- No occlusion culling by default (with LOD it saves 0.2 ms and costs 0.4). It stays a per-area switch to try again in the Old Delhi lanes.
- Textures: VRAM compressed with mipmaps, both import sets on (S3TC and BPTC for Windows and Intel Macs, ETC2 and ASTC for Apple Silicon). One Texture2DArray per area kit for tiling materials, one trim and decal atlas per kit. The UI and the grade LUT stay lossless.

### Vehicles (V2)

- Our own raycast vehicle on a Jolt `RigidBody3D`: suspension rays, a tyre grip model with grip per axle, steer lock by speed, yaw damping, handbrake. One model for the auto (3 wheels), scooter (2 wheels with a hidden stabiliser), car and bus. One tuning file per vehicle (`game/data/vehicles/<id>.tres`).
- Speeds (GAME.md): auto 65 km/h, car 140, fast car 180 to 200. The kept tune from the old game tops out at 106 km/h; the first driving phase retunes the gears to 140 (owner answer) and Anmol judges the feel at the playtest.
- Built in P1-020: `game/vehicles/` and `game/data/vehicles/car.tres` (0 to 100 km/h 11.1 s, top 140 km/h, 100 to 0 in 41.5 m, full lock radius 6.9 m at 37 km/h); probes `vehicle(cmd, opts)` in docs/GAME_HOOKS.md, scenarios `car_*` and `chase_cam_floor` in the course scene (`load('course')`).
- Colliders bridge deck joints (an open 4 cm joint drops a wheel ray, measured).
- Traffic follows lane centre lines (TR1). A traffic car becomes a physics vehicle only near the player or when hit, at most 16 at once.

### On foot and combat (F1, CB1)

- `CharacterBody3D` capsule with our own step-up for kerbs (0.15 m) and stairs (0.18 m risers). Speeds 1.6, 3.8 and 6.5 m/s (GAME.md).
- Built in P1-022: `game/characters/` (`on_foot.gd`, `foot_motor.gd`, `vault.gd`, `player_mode.gd`), `game/camera/on_foot_camera.gd`; probes `foot(cmd, opts)` in docs/GAME_HOOKS.md, scenarios `foot_*` and `enter_exit_vehicle` in the course scene. Measured numbers in docs/ARCHITECTURE.md "On foot (P1-022)".
- Hitscan bullets by ray against three hit zones per character (head, torso, limbs). Thrown items are short physics arcs. Ragdolls on `PhysicalBoneSimulator3D`, at most 8 at once; they sleep after about 2 s and settle into a pose.

### Characters, crowds and navigation (N1, AN2, AL1)

- Navmesh polygons come from the bake (footpaths, crossings, plazas, shared lanes), one region per tile joined at the edges. Ambient pedestrians follow the footpath graph; fighters and police on foot use the navmesh. A Recast bake in the game is only a fallback for odd places.
- Crowd: skinned with an AnimationTree within about 25 m (cap 40), baked vertex animation in a MultiMesh from 25 to 120 m, nobody beyond. 30 to 60 agents in the slice, 120 at release. Re-measure with the real rig.
- Animation: Quaternius Universal Animation Library 1 and 2 (CC0), retargeted to one humanoid profile. Missing moves (auto driver seat, lathi) are art requests with stand-ins. Built in P1-023 (docs/ARCHITECTURE.md "Humanoid (P1-023)"): Godot's SkeletonProfileHumanoid through the import bone map `game/characters/rig/ual_bone_map.tres`, so any later humanoid model imported with the same profile plays the same clips; art requests `model_anim_auto_seat`, `model_anim_scooter_ride`, `model_anim_vault`, `model_lead_bittu`, `model_lead_meera`, `model_lead_danny`.

### Story runtime (CS2, DG1, LIP2 then LIP1, FC2, SB1, SK1)

- **Cutscenes** are data files in `game/data/cutscenes/<id>.json`: shots (camera mark, lens, move, length), actor marks, animation clip names, lines by id, events. One `CutscenePlayer` runs them on the sim clock and plays library clips through AnimationPlayer. The verifier can seek to any time and check that every actor is in frame.
- **Dialogue** is our own line player for drive talk, phone, inner voice, radio and ambient lines. A line is data (id, speaker, channel, priority, text per language, voice file id, length) in `game/data/dialogue/`, written by the content writer. One queue per channel. A crash, a chase start or a higher priority line pauses drive talk, which resumes with a pickup line. Inner voice and radio duck under talk.
- **Mouths and faces.** In the slice and in all play: the jaw follows the loudness curve of the voice file, baked per line; with no voice file, a timed talk flap for as long as the subtitle shows. Big cutscenes get offline mouth shape timings (Rhubarb Lip Sync or similar, checked at first use) once voices exist. The three leads and the named cast get a small face set (jaw, blink, brows, smile, frown, 6 mouth shapes, about 12 blendshapes) from the first big cutscene on; the crowd keeps the jaw only.
- **Subtitles**: every line has a Hinglish text (Latin letters, as written) and an English text from the start, with speaker names and a colour per speaker. A Devanagari track can be added later as a third language. Godot translation tables (CSV).
- **Skip**: every cutscene declares its end state (actors, vehicles, camera, mission flags, clock). Skip jumps there through the same code as a normal ending, with a 0.3 s fade and a one-line recap. A checkpoint is saved when a cutscene starts. Each scene has a test: played to the end and skipped give the same state.

### Scenes and levels

`scenes/main.tscn` is the game scene. The city is not a scene: it streams in tiles. Missions are data plus scripts that place actors at anchors (block id plus world metres). Bench scenes load only with `--arch=<name>`; stand-in scenes with `--scene=<id>`.

### Input

InputMap actions in `project.godot`, all remappable; keyboard and mouse first, gamepad (Xbox layout) by the first release (GAME.md "Player verbs").

### Save

A JSON save per profile in `user://saves/` with a version number and a migration function per version: character states, money, mission flags, unlocked stages, the last checkpoint (block id, position, heading). Written by the save task of the first mission phase.

### Assets

Assets are referenced by id. The game reads `public/assets/manifest.json` (`{images, audio, models}`: id to path) and uses a procedural placeholder for any id with no file yet (colour, pattern, simple mesh, a beep). New ids are registered with `harness/bin/assets.mjs`; uploads go through the dashboard and `harness/bin/ingest.mjs`. Kit modules keep fixed ids, so baked placements never change when a stand-in module is replaced. Hero landmarks: up to 8 parts of up to 25,000 triangles, up to 6 materials, 3 LODs per part, one far silhouette under 2,000 triangles (ingest gets a hero rule).

### Audio

Godot audio buses: Master, Music, Dialogue, SFX, Ambience, UI. Dialogue ducks Music and Ambience. Placeholders: the four CC0 sounds kept from the old game (decisions.md), then requests through the dashboard.

### Debug hooks

`game/debug/` (debug server, logger, frame probe, perf stats, GPU ballast), added under `/root` by `GameArgs` only with the user arg `--debug`. TCP JSON lines on 127.0.0.1, port `--debug-port` (default `kit.config.json` `godot.debugPort`, 47181). Contract: docs/GAME_HOOKS.md "Godot transport". Client `harness/bin/godotclient.mjs`, smoke `harness/bin/godotsmoke.mjs`. `game/debug/` and `game/core/` are shared paths.

## World pipeline (offline bake)

Full design in `MAP_REPAIR.md` (sources, rules, overrides, roads, ground, inspector) and `DELHI_WORLD.md` (landmarks, area profiles). The order of one bake:

```
data/ sources (pinned) -> blocks and focus outlines (districts.json) -> ingest and normalise (one graph per block)
-> pair and classify -> rules (detect) -> auto-repair (logged) -> overrides -> lane model with the fit repairs
-> corridors (connectors) -> elevation solver -> junctions, kerbs, decks, supports -> buildings off the road faces
-> ground cut to road edges
-> landmark registry and placement -> area profiles and the generator -> LOD and colliders -> 250 m KTL1 tiles
-> health report, issues for the inspector
```

- Sources: OSM roads only (ODbL, credit "© OpenStreetMap contributors"); Overture buildings (ODbL; landmarks join on OSM directly because Overture drops the wikidata tag); GEDTM30 smoothed over 60 m for the ground (CC BY 4.0), filtered Copernicus GLO-30 as the fallback; Wikidata (CC0) for landmarks. FABDEM is a bench yardstick only and never shipped. The repaired map data is published openly, as ODbL asks.
- Building heights come from OSM tags where present (4 to 19% of buildings) and otherwise from the area profile's floor counts. Landmarks get their real heights by hand (owner answer).
- Lanes come from class defaults, hero road specs and whole-street inference (the `lanes` tag is on 1 to 8% of ways). Left-hand traffic.
- The bake is deterministic: the same sources, overrides and seeds give the same tiles. Every random pick is seeded from the world tile and a parcel id.
- Bake time budget: under 30 minutes for the first release, under 60 s after a change in one tile. Measured on the pilot centre (P1-017, M2 Pro): the whole bake 160 s (417 tiles, 358 MB), a one tile rebake after an override 52 s (`npm run bake -- pilot --tiles <x_z> --offline`: the same steps with one build each, no pictures, the lane feedback started from the conflicts the last whole bake wrote to `<stage data folder>/lane_conflicts.json`; on an unchanged map it writes the whole bake's bytes).
- Tiles go to the stage's `tiles` folder in `districts.json`, default `game/world/tiles/` (gitignored, never committed), with `index.json` whose `bakeHash` covers every tile in the folder.
- The six gate counts (open ports, floating ends, unjoined ends, overlapping road faces, lane breaks, tapers out of limits) are 0 or each item is explained: by the lane model itself or by an entry of `harness/data/gate_explanations.json` naming its owner task. An item no entry explains stops the bake before tiles (GATES-01); `health.json` `gateReport` lists every item, its explanation and the known findings outside the gates.
- The bake stops before writing tiles when an invariant fails (an open port, a floating end or overlapping road faces that no entry explains, a lane break, a mirror, a centre pair over 0.5 degrees). `tools/bake/report/pilot_stops.test.mjs` proves it with a mirrored block (R-STITCH-01) and a broken lane (LANES-01).
- The ground (bake step `terrain`, `tools/bake/terrain/`, P1-015) is one constrained Delaunay triangulation of the stage, our own: the free edges of the road faces the ground meets, footprints, water, open land, the outline and the 250 m tile lines are its edges, a staggered 12.5 m lattice gives the relief inside blocks. A triangle is road (not drawn), a footprint pad, water over a bed, open land or ground. Heights are the road's own on a road edge at grade, else the ground model plus what the road edges within 30 m spread. Limits checked by the bake (`perf_budgets.json` `world.ground`): road to ground gap 0.02 m, needles under 2 percent, seams equal within 0.0001 m, areas within 0.1 percent of the outline, one build under 120 s. Collider chunks leave out triangles under a square millimetre.

## Map inspector

A small web page served on the dashboard port (`tools/inspector/`, three.js as a harness dev dependency, no outside tiles or services). It reads the baked tiles and `issues.json`, shows a north-up 3D view, the issue queue sorted by impact with proposals as preview lines, and writes the tile's override file and an inbox entry when Anmol picks or types a note. "Open in game" teleports the running game there through the debug server. Built in four steps, each one task: issues; lanes; hero roads and layout; areas and landmarks. It is the first task after Phase 0.

Since P1-030 the page is mainly a viewer: the bake settles every basic issue itself and the top-view judge pass (`node tools/inspector/judge.mjs sheets`, then `apply <decisions.json>`; MAP_REPAIR.md "What the bake settles itself") decides what the rules cannot, so the queue holds only genuine questions (at most about 50 for the pilot). A card of an open issue shows the plain question and its options; a settled one says who settled it (a rule, the policy table, the top view) and why.

## Render pipeline

Signed look: stylised B (`stylised_b`), signed 2026-11-11 (STYLE_BIBLE.md). Renderer: Godot 4.7.2 Forward+ (Metal for play on the Mac, Vulkan through MoltenVK when GPU times are measured), 1920x1080 at render scale 1.0, stretched to the display with a bilinear scale (MetalFX spatial as a Mac setting, 0.5 ms more). Linear colour, Filmic tonemap, no TAA by default (a settings switch, 1.23 ms), no SDFGI, no SSR, no volumetric fog. Lighting has no real-time GI: sun, sky ambient, SSAO, SSIL low, reflection probes at hero places, and vertex AO baked into the tiles.

How the look is built (`game/render/`, all procedural, no art files yet):
- `style_runner.gd` restyles every scene from outside as it loads (SceneTree `node_added`, connected by the `GameArgs` autoload before the main scene): a WorldEnvironment gets the style's Environment, the DirectionalLight3D becomes the sun, MeshInstance3D materials are swapped by their stand-in key (`matte`, `road`, `satin`, ...), Label3D nodes go to the style's sign decoration. Scenes do not know about it. GameArgs makes it at boot with `stylised_b` when no `--style` is given (P1-002); `--style=none` makes none (the flat stand-in look, fast verification), `--arch` benches default to none. Args: `--style=<id>`, `--light=dawn|afternoon|golden|night` or `--time=<0..24>` (both pin the day clock), `--style-off=<tokens>` (cost measuring: volfog, shimmer, dressing, lights, textures, decals, ssao, ssil, glow, sunshadow, nopcss, noblend, split2, near80, dshadow, ssq, p34).
- `styles/stylised_b.gd` (extends `stylised_grime.gd`, which extends `stylised.gd`): environment and post, the surface shader layer (`shaders/surface_b.gdshader`: six generated tiling layers in a Texture2DArray plus the wear mask), the Delhi detail dressing laid from anchors the stand-in kit records (`Sink.anchor` in `scenes/standin/geo.gd`), per-area haze (`shaders/haze_b.gdshader`), the heat shimmer pass (`shaders/shimmer.gdshader`), decals, dust motes and the night lights. `styles/stylised_b.tres` holds the look numbers (`style_preset.gd`), `styles/light_<id>.tres` the light presets (`light_preset.gd`), `day_cycle.gd` the day curve.
- Day clock (`game/core/day_clock.gd`, autoload `DayClock`, P1-002): the game time of day, on the sim clock (it steps on `SimClock.sim_tick`, so time scale and hold reach it), start 15:00, rate 1/120 game hours per sim second (one game hour in two minutes, a 48 minute day). `--time` and `--light` pin it; the debug hook `timeOfDay` reads, sets and pins it. The style runner builds the light from the day curve at the clock's hour when a scene loads (a move of a game minute or more rebuilds the style); inside a loaded scene the light stays as built (live relighting, with the night lights, is a later task).
- Day curve (`--time`): keys night 0 to 4.6 h, dawn 6.3, afternoon 15.0, golden 17.75, dusk 19.0, night from 20.5 h; every field blends (sun azimuth the short way round); the sun swaps to a faint moon at dusk and before dawn.
- In the streamed city the look reads the area wear from the tile placements' custom data, not from node metadata.

What each light sets (Environment and lights; numbers in STYLE_BIBLE.md "Lighting presets"):

| Setting | dawn | afternoon | golden | night |
|---|---|---|---|---|
| Sun | 7 degrees, pink, energy 1.9, ESE | 52 degrees, warm white, 2.3, SW | 12 degrees, orange, 2.6, WNW | moon, cool, 0.22 |
| Sky and haze | peach horizon, thick haze (fog 0.0042), contrast plus 0.08 | pale blue, dusty haze (0.0026) | grey-warm top, orange horizon and fog (0.0032) | dark blue, warm horizon glow, brown haze (0.0034) |
| Exposure, ambient | 1.15, 0.45 | 0.85, 0.5 | 1.0, 0.4 | 1.45, 0.32 plus a cool moonlit fill |
| Lights on | lamps half on, 12% windows | none | bulbs start to bloom, 8% windows | sodium lamps, one shop in three, headlights, 55% windows, neon |
| Extras | none | heat shimmer pass (1 to 2 ms) | strongest bloom, no shimmer | shadow distance 160 m |

Post stack in order: SSAO (low), SSIL (low), sun-lit exponential fog with the depth haze box, Filmic tonemap and exposure, glow (softlight, threshold 1.0), adjustment (contrast 1.08, saturation 1.05), 3D LUT (33 cubed, per light split tone), heat shimmer (afternoon only). Sun shadows: 4 splits to 240 m, filtered with blur 1.6, no PCSS, no split blending (those two cost 2.8 ms). Night lamps and the heat shimmer never run together.

What the lean path turns off (`_lean()`, P0-037; the realistic reference look keeps them): PCSS, split blending, the FogVolume and volumetric fog, full-quality SSAO and SSIL, real lights on every shop, shadows from small dressing, decals beyond 55 m.

Quality presets: one preset (default) for now. A low preset (Forward+ with SSAO, SSIL, decals and dressing cut) is a later performance task.

The `--style` switches after the sign-off (decisions.md "Style bible and signed budgets"): `stylised_b` becomes the default look in the first task of the first phase; `stylised`, `stylised_grime` and `realistic` stay behind `--style=` as reference sets until the first phase gate, then `stylised` and `stylised_grime` are folded into `stylised_b.gd` and removed; `realistic` stays as a documented reference. `--style=none` keeps the flat stand-in look for fast verification.

## Performance budgets

Signed in `harness/verify/perf_budgets.json`: the look and frame budgets with the style (2026-11-11), the per-system and city budgets with the architecture (2026-11-11). Minimum machine: Apple M2 Pro at 60 fps steady, about 1080p.

Frame and scenes:

| Budget | Look test scenes | Streamed city scenes |
|---|---|---|
| Frame time p95, larger of CPU and GPU | warn 10.0 ms, fail 12.0 ms | the same |
| Average fps floor | 55 | 55 |
| Draw calls | warn 600, fail 1,000 | warn 2,500, fail 3,500 (owner answer) |
| Triangles with shadow passes | warn 6 M, fail 9 M | the same |
| Video memory | warn 1,200 MB, fail 2,000 MB | the same |
| Load, launch to playing | warn 3 s, fail 10 s | the same |

A scenario (`scene: "city"`) or a lookproof run (`--scene-kind city`) names its scene kind and `perfbudget.mjs` takes the draw call, triangle and video memory budgets from perf_budgets.json `scenes.<kind>` (`look` is the default); no copy of the block in a scenario. Frame time is the real guard.

GPU per frame (each column has 10 ms; GPU plus the gameplay CPU subtotal stays under 16.6 ms):

| System | Budget ms | Measured |
|---|---|---|
| Look stack (sky, shadows, SSAO, SSIL low, glow, haze, grade) | 3.6 | 3.55 |
| City: roads and ground 1.0, generated buildings 2.0, landmarks 0.5 | 3.5 | 3.51 in the 2 km bench city |
| People (120 at release) | 0.6 | 0.88 for 300 on a light rig |
| Vehicles | 0.4 | estimate |
| Dressing, decals, signs, grime | 0.5 | decals about 0.5 |
| Night lamps or heat shimmer, never both | 0.8 | about 16 real lamps in view |
| HUD and subtitles | 0.1 | estimate |
| Stretch to the display | 0.5 | 0.43 to 0.51 |
| Total | 10.0 | 7.06 in the bench city |

CPU main thread per frame:

| System | Budget ms | Measured |
|---|---|---|
| Physics step (Jolt) | 1.0 | 0.74 p95 |
| Vehicles, up to 16 physics cars | 0.6 | 0.035 each |
| Traffic and pedestrian thinking | 1.0 | 0.80 p95 for 230 agents in turns |
| On-foot physics characters, up to 8 | 0.3 | 0.032 each |
| Combat rays and up to 8 ragdolls | 0.6 | 0.03 rays, 0.06 per ragdoll |
| Animation | 1.0 | 0.32 for 300 on a light rig |
| Streaming attach (cap) | 1.0 | 0.33 p95 per collider chunk |
| Missions, HUD, audio, cutscenes, dialogue | 0.4 | estimate |
| Gameplay subtotal | 5.9 | |
| Render culling and draw lists | 2.0 | 1.2 at 1,609 draw calls |
| Total | 7.9 | slack 2.1 to the warn line |

Counts, memory and the bake: kit textures 60 MB per kit, mesh buffers 150 MB, process memory warn 4 GB, tile file 1.5 MB average and 4 MB worst, tile read under 10 ms, collider chunk about 500 triangles and 0.5 ms worst, first release map data under 3 GB, bake under 30 minutes, gate counts 0 or explained, road to ground gap 0.02 m, collider to drawn surface 0.05 m, landmark position hero 5 m, signature 10 m, marker 15 m. All in perf_budgets.json blocks `systems`, `world`, `streaming` and `bake`.

How they are measured: `debug.perf` windows in perf scenarios and `lookproof.mjs --set <name> --perf` (3 s window, sim held), judged by `perfbudget.mjs` (p95 of the larger of CPU and GPU). The Metal driver reports no GPU time, so GPU numbers use `HARNESS_GODOT_ARGS="--rendering-driver vulkan --disable-vsync"` and the GPU ballast (`harness/bin/ballast.mjs`). Judge on a calm machine (check `ps -r`); a fail is rerun once; the first view after a shader change is not judged. A task that adds work to a system re-measures that system and says so when it is over its line, even when the frame is green. The worst case (night, a crowded bazaar lane) is re-measured by every look task.

Cost of look features (Vulkan, M2 Pro, bazaar): sun PCSS 1.8 ms, shadow split blending 1 ms, SSIL about 1.5 ms (low quality kept), heat shimmer 1 to 2 ms, 40 omni lights in a narrow lane about 2 ms, per-area volumetric fog 0.3 to 1.3 ms, decals about 0.5 ms, glow and SSAO under the 0.5 ms noise. A look feature that adds more than 0.5 ms says so in its task and is measured with `--style-off=<token>`.

## Verify harness and shipping

- Verify runs the Godot game through the driver (`godotdriver.mjs`), the debug server and the scenario shim (P0-025 to P0-027). Bench scenes load with `--arch=<name>`, run by `harness/bench/arch.mjs`, which writes `harness/reports/arch/<name>.json`. A tiny committed test block (`game/world/test_tiles/`, 9 tiles of the pilot: the ITO flyover with its junction and part of Connaught Place, 9.8 MB, `--tiles=test`) keeps scenario boot under 3 s (the streamer loads the four ITO tiles round the start; launch to ready about 0.8 s); rebuild it with `npm run bake -- pilot --tiles 8_-6,9_-6,8_-5,9_-5,-4_-7,-3_-7,-4_-8,-3_-8,-3_-6 --out game/world/test_tiles --offline` (the check tiles of a partial bake need their 8 neighbours or TILE-03 stops it, so the set leaves out the Connaught Place check tile -2_-7). The full tile set is gitignored: a whole bake writes its `bakeHash` into the committed `game/world/tiles.hash`, and `harness/bin/snapshot.mjs` and `playcopy.mjs` copy `game/world/tiles/` from the main checkout (an APFS clone) only when it carries the hash the commit expects, else they stop with `rebake: npm run bake -- pilot` (`harness/bin/tileset.mjs`). The tree hash of `freshreport.mjs` covers `tiles.hash` and the test block, never the full tiles (they are ignored). Perf runs use Vulkan with vsync off and the GPU ballast.
- Mac: ad hoc signed universal app in a zip for tests. Developer ID signing and notarisation wait for Anmol's decision, asked again before release.
- Windows: exported from this Mac as an exe plus data packs, unsigned for tests, one data pack per map stage loaded at start (`ProjectSettings.load_resource_pack`), so later districts ship as an added pack. Tested on Anmol's PC and a friend's from the first playable.

## Movement and camera

Tuning numbers live in GAME.md "Movement and camera feel" and the vehicle tuning files. Measured by feel probe scenarios with sim-timed scripts and frame sequences.

## Audio standard

Mono sources positioned in 3D for vehicles, horns, people and weapons; stereo beds for ambience per area profile (`sound.bed`). Loudness and mixing rules are set by the first audio task.

## Known limits and debt

- Everything in the playable scene is still a stand-in: flat ground, one road strip, a kinematic box car, no world data, no physics, no audio. The first phase replaces it with this design.
- The physics bench plan's `engine_default` row (`harness/bench/physics.plan.mjs`) now runs on Jolt, since the project names it (P1-006); its P0-017 reading (DEFAULT is GodotPhysics3D) stays in the archive.
- The tile reader, lane model and generator exist only as bench prototypes (`game/bench/`, `tools/bake/roads/`). The production modules are listed in `docs/ARCHITECTURE.md` "Target module map". The island stitch prototype is retired (P1-008): its placer, transform check, geodesic, tile cutter, map edge ports and connector code moved into `tools/bake/layout/`, `tools/bake/tileset.ts` and `tools/bake/connectors/`; its bench driver, plan and Godot scene are removed, so `node harness/bench/arch.mjs stitch` no longer exists. Its measured results stay in `harness/reports/arch/stitch.json` and decisions_archive.md "Map stitch results (P0-029)".
- The three authored connectors in `harness/data/connectors/` are bench only (placed for the island layout); they stay as data and as test input for the connector format.
- The planned map is at the edge of the float limit: the farthest position is 8.03 km from the world origin after the recentre, against a limit of 8,192 m, and the centre block's own outline is not drawn yet (only the pilot outline, the focus outlines and place origins stand in for it). Before the far blocks are baked (P8), measure FP1 again at 9 to 10 km or tighten the layout.
- The inspector reads the production `issues.json` (x, z and every preview point in world metres) and files its picks by the world tile of the issue (`tools/inspector/lib.ts` `worldTile`, a copy of the grid rule held in step by `grid.test.ts`). The sample overrides sit in `harness/data/overrides/<tileX>_<tileZ>.json` since P1-011.
- Not measured yet: the LOD cross-fade at speed, the worst frame while streaming at 200 km/h, a real CC0 character rig, the navmesh build, the bake of a whole block.
