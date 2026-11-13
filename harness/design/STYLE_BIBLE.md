# Kalesh: Style Bible

Status: SIGNED 2026-11-11. Anmol: "Yes, I sign off on stylised B as the Kalesh style." (decisions.md "Style sign-off"). Style id `stylised_b` (stylised realistic, rich and warm, with Old Delhi grime by area wear, Delhi detail everywhere, four lights on one day curve). Realistic (`realistic`) stays a reference set only and is not tuned further. Written from the signed column of STYLE_OPTIONS.md, the reference board, the measured P0-037 numbers and Anmol's words. Builders read this for anything visual; the art-director and art-reviewer read "AI image prompts" before every pass. Every rule here should be checkable on a shot, and VERIFY.md rubric lines 14 to 24 point back to it.

Anmol's words that this look must honour (interview, rounds 1 to 5):
- Must not look cartoony or childish, a generic Western city, or a low-poly mobile game. Real conditions shown honestly.
- "I also like B, with d's dirst on old delhi". Colour: rich and warm. Camera: third person behind. People: realistic proportions, stylised finish.
- "Bazaar detail and grime, Night lights, Golden hour, Afternoon heat" are what he liked in the tests.
- "small things that looks like attention to detial for delhi should be there and not missed".
- "Each ADA should have its own style" built from many real photos (decisions.md "Every area is built from real references").
- Fidelity bar: Watch Dogs 2. Performance: "The game should be able to run on Mac M2 smoothly. No struggles."

## One-line look

A warm, hazy, lived-in Delhi in clean stylised realism (real proportions and real shop-house massing, simplified surfaces, rich colour, soft sun-lit haze), where grime and clutter follow each area's real conditions: heavy in the Old Delhi bazaar, near zero in Lutyens. References: Watch Dogs 2 (readable stylised realism, warm grade), Max Payne 3 and Far Cry 4 (grime and heat as atmosphere, Old Delhi only), and Anmol's concept images `harness/design/reference/mood_*.jpg`.

## Palette

Hex values are in sRGB. Day looks are warm; cool colours appear in shade, sky and night only.

| Name | Hex | Used for |
|---|---|---|
| Plaster cream | #e8e3d5 | Default shop-house and flat walls |
| Lime | #d8cdb4 | Older plaster, boundary walls |
| Mint | #9ec3a8 | Painted facades, one in ten |
| Dusty pink | #d9a79a | Painted facades, Old Delhi and Paharganj |
| Ochre | #d6a84e | Painted facades, warm accents |
| Buff stone | #c9a77c | Colonial and Lutyens stone |
| Red sandstone | #a4533b | Red Fort, Mughal trim, tomb bases |
| Brick | #8f5e45 | Exposed brick, bazaar and urban villages |
| Concrete | #8c8a84 | Flats, flyovers, kerbs (kerb #b5b1a8) |
| Asphalt | #3e3d3a | Roads (never darker than this in shade, see readability floor) |
| Paver | #9a8d80 | Footpaths; the red and cream chequer paver is a Delhi signature |
| Shutter grey | #7a7d7e | Roll-down shutters |
| Auto green | #3fa36b | Auto-rickshaw body, DTC bus green (also the Driver's tint) |
| Auto yellow | #f2c230 | Auto roof and taxi, road kerb stripe, marigold |
| Leaf | #4f6a2c | Trees (neem, peepal, gulmohar), grass #6d8a3e, dry earth #a08a68 |
| Sodium lamp | #ffa04a | Street lamps and shop bulbs at night |
| Board colours | #c0392b #f2c230 #1f5fa8 #2e8b57 #e67e22 #7b2d8b #0f7c7c #d6336c | Hand-painted shop boards (white #f4efe4 lettering) |
| Cloth colours | #f4efe4 #2c3e70 #b03a2e #e6b422 #3a7d44 #7a4a8c #d35400 #1f6f8b #c2185b #5d4037 | People, laundry, tarps, awnings |
| Skin tones | #8d5a3b #a86b45 #c68a5e #6f4630 #b97c53 | People, five tones at least, never one per area |
| Neon (night only, bazaar and markets) | #ff3fa4 #36e0ff #7dff5a #ffd23f #ff5a36 | Small tube signs; never a large lit area |

Banned: pure #000000 or #ffffff anywhere in the world (the darkest is Black #1c1c1e, the lightest White #f2f0ea); neon colours in daylight; a cold blue-grey wash over the whole frame (this is the "generic Western city" Anmol rejected); orange over a blue sky top in golden light (it turns the sky pink: keep the golden sky top grey-warm); saturated primary colours on large surfaces; any real brand colour scheme on a sign (invented names only).

Grade: Filmic tonemap (not AgX: it made the warm stand-ins grey and flat; not ACES: it crushes shaded asphalt to black), contrast 1.08, saturation 1.05, albedo saturation 1.15, and a 33 cubed 3D LUT per light with split toning (shadow tint toward blue, highlight tint toward orange) and grade saturation 1.12 to 1.2. The grade may shift a colour by at most one palette step: a Plaster cream wall must still read cream at noon and warm gold at golden hour, never green or magenta.

## Lighting presets

Four lights on one day curve, game args `--light=dawn|afternoon|golden|night` or `--time=<0..24>` (`game/render/day_cycle.gd`: keys night 0 to 4.6 h, dawn 6.3, afternoon 15.0, golden 17.75, dusk 19.0, night from 20.5, smooth blend between them; a preset and its hour look the same). The numbers live in `game/render/styles/light_<id>.tres` (fields in `game/render/light_preset.gd`) and the look settings in `game/render/styles/stylised_b.tres`. In Godot terms each preset sets a DirectionalLight3D (sun by day, a faint cool moon at night, swapped at dusk and before dawn where it is nearly off), a ProceduralSkyMaterial, ambient from the sky, exponential depth fog with sun scatter, tonemap exposure, and the LUT. The heavy GI methods are not used (no SDFGI: it turned the bazaar lane black by day).

| | Dawn (6.3 h) | Afternoon (15.0 h) | Golden (17.75 h) | Night (22 h) |
|---|---|---|---|---|
| Mood | Pink and peach light through thick morning haze, damp street | Hot, hazy, dusty, bright | Orange glow, long shadows, lamps start to bloom | Dark blue sky, warm city glow, sodium pools, neon |
| Sun | (1, 0.72, 0.55), energy 1.9, 7 degrees up from ESE (azimuth 108) | (1, 0.94, 0.85), energy 2.3, 52 degrees up from SW (235) | (1, 0.66, 0.36), energy 2.6, 12 degrees up from WNW (285) | Moon (0.62, 0.72, 1.0), energy 0.22, 48 degrees (140) |
| Sky top / horizon | (0.42, 0.50, 0.64) / (0.96, 0.74, 0.60) | (0.40, 0.56, 0.75) / (0.86, 0.79, 0.66) | (0.50, 0.55, 0.62) / (0.98, 0.70, 0.40) | (0.035, 0.05, 0.10) / (0.26, 0.20, 0.20) |
| Ambient energy, exposure | 0.45, 1.15 | 0.5, 0.85 | 0.4, 1.0 | 0.32 (plus moonlit fill), 1.45 |
| Fog density, colour | 0.0042, (0.88, 0.72, 0.64) | 0.0026, (0.86, 0.77, 0.62) | 0.0032, (0.96, 0.68, 0.40) | 0.0034, (0.22, 0.18, 0.18) |
| Lamp gain, night factor | 2.5, 0.25 (lamps still on) | 1.2, 0 | 3.0, 0 | 6.0, 1.0 |
| Lit windows, heat shimmer | 12%, none | none, 1.0 (hot asphalt) | 8%, none | 55%, none |
| Wet, dust (reference only) | 0.55, 0.2 | 0, 0.7 | 0.08, 0.55 | 0.4, 0.3 |

What each preset turns on or off (stylised_b lean path, `_lean()` in `stylised_b.gd`, P0-037):
- All lights: no volumetric fog (a depth haze box over the bazaar instead, `haze_b.gdshader`), SSAO and SSIL at low quality, sun shadows plain filtered with a wide blur (no PCSS, no split blending), glow softlight with threshold 1.0, 4 shadow splits to 240 m (160 m at night).
- Dawn adds contrast (plus 0.08) and thinner haze (minus 15%). Afternoon runs the heat shimmer over hot asphalt (a full-screen pass, 1 to 2 ms: the only light that pays for it). Golden has no shimmer and the strongest bloom on lamps and bulbs.
- Night turns on sodium street lamps (inverse square, tilted 15 degrees over the carriageway, about 170 energy from 9 m), one open shop in three with a real light, headlights, lit windows and neon, and a cool moonlit ambient fill so no surface goes black. These are created only when night is 0.2 or more.
- Time of day for play: `--time` curve, default opening light afternoon (Anmol's "Afternoon heat" and "Golden hour" are both main lights; the game's clock decides, missions may pin an hour).

### Readability floor

The player, the ground around them and the next goal are clearly visible in every shot, including night. Measured on the approved sets (display luma 0 to 1 on a 480x270 downscale, 9 views per light): mean luma 0.25 to 0.73 by day and 0.17 to 0.35 at night; near-black (luma under 0.04) 0% by day and 0 to 11% at night; blown (luma over 0.97) under 8% everywhere except dawn `landmark_tiers` (21%, bright haze sky).

Floor for every game and look shot:
- Mean luma at least 0.15 (night) and 0.22 (day and dusk).
- Near-black pixels (luma under 0.04) at most 15% of the frame; the road, the player and any person in the middle of the frame are never inside them.
- Blown-out pixels (luma over 0.97) at most 10% of the frame, sky and sun disc excluded; no large blown glow (rubric 12).
- Only small emissives may glow: lamp heads, shop bulbs, signal lamps, neon tubes, headlights, tail lights. Glow gain is capped by `lamp_gain` (6.0 at night).
- At night every street still shows lane markings and the car body at the play camera; a distinct lamp pool is the aim (see known gaps).
- On foot in the bazaar at golden or night, people at 1.7 m eye height keep a clear silhouette against the wall behind (rim light 0.25 on satin parts).

## Materials and shading

- Shading model: PBR-lite stylised. Godot StandardMaterial3D for people, cars, glass and metal (roughness 0.55 satin, 0.92 matte, 0.97 road, metal 0 to 0.4) and one shared spatial shader for walls, roads, footpaths and leaves (`game/render/shaders/surface_b.gdshader`) with six tiling layers (plaster, brick, concrete, asphalt, paver, shutter), world-space detail and the wear (grime) mask. No outlines, no toon ramp, no cel shading, no hand-painted brush texture.
- Texture density: tiling layers are 512 px tiles generated offline (`game/render/tools/make_textures.gd`, committed PNGs), each repeating every few metres, with a second finer scale blended in near the camera, which gives roughly 100 to 250 texels per metre at the play camera (the AI cards should match that density, 2048 px per 4 to 8 m); the trim sheet (`trim.png`, four rows: band, sill, paint, drum) carries cornices, sills, painted bands and oil drums. Normal maps are not used in stylised_b (they belong to the realistic reference); surface depth comes from baked AO in the trim, SSAO and SSIL. These PNGs are stand-ins: the AI texture cards replace them slot for slot (kit textures below).
- Texture imports: `fix_alpha_border` is OFF for the six tiling mask layers (it smeared dark lines into blocky bands); ON only for real transparency (grille).
- Grime is data, not a second look: a `wear` value per block (area profile) scales the wear mask, wear_scale 1.15 in stylised_b. Stand-in values: Old Delhi bazaar 0.9, Lutyens 0.03, every other block 0. Wear shows as damp wall bases, soot above shutters, rain streaks, patched plaster, faded paint, dust on roofs, oil and wet patches on the street, and (at wear 0.5 or more) wall decals (posters, stains, soot) that fade out by 55 m. Grime never goes on people, vehicles' windscreens, road markings or signs' readable text.
- Per-area haze: a depth haze box over a block, density times the block's wear, so Old Delhi is thick and Lutyens clear; clear for the first 6 m so near people stay crisp.
- Everything that moves in colour (lamps, neon, shop boards) uses the `glow` and `neon` materials; vertex colour from the stand-ins is converted from sRGB to linear in custom shaders.
- Procedural vs file: stand-ins and dressing are procedural GDScript; kit textures, grime decals, hero and signature landmark facades, vehicles and characters become files through the dashboard cards. The game uses a procedural placeholder for anything missing, so nothing waits for art.

## Scale and camera

- 1 unit is 1 metre, east +X, north -Z, up +Y, no mirroring (TECH.md). Real proportions: person 1.70 m, auto-rickshaw 2.6 m long, bus 12 m, lane 3.0 to 3.5 m, footpath 1.5 to 2.5 m, storey 3.0 m, bazaar lane 4 to 6 m wide between shop fronts.
- Vehicle camera: close chase 4.5 m behind and 2.05 m up (the auto's default), wide chase 6.6 m and 2.5 m, FOV 70 degrees plus up to 21 at speed, never under 0.5 m above the vehicle (GAME.md "Movement and camera feel"). No fisheye look: FOV above 91 degrees is a fail.
- On foot: 3.0 m behind the head pivot at 1.65 m, shoulder offset 0.45 m right, FOV 65 (55 aiming, plus 5 sprinting); walls between camera and player fade; never closer than 0.6 m to the head; near plane 0.1 m, so no wall or prop clips into the frame.
- Look-proof views are fixed at 1920x1080; the render scale target is about 1080p upscaled (MetalFX or FSR) to the display.

## Shapes

- Silhouettes are chunky and honest: real building massing (shop houses 3 to 5 storeys with 3 to 8 m frontage, flats 4 to 6 storeys, havelis with jharokha balconies), no rounded cartoon softening, no thin sticks. Bevels only where the real thing has them (cornices, chhajjas, kerb edges).
- Small-detail rule (the heart of "attention to detail for Delhi"): the space within 15 m of the player always carries a mix of the Delhi detail kit, and the mix follows the area sheet. The stand-in kit already lays these from recorded anchors (`stylised_b.gd`): window grilles in five colours, AC units, rooftop water tanks (black Sintex), tangled wires and transformers on poles, roll-down shutters, hand-painted Hindi shop boards, laundry and tarps, parked scooters and handcarts, electric boxes, painted and broken kerbs (yellow and black bands), a milestone, barricades, street dogs, marigold garlands and bunting in the bazaar. Every area adds its own signature pieces from its reference board; a generic Delhi (the same detail everywhere) is a fail.
- Detail budget: small dressing (wires, frames, grilles, neon) goes on a no-shadow mesh; blocks merge per material; each object under 0.5 m is a decal, a trim row or part of a merged mesh, never its own node.

## Landmark tiers and area kits

Tiers (DELHI_WORLD.md section 1) and what each must look like in this style. All hero and signature models are made as parts kits plus AI texture cards, cleaned up by scripts; the ingest limits are set by the architecture sign-off.

| Tier | Look rule | Check |
|---|---|---|
| Hero (India Gate, Red Fort, CP circle and colonnade) | Recognised from the road at driving speed from at least 200 m: correct silhouette, proportions and main carving, simplified stone detail, honest age (Red Fort walls stained and soot-darkened at the base; India Gate kept clean because it is kept clean in reality). 30 to 80 k triangles with LODs and a far silhouette. Lit by the same four lights, with a warm uplight at night | `landmark_tiers` view: the landmark is identifiable at 1x without its label; silhouette matches its reference photo set |
| Signature (Jantar Mantar, Khan Market, Jama Masjid, Humayun's Tomb) | Right silhouette and colour from the parts kit (domes, chhatris, arches, colonnades, minarets) and one facade texture; wear from the area profile | Colour and silhouette within the reference photo set; no two signature landmarks share a facade texture |
| Marker (a tomb, a station, a temple, a mall) | Right footprint, height and massing, roof type, area-kit material; procedural only | Footprint and height match the registry; reads as the area's own material |

Area kits (each is a sheet plus a reference board of 20 to 40 real photos, decisions.md "Every area is built from real references"; the verifier of every area task compares game shots with the board and fails a generic look):
- Old Delhi bazaar (Chandni Chowk, Sadar, Khari Baoli, GB Road shop fronts): wear 0.9 to 1.0, 3 to 6 m shop frontages stacked 3 to 4 storeys, shutters, cantilever and jharokha balconies, tangled wires, hand-painted boards in Devanagari, Urdu and Latin, awnings and tarps in cloth colours, bunting, thick haze and dust, the strongest night neon. Grime is the visible craft, never mockery (respect rule).
- Lutyens bungalow road: wear 0.03, low white-plaster and buff-stone bungalows behind walls, wide clean roads, big neem and jamun trees that dapple the light, no wires, almost no clutter. The contrast with Old Delhi is the point.
- Connaught Place and the colonial core: cream colonnade with the white-painted arches, wear about 0.1, regular black-and-white signage in the right scripts, polished road markings, lamp posts of the right type.
- Institutional (ITO, Delhi Secretariat, ministries): concrete and glass, flat roofs, wide intersections, barricade and police-booth detail.
- DDA flats and builder floors, urban villages, unauthorised colonies, the Yamuna basti, Gurgaon glass towers, the airport: each its own sheet before it is built; lower-income areas get the same craft as rich ones (wealth shows in upkeep and material, never in mocking people or dirt for its own sake).

## Infrastructure: tunnels, underpasses, flyovers, bridges, metro and rail (Anmol 2026-11-13)

Anmol: "everything should feel good ... everything should be consistent and should look banger. Again, take references from how tunnels look in Delhi. There can be multiple varieties ... which area is which kind ... goes for bridges, flyover, underpasses ... train structure, train track structure, all that."

- **No "basic" structure is finished.** Every structure the player sees (car tunnels and underpasses, pedestrian subways, flyovers and their ramps, road bridges, Yamuna bridges, the metro viaducts and stations, foot over bridges, railway tracks, rail bridges and level crossings) is built from a kit made from real Delhi references and finished to the same stylised B standard as the buildings: same palette, materials, grime, light and level of detail. A plain box, a flat grey wall or a bare beam is a placeholder and fails its task.
- **Varieties by era and area, from references.** Each kind has its Delhi variants, chosen by where the structure is: for example the new Pragati Maidan tunnel (tiled walls, murals, bright lighting) against the older Ring Road and ITO underpasses (painted concrete, sodium light); new precast box girder flyovers on single piers against older T beam flyovers on twin piers; DMRC viaducts (U girders on single piers with the station box) against the Barapullah elevated road; Loha Pul's steel truss, the ITO and Nizamuddin road bridges, the Signature Bridge's cable stays; Indian Railways ballast track with concrete sleepers, overhead line masts and the New Delhi station yard. The reference sheet (`harness/design/reference/infrastructure/`) lists each variant with photos, where it is used and its key shapes and colours.
- **Reference folder (P2-033, 2026-11-13).** `harness/design/reference/infrastructure/` holds one file per kind (`tunnels.md`, `underpasses_subways.md`, `flyovers.md`, `bridges.md`, `metro.md`, `rail.md`, `foot_over_bridges.md`), `variant_map.md` and `variant_map.json` (every pilot tunnel, underpass, flyover, bridge, viaduct, rail stretch, station and foot bridge mapped to its variant id) and 15 licensed photos in `img/` (credits in `img/CREDITS.json`). Start at its `README.md`. Each structure task picks its variant from the map and its dimensions, colours and wear from the kind file; facts are tagged source, photo or estimate.
- **Consistency check.** Every structure task's acceptance includes a side by side of a reference photo and the game view, and a wide shot where the structure sits in the city next to buildings and roads, so nothing looks like it comes from another game.

## Cinematography and cutscenes (Anmol 2026-11-14)

Anmol: "we have to have amazing cinematography and cutscenes ... understand camera angles and aesthetic ambience ... they can make or break the story."

- **A shot grammar, not a free camera.** Every scene is written as shots with a purpose: establishing wide (the city and the light first), medium two-shots for talk, over-the-shoulder shot and reverse with the 180 degree line kept, close-ups for decisions and reveals, inserts (hands, a phone, a note, a gun), and the filmi push-in and slow motion for set pieces. Lenses are chosen per shot (wide 18 to 24 mm for place, 35 to 50 mm for people, 85 mm plus for faces), with depth of field to lead the eye.
- **Moves with weight.** Dolly, crane, slow orbit, handheld only where the moment is chaotic (chases, fights), locked off where it is calm. Eased starts and stops, no robotic linear moves, no camera inside geometry.
- **Light and ambience per scene.** Each scene picks its time of day, haze, practical lights (a tube light in a dhaba, a sodium lamp, a phone screen on a face), rim light to separate faces, and a grade nudge within the signed palette. Sound and music cues are part of the shot list: room tone, the city bed, a horn or a train at the cut.
- **Editing.** Cuts on action and on looks, held beats before a reveal, J and L cuts for dialogue, letterbox 2.39:1 for directed scenes, a clean way back to gameplay (the camera lands on the play camera, no pop).
- **References.** Delhi crime and city cinema for framing and mood (wide hazy city establishing shots, crowded frames, close faces), and game cutscenes from GTA V, Max Payne 3 and Watch Dogs 2 for pacing in a playable world. Every directed scene has a written shot list before it is built.

## Characters

- Proportions: real adult human, 7.5 heads, no big heads or hands, no cartoon eyes; a simplified skin and cloth finish (smooth shading, clear folds only at elbows, knees and the shoulder cloth), clean readable clothing colours from the cloth palette. At the on-foot camera (3 m, 1080p) a person is about 330 px tall: face shapes, hands, clothing layers and a held weapon must read.
- The three leads keep one fixed look each (GAME.md and STORY.md): Bittu the auto driver (khaki uniform shirt with rolled sleeves, dark trousers, sandals, a gamchha over the shoulder, tired but alert, tint Auto green #46d67c on small accents only), SI Meera Rana the cop (khaki uniform, a plain belt and a service pistol, a braid or bun, direct stare, tint Police blue #5aaeff), Danny the fixer (flashy maroon jacket over a patterned shirt, gold chain, sunglasses pushed up, tint Rani pink #ff4f9a). Concept: `harness/design/reference/mood_three_characters.jpg`. No logo or real brand on any clothing.
- Crowds (people at on-foot distance): at least 6 clothing colours and 3 body builds in any bazaar frame, mixed ages, genders and activities (vendors, shoppers, a boy with a tiffin, an auntie with bags, porters, a cop on the corner); nobody is defined by one costume or job; children appear and are never damageable (they flee). Every person casts a clear silhouette against the wall behind (rim light 0.25).
- Animation style: snappy and weighty, filmi. Fast anticipation, a clear hit pause, nothing floaty. Free CC0 animation library (Quaternius) first, retargeted.

## Vehicles

- Real Delhi traffic mix: yellow-green CNG autos, white and grey hatchbacks (the CAR_PAINT palette: mostly white, silver, grey, one black, a dark red, a dark blue), green DTC buses, black-and-yellow taxis, scooters and motorbikes with two or three riders, e-rickshaws, handcarts, cycle rickshaws, trucks. Paint is clean, dents and dust are small and only on older vehicles. Windscreens and lamps stay clear of grime.
- Detail floor on the player's vehicle (close chase, 4.5 m): body with panel lines, wheels with tyres, mirrors, lamps, plate (invented format), an interior hint through the windscreen, shadow contact. The stand-in boxes are placeholders for these.
- Night: headlights and tail lights are real lights on player and nearby traffic only; far traffic uses emissive lamp quads.

## Weapons, combat and effects (over-the-top action, never cruel)

- Over-the-top filmi action: bold muzzle flash (a 2 frame warm star flash with a small light, 0.08 s), bright tracers on the player's shots only, sparks and dust puffs at impacts, brick chips and plaster dust from walls, slow-motion and a camera push on set pieces. Smoke is soft, warm and short-lived (under 3 s), dust kicks come from the dust colour of the ground.
- Allowed: small blood hits, stagger and fall. Not allowed: gore, dismemberment, torture, violence against children or at places of worship, sexual violence (GAME.md respect rule).
- Impact effects are small and local: each effect covers under 5% of the frame, adds under 0.5 ms and casts no shadow. A muzzle flash or explosion is allowed to bloom briefly; it must not hold a blown-out area above 10% of the frame for more than 0.3 s.
- Vehicle effects: tyre smoke and skid marks on braking, dust off the road edge, sparks on scrapes, heat shimmer behind the exhaust only at golden and afternoon.
- Air: dust motes (CPU particles, up to 500 times the block's wear) in sun shafts, drifting smoke from tea stalls and street food, steam from vents. No rain in P0 (rain is a later weather option and needs its own sheet).

## UI

Source of truth: `harness/design/HUD.md`. Short form for the look:
- Fonts: Teko (titles, numbers, labels) and Mukta (objective text, prompts, subtitles), both SIL OFL, Latin and Devanagari, shipped as .ttf. The Godot default font has no Devanagari. In-world signs use an OFL Devanagari face too (known gap: they use a system font now).
- Colours: text warm white #f6efe4, glass #110d0a at 56% with blur, hairline warm white 16%, objective marigold #ffb224, danger #ff3b36, police #4f8dff, lead tints #46d67c, #5aaeff, #ff4f9a, fare meter LED #ff7a45. Warm dark glass, thin hairlines, rounded 10 px panels; no sci-fi frames, glitch or chrome.
- The HUD never covers the player; driving HUD under 9% of the frame; margins 64 px sides and 56 px top and bottom at 1080p; body text 19 to 23 px, never under 15 px; text contrast 4.5:1 or better on its panel.
- World markers (objective diamond, route ribbon, prompts) live in the world, one meaning per shape and colour.
- Respect: invented parties, brands and police units only; the lal batti, the fare meter and the Devanagari place names are the Delhi touches.

## Performance budget of the look

Signed in `harness/verify/perf_budgets.json` (status signed, 2026-11-11). Target machine: Apple M2 Pro (the minimum), 60 fps steady at play speed, about 1080p render scale 1.0 upscaled. Graphics get about 10 to 11 ms GPU p95 so 5 to 6 ms of the 16.6 ms frame stay for gameplay, AI, physics and streaming.
- Frame time p95 (larger of CPU and GPU), look scenes: warn 10.0 ms, fail 12.0 ms; average fps floor 55.
- Draw calls: warn 600, fail 1000. Triangles with shadow passes: warn 6 M, fail 9 M. GPU memory: warn 1200 MB, fail 2000 MB. Load to ready: warn 3 s, fail 10 s (stand-in scenes; streamed city numbers come with the architecture record).
- Measured stylised_b on the stand-ins (P0-037, Vulkan, calm machine): worst view GPU p95 8.68 ms dawn, 9.29 afternoon, 7.75 golden, 9.18 night; typical 6.6 to 8.0; 96 to 315 draw calls; 0.77 to 3.2 M triangles; load 1.06 to 1.33 s. That is 1 to 2.5 ms under the warn line before textures, crowds, traffic and streaming exist, so every new look feature is costed against it: a feature that adds more than 0.5 ms must say so in its task and is measured with `--style-off=<token>`.
- Features and their cost (Vulkan, M2 Pro): sun PCSS 1.8 ms and shadow split blending 1 ms (both off); SSIL about 1.5 ms (kept at low quality); heat shimmer 1 to 2 ms (afternoon only); 40 small omni lights in a narrow lane about 2 ms (one shop in three has a light); per-area volumetric fog 0.3 to 1.3 ms (replaced by the haze box); decals about 0.5 ms; glow and SSAO under the 0.5 ms run-to-run noise.
- Measure on a calm machine: another GPU user (a browser, a game) adds 3 to 5 ms at night. A fail is rerun once; the first view after a shader change is not judged (pipelines compile).
- Quality presets (later): Mobile or low preset drops SSAO and SSIL, keeps haze, glow, LUT and shadows, and cuts lights and dressing. Not built yet.

## Approved reference shots

`node harness/bin/lookproof.mjs --approve style_stylised_b_golden` ran 2026-11-11 after the P0-037 fix pass: `harness/look_proof/approved/` holds the nine views of the stylised_b golden set (car_closeup, street_eye, junction, flyover_ramp, hud_play, busiest_40m, landmark_tiers, area_blocks_30m, on_foot_bazaar, 1920x1080), recorded in `harness/look_proof/approved.json`. The lookproof tool approves one set, so the other three lights are kept as named comparison sets (committed, not copies): `style_stylised_b_dawn`, `style_stylised_b_afternoon`, `style_stylised_b_night`. A look task compares with the one that matches its light: `lookproof.mjs --set x --query "style=stylised_b&light=night"` then `--compare x --against style_stylised_b_night`. Golden is the default `--compare x` reference.
- Tolerances (`harness/verify/look_rules.json`): mean channel difference at most 1.5 (0 to 255), at most 1% of pixels moved more than 40. Measured run-to-run noise of the same build: golden and night worst view mean 0.03 and 0.0% of pixels, afternoon (heat shimmer) mean 0.65 and 0.2%. The limits sit about 2x above the worst noise, so a real look change shows up and must be re-approved.
- A look task that changes the look on purpose says so in its acceptance, and the orchestrator re-approves the set the owner accepted. Approving never happens silently.
- Anything drawn on top of the world (HUD, markers) changes `hud_play` only; compare it with the HUD views, not the pure look views.

## What happens to the style switches

Decision (decisions.md "Style bible and signed budgets"): `stylised_b` becomes the default look of the game in the first task of the first phase after P0 (`GameArgs` loads the style runner with `stylised_b` and `--time` from the day clock when no `--style` is given; the look-proof sets must stay byte for byte after the switch, checked by `--compare`). The older switches stay behind the flag as reference sets until the phase gate: `--style=stylised`, `stylised_grime` and `realistic`, because the sheets and measured numbers in STYLE_OPTIONS.md came from them. `--style=none` (the stand-in flat look) stays as the debug and fast-verify look. After the first phase `stylised` and `stylised_grime` are deleted (their scripts, .tres files and sets in `harness/look_proof/`), since `stylised_b` inherits their code only through the file chain: removing them means folding `stylised.gd` and `stylised_grime.gd` into `stylised_b.gd`. `realistic` stays as a documented reference look (not tuned, not maintained beyond keeping it loading) until the architecture sign-off on upscaling is done, then it is removed too if nothing refers to it.

## AI image prompts

Tool: any image model the owner has (the cards say "paste into your image tool"; Anmol runs them, the game uses placeholders until files arrive). The art-director writes dashboard cards from this section with no manual work for Anmol beyond running them. Rules for every prompt: invented names only (no real brand, party, politician or official), no text unless the card asks for it (and then the exact invented text, in the right script), the respect rule applies to every card, and the art-reviewer rejects a generic or stereotyped image.

### Style anchors

Every prompt of a kind starts with its anchor, then the specific subject.

- Texture, kit tile or trim: "stylised realistic game art, real proportions, clean simplified shapes, rich warm colour, soft hazy sunlight, hand-tuned colour, no outlines, no text unless asked"
- Texture with wear (Old Delhi kits): the texture anchor plus "lived-in surfaces: soot, water stains, faded paint, patched plaster, dust; honest, not exaggerated"
- Decal (posters, stains, soot, patches): the texture anchor plus "single weathered detail on a transparent background, torn edges, wordless or invented Hindi text"
- Icon (item, shop, map): "flat stylised game icon, bold readable silhouette, warm dark glass background, single marigold accent, no text"
- Portrait: "stylised realistic character portrait, real human proportions, warm cinematic light, dignified, slightly tired but alert, simplified skin and cloth finish, no logos"
- Character turnaround: "stylised realistic game character, real human proportions, simplified skin and cloth, full body front and back turnaround, A-pose, plain grey background"
- Key art or backdrop: "cinematic stylised realistic Delhi street scene, warm hazy light, rich colour, real architecture and clutter, readable layers, no text unless asked"
- Vehicle (concept or model): "stylised realistic game vehicle, real proportions, clean panel lines, honest wear, three quarter view, plain grey background"
- Landmark model concept: "stylised realistic game landmark, correct silhouette and proportions, simplified stone carving, warm sandstone, three quarter view, plain background"
- UI element: "dark warm glass panel, thin warm white hairline, subtle blur, rounded corners, no sci-fi frame, no chrome"

### Technical tails

Append to every prompt of the kind.

- Texture, kit tile: "seamless tileable, 2048 x 2048, flat front view, even lighting, no baked shadows, no perspective, no text"
- Trim sheet: "four horizontal bands (cornice, sill, painted band, oil drum metal), seamless horizontally, 1024 x 1024, even lighting"
- Decal: "transparent background, 1024 x 1024, centred, no ground, no shadow"
- Icon: "256 x 256, transparent background, centred, no text, no letters, no logos"
- Portrait: "square 1024 x 1024, shoulders up, plain dark warm background, no text, no letters, no logos"
- Character turnaround: "A-pose, 2048 x 1024, plain grey background, even lighting, no text, no logos"
- Key art: "16 by 9, 2560 x 1440, no UI, no text unless asked"
- Backdrop: "16 by 9, 2560 x 1440, no characters unless asked, no UI, no text"
- Vehicle: "three quarter view, 2048 x 1024, plain grey background, no plate text, no brand badges"
- Landmark model concept: "four views in one image (front, side, back, three quarter), plain background, 2048 x 2048, no text"
- UI element: "transparent background, power-of-two size, no text, no letters, no logos"
- Always: "no text, no letters, no logos" unless the card gives the exact words and script.

Examples that fit the signed look:
- Texture (Old Delhi shop house ground floor wall): "stylised realistic game art, real proportions, clean simplified shapes, rich warm colour, soft hazy sunlight, hand-tuned colour, no outlines, lived-in surfaces: soot, water stains, faded paint, patched plaster, dust; honest, not exaggerated. An Old Delhi shop house ground floor wall, lime plaster over Lakhori brick, faded mint green paint, soot above the shutter line, water stains from a balcony drip, two torn paper posters in invented Hindi text. Seamless tileable, 2048 x 2048, flat front view, even lighting, no baked shadows, no perspective, no real brands."
- Character: "stylised realistic game character, real human proportions, simplified skin and cloth, full body front and back turnaround, A-pose, plain grey background. A Delhi auto-rickshaw driver in his late twenties, khaki uniform shirt with rolled sleeves, dark trousers, sandals, a cloth gamchha on the shoulder, tired but alert face, dignified. A-pose, 2048 x 1024, plain grey background, even lighting, no text, no logos."

### Landmark and kit prompts

- Hero or signature landmark (concept for the model card): the landmark anchor, then the landmark's name, material, era and the 3 features that make it recognisable (India Gate: 42 m sandstone arch on a stepped base, the names carved on its faces, the canopy; Red Fort: red sandstone walls, Lahori Gate, Chhatta Chowk), then the four-views tail. Never a photograph: a stylised concept in the signed look. The model cards add "split into parts: base, main mass, domes, trim" for the parts kit.
- Kit atlas (per area kit, 6 to 12 cards): one card each for walls (2 or 3 colours), a ground floor with shutters, an upper floor with balconies, a roof, a footpath, a road surface, a boundary wall, a signage board blank, and 3 to 5 wear decals. Every card names the area and its evidence photo set: for example "Chandni Chowk bazaar, lime plaster over brick, mint, ochre and dusty pink paints, heavy soot and posters". Colours come from the area profile palette, not invention.
- Grime decals (40 to 80): posters (wordless or invented Hindi), water stains, soot streaks, patched plaster, faded painted advertisements (invented), wall chalk marks, kerb paint. Never an image of a real politician, party symbol or brand; religious symbols only as part of a real place of worship, never as wall decoration labelling an area.
- Signs: Claude composes the board text and layout procedurally; cards are only for hand-painted backgrounds (no letters in the image).

### Audio prompt style

Delhi sound palette, close and warm: auto-rickshaw two-stroke and CNG engine, layered horns (never one horn: three), the high pipe whistle of a traffic cop, temple bells and the call to prayer at distance (respect: a recorded and respectful presence, never a gag), tea-stall clatter, vendors calling in Hindi and Punjabi, a metro announcement, crows and koel at dawn, ceiling fans and generators at night. Reverb: short and tight in lanes, wide with slap-back off the flyovers. Loudness: effects peak at minus 6 dBFS, ambience about minus 24 LUFS, music about minus 18 LUFS, nothing clipping. Loops: ambience loops 30 to 60 s with 2 s crossfades; engine loops are seamless. Music: filmi, brassy and percussive with dhol and tabla, a hint of the old Hindi film score, never pastiche or a joke.

## Known gaps (polish, carried from P0-034 to P0-037, not blockers)

1. Night lamp pools are not yet distinct at street_eye: the sodium lamps light the road but the pools blend into the moonlit fill. Target: a clear bright pool under each lamp that fades over 10 to 15 m.
2. Dark asphalt patches at the night junction (junction view): the oil and wet patches read near black. Lift them or lighten the asphalt layer at night.
3. Shop signboards are still `Label3D` text on boxes, not painted boards. Devanagari uses a system font; replace it with an OFL face (Teko and Mukta ship with the HUD) and hand-painted board textures from the AI cards.
4. The stand-in car, people and trees are simple shapes. They are the placeholders for the vehicle, character and tree cards.
5. Textures are procedural PNGs; the AI kit cards replace them slot for slot.
6. Afternoon heat shimmer costs 1 to 2 ms; keep an eye on it when real content arrives (it is the first thing to cut under load).
7. Night perf drifts 3 to 5 ms when other GPU work runs: budget checks need a calm machine.
8. The hero landmarks, area kits and photo reference boards do not exist yet: each is its own task with its sheet before any building.
