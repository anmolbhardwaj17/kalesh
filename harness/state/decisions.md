# Decisions

What still binds, short. The owner's words and the three sign-off quotes are kept word for word. Older or longer entries (bench results, interview records, build logs) sit in `decisions_archive.md` under their original heading and date, nothing deleted. A doc cites a title that is not here: `grep -n "<title>" harness/state/decisions_archive.md`. New entries: `## YYYY-MM-DD: <decision>`, Decision, Why, By. CONSOLIDATE moves the oldest to the archive when this file passes about 14 KB.

## Sign-offs and owner rules, word for word

## 2026-11-10: game design signed off by Anmol
Quote: "yes, I sign off on this game design"
See harness/design/GAME_DESIGN_OPTIONS.md and GAME.md (fantasy, core loop, pillars, mission list, progression plan).

## 2026-11-10: The game is named Kalesh; GitHub remote; strict no-attribution rule
Anmol: "ok we will do kalesh". Game name Kalesh everywhere (kit.config, dashboard, Godot project, project rules). Lal Batti stays available as an in-game name (the wanted level or a chapter). Repo folder keeps its old name. Remote origin: https://github.com/anmolbhardwaj17/kalesh.git. Anmol: the assistant name must not appear in commits at all; the commit-msg hook now rejects any commit message or author that mentions it.

## 2026-11-11: Every area is built from real references
Anmol: "Each ADA should have its own style. And to refer that exactly, we can check some online images of that ADA. Or not just one or two, multiple. And figure out the overall gist." Decision: before any area is built, it gets an area sheet and a reference board from 20 to 40 real photos (Google Images, Wikimedia Commons, Mapillary): footpaths, road surface, street lamps, boundaries, buildings, trees, street life, clutter, and what sets it apart. Every area build task cites its sheet, and its verifier compares game shots with the board and fails a generic look. Photos are internal reference only, never in the game. Why: a generic Delhi is the failure the owner names.

## 2026-11-11: Performance target
Anmol: "The game should be able to run on Mac M2 smoothly. No struggles." Answers: minimum Mac is the M2 Pro (this laptop); smooth means 60 fps steady while driving fast, rendered near 1080p and upscaled (MetalFX or FSR). Every budget in perf_budgets.json and the style and architecture sign-offs are judged against this: frame time under 16.6 ms p95 with headroom for gameplay, AI and physics (render target about 10 to 11 ms GPU at play speed). Why: if it runs here it runs on gaming PCs.

## 2026-11-10: style signed off by Anmol
Quote: "Yes, I sign off on stylised B as the Kalesh style."
See harness/design/STYLE_OPTIONS.md and STYLE_BIBLE.md. From now on the never-wait rule applies.

## 2026-11-11: One pull request per task
Anmol: "also let work comit and pr by pr so we ca raise pr and then u only merge that so we have propr3state of game and also i can get moe pr points in github".
Decision: every task runs on its own branch `task/<id>-<slug>`; when verified, it is pushed, a PR is opened with gh (logged in as Anmol, so the PR is his) and merged with a merge commit, then the branch is deleted. Main only receives verified work. No squash, rebase or force. Small state-only commits between tasks may go to main. Starts with P0-019 (its start commit was already on main).
Why: main always holds a verified state, each task is one reviewable PR, and the PRs count on Anmol's GitHub profile.

## 2026-11-11: One seamless open city, no gaps
Anmol on the stitch shot: "these seem very far from each other and a lot of empty spaces there in between ... some seamless connection should be there ... It's not like these should be different region. There should be easily blendable, like an open" (world).
Decision: the map is one continuous open world. No bare ground between districts. Real in-between areas fill the gaps where they matter (Paharganj, Karol Bagh, Daryaganj, ITO, Mandi House, Pragati Maidan); everywhere else gets generated city from the nearest area profiles, blended across the edge so no border is visible. Streets cross district edges as one road network. Layout keeps real directions (every pair within 5 deg) with one even compression factor.
Why: districts as islands feel like separate levels, not Delhi. Open-world feel is a pillar.

## 2026-11-11: Architecture answers, round 2
Anmol (interview, P0-021), all recommended options:
- clipper2-ts (BSL-1.0) and earcut (ISC) allowed in the map tool only.
- Top speed 140 km/h as in GAME.md; gears retuned in the first driving phase.
- Seamless city: centre at true scale (factor 1.0); far south on its real bearing from India Gate at 0.5 of real distance.
- Cutscenes: simple jaw movement now, lip sync and face sets once voices exist; Hinglish plus English subtitles from the start.
- No Earth Engine account; building heights from area profiles, landmarks by hand.
- Draw calls: city scenes warn 2,500, fail 3,500; look test scenes keep 600 and 1,000. Frame time stays the real guard.
Sign-off: "Not yet, I have questions". Round continues.

## 2026-11-11: architecture signed off by Anmol
Quote: "Yes, I sign off on the architecture."
See harness/design/ARCH_OPTIONS.md, TECH.md and docs/ARCHITECTURE.md.

## 2026-11-11: HUD answers (P1-003)
Anmol saw the four HUD mockups (harness/design/hud_mockups/) and chose:
- Overall feel: "Louder and more filmi": bigger type, bolder colour, poster-style titles (not the quiet glass of the mockups).
- Route: road chevrons near turns plus the minimap line.
- Minimap turns while driving, north up on foot.
- English UI, Hindi place names and titles in both scripts, Hinglish subtitles.
- Wanted level: Lal Batti, 5 red beacons.
- Mission passed: a big filmi freeze frame with the title, then stats, stamps and cash.
- Character colours: Bittu green, Meera blue, Danny pink.
How to apply: HUD.md and the HUD build (P3-002) follow these; the mockups are redrawn louder before the build, without asking again.

## 2026-11-11: Core runtime on C1 and Jolt (P1-006)
Decision: `game/core/sim_clock.gd` is the C1 clock (one physics frame is one 1/60 s tick; time scale through `Engine.time_scale` plus `physics_ticks_per_second`; hold stops the physics server only at a physics frame start; scale 0 is a freeze at the rates of scale 1, not 1 tick a second). `project.godot` names Jolt Physics. Only the clock and `*camera.gd` files may have a `_physics_process` (the debug frame probe moved to `SceneTree.physics_frame`). Module size exceptions: `stylised_b.gd` and `standin/builder.gd` (P2-001), `bench/render/world.gd` (P2-014). The TS size test reads files with `import.meta.glob` (no `@types/node` dev dependency).
Why: TECH.md "Main loop and time (C1)" as signed; the replay test measures 0.0000 mm at scale 0.25, 1, 4 and after holds.
By: builder, P1-006.

## 2026-11-11: Bake driver, stages and pins (P1-007)
Decision: `tools/bake/main.ts` is the one bake driver (`npm run bake -- <stage>`), with `tools/bake/sources/` the only other code that touches files or the network (`purity.test.ts`). A stage is an entry in `districts.json` `stages` (outline, margin, data folder, sources); the pilot is `districts/pilot_centre.geojson`, 21.8 km2, margin 400 m, one box extract per source in `data/pilot_centre/`. Every request goes through one `Net` seam, so tests count requests with a fake. A pinned file is reused only when its sha256 matches and its pinned box holds the stage box; a changed local file stops the bake (never overwritten without `--force`); `--offline` never fetches. GLO-30 stays one shared pin per 1 degree tile (`glo30`). Node typings come from `tools/bake/sources/node.d.ts`, not `@types/node`. `rand.ts` is sfc32 seeded by splitmix32 from `seedFor(tileX, tileZ, parcelId, stream)`; its first values are pinned in a test, because a change reshuffles every baked city.
Why: TECH.md "World pipeline": deterministic, pinned sources, stop before tiles on a failed invariant; a fake network proves the second run makes no request.
By: builder, P1-007.

## 2026-11-11: Layout, world grid and recentre in the bake; island stitch code retired (P1-008)
Decision: `tools/bake/layout/` owns the layout. A block's offset is always computed by the signed method (the numbers in `districts.json` are a record, checked). Rule R-STITCH (01 data, 02 translation only, 03 centre pairs, 04 far blocks, 05 block gaps of 250 m, 06 extent) runs in every bake before the first step and stops it. One 250 m world grid (`grid.ts`), tile ids from world metres. Far block frame origins are checked OSM places: Qutub Minar, DLF Promenade, Terminal 3, DLF Cyber Hub; their outlines are compact drafts (1.7 to 2.9 km2). The airport block leaves Aerocity to the airport road corridor. The recentre step subtracts one vector, a whole number of tiles, and puts the world origin on the centre of the smallest circle round the map, not on the centre of the map box. The reach limit is 8,192 m. The stitch prototype is retired: needed parts moved (ARCHITECTURE.md row "Stitch prototype, retired"), the bench driver, plan and scene removed, the island fields taken out of `districts.json`.
Why: measured with every planned block placed, the map box is 13.03 by 13.37 km and its centre leaves Cyber City 9.0 km out; the smallest circle has a radius of 7.98 km (8.03 km after snapping to tiles), inside the band where a 32-bit float steps by 0.49 mm, the band FP1 measured at 7 km. Aerocity at true scale lands on the Vasant Kunj malls, because the two block origins are only half their real distance apart. A whole-tile vector means no tile is cut again and overrides files are renamed, not re-filed.
Open: the map is at the float limit and the centre block's own outline is not drawn; measure FP1 at 9 to 10 km or tighten the layout before the far blocks are baked (P8). Aerocity needs the owner's or planner's call (corridor city, or its own small block).
By: builder, P1-008.

## Standing rules (short forms; full entries in decisions_archive.md under the bold title)

Owner direction and rules:
- **New repo, old game read only** (2026-11-10, owner): one coordinate system, east +X, north -Z, up +Y, 1 unit = 1 m, no mirroring, ever. `/Users/apple/Desktop/code/delhi-drive` is a read-only reference.
- **Salvage verdict** (2026-11-10): no base-layer code, tiles, data or art is copied from the old game (roads, junctions, terrain fit, tile manager, physics, projection, bake). REWRITE items are rebuilt from the idea with tests; OSM is downloaded fresh and pinned. Only the three KEEP items below are copied (harness/design/SALVAGE_AUDIT.md).
- **Fable model only for the hardest work** (2026-11-10, owner): budget in harness/state/fable_budget.json, uses listed in the project rules.
- **Game design discovery is the third Phase 0 sign-off** (2026-11-10, owner): gate P0 needs style, architecture and game design sign-offs. Standing rules for every plan: each phase is checked against the GAME.md pillars; every mission task's acceptance includes fun criteria (clear goal, fair fail, a reason to retry, a reward that matters) as well as function; no mission system is built before the game design sign-off.
- **Game direction from interview round 1** (2026-11-10, owner): three playable characters (auto driver, cop, small-time fixer) with their own lives and stories; guns and fights; over-the-top action movie tone; on foot anywhere. Respect rule: poverty shown where it is true ("i want to show some part of it as its actually true"), as part of the city and never its only face, never as spectacle or a joke; every community portrayed from data and reference, never caricature. Posters: invented parties only.
- **GB Road treatment** (2026-11-10, Anmol: "ok"): the red-light trade exists in the story as background (hardware shops below, brothels upstairs); the people there are shown with dignity; missions are about the crime around it. No sex, no nudity, no paying for sex as a mechanic.
- **Architecture answers, round 1** (2026-11-11, Anmol): open sources only, keep a sale possible (no FABDEM or other non-commercial data shipped; publish repaired map data as ODbL asks). Mac signing: "not a decision i wanna take right now", unsigned test builds until he decides, asked again before release. He has a Windows PC and a friend will test, so Windows is tested on real hardware from the first playable. Animation: free CC0 library (Quaternius). Reference photos online only.
- **Hero roads** (2026-11-10, Anmol): some roads must be realistic (checked lane counts, medians, kerbs, footpaths, roundabouts, tree lines, street furniture, compared with reference photos). First list: CP inner, middle and outer circles and radials, Janpath, the Lutyens roundabouts and avenues, the garden edges.
- **Act 1 story flow, no early merge** (2026-11-10): Anmol: "Bro, just after 3 missions you are merging them together. Doesn't seem like a good plan... Just like a GTA 5 story." Each life gets its own run of missions, the next character is introduced inside the current one's mission, the first meeting is a crossing, the merged mission is the Act 1 finale. The first slice is four solo missions (GAME.md wins over older task text).
- **Story seed approved** (2026-11-10): Anmol: "That's a banger story. Let's go ahead with it." Base: harness/design/STORY_SEED.md; his outline answers are section 13 of STORY_OUTLINE.md.
- **Cutscenes and story telling** (2026-11-10): Anmol: "I hope there will be cutscenes as well in this game to blend the story properly. Thinking, talking, dialogue." Directed in-engine cutscenes are a RELEASE capability (short, skippable); the slice gets simple scenes with subtitles plus drive talk.
- **Look targets** (2026-11-10, Anmol): "it should still look good. It should not be like, oh, that is low poly out of nowhere." and "I really like the way Watch Dogs 2 looks compared to these screenshots". Fidelity target is Watch Dogs 2 at its best; the concept images in harness/design/reference/ are mood only.
- **Style sign-off** (2026-11-11): quote above. Chosen: stylised B (`stylised_b`); realistic stays a reference set only. Rules in STYLE_BIBLE.md; signed budgets in `harness/verify/perf_budgets.json` (look scenes frame p95 warn 10 ms, fail 12 ms; city draw calls 2,500 and 3,500). No `--style` loads stylised_b on the day clock (P1-002); `--style=none` is the flat debug look.
- **Engine Godot 4** (2026-11-10, owner: "yes for godot 4"): Godot 4.7.2 standard build pinned in kit.config.json; GDScript first, no C#, GDExtension only for measured hot spots; desktop (Windows and Mac), web demo maybe later.
- **Speeds and map size** (2026-11-10, Anmol: "see whats best"): top speed per vehicle: auto about 65 km/h, scooter 90, car 140, fast cars 180 to 200. Release is free and public; keep a later sale possible.
- **Architecture record, P0-022** (2026-11-11): the signed design is in TECH.md, docs/ARCHITECTURE.md, MAP_REPAIR.md, DELHI_WORLD.md, GAME.md and perf_budgets.json; `harness/data/districts.json` is the signed layout. Bench results (P0-016 to P0-020, P0-029) are in the archive.
- **Map repair layer, lane model, inspector** (2026-11-10, owner): map data is treated as broken and repaired on every bake; roads are lane sets with tapers, gores and flyover splits; Anmol picks among proposed fixes in the inspector, picks go to `harness/data/overrides/<tileX>_<tileZ>.json` (MAP_REPAIR.md).
- **Game plan after Phase 0** (2026-11-11): fourteen phases, see harness/state/next_phase_notes.md; the pilot plays well before the map scales up.

KEEP numbers from the old game (numbers only, no code; checked in the salvage audit; a start, not a target):
- **KEEP from delhi-drive: car handling numbers as the starting tune** (2026-11-10, `frontend/src/car/carPhysicsRapier.js`): mass 1730 kg, inertia 3600 / 3820 / 814, body box half extents 0.95 / 0.6575 / 2.395 m with more than one wheel radius of ground clearance, half track 0.78 m, axles at plus and minus 1.43 m, wheel radius 0.34 m, suspension rest 0.32 m, stiffness 28, compression 0.82, relaxation 0.88, travel 0.3 m, front grip 3.1, rear grip 2.2 (the value that ran every frame, line 260, not the 2.9 at line 116), handbrake rear grip 0.9, side stiffness 1.2 front and 1.1 rear, max steer 0.64 rad, steer rate 1.10 rad/s out and 1.85 rad/s back, steer lock reduced with speed (by 60% from 102 km/h up), engine force 5200, brake 90, anti-spin yaw damping 5200, gear top speeds 34 / 60 / 84 / 100 / 106 / 110 km/h, fixed 60 Hz step. Axis signs are derived again in the new frame. Top speed becomes 140 km/h, gears retuned in the first driving phase.
- **KEEP from delhi-drive: chase camera numbers as the starting rig** (2026-11-10, `frontend/src/car/carCamera.js`): wide chase 6.6 m behind, 2.5 m up, look-ahead 4.0 m; close chase 4.5 m, 2.05 m, 3.2 m; at 80 km/h add 0.3 m distance, drop 0.25 m, add 3.0 m look-ahead; base FOV 70 degrees plus up to 21 at 80 km/h; position lerp 0.16 and look lerp 0.22 (frame-rate independent); horizontal clamp 9.3 m; floor 0.5 m above the car; view changes blend over 0.6 s on an arc lifted up to 0.8 m over the roof; impact shake on a one-frame drop above 16 km/h, capped at 0.20 m.
- **KEEP from delhi-drive: four CC0 sounds as placeholders** (2026-11-10): `engine_idle.wav`, `engine_mid.wav`, `engine_high.wav`, `horn.ogg` from `frontend/public/audio/`, registered through `assets.mjs` with source and licence when the first audio task needs them.

## Modes in force

From the project rules "Modes" (every switch Anmol asks for gets a dated entry here): ONE AGENT AT A TIME on, LOW USAGE MODE on, LANE 2 off, MID-PHASE SWEEP off. Git: one branch and one pull request per task (entry above), and never the name Claude or Anthropic in any commit (entry "The game is named Kalesh").

## 2026-11-11: Map origin limit 8,192 m and Aerocity (orchestrator call, P1-008)
The smallest circle around every planned block has a radius of 7.98 km, so "8 km from the map box centre" cannot hold. Decision: the recentre uses that circle's centre snapped to 250 m tiles (8.03 km worst, Cyber City), and the far-from-origin gate is 8,192 m, where the 32-bit float step doubles. Physics showed no drift at 7 km; FP1 is re-measured at 9 to 10 km before the far south is built (P1-029).
Aerocity is generated corridor city between the airport block and Vasant Kunj, not its own block (at true scale it lands on the Vasant Kunj malls).
Why: keeps the signed seamless layout and real bearings; the float limit is the real constraint, not a round 8 km.

## 2026-11-11: Block graph rules (P1-009)
Decision: `tools/bake/graph/` builds one graph for the whole pilot stage. Ids: edges `w<way>.<part>` (the lowest way piece along the edge, part counted after the cuts), nodes `n<osm id>`, map edge ends `m<way>.<k>`, footprints keep the source id (`way/`, `relation/`, `overture/<GERS id>`). Normalisation snaps road nodes under 2 cm apart and drops a way drawn node for node twice. Carriageways pair when they run in opposite directions, each on the right of the other, within 45 m, with names that agree (normalised, a spelling apart, or one unnamed of the same class); halves with two names pair only within 16 m at one level, marked `namesDiffer` for the inspector. Footprints: OSM first with its tags, then Overture's Microsoft, Google and Esri footprints where new, then Overture's OSM copies. No flatbush: the existing `Grid` is fast enough (0.9 s for the pilot). The graph JSON is a build product in `data/<stage>/graph.json` (gitignored); the health report carries its counts, checks and hash.
Why: MAP_REPAIR.md "Pipeline" steps 1 and 2; source ids plus part survive a new extract unless that way itself is redrawn; the pilot showed four street pairs drawn with two names.
Open: the Overture file has no footprint Overture dropped, so the "about half dropped in dense blocks" gap (BS1 vs BS2) is not closed until the raw Google set is a stage source.
By: builder, P1-009.
