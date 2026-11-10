# Dilli Darshan: Why it felt thin (quality audit of the old game)

Date: 2026-11-10. Build: the old game `/Users/apple/Desktop/code/delhi-drive` at commit `aaeca42` (2026-09-05), its existing `frontend/dist`. Machine: Apple M2 Pro, ANGLE Metal renderer. Evidence folder: `harness/reports/audit/`.

## Summary

1. This audits the old game, because the new repo is a box car on a plane with nothing to judge yet. It is scored against the bar a polished Delhi driving game must meet.
2. Score: 3 of 30 rows meet the bar, 13 are close, 14 are far. By section, rows that meet: Visuals 0 of 6, Feel 1 of 5, Audio 0 of 4, VFX 0 of 4, Traffic and life 0 of 3, UI and HUD 1 of 3, Performance 1 of 5.
3. Reason one: the base was broken, so the eye went to faults first. Roads floated, overlapped and stopped in mid air, and nearly all work went into repairing them, not enriching the city.
4. Reason two: the world was quiet and still. One engine loop, one ambience bed for the whole city, silent traffic, no horns from others, no weather, no animals, nothing that moves except cars, a few walkers and swaying trees.
5. Reason three: surfaces and distance. Flat-coloured ground, cars and people with no textures, buildings that stop 250 m away, and no skyline.
6. Reason four: the frame. 37% of frames missed 60 fps in the last full measurement, with hitches of 114 to 178 ms while driving.
7. Biggest strength to protect: the habit of measuring before fixing, with probes and written numbers. After that: the chase camera, the hub menu, and the low draw call count.
8. Limits of this audit: the old build needs its tile server (`localhost:4051`), so only the title and the hub could be shot. In-world findings come from code, the old project's own measurements, and art files.
9. Feel numbers (0 to 100 km/h time, braking distance, steering response) were not measured. They need feel probes through the hooks in the new game.
10. Nothing here is Delhi yet. Autos, two-wheelers, buses, cows, vendors, Hindi signs, haze and horn culture were all absent, because the old game had moved to Barcelona.

How to read the tables: paths are in the old repo unless they start with `harness/`. "Found" starts with MEETS, CLOSE or FAR. Fix size is for reaching the bar in Dilli Darshan: S under a task, M one task, L several tasks.

## The quality bar

"Polished and rich" for Dilli Darshan means: you can drive for ten minutes and never see a fault in the road, the city sounds and moves like Delhi, and every surface near the car has detail.

References:
- Euro Truck Simulator 2. This was Anmol's own reference for the old game: "not too good but definitely better than what we have" (`docs/context/v3-brief.md:15`). It sets honest mid-level game art: textured, normal mapped, correct scale, calm palette. To be confirmed again in the style interview.
- Two genre references suggested by the planner, not by Anmol: an open-world city game for street life and traffic density (the Grand Theft Auto style of busy pavements and mixed vehicles), and an arcade open-world racer for speed sense and camera (the Forza Horizon style). Anmol names the real ones in the interview.

Each row below scores against that bar: meets, close or far.

## Visuals

| Area | Bar (what a polished game has) | Found | Evidence | Fix size |
|---|---|---|---|---|
| Lighting | Key, fill and bounce read the time of day; contact shadows; no flat unlit look | CLOSE. Sun plus sky fill, one 1024 px shadow map covering only 85 m around the car, baked sky occlusion per tile, a light grid for street lamps at night. No bounce light. An audit two months before the last commit found no tree shadows by day and a magenta road at night; fixes landed after it but could not be checked by eye here | `frontend/src/scene.js:746-753`; `frontend/src/config.js:186`; `backend/worldBuilder/aoBaker.js`; `docs/context/day-night-lighting-audit.md:1-40`; `frontend/test/treeShadowProxies.test.js` | L |
| Materials | Varied roughness and wear; no single flat colour per object; road, wall and metal read as what they are | FAR. In July: 91 Lambert, 58 unlit Basic, 37 Standard materials, no light baking. Roads, kerbs and facades later got albedo and normal textures. The ground never did: its finest detail is a 5 to 10 m noise blob. The hero car has no UVs at all. People have 0 textures | `docs/context/visual-target-analysis.md:24`; `frontend/public/textures/road/` (albedo and normal KTX2 files); `docs/context/v3-master-plan.md:72`, `:75`; `docs/context/pedestrian-system.md:35` | L |
| Density | The play space is full at the play camera: no empty stretches longer than a few seconds of play | CLOSE in the dense centre: parked cars, shop signs, awnings, terraces, street lamps. But many layers are switched off: water, railways, tram tracks, barriers, bike lanes, corner fills, tunnel interiors | `frontend/src/config.js:179`, `:237-243`; off flags at `:266`, `:267`, `:269`, `:313`, `:320`, `:350`, `:358` | L |
| Props | Small props near the player and along the path (signs, bins, cables, plants, clutter) | CLOSE. Bus stops, hydrants, fountains, signals and direction boards exist. Bollards and road furniture were planned and not built (11 days of work left open). Sign textures leak memory: 50 MB at 12 tiles, 495 MB at 120 | `frontend/src/config.js:317`, `:338-339`; `docs/context/v3-execution-tracker.md:1587` (P4-14 open); `docs/context/backlog.md:216-224` | L |
| Sky and distance | A sky that matches the light; distance fog or haze; a skyline or far shapes, not a void | FAR. The haze is good (distance and height based, with a glow towards the sun). The sky is a 3 colour gradient with one cloud, hidden at night. Buildings end at 250 m and everything is culled by fog at 280 m, so there is no skyline | `frontend/src/scene.js:666-711`; `docs/context/v3-master-plan.md:74`; `frontend/src/config.js:231`; `docs/context/v3-execution-tracker.md:312` (H14) | L |
| Post processing | Tone mapping and grade in place; bloom only on emissives; AO or equivalent; no banding | CLOSE. ACES tone mapping at exposure 1.6, half resolution bloom with a threshold above the sky, a colour grade pass. Screen-space AO was removed for cost (it tripled the triangles drawn). No anti-aliasing, pixel ratio capped at 1.5 | `frontend/src/scene.js:555`, `:566`, `:571-572`; `frontend/src/main.js:740-745`; `docs/context/rendering.md:149-172` | M |

## Feel (movement, or driving for a vehicle game)

Not measured here: the old game cannot be driven without its tile server, and it has no hook contract. The values below are read from code. Feel probes in the new game must measure them.

| Area | Bar | Found (measured) | Evidence | Fix size |
|---|---|---|---|---|
| Handling | Responsive at low speed, stable at high speed, a readable limit before losing grip | CLOSE. A raycast vehicle on Rapier that its own header calls a first pass still needing tuning. Steering is rate limited (1.10 rad/s out, 1.85 back), lock falls with speed, an anti-spin torque hides fishtails. Rear grip is set to 2.9 at start and overwritten to 2.2 on every frame, so the tune on paper is not the tune that runs | `frontend/src/car/carPhysicsRapier.js:7-8`, `:62-63`, `:116`, `:211`, `:260`, `:277` | M |
| Speed sense | The player feels fast: FOV widens with speed, motion cues (road lines, roadside objects, blur), sound rises | CLOSE. Top speed is held near 110 km/h. FOV goes from 70 to 91 degrees by 80 km/h. Dust trails at speed. The radial blur and speed lines exist but are off unless the URL has `?speedblur=1`. The engine is one loop that only changes pitch | `frontend/src/car/carPhysicsRapier.js:15`, `:225`; `frontend/src/car/carCamera.js:95-97`, `:457`; `frontend/src/main.js:746-748`; `frontend/src/car/carSound.js:66` | M |
| Camera | Follows with lag and look-ahead, never clips, stays readable in turns and collisions | MEETS. Three views (wide chase, close chase, bumper) that blend along an arc over the roof in 0.6 s, a tunnel mode, a reverse swing, mouse orbit that eases back, a hard floor 0.5 m above the car. No cockpit view because the model has no interior | `docs/context/vehicle-system.md:238`; `frontend/test/cameraViews.test.js` (12 tests), `frontend/test/cameraSettle.test.js` (5) | S |
| FOV and shake | FOV range per speed; subtle shake on rough surfaces and impacts, never constant | CLOSE. FOV range is right. Impact shake fires on a sudden drop of more than 16 km/h. The high-speed rumble starts at 140 km/h, which the car cannot reach, so it never plays. No shake from road surface | `frontend/src/car/carCamera.js:407-427`; `frontend/src/car/carPhysicsRapier.js:15` | S |
| Collisions | Hits feel physical (sound, shake, sparks) and fair (no invisible walls, no sticking) | FAR. A crash sound above 2.6 m/s and a camera punch, nothing else: no sparks, no debris, no damage. Trees and barriers have no collision. The history shows unfair cases: tunnel walls 40 m tall standing in open sky, a merge where the car fell through, a body box that stopped dead on kerbs | `frontend/src/car/carDriver.js:42-50`; `frontend/src/config.js:313`, `:316`; `docs/context/v3-execution-tracker.md:212`, `:216`; `frontend/src/car/carPhysicsRapier.js:21-31` | L |

## Audio

| Area | Bar | Found | Evidence | Fix size |
|---|---|---|---|---|
| Engine (or main loop sound) | Layers that follow speed and load (rpm, gear shifts), not one looped tone | FAR. Three engine samples ship. Only one is ever played, pitch shifted. The other two are downloaded and never heard | `frontend/src/car/carSound.js:66`; `docs/context/audio-plan.md:18` | M |
| Ambience | Place sound beds that change by area and time (city hum, birds, crowds, wind) | FAR. One street recording for the whole city and a muffled copy for night. Nothing has a position in the world: the only panning is left or right on a pass-by whoosh. A tunnel sounds like open street | `docs/context/audio-plan.md:27-47`; `frontend/src/car/trafficSystem.js:512-518`; `frontend/public/audio/ATTRIBUTION.md` | L |
| Horns, voices, one-shots | Events have sounds; traffic and people make the place sound alive | FAR. Only the player has a horn. Traffic is silent except a whoosh on a close pass. People make no sound. No tyre or surface noise | `docs/context/audio-plan.md:34`, `:49-55`; `frontend/src/car/trafficSystem.js:518` | L |
| Mix | Nothing clips; music sits under effects; volume settings work | CLOSE. A master bus, a car bus and an effects bus, and sound pauses when the tab loses focus. No music. On boot the build asks for 9 audio files that do not exist (404) | `frontend/src/audio/audioManager.js` (212 lines); shot run on 2026-11-10: `/audio/engine_idle.ogg`, `/audio/car_pass.wav` and 7 more returned 404 | S |

## VFX

| Area | Bar | Found | Evidence | Fix size |
|---|---|---|---|---|
| Dust and smoke | Wheels or feet kick up dust on dirt; exhaust or smoke where it fits | CLOSE. Tan dust puffs behind the wheels and at speed, from one pool of 90. It is the same on every surface (asphalt and dirt alike). No exhaust. The config flag says smoke is off while the code forces it on | `frontend/src/car/carEffects.js:9-15`; `frontend/src/config.js:369` | M |
| Skid marks and decals | Marks persist for a while and fade; impacts leave marks | CLOSE. Instanced skid marks on drift and hard braking that fade. No marks from impacts | `frontend/src/config.js:368`; `frontend/src/car/carEffects.js:41` | S |
| Heat haze, rain, weather | Weather and heat effects that sell the place, priced against the budget | FAR. None. Rain was cut for good in planning. Wet roads were planned and not built. Day and night is a key toggle, not a clock | `docs/context/v3-master-plan.md:768`, `:73`; `CLAUDE.md:104` in the old repo (N toggles day and night) | L |
| Impacts | Sparks, debris, flashes on hits | FAR. None | `frontend/src/car/carEffects.js` (345 lines, no impact effect); `frontend/src/car/carDriver.js:42-50` | M |

## Traffic and life

| Area | Bar | Found | Evidence | Fix size |
|---|---|---|---|---|
| Traffic | Other vehicles with believable behaviour (lanes, stopping, horns), density that fits the place | FAR against a Delhi bar. 28 cars at most, moving on rails along lane-offset centrelines. They queue, turn and obey signals. No lane changes, no overtaking, no horns, no two-wheelers, autos or buses: ten western car models. A car stuck for 5 s is removed | `frontend/src/car/trafficSystem.js:56`, `:115`; `docs/context/traffic-realism-plan.md:1-30`; `frontend/public/models/cars/` (10 files) | L |
| People and animals | Pedestrians, vendors, animals where the place has them | FAR. Up to 168 walkers from 3 models with no textures, animated as a 12 frame flipbook. They cross roads, stop at shops and run from the car. No vendors, no animals, nobody sitting or working | `frontend/src/car/pedestrians.js:40-41`; `docs/context/pedestrian-system.md:1-40` | L |
| Ambient motion | Things move: flags, trees, signs, laundry, birds | FAR. Trees sway. Nothing else moves | `docs/context/gotchas.md:565` (G-45 tree wind); 0 source files mention birds, pigeons, laundry or fluttering flags (grep over `frontend/src`) | M |

## UI and HUD

| Area | Bar | Found | Evidence | Fix size |
|---|---|---|---|---|
| HUD | Speed, map or direction, goals readable at a glance; styled to the game | CLOSE. Speedometer, a minimap with a routed path and an ETA, a key hint strip. Four game modes each built their own version of the same three widgets, in six palettes with seventeen hard-coded colours. A minimap redraw can cost 10 ms | `frontend/src/ui/speedDisplay.js` (215 lines); `frontend/src/ui/minimap.js:66`; `docs/context/v3-master-plan.md:77` | M |
| Menus | Title, pause, settings, results styled and responsive; no default browser look | MEETS. A loading screen with city facts and a percentage, a hub with mode cards, a garage with paint colours and a spinning car, a landmark list, settings, a pause menu | `harness/reports/audit/old_title_and_hub.jpg`; `frontend/src/ui/mainMenu.js` (494 lines), `frontend/src/ui/escMenu.js` (453) | S |
| Feedback | Every action and goal change is acknowledged (sound, motion, text) | CLOSE. A title card when a mode starts, one objective marker, a wallet, UI sounds. One live readout flickered about 10 times a second and was removed the day it shipped | `docs/context/game-modes.md:14-30`; `docs/context/backlog.md:53` (M-8); `frontend/src/ui/uiSound.js` | M |

## Performance

All numbers are the old project's own, from its drive reports and its ledger, taken by Anmol's drives in a focused Chrome tab. They were not re-measured here.

| Area | Bar | Found (measured) | Evidence | Fix size |
|---|---|---|---|---|
| Frame time p95 during play (driving at top speed for a vehicle game) | Under the draft budget on the target machine | FAR. Frame p95 33.4 ms: 37% of frames missed 60 fps. GPU p95 was 13.85 ms at night. The long frames were mostly JavaScript and garbage collection: the GPU took only 7.3 to 7.8 ms of a 50 to 76 ms frame. Not re-measured after later fixes | `docs/context/v3-execution-tracker.md:258-261`, `:270` | L |
| Draw calls and triangles at the busiest view | Under budget, with instancing for repeated objects | MEETS. 202 draw calls and 1.01 million triangles in steady state, against caps of 450 and 2.6 million. The car fleet is 3 draw calls | `docs/context/v3-execution-tracker.md:273-275` | S |
| Pop-in at draw distance | Objects and LODs appear without visible popping at play speed | FAR. Level of detail is one distance per 500 m tile. Buildings stop at 250 m, detail at 80 m. No far shapes behind them | `docs/context/v3-master-plan.md:76`; `frontend/src/config.js:231`; `docs/context/v3-execution-tracker.md:312` | L |
| Load time | Under budget; a loading screen if long | CLOSE. 5.2 to 6.3 s from click to driving after fixes (it had been 18 to 22 s for weeks). A styled loading screen exists. 2.5 s of that is the client building every triangle from vector tiles | `docs/context/v3-execution-tracker.md:263-265`; `docs/context/bake-vs-runtime-audit.md:9-13` | M |
| Hitches | No frame over 50 ms while streaming or spawning | FAR. Drive reports show 12 to 40 long frames per drive, with the longest at 145 to 178 ms. After later fixes: 9 long frames in 145 s, worst 114 ms. The heap swings from 328 to 572 MB in one drive and reached 1,205 MB in another | `backend/debug-reports/drive-report-2026-08-27T16-12-07-612Z.json` (`msMax` 173.7, `heapMB` 1180 to 1205); `docs/context/v3-execution-tracker.md:266-268`, `:279` | L |

## What to protect

The good parts of the old game. Each line names the check that will guard it in Dilli Darshan once it exists.

- The chase camera: lag, look-ahead, the arc between views, the tunnel mode, the floor above the car. Guard: camera scenarios with shots in turns, tunnels and reverse, plus the rig numbers in `decisions.md`.
- The hub and loading screen: one launch path, mode cards, garage, landmark list, city facts while loading. Guard: `boot_title` and a menu scenario.
- Low draw calls through merging and instancing (202 in a dense city). Guard: draw call and triangle budgets in `perf_budgets.json` at the busiest view.
- Load time near 6 s with a visible progress screen. Guard: a load time budget.
- Haze with depth, height and sun glow. Guard: a look-proof view down a long avenue.
- Baked sky occlusion for soft shade in narrow streets at no runtime cost. Guard: a look-proof view in a narrow lane.
- Traffic that stops for signals and never shows two green axes. Guard: a signal scenario.
- The road router with an ETA that agrees with the route. Guard: router tests on the lane graph.
- Measuring before fixing: probes that name a surface, a drive report, counts printed by the bake. Guard: the map health report and `window.__game.debug` probes.
- Honest written records of what was tried and what failed. Guard: `decisions.md` and the knowledge files here.

## Proposed order

A proposal for after the sign-offs. The planner turns it into phases. Biggest gain in feel per unit of work comes first, after the base is right.

1. Base layer first: lane-level roads, real junction surfaces, terrain that fits, correct railings (SALVAGE_AUDIT section 5). Without it every other gain is spent on hiding faults. Size L.
2. Handling, camera and speed sense with feel probes: port the starting numbers, measure them, tune once with Anmol. Turn on speed cues by default. Size M.
3. Sound, the cheapest large gain: blend the three engine layers by rpm, give traffic engines and horns, add positional audio, add a tunnel echo, add Delhi ambience beds by area. Size M to L.
4. Delhi traffic and life: autos, two-wheelers, buses, cycle rickshaws, cows and dogs, vendors, lane-loose behaviour, horn culture. After the game design sign-off. Size L.
5. Light and air: time of day, Delhi haze, night lighting, soft street shade. With the signed style. Size L.
6. Surfaces and props in the signed style: ground materials, walls, signs in Hindi and English, wires, posters with invented parties, paan stains with real alpha. Through the asset request system. Size L.
7. Far view: building impostors or a skyline ring, landmarks visible from far. Size M.
8. Effects: surface-aware dust, exhaust, sparks and debris on hits, rain and wet roads if the budget allows. Size M.
9. HUD: one widget set shared by all modes, a cheap minimap, steady readouts. Size M.
10. Performance guard throughout: budgets per system from the architecture sign-off, a hitch budget, and no frame over 50 ms while streaming.
