# Architecture options

Written by the planner in Phase 0 (mode ARCH_DISCOVERY, task P0-010, 2026-11-10). Draft 1: before the benches. Nothing here is decided until Anmol signs off one option per decision with `task.mjs archsignoff "<his words>"`. The benches (P0-016 to P0-019 and P0-029) replace the estimates with measured numbers; P0-020 then updates this file and marks every estimate that was wrong.

Machine: Apple M2 Pro MacBook Pro (12 CPU cores, 19 core GPU, 16 GB unified memory), macOS, Godot 4.7.2.stable standard build (single precision, no .NET), Forward+ renderer on the Metal driver. GPU times are measured on Vulkan through MoltenVK with vsync off, because Metal reports no GPU time. Test size 1920 x 1080, render scale 1.0.

Style it must serve: look B, stylised realistic, rich and warm, with Old Delhi grime (B+D). Fidelity target Watch Dogs 2. Leading pick, style sign-off pending (`STYLE_OPTIONS.md`).

Game it must serve: Kalesh, signed design in `GAME.md`. Three playable lives, driving and on foot anywhere, fists and guns, a wanted level, crowds, a compressed Delhi plus NCR built from real districts (layout C in stages, pilot about 7.2 km2, an estimate).

Linked design docs, refined in this task:
- [`MAP_REPAIR.md`](MAP_REPAIR.md): sources with licences, the bake pipeline with district selection and stitching, the rule engine, the repair log, overrides, the elevation solver, the lane model, hero roads, the map inspector, verification, the pilot.
- [`DELHI_WORLD.md`](DELHI_WORLD.md): the composite map (section 0), the landmark registry (section 1), area profiles (section 2), and the pipeline choices for both (section 10).
- `SALVAGE_AUDIT.md` section 8 ("What Dilli Darshan must do differently"): the rules every option below is checked against.

## How to read the tables

- A cell that starts with **Est:** holds only estimates. A measured number says **measured** and names its file. Sizes that define an option (a 250 m tile) are the option itself, not a measurement.
- Complexity is an estimate in builder tasks after the base exists: S under 2, M 2 to 3, L 3 to 5, XL more than 5.
- Every option has an id (R1, P2 ...). The recommendation and the sign-off quote use the ids.
- The Bench column names the task and the report file that will replace the estimate. "none" means the choice is made on reasoning, not numbers.
- **Rec** in the Option cell marks the planner's recommendation before the benches. It can change when the numbers come in.

## Summary for Anmol (the choices that matter most)

Numbers here repeat the estimates in the tables below.

1. **Renderer:** Forward+ only, sun and sky light with no real-time bounce light, soft shadows, SSAO, glow, warm grade. It keeps the day cycle and streams well. Bounce light (SDFGI) is tested as a "high" switch.
2. **Physics:** Jolt (built into Godot). Our own raycast vehicle on a physics body for the player and police cars, so the auto, scooter and car each get a real tune. Traffic runs on rails along the lanes and becomes a physics car only near you.
3. **Code:** GDScript everywhere. C++ only if a bench shows a hot loop that GDScript cannot hold.
4. **Map bake:** an offline Node and TypeScript tool (`tools/bake/`). It reads the sources, repairs them, builds lanes, junctions, ground, buildings and colliders, and writes small binary tiles. The game and the map inspector read the same tiles.
5. **Coordinates:** every district is projected around its own centre, then moved by a fixed offset. No rotation, no mirror. The whole map is about 10 km wide (estimate), so plain 32-bit floats are enough.
6. **Roads:** a lane-level model like the one road simulators use: a reference line plus lane sections with widths, tapers and gores, and junctions as their own objects. Hero roads (CP circles, Janpath, Lutyens, garden edges) get a checked spec file each.
7. **Ground:** in the city the ground is cut to fit the road edges exactly, so roads cannot float or sink. A plain height grid is used only for open land and the far backdrop.
8. **Map inspector:** a web page on the dashboard (as you asked), reading the baked tiles, with an "open in game" button that jumps the game to the same spot.
9. **Ground height data:** FABDEM is non-commercial, so it is out for anything we ship. The bench compares two open sources (GEDTM30 and Copernicus with our own ground filter).
10. **Crowds:** real skinned characters near the camera, a cheap baked-animation crowd further away.
11. **Packaging:** unsigned test builds now. Signing for Mac needs your Apple Developer account at release (question below).

## What is known before the benches

Measured in P0-009 (`harness/look_proof/baseline_vulkan/perf.json`, `harness/look_proof/baseline/perf.json`, summary in `harness/verify/perf_budgets.json`): the untextured stand-in street, landmarks and area kits, 9 views. GPU p95 1.5 to 3.2 ms over two Vulkan runs, CPU p95 under 0.4 ms, 84 to 175 draw calls, 0.79 to 1.95 M triangles drawn with shadow passes, 192 MB video memory in the busiest view, load 0.56 to 0.82 s. This is the floor, not the game: no textures, post effects, crowds or streaming yet.

Measured on the pinned engine in this task (a headless read of ClassDB and ProjectSettings, 2026-11-10):
- The build is single precision (`OS.has_feature("double")` is false).
- Physics engines offered: DEFAULT, Jolt Physics, GodotPhysics3D, Dummy. The project is on DEFAULT. Jolt has been the default for new 3D projects since Godot 4.6 (press coverage of 4.6); the bench confirms what DEFAULT resolves to here.
- Rendering methods: forward_plus, mobile, gl_compatibility. Drivers: Metal or Vulkan on macOS, Vulkan or D3D12 on Windows.
- Upscalers: bilinear, FSR 1.0, FSR 2.2, and MetalFX spatial and temporal in the viewport API.
- `PhysicsServer3D` has `set_active` but no manual space step, so game code cannot step physics by hand. This matters for the sim clock (decision C).
- Present: MultiMesh, visibility ranges on GeometryInstance3D, OccluderInstance3D with array, box and polygon occluders, LightmapGI, VoxelGI, NavigationServer3D with async baking and async map updates, PhysicalBoneSimulator3D, RetargetModifier3D, the IK modifiers, ResourceLoader threaded loads, WorkerThreadPool, GLTFDocument, `Image.load_ktx_from_buffer`, mesh LODs through `ArrayMesh.add_surface_from_arrays`.
- Absent: any built-in terrain, world partition, tile streaming or HLOD builder. We build those.

Toolchain on this Mac: Node 22.22, Python 3.14 (Homebrew), clang, Blender, ffmpeg, the osmium command line tool, Xcode (beta). Not present: scons, cmake, cargo, GDAL. 144 GB of free disk.

Map size (estimates from `DELHI_WORLD.md` 0.3, layout C): map box 10.1 x 8.9 km, detailed bake 31.7 km2, about 510 tiles at 250 m. Pilot about 7.2 km2, about 115 tiles.

Top speeds (decisions.md "Speeds and map size"): auto 65 km/h, car 140, fast car 180 to 200. At 200 km/h a 250 m tile passes in 4.5 s (computed).

## Decisions

### 1. Rendering

| Decision | Option | Perf on this machine | Quality | Complexity | Risk | Tooling, licence, size | Fit | Bench |
|---|---|---|---|---|---|---|---|---|
| Renderer | **R1 Forward+ (Rec)** | Stand-in: GPU p95 1.5 to 3.2 ms, measured (baseline_vulkan). Est: 9 to 15 ms with look B+D in the worst view | Full feature set: SSAO, SSIL, glow, decals, fog, TAA, FSR 2.2, clustered lights for night signs | S | Heavy post on weaker player GPUs | Built in | Matches look B+D and the night scenes | P0-016, render.json |
| Renderer | R2 Mobile | Est: 20 to 35% less GPU time in the same scene | No SSAO, SSIL, SDFGI, TAA or FSR 2.2 (as I recall the docs; the bench confirms). Light and decal limits per mesh | S | Two render paths to keep looking the same | Built in | Loses the depth cues look B needs in galis | P0-016 (if time), render.json |
| Renderer | R3 Compatibility (OpenGL) | Est: similar to Mobile, fewer features | Lowest | S | Only useful for a later web demo | Built in | Not for desktop | none |
| Graphics driver | **G1 engine defaults: Metal on Mac, Vulkan on Windows (Rec)** | Metal gives no GPU timer, measured (P0-009). Est: Metal is equal or faster than MoltenVK | Same picture | S | D3D12 may suit some Windows laptops better | Built in | Perf runs use Vulkan on Mac for GPU times | P0-016, render.json |
| Graphics driver | G2 Vulkan on both | Stand-in on MoltenVK: measured above | Same | S | A translation layer on Mac for players | Built in | Only for measuring | P0-016 |
| Graphics driver | G3 Metal on Mac, D3D12 on Windows | Est: same as G1 on Mac | Same | S | Cannot be tested here without a Windows PC | Built in | Decide at the first Windows test | none |
| Lighting at city scale | **L1 no real-time GI: sun, sky ambient, SSAO, reflection probes at hero places, vertex AO baked into the tiles (Rec)** | Est: SSAO 0.8 ms, probes 0.2 ms, vertex AO 0 ms | Reads well outdoors. Shaded lanes can look flat without the baked AO and an ambient tint per area | M | Flat interiors (few interiors in scope) | Built in; AO computed in the bake | Works with the day cycle and streaming. Fits B | P0-016, render.json |
| Lighting at city scale | L2 SDFGI | Est: 3 to 5 ms GPU at 1080p | Real bounce and sky occlusion, moves with the sun | S to switch on, M to tune | Cascades lag at 140 km/h, light leaks through thin walls, flicker while tiles stream | Built in | Possible "high" preset if the bench shows no lag | P0-016, render.json |
| Lighting at city scale | L3 VoxelGI in zones | Est: 1 to 2 ms inside a zone | Good in a room | M per zone | Baked per zone, not for a streamed city | Built in, baked in the editor | Only for the few interiors (police station, dhaba), later | P0-016 (if time) |
| Lighting at city scale | L4 baked lightmaps (LightmapGI) | Est: near 0 ms at run time; bake minutes per block; 2 to 8 MB per 250 m tile | Best static light | XL | The sun cannot move, so no day cycle; every mesh needs a second UV set; bakes need a GPU window | Built in, baked in the editor | Conflicts with the day and night cycle in the capability list | P0-016 (if time): bake time and size of one block |
| Anti-aliasing and upscaling | **A1 native resolution with TAA (Rec for this Mac)** | Est: 0.5 to 1 ms | Calms wires, signs and railings, which shimmer without a temporal filter | S | Ghosting behind fast cars | Built in | The city is full of thin lines | P0-016, render.json |
| Anti-aliasing and upscaling | **A2 upscaled preset: MetalFX temporal on Mac, FSR 2.2 on Windows, at 0.67 scale (Rec for the low preset)** | Est: saves 30 to 45% of GPU time, costs 1 to 1.5 ms | Slightly soft, good in motion | S | The headless read of the project setting did not list MetalFX, though the viewport API has it (measured); the bench checks it on the Metal driver and sets it from code if needed | Built in | The headroom for weaker GPUs | P0-016, render.json |
| Anti-aliasing and upscaling | A3 MSAA 4x, no temporal filter | Est: 1 to 2 ms | Sharp edges, shader shimmer stays | S | Costly with dense geometry | Built in | Weak on wires and decals | P0-016 (if time) |

### 2. Physics and movement

| Decision | Option | Perf on this machine | Quality | Complexity | Risk | Tooling, licence, size | Fit | Bench |
|---|---|---|---|---|---|---|---|---|
| Physics engine | **P1 Jolt (Rec)** | Est: step under 1 ms for 200 static and 30 dynamic bodies | Stable stacking and ragdolls, clean contacts on triangle meshes | S | A few Godot physics features differ; found in the bench | Built in (MIT), no size added | Chases, ramming, ragdolls | P0-017, physics.json |
| Physics engine | P2 Godot Physics | Est: 2 to 4 times slower with many bodies | Known ghost bumps on triangle seams, weaker ragdolls | S | Wheels and feet catching on seams | Built in | Worse for vehicles on mesh roads | P0-017, physics.json |
| Sim clock and physics stepping | **C1 one engine physics frame is one sim tick (Rec)**: time scale sets `Engine.time_scale` and the ticks per second together so the step stays 1/60 s; the hold stops SimClock and calls `PhysicsServer3D.set_active(false)` | Est: no cost | Physics bodies, vehicles and game systems share one clock, so slow motion and the verify hold reach everything | M (rework of SimClock) | The trick must be proven: same result at scale 0.25, 1 and 4, and a body stops within one tick of a hold | Engine API only | Needed for the slow-motion moment and for exact replays | P0-017, physics.json (clock section) |
| Sim clock and physics stepping | C2 keep the SimClock accumulator, physics runs free | Est: no cost | Sim ticks and physics steps can drift by one tick at other time scales | S | Replays differ run to run | none | Breaks the determinism rule | P0-017 |
| Sim clock and physics stepping | C3 gameplay is kinematic and only queries physics; engine physics is cosmetic | Est: no cost | Exact holds and replays for the player; ramming and pile-ups are faked | L | Fights the physics the game wants | none | Too limiting for chases | none |
| Vehicle | V1 VehicleBody3D | Est: under 0.05 ms per car | Built-in raycast vehicle from the same family as the old Rapier controller, so the kept tune maps almost 1 to 1. Known as floaty, few arcade aids | S | Little control over grip curves; three and two wheelers are awkward | Built in | A baseline to compare against | P0-017, physics.json |
| Vehicle | **V2 our own raycast vehicle on a Jolt rigid body (Rec)**: suspension rays, a tyre grip model, steer lock by speed, yaw damping, handbrake, per-vehicle tuning files | Est: 0.05 to 0.15 ms per car in GDScript, used for the player and up to 10 pursuit cars | Arcade feel we fully control; one model for auto (3 wheels), scooter (2 with a hidden stabiliser), car and bus | L | Tuning time; must stay stable on kerbs and flyover joints | GDScript; one tuning file per vehicle | "Arcade, forgiving, cars take a beating" | P0-017, physics.json |
| Vehicle | V3 kinematic arcade car (the scaffold model plus ground snapping) | Est: under 0.02 ms per car | Most predictable; collisions and ramming are faked | M | PIT moves, pile-ups and damage look wrong | GDScript | Fine for traffic on rails, not for the player | none |
| On foot | **F1 CharacterBody3D capsule with our own step-up for kerbs and stairs (Rec)** | Est: under 0.05 ms per character | Tight control, exact speeds from GAME.md | M | Godot has no built-in stair step; ours needs tests on kerbs, stairs and ramps | Built in | Third person on foot anywhere | P0-017, physics.json |
| On foot | F2 RigidBody3D capsule driven by forces | Est: similar | Natural pushing in crowds, sloppy control | M | Slides on slopes, hard to hit exact speeds | Built in | Worse for combat control | none |
| Colliders per tile | K1 one triangle mesh of everything in the tile | Est: 10 to 40 ms build on a thread, 1 to 3 MB per 250 m tile | Exact match with what is drawn | S | Facade detail in the collider wastes memory and snags bullets | Jolt mesh shape | Simple, heavy | P0-017, physics.json |
| Colliders per tile | K2 HeightMapShape3D ground, road meshes, boxes for buildings | Est: 3 to 10 ms, under 1 MB | Fast queries; needs a grid ground | M | The grid and the drawn ground can disagree (the old game's fault, audit 5.5) | Built in | Only with terrain option TF2 | P0-017 (if time) |
| Colliders per tile | **K3 triangle mesh of every surface you can drive or walk on, built from the same vertices as the drawn mesh, plus one simple shell per building and railings from the deck edge (Rec)** | Est: 5 to 20 ms, 0.5 to 1.5 MB | Exact where it matters, simple elsewhere | M | Needs the ray-down test in the bake and in the game | Jolt mesh shape; data written by the bake | Audit rule: colliders from the same geometry | P0-017, physics.json (max error against the drawn surface) |

### 3. Code and data pipeline

| Decision | Option | Perf on this machine | Quality | Complexity | Risk | Tooling, licence, size | Fit | Bench |
|---|---|---|---|---|---|---|---|---|
| Game language | **LANG1 GDScript only, written data first: packed arrays and server calls for crowds and traffic (Rec)** | Est: 1 to 3 ms per tick for 200 pedestrians and 30 traffic agents, under 1 ms when agents update in turns | Text files, no toolchain, headless tests already run | S | A hot loop may not fit its budget | Built in | Claude can build and test all of it | P0-017, physics.json (agents section) |
| Game language | LANG2 GDScript plus GDExtension in C++ for measured hot spots | Est: 10 to 50 times faster in the ported loop | Same game, faster inner loops | L per module | A Windows build of each extension is needed; no scons here (pip in a venv under `tools/` works); cross compiling needs a toolchain unpacked under `tools/` | godot-cpp (MIT), scons, clang | Only if LANG1 misses a budget | P0-017 (if time): build godot-cpp and port the agent tick |
| Game language | LANG3 GDScript plus GDExtension in Rust | Est: like C++ | Safer code | L per module | A Rust toolchain installed inside the repo, Windows cross build, binding lag behind new Godot versions | gdext (MPL-2.0), cargo | No gain over C++ here | none |
| Game language | LANG4 C# | Est: faster than GDScript | Good tooling | M | Needs the .NET build of Godot and a dotnet SDK; blocks a web export | .NET SDK | Ruled out (decisions.md "GDScript first") | none |
| Offline bake language | **B1 Node and TypeScript in `tools/bake/` (Rec)** | Est: pilot bake under 10 min, whole map under 60 min, one district under 60 s after a small change | One projection module shared with the tests; typed; vitest; the inspector page can reuse the same code for previews | S to start | Geometry libraries are thinner than Python's; heavy polygon work needs Clipper2 | TypeScript (in repo), Clipper2 port (BSL-1.0), earcut (ISC), a constrained triangulator, geotiff (MIT), flatbush (ISC), meshoptimizer (MIT), DuckDB for Node (MIT) for Overture; versions pinned at install with a decisions.md entry | Audit rule: one implementation per algorithm | P0-018, pilot_data.json and tile_format.json |
| Offline bake language | B2 Python in a venv under `tools/` | Est: similar | Best geo libraries (shapely, rasterio, pyosmium) | S to start | A second projection that must match the first; a second test runner; wheels for Python 3.14 may lag | pip in a local venv | Breaks "one projection module" | none |
| Offline bake language | B3 Node for the bake, Python only for fetch helpers | Est: similar | Each tool where it is strongest | M | Two toolchains to keep working | both | Only if a source cannot be read from Node | P0-018 reports if needed |
| What Godot reads | **T1 our own binary tile: a small header plus typed arrays, read by GDScript on a worker thread; meshes, colliders, navmesh and placements are final in the tile (Rec)** | Est: 0.3 to 1.5 MB per 250 m tile, 5 to 20 ms to read and build | The same file is read by the game and the inspector; no tie to a Godot version; version stamp and byte budget per tile | M | We own the loader; a bad tile must fail loudly, not empty the world. A GDExtension reader only if GDScript reading is measured too slow | Format doc in TECH.md; magnitude check on load (audit 5.1) | Bake fully outside Godot | P0-018, tile_format.json |
| What Godot reads | T2 Godot resources (`.res`) written by a headless Godot pack step, loaded with ResourceLoader threaded loads | Est: 1.2 to 2 times the size, 5 to 20 ms to load | The engine's own fast path; mesh LODs and compression from the engine | M | Two bake stages; files tied to the Godot version; the inspector needs a second export | Godot headless | Good fallback if T1 hitches | P0-018, tile_format.json |
| What Godot reads | T3 glTF (`.glb`) per tile | Est: 1.5 to 3 times the size, 30 to 100 ms plus node creation on the main thread | Opens in any 3D tool | S | No colliders, navmesh or placements without custom extras; slow at run time | GLTFDocument | Useful as a debug export only | P0-018, tile_format.json |
| Coordinates | **X1 district frames: a transverse Mercator origin per district, then a translation offset (Rec)** | Est: no cost | Zero scale error and true north at each district centre; a district is self-contained data | S (the projection takes an origin argument; fixtures extended) | Low | `tools/geo/projection.ts` and its GDScript port | `MAP_REPAIR.md` "District frames and stitching" | P0-029, stitch.json (landmark error) |
| Coordinates | X2 one origin for the whole city (India Gate), then a translation offset | Est: no cost | Est: scale error about 3 mm per km and north off by about 0.07 degrees at Cyber City | S (no change to the projection) | Low; every district depends on one far origin | same | Works, slightly less clean | P0-029, stitch.json (difference to X1 at district corners) |
| Coordinates | X3 a flat local east-north plane per district | Est: no cost | Est: under 10 cm error across a 2 km district | S | A second formula beside the tested projection | new code | No gain over X1 | none |
| Float precision | **FP1 32-bit floats, world origin at the centre of the map box, vertices stored relative to their tile (Rec)** | Est: no cost | Est: positions are at most about 6 km from the origin, where a 32-bit float steps by 0.5 mm | S | Shimmer or wheel jitter at the map edge, to be measured | Standard build | The compressed map is small enough | P0-017 (vehicle and character at 7 km) and P0-029 (shots at the far district), physics.json and stitch.json |
| Float precision | FP2 floating origin (shift the world when the player is far from the origin) | Est: a hitch at each shift | Sub-millimetre everywhere | L | Every system must survive the shift; physics bodies and saved positions move | none | Not needed at this map size | none |
| Float precision | FP3 double precision engine build | Est: slower maths, more memory | Exact | XL | We would compile the engine, the export templates and every extension ourselves | Custom Godot build | Not needed | none |

### 4. Composite map

Anmol's answers (sitting 2): layout C is the full map, built in stages; the first release has layout B's districts plus Gurugram, Laxmi Nagar, Kashmere Gate with ISBT, and Humayun's Tomb with Nizamuddin; Noida, Shahdara and Akshardham unlock later; the pilot is CP with Jantar Mantar, India Gate, ITO, and Chandni Chowk with Red Fort. The layout row records that choice. The other rows are how it is built. Details: `DELHI_WORLD.md` section 0.

| Decision | Option | Perf on this machine | Quality | Complexity | Risk | Tooling, licence, size | Fit | Bench |
|---|---|---|---|---|---|---|---|---|
| Map layout | MA Compact core | Est: 17.6 km2 baked, about 280 tiles, 7.4 min across at 80 km/h | Cramped south | Least | Feels small | `districts.json` | Not picked | none |
| Map layout | MB Delhi shape | Est: 26.0 km2, about 420 tiles, 9.2 min across | Real compass layout | Middle | Core districts sit close | `districts.json` | The first release is B plus four districts | none |
| Map layout | **MC Delhi plus NCR, in stages (owner's pick)** | Est: 31.7 km2, about 510 tiles, 10.6 min across; pilot 7.2 km2 | Everything he named, opened by the story | Most, spread over stages | Est: about 1.3 times B's work | `districts.json` with a `stage` field per district (pilot, release, later) | Pillar 3, "the city opens up" | P0-029 (pilot districts only) |
| District selection and clip | DC1 rectangles from the draft sizes, cut hard at the box | Est: bake cost same | Buildings and blocks cut mid way | S | Many small roads cut at odd places, many open ports | `harness/data/districts.json` | Quick, ugly edges | P0-029 counts the ports |
| District selection and clip | DC2 hand-drawn clip polygons that follow real edges: arterials, rail lines, walls, the river, park edges | Est: same | Clean edges; few small roads cross the line | M (est: Claude draws about 20 polygons, Anmol reviews them in the inspector) | A wrong edge drops a place he wanted | `districts.json` plus one GeoJSON polygon per district in `harness/data/districts/` | Fewer ports to close | P0-029, stitch.json (ports per district) |
| District selection and clip | **DC3 as DC2, plus an edge band of 60 to 100 m outside the line kept as low detail shells with no roads (Rec)** | Est: 5 to 10% more tile data | The cut is hidden behind real-looking buildings | M | Slightly more data | same | Hides the seam from the street | P0-029, stitch.json |
| Stitching and connectors | **SC1 connectors as authored control points in game metres, one JSON file each, built by the lane model and the elevation solver (Rec)** | Est: bake under 1 s per connector | Full control of curves and grades; carries the real road's name and lane set | M (est: about 1 builder task per bridge or flyover) | Hand-placed points can look artificial; rules check radius and grade | `harness/data/connectors/<id>.json` | One road builder for real and authored roads | P0-029, stitch.json |
| Stitching and connectors | SC2 take the real road's shape between the districts and shorten it by a set ratio | Est: same | Keeps real bends | M | Shortening tightens curves and steepens ramps past the limits | same folder, generated | Good as a first guess that is then edited | P0-029 tries one |
| Stitching and connectors | SC3 draw connectors in the map inspector with a spline tool | Est: none | Anmol can shape roads himself | L | A big editor feature early | inspector | Later, if he wants it | none |
| Filler between districts | **FL1 open land first: parks, Ridge forest, rail yards, the river and floodplain, walls; generated filler blocks from area profiles only along connectors, with a short generated street net that closes the small ports (Rec)** | Est: filler tiles cost 20 to 40% of a district tile | Honest: filler never claims to be a real place | M | Generated streets can look fake if long | Area profile archetypes marked `filler` | Cheap and safe | P0-029, stitch.json (share of ports closed automatically) |
| Filler between districts | FL2 open land only; every small port ends in a gate, a wall or a loop | Est: cheapest | Sparse between districts | S | The city feels like islands | none | Fallback | P0-029 |
| Filler between districts | FL3 real strips: clip real data along the real route of each connector and place it beside the connector | Est: more bake area, 30 to 60% | Real shopfronts along the ring road | L | Strips must bend with the connector, which breaks "true scale inside" | more districts | Too costly for the gain | none |

Height stitching (all options): each district keeps its real ground heights and gets one height offset so neighbours meet near the same level. The elevation solver then treats connectors as roads between ports with fixed end heights. Filler ground blends between district edges.

### 5. World runtime

| Decision | Option | Perf on this machine | Quality | Complexity | Risk | Tooling, licence, size | Fit | Bench |
|---|---|---|---|---|---|---|---|---|
| Tile size and rings | **ST1 250 m tiles with three rings: full detail to about 375 m, block shells to about 900 m, one far skyline mesh per district always loaded (Rec)** | Est: about 49 full tiles and 150 shell tiles resident, 150 to 400 MB; at 200 km/h about 1 new full tile per second | Detail where the camera is; a skyline at any distance | L | Ring radii need tuning per preset | The streaming core (below) | Audit rule: LOD per small cell, never one distance per tile | P0-016 (frame time and memory on the camera paths), P0-018 (bytes per tile) |
| Tile size and rings | ST2 500 m tiles, LOD by visibility range only | Est: 4 times fewer files, 4 times bigger loads, longer hitches | Coarser | M | The old game's pattern (audit 5.6) | same | Simpler, worse at speed | P0-018 |
| Tile size and rings | ST3 500 m tiles with 125 m cells inside | Est: like ST1 with more book keeping | Finest near the camera | XL | Two levels to keep in step | same | Only if ST1 pops on foot | none |
| Tile loading and unloading | **TL1 a small streaming core picks tiles by distance and heading; a WorkerThreadPool task reads and builds each tile; the main thread attaches at most 2 ms of work per frame; each system (roads, ground, buildings, dressing, colliders, navmesh, life) registers build and dispose functions with its own budget; unload with a hysteresis ring and a memory cap (Rec)** | Est: read and build 5 to 20 ms on a worker, no frame over 33 ms while streaming | Smooth at 200 km/h | L (Fable tier core system) | Creating meshes and shapes off the main thread must be proven safe in 4.7 | GDScript, WorkerThreadPool | Audit 5.6: no file owns everything; a test caps module size | P0-018, tile_format.json (load ms on a thread, attach ms on the main thread) |
| Tile loading and unloading | TL2 `ResourceLoader.load_threaded_request` on `.res` tiles (with T2) | Est: 5 to 20 ms per tile | The engine does the threading | M | Tied to T2 | Built in | Fallback with T2 | P0-018, tile_format.json |
| Tile loading and unloading | TL3 one long-lived loader thread with a priority queue | Est: like TL1, one tile at a time | Strict order | M | One slow tile blocks the queue | GDScript Thread | No gain over the pool | none |
| Instancing | I1 one MeshInstance3D per building and prop | Est: 5,000 to 20,000 draw calls in a dense view | Baseline only | S | CPU bound | Built in | Measured to show the gap | P0-016, render.json |
| Instancing | I2 everything merged into a few meshes per tile and material | Est: 300 to 800 draw calls, the most memory | No reuse; no per-object LOD | S | Memory; tiles get big | Built in | Good for unique shapes | P0-016, render.json |
| Instancing | **I3 hybrid: unique building shells, roads and ground merged per tile and material; repeated facade modules, props, trees, poles and parked vehicles as MultiMesh per module per 125 m cell (Rec)** | Est: 1,500 to 3,000 draw calls, 2 to 4 M triangles | Module reuse keeps memory and tile bytes low | M | A MultiMesh is culled as one box and has no LOD of its own, so cells stay small and use visibility ranges | Built in | Est: kits of 40 to 80 modules per area | P0-016, render.json |
| LOD and the far city | **LD1 three levels through visibility ranges: modules near, a merged block shell in the middle, the district skyline far; mesh LOD index buffers made in the bake with meshoptimizer; hero landmarks keep their own chain and a far silhouette (Rec)** | Est: 30 to 50% fewer triangles than no LOD | No pop if ranges cross-fade | M | Fade ranges per preset | Visibility ranges; meshoptimizer (MIT) | Landmarks visible over the city | P0-016, render.json |
| LOD and the far city | LD2 engine mesh LOD only, no shells | Est: triangles drop, draw calls do not | Far blocks still cost a draw each | S | Draw calls at distance | Built in | Not enough alone | P0-016, render.json |
| LOD and the far city | LD3 impostor cards for far buildings and trees | Est: cheapest far field | Flat when the sun moves | L (an impostor baker) | Tooling we would write | Custom | Later, for trees first | none |
| Occlusion culling | **OC1 box and polygon occluders made in the bake from building footprints (Rec)** | Est: saves 20 to 40% of draw calls in dense lanes, costs 0.3 to 0.8 ms CPU | No visual change | S | CPU cost can beat the saving in open areas, so it is on per area | OccluderInstance3D, built in | Old Delhi lanes | P0-016, render.json |
| Occlusion culling | OC2 none | Est: 0 ms | Same | none | Overdraw in dense lanes | none | Fine for Lutyens and open land | P0-016, render.json |
| Textures | **TX1 VRAM compressed with mipmaps, both import sets on (S3TC and BPTC for Windows and Intel Macs, ETC2 and ASTC for Apple Silicon); one Texture2DArray per area kit for tiling materials, one trim and decal atlas per kit (Rec)** | Est: 4 to 8 times less video memory than uncompressed; 1.2 to 2.5 GB in play | Mip-safe tiling, no atlas bleed | S | Both sets double the import time and the import cache | Godot import; the macOS export checks need the ASTC set for arm64 (Godot editor source) | One kit, one array | P0-016, render.json (video memory, import size, load time) |
| Textures | TX2 Basis Universal | Est: smallest on disk, slower loads | Lower quality than BPTC | S | Transcode time at load | Built in | No need on desktop | P0-016 (if time) |
| Textures | TX3 uncompressed or lossless only | Est: 4 to 8 times the video memory | Exact colours | S | Memory | Built in | Only for the UI and the grade LUT | P0-016, render.json |

### 6. Characters, AI and combat

| Decision | Option | Perf on this machine | Quality | Complexity | Risk | Tooling, licence, size | Fit | Bench |
|---|---|---|---|---|---|---|---|---|
| Navigation | **N1 the bake writes navmesh polygons straight from the lane model: footpaths, crossings, plazas, lanes people share; one region per tile, joined at tile edges; ambient pedestrians follow the footpath graph, fighters and police on foot use the navmesh (Rec)** | Est: 1 to 5 ms to add a region, 0 ms bake at load | Exact, since we already know every walkable surface | M | Seams between tiles must connect | NavigationServer3D regions from our polygons | Same source as the road mesh | P0-017 (if time), physics.json |
| Navigation | N2 Recast bake in the game when a tile loads | Est: 80 to 400 ms per 250 m tile on a thread | Follows any geometry | S | Slow at speed; results vary with settings | Built in async bake | Fallback for odd places | P0-017 (if time), physics.json |
| Navigation | N3 footpath graph only, plus small hand-made navmesh arenas for fights | Est: cheapest | Enemies cannot chase off the paths | M | Fights break outside arenas | Custom | Too limiting for "on foot anywhere" | none |
| Animation and crowds | AN1 every person is a skinned mesh with an AnimationTree | Est: 0.03 to 0.08 ms CPU each, so 2 to 5 ms for 60 | Best motion | S | CPU cost grows with the crowd | Built in | Fine for 30 people, not 120 | P0-016, render.json (crowd section) |
| Animation and crowds | **AN2 hybrid: skinned with an AnimationTree within about 25 m (cap 40), baked vertex animation in a MultiMesh from 25 to 120 m, nobody beyond (Rec)** | Est: 300 far people under 0.3 ms GPU and near 0 ms CPU | Near people react fully; far people only walk and idle | L | Swapping a far person for a near one must not pop | A small vertex animation baker and shader | 30 to 60 agents in the slice, 120 at release | P0-016, render.json (crowd section) |
| Animation and crowds | AN3 vertex animation for everyone except the player and fighters | Est: cheapest | Stiff civilians up close | M | Close-up quality on foot | same | Too stiff at 1.7 m | none |
| Animation library | **AL1 Quaternius Universal Animation Library 1 and 2 as the base, retargeted to one humanoid profile (Rec)** | none | 120 or more clips (pack pages): walk, run, idle, punches, hit reactions, pistol | S | Style may not match; some moves are missing (auto driver seat, lathi) | CC0 (search result of the pack pages; licence file checked at download); the free version has about 70% of pack 2 (pack page) | No login, no owner action | none; checked when the first character task imports it |
| Animation library | AL2 Mixamo clips | none | Large, good combat set | S | Needs Anmol's Adobe account and manual downloads; raw files may not be shared | Adobe terms | Optional extra through dashboard cards | none |
| Animation library | AL3 only procedural and AI-made motion | none | Unknown | XL | Quality risk | Custom | Not as the base | none |
| Combat runtime | **CB1 hitscan bullets by ray, three hit zones per character (head, torso, limbs), thrown items as short physics arcs, physical ragdolls for at most 8 bodies at once, then they settle into a pose (Rec)** | Est: 1,000 rays per second under 0.05 ms per frame; a ragdoll 0.1 to 0.2 ms | Headshots, weighty knockdowns | M | Ragdoll stability on kerbs and stairs | Jolt, PhysicalBoneSimulator3D | The slice list: pistol, fists, knockdown | P0-017, physics.json |
| Combat runtime | CB2 a hit shape per bone, simulated bullets, unlimited ragdolls | Est: 3 to 5 times the cost | Finer hits | L | Cost in crowds | same | More than the design asks | none |
| Combat runtime | CB3 hitscan with animated knockdowns only | Est: cheapest | Stiff | S | Misses "ragdoll on knockdown" in the slice list | none | Fallback for far or extra bodies | none |
| Traffic AI | **TR1 lane followers: cars move along lane centre lines with a car-following rule, gap acceptance and simple lane changes, plus Delhi habits (horn, gap filling by two-wheelers, buses pulling out); a car becomes a physics vehicle only near the player or when hit; pursuit cars use the same lane graph and may leave it (Rec)** | Est: 5 to 10 microseconds per agent tick, so under 1 ms for 100 agents | Reads as traffic; cheap | L | Junction right of way; the swap from rails to physics | GDScript on the lane graph from the bake | Barricades at real junctions, tailing, races | P0-017, physics.json (agents section) |
| Traffic AI | TR2 every car is a physics vehicle | Est: 0.05 to 0.15 ms per car, so 5 to 15 ms for 100 | Chaotic, lively | M | Cost; traffic jams itself | same vehicle model | Too heavy | P0-017 measures 30 |
| Traffic AI | TR3 scripted loops with no lane logic | Est: cheapest | Cars ignore each other and the player | S | Looks dead | none | Not enough | none |

### 7. Map pipeline: repair, roads, ground, inspector

Full design in [`MAP_REPAIR.md`](MAP_REPAIR.md). The rows below are the choices inside it.

| Decision | Option | Perf on this machine | Quality | Complexity | Risk | Tooling, licence, size | Fit | Bench |
|---|---|---|---|---|---|---|---|---|
| Road sources | **RS1 OSM as the base, pinned by date and checksum; Overture transportation only as a second look; street photos (Mapillary, Commons) as reference for hero roads (Rec)** | Est: pilot extract under 20 MB | The only open road network for Delhi | S | Overture roads come mostly from OSM, so the cross-check finds little | OSM: ODbL 1.0, credit "© OpenStreetMap contributors" in the game; Overture transportation: ODbL (believed) | The repair layer does the real work | P0-018, pilot_data.json |
| Road sources | RS2 OSM only | Est: same | Same base | S | No second opinion | ODbL | Fine if Overture adds nothing | P0-018 reports what Overture added |
| Building sources | **BS1 the Overture buildings theme, which already merges OSM, Microsoft, Google Open Buildings and Esri with a source tag per building (Rec)** | Est: pilot under 30 MB | One merged set, less code | S | Their merge may keep duplicates or drop OSM tags | ODbL (Overture release notes); credit OSM and Overture | Saves our own merge | P0-018, pilot_data.json (duplicates, tag loss) |
| Building sources | BS2 our own merge of OSM, Google Open Buildings and Microsoft footprints | Est: same size, more bake time | Full control | M | A merge to write and test | Google: CC BY 4.0 or ODbL (believed); Microsoft: ODbL (believed) | If BS1 is poor in the pilot | P0-018, pilot_data.json |
| Building sources | BS3 OSM footprints only, gaps filled by the area generator | Est: smallest | Real where mapped, generated elsewhere | S | Old Delhi is thin in OSM | ODbL | Fallback | P0-018 counts coverage |
| Ground height source | **GS1 GEDTM30, a 30 m bare-earth model (Rec if it passes the pilot check)** | Est: under 5 MB for the map box | Bare earth; city quality unknown | S | New dataset; errors under dense buildings | CC BY (lecture record and project page; licence field checked on the Zenodo record in P0-018) | Allows a later sale | P0-018, terrain_sources.json |
| Ground height source | **GS2 Copernicus GLO-30 with our own ground filter: sample only roads, parks and open ground, drop cells under buildings, fit a smooth surface (Rec as the fallback)** | Est: under 5 MB | Honest in a flat city; the elevation solver smooths the rest | M | Our filter is new code | Free with a credit line; commercial use allowed | Clean licence, more work | P0-018, terrain_sources.json |
| Ground height source | GS3 FABDEM | Est: under 5 MB | The best known bare-earth model | S | Non-commercial and share-alike: it would block a later sale | CC BY-NC-SA 4.0 (catalogue pages; Fathom sells a commercial licence) | Cross-check in the bench only, never shipped | P0-018, terrain_sources.json |
| Ground height source | GS4 CartoDEM | unknown | A surface-like model | M | Needs a Bhuvan account (an owner action) and its reuse terms are unclear | ISRO Bhuvan terms | Out unless GS1 and GS2 both fail | none |
| Rule engine | **RE1 rules as TypeScript modules with an id, a detect function, an optional repair function and a confidence, listed in one catalogue (Rec)** | Est: under 5 s per district | Any geometry test is possible; each rule has unit tests | M (Fable tier) | Rules interact; order is fixed and tested | `tools/bake/rules/` | Repairs are data: logged, removable | P0-018, pilot_data.json (issue counts per rule) |
| Rule engine | RE2 rules as data (a JSON rule language) | Est: same | Easy to list, weak on geometry | L | The language grows into code | Custom | No gain | none |
| Rule engine | RE3 import issues from outside validators (Osmose, the JOSM validator) | Est: a fetch per bake | Extra signals for free | S | Their terms and uptime; they know nothing of lanes or stitching | Third party | As an extra input later | none |
| Auto-repair policy | **AR1 a repair is applied on its own when its confidence is 0.8 or more and its impact is low (a short join, a duplicate, a sliver); everything else is queued for the inspector with proposals; every repair is one line in the repair log with the rule, before, after and confidence, and can be switched off by an override (Rec)** | Est: no cost | Clear cases never wait; unclear ones reach Anmol | S inside the rule engine | A wrong automatic repair; the health report lists every one and the verifier reads shots of the repaired sites | `repairs.jsonl` per bake, summary in `harness/reports/map/health.json` | Anmol: "handle clear cases yourself" | P0-018, pilot_data.json (share of issues that would repair automatically) |
| Auto-repair policy | AR2 queue every issue for review | Est: no cost | Nothing changes without a person | S | Est: thousands of issues in the pilot would wait on Anmol | same | Against "never wait" | none |
| Auto-repair policy | AR3 apply every repair automatically | Est: no cost | Fast | S | Wrong joins at high-impact places (flyover ends, hero roads) | same | Hero roads and flyovers need a look | none |
| Overrides | **OV1 one JSON patch file per tile, keyed by stable ids (OSM way and node ids) with a lat and lon anchor to re-find the target after a new extract; each patch names its issue, action, reason and author; stale patches are listed, never dropped (Rec)** | Est: no cost | Survives re-bakes and new extracts; small diffs in git | M | A target that moved far needs a human look | `harness/data/overrides/<district>/<tile>.json` | What Anmol asked for | P0-018 writes two sample patches and re-applies them |
| Overrides | OV2 one overrides file per district | Est: same | Fewer files, bigger diffs | S | Merge conflicts | same folder | Fine too | none |
| Overrides | OV3 OSM change files applied to the source | Est: same | Standard format | M | Cannot express lanes, heights or connectors | osmium | Too narrow | none |
| Elevation solver | **EL1 one height per node, solved on the whole graph: ground roads stay close to the ground model, grades and vertical curves stay inside class limits, a road that crosses over another clears it, bridges and flyovers are smooth profiles between abutments that the solver places (Rec)** | Est: under 2 s per district | No steps at junctions; ramps get real lengths | L (Fable tier) | Stacked ramps at ITO are the hard case | TypeScript, an iterative solver of our own | Audit 5.4 and 5.5 | P0-019, roads.json |
| Elevation solver | EL2 smooth each way's own height profile | Est: faster | Ways disagree at shared nodes | S | The old game's fault (116 junction steps, measured in the audit) | none | Rejected | none |
| Elevation solver | EL3 heights from tags (layer times a fixed step) | Est: fastest | Invented heights | S | The old game's fault (roads floating up to 25 m, measured in the audit) | none | Rejected | none |
| Lane-level road model | **LN1 a reference line per road with lane sections: each lane has a width function along the road, so tapers, gores and lane drops are plain data; junctions are their own objects with connecting lanes; a split gives each branch its own reference line and height profile (Rec)** | Est: under 5 s per district | Tapers, gores and flyover splits by construction; lane continuity is checkable; traffic AI reads the same lanes | XL (the top Fable task) | Pairing OSM's two one-way ways into one street; left-hand traffic everywhere | Our own JSON, modelled on OpenDRIVE (the road simulator standard), not the XML format itself | Everything Anmol asked for in the lane model | P0-019, roads.json |
| Lane-level road model | LN2 a lane graph: every lane is its own strip with left and right bounds (Lanelet2 style) | Est: similar | Very flexible | XL | Tapers and widths are implied, harder to check | Custom | Good inside junctions; used there within LN1 | P0-019 notes |
| Lane-level road model | LN3 road surface polygons with painted lanes | Est: fastest | Looks right from above | M | No lane continuity for traffic; splits collapse again | none | Rejected | none |
| Hero roads | **HR1 a spec file per hero road: checked lane counts and widths, medians, kerbs, footpaths, roundabout islands, tree lines, street furniture, colonnade edges, each with a reference photo link; the spec overrides tags and class defaults; lookproof poses are matched to the photos (Rec)** | Est: no run time cost | Real layout and a checked cross-section | M per road group | Photo licences (reference only, never shipped) | `harness/data/hero_roads/<id>.json`, same lane model | Anmol's hero road tier (decisions.md "Hero roads") | P0-019, roads.json (CP inner circle with one radial) |
| Hero roads | HR2 hand-authored geometry for hero roads | Est: none | Total control | L per road | A second road builder to keep correct | Custom | Against "one implementation" | none |
| Hero roads | HR3 no tier, only per-tile overrides | Est: none | No single place that says what "right" is | S | Checks scattered | overrides | Too weak for his ask | none |
| Junction mesh builder | J1 build each junction from lane edges: cut the arms back, join neighbours with corner arcs, triangulate one surface | Est: under 1 ms per junction | Clean lanes and corner radii | L | Messy node clusters break the construction | TypeScript, earcut | Semantic, fragile alone | P0-019, roads.json |
| Junction mesh builder | J2 union all road ribbons as 2D polygons, then triangulate | Est: 1 to 5 ms per junction | Never overlaps, by construction | M | Loses lane structure and markings inside the junction | Clipper2 | Robust, plain | P0-019, roads.json |
| Junction mesh builder | **J3 hybrid: J1 builds the surface and the connecting lanes; J2 checks that overlap area is zero and is the fallback for clusters J1 cannot solve; kerbs, railings and parapets come from free deck edges with matching colliders (Rec)** | Est: under 5 s per district | Clean where possible, never overlapping | XL (Fable tier) | Two code paths, one verifier | TypeScript, Clipper2, earcut | Audit 5.2 and 5.3 | P0-019, roads.json |
| Terrain that fits roads | TF1 a height grid per tile, flattened under road corridors with a shoulder blend and pushed down under the road | Est: 2 m grid, 15,625 cells per tile | Simple; kerb lines cut across cells | M | Ground can poke through at road edges; gaps hidden only by lowering | HeightMapShape3D | The old approach done better | P0-019, roads.json (max gap) |
| Terrain that fits roads | **TF2 in districts the ground is a set of block polygons triangulated to the exact road, footpath and building edges, with heights from the solver; a height grid only for open land (floodplain, Ridge, golf course) and the backdrop ring (Rec)** | Est: 2,000 to 8,000 ground triangles per city tile | Watertight: road and ground share their edge, so nothing floats or sinks | L (Fable tier) | Robust triangulation with many constraints | A constrained triangulator | Audit 5.5: the ground is changed to fit the roads | P0-019, roads.json (max gap, triangles, build ms) |
| Terrain that fits roads | TF3 one constrained triangulation of everything, no grid at all | Est: more triangles in open land | Same in the city | L | LOD of open land is harder | same | No gain over TF2 | none |
| Map inspector | **MI1 a web page on the dashboard port: 3D view (three.js) of the baked tiles with a north-up top view, the issue queue sorted by impact, proposed fixes as preview lines with confidence and reasoning, pick or type a note; it writes the tile's override file and the inbox; an "open in game" button teleports the running game there through the debug server (Rec)** | Est: page loads the pilot in under 5 s | Works in a browser while the game is closed; exactly what Anmol asked for | L | A second renderer shows the tiles, so its picture can differ from the game; the game button covers that | three.js as a dev dependency of the harness only (MIT), served locally, no outside tiles or services | Reads the same T1 tiles and reuses the bake code for previews | none (built right after the sign-off) |
| Map inspector | MI2 a Godot tool scene inside the game (`--inspector`) | Est: starts like the game | Shows the true game picture | L | UI work in Godot; needs the game running; not linked from the dashboard as a page | GDScript | A later addition if MI1's picture misleads | none |
| Map inspector | MI3 a Godot editor plugin | Est: none | For editor users | L | Anmol would have to work in the Godot editor | EditorPlugin | Wrong audience | none |
| Inspector views | **IV1 one page with layers that switch on and off: issues, lanes (widths, splits, merges, tapers), hero roads beside their reference photos, districts and connectors, areas (profile, evidence, a generated block preview, edit), landmarks (tier, registry entry, flags); issues and lanes first, the rest right after (Rec)** | Est: none | One place to review the map | L, in 3 steps | Scope creep; each layer is its own task | same page | `DELHI_WORLD.md` "Map inspector" | none |
| Inspector views | IV2 separate pages per view | Est: none | Simpler pages | L | No way to see an issue and its area together | same | Weaker | none |
| Inspector views | IV3 issues and lanes editable; areas and landmarks read only at first, edits later | Est: none | Ships sooner | M | Area edits wait | same | The order of IV1's steps if time is short | none |

### 8. Delhi world layers

Full design in [`DELHI_WORLD.md`](DELHI_WORLD.md) sections 1, 2 and 10.

| Decision | Option | Perf on this machine | Quality | Complexity | Risk | Tooling, licence, size | Fit | Bench |
|---|---|---|---|---|---|---|---|---|
| Landmark sources and matching | **LM1 join on ids: OSM objects carry a `wikidata` tag, Wikidata gives coordinates, era, height and the ASI monument id; names and distance only as a fallback; heroes and signatures come from Anmol's list and are checked by hand (Rec)** | Est: registry build under 1 min | Few wrong matches; every match has a reason | M (Fable tier) | Places with no Wikidata tag in OSM | Wikidata CC0; OSM ODbL; ASI list: facts only | Registry per district | P0-018, landmarks_pilot_draft.json (match counts, OSM to Wikidata distance) |
| Landmark sources and matching | LM2 fuzzy name and distance matching across all sources | Est: same | More matches, more wrong ones | M | Hindi and English name variants | same | Fallback inside LM1 | P0-018 |
| Landmark sources and matching | LM3 a hand-made list only | Est: none | Exact for the top tier | S | Markers by hand do not scale | none | Used for heroes and signatures inside LM1 | none |
| Landmark storage and tiers | LS1 one generated `landmarks.json` plus one overrides file | Est: none | Simple | S | Big diffs when heroes are hand tuned | `harness/data/landmarks.json` | Fine for markers | none |
| Landmark storage and tiers | **LS2 one file per hero and signature landmark, one generated file for markers, one overrides file; the tier is proposed by a score and fixed by Anmol's list and inspector edits; every entry carries its district id (Rec)** | Est: none | Small diffs; art status and references live with the landmark | S | More files | `harness/data/landmarks/<id>.json`, `landmarks_markers.json`, `landmarks.overrides.json` | The inspector edits one file | none |
| Landmark placement | LP1 only landmarks inside a district clip exist | Est: none | Simple | S | No Rashtrapati Bhavan or Signature Bridge on the skyline | none | Too strict | none |
| Landmark placement | **LP2 inside a clip: district offset plus the projected position, on a flattened pad, replacing the buildings in its zone; outside every clip: a far landmark on the backdrop, placed by its real bearing from the nearest district, silhouette only (Rec)** | Est: none | Real position inside districts; a believable skyline | M (Fable tier) | A far landmark's distance is not real; it is never a place you can reach | Bake | `DELHI_WORLD.md` "Placement rules" | P0-029, stitch.json (landmark error in metres) |
| Hero model limits and LOD | HM1 one mesh inside the prop limit (25,000 triangles, 3 materials) | Est: cheap | Too coarse for Red Fort | S | Low poly look, which Anmol rejected | ingest as is | Not enough | none |
| Hero model limits and LOD | **HM2 a hero is up to 8 parts (wall run, gate, dome, pavilion ...), each up to 25,000 triangles; up to 6 materials in all; 3 LODs per part made with Blender in background mode or meshoptimizer; one far silhouette under 2,000 triangles (Rec)** | Est: 30,000 to 150,000 triangles at LOD 0, under 60 MB of textures | Smooth domes and arches at play distance | M | AI 3D models need cleanup and symmetry fixes | Blender is on this Mac (measured); ingest gets a hero rule | Style target B | none (first hero art task) |
| Hero model limits and LOD | HM3 procedural parts kit only, no imported models | Est: cheapest | Signature quality at best | M | Heroes look generated | GDScript kit | The stand-in until art arrives, and the signature tier | none |
| Area division | AD1 automatic clustering of 100 m cells by features | Est: seconds | Objective, noisy edges | L | Clusters need hand fixing anyway | Bake | Made sense for a 1:1 city | P0-018 feature table (if time) |
| Area division | **AD2 Claude draws 3 to 8 area polygons per district along roads and rail, seeded by OSM land use and colony outlines, with the 100 m feature grid as evidence; Anmol edits in the inspector (Rec)** | Est: none | Clean edges, full control | M | Judgement calls, each with an evidence line | `harness/data/areas/areas.geojson` | Est: the composite map has about 20 small districts, so hand-drawn is cheaper and better | P0-018, world_sources.json (which sources cover the pilot) |
| Area division | AD3 one profile per district | Est: none | Coarse | S | CP and Jantar Mantar would look the same | same | Too coarse | none |
| Profile storage | **PS1 shared defaults per archetype, one small file per area holding only what differs, and an overrides file for inspector edits; every value carries an evidence line (Rec)** | Est: none | Small files; a change to an archetype reaches all its areas | S | A value's origin (archetype, area or override) must be shown in the inspector | `harness/data/areas/archetypes/`, `profiles/`, `overrides/` | `DELHI_WORLD.md` "Files" | none |
| Profile storage | PS2 one full profile file per area | Est: none | Everything in one place | S | Est: 60 to 150 files that drift apart; no shared defaults | `harness/data/areas/profiles/` | Harder to tune | none |
| Area generator | **AG1 at bake time in Node: parcels, building shells, facade module placements, street dressing and colliders are written into the tiles; only life (people, vendors, animals, parked two-wheelers) is spawned in the game from seeded points in the tile (Rec)** | Est: 1 to 5 s per district in the bake; tiles grow by 0.2 to 0.6 MB | Same city on every machine; metrics and the inspector can read it | L (Fable tier) | Tile size | `tools/bake/areas/`; one seeded random generator written once | Deterministic, checkable | P0-016 (the kit block), P0-018 (bytes per tile) |
| Area generator | AG2 in the game when a tile loads | Est: 20 to 100 ms per tile in GDScript | Smallest tiles | L | Slower loads; the inspector cannot preview without a second copy of the generator | GDScript | Against "one implementation" | none |
| Area generator | AG3 everything in the game, including life rules and buildings, from the profile | Est: slowest loads | Smallest data | XL | As AG2, more so | GDScript | No | none |
| Kits and atlases | KT1 procedural modules built by GDScript at load (as the stand-ins now) | Stand-in blocks build in under 0.1 s, measured (decisions.md, P0-009 entry) | Clean, simple | S | Looks generated up close | GDScript | The placeholder for every kit | P0-016, render.json |
| Kits and atlases | **KT2 procedural first, then replaced module by module with authored or AI-made meshes through ingest; one Texture2DArray and one trim and decal atlas per kit; modules keep fixed ids so the baked placements never change (Rec)** | Est: 40 to 80 modules and under 200 MB of textures per kit | Reaches look B without blocking on art | M per kit | Mixed quality while a kit is half replaced | ingest, Blender | Art never blocks | none |
| Kits and atlases | KT3 authored modules only | Est: same | Best | L per kit | Waits for art | ingest | Breaks "never block on art" | none |
| Edge blending and seeds | **EB1 inside each area's blend band the generator mixes the two profiles by distance, shorter at roads and rail; every random pick is seeded from the district id and a parcel id made from the footprint, so a rebake gives the same city (Rec)** | Est: none | No hard line between areas | S inside the generator | A parcel id that changes with a new OSM extract reshuffles that parcel | Bake | `DELHI_WORLD.md` "The generator" | none |
| Edge blending and seeds | EB2 hard edges at roads and rail only, no blend | Est: none | Sharp change across a street | S | Looks zoned | Bake | Fallback | none |

### 9. Verify harness and shipping

| Decision | Option | Perf on this machine | Quality | Complexity | Risk | Tooling, licence, size | Fit | Bench |
|---|---|---|---|---|---|---|---|---|
| Verify harness on Godot | VH1 keep the debug server, driver and shim from P0-025 to P0-027 as they are | Stand-in scenario boot 0.56 to 0.82 s, measured (P0-009) | Works today: 7 scenarios and the look proofs pass (measured, journal P0-026 and P0-027) | none | Boot grows when the real world loads | TCP JSON lines, Node driver | Proven | none |
| Verify harness on Godot | **VH2 keep it, and add: `--arch=<name>` bench scenes with one runner (`harness/bench/arch.mjs`) that writes `harness/reports/arch/<name>.json`; a tiny test district so scenarios boot in under 3 s; perf runs on Vulkan with vsync off; a warm process per scenario group only if boot time becomes the cost (Rec)** | Est: 1 to 3 s per scenario with the test district | Same scripts, faster runs | S | A warm process can leak state between scenarios | same | Keeps every scenario and the workflow | The benches use it |
| Verify harness on Godot | VH3 move scenarios into GDScript tests inside the engine | Est: fastest runs | Loses the play scripts and the shared script set | L | A rewrite of working tools | GDScript | No | none |
| Export and packaging, Mac | **EM1 now: ad hoc signed universal app in a zip for testing; at release: Developer ID signing and notarisation (Rec)** | Est: export 1 to 3 min | No Gatekeeper warning once notarised | S now, M at release | Notarising needs Anmol's Apple Developer account (US$99 a year, the published price; an owner action) | Godot export templates are installed; Xcode tools are on this Mac | Public release | none |
| Export and packaging, Mac | EM2 unsigned or ad hoc builds for the public too | Est: same | Players must allow the app by hand in System Settings | S | Many players stop at the warning | none | Acceptable for early tests only | none |
| Export and packaging, Mac | EM3 ship through Steam only | Est: same | Steam launches unsigned builds without the warning | M | Steam fee (US$100, the published price) and store setup | Steamworks | A release choice, not needed now | none |
| Export and packaging, Windows | **EW1 export from this Mac to an exe plus data packs; unsigned for tests; one data pack per map stage, loaded at start, so later districts ship as an added pack (Rec)** | Est: export 1 to 3 min; data 1 to 3 GB at release | Runs after a SmartScreen click | S | We cannot test a Windows build on this Mac; GPU and driver bugs show only on a PC | Godot export templates; `ProjectSettings.load_resource_pack` | "The city opens up" in stages | none (needs a Windows PC, question below) |
| Export and packaging, Windows | EW2 signed Windows builds | Est: same | No SmartScreen warning after reputation builds | M | A code signing certificate costs money every year | osslsigncode | Decide at release | none |

## Budgets per system

All estimates, for 60 fps (16.6 ms) on this Mac at 1920 x 1080, medium preset. They become signed numbers in `harness/verify/perf_budgets.json` after the benches and the sign-off. The existing draft frame budget stays: warn 11.1 ms, fail 16.6 ms.

| System | Budget (ms or MB) | Measured |
|---|---|---|
| CPU: physics step (Jolt, all bodies) | Est: 2.0 ms p95 | not yet (P0-017) |
| CPU: player and pursuit vehicles (up to 11) | Est: 0.3 ms | not yet (P0-017) |
| CPU: traffic AI (60 agents in the slice, 100 at release) | Est: 1.0 ms | not yet (P0-017) |
| CPU: pedestrians and crowd AI (60 in the slice, 120 at release) | Est: 1.0 ms | not yet (P0-017) |
| CPU: combat (rays, thrown items, up to 8 ragdolls) | Est: 0.4 ms | not yet (P0-017) |
| CPU: animation (up to 40 skinned characters) | Est: 1.5 ms | not yet (P0-016) |
| CPU: missions, HUD, audio logic | Est: 0.5 ms | not yet |
| CPU: streaming attach on the main thread | Est: 2.0 ms cap per frame, no frame over 33 ms while streaming at 200 km/h | not yet (P0-018) |
| CPU: render (culling, draw lists) | Est: 2.5 ms | under 0.4 ms on the stand-in, measured (baseline) |
| CPU: slack | Est: 5.4 ms | |
| GPU: shadows (4 splits) | Est: 2.5 ms | part of 1.5 to 3.2 ms total on the stand-in, measured |
| GPU: city (roads, ground, buildings) | Est: 3.5 ms | as above |
| GPU: dressing, vehicles, people | Est: 1.5 ms | not yet (P0-016) |
| GPU: decals and the grime layer | Est: 1.0 ms | not yet (P0-011) |
| GPU: sky, fog, SSAO, glow, grade | Est: 1.7 ms | not yet (P0-011) |
| GPU: anti-aliasing or upscaling | Est: 1.0 ms | not yet (P0-016) |
| GPU: HUD | Est: 0.3 ms | not yet |
| GPU: slack | Est: 5.1 ms | |
| Draw calls | Est: warn 2,500, fail 4,000 (draft file: 450 and 900 for the stand-in) | 84 to 175, measured (baseline) |
| Triangles drawn | Est: warn 5 M, fail 8 M | 0.79 to 1.95 M, measured (baseline) |
| Video memory | Est: warn 2.0 GB, fail 2.5 GB | 192 MB, measured (baseline, no textures) |
| Process memory | Est: 5 GB on a 16 GB machine | not yet |
| Tile file size | Est: 1.5 MB average and 4 MB worst per 250 m tile; whole map under 3 GB | not yet (P0-018) |
| Tile read and build on a worker | Est: 30 ms worst | not yet (P0-018) |
| Load: launch to playing | Est: warn 6 s, fail 12 s | 0.56 to 0.82 s for the stand-in, measured |
| Bake: pilot, full | Est: under 10 min | not yet (P0-018, P0-019, P0-029) |
| Bake: one district after a small change | Est: under 60 s | not yet |
| Bake gate counts (open ports, floating ends, overlapping road faces, broken lane continuity, tapers out of limits) | 0, or each one explained | not yet (P0-019, P0-029) |
| Road to ground gap inside a corridor | Est: 0.02 m worst | not yet (P0-019) |
| Collider to drawn surface error | 0.05 m worst (owner rule) | not yet (P0-017) |
| Landmark position error in its district frame | Hero 5 m, signature 10 m, marker 15 m (`DELHI_WORLD.md` section 6) | not yet (P0-029) |

## Bench tasks

Each bench is one build round and one fix round. "Must" items come first; "if time" items that do not fit are reported as not measured and keep their estimate. Godot bench scenes live in `game/bench/<name>/` and start with the game arg `--arch=<name>` (a setup after a colon, for example `--arch=render:multimesh`). One runner, `node harness/bench/arch.mjs <name>`, starts each setup through the debug server, reads `debug.perf` and writes the report. The first bench to run creates the runner. Every report quotes the machine, the Godot version, the renderer, the GPU and the load.

| Task | Starts with | Measures | Writes |
|---|---|---|---|
| P0-016 render and crowds | `--arch=render` (`game/bench/render/`) | Must: R1 with a look B load on a dense 2 km stand-in; I1, I2, I3; LD1 against none; OC1 on and off; L1 against L2; A1 against A2; TX1 against TX3; AN1 against AN2 with 300 people; the area kit block. If time: R2, L3, L4 on one block, A3, TX2 | `harness/reports/arch/render.json` |
| P0-017 physics, vehicle, on foot, combat, scripting | `--arch=physics` (`game/bench/physics/`) | Must: P1 against P2; C1 proven (hold, time scale, replay); V1 against V2 with the kept tune; K1 against K3 with the ray-down error; F1 on kerbs, stairs and ramps; CB1 rays and 10 ragdolls; LANG1 agent tick; TR2 with 30 cars; FP1 at 7 km from the origin. If time: N1 against N2, K2, LANG2 build | `harness/reports/arch/physics.json` |
| P0-018 data, sources, tile format | `harness/bench/pilot_data/` scripts on `tools/bake/` code, and `--arch=tiles` (`game/bench/tiles/`) | Must: fetch and pin the pilot sources; licence table; issue census per rule; BS1 against BS2; GS1, GS2 and GS3 compared; T1, T2, T3 load and size in Godot; OV1 sample; landmark and area source check with the pilot landmark draft. If time: the 100 m feature table, building heights | `pilot_data.json`, `tile_format.json`, `terrain_sources.json`, `world_sources.json`, `landmarks_pilot_draft.json` in `harness/reports/arch/` |
| P0-019 lanes, junctions, ground | `harness/bench/roads.mjs` on `tools/bake/roads/`, shown with `--arch=roads` (`game/bench/roads/`) | Must: LN1 on the ITO flyover with service lanes; J3 on a CP radial junction; HR1 on the CP inner circle; EL1; TF1 against TF2; the gate counts. If time: the India Gate hexagon | `harness/reports/arch/roads.json` |
| P0-029 composite map stitch | `harness/bench/stitch.mjs` on `tools/bake/stitch/`, shown with `--arch=stitch` (`game/bench/stitch/`) | Must: X1 against X2; DC1 against DC2 port counts; SC1 with three connectors and one SC2 trial; FL1 port closing; landmark error; rotation check; shots at the far district for FP1 | `harness/reports/arch/stitch.json` |

## Recommendation

One line per decision, before the benches. P0-020 confirms or changes each with the measured numbers. Numbers here repeat the estimates in the tables.

- **Renderer: R1 Forward+.** Look B needs SSAO, decals, glow and a temporal filter; Mobile drops several of them.
- **Graphics driver: G1.** Engine defaults for players; Vulkan on this Mac only to read GPU times.
- **Lighting: L1.** It is the only option that keeps a moving sun, streams cleanly and costs under 1 ms. L2 becomes a "high" switch only if the bench shows no lag at speed.
- **Anti-aliasing: A1 on this Mac, A2 as the low preset.** The city is full of thin lines; an upscaler is the cheapest headroom for weaker GPUs.
- **Physics engine: P1 Jolt.** Stable contacts on mesh roads and usable ragdolls, at no extra size.
- **Sim clock: C1.** Godot cannot step physics by hand, so the clock must ride the engine's physics frame; then slow motion, holds and replays stay exact.
- **Vehicle: V2, our own raycast vehicle.** Three vehicle types and an arcade feel need control that VehicleBody3D does not give. V1 is measured as the baseline.
- **On foot: F1.** Exact speeds and tight control for combat.
- **Colliders: K3.** Exact on every surface you touch, simple on buildings, from the same vertices as the picture.
- **Game language: LANG1 GDScript.** No toolchain, all text. C++ only for a loop a bench proves too slow.
- **Bake language: B1 Node and TypeScript.** One projection, one test runner, and the inspector can reuse the code.
- **Tile format: T1 our own binary tile.** One file for the game and the inspector, no tie to an engine version. T2 is the fallback if loads hitch.
- **Coordinates: X1 district frames.** True scale and true north inside every district, and districts stay independent.
- **Float precision: FP1.** The map is about 10 km wide; 32-bit floats step by half a millimetre at its edge.
- **Map layout: MC in stages.** Anmol's pick.
- **District clip: DC3.** Clip along real edges and hide the cut behind an edge band.
- **Connectors: SC1.** Authored control points through the same lane model, with radius and grade rules.
- **Filler: FL1.** Open land first, generated blocks only where a connector needs a street edge.
- **Tile size: ST1.** 250 m tiles with three rings keep loads small at 200 km/h.
- **Tile loading: TL1.** A small core, worker threads, and systems that register their own build and dispose.
- **Instancing: I3.** Merge what is unique, instance what repeats.
- **LOD: LD1.** Three levels through visibility ranges, plus a skyline per district.
- **Occlusion culling: OC1, on per area.** It pays in Old Delhi lanes and costs in open land.
- **Textures: TX1.** Compressed arrays per kit; both import sets so one project exports to Mac and Windows.
- **Navigation: N1.** The bake already knows every walkable surface.
- **Crowds: AN2.** Skinned near, baked animation far.
- **Animation library: AL1.** CC0 and no login, so nothing waits for Anmol.
- **Combat: CB1.** Rays, three hit zones, a cap of 8 ragdolls.
- **Traffic: TR1.** Lane followers that turn into physics cars near the player.
- **Road sources: RS1.** OSM pinned by date, repaired by our rules.
- **Building sources: BS1.** Overture already merges the footprint sets; BS2 if its quality is poor in the pilot.
- **Ground height: GS1 or GS2, chosen by the pilot check.** Both allow a later sale. FABDEM is never shipped.
- **Rule engine: RE1.** Rules are code with tests; repairs are logged data.
- **Auto-repair: AR1.** Clear, low-impact cases repair themselves with a log line; the rest go to the inspector.
- **Overrides: OV1.** One patch file per tile, keyed by stable ids with an anchor.
- **Elevation solver: EL1.** One height per node, solved on the whole graph.
- **Lane model: LN1.** Reference lines with lane sections, junctions as objects.
- **Hero roads: HR1.** A checked spec file per hero road, built by the same lane model.
- **Junction builder: J3.** Lane-edge construction with a polygon union as verifier and fallback.
- **Terrain: TF2.** City ground is triangulated to the road edges; a height grid only for open land and the backdrop.
- **Map inspector: MI1.** A web page on the dashboard with an "open in game" button.
- **Inspector views: IV1, built in the order of IV3.** Issues and lanes first, then hero roads, districts, areas and landmarks.
- **Landmark matching: LM1.** Join on ids; heroes and signatures checked by hand.
- **Landmark storage: LS2.** A file per hero and signature landmark.
- **Landmark placement: LP2.** Real position inside its district; far landmarks only as skyline.
- **Hero models: HM2.** Up to 8 parts with LODs and a far silhouette.
- **Area division: AD2.** Hand-drawn areas per district with evidence.
- **Profile storage: PS1.** Archetype defaults plus small per-area files.
- **Area generator: AG1.** At bake time; only life spawns in the game.
- **Kits: KT2.** Procedural first, replaced module by module.
- **Edge blending: EB1.** A blend band, seeded per parcel.
- **Verify harness: VH2.** Keep it; add the bench runner and a tiny test district.
- **Mac packaging: EM1.** Ad hoc builds now, notarised at release.
- **Windows packaging: EW1.** Export from this Mac, one data pack per map stage.

## Questions for the owner

For architecture round 1 (P0-014). The benches answer the number questions; these need Anmol.

1. **Licences and a later sale.** The game is free. Should we still keep the door open to sell it later?
   - a. Yes: use only sources that allow a sale, and publish our repaired map data openly, as the OSM licence asks (recommended)
   - b. No: free forever, so non-commercial sources such as FABDEM are allowed too
2. **Mac signing.** A notarised Mac build needs an Apple Developer account (US$99 a year).
   - a. You will buy it near release; test builds stay unsigned until then (recommended)
   - b. You already have one
   - c. No account: players allow the app by hand
3. **Windows testing.** We can export a Windows build from this Mac but cannot run it here.
   - a. You have a Windows gaming PC and will run a test build when the dashboard asks
   - b. A friend tests it at milestones
   - c. No Windows testing until release (risk: GPU and driver bugs found late)
4. **Map inspector.** Where should it live?
   - a. A web page on the dashboard with an "open in game" button (recommended, and what you first asked for)
   - b. Inside the Godot game as a tool mode
5. **Animation.** Characters need 60 to 90 motion clips for the slice.
   - a. Start from the free CC0 library, no action from you (recommended)
   - b. You download Mixamo clips with your Adobe account when the dashboard asks
6. **Hero roads.** The first set is the CP circles and radials, Janpath, the Lutyens avenues and roundabouts (Kartavya Path, the India Gate hexagon, Safdarjung Road), and the Lodhi Garden and India Gate lawn edges. Each is checked against reference photos.
   - a. That list is right; review them in the inspector beside the photos (recommended)
   - b. Add or remove roads (say which)
   - c. You will also send your own photos of some of them

## Sign-off

Not signed. Quote and date go here and in decisions.md (`task.mjs archsignoff "<his words>"`).
