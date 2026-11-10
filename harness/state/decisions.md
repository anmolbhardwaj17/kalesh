# Decisions

Short, current decisions only: date, decision, why. One entry per choice. When this file passes about 12 KB, move old entries to decisions_archive.md (the planner's CONSOLIDATE mode does it) and keep a one line summary here.

Format:

## YYYY-MM-DD: <decision in a few words>
Decision: <what was decided>
Why: <the reason, in one or two lines>
By: <owner | orchestrator | planner | builder>


## 2026-11-10: Phase 0 adds architecture discovery with its own sign-off
Decision: Phase 0 runs ARCHITECTURE DISCOVERY next to style discovery: an options table (harness/design/ARCH_OPTIONS.md), measured benches on this machine, and Anmol's sign-off recorded with task.mjs archsignoff. Gate P0 needs both sign-offs.
Why: the old driving game failed at its base layer (mirror axis, roads, terrain, a 2346 line tile manager). Anmol wants the engine and systems chosen on evidence before any building.
By: orchestrator (setup)

## 2026-11-10: New repo, old game read only
Decision: Dilli Darshan starts in a new repo on a minimal Vite, TypeScript and three.js scaffold. /Users/apple/Desktop/code/delhi-drive is a read-only reference. One coordinate system: east +X, north -Z, 1 unit = 1 m, no mirroring.
Why: Anmol decided the old game is too broken at base level to rework.
By: owner

## 2026-11-10: Fable model only for the hardest work
Decision: Fable runs (budget in harness/state/fable_budget.json, limit 25) go only to the Phase 0 salvage audit, architecture discovery, the first two phase plans, the core systems (roads and junctions, terrain fit, coordinates and bake, streaming, physics worker and handling, render foundation), 3rd attempts and hard bugs blocked twice. Tasks carry a model field set by the planner. When the budget is spent, Opus runs instead.
Why: Anmol has a limited Fable budget and wants it where it matters most.
By: owner

## 2026-11-10: A map repair layer between the sources and the mesh build
Decision: source map data is treated as broken. A repair layer (harness/design/MAP_REPAIR.md) ingests OSM, Overture, merged building footprints and a bare-earth DTM, validates with a rule engine, auto-repairs with a log, applies versioned per-tile overrides, solves elevations, and only then builds meshes. Pilot: Connaught Place, ITO and Pragati Maidan flyovers, Chandni Chowk, one metro line. It is part of the architecture sign-off; its rules, elevation solver and junction builder are Fable tier.
Why: Anmol accepts the data is broken and wants it found and fixed on every bake, not shown on screen.
By: owner

## 2026-11-10: Lane-level road model and a map inspector
Decision: roads are built as lane sets with tapers, gores and flyover lane splits (never shared index points), checked for overlapping faces, lane continuity and taper limits; this is the top Fable task. A 3D map inspector page lets Anmol pick among Claude's proposed fixes for unclear or high-impact issues; choices go to per-tile overrides and the inbox. It is an early task after the architecture sign-off.
Why: centrelines on one shared node made carriageways collapse in the old game; Anmol wants to review hard map cases himself without blocking the build.
By: owner

## 2026-11-10: Dashboard restyle
Anmol asked for a dark, minimal dashboard in the Saans font. Restyled harness/dashboard/index.html: neutral black (no blue tint), Saans and Saans Mono served locally from harness/dashboard/fonts (route /fonts/). The Saans files are TRIAL builds with a personal use only licence (fonts/LICENSE.txt): fine for this private local dashboard, never ship them in the game build.

## 2026-11-10: Game design discovery is the third Phase 0 sign-off
Decision: Phase 0 adds GAME DESIGN DISCOVERY (harness/design/GAME_DESIGN_OPTIONS.md, interview rounds, explicit sign-off recorded with task.mjs designsignoff). Gate P0 needs style, architecture and game design sign-offs. Standing rules for every plan from then on: each phase is checked against the GAME.md pillars; every mission task's acceptance includes fun criteria (clear goal, fair fail, a reason to retry, a reward that matters) as well as function; no mission system is built before the game design sign-off.
Why: a car driving around Delhi is a tech demo, not a game; Anmol wants a real core loop built from what makes Delhi Delhi (inbox mmwap8jxg).
By: owner

## 2026-11-10: Salvage audit and quality audit run as one Fable task
Decision: the Phase 0 quality audit ("why it felt thin") is written in the same Fable run as the salvage audit, scored against the old game, since the new repo is a scaffold with nothing to audit yet.
Why: both read the old repo deeply; one run saves a second full read in low usage mode.
By: planner

## 2026-11-10: Projection is WGS84 transverse Mercator around India Gate (provisional)
Decision: `src/geo/projection.ts` maps lat/lon to world metres with a transverse Mercator (Krüger series, 3rd order) on the WGS84 ellipsoid, central meridian through the origin (India Gate, 28.612894 N, 77.229446 E), scale 1 on that meridian, origin northing subtracted. East +X, north -Z, up +Y. No mirroring. Scale error is about 0.2 m at 25 km east or west, round trip under 1 cm. Provisional: the architecture sign-off may replace it (for example with a local ENU or a tile-local origin).
Why: needs no dependency, is accurate to centimetres over the whole city, and keeps the axis rule in one place with tests.
By: builder

## 2026-11-10: Delhi world layers (landmark registry and area profiles)
Anmol (inbox mmwapw3co): "Delhi must look like Delhi, area by area." Two data layers on top of the repaired map: a landmark registry (hero, signature, marker tiers, exact place and orientation) and area profiles that drive a procedural generator for ordinary buildings and street dressing. Both join Phase 0 architecture and style discovery for sign-off. Plan in harness/design/DELHI_WORLD.md; build tasks go after the map repair pilot. The area profile generator and the landmark placement pipeline are Fable tier (CLAUDE.md updated). Respect rule: portray every community from data and reference, never caricature.

## 2026-11-10: Salvage verdict: no base-layer code or data is copied from delhi-drive
Decision: nothing is copied from the old repo's roads, junctions, railings, terrain fit, tile manager, physics bridge (cannon-es and its Rapier adapter), projection, bake code, baked tiles, source data files or art. Items marked REWRITE in harness/design/SALVAGE_AUDIT.md are rebuilt here from the idea, with tests. The Delhi OSM extract is downloaded fresh and pinned by date and checksum. Only the three KEEP items in the entries below are copied.
Why: the audit traced every base-layer failure to a design choice (a left-handed world patched with a flip, one ribbon per way, heights from "layer times 6 m", a blurred surface DEM, one file owning the tile lifecycle), not to a bug that a copy could fix. The old Delhi tiles are format v6 with flat elevation, and the old Delhi posters show a real politician and have no alpha.
By: planner (P0-003)

## 2026-11-10: KEEP from delhi-drive: car handling numbers as the starting tune
Decision: copy the numbers, not the code, from delhi-drive `frontend/src/car/carPhysicsRapier.js` into the new vehicle tuning file as the first tune: mass 1730 kg, inertia 3600 / 3820 / 814, body box half extents 0.95 / 0.6575 / 2.395 m with more than one wheel radius of ground clearance, half track 0.78 m, axles at plus and minus 1.43 m, wheel radius 0.34 m, suspension rest 0.32 m, stiffness 28, compression 0.82, relaxation 0.88, travel 0.3 m, front grip 3.1, rear grip 2.2 (the value that ran every frame, line 260, not the 2.9 at line 116), handbrake rear grip 0.9, side stiffness 1.2 front and 1.1 rear, max steer 0.64 rad, steer rate 1.10 rad/s out and 1.85 rad/s back, steer lock reduced with speed (by 60% from 102 km/h up), engine force 5200, brake 90, anti-spin yaw damping 5200, gear top speeds 34 / 60 / 84 / 100 / 106 / 110 km/h, fixed 60 Hz step. Axis signs are derived again in the new frame.
Why: checked in the salvage audit. They are for the same Rapier raycast vehicle controller, the inertia matches a 1.9 by 1.43 by 4.79 m box at 1730 kg, and they came out of many drive sessions with Anmol (tickets V-1 to V-15). No other measured tune exists, so this is the best starting point. It is a start, not a target: the old file calls itself a first pass. The copy only counts once feel probes have measured acceleration, top speed, braking distance and steering response, and the game design sign-off may change the top speed.
By: planner (P0-003)

## 2026-11-10: KEEP from delhi-drive: chase camera numbers as the starting rig
Decision: copy the numbers, not the code, from delhi-drive `frontend/src/car/carCamera.js` as the first camera rig: wide chase 6.6 m behind, 2.5 m up, look-ahead 4.0 m; close chase 4.5 m, 2.05 m, 3.2 m; at 80 km/h add 0.3 m distance, drop 0.25 m, add 3.0 m look-ahead; base FOV 70 degrees plus up to 21 at 80 km/h; position lerp 0.16 and look lerp 0.22 (frame-rate independent); horizontal clamp 9.3 m; floor 0.5 m above the car; view changes blend over 0.6 s on an arc lifted up to 0.8 m over the roof; impact shake on a one-frame drop above 16 km/h, capped at 0.20 m. Not copied: the rumble above 140 km/h (the car never reached it), tunnel zones and bumper offsets (tied to the old frame and model).
Why: checked in the salvage audit. The camera is the best-finished part of the old game, the code and its doc agree on every number, and its behaviour is pinned by 17 tests whose intent will be rewritten as camera scenarios. Tuning a chase camera from zero took the old project many rounds. The rig is re-judged by Anmol in the feel playtest.
By: planner (P0-003)

## 2026-11-10: KEEP from delhi-drive: four CC0 sounds as placeholders
Decision: copy `engine_idle.wav`, `engine_mid.wav`, `engine_high.wav` and `horn.ogg` (listed as `horn.wav` in its attribution file) from delhi-drive `frontend/public/audio/` into this game's audio assets as placeholders, registered through `assets.mjs` with their source and licence, when the first audio task needs them. Not copied: `ambience.ogg` and `ambience_night.ogg` (a quiet western street), `skid.ogg` (CC-BY 3.0, needs a credit line).
Why: checked in the salvage audit against `frontend/public/audio/ATTRIBUTION.md`: the three engine loops (OpenGameArt, domasx2) and the horn (Wikimedia Commons) are CC0. They are 40 to 76 KB each and let the three-layer engine blend and the horn be built and tested before Delhi sounds arrive. They are placeholders only: real engine, horn and ambience sounds go on the dashboard as audio requests after the style sign-off.
By: planner (P0-003)

## 2026-11-10: Dashboard font and whole game percent
Anmol: Saans was hard to read, use SF Pro; and the whole game percent (13% with only P0 planned) was wrong. The dashboard now uses the system SF Pro and SF Mono stack; the Saans trial files are removed from the repo. Whole game percent is tasks done over the game size, which is at least kit.config.json gameSizeEstimate.tasks (250, a rough guess) until every phase is planned. The day estimate assumes at least 1 h per task until 10 tasks are done. Planner: update gameSizeEstimate when P0-023 sizes the game.

## 2026-11-10: Game direction from interview round 1 (pending sign-off)
Anmol: three playable characters (auto driver, cop, small-time fixer) with their own lives and stories and missions that merge; guns and fights; over-the-top action movie tone; on foot anywhere; rethink the pillars and rules. "this last message might change the game feel but tbh thats what i wanna do". Respect rule refined: Anmol wants poverty shown where it is true ("i want to show some part of it as its actually true"). So: show real conditions honestly, as part of the city and never its only face, never as spectacle or a joke. Engine question (browser vs a native engine such as Godot) is open and goes to architecture discovery. Not signed off yet.

## 2026-11-10: Engine Godot 4, and a compressed Delhi map (pending architecture sign-off)
Anmol: "yes for godot 4". Desktop (Windows and Mac), web demo maybe later. Reason: three players, on-foot combat, crowds and animation outgrow the browser; Godot files are text, so Claude can build and test everything. The browser hook harness gets rebuilt for Godot (a debug server in the game plus screenshot capture).
Map: Anmol asked for a compressed Delhi like a big open world game does with a real city: real districts, monuments, roads, Yamuna, airport, parts of NCR and East Delhi, stitched together into one smaller map, not a 1:1 copy. Proposal (to confirm): a composite map where each chosen district is built from real OSM data at true scale inside, districts are moved closer, and authored connector roads, flyovers, the river and the ring roads join them. Landmark tests check position inside their district frame. This changes MAP_REPAIR.md, DELHI_WORLD.md and the projection plan; the planner replans P0 for Godot and the composite map.

## 2026-11-10: Phase 0 replanned for Godot 4, three characters and the composite map
Decision: Phase 0 keeps its shape (interviews, style tests, architecture benches, three sign-offs) but every build task now targets Godot. Godot 4.7.2.stable (standard build, export templates installed) is already at /Applications/Godot.app, so no install task: the first builder task pins 4.7.2 and adds a launcher that downloads a portable copy into tools/godot/ only on a machine without it. Order: a Godot scaffold with the same coordinate contract and the projection tests ported (P0-024), an in-game debug server that implements docs/GAME_HOOKS.md behind --debug (P0-025), a Godot driver for verify and shoot that runs the existing page-side scripts in a node shim (P0-026), then lookproof and perf on Godot and the three.js scaffold retired (P0-027). Style tests use --style=<id> in Godot, not ?style= in a browser. The composite map gets a district draft before the next sitting (P0-028) and a stitch bench (P0-029, Fable). MAP_REPAIR.md and DELHI_WORLD.md now describe district frames (per-district projection origin plus a translation offset, no rotation, north stays -Z), a district selection step and a stitching and connector step, as a proposal pending Anmol.
Why: owner direction in interview sitting 1 (inbox mmwar1t1j to mmwarg8cw). Reusing the hook contract and the page-side scripts keeps every scenario idea and the verify workflow; only the transport changes. Translation-only district offsets keep landmark tests simple and avoid any axis flip.
By: planner (REPLAN)

## 2026-11-10: Speeds and map size (Claude call, Anmol asked "see whats best")
Top speed is per vehicle, tuned for a compressed map: auto about 65 km/h, scooter about 90, ordinary car about 140, fast cars 180 to 200 (rare). Faster than that shrinks a compressed city to nothing. Map target: Delhi NCR source data only, compressed into a playable area well under a GTA V sized map (first estimate 15 to 25 km2 of land, a cross-map drive of about 8 to 12 minutes). Source data likely under 10 GB; Anmol allows up to 50 GB and long bakes on this Mac. Release: free and public (Anmol); prefer data licences that would still allow a later sale. Posters: invented parties only. First heroes: Connaught Place circle, India Gate, Red Fort. Districts: central core, Old Delhi, East Delhi across the Yamuna, South with Gurgaon and the airport, plus story places (GB Road, Jantar Mantar, Vasant Kunj, Delhi Gymkhana, the Golf Club, Khan Market, one haunted place). GB Road is shown with the respect rule: story and atmosphere, no sexual content, no exploitation of real people.

## 2026-11-10: Sitting 2 results (Claude call on look A test)
Map: layout C (Delhi plus NCR) is the full map; first release has Gurugram, Laxmi Nagar, Kashmere Gate and ISBT, Humayun Tomb and Nizamuddin; Noida, Shahdara and Akshardham unlock later. Homes as proposed. Pilot: CP with Jantar Mantar, India Gate, ITO, Chandni Chowk with Red Fort (about 7.2 km2). Haunted place: Malcha Mahal. Police: invented, Delhi-like force. Look A realistic test: Anmol was unsure what it meant; Claude skips it (he already picked B; A would only show what realism costs). He can ask for it any time. Game design round 2: chapters, pillars "Three lives, one Dilli", the auto driver first, lean combat growing with a full capability list kept in GAME.md, civilians can be hurt with weight, half action and story, half city life. Hardware: this Mac and similar, and gaming PCs or better. Art: Anmol makes images in ChatGPT from dashboard prompts and uploads; Claude reviews.

## 2026-11-10: game design signed off by Anmol
Quote: "yes, I sign off on this game design"
See harness/design/GAME_DESIGN_OPTIONS.md and GAME.md (fantasy, core loop, pillars, mission list, progression plan).

## 2026-11-10: Godot 4.7.2 pinned, found or fetched by godot.mjs
Decision: the game engine is Godot 4.7.2.stable, standard build. kit.config.json "godot" pins it; harness/bin/godot.mjs looks in env GODOT, then tools/godot/, then /Applications/Godot.app, checks --version, and only when nothing matches downloads the official portable zip into tools/godot/ (gitignored), checked against the release SHA512-SUMS.txt. Nothing is installed globally.
Why: one exact engine version on every machine keeps imports, scenes and test output stable; this Mac already has 4.7.2 and its export templates, Windows machines get the same build without an install.
By: builder (P0-024)

## 2026-11-10: GDScript first, no C#, GDExtension only as an option for heavy code
Decision: game code is GDScript. C# is not used. GDExtension (C++) stays an architecture option for measured hot spots (for example the bake loader or crowds), decided per system in ARCH_OPTIONS.md.
Why: C# needs the .NET build of Godot and a dotnet SDK (neither is on this Mac) and blocks the web export Anmol may want later. GDScript files are text, parse headless and need no toolchain.
By: builder (P0-024)

## 2026-11-10: Project layout game/, tools/, harness/
Decision: the Godot project lives in game/ (project.godot, scenes/, scripts/, geo/, tests/; game/.godot/ import cache gitignored, *.gd.uid files committed). Offline bake tooling and fixture generators live in tools/ (Node, may import the TS reference code such as src/geo/projection.ts). harness/ is unchanged. src/ (three.js) stays until P0-026 ports its scenarios and P0-027 retires it. lib.mjs treeHash now covers game/ and tools/ (tree rule 3).
Why: keeps the engine project self-contained and openable in the editor, keeps the bake off the game runtime, and lets verify know a game/ change needs a fresh run.
By: builder (P0-024)

## 2026-11-10: Own headless GDScript test runner, not GUT
Decision: game/tests/run_tests.gd is a 60 line runner (a SceneTree script; suites are game/tests/test_*.gd with test_* methods and a check.gd assert helper). It runs on the first frame (the root is only in the tree then), prints PASS or FAIL per test and exits 1 on any failure. npm test runs it after vitest through godot.mjs test, which also fails on any ERROR or SCRIPT ERROR line. Cross-language checks use JSON fixtures generated from the TS code (harness/data/fixtures/).
Why: GUT is MIT and fine, but it is a large vendored addon with its own editor plugin and version coupling to Godot; the tests needed now are plain asserts. Revisit if tests need mocking, doubles or async helpers.
By: builder (P0-024)

## 2026-11-10: Honest quality bar (answer to Anmol)
Anmol asked what quality is achievable and whether Godot can make GTA IV, GTA V or Watch Dogs. Answer recorded so expectations stay fixed: the limit is team size, art and animation volume, not mainly the engine. Target: a polished indie or AA open world. Systems depth around GTA San Andreas or Sleeping Dogs-lite, in a dense 20 to 27 km2 map, with look B lighting that can reach close to Watch Dogs 2 in the best areas at the best time of day, and less polish in the average street. Not achievable: GTA V or Watch Dogs density, hand animation and physics-driven character reactions, hundreds of voiced missions, cinematic cutscenes at that level. Godot limits we accept and engineer around: no built-in world partition (we build streaming), weaker animation tooling (we use retargeted free libraries such as Mixamo, licence checked), crowds need custom instancing, 32 bit floats (fine at our map size). What Unreal would add: Nanite and Lumen class rendering. Not worth its cost for an AI-built project with text-unfriendly assets.

## 2026-11-10: Godot debug server speaks newline-delimited JSON over plain TCP
Decision: the in-game debug server (game/debug/) listens on 127.0.0.1 with TCPServer and speaks one JSON object per line: requests {id, method, args}, responses {type: response, id, ok, result or error}, a hello on connect and a snapshot (state, clock, hold, new events) after every drawn frame. Not WebSocket. It exists only with the user arg --debug: GameArgs loads the script by path, so a normal run never loads it. Default port 47181 (kit.config.json godot.debugPort); the harness passes a free port per run.
Why: plain TCP needs no handshake or framing code on either side (Godot StreamPeerTCP, Node net), is easy to test with a fake server, and only local tools connect. Snapshots let a driver answer the synchronous hooks without a round trip.
By: builder (P0-025)

## 2026-11-10: One sim clock with a fixed tick for every stepping system
Decision: the autoload SimClock (game/core/sim_clock.gd) owns sim time. It accumulates engine physics delta times the time scale and runs whole 1/60 s ticks, emitting sim_tick(dt). Systems step only on sim_tick. The hold pauses on the last tick boundary at or before the asked time. Engine.time_scale and SceneTree.paused are not used for the time scale or the hold. --lockstep sets Engine.max_physics_steps_per_frame to 1.
Why: a fixed tick keeps the sim the same at any time scale, and t is a whole number of ticks, so holds and replays are exact. Engine.time_scale would change the physics delta instead of the number of ticks. Godot physics bodies (the physics task) must be stepped from sim_tick too, or that task decides how the hold reaches the physics server.
By: builder (P0-025)
