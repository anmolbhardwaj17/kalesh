# Dilli Darshan: Style options

Status: SIGNED 2026-11-11. Anmol: "Yes, I sign off on stylised B as the Kalesh style." The chosen look is stylised B (`stylised_b`, batch B after the P0-037 lean pass); see "Chosen: stylised B" below and STYLE_BIBLE.md. Realistic (A) stays a reference set only. B, B+D, C and D are not built further (B and B+D stay behind `--style=` until the first phase gate; C and D were never built).

Every number in this doc is an estimate (marked "est") until a Godot style test measures it on this machine. Measured numbers replace the estimates in P0-011 and P0-012, and every estimate that was wrong is marked "WRONG, was ...". Never hide a bad number.

Engine: Godot 4.7.2 stable, desktop (Windows and Mac), Forward+ renderer (decisions.md "Engine Godot 4"). Style tests run in Godot with the user args `--style=<id>` and `--light=<preset>`, not `?style=` in a browser.

## What we know so far

From the interview (inbox source "interview", 2026-11-10). His words are quoted; the rest is a short reading of them.

| # | Round | What Anmol said | What it means for the look |
|---|---|---|---|
| 1 | Style 1, look | "can u make an artifact of different game style and feels ... maybe then i can choose" | He chooses from pictures. The look board was made for this (link below) |
| 2 | Style 1, must not look like | Cartoony or childish; a generic Western city; a low-poly mobile game. "i want to show some part of it as its actually true" | No toon, no flat low poly, no clean Western streets. Real conditions, poverty included, shown honestly |
| 3 | Style 1, mood | "which game will sell more? i need discussion before answering" | Answered in discussion: the board's notes on look, cost and Godot fit |
| 4 | Style 1, hardware | Prefers an installed game made in an engine over the browser | Godot 4, desktop. Target player hardware is still open (question below) |
| 5 | Look pick | "I also like B, with d's dirst on old delhi" | Base look B (stylised realistic). Grime from D (gritty) in Old Delhi |
| 6 | Style 2, light for tests | Hot hazy afternoon; Golden evening | Every style test renders both light presets |
| 7 | Style 2, colour in B | Rich and warm | Warm grade, saturated but not neon by day |
| 8 | Style 2, camera | Third person behind | Chase camera for driving, over the shoulder on foot |
| 9 | Style 2, characters and crowds | Realistic proportions, stylised finish | Real anatomy and scale; simplified skin and cloth detail, clean readable colours |
| 10 | Game design 1b | Three players (auto driver, cop, small-time fixer), guns and fights, over-the-top action movie, on foot anywhere | The look must work at 1.7 m eye height and in gunfights, not only from a car |
| 11 | Place | Heroes: Connaught Place circle, India Gate, Red Fort. Districts: central core, Old Delhi, East Delhi, South with Gurgaon and the airport, plus story places | See `CITY_BRIEF.md` |
| 12 | Release | Free, public. Political posters: invented parties only | No real parties, people or brand logos in any texture |

## Reference board

Shown to Anmol as the look board artifact: https://claude.ai/artifact/Tfw397gkZcj3KCgkV2LdSP. Images are publisher promotional screenshots (Steam store pages) and Wikimedia Commons photos, kept as private reference only and never shipped or used in a prompt as "in the style of". The manifest with sources and credits is in the orchestrator's scratchpad (`styleboard/manifest.json`); the rows below carry what matters.

| # | Reference | Kind | Board group | Take | Leave | Round |
|---|---|---|---|---|---|---|
| 1 | Chandni Chowk street, 2008 (Wikimedia) | photo | Real Delhi | Hanging wires, stacked shop boards, crowd density, warm dusty light | Nothing: this is the target | 1 |
| 2 | Connaught Place at night (Wikimedia) | photo | Real Delhi | White colonial arcades under sodium orange light, neon fuel station signs | Real brand names on signs | 1 |
| 3 | Delhi street in the morning (Wikimedia) | photo | Real Delhi | Green and yellow autos, scooters, concrete bollards, worn road | | 1 |
| 4 | Autos outside Purana Qila (Wikimedia) | photo | Real Delhi | The auto colours as the city's signature accent, dusty ground | | 1 |
| 5 | GTA V | game | A. Realistic | Hard sun flare, warm haze, dense street clutter, real car paint | Cost of a fully real material set; satire that mocks groups | 1 |
| 6 | Mafia II Definitive Edition | game | A. Realistic | Fine decay detail on buildings, soft smoky light | Period setting, slow pace | 1 |
| 7 | Watch Dogs: Legion | game | A. Realistic | Wet night streets, coloured rim light, a real city skyline | Near-future gadgets, cold London palette | 1 |
| 8 | Watch Dogs 2 | game | B. Stylised realistic (picked) | Saturated sunlit city, cleaner colours than life, bold readable clothing on the playable crew | Over-clean streets (Old Delhi gets grime) | 2 |
| 9 | Sleeping Dogs Definitive Edition | game | B. Stylised realistic (picked) | Neon night streets, clear fighter silhouettes in melee, loud crash effects for over-the-top action | The cool night grade by default (we are warm) | 2 |
| 10 | Borderlands 3 | game | C. Comic | Nothing for the world. Bold hit effects only as a reference for impact timing | Ink outlines, cartoon shapes (Anmol: not cartoony) | 1 |
| 11 | Hi-Fi Rush | game | C. Comic | Strong graphic UI language, punchy hit feedback | Flat cartoon lighting and shapes | 1 |
| 12 | Max Payne 3 | game | D. Gritty (grime taken) | Sweat and grit, worn brick and shutters in dusty tropical light, slow motion gunfights | Harsh dirty grade over the whole city | 2 |
| 13 | Far Cry 4 | game | D. Gritty (grime taken) | South Asian street: tin roofs, dust, wires, layered clutter | Cold desaturated mountain light | 2 |
| 14 | The Last of Us Part I | game | D. Gritty (grime taken) | Layered decay on brick, AC units, soft god rays through trees | Overgrown ruin, empty streets | 2 |
| 15 | HITMAN World of Assassination | game | South Asia in games | Dense signage in narrow alleys, packed market crowds | | 1 |
| 16 | Uncharted: Legacy of Thieves | game | South Asia in games | Carved stone and warm torchlight on Indian architecture | | 1 |
| 17 | Euro Truck Simulator 2 | game | old game's reference | Honest textured, normal-mapped mid-level art at correct scale | To be confirmed again; not shown on the board | 0 |

Grouped by axis after round 2:
- Palette: rich and warm (Watch Dogs 2 saturation, real Delhi dust), auto green and yellow as the accent.
- Lighting: hot hazy afternoon and golden evening for the tests; sodium orange night later.
- Shapes: real proportions, slightly simplified; no outlines.
- Materials: clean in the planned city (Lutyens, CP), layered grime in Old Delhi (Max Payne 3, Far Cry 4).
- Camera: third person behind.
- Characters: realistic proportions, stylised finish; readable clothing (Watch Dogs 2, Sleeping Dogs).
- Mood: over-the-top action set in a real, honest city.

## Target hardware and baseline

- Build and test machine: Apple M2 Pro (19 core GPU), 16 GB unified memory, macOS, Metal 4, built-in display 3024 x 1964. Godot 4.7.2 at `/Applications/Godot.app`.
- Renderer: Forward+ on the Metal driver (Godot 4.4 and later; Vulkan through MoltenVK as fallback; the P0-016 bench confirms which is faster). Mobile renderer noted per candidate as the low preset. Compatibility (OpenGL) only for a possible web demo later.
- Test resolution: 1920 x 1080 internal, scale 1.0 (est). A second run at 0.67 render scale with FSR 2 or MetalFX upscaling (whichever Godot 4.7 exposes on this Mac; the bench checks) tells us how much the upscaler buys.
- Player target: Windows and Mac desktops. The minimum player GPU is not decided (question below). Until then budgets are written for this M2 Pro.
- Baseline (P0-009, measured): the Godot stand-in Delhi street, landmark tiers and area kits, 9 views at 1920 x 1080 (`harness/look_proof/baseline/`, Metal; `baseline_vulkan/` for GPU times with vsync off). GPU p95 1.5 to 3.2 ms over two runs, 84 to 175 draw calls, 0.8 to 1.95 M triangles drawn (shadow passes included), 192 MB GPU memory, load under 1 s. Plain look: sky, sun with shadows, light haze, no textures, SSAO or glow. Draft budgets in `harness/verify/perf_budgets.json`.

## Candidates

The four looks on the board, with their Godot style ids. Light presets for every test: `--light=afternoon` (hot hazy afternoon) and `--light=golden` (golden evening), from Anmol's round 2 answer.

### A. Realistic and cinematic (`--style=realistic`)

Real materials, hard sun, haze, a film-like grade (GTA V, Mafia II, Watch Dogs: Legion). In Godot: full PBR texture sets with high texel density, SDFGI for bounce light, SSR, SSAO and SSIL, volumetric fog for haze, ACES or AgX tonemap with a film LUT, TAA. The most expensive look and the one that ages first; Godot can do it in a scene, but across a streamed city it sits at the engine's limit. Role here: a cost and quality reference only, so Anmol sees what "more real" costs.

### B. Stylised realistic, rich and warm (`--style=stylised`) (Anmol's pick as the base)

Real shapes and proportions, a little cleaner and more colourful than life (Watch Dogs 2, Sleeping Dogs). In Godot: PBR materials with simplified, hand-tuned albedo (fewer, larger texture details; trim sheets and atlases per area kit), a warm grade through a 3D LUT, AgX or Filmic tonemap, glow for sun and signs, SSAO, cheap depth and height fog with sun scattering for haze (volumetric fog only if measured cheap), no SDFGI by default (sky ambient plus SSAO plus an optional SSIL pass), 4-split directional shadows. Characters: realistic proportions, flatter skin shading, clean readable clothing colours.

### B+D. Stylised realistic with Old Delhi grime (`--style=stylised_grime`) (Anmol's pick)

Look B everywhere, plus D's grime as a layer that the area profile turns up or down: Old Delhi high, Lutyens and CP low (DELHI_WORLD.md area profiles get a `wear` value, 0 to 1). In Godot: one shared building shader with a world-space grime mask (triplanar noise plus height and edge darkening for soot, water stains, damp at the base, faded paint), decals for posters, stains and patched plaster (clustered Decal nodes), vertex-colour ambient dirt in corners, dust particles in the air (GPUParticles3D, few), heat shimmer above asphalt in the afternoon (a small screen-space distortion near the ground), and a slightly heavier, dustier haze over Old Delhi only. The grade stays warm and rich; grime lives in the surfaces, not in a grey filter.

### C. Bold and comic (`--style=comic`)

Ink outlines and painted flat shapes (Borderlands 3, Hi-Fi Rush). In Godot: a toon light ramp in the material `light()` function plus a depth and normal edge outline as a CompositorEffect. Out for the tests: it is the closest look to the "cartoony or childish" Anmol does not want, and he did not pick it.

### D. Gritty and grimy (`--style=gritty`)

Harsh contrast, sweat and grime across the whole city, a dirty desaturated grade (Max Payne 3, Far Cry 4, The Last of Us). In Godot: look B's materials with strong grime everywhere, a contrasty cool-shadow LUT, heavier fog. Not tested on its own: Anmol took its grime for Old Delhi only, inside B+D.

Dropped from the fidelity list: stylised low-poly city (Anmol: not a low-poly mobile game). Pixel art 3D and painterly: not on the board and they miss "realistic proportions"; dropped.

### Batches

| Batch | Styles | Lights | Why | Task |
|---|---|---|---|---|
| A (build now) | `stylised` (B), `stylised_grime` (B+D) | afternoon, golden | Anmol's pick, and the one open question inside it: how much grime and where | P0-011 |
| B (optional) | `realistic` (A) | afternoon, golden | Cost and quality reference: shows what "more real" costs in frame time and art. Built only if Anmol wants to see it (asked in sitting 2), else P0-012 is skipped | P0-012 |
| Round 4 | `realistic` (A), on top of batch B | dawn, afternoon, golden, night | Anmol: "Show me realistic too first". Same content as `stylised_b`, realistic rendering; sheet `style_options_real.jpg` | P0-038 |
| B reserve (not built unless Anmol asks) | `comic` (C), `gritty` (D) | | C is out (cartoony). D's grime is already inside B+D | none |

## Fidelity options for a city look

Costs at play speed: the auto at about 65 km/h, ordinary cars at about 140, fast cars at 180 to 200 (decisions.md "Speeds and map size"), and on foot at about 5 to 20 km/h with the camera at 1.7 m. On foot is the hard case: the camera is close to every surface, so texel density and prop detail matter more than draw distance.

| | Stylised low-poly city | Stylised realistic (Anmol's pick) | Realistic PBR, baked lighting | Photo-textured |
|---|---|---|---|---|
| **Status** | Dropped (Anmol: not low-poly mobile) | Base look | Reference only (batch B) | Not tested |
| **Look** | Flat colours, simple massing | Real shapes, simplified and warmer materials, trim sheets, decals | Real materials, baked GI and AO | Photo textures or photogrammetry |
| **At driving speed** (draw distance, LOD, instancing, streaming) | Cheapest | Medium: 3 LODs per kit module, MultiMesh per module, block shells mid, skyline ring far; 600 to 900 m draw distance (est) | Heavy: lightmaps per block conflict with the day cycle (baked light does not move with the sun); texture streaming; 400 to 600 m (est) | Heaviest: unique textures per building; streaming and memory are the limit |
| **On foot at 1.7 m** | Reads as a toy | Needs 512 to 1024 px per metre on ground-floor shopfronts and decals near the eye (est); props and wires carry the detail | Best close up, highest texture memory | Close up shows stretching and blur unless sources are sharp |
| **Asset volume** (whole game, est) | Tens of parts | 8 to 12 area kits of 40 to 80 modules each, 1 atlas plus 1 trim sheet per kit, 150 to 300 decals, 10 to 20 hero landmarks, 60 to 150 signature facades, 15 to 25 vehicle models, 3 player characters, 30 to 60 crowd variants | 2 to 3 times the materials of stylised, plus bakes per area | Per-building texture sets for thousands of buildings |
| **Who makes it** | Procedural | Procedural massing; AI texture cards for atlases, trims and decals; AI 3D or hand-made heroes; AI 3D plus cleanup for vehicles and characters | AI PBR sets plus a bake pipeline | Photo sources (licence issue) or AI photo textures, heavy cleanup |
| **AI prompt fit** | High | Good with a fixed style anchor (below) | Medium: real PBR maps need care to tile | Low to medium: seams and consistency |
| **Risk** | Looks cheap | Mixed looks if the anchor drifts between batches | Bake times, memory, day cycle | Uncanny mismatch, licensing |
| **Measured** (frame time p95 on the busiest view at 140 km/h, draw calls, load) | n/a | P0-011 on the stand-ins (held sim, not at speed): GPU p95 6.8 to 6.9 ms on the busiest view, 8.3 ms worst view (B+D golden, on foot in the bazaar), 89 to 180 draw calls, load 0.8 s. See "Measured in Godot (batch A)" | P0-012 if built | n/a |

## Chosen: stylised B (signed 2026-11-11)

Anmol: "Yes, I sign off on stylised B as the Kalesh style." The chosen column is **B+D grown into batch B, style id `stylised_b`**: stylised realistic, rich and warm (B), Old Delhi grime by area wear (D as data), Delhi detail dressing, and four lights on one day curve (dawn, afternoon, golden, night), on the P0-037 lean path. It is what Anmol picked in round 2 ("I also like B, with d's dirst on old delhi"), asked to push in round 3, confirmed after seeing realistic in round 4 and 5 ("Pure stylised B"), and it meets the performance target ("The game should be able to run on Mac M2 smoothly. No struggles.").

| | Chosen: stylised B (`stylised_b`, P0-037) | Reference only: realistic (`realistic`, P0-038) |
|---|---|---|
| Look | Watch Dogs 2 level stylised realism, warm grade, grime in Old Delhi, Delhi detail kit | The same scene with PBR surfaces, a physical sky, SSR, volumetric fog, TAA |
| Frame time p95 on the stand-ins (Vulkan, M2 Pro, calm) | **Measured**: worst view 8.68 dawn, 9.29 afternoon, 7.75 golden, 9.18 night; typical 6.6 to 8.0 ms | 15.6 to 18.0 ms worst view, 13.2 to 15.6 typical (over the 60 fps target) |
| Draw calls, triangles, load | 96 to 315; 0.77 to 3.2 M with shadow passes; 1.06 to 1.33 s | similar draw calls, more shader cost |
| Why chosen | Meets 60 fps with 2 to 4 ms of headroom for real content; AI kit cards hold the style; grime follows the real city | Costs about 7 ms more for a look Anmol did not choose |
| Signed budgets | `perf_budgets.json` status signed (frame warn 10.0, fail 12.0 ms; draw calls 600 and 1000; triangles 6 M and 9 M; GPU memory 1200 and 2000 MB) | n/a |

Every estimate in the Comparison table below is either replaced by a measured number (marked "measured") or kept as an estimate for the streamed city, where it stays open until the architecture benches (draw calls and memory of a whole district, LOD and streaming). Estimates that were wrong are marked "WRONG, was ...". Estimates for B, B+D, C and D that no test replaced are not decisions and are left as they were; the chosen column's row values are in the table above and in STYLE_BIBLE.md.

## Comparison

All numbers est, at 1920 x 1080 internal on the M2 Pro, Forward+, for the busiest stand-in view (P0-009 "busiest view from 40 m up") unless a row says otherwise. B and B+D are the columns that matter; A is the reference; C and D are kept for completeness.

| | A. Realistic (reference only) | B. Stylised | B+D. Stylised with grime (CHOSEN: grew into `stylised_b`, see above) | C. Comic | D. Gritty |
|---|---|---|---|---|---|
| **Godot id, batch** | `realistic`, B (optional) | `stylised`, A | `stylised_grime`, A | `comic`, B reserve | `gritty`, B reserve |
| **Look** | GTA V, Mafia II | Watch Dogs 2, Sleeping Dogs | Watch Dogs 2 plus Max Payne 3 and Far Cry 4 grime in Old Delhi | Borderlands 3 | Max Payne 3 everywhere |
| **Feel** | Grand and believable; action reads as a film | Warm, lively, readable; action is clear and loud | As B, plus Old Delhi feels old, lived in and honest about its conditions | Playful; too light for the honest city | Heavy and tense; the whole city reads as grim |
| **On foot and combat** (people at 1.7 m, guns and fights) | Best faces and cloth close up, highest cost per person; muzzle flash and smoke look real but busy scenes get muddy | Clear silhouettes and readable clothing, so enemies, cops and civilians separate well; bold muzzle flash, sparks and dust hits read at once | As B; grime adds dust kicked up by hits and soot on walls; keep character materials clean so fighters stay readable against busy walls | Very readable hits, but cartoon gore and outlines fight the tone | Fights feel heavy; readability drops in dark grimy corners |
| **Frame time p95, worst view** (est; B and B+D measured in P0-011 on the stand-ins, GPU p95 on Vulkan) | 18 to 26 ms (needs upscaling for 60 fps); **measured on the stand-ins in P0-038: 15.6 to 18.0 ms worst view, 13.2 to 15.6 typical** (see "Realistic vs stylised B") | **measured 6.9 ms afternoon, 7.2 ms golden** (WRONG, was 9 to 13 ms) | **measured 7.9 ms afternoon, 8.3 ms golden** (WRONG, was 10 to 15 ms) | 9 to 13 ms | 10 to 15 ms |
| **Draw calls, triangles** (est; B and B+D measured on the stand-ins) | 3,000 to 5,000; 4 to 8 M | **measured 89 to 180; 0.77 to 1.95 M** with shadow passes (WRONG for the stand-ins, was 1,500 to 3,000 and 2 to 4 M: the stand-ins merge each block into one mesh; the estimate stays open for the streamed city) | **measured 89 to 180; 0.77 to 1.95 M** (decals add about 1 call in the bazaar views; same caveat) | 1,500 to 3,000; 2 to 3 M | as B+D |
| **Shader and post cost** (GPU ms, est; B and B+D measured as a whole) | SDFGI 3 to 5, SSR 1 to 2, volumetric fog 1 to 2, SSAO 0.8, SSIL 1.5, TAA 0.5, glow 0.4 | est SSAO 0.8, glow 0.4, fog 0.2, LUT 0.1, shadows 2 to 3 (about 3.5 to 4.5 in all). **Measured: plus 3.2 to 4.8 ms over the plain baseline** for SSAO, SSIL, glow, fog, LUT, soft 4 split shadows and the surface shader together (about right; SSIL was not in the estimate) | est B plus grime shader 0.5 to 1, decals 0.5 to 1, particles 0.3, heat shimmer 0.3. **Measured: plus 0.5 to 1.3 ms over B in the bazaar views** for the grime mask, decals and dust (WRONG, was 1.6 to 2.6; heat shimmer not built), nothing elsewhere | B plus outline 0.5 to 1.5, toon ramp 0.2 | as B+D plus heavier fog 0.5 |
| **Load time and video memory** (est; B and B+D load measured on the stand-ins) | 8 to 15 s; 3 to 5 GB | 4 to 8 s; 1.2 to 2 GB (stand-ins: **measured load 0.82 s**, the same as the baseline, since no textures load yet; memory not measured by lookproof) | 5 to 9 s; 1.5 to 2.5 GB (stand-ins: **measured load 0.82 s**; memory not measured) | 3 to 6 s; 0.8 to 1.5 GB | as B+D |
| **Asset pipeline** | Full PBR sets per material (albedo, normal, roughness, AO), many unique; hero models with high detail | Per area kit: one atlas and one trim sheet, AI texture cards; decals; procedural massing; AI 3D for vehicles and characters with cleanup | B plus a grime decal set (40 to 80, est) and a per-kit wear mask; no extra models | Fewer textures, hand-painted look; outlines need clean normals | as B+D |
| **AI art prompt fit** | Medium: tileable real PBR is hard to keep seamless | Good: "stylised realistic, clean shapes, warm light, hand-tuned colour" holds across a batch | Good: grime decals are an easy prompt (stains, posters, soot) | High, but out | Good |
| **Tooling** | SDFGI tuning, LUT, TAA, LOD chains | LUT, one shared building shader, MultiMesh kits, LOD | B plus grime mask shader, decal atlas, wear value in area profiles | CompositorEffect outline, toon shader | as B+D |
| **Risk** | Frame time over budget across a city; dated soonest; art volume | Mixed looks if prompts drift; can look clean and empty if density is low | Grime overdone looks like poverty as spectacle (respect rule); decal overdraw in dense lanes | Wrong tone | Whole city grim, against "rich and warm" |
| **Scope and time** (est) | Adopt: 4 to 6 tasks; per new district: high art cost | Adopt: 2 to 3 tasks; per district: one kit (1 to 2 tasks plus cards) | B plus 1 task for the grime layer; per district: tune its wear value | 2 to 3 tasks | as B+D |
| **Fit with the existing code** | New Godot project, nothing to rewrite | Same | Same | Same | Same |
| **Readability floor** (dusk and night, dark lanes) | Weak in dark interiors without GI | Good: warm sodium lights and sign glow keep night readable | Good if grime stays off the characters and road markings | Strong | Weak at night |
| **Performance while driving at 140 km/h** (est) | Streaming and SDFGI cascades lag behind fast cars | Fine with LOD and MultiMesh | Fine; decals culled beyond 80 to 120 m (est) | Fine | Fine |
| **Asset volume, whole game** (est) | 2 to 3 times B | See the fidelity table | B plus 40 to 80 grime decals | Less than B | as B+D |
| **Scales down** (Mobile renderer or low preset) | Poorly: loses SDFGI, SSR, SSIL and volumetric fog, then looks flat | Well: Mobile keeps fog, glow, LUT and shadows; loses SSAO and SSIL | Well: grime is in the materials, so it survives the low preset | Well | Well |

## Side by side

`harness/reports/look/style_options.jpg`, from `node harness/bin/lookproof.mjs --sheet baseline,style_stylised_afternoon,style_stylised_golden,style_stylised_grime_afternoon,style_stylised_grime_golden[,style_realistic_afternoon,style_realistic_golden] --out style_options`. One row per view (9 views from P0-009, including landmark tiers, the two area kits and the on-foot view), one column per style and light. The p95 under each label is from the Metal run, which has no GPU timer, so it is CPU time only (0.2 to 0.9 ms); the real frame cost is the Vulkan table below. Made in P0-011 (2026-11-10).

### Measured in Godot (batch A)

P0-011, 2026-11-10, Apple M2 Pro (19 core GPU), 1920 x 1080 at render scale 1.0, Godot 4.7.2 Forward+, GPU p95 over a 3 s window with the sim held, on Vulkan through MoltenVK with vsync off (`HARNESS_GODOT_ARGS="--rendering-driver vulkan --disable-vsync"`, sets `style_<id>_<light>_vulkan`; the acceptance sets `style_<id>_<light>` ran on Metal, CPU p95 0.3 to 0.9 ms). Machine load per core 0.3 during the runs. Run to run noise is about 0.5 to 1 ms (street_eye golden read 6.8 ms in B and 7.8 ms in B+D with the same work).

| View | Baseline (P0-009) | B afternoon | B golden | B+D afternoon | B+D golden |
|---|---|---|---|---|---|
| car_closeup | 2.12 | 6.29 | 6.68 | 6.27 | 6.67 |
| street_eye | 2.20 | 6.24 | 6.77 | 6.26 | 7.77 |
| junction | 2.28 | 6.74 | 7.11 | 6.72 | 7.15 |
| flyover_ramp | 2.02 | 6.25 | 6.29 | 6.23 | 6.29 |
| hud_play | 2.35 | 6.72 | 7.15 | 6.73 | 7.09 |
| busiest_40m | 2.33 | 6.81 | 6.91 | 6.78 | 6.92 |
| landmark_tiers | 1.48 | 4.67 | 4.72 | 4.64 | 4.73 |
| area_blocks_30m | 1.89 | 5.81 | 5.94 | 6.32 | 6.45 |
| on_foot_bazaar | 2.13 | 6.87 | 6.96 | 7.89 | 8.29 |
| **worst** | 2.35 | **6.87** | **7.15** | **7.89** | **8.29** |

The B+D columns are from the first run, when the dust motes were GPUParticles3D. The dust then moved to CPUParticles3D (the GPU version printed an engine shader leak ERROR on quit). A rerun of the two B+D Vulkan sets after that change happened while another project loaded this Mac (load per core 1.1 to 1.4 against 0.3 to 0.6 before): it read 7.4 to 12.0 ms in every view, including views with no grime at all, so it measured the outside load, not the style, and is not used here (it is what `style_stylised_grime_*_vulkan/perf.json` now holds). A calm rerun is a follow-up. The Metal acceptance sets were reshot after the change.

All 36 view runs of the table are "ok" against the draft budgets (warn 11.1 ms, fail 16.6 ms; draw calls 89 to 180 against warn 450; triangles under 2 M against warn 5 M; load 0.82 s). Headroom on this Mac: about 8 ms to the 60 fps line in the worst view, before textures, crowds, traffic and streaming.

What the tests contain (game/render/, one script plus a .tres per style and per light):
- B (`stylised`): Filmic tonemap (AgX looked grey and flat on these stand-ins), a warm 3D LUT (33 cubed, split tone and saturation), glow with a light bloom, SSAO, SSIL, sun-lit exponential haze, a procedural sky per light, soft 4 split sun shadows, one shared surface shader for walls, roads and leaves with world space detail (plaster mottling, asphalt grain, leaf variation, backlit leaves), clearcoat car paint, reflective glass, and rim light on people and signs.
- B+D (`stylised_grime`): B plus the grime mask in the same shader, scaled by each block's wear (stand-in for the area profile `wear`: bazaar 0.9, Lutyens 0.03, every other block 0): damp at the wall base, soot and rain streaks, patched plaster, faded paint, dust on roofs, oil and wet patches on the street; procedural wall decals on the bazaar shop fronts (wordless posters on the wall piers at eye height and under the first floor windows, streaks, damp stains, patches); dust motes in the air over the bazaar street. People, signs and goods keep clean materials.
- Lights: `afternoon` (sun 52 degrees up from the south west, pale warm sky, dusty haze) and `golden` (sun 12 degrees up from the west north west, orange light, long shadows, glowing haze, lamps and shop bulbs bloom).
- Not built in the time box: heat shimmer over asphalt, a thicker haze over Old Delhi only (needs a FogVolume and volumetric fog, a cost to measure), real textures or trim sheets (no art yet).

What the shots show (read by the builder): grime shows clearly on the bazaar facades and roofs from above (area_blocks_30m) and only there; the Lutyens block and every street, landmark and car view look the same in B and B+D. At eye height in the bazaar (on_foot_bazaar) the grime is subtle: stains on the street, streaks on the upper walls, small posters. Golden reads as golden in open views; the narrow bazaar is in the shade of its own west row in golden light, so it changes less. These are the points for style round 3 below.

### Measured in Godot (batch B, `stylised_b`)

P0-034, 2026-11-11. Batch B is B+D (`stylised_grime`) plus Anmol's style round 3 asks: "Full day-night cycle", grime on Old Delhi "Much stronger", and "Building detail, Materials, Atmosphere, Night and lights. I feel small things that looks like attention to detial for delhi should be there and not missed". Style id `stylised_b`, light presets `--light=dawn|afternoon|golden|night`, or `--time=<0..24>` for any hour of the day-night curve.

Sheet: `harness/reports/look/style_options_b.jpg` (columns: baseline, B+D golden, then batch B dawn, afternoon, golden, night; one row per view). Made with `node harness/bin/lookproof.mjs --sheet baseline,style_stylised_grime_golden,style_stylised_b_dawn,style_stylised_b_afternoon,style_stylised_b_golden,style_stylised_b_night --out style_options_b`. The labels are now short names with the worst GPU p95 (Vulkan) under each; the old sheet showed the Metal CPU time.

GPU p95 in ms over a 3 s window with the sim held, Apple M2 Pro, 1920 x 1080, Godot 4.7.2 Forward+ on Vulkan through MoltenVK with vsync off. Calm machine: load per core 0.36 to 0.65 during every run (under 1). The batch B sets ran on Vulkan directly (`style_stylised_b_<light>`); the two B+D sets are the calm reruns asked for in P0-011 (`style_stylised_grime_<light>_vulkan`).

| View | Baseline | B+D afternoon | B+D golden | B2 dawn | B2 afternoon | B2 golden | B2 night |
|---|---|---|---|---|---|---|---|
| car_closeup | 2.12 | 7.26 | 7.76 | 9.80 | 9.00 | 8.71 | 10.17 |
| street_eye | 2.20 | 7.29 | 7.57 | 10.28 | 9.17 | 8.84 | 9.76 |
| junction | 2.28 | 7.75 | 8.02 | 10.77 | 9.74 | 9.26 | 10.14 |
| flyover_ramp | 2.02 | 7.11 | 7.17 | 9.40 | 9.15 | 8.27 | 9.53 |
| hud_play | 2.35 | 7.81 | 8.02 | 10.86 | 9.91 | 9.21 | 10.01 |
| busiest_40m | 2.33 | 7.64 | 8.02 | 9.50 | 10.01 | 9.16 | 9.79 |
| landmark_tiers | 1.48 | 6.58 | 5.48 | 7.05 | 7.13 | 6.69 | 6.89 |
| area_blocks_30m | 1.89 | 7.16 | 7.48 | 8.65 | 9.36 | 8.62 | 8.91 |
| on_foot_bazaar | 2.13 | 8.86 | 9.14 | 12.55 | 11.89 | 11.87 | 12.85 |
| **worst** | **2.35** | **8.86** | **9.14** | **12.55** | **11.89** | **11.87** | **12.85** |

(B2 = `stylised_b`, the P0-034 setup before the lean pass.) These numbers are superseded by the P0-037 table below: after the lean pass the worst view is 7.75 to 9.29 ms in all four lights and every view is "ok" against the signed budgets (warn 10.0 ms, fail 12.0 ms). Before the pass, on_foot_bazaar was 11.9 to 12.9 ms (over the 11.1 ms draft warn line); draw calls were 104 to 320, triangles 0.8 to 3.2 M with shadow passes, load 1.07 s. The calm B+D reruns read about 0.5 to 1 ms above the P0-011 table: that is run to run noise on this Mac, and they replace the contaminated sets.

Where the P0-034 cost came from (golden, before the optimisation round, street_eye / on_foot_bazaar, one part off at a time with `--style-off=<part>`): everything on 12.3 / 14.6 ms; volumetric haze off 11.0 / 14.0; heat shimmer off 10.3 / 13.6; dressing off 10.8 / 13.0; lights off 10.1 / 11.5; textures off 11.1 / 14.4 (noise 0.5 to 1 ms). The P0-037 pass below acted on this (and on the sun shadow finding) and replaced the open "to get the bazaar under 11 ms" ideas: the bazaar is now 7.75 to 9.29 ms worst view.

#### P0-037 pass: frame time and night light (after Anmol picked "Pure stylised B")

Same machine and method (GPU p95, Vulkan, vsync off, sim held, 3 s window), measured 2026-11-11 with load per core 0.34 to 0.60 in every run. Another project's browser tests were using the GPU on and off during the session: runs that spiked during those bursts were rerun once when the machine was calm. "Before" is the P0-034 table above.

| View | Dawn before | Dawn after | Afternoon before | Afternoon after | Golden before | Golden after | Night before | Night after |
|---|---|---|---|---|---|---|---|---|
| car_closeup | 9.80 | 7.70 | 9.00 | 6.62 | 8.71 | 6.55 | 10.17 | 7.34 |
| street_eye | 10.28 | 7.50 | 9.17 | 6.80 | 8.84 | 6.55 | 9.76 | 7.98 |
| junction | 10.77 | 8.37 | 9.74 | 7.07 | 9.26 | 6.51 | 10.14 | 8.13 |
| flyover_ramp | 9.40 | 6.74 | 9.15 | 6.51 | 8.27 | 6.71 | 9.53 | 7.46 |
| hud_play | 10.86 | 7.89 | 9.91 | 7.03 | 9.21 | 6.67 | 10.01 | 8.24 |
| busiest_40m | 9.50 | 7.61 | 10.01 | 7.54 | 9.16 | 6.61 | 9.79 | 8.01 |
| landmark_tiers | 7.05 | 6.63 | 7.13 | 6.47 | 6.69 | 6.67 | 6.89 | 6.57 |
| area_blocks_30m | 8.65 | 6.72 | 9.36 | 7.94 | 8.62 | 6.60 | 8.91 | 7.11 |
| on_foot_bazaar | 12.55 | 8.68 | 11.89 | 9.29 | 11.87 | 7.75 | 12.85 | 9.18 |
| **worst** | **12.55** | **8.68** | **11.89** | **9.29** | **11.87** | **7.75** | **12.85** | **9.18** |
| typical (median view) | 9.80 | 7.61 | 9.36 | 7.03 | 8.84 | 6.61 | 9.79 | 7.98 |

Every view is "ok" in every light now (warn line 11.1 ms). Draw calls 96 to 315, triangles 0.8 to 3.2 M with shadow passes, load 1.06 to 1.33 s. Against the performance target (10 to 11 ms GPU at about 1080p) stylised B now has 2 to 4 ms of headroom on the stand-ins.

Where the time went (bazaar, golden, one part off at a time, `--style-off=<part>`): the sun's soft shadows were the big cost, not the shadow geometry. PCSS (the contact-hardening soft shadow Godot uses when the sun has an angular size) cost about 1.8 ms and blending the four shadow splits about 1 ms more; fewer shadow triangles (2 splits, 80 m, no shadows from the dressing) changed nothing measurable. SSIL cost about 1.5 to 2 ms (kept, at low quality), decals about 0.5 ms, glow and SSAO under the noise (about 0.5 ms run to run).

What changed (stylised B only; the realistic reference keeps the P0-034 setup):
- Sun shadows: plain filtered shadows with a wider blur, no PCSS, no split blending. The edges stay soft.
- SSAO and SSIL at low quality. No volumetric fog pass at all: the bazaar haze is a cheap depth haze box (thicker near the ground, clear for the first 6 m so near people stay crisp).
- Shop lights: one open shop in three gets a real light, and only once it is properly dark; the rest glow through their tube lights.
- Night: the sodium street lights have inverse square falloff and tip 15 degrees out over the carriageway, so each throws a warm pool that is bright under the head and fades over 10 to 15 m (same number of lights as before). A cool moonlit sky fill stops surfaces that face away from every lamp going black (that was the bazaar crate with one black side: it faced away from the only shop light near it and the night ambient was close to zero).
- The swirl cracks on the road and the marbled swirl on dark shop walls were one bug: the texture import option "fix alpha border" bled the dark tar and crack lines into the neighbouring pixels of the mask textures (their alpha is a mask, not transparency). It is off now for the six tiling layers (realistic gets the same fix). On top of that stylised B keeps the tar lines faint and without gloss, and softens the plaster cracks on dark walls and at eye height.
- Ground cover: the bare ground between the bazaar and Lutyens is dusty earth with wide patches of dry grass, a few scrub clumps and pebbles (shader only).
- Dawn: a little more contrast and slightly thinner haze.

What batch B contains (game/render/, all procedural, no art files):
- Day-night cycle: `day_cycle.gd` blends the light presets as keys (night 0 to 4.6 h, dawn 6.3, afternoon 15.0, golden 17.75, dusk 19.0, night from 20.5) into one sun, sky, fog, exposure and night-lights curve. The directional light is the sun by day and a faint cool moon by night; it swaps at dusk and before dawn, where it is nearly off. Dawn: pink and peach light through a thick morning haze. Night: dark blue sky with a warm city glow at the horizon.
- Night and lights: sodium street lights (spot lights under the lamp heads), shop tube lights and shop lights, neon outlines on about a third of the bazaar boards, headlights and tail lights on every vehicle, lit windows (55 percent at night, warm bulbs, cool tube lights, curtains), lamps on the bazaar electricity poles, warm floodlights on the landmarks, and 40 percent of bazaar shutters pulled down.
- Grime, bazaar only (wear 0.9; Lutyens 0.03 stays clean; the arterial 0): rising damp with a dark tide line and salt above it, soot and rain streaks that start under each floor band and under window sills (decals), tea-coloured water stains with dark rims, peeling paint that shows a paler old coat or bare brick, patched plaster, paan stains at the wall base, torn poster layers on the piers, AC drip stains, oil, litter specks, and sharp-edged puddles with a damp ring. P0-011 polish fixed: the full-height streaks ("streaky roof grime") are gone, the soft blotch puddles have hard edges now, grime is much stronger at eye height, and the golden bazaar gets soft bounce light so it no longer sits flat in its own shade.
- Materials: six generated tiling layers in one Texture2DArray (`game/render/textures/tile_*.png`, from `game/render/tools/make_textures.gd`): plaster with cracks, exposed brick, concrete with formwork lines, asphalt with patches and tar lines (two scales blended so it does not repeat on a grid), red and grey footpath tiles, ribbed shutter. A trim sheet (`trim.png`): moulded floor band, concrete sill and sunshade edge, black and yellow paint, shutter drum; and a window grille texture. Sampled in world space in `shaders/surface_b.gdshader` (the stand-ins have no UVs). They are slots for the AI texture cards after the sign-off. The floor band row of the trim sheet is not used yet.
- Atmosphere: a dust and haze volume over the bazaar only (volumetric fog, one FogVolume, with sun shafts), thinner haze elsewhere; faint heat shimmer over far asphalt in the afternoon (a full-screen pass that skips anything within 15 m and the sky); the B+D dust motes over the bazaar street. People keep their clean materials.

#### Delhi detail checklist

| Detail | Landed | Where and how |
|---|---|---|
| Window frames and grilles | yes | Frame bars, concrete sills, sunshades (chhajja) on about half, grilles (bars, diamond and sunburst motif) on 45 to 65 percent of windows |
| Balconies | yes | Grille fronts, top rail, potted plants, laundry lines |
| AC units with drip stains | yes | Fan grille, slats, wall brackets, drip pipe, a drip stain decal under each unit |
| Roof water tanks (fix: read as holes from above) | yes | Ribbed body, domed top, lighter lid, brick stand, pipe; 70 percent black, the rest white or blue. They read as tanks in area_blocks_30m |
| Tangled overhead wires | yes | 3 to 6 wires per bundle across the bazaar lane, spare cable coils, bundles along both shop rows; wires along the shop fronts on the arterial |
| Shop shutters | yes | Ribbed shutter texture, guide rails, rolled drum; closed shutters at night |
| Hand-painted signboards, Hindi and English | yes | About 2 in 5 boards carry an invented Hindi name, the blank second boards in the bazaar get Hindi names. Devanagari comes from the system font (Kohinoor Devanagari on macOS); a shipped OFL font is needed later |
| Hanging laundry | yes | Balconies and roof clothes lines, kurtas and long saree strips |
| Tarps and awnings | yes | Blue tarps over roof junk and over vendor carts, tarps strung over the bazaar vendors; the cloth awnings stay |
| Potted plants | yes | Balconies, roof edges, shop fronts on the arterial footpaths |
| Scooters on footpaths | yes | Rows of 3 to 5 parked scooters on the arterial footpaths, kept clear of people |
| Vendor carts | yes | Carts with tarp canopies on the arterial footpaths (the bazaar carts stay) |
| Electrical boxes | yes | Green feeder boxes with an invented stencil (खतरा 440V, KVS-27), meter boxes with wires on bazaar piers |
| Broken kerbs | yes | Missing stone gaps, a stone tipped onto the road, rubble chips |
| Black and yellow painted kerbs | yes | The median (already there) plus the footpath kerbs 36 m either side of the junction |
| Milestone stones | yes, one | White stone with a yellow top on the west footpath: लाल किला, RED FORT, 4 km |
| Police-style barricades, invented markings | yes | Three steel barricades with black and yellow boards and "TRAFFIC यातायात" at the junction and in the service lane |
| Stray dogs | yes | Simple lying and standing dogs on the footpaths and by the bazaar walls |
| Extra | yes | Rusty rebar on unfinished roofs, dish antennas, festive bunting across the bazaar, strings of snack packets at shop openings, neon outlines, litter specks |

Not landed in the time box: cows and other animals, painted signs as textures (the boards are still text labels), more than one milestone, dressing on the far city blocks beyond the street, and a real Devanagari font in the project. The realistic reference look (old option A) was built in round 4, below.

### Realistic vs stylised B (P0-038, style round 4)

Anmol, round 4: "Show me realistic too first". Fidelity bar: Watch Dogs 2. Style id `realistic`, the same four lights (`--light=dawn|afternoon|golden|night`). It extends batch B, so every dressing piece, the bazaar-only grime and all the Delhi detail are identical: the comparison is about rendering only.

Sheet: `harness/reports/look/style_options_real.jpg` (columns: baseline, then stylised B and realistic side by side for dawn, afternoon, golden and night; one row per view). Made with `node harness/bin/lookproof.mjs --sheet baseline,style_stylised_b_dawn,style_realistic_dawn,style_stylised_b_afternoon,style_realistic_afternoon,style_stylised_b_golden,style_realistic_golden,style_stylised_b_night,style_realistic_night --out style_options_real`.

What realistic adds over stylised B (all procedural, no art files):
- Surfaces: a normal from the height of every texture layer (brick joints, paver joints, plaster cracks, asphalt grain, shutter ribs), a second finer texture scale for close views (about 3 times the texel density), ambient occlusion and roughness from the joints, less of the soft plaster blotching (the "marbled" walls), and earth with dry grass and pebbles on the bare ground between blocks.
- Wet and dust per light: dawn has a damp street (the morning wash), night a damp street that shows the lamps, golden almost dry, afternoon dry with a dust film on the road, thicker dust on roofs, footpaths and the wall bases.
- Light: a physical sky (scattering from the sun position, heavy with dust), screen-space reflections (cars, glass, wet roads), SSAO and SSIL, volumetric fog over the whole view so the sun makes shafts and the lamps make cones, a filmic tonemap with a neutral to warm grade (half the tint and saturation of B), TAA.
- Night: sodium street lights with real inverse square falloff, so each lamp throws a pool on the road that fades over about 10 m, plus cones in the haze.
- Tried and left out, measured: SDFGI (real-time GI) made the bazaar lane near black by day, still black after 12 s to settle, with or without the dressing, and cost 3 to 4 ms more; SSIL plus sky light was the better GI here. ACES tonemap crushed the shaded asphalt to black at golden and dawn; Filmic kept it readable. Both stay available as opt-in tokens (`--style-off=sdfgi_on`, `aces_on`).

GPU p95 in ms, Apple M2 Pro, 1920 x 1080 native, Godot 4.7.2 Forward+ on Vulkan (MoltenVK), vsync off, sim held, 3 s window. Calm machine: load per core 0.36 to 0.83 in every run (under 1). Stylised B numbers are the P0-034 sets.

| View | B dawn | Real dawn | B afternoon | Real afternoon | B golden | Real golden | B night | Real night |
|---|---|---|---|---|---|---|---|---|
| car_closeup | 9.80 | 15.70 | 9.00 | 13.30 | 8.71 | 13.08 | 10.17 | 14.11 |
| street_eye | 10.28 | 15.55 | 9.17 | 12.96 | 8.84 | 13.30 | 9.76 | 14.32 |
| junction | 10.77 | 16.13 | 9.74 | 13.55 | 9.26 | 13.19 | 10.14 | 15.18 |
| flyover_ramp | 9.40 | 14.39 | 9.15 | 13.04 | 8.27 | 12.52 | 9.53 | 14.23 |
| hud_play | 10.86 | 16.23 | 9.91 | 13.74 | 9.21 | 13.18 | 10.01 | 14.91 |
| busiest_40m | 9.50 | 14.46 | 10.01 | 14.19 | 9.16 | 13.57 | 9.79 | 14.39 |
| landmark_tiers | 7.05 | 11.10 | 7.13 | 10.48 | 6.69 | 9.44 | 6.89 | 10.63 |
| area_blocks_30m | 8.65 | 13.64 | 9.36 | 13.73 | 8.62 | 13.07 | 8.91 | 13.10 |
| on_foot_bazaar | 12.55 | 18.04 | 11.89 | 16.33 | 11.87 | 15.60 | 12.85 | 17.87 |
| **worst** | **12.55** | **18.04** | **11.89** | **16.33** | **11.87** | **15.60** | **12.85** | **17.87** |
| typical (median view) | 9.80 | 15.55 | 9.36 | 13.55 | 8.84 | 13.18 | 9.79 | 14.32 |

Realistic costs about 3.7 to 5.8 ms more than stylised B in every view. Draw calls and triangles are the same (104 to 320 calls, 0.8 to 3.2 M triangles with shadow passes), load 1.07 s for both: the extra cost is all per-pixel (SSR, the full-view volumetric fog, the bump and second texture fetch, TAA). Budgets (draft): warn 11.1 ms, fail 16.6 ms. Every realistic view except landmark_tiers is "warn"; on_foot_bazaar is "FAIL" at dawn (18.0) and night (17.9).

Extra measurements, afternoon:
- With an upscaler, FSR 2.2 at render scale 0.75 (1440 x 810 inside, shown at 1080p; set `style_realistic_afternoon_fsr2_075`, `--style-off=fsr2@0.75`): worst 12.64 ms (bazaar), typical 11.23 ms, every street view 10.8 to 11.6 ms. That saves 2.3 to 3.7 ms. MetalFX could not be measured: it needs the Metal driver, which reports no GPU time.
- With SDFGI on (`style_realistic_afternoon_sdfgi`, 3 views): street_eye 16.43, junction 17.52, on_foot_bazaar 18.99 ms, that is 3.5 to 4 ms over realistic without it.

Per light, what realistic gains and loses against stylised B (read from the sheet):

| Light | Realistic gains | Realistic loses | GPU p95 worst / typical, B vs realistic |
|---|---|---|---|
| Dawn | Damp street with soft reflections, a real sky gradient, haze with depth, brick and paver relief | The pink and peach mood of B; street views go brown and dark, the far city fades into murk | 12.6 / 9.8 vs 18.0 / 15.6 |
| Afternoon | Believable hazy daylight, a dust film on the road, relief on brick and tiles, a neutral sky | Most of the warmth Anmol liked in B's "Afternoon heat"; shaded sides read grey | 11.9 / 9.4 vs 16.3 / 13.6 |
| Golden | Sun shafts through the haze from above, deeper contrast, a natural orange sky | The glowing golden colour at street level: the shaded street is much darker than in B | 11.9 / 8.8 vs 15.6 / 13.2 |
| Night | Sodium lamp pools on the road with real falloff, light cones in the haze, wet reflections of lamps and signs | Neon pops a little less, the far city and roofs are darker | 12.9 / 9.8 vs 17.9 / 14.3 |

Both looks keep people readable (clean satin material and rim light), and both show the same bazaar-only grime and Delhi detail. The grime reads stronger in realistic up close (the joints and cracks catch light).

Verdict against the performance target (decisions.md "Performance target": this M2 Pro, 60 fps steady at play speed, about 1080p rendered and upscaled, render about 10 to 11 ms GPU):
- **Stylised B: fits, with work.** (P0-037 did that work: worst 7.8 to 9.3 ms, typical 6.6 to 8.0 ms, table in batch B.) Typical view 8.8 to 9.8 ms at native 1080p, worst 11.9 to 12.9 ms (the bazaar). The bazaar needs the optimisations listed in batch B. These are stand-ins: the real city adds streaming, traffic, crowds and more geometry, so the 1 to 2 ms of headroom is thin but workable with LODs and an upscaler.
- **Realistic: does not fit.** Typical view 13.2 to 15.6 ms at native 1080p, worst 15.6 to 18.0 ms, over the 10 to 11 ms render target in every view and over the 16.6 ms line in the bazaar, before any real city content. Even at 810p inside with FSR 2 it is 11.2 typical and 12.6 worst, still over the target and below "about 1080p".
- Not measured: a 1080p render upscaled to a 1440p or Retina window (the look proof views are fixed at 1920 x 1080; native 1080p is the cost of the render itself, the FSR 2 pass adds about 0.5 to 1 ms, est).

Risk at play speed (the views are held still, so these are judged from how each feature works, not measured at 200 km/h):
- TAA ghosting: thin wires, poles and the edges of fast cars smear for a frame or two. Realistic leans on TAA; stylised B does not use it.
- Screen-space reflections on wet roads vanish or tear when the reflected car or lamp leaves the screen; at speed this flickers at the bottom edge. Realistic only.
- Bump shimmer: the derivative bump is faded out from 18 to 60 m to stop sparkle; the near road still crawls a little without TAA.
- Volumetric fog lag: the fog reuses last frame's result, so shafts and lamp cones trail when the camera turns fast. Realistic uses it over the whole view; B only over the bazaar.
- GI lag: SDFGI is off, so there is no GI lag. With SDFGI on, its cascades would lag behind a car at 200 km/h (not measured; held views only).

Asset cost per look (what Anmol would make or source; Claude derives the rest):
- Stylised B: one albedo card per material (AI image, tileable), atlases and trim sheets per area kit, alpha decals. Normals, roughness and AO come from Claude's tools. Models only need clean silhouettes and simple UVs.
- Realistic: a full PBR set per material that tiles (albedo plus a height or normal map at least; Claude can derive roughness and AO), at 2 to 3 times the texel density, so more unique sets per area (each shop front, each wall type). Models need proper UVs, baked normal maps and more detail (AI 3D output needs more cleanup). Characters need real skin and cloth materials. Light per area needs more tuning (no SDFGI: hand-placed bounce lights in lanes).

#### Effort per area and per mission (all numbers are estimates)

Hours for Anmol are art hours (running the AI tools, checking, re-doing, uploading). Build hours are Claude's work in the game. "x" is realistic over stylised B.

| Item | Anmol art, B | Anmol art, realistic | x | Build, B | Build, realistic | x |
|---|---|---|---|---|---|---|
| One area kit (for example the Chandni Chowk bazaar): textures | 2 to 3 h (8 to 12 cards) | 8 to 12 h (20 to 30 PBR sets) | about 4 | 2 to 3 h | 4 to 6 h | about 2 |
| One area kit: normal and other maps | 0 h (generated) | 2 to 4 h (checking derived maps, fixing seams) | new | 0 to 1 h | 2 to 4 h | about 4 |
| One area kit: models and props (30 to 50) | 6 to 10 h | 15 to 25 h | about 2.5 | 6 to 10 h | 10 to 16 h | about 1.6 |
| One area kit: light and look tuning | 0 h | 0 h | | 2 to 3 h | 4 to 6 h | about 2 |
| **One area kit, total** | **8 to 13 h** | **25 to 41 h** | **about 3** | **10 to 17 h** | **20 to 32 h** | **about 1.9** |
| One hero landmark (India Gate, Red Fort) | 3 to 6 h | 10 to 20 h | about 3 | 4 to 8 h | 8 to 14 h | about 1.8 |
| One story mission (mission props, a character or vehicle, the set dressing) | 2 to 4 h | 5 to 10 h | about 2.5 | 8 to 14 h | 12 to 20 h | about 1.5 |
| **Pilot** (4 districts, 3 heroes) | 40 to 70 h | 130 to 220 h | about 3 | 50 to 90 h | 100 to 170 h | about 1.9 |
| **Slice** (pilot plus missions M01 to M04) | 50 to 85 h | 150 to 260 h | about 3 | 80 to 150 h | 150 to 250 h | about 1.7 |
| **Act 1** (pilot plus 10 missions) | 60 to 110 h | 180 to 320 h | about 3 | 130 to 230 h | 220 to 370 h | about 1.7 |
| **Whole game** (10 area kits, 15 heroes, about 70 missions) | 270 to 500 h | 750 to 1,400 h | about 2.8 | 720 to 1,270 h | 1,160 to 1,930 h | about 1.5 |

#### Why the stand-in scene does not look like Watch Dogs 2

The test scene is a stand-in. Both looks sit far below Watch Dogs 2 for reasons that the rendering cannot fix:
- **Geometry.** Our buildings are boxes with flat walls. Watch Dogs 2 facades are modelled: window recesses, cornices, bevelled edges, pipes, ledges, balconies with depth. Light and shadow on that depth is most of what reads as "real".
- **Materials.** We have six procedural 512 px layers mapped in world space. Watch Dogs 2 has hand-made PBR sets, trim sheets, unique shop fronts, many decals per wall and blended layers (dirt, wet, paint) painted by artists.
- **Prop density.** We have hundreds of dressing pieces in the scene. A Watch Dogs 2 block has thousands: litter, signs, bins, street furniture, plants, cables, parked bikes, posters, all placed by hand or by tools.
- **Models.** Our people, cars and autos are simple boxes. Watch Dogs 2 has scanned characters with cloth, faces and animation, and cars with interiors, lights and dirt.
- **Post and light.** This is the one part that is close: tonemap, grade, fog, reflections and AO are similar. Watch Dogs 2 also uses baked light probes and an artist grade per district, which we can add later.

What each later piece of work adds (the phases are planned after the sign-offs): the map bake and repair layer gives real street layouts, footprints and heights; the area profile generator gives modular facades with depth and per-area dressing at real density; the landmark pipeline gives hero models; the art batches replace the procedural layers with real textures, trims and decals; the character and vehicle work gives real models; a late lighting pass adds per-district grades and light probes. The look we pick now is the base that all of this sits on, so the choice is about cost and feel, not about how the stand-ins look today.

## Landmark tiers and area kits per candidate

Tiers from `DELHI_WORLD.md` section 1: hero (detailed model, recognised from the road at driving speed), signature (right silhouette and colour), marker (right footprint, massing and material). The two contrasting area kits for every test: Chandni Chowk old city bazaar and a Lutyens bungalow road. All counts and costs are estimates.

### Per candidate

| | A. Realistic | B. Stylised | B+D. Stylised with grime | C. Comic | D. Gritty |
|---|---|---|---|---|---|
| **Hero** (India Gate, Red Fort, CP circle) | Carved sandstone detail, weathering, real AO; 80 to 200 k triangles per hero with LODs | Correct silhouette and main carving, simplified stone detail, warm clean sandstone; 30 to 80 k triangles | As B; Red Fort walls get age stains and soot, India Gate stays clean (it is kept clean in reality) | Outlined, flat-painted stone | Every hero stained and dark |
| **Signature** (Jantar Mantar, Khan Market, Jama Masjid) | Real texture set per building | Right silhouette and colour from a parts kit, one facade texture each | As B, wear from the area profile | Flat colours | Dirty |
| **Marker** (an old tomb, a station, a mall) | Area kit material on the footprint | Area kit material, roof type, correct height | As B with wear | Flat colours | Dirty |
| **Kit 1: Chandni Chowk bazaar** | Real brick, plaster, rust; dense props | Tight shop houses, stacked shop boards, wires, awnings, vendors; colours clean and warm | B plus soot, stains, peeling posters, patched plaster, dust in the air: the Old Delhi grime Anmol asked for | Painted and outlined | As B+D but darker |
| **Kit 2: Lutyens bungalow road** | Real lawns, white plaster, buff stone | Low white bungalows behind walls, big trees, wide clean roads; light dapples through trees | Clean, wear near zero: the contrast with Old Delhi is the point | Painted and outlined | Grimy, which is wrong for Lutyens |
| **On foot in the bazaar** | Best close up, costly | Readable crowd and shop detail at 1.7 m | Richest: grime makes ground floors feel real; keep fighters readable | Toy-like | Murky |
| **AI fit, landmark models** | Low: AI 3D tools do not hold carved detail and symmetry; hand modelling likely | Medium: AI 3D from a concept image gets massing; symmetry and arches need cleanup; India Gate easy, Red Fort split into wall, gate and pavilion parts | As B | Medium | As B |
| **AI fit, kit textures** | Medium (seamless PBR) | Good (atlases, trims and decals in a fixed anchor) | Good; grime decals are easy prompts | High | Good |

### Asset volume per tier (whole game, est; pilot in brackets)

| Tier or kit | Count | Made by | Notes |
|---|---|---|---|
| Hero landmark models | 10 to 20 (pilot 3: CP circle, India Gate, Red Fort) | Model cards on the dashboard: AI 3D from a concept image, cleanup by Claude with scripted tools (Blender in background mode if P0-010 confirms it is available); hand-made by a modeller if the AI result fails twice | Each 1 to 3 materials, own LOD chain and a far silhouette. The ingest limit (25,000 triangles, 3 materials) is too low for heroes; P0-010 sets a hero limit or a parts split |
| Signature landmarks | 60 to 150 (pilot 5 to 8) | Procedural parts kit (domes, chhatris, arches, colonnades, minarets) plus one facade texture card each | Built by Claude from registry data; cards only where the kit material is not enough |
| Marker landmarks | hundreds to a few thousand (pilot 30 to 80) | Procedural only | Use the area kit atlas |
| Area kit atlases | 8 to 12 kits, 1 atlas plus 1 trim sheet each (pilot 3: CP colonnade, Chandni Chowk bazaar, Lutyens or ITO institutional) | AI texture cards, 6 to 12 cards per kit | Same atlas in B and B+D; B+D adds wear |
| Grime decal set | 40 to 80 (pilot 20 to 30) | AI texture cards (alpha decals) | B+D only; respect rule checked by the art reviewer |
| Shop board and sign set | 100 to 200 invented names in Devanagari, Latin and Urdu scripts (pilot 40) | Claude generates text and layouts procedurally; a few AI cards for hand-painted boards | No real brands or parties |

## Sample AI prompts per candidate

Style anchors (the fixed text every card starts with):
- A: "photoreal game texture, physically based, neutral daylight, no people, no text"
- B: "stylised realistic game art, real proportions, clean simplified shapes, rich warm colour, soft hazy sunlight, hand-tuned colour, no outlines, no text unless asked"
- B+D: anchor B plus "lived-in surfaces: soot, water stains, faded paint, patched plaster, dust; honest, not exaggerated"
- C: "comic book game art, thick ink outlines, flat cel shading" (out)
- D: anchor A plus "grimy, desaturated, harsh contrast" (reserve)

Samples (B+D; the art-director writes the real cards after sign-off):
- Texture: "stylised realistic game art, ... Seamless tileable texture, 2048 x 2048, front view: an Old Delhi shop house ground floor wall, lime plaster over Lakhori brick, faded mint green paint, soot above the shutter line, water stains from a balcony drip, two torn paper posters in invented Hindi text, no real brands, even lighting, no shadows baked in."
- Character: "stylised realistic game art, real human proportions, ... Full body front and back turnaround, A-pose, plain grey background: a Delhi auto-rickshaw driver in his 30s, khaki uniform shirt with rolled sleeves, dark trousers, sandals, a cloth on the shoulder, tired but alert face, dignified, no logos."
- A (reference only), texture: "photoreal game texture, physically based ... red sandstone block wall, Mughal era, weathered edges, 2048 x 2048, seamless, with matching normal and roughness maps."

## Recommendation

Taken: build stylised B (`stylised_b`), with D's grime as data (a `wear` value per area profile: high in Old Delhi, near zero in Lutyens and Connaught Place), on the lean path that meets the 60 fps target on the M2 Pro. Realistic is a reference set only. See STYLE_BIBLE.md.

## Questions for the next round

### Still open for sitting 2 (style, short)

1. Do you want to see the realistic look (A) rendered too, as a cost reference? a. Yes, build it (adds one test task, about 1 to 2 rounds) b. No, test only B and B+D (recommended: faster)
2. Who should be able to play it? a. This Mac and similar (M1, M2 and newer) b. Also mid-range Windows laptops (a GTX 1650 or RTX 3050 class GPU) c. Also older or low-end PCs (Mobile renderer low preset)
3. Which AI tools will make the art cards? a. An image tool only (which one) b. Image plus an AI 3D model tool (which one) c. Claude picks free tools and you only run the cards

### Style round 3 (after the Godot tests, about the results, not the pick)

Show `harness/reports/look/style_options.jpg` and this table with measured numbers.

1. B or B+D: in the bazaar and on-foot views, is the grime right, too little, or too much?
2. Should any grime reach the other districts (East Delhi, GB Road, parts of the central core), or Old Delhi only?
3. Afternoon or golden evening: which should be the default time of day the game opens in?
4. Colour: is "rich and warm" right as shown, or too saturated, or too orange?
5. People and the on-foot view: do the stand-in proportions and clothing colours read right for "realistic proportions, stylised finish"?
6. Measured frame time: acceptable as is, or trade some look for speed (or the other way) for the players chosen in question 2?

## Decision log

- Round 1 (sitting 1): Anmol asked to see looks as pictures; look board artifact made with four looks next to real Delhi. Must not look: cartoony or childish, a generic Western city, a low-poly mobile game. Real conditions shown honestly.
- Round 1 (sitting 1): engine moved to Godot 4 desktop ("yes for godot 4").
- Round 2 (sitting 1): "I also like B, with d's dirst on old delhi". Light for tests: hot hazy afternoon and golden evening. Colour: rich and warm. Camera: third person behind. Characters: realistic proportions, stylised finish.
- Round 3 (2026-11-10): main light "Full day-night cycle"; grime "Much stronger"; push "Building detail, Materials, Atmosphere, Night and lights". Built as batch B (`stylised_b`, P0-034), sheet `harness/reports/look/style_options_b.jpg`.
- Round 4 (2026-11-11): "Show me realistic too first"; likes in batch B: "Bazaar detail and grime, Night lights, Golden hour, Afternoon heat". Built as `realistic` (P0-038), sheet `harness/reports/look/style_options_real.jpg`, comparison in "Realistic vs stylised B".
- Round 5 (2026-11-11): after the per-light sheets, the cost table and the 60 fps verdict: "Pure stylised B" (the direction).
- Sign-off (2026-11-11): "Yes, I sign off on stylised B as the Kalesh style." Recorded with `task.mjs signoff` (state.json and decisions.md "Style sign-off"). STYLE_BIBLE.md, VERIFY.md rubric lines 14 to 24, signed budgets, look rules and the approved reference (stylised_b golden) are P0-015.
