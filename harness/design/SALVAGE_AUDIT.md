# Dilli Darshan: Salvage audit of the old game

Date: 2026-11-10. Task P0-003. Read only audit of `/Users/apple/Desktop/code/delhi-drive` at commit `aaeca42` (2026-09-05). Nothing was edited, built, installed or run there. Its `git status --short` was empty before and after.

## Summary (10 lines)

1. The old repo is no longer the Delhi game. It is "Barcelona Drive": 935 commits, last one on 2026-09-05, 62,297 lines of frontend source and 21,870 lines of bake code.
2. Nothing from its base layer is copied. Roads, junctions, railings, terrain fit, the tile manager and the physics bridge are rebuilt from first principles.
3. KEEP (copy after a check) is a short list: the car handling numbers, the chase camera numbers, and four CC0 sounds as placeholders.
4. REWRITE (keep the idea, new code) is the long list: the bake ideas, the intent of the tests, the debug probes, the game mode ideas.
5. DROP: the mirror, cannon-es, the one-ribbon-per-way road builder, the "6 m per layer" height model, the surface DEM, the 11 GB Delhi tiles, all Barcelona art, and the Delhi posters.
6. The mirror exists because the old world put north on +Z. That is a left-handed frame. It was patched with a scale flip on the scene instead of being fixed at the projection.
7. Roads overlap and junctions do not join because every OSM way is drawn as its own ribbon up to a shared node. There is no junction surface and no lane model.
8. Flyover heights are invented: layer times 6 m. This gives 116 junction steps that are exact multiples of 6 m, 332 ramps deleted by the bake, and roads floating up to 25 m.
9. Terrain is a 30 m surface model, blurred, that knows nothing about the width of a road. 4.9% of drivable road points float more than 0.5 m above it.
10. The most valuable thing in the repo is its written record of mistakes. Section 8 turns it into one-line rules for Dilli Darshan.

## 1. How to read this

- Paths without a prefix are inside the old repo. Example: `frontend/src/scene.js:859`.
- Paths that start with `harness/` or `src/` are in this repo.
- `CLAUDE.md:<line>` in an evidence cell means the old repo's CLAUDE.md. This repo's file is always called "this repo's CLAUDE.md".
- "Measured" means a number I measured in this audit (file counts, line counts, tile headers, image metadata) or a number the old project measured with its own tools and wrote down. The source is always named.
- Verdicts: KEEP = copy after a check, with a decisions.md entry. REWRITE = keep the idea, write new code. DROP = do not carry over.
- Shots: the existing `frontend/dist` was served read only from a script in this repo's scratch folder. The title and the hub load. The world does not: that build fetches tiles from `http://localhost:4051` (found in `frontend/dist/assets/index-D7TldxNN.js`), which is its tile server. So in-world evidence comes from code, docs and art files, not from new shots. Saved: `harness/reports/audit/old_title_and_hub.jpg`, `harness/reports/audit/old_art_sheet.jpg`.

## 2. What we believed that is wrong

These lines in this repo's CLAUDE.md "Game facts" do not match what is on disk. The orchestrator may want to correct them.

| Belief | Found | Evidence |
|---|---|---|
| `tileManager.js` is 2346 lines | 4,065 lines, 45 imports, 111 commits. `roadRenderer.js` is bigger: 6,359 lines | `wc -l frontend/src/map/tileManager.js frontend/src/map/roadRenderer.js` |
| Delhi tiles are "an old JSON format" | Binary files with a JSON header, format version 6. 9,711 `.bin` files, 0 `.json` files, 11 GB | header of `backend/tiles/delhi/16/46850/27315.bin`; `find backend/tiles/delhi -name '*.bin'` |
| Delhi tiles carry terrain | The Delhi bake was flat: elevation min 0, max 0 | same tile header: `"elevation":{"resolution":128,"min":0,"max":0,...}` |
| 580 frontend tests | 576 test declarations in 71 files, plus 29 in 5 backend files | count of `test(` and `it(` declarations in `frontend/test` and `backend/test` |
| The mirror is the main source of bugs | The old team checked: the nine world to physics negations were all correct. The bugs they paid for were data arriving in the wrong coordinate space | `docs/context/backlog.md:313` |
| The DEM is Copernicus GLO-30 | The README says Copernicus GLO-30. The bake config says SRTM GL1. Both are surface models at about 30 m | `README.md:32`, `backend/worldBuilder/config.js:5` |

## 3. Data sources and licences

| # | Source | Verdict | Evidence | Reason |
|---|---|---|---|---|
| S1 | OpenStreetMap PBF (Geofabrik extract) | KEEP the source, do not copy the file | `data/regions/delhi/region.osm.pbf`, 1,657,122,581 bytes, dated 2026-02-24 | OSM is the only open road network for Delhi. The file is 9 months old and far over the 50 MB commit limit. Download a fresh extract, record its date and checksum. Licence: ODbL 1.0. The game must show "© OpenStreetMap contributors". A public derived database must be offered under ODbL, and the baked tiles may count as one. The old game credits OSM only in `README.md:255`, never in the game (0 hits for "OpenStreetMap contributors" in `frontend/src` and `frontend/index.html`). |
| S2 | Copernicus GLO-30 DEM | DROP for ground height | `data/regions/delhi/N28E076_10m.tif` (40,529,701 bytes), `N28E077_10m.tif` (41,680,243 bytes), `region.dem.tif` (103,681,000 bytes); `docs/context/bake-pipeline.md` names the product `Copernicus_DSM_COG_10` | It is a DSM, a surface model: it measures roofs and tree tops, not ground. See section 6. Its licence allows free use with a credit line, so it stays usable as a cross-check. |
| S3 | SRTM GL1 DEM | DROP | `backend/worldBuilder/config.js:5`, `:34` (1 arc second, about 23 m by 31 m at Barcelona) | Public domain, but also a radar surface model at 30 m. Same problem as S2. |
| S4 | Bare-earth model named in `harness/design/MAP_REPAIR.md:17` (FABDEM or CartoDEM) | Not from the old repo. Flag for architecture discovery | `docs/context/v3-brief.md:94`: the old project's rule was "Never NC-licensed" because the site is public | FABDEM is, as far as I know, CC BY-NC-SA 4.0: non-commercial. If Dilli Darshan is ever public with ads or sales, FABDEM may not be allowed. CartoDEM's reuse terms also need checking. This must be settled in the Phase 0 source check, with Anmol's answer on whether the game will be commercial. |
| S5 | Minimap basemap from CARTO, later replaced by a baked city map | REWRITE | `README.md:256`; `backend/tools/buildCityMap.js` (190 lines); a 1,442,429 byte `backend/tiles/barcelona/citymap.bin` | A baked vector overview map from our own data avoids a third party tile service and its terms. |

## 4. The KEEP / REWRITE / DROP table

### 4a. Bake pipeline (`backend/worldBuilder/`, 21,870 lines with tools and tests)

| # | Item | Verdict | Evidence | Reason |
|---|---|---|---|---|
| B1 | Projection: Web Mercator times cos(origin latitude), origin at the south-west corner of the region | DROP | `frontend/src/projection.js:13-21`; the origin was declared in five places until 2026-09-05 (`docs/context/backlog.md:313`) | The scale is exact only on one latitude. Over Delhi's 50 km north to south this drifts by about 0.2% (estimate, about 25 m at 25 km). This repo already has a better one: `src/geo/projection.ts`, transverse Mercator, 0.2 m error at 25 km, with tests. |
| B2 | Slippy tiles at zoom 16 called "500 m tiles" | REWRITE | `backend/worldBuilder/config.js:30`; measured sizes: 446 Barcelona files in 149 MB (334 KB each), 9,711 Delhi files in 11 GB (1.13 MB each) | A zoom 16 tile is about 459 m at Barcelona and about 537 m at Delhi. The size depends on latitude and ties the grid to Web Mercator. Use a fixed grid in world metres. The idea of small streamed sectors is right. |
| B3 | Binary tile format: `uint32 headerLen`, a JSON header, then typed binary sections | REWRITE | `backend/worldBuilder/convertToBinary.js` (872 lines); `docs/context/bake-pipeline.md` "Binary Format Details" | Right: self describing header, optional fields stay backward compatible, a version number invalidates browser caches. Wrong: tiles mix absolute Mercator and world coordinates, which put 316,063 baked vegetation points in the wrong place (`docs/context/backlog.md:351`, N-25). Keep the layout idea. Store one coordinate space only. |
| B4 | Rule: bump the tile version when content changes meaning, not only layout | REWRITE (as a bake rule) | `CLAUDE.md:56`: v11 has the same layout as v10 and exists only to flush caches | A re-bake at the same version left every player on old tiles. Cheap rule, expensive lesson. |
| B5 | Vector tiles: the client builds every triangle on every load | REWRITE | measured by the old game: 2,489 ms of main-thread work to build 14 tiles, 941 ms of it terrain physics (`docs/context/bake-vs-runtime-audit.md:9-13`) | Their own conclusion is the one to take: bake the decisions (clips, offsets, placements), not only raw vectors, and not raw vertex dumps either. |
| B6 | `noClipTileStrategy`: every tile carries the whole of every way that touches it | DROP | `backend/worldBuilder/config.js:56`; 5,308 of 38,813 ways were in more than one tile and 37.8% of all drawn road was a duplicate (`docs/context/barcelona-road-system.md:631`) | It caused double-drawn roads, z-fighting and double-counted statistics. Tiles must hold only what is inside them, with seam data that matches exactly. |
| B7 | One road width model with a named cross section (carriageway, parking, kerb to kerb, sidewalk, corridor) | REWRITE | `backend/worldBuilder/roads/roadWidthModel.js` (317 lines); before it, 73% of residential roads were drawn at exactly 4 m (`docs/context/barcelona-road-system.md:444`); ten width tables were deleted | The best single idea in the bake: one model, one reader, never re-derive a width. The tables are Spanish (Norma 8.2-IC). Delhi needs IRC based defaults per road class. It becomes the lane set source for the lane-level model. |
| B8 | Decide per way, before the tile split, with stable seeds | REWRITE (as a rule) | `docs/context/barcelona-road-system.md:752` (R-0); 15.4% of junction approach widths were a fabricated 6 m because of a per-tile lookup (`docs/context/v3-execution-tracker.md:315`, H11) | A railing or a width decided per tile can disagree at a seam. The way is the unit of meaning. |
| B9 | Structure heights from tags: bridge = layer times 6 m, tunnel depth 12 m, ramps 25 or 35 m long | DROP | `backend/worldBuilder/config.js:61-66`; `backend/worldBuilder/roads/elevationProcessor.js:42`; `backend/worldBuilder/pbfHighways.js:233` | Root cause of junction steps and floating ramps. See section 5. |
| B10 | Repair modules: OSM fixer, ramp resolver, way stitcher | REWRITE | `roads/OsmDataFixer.js` (1,286 lines), `roads/RampResolver.js` (740), `roads/wayStitcher.js` (190, switched off at `buildRegion.js:728`); the fixer edited a copy that nothing read, so 9,576 removals and 50 links went nowhere (`docs/context/v3-execution-tracker.md:219`) | The code is not trusted. Its policy was to drop, not repair (`buildRegion.js:35`: "Better a clean gap than a mangled road"), and it was terrain blind by design (`roads/OsmDataFixer.js:11`). |
| B11 | Repairs recorded as data in a versioned patch file, with provenance (rule, AI, human) | REWRITE (design never built there) | `docs/context/osm-repair-layer.md:42` | Same idea as the per-tile overrides in `harness/design/MAP_REPAIR.md`. Their reasons hold: reproducible bakes, reviewable diffs, one bad repair can be removed alone. |
| B12 | Defect census before any repair rule | REWRITE | `docs/context/osm-repair-layer.md:194`; `data/regions/barcelona/defect-census.json`; of 19,312 road crossings only 2 were unexplained, so a planned rule was never written | Counting first killed four planned tickets. It becomes the map health report. |
| B13 | Offline audit scripts | REWRITE | `backend/tools/roadVsTerrain.mjs` (162 lines), `crossingCensus.mjs` (307), `junctionStepAudit.mjs` (106), `deadEndTriage.mjs` (105), `routeBench.mjs` (107) | Each one answers a question the map health report must answer on every bake. The code reads the old tile format. |
| B14 | Invariant: a drivable surface implies a floor, and a failing bake does not write tiles | REWRITE | `backend/worldBuilder/terrain/validateTunnelFloors.js` (294 lines); `frontend/test/surfaceFloor.test.js` (9 tests) | A bake-blocking check is the right shape. Extend it: a drivable surface above ground implies an edge. |
| B15 | Baked sky visibility grid for ambient occlusion | REWRITE | `backend/worldBuilder/aoBaker.js` (292 lines): 128 by 128 bytes per tile, 16 rays, 2 m steps to 60 m | A cheap way to get soft street-canyon shading with no runtime cost. A candidate for the render foundation. Decide in architecture discovery. |
| B16 | DEM blur and "selective smoothing" | DROP | `backend/worldBuilder/demLoader.js:25-31`; it removed relief with RMS 3.31 m, max 5.5 m, on 65.2% of cells (`docs/context/osm-repair-layer.md:246`) | It hides surface-model noise by also blurring real ground. A bare-earth model does not need it. |
| B17 | Road stitching, dedupe and junction classification code | DROP the code | `roads/roadTopologyNormalizer.js` (142 lines), `junctions/JunctionClassifier.js` (124), `junctions/MergeGeometryBuilder.js` (234) | Built for centreline ribbons with gore wedges added on top. The lane-level model replaces all of it. |
| B18 | The baked Delhi tiles | DROP | 9,711 files, 11 GB, format v6, flat elevation (measured) | See section 5.8. |

### 4b. Car, camera, physics, game systems

| # | Item | Verdict | Evidence | Reason |
|---|---|---|---|---|
| C1 | Car handling numbers on the Rapier raycast vehicle | KEEP (numbers only, as the starting tune) | `frontend/src/car/carPhysicsRapier.js:15` gear top speeds 34, 60, 84, 100, 106, 110 km/h; `:36-38` box half extents 0.95, 0.6575, 2.395 m and mass 1730 kg; `:42` half track 0.78 m, axles at 1.43 m, wheel radius 0.34 m, rest length 0.32 m; `:43` max steer 0.64 rad; `:62-63` steer rate 1.10 rad/s out, 1.85 rad/s back; `:67-68` engine force 5200, yaw damping 5200; `:84` inertia 3600, 3820, 814; `:111-117` suspension 28, 0.82, 0.88, travel 0.3 m; `:211` steer lock falls with speed; `:251` brake 90 | These numbers came out of many drive sessions with Anmol (tickets V-1 to V-15 in the changelog). They are for the same Rapier vehicle controller we are likely to use. The file itself says it is a first pass (`:7-8`), so they are a start, not a target. Checks: see decisions.md. |
| C2 | Chassis clearance rule: the body box must clear more than one wheel radius | KEEP (as part of C1) | `frontend/src/car/carPhysicsRapier.js:21-37`: the box used to stop the car on kerbs at 24.5 cm clearance, fixed to 36 cm; `frontend/test/chassisClearance.test.js` (3 tests) | A cheap rule that prevents "car stops dead on a small ridge". Rewrite the test here. |
| C3 | Chase camera numbers | KEEP (numbers only, as the starting rig) | `frontend/src/car/carCamera.js:95-97` FOV 70 plus up to 21 degrees, peak at 80 km/h; `docs/context/vehicle-system.md:238`: 6.6 m behind, 2.5 m up, look-ahead 4.0 m, position lerp 0.16, look lerp 0.22, close rig 4.5 m and 2.05 m, view change as a 0.6 s arc over the roof | The camera is the best-finished part of the old game, with tests (`frontend/test/cameraViews.test.js` 12, `cameraSettle.test.js` 5). Checks: see decisions.md. |
| C4 | The car physics code itself | REWRITE | `frontend/src/car/carPhysicsRapier.js:120-162`: it fakes a cannon-es body and wheel list so old callers work unchanged; runs on the main thread | New code talks to Rapier directly, in a worker, in the unmirrored frame. |
| C5 | Fixed 60 Hz physics step with pose interpolation, teleport guard | REWRITE | `frontend/src/car/carPhysicsRapier.js:126-140`, `:266-326` | Correct pattern. It moves into the physics worker design. |
| C6 | Collider streaming by distance | REWRITE | `frontend/src/physics/rapierWorldAdapter.js:175` (in at 220 m, out at 290 m); measured: 32,000 colliders cost 8.3 ms per step, 2,200 cost 0.96 ms; Rapier step about 1.0 ms against cannon-es 2.3 ms (`docs/context/rapier-physics.md:11`, `:27`) | The numbers feed the physics bench. The adapter does not come over. |
| C7 | Dead tuning constants | DROP | `frontend/src/config.js:156-158` hold car values that nothing reads (`docs/context/gotchas.md:63`, G-03) | Lesson: one place for tuning, and a test that fails on an unused constant. |
| C8 | Traffic: 28 kinematic cars following lane-offset centrelines, queueing, signals, turns | REWRITE | `frontend/src/car/trafficSystem.js:56` (MAX_CARS 28), `:115`; turn rule fixed after 21.3% of way ends were dead ends for traffic (`docs/context/traffic-realism-plan.md:35`) | Ideas hold: cheap kinematic traffic, signal phase from the clock. Delhi traffic needs a lane graph and mixed vehicles. Not before the game design sign-off. |
| C9 | A* road router with a time-based ETA | REWRITE | `frontend/src/game/router.js` (259 lines), 15 tests; measured worst case 1.5 ms on a 2 km trip over 4,812 segments (`docs/context/backlog.md:126`, M-10) | Small and proven fast on the main thread. It must be rewritten on the new lane graph. |
| C10 | Game modes: taxi, delivery, checkpoint dash, police chase, free roam, a wallet | REWRITE (ideas only) | `frontend/src/game/` (13 files); `docs/context/game-modes.md:1-12` | Input for game design discovery. One lesson to carry: a live HUD value needs a dead band, or it flickers 10 times a second (`docs/context/backlog.md:53`, M-8). |
| C11 | Debug probes: name the surface under a pixel, list every surface in a column, find every floating road, a road fit probe, an F9 drive report | REWRITE | `CLAUDE.md:78` onward (`_ddPick`, `_ddColumn`, `_ddNoGround`, `?debug=roadfit`); `frontend/src/ui/driveReport.js` (387 lines) | They exist because guessing from screenshots was wrong four times in one ticket (`docs/context/backlog.md:263`). Here they become `window.__game.debug` probes and verify scenarios. |

### 4c. Runtime world code (`frontend/src/`, 160 files, 62,297 lines)

| # | Item | Verdict | Evidence | Reason |
|---|---|---|---|---|
| R1 | `worldGroup.scale.x = -1` and every negation that follows from it | DROP | `frontend/src/scene.js:859`; 25 hand-written negations in 7 files; the word "mirror" 187 times in 51 files (grep) | Section 5.1. |
| R2 | cannon-es | DROP | `frontend/package.json:25`; 15 source files import it (grep) | Section 5.7. |
| R3 | Road renderer: one flat ribbon per way, markings as extra geometry, depth-bias stacking | DROP | `frontend/src/map/roadRenderer.js` (6,359 lines), `:665` `buildFlatRibbonGeometry`; a 70.9 ms build spike for markings (`docs/context/v3-master-plan.md:89`) | Section 5.2. |
| R4 | Tile manager | DROP | `frontend/src/map/tileManager.js` (4,065 lines) | Section 5.6. |
| R5 | Ground layer scheme: one table for depth bias, one for height, and a test that they agree | REWRITE only if coplanar layers remain | `frontend/src/map/groundLayers.js` (292 lines); the audit found the two tables in opposite order for all four paint classes (`docs/context/ground-layering.md:27`); `frontend/test/groundStack.test.js` (22 tests) | The better fix is to have no stacked coplanar surfaces: one road surface mesh, markings in the material or as true decals. If any stacking stays, this scheme with its test is the way. |
| R6 | Vegetation instance pools | REWRITE | `frontend/src/map/vegPools.js` (238 lines): fixed capacity, never grow, never delete, reuse slots (`docs/context/v3-execution-tracker.md:299`, H3) | The invariants are worth keeping in the instancing design. The code is tied to old tiles. |
| R7 | Clustered light grid for street lights at night | REWRITE | `frontend/src/map/lightGrid.js` (492 lines); it replaced six separate night fakes (`docs/context/v3-master-plan.md:74`) | A candidate technique for night lighting. Decide in architecture discovery with the signed style. |
| R8 | Aerial perspective fog (haze by distance and height, sun-side glow) | REWRITE | `frontend/src/scene.js:666-711`; judged "keep on merit" by the old 12 audit review (`docs/context/v3-master-plan.md:74`) | Delhi haze is part of the place. The approach is sound. The shader is rewritten in the new render foundation. |
| R9 | Adaptive resolution | REWRITE with care | `frontend/src/ui/adaptiveResolution.js` (244 lines); each resize cost 70 to 144 ms and it misfired during loading (`CLAUDE.md:68`) | Only arm it once the world is drivable. Measure the resize cost first. |
| R10 | Region profile idea: the look of a city lives in one swappable profile | REWRITE | `docs/context/v3-brief.md:67`; `frontend/src/regions/index.js:14` | Dilli Darshan is one city, but palette, signage script and road standards should still sit in data, not in renderers. |

### 4d. Tests (576 frontend, 29 backend)

All are plain `node --test` logic tests. None runs a browser. Read for intent, none is copied.

| # | Intent worth rewriting here | Verdict | Evidence (file, test count) | New home |
|---|---|---|---|---|
| T1 | Bake and game use one projection and agree on real coordinates | REWRITE (partly done in P0-001) | `frontend/test/projectionAgreement.test.js` (7) | One projection module imported by both sides. Landmark tests already exist. |
| T2 | A feature reaches only the tiles it touches; a road that leaves and re-enters a tile gives two runs | REWRITE | `tileClip.test.js` (6), `waterTileSplit.test.js` (5) | Bake tests for the tile splitter. |
| T3 | Nothing painted or paved sits under or inside another surface | REWRITE | `groundStack.test.js` (22), `sidewalkClip.test.js` (12) | Mesh builder tests: no overlapping road faces, footpath never on a carriageway. |
| T4 | Junction rules: T junctions are found, tangents point away from the node, corners get arcs | REWRITE | `junctionTees.test.js` (16), `junctionTangent.test.js` (3), `junctionArc.test.js` (7) | Junction builder tests in the lane-level model. |
| T5 | Bake copy and runtime copy of one algorithm agree | REWRITE as a ban | `widthTaper.test.js` (4), `roadWidths.test.js` (10) | The rule here: one implementation, shared. A lint check replaces these tests. |
| T6 | A drivable surface has a floor; the chassis clears a wheel radius | REWRITE | `surfaceFloor.test.js` (9), `chassisClearance.test.js` (3) | Bake-blocking rule plus a drive scenario over kerbs. |
| T7 | Railings: not across merges or roundabout entries, faces point outward | REWRITE | `guardRailMask.test.js` (6), `guardRailWinding.test.js` (5), `barrierStyles.test.js` (8) | Deck edge tests in the mesh builder. |
| T8 | Props and plants are tested against every nearby carriageway, not only the road they were placed from | REWRITE | `roadClearance.test.js` (6), `rockRoadGuard.test.js` (10), `pedestrianPaths.test.js` (20) | Placement rule in the bake, with a count in the map health report. |
| T9 | Streaming hygiene: everything a tile made is freed, budgets are fair, nothing starves | REWRITE | `tileDisposal.test.js` (14), `fairBudget.test.js` (7), `loadBudget.test.js` (6), `terrainLod.test.js` (8) | Streaming system tests and a memory scenario. |
| T10 | Camera: views cycle, close is closer, no drift back after a move | REWRITE | `cameraViews.test.js` (12), `cameraSettle.test.js` (5) | Camera scenarios through the hooks. |
| T11 | Traffic and routing: two signal axes are never both green, right-angle turns are legal, routes follow roads | REWRITE after game design | `trafficSignals.test.js` (9), `trafficTurns.test.js` (4), `trafficContact.test.js` (6), `router.test.js` (15) | Traffic and router tests on the lane graph. |
| T12 | Look rules as numbers: night is darker than day and not flatter, highlights roll off | REWRITE after style sign-off | `envPresets.test.js` (6), `colorGrade.test.js` (3), `lightGrid.test.js` (12) | `harness/verify/look_rules.json` and lighting preset tests. |
| T13 | Every asset the code asks for exists on disk | REWRITE | `ktx2Library.test.js` (4); the old build still asks for 11 files that do not exist (9 audio, 2 loading images: 404s in my shot run) | Asset manifest test. |
| T14 | No call to an export that was never imported | DROP | `undefinedRefs.test.js` (3) | TypeScript does this. |
| T15 | Barcelona art tests (facades, tree cards, roofs, awnings, sign atlas, coastline) | DROP | `facadeArray.test.js` (26), `treeCards.test.js` (19), `storeyBands.test.js` (14) and 10 more files | Tied to Barcelona art and techniques. Revisit only if the signed style uses the same technique. |

Gap to remember: a ReferenceError inside the tile build emptied the world of vegetation and `npm test` stayed green, because no test ran the game (`docs/context/v3-execution-tracker.md:307`, H16). The harness scenarios here cover that gap.

### 4e. Assets (`art-src/` 130 MB, not in git; `frontend/public/` 35 MB)

| # | Item | Verdict | Evidence | Reason |
|---|---|---|---|---|
| A1 | Delhi political posters, movie poster | DROP the files, REWRITE the idea | `art-src/legacy/political_poster_01.png`, `_02.png`, `movie_poster_01.png`: 512 by 512, 3 channels, no alpha (measured with sharp); the transparency checkerboard is painted into the pixels; an AI tool mark is visible; they show a real politician and real party names (`harness/reports/audit/old_art_sheet.jpg`) | Unusable as decals (no alpha, low resolution). Real faces and party symbols are a risk in a public game. Delhi wall posters are a strong signature: request new ones with invented parties and candidates. |
| A2 | Paan stain | DROP the file, REWRITE the idea | `art-src/legacy/paan_stain_01.png`: 256 by 256, no alpha, checkerboard baked in (measured) | It reads as a blood splatter and cannot be blended. Request a proper set. |
| A3 | Delhi street furniture renderers | REWRITE (as a list of what Delhi needs) | `art-src/delhi/` 5 files: yellow and black crash barriers, median dividers, cat's-eye studs every 6 m, vendor carts, wall decals; decal densities at `art-src/delhi/decalRenderer.js:18-20` (paan 0.15 per metre, posters 0.04 per metre) | These name the Delhi signatures the old game once had. They feed `CITY_BRIEF.md`. The code targets the old road format. |
| A4 | Barcelona facades, shopfronts, roofs, panot paving, kerbs | DROP | `art-src/facades-v1` 20 MB, `shopfronts-v1` 18 MB, `road-v1` 10 MB, `kerb-v1` 7.5 MB, `roof-v1` 2.8 MB (du) | Wrong city and normalized to a Barcelona palette. |
| A5 | Tree and bush cut-outs | DROP | `art-src/trees-v1` 20 MB (6 species), `bushes-v1` 15 MB | Barcelona species. Delhi needs neem, peepal, banyan, gulmohar and others, in the signed style. |
| A6 | CraftPix vegetation | DROP | `art-src/delhi/README.md:17`: "CraftPix-licensed. Never ship." | Licence forbids redistribution. |
| A7 | Hero car `bmw_m3.glb` | DROP | 765,656 bytes; no licence record in any doc (grep); every car part has a single UV point, so it cannot take a texture (`docs/context/v3-master-plan.md:75`); real brand | Unknown licence, trademark, no UVs. |
| A8 | Traffic car models (Kenney kit, 10 files) | DROP as final art | `frontend/public/models/cars/*.glb`, 173 KB to 1.9 MB; CC0 (`docs/context/ets2-target-audit.md:170`); banned by the old art ruling as toy-like (`docs/context/v3-master-plan.md:30`) | Western cars in a palette style. Allowed as grey-box stand-ins in style tests because they are CC0. Delhi needs autos, buses, two-wheelers, hatchbacks. |
| A9 | Pedestrian models | DROP | `frontend/public/models/people/*.glb`: 1,786 to 2,776 triangles, 0 textures (`docs/context/pedestrian-system.md:35`); licence per model not recorded (`README.md:258`) | No licence trail, no textures, not Delhi. |
| A10 | Engine loops and horn | KEEP (as placeholders) | `frontend/public/audio/engine_idle.wav`, `engine_mid.wav`, `engine_high.wav`, `horn.ogg`; CC0 per `frontend/public/audio/ATTRIBUTION.md` | Free to use, small (40 to 76 KB), and they let the engine blend and the horn be built before real Delhi sounds arrive. Checks: see decisions.md. |
| A11 | City ambience beds, skid loop | DROP | `ambience.ogg` (1.39 MB, "Sunday in the city street noise", public domain), `skid.ogg` (CC-BY 3.0, needs a credit) per `ATTRIBUTION.md` | The bed is a quiet western street, wrong for Delhi. The skid needs a credit line. Both go to the audio request list. |
| A12 | Menu art, logos, loading images | DROP the files, REWRITE the layout idea | `art-src/menu-originals/` 10 MB; `harness/reports/audit/old_title_and_hub.jpg` | Barcelona branded. The hub layout and the loading facts are good ideas (see QUALITY_AUDIT "What to protect"). |
| A13 | Texture build tools: KTX2 encode, half-size variants for weak machines, a normalize step | REWRITE | `tools/encodeKtx2.py`, `tools/build-ktx2-library.py`, `tools/artNormalize.py`; measured there: roof plates 2.83 MB to 0.44 MB as one KTX2 array, total texture download 24 MB to 20 MB (`docs/context/v3-execution-tracker.md:31`) | KTX2 and array textures are in the architecture bench. The Python tools are Barcelona specific. |

### 4f. Lessons in the docs (README, TECHNICAL_DOCUMENTATION.md, docs/context, TODO.md, CLAUDE.md)

`TODO.md` is a pointer to `docs/context/backlog.md`. `TECHNICAL_DOCUMENTATION.md` (51 KB, April) and the README still describe cannon-es as the physics engine and are stale. The live knowledge is in `docs/context/` (2.3 MB).

| # | Lesson | Verdict | Evidence |
|---|---|---|---|
| L1 | Check the premise before the work. Four tickets died when re-measured | KEEP as a rule | `docs/context/v3-execution-tracker.md:95-100` |
| L2 | Assume a second call site. Five defects were a fix that landed on one of two code paths | KEEP as a rule | same block; H10 and H12 at `docs/context/v3-execution-tracker.md:306` and `:314` |
| L3 | A counter where a decision is made does not prove the decision reached the output | KEEP as a rule | `docs/context/v3-execution-tracker.md:219` (N-37) |
| L4 | A probe that reports zero is a suspect. Report how many things the probe looked at | KEEP as a rule | `docs/context/v3-execution-tracker.md:310` (H19) |
| L5 | Do not diagnose from a screenshot when a probe can name the surface | KEEP as a rule | `docs/context/backlog.md:263` (four wrong guesses) |
| L6 | Automated browsers cannot measure load or frame time in an unfocused tab | KEEP, check against our harness | `docs/context/v3-execution-tracker.md:311` (H15); `docs/context/gotchas.md:1071` |
| L7 | Every value has one source. "Mirror of X" comments failed three times | KEEP as a rule | `docs/context/barcelona-road-system.md:444` (ten width tables), `:487` |
| L8 | Per-tile sums double count anything that crosses tiles | KEEP as a rule | `docs/context/v3-execution-tracker.md:309` (H18: tree spacing read as 27.2 m, real 14.8 m) |
| L9 | A wrong repair is worse than a gap. Invented structure is proposed, reviewed, then applied | KEEP as a rule | `docs/context/osm-repair-layer.md:161` |
| L10 | Engineering before art. Art on top of a coarse LOD is invisible | KEEP as a rule | `CLAUDE.md:174` |
| L11 | The owner's earlier quality reference was Euro Truck Simulator 2: "not too good but definitely better than what we have" | Ask again in the style interview | `docs/context/v3-brief.md:15` |
| L12 | Assets must be free and never non-commercial licensed, because the site is public | Ask again (it decides the DEM choice) | `docs/context/v3-brief.md:94` |

## 5. Root cause of each base-layer failure

### 5.1 The mirror axis

Root cause in one line: the old world frame put north on +Z with east on +X, which is a left-handed frame, and the mismatch with three.js was patched with a scale flip on the scene group instead of being fixed once at the projection.

- The flip: `frontend/src/scene.js:859`. Their own record calls it "the lowest-friction fix" (`docs/context/decisions.md:215`).
- Physics bodies do not live under that group, so every one is negated by hand: `px = -(wx - originX)`. 25 such lines in 7 files, 10 of them in `tileManager.js` (for example `frontend/src/map/tileManager.js:1007`).
- The flip reverses triangle winding. 74 `DoubleSide` materials, text drawn with flipped U (`frontend/src/map/shopSignRenderer.js:6`), a hand-mirrored quaternion (`frontend/src/map/tileManager.js:863`).
- Debug probes broke three times in one day on the conversion (`frontend/src/main.js:237`).
- The deeper finding is theirs (`docs/context/backlog.md:313`): the negations were all correct. The costly bugs were "space" bugs. One tile holds absolute Mercator, world and physics-local coordinates, and a point's `y` field means world Z (`docs/context/coordinate-systems.md`). Results: 316,063 vegetation points in the wrong space (N-25), a road mask 240 km away from its trees (`docs/context/v3-execution-tracker.md:193`, N-7), an audit off by 5,069,611 m (`docs/context/backlog.md:165`).

What to do: already decided here (north is -Z, no flips, landmark tests). Add: one coordinate space after ingest, named types for each space, and a magnitude check where data crosses from bake to game.

### 5.2 Overlapping road meshes

Root cause in one line: every OSM way is drawn as its own flat ribbon along its centreline at its own full width, so ribbons overlap wherever ways meet, run side by side or cross a tile edge, and the overlaps were hidden with depth bias instead of removed.

- The builder: `frontend/src/map/roadRenderer.js:665`. "Flat ribbon with miter joins, 2 verts per centreline point" (`docs/context/barcelona-road-system.md:35`).
- Tile edges: whole ways are copied into every tile they touch. 37.8% of drawn road was a duplicate with different shading, which showed as z-fighting (`docs/context/barcelona-road-system.md:631`).
- Dual carriageways: OSM maps one street as two ways, each tagged with all lanes. Each was drawn 16.4 m wide, so the street was 32 m wide and overlapped itself. 28 of 57 overlapping pairs (`docs/context/v3-execution-tracker.md:178`, N-21, still open).
- Footpaths: 14.3% of pavement vertices lay inside a carriageway, worst 5.55 m deep (`docs/context/barcelona-road-system.md:585`).
- The cover-up: a depth bias table and a height table that disagreed in 5 pairs (`docs/context/ground-layering.md:27`), and terrain 1 cm above the road, held back only by polygon offset (`docs/context/v3-execution-tracker.md:185`).

What to do: the lane-level model. Roads are lane sets. A junction is one surface built from lane edges. A boolean step guarantees that no two road faces overlap, and a test counts overlapping area as zero.

### 5.3 Misplaced railings

Root cause in one line: railings are decided per road, per tile, from tags and from a height that is itself derived from tags, so there is no real deck edge for a railing to follow.

- The gate: `frontend/src/map/roadRenderer.js:4149` (`isElevatedGuardRailRoad`: bridge, ramp, layer above 0, crossing a trench). The mask: `:4240`.
- Classification is thin: only 63 bridge segments in all of Barcelona against 1,044 tunnel segments (`docs/context/barcelona-road-system.md:717`). A road nobody tagged as elevated gets no rail and no height.
- Recorded faults: a rail straight across two merging lanes (N-35), ramps with no rail because an end margin trimmed short ramps to nothing (666 ramps, N-24 and N-38), a floating roundabout with no barrier (N-36), "no elevation data beside the lane" read as "no drop" (N-30). All in `docs/context/v3-execution-tracker.md:213-220`.
- Visual and collider are made by two builders that must be kept in step by hand.
- No level of detail: a post every 3 m, about 1,656 triangles per 100 m (`docs/context/barcelona-road-system.md:729`, R-B2).

What to do: railings, kerbs and parapets are outputs of the deck mesh builder. Every free deck edge gets an edge treatment, chosen per way before tiling. The collider comes from the same edge curve.

### 5.4 Junctions that do not join

Root cause in one line: there is no junction object. In plan, ways simply end at a shared node and patches are laid on top. In height, each way computes its own profile from tags, so two ways can disagree about the height of the node they share.

- Plan patches: gore wedges (`backend/worldBuilder/junctions/MergeGeometryBuilder.js`, 234 lines), a 20 m width taper, corner fills that are switched off (`frontend/src/config.js:269-273`). Two of them exist twice, once in the bake and once in the game, chosen per tile (`docs/context/v3-execution-tracker.md:306` and `:314`, H10 and H12).
- Height: 116 junctions where drivable ways disagree about the shared node's height. 106 are exactly 6 m, 8 are 12 m, 1 is 24 m (`docs/context/v3-execution-tracker.md:33`). That is the layer step (`backend/worldBuilder/config.js:61`).
- Data: way stitching is switched off (`backend/worldBuilder/buildRegion.js:728`). The bake deleted 332 ramps it could not resolve (`docs/context/osm-repair-layer.md:201`; `buildRegion.js:35`). The fixer's output was thrown away for months (`docs/context/v3-execution-tracker.md:219`).
- Their fix for steps hit a design limit: a through way cannot bend, so a short stub must absorb a 6 m step (`docs/context/v3-execution-tracker.md:33-93`).

What to do: junctions are first-class objects built from node clusters. Heights are solved on the whole graph: one height per node, grade limits as constraints. Repairs replace drops, and every drop is logged with its way id.

### 5.5 Terrain and road misfit

Root cause in one line: the ground is a blurred 30 m surface model, the road and the ground get their heights from separate code that only agrees along the centreline, and structure heights from tags are added on top of that ground.

- The terrain grid is 128 by 128 per tile, about 3.9 m cells (`backend/worldBuilder/terrainBaker.js:42`), upsampled from 30 m data. It is never flattened under a road's width. The road "drapes" (`docs/context/decisions.md:7`, D-16).
- Measured against the shipped tiles: 4.9% of drivable road points float more than 0.5 m, worst 24.31 m, p99 6.37 m (`docs/context/osm-repair-layer.md:234`). About 22% of the floating points sit at exact multiples of 6 m (`:298`).
- Surface roads marked as ramps float more than 2 m in 27.5% of cases (84 of 306). The ramp code is terrain blind and its profile is added to the ground height (`docs/context/v3-execution-tracker.md:225`, N-23, diagnosed, never fixed).
- A runtime probe on the drawn meshes found 8.8% of road points buried, worst 9.6 m (`docs/context/terrain-tunnel-rework-plan.md:547`).
- Two code paths disagree: placement uses max(road, terrain), the drawn ribbon does not (`docs/context/terrain-tunnel-rework-plan.md:490`).
- No fill geometry: pavements hang over nothing (`docs/context/v3-execution-tracker.md:214`, N-31, open), embankment skirts arrived late (`:27`, N-54).
- For Delhi none of this was even tried: the Delhi tiles are flat (section 2).

What to do: a bare-earth model. An elevation solver for the road graph. Then the terrain is changed to fit the roads: flattened across the full corridor with a shoulder blend, cut and fill where needed. The road sits above the ground in space, not by depth bias. Tests: no terrain vertex above the road inside a corridor, no road vertex more than a set distance above its ground unless it is a tagged or repaired structure.

### 5.6 `tileManager.js` (2,346 lines then, 4,065 now)

Root cause in one line: there was no interface between "a tile's data has arrived" and "the systems that build things from it", so every new feature was wired into the tile lifecycle by hand in one file.

- It owns streaming, the four-phase build, level of detail, mesh merging, colliders for roads, tunnels, buildings and scenery, disposal and debug helpers (`frontend/src/map/tileManager.js`: 45 imports, 111 commits).
- Costs: a default that disposed shared textures on the first tile unload (`docs/context/v3-execution-tracker.md:302`, H6); one error in one phase silently emptied the world (H16); a level of detail that is one distance per 500 m tile (`docs/context/v3-master-plan.md:76`).
- The same growth hit the road renderer: 3,205 lines in May (`docs/context/barcelona-road-system.md:33`), 6,359 in September.

What to do: a small streaming core that only decides which tiles are resident, in what order and within what time budget. Each system registers build and dispose functions with its own budget. A test caps module size and fails the build when a tile system reaches into another.

### 5.7 The leftover cannon-es layer

Root cause in one line: the physics engine was swapped but the data model was not, so cannon-es stayed as the language colliders are described in and Rapier is fed through a translator.

- `frontend/src/map/tileManager.js` still builds `CANNON.Body` objects. `frontend/src/physics/rapierWorldAdapter.js` (340 lines) mirrors each shape into Rapier. The cannon world is never stepped (`docs/context/rapier-physics.md:41`).
- The car pretends to be a cannon vehicle so old callers keep working (`frontend/src/car/carPhysicsRapier.js:2-5`).
- The terrain heightfield's orientation is probed at runtime with test raycasts because nobody could state it (`docs/context/rapier-physics.md:33`).
- 15 source files import cannon-es. It ships in the bundle for no simulation work.
- Physics runs on the main thread next to rendering.

What to do: the bake writes plain collider data per tile (heightfield, boxes, meshes). A Rapier worker reads it directly. One convention, stated in TECH.md and tested with a known tilted plane.

### 5.8 The 11 GB of Delhi tiles

Root cause in one line: the whole Delhi region was baked at once in an early format that copies whole ways into every tile they touch and stores per-tile meshes, and it was never re-baked after the format moved on.

- Measured: 9,711 files, 11 GB, 1.13 MB average. Format v6, where the current reader expects v11. Elevation flat (section 2). At about 0.29 square km per tile that is roughly 2,800 square km (estimate).
- For comparison, Barcelona after one clean-up is 446 files in 149 MB, 334 KB each. That clean-up alone cut its store from 567 MB to 177 MB (`docs/context/v3-execution-tracker.md:267`).
- The tiles are ignored by git (`.gitignore`), so they exist only on this machine, and a bake fix never reaches a deployed build by a push (`docs/context/backlog.md:235`).

What to do: never copy them. Re-bake from sources through the repair layer, pilot area first. Give tiles a byte budget per tile and per square km in `perf_budgets.json`. Tiles are build outputs with a version stamp, produced by one command.

## 6. Why a surface model makes roads float or sink

Copernicus GLO-30 and SRTM are surface models. Radar from orbit sees the top of whatever is there: roofs, tree crowns, flyover decks. Each height is an average over a cell about 30 m wide.

- A 10 m wide street between 15 m buildings shares its cell with the roofs. The "ground" under the street reads several metres too high, and by a different amount in the next cell. A road sampled along it gets bumps that are not there.
- Where a flyover crosses, the deck is read as ground. The ground road under it rises towards the deck and the flyover, lifted by a tag rule, ends up too high.
- The old pipeline blurred the model to hide this (`backend/worldBuilder/demLoader.js:25-31`). Blurring spreads roof height into the streets and flattens real slopes. Roads fitted before or after the blur then disagree with the ground that ships.
- A 30 m cell also cannot describe a road's cross section. On any side slope one kerb is below ground and the other is above it.
- In Delhi the real relief is small outside the Ridge, so building and tree noise is as large as the real signal. That is the worst case for a surface model.

A bare-earth model removes the first three problems. The fourth is solved only by making the terrain conform to the road, which no DEM does for you.

## 7. Open questions this audit raises

For Anmol, in the interviews:
1. Will Dilli Darshan ever be public or commercial? It decides whether a non-commercial ground model is allowed (S4).
2. Posters: are invented parties and invented candidates fine, in place of real ones (A1)?
3. Is Euro Truck Simulator 2 still the quality reference, or is it a different bar now (L11)?
4. The old car topped out near 110 km/h on purpose. Is that right for Delhi, or should some roads allow more?

For architecture discovery:
5. Which bare-earth source passes the licence check and the quality check on the pilot area?
6. Fixed metric tile size, and bytes per tile, measured in the data bench.
7. How much of the mesh is built at bake time and how much in the game (B5).

## 8. What Dilli Darshan must do differently

Coordinates
- One world frame from the projection onward: east +X, north -Z, up +Y, metres. No flips anywhere.
- One coordinate space after ingest. Each space has a named type. A magnitude check runs where baked data enters the game.
- One projection module, imported by the bake and the game. No second copy "that must match".

Sources and licences
- Ground height from a bare-earth model that passes a licence check. Surface models only as a cross-check.
- Pin every source file by date and checksum. Show OSM attribution in the game.
- No asset without a recorded licence. No real people or real party symbols in art.

Bake
- Treat source data as broken. Count defects before writing repair rules.
- Repairs are data: logged, versioned, each one removable. Repair instead of drop. Every drop is logged.
- A repair must be proven at the output, not only counted where it was decided.
- Decide per way, before the tile split. Tiles hold only what is inside them. Seams match exactly.
- One implementation per algorithm, shared by bake and game. No copy pairs.
- One source per value. Any fallback default has a counter that is printed.
- A failed invariant blocks the bake from writing tiles.
- Bump the tile version when content changes meaning.

Roads and junctions
- Roads are lane sets with widths from one width model with Delhi defaults.
- A junction is one surface built from lane edges. No two road faces overlap. A test proves it.
- Parallel ways of one street are recognised as one street before widths are assigned.
- Heights are solved on the graph: one height per node, grade and clearance limits. No "layer times 6 m".
- Railings, kerbs and parapets come from deck edges in the mesh builder, with matching colliders.

Terrain
- The terrain is changed to fit the roads: flat across the corridor, blended at the shoulder, cut and fill.
- The road sits above the ground in space. Depth bias is never the thing that hides a misfit.
- Bridges and flyovers get real supports and real ends: abutments, piers, embankments.

Streaming and structure
- A small streaming core. Systems register build and dispose with budgets. No file owns everything.
- Module size limits enforced by a test. An error in one system cannot silently empty the world.
- Level of detail per object or per small cell, not one distance per tile.
- Tiles have a byte budget. Tiles are build outputs and are never committed.

Physics
- Rapier only, in a worker, fed plain collider data from the bake. No adapter, no second physics library.
- Collision shapes come from the same geometry as the visible mesh, with a test that they match.
- One file for car tuning. No dead constants.

Render and assets
- The render foundation is chosen with measurements: baked sky occlusion, haze, light grid and KTX2 arrays are candidates from the old game.
- No stacked coplanar surfaces. Markings live in the road material or as real decals.
- Art arrives through the request system in the signed style, with licence and source recorded.

Process
- Measure before fixing. Check a ticket's premise first.
- Prefer a probe that names the thing over a guess from a screenshot.
- A probe that returns zero must say how many things it looked at.
- Tests that run the real game guard what unit tests cannot see.
