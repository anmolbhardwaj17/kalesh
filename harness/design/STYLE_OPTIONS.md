# Dilli Darshan: Style options

Status: style rounds 1 and 2 answered in interview sitting 1 (2026-11-10). Anmol leans to look B (stylised realistic) with D's grime in Old Delhi. Not signed off. Next: Godot style tests of that look (batch A), then style round 3 on the test results.

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
- Baseline: not measured yet. P0-009 builds the Godot stand-in Delhi street and writes `harness/look_proof/baseline/perf.json` (9 views). Its numbers go here.

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
| **Measured** (frame time p95 on the busiest view at 140 km/h, draw calls, load) | n/a | P0-011 | P0-012 if built | n/a |

## Comparison

All numbers est, at 1920 x 1080 internal on the M2 Pro, Forward+, for the busiest stand-in view (P0-009 "busiest view from 40 m up") unless a row says otherwise. B and B+D are the columns that matter; A is the reference; C and D are kept for completeness.

| | A. Realistic | B. Stylised | B+D. Stylised with grime | C. Comic | D. Gritty |
|---|---|---|---|---|---|
| **Godot id, batch** | `realistic`, B (optional) | `stylised`, A | `stylised_grime`, A | `comic`, B reserve | `gritty`, B reserve |
| **Look** | GTA V, Mafia II | Watch Dogs 2, Sleeping Dogs | Watch Dogs 2 plus Max Payne 3 and Far Cry 4 grime in Old Delhi | Borderlands 3 | Max Payne 3 everywhere |
| **Feel** | Grand and believable; action reads as a film | Warm, lively, readable; action is clear and loud | As B, plus Old Delhi feels old, lived in and honest about its conditions | Playful; too light for the honest city | Heavy and tense; the whole city reads as grim |
| **On foot and combat** (people at 1.7 m, guns and fights) | Best faces and cloth close up, highest cost per person; muzzle flash and smoke look real but busy scenes get muddy | Clear silhouettes and readable clothing, so enemies, cops and civilians separate well; bold muzzle flash, sparks and dust hits read at once | As B; grime adds dust kicked up by hits and soot on walls; keep character materials clean so fighters stay readable against busy walls | Very readable hits, but cartoon gore and outlines fight the tone | Fights feel heavy; readability drops in dark grimy corners |
| **Frame time p95, worst view** (est) | 18 to 26 ms (needs upscaling for 60 fps) | 9 to 13 ms | 10 to 15 ms | 9 to 13 ms | 10 to 15 ms |
| **Draw calls, triangles** (est) | 3,000 to 5,000; 4 to 8 M | 1,500 to 3,000; 2 to 4 M | 1,800 to 3,500 (decals); 2 to 4 M | 1,500 to 3,000; 2 to 3 M | as B+D |
| **Shader and post cost** (GPU ms, est) | SDFGI 3 to 5, SSR 1 to 2, volumetric fog 1 to 2, SSAO 0.8, SSIL 1.5, TAA 0.5, glow 0.4 | SSAO 0.8, glow 0.4, fog 0.2, LUT 0.1, shadows 2 to 3 | B plus grime shader 0.5 to 1, decals 0.5 to 1, particles 0.3, heat shimmer 0.3 | B plus outline 0.5 to 1.5, toon ramp 0.2 | as B+D plus heavier fog 0.5 |
| **Load time and video memory** (est) | 8 to 15 s; 3 to 5 GB | 4 to 8 s; 1.2 to 2 GB | 5 to 9 s; 1.5 to 2.5 GB | 3 to 6 s; 0.8 to 1.5 GB | as B+D |
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

`harness/reports/look/style_options.jpg`, from `node harness/bin/lookproof.mjs --sheet baseline,style_stylised_afternoon,style_stylised_golden,style_stylised_grime_afternoon,style_stylised_grime_golden[,style_realistic_afternoon,style_realistic_golden] --out style_options`. One row per view (9 views from P0-009, including landmark tiers, the two area kits and the on-foot view), one column per style and light, worst frame time p95 under each label. Filled after P0-011.

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

Build B with D's grime as data, not as a second look: one `stylised` base and a `wear` value per area profile (high in Old Delhi, near zero in Lutyens and CP). It is what Anmol picked, it costs about 1 to 2 ms more than plain B (est), it scales down well to the Mobile renderer, and the grime follows the real city instead of covering it. Show A only if he wants the cost comparison.

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
- No sign-off yet.
