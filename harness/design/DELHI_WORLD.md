# Delhi world layers: landmark registry and area profiles

Design starting point, written 2026-11-10 (planner REPLAN after Anmol's direction change, inbox mmwapw3co; decisions.md "Delhi world layers"). Phase 0 architecture and style discovery refine it, measure it and put it in front of Anmol for sign-off. Nothing here is decided until then. Every number is an estimate unless it names a report file.

## Summary (10 lines)

1. Goal: Delhi looks like Delhi, area by area. Two data layers sit on top of the repaired map (`MAP_REPAIR.md`).
2. The landmark registry (`harness/data/landmarks.json`) lists every notable monument and famous building, with real position, footprint, height, era, orientation, surroundings and references.
3. Landmarks come in three tiers: hero (detailed model, recognised at driving speed), signature (right silhouette and colour), marker (right footprint, massing and material).
4. Area profiles (`harness/data/areas/`) split Delhi into areas from open data and describe each one: building mix, heights, colours, materials, greenery, street life, traffic, sound and wealth as visual detail.
5. A deterministic generator builds ordinary buildings and street dressing from the profile, with smooth blends at area edges. Landmarks always win inside their footprint and surroundings.
6. Both layers are data. Claude tunes them; Anmol reviews and edits them in the map inspector (map coloured by area, click to see and edit).
7. Respect rule: every value comes from data or reference. No caricature. Variety and life, not stereotypes.
8. Pilot first: Connaught Place, ITO, Chandni Chowk, one metro line and 2 or 3 hero landmarks. Measure, then scale.
9. Performance: instancing, LOD and one texture atlas per area kit, inside the signed budgets.
10. Verification: landmark positions against real coordinates by test, pilot shots side by side with reference photos read by eye, and a metric that proves the areas look different.

## How the layers fit

```
sources -> district selection -> map repair (graph, footprints, DTM) -> stitching and connectors -> landmark registry -> area profiles -> generator -> tiles -> game (Godot)
```

- The map repair layer gives the clean road graph, merged building footprints and the bare-earth ground. Nothing below reads raw sources.
- The landmark registry claims its footprint plus its surroundings zone. The repaired buildings inside that zone are replaced by the landmark and its surroundings.
- Area profiles cover everything else. The generator reads the profile at each parcel and builds the ordinary city.
- Order of precedence on any square metre: road corridor, then landmark zone, then generated city. A conflict between a road and a landmark footprint is a map repair issue, not a silent overlap.
- Both layers bake with the map (same deterministic, logged, versioned rules as `MAP_REPAIR.md`). Hand edits live in override files that survive every rebake.

## 0. Composite map (proposal, pending Anmol)

Anmol (inbox mmwarg8cw, 2026-11-10): a compressed Delhi, the way big open world games treat a real city: main areas, monuments, localities, roads, the Yamuna, the airport, parts of NCR and East Delhi, merged into one smaller map. Not a 1:1 copy.

Proposal for the architecture options (Anmol confirms the district list and layout in the interview):
- **Districts at true scale inside.** Each chosen district is clipped from real data (OSM streets, footprints, DTM) and keeps true distances and angles inside it. Landmarks stay where they really are inside their district.
- **Districts moved closer.** Each district gets a placement offset (translation only: no rotation, no scale, no mirroring; north stays -Z). Details in `MAP_REPAIR.md` "District frames and stitching".
- **Authored connectors join them**: ring road arcs, flyovers, the Yamuna with its bridges, the airport road, NH-48 towards Gurugram, the roads into East Delhi and Noida. They use the same lane model and elevation solver as real roads.
- **Filler** between districts comes from area profiles (generated ordinary city, parks, rail corridors), never claimed as a real place.
- **Steps added to the bake**: district selection (`harness/data/districts.json`: clip polygon, frame origin, offset, area profile hints, why it is in the game) before ingest, and stitching with connector authoring (`harness/data/connectors/`) after the per-tile overrides. Connectors are data files Claude authors and Anmol reviews in the map inspector.
- **Seed list from his words** (to turn into 15 to 25 candidates with real size and game role): Connaught Place, India Gate and Rajpath, Chandni Chowk and Red Fort, ITO and Pragati Maidan, a stretch of the Yamuna with bridges, IGI Airport, East Delhi (Laxmi Nagar, Shahdara side), parts of NCR (Gurugram Cyber City, Noida), plus areas the three characters need (a police station or HQ for the cop, auto stands and a resettlement colony for the driver, markets and back lanes for the fixer).
- **Size targets** (estimates, to compare in the layout options): total playable area, number of districts, longest drive across the map at 80 km/h, and bake area in km2. The layout options in the architecture discovery give 2 or 3 choices with a north-up sketch.
- **Tests**: a landmark lands at its district offset plus its projected position within the tier tolerance; relative layout inside a district matches reality; every boundary port is closed; north is up on the map and -Z in the world.

## 1. Landmark registry

### Sources

Licences below are what the planner believes today. Each one is checked in the P0-018 data bench before use, and the result goes into `harness/reports/arch/world_sources.json`.

| Source | What it gives | Licence (to verify) | Use |
|---|---|---|---|
| ASI list of centrally protected monuments (Delhi circle) | Official names, protection status, a rough locality. Around 170 to 180 entries (estimate) | Government list; facts are reusable, check the site terms | Which monuments must exist. Candidate signature or marker floor for every listed monument |
| Wikidata | Coordinates (P625), heritage status, inception (era), height, architect, Commons category, sitelink count | CC0 | Coordinates cross-check, era, fame score from sitelinks |
| Wikipedia | Descriptions, history, typical views | CC BY-SA, text never shipped | Reference notes for art cards, never copied into the game |
| Wikimedia Commons | Photos to study | Per file; most CC BY or CC BY-SA | Reference only, linked by URL with the licence noted. Never baked in or shipped unless that file's licence allows it and it is recorded |
| OSM `historic=*`, `tourism=attraction|museum|viewpoint`, `amenity=place_of_worship`, `building=*` with names, `railway=station` and `station=subway`, `shop=mall`, `leisure=stadium|park|garden`, `barrier=wall|gate` | Footprint polygons, entrances, walls, gardens, parking, metro stations | ODbL 1.0, attribution in game | Footprint and surroundings (preferred geometry source) |
| Named modern list from Anmol's message | India Gate, Red Fort, Qutub Minar, Humayun's Tomb, Lotus Temple, Akshardham, Jama Masjid, Rashtrapati Bhavan, Connaught Place, Lodhi Garden tombs, Hauz Khas, metro stations, major markets, stadiums, malls | n/a | Hero and signature candidates; his interview answers set the final hero list |

### Data file: `harness/data/landmarks.json`

One generated file plus one hand-edited override file (`harness/data/landmarks.overrides.json`), so a rebuild of the registry never loses Anmol's or Claude's edits. The schema below is the starting point; P0-010 confirms it.

```json
{
  "id": "india_gate",
  "name": { "en": "India Gate", "hi": "इंडिया गेट" },
  "ids": { "wikidata": "Q...", "osm": "way/...", "asi": null },
  "lat": 28.6129, "lon": 77.2295,
  "footprint": { "source": "osm", "ref": "way/...", "ring": [[lat, lon], ...] },
  "height_m": 42, "height_source": "wikidata | osm | reference | estimate",
  "era": "1921-1931, British era", "type": "memorial arch",
  "tier": "hero", "tier_reason": "named by owner; ASI-free; visible from Rajpath approaches",
  "orientation_deg": 0, "front": "east, faces Kartavya Path",
  "surroundings": [
    { "kind": "lawn", "source": "osm", "ref": "way/..." },
    { "kind": "canopy", "source": "reference" },
    { "kind": "crowd", "density": "high evenings", "source": "reference" },
    { "kind": "vendors", "density": "medium", "source": "reference" },
    { "kind": "parking", "source": "osm", "ref": "way/..." }
  ],
  "visibility": { "from_road_m": 900, "skyline": true },
  "game": { "nav": true, "mission_spot": true, "photo_spot": { "pos": [lat, lon], "look_deg": 270, "best_time": "evening" } },
  "references": [ { "url": "https://commons.wikimedia.org/...", "what": "front at dusk", "licence": "CC BY-SA 4.0" } ],
  "licence_notes": "Geometry ODbL (OSM). Facts from Wikidata CC0. Photos reference only.",
  "art": { "model": "model_lm_india_gate", "textures": ["tex_lm_india_gate_stone"], "status": "stand-in" },
  "confidence": { "position": "high", "footprint": "high", "height": "medium" },
  "checked": { "by": "P1-xxx", "position_error_m": null }
}
```

(Values in the example are illustrative and not checked. The registry build fills real ones.)

### Tiers

| Tier | What the player sees | Built how | Count (estimate) |
|---|---|---|---|
| hero | Recognised from the road at driving speed and in the skyline. Detailed model, own LOD chain, own surroundings | Model card on the dashboard (AI 3D or hand made from a concept image), procedural stand-in until it arrives | 10 to 20 for the whole city, 2 or 3 in the pilot |
| signature | Right silhouette, colour and main material. A Delhiite names it when driving past | Procedural massing from a parts kit (domes, chhatris, arches, colonnades, minarets, shikharas, slabs) plus a facade texture card | 60 to 150 |
| marker | Correct footprint and massing with the right material. Reads as "an old tomb", "a station", "a mall" | Extruded footprint plus roof type and the material from the matching area kit | hundreds to a few thousand |

Tier rule: an automatic score proposes the tier (ASI listed, Wikidata sitelinks, named by Anmol, footprint size, seen from an arterial road). Anmol's answers and inspector edits override it. Metro stations default to a signature kit per station style (elevated, underground entrance, interchange), with the pilot line's stations as signature.

### Placement rules

- Position: the footprint comes from the OSM polygon when one exists. Its centroid must agree with Wikidata P625 within 50 m, else the entry is flagged for review (not placed silently).
- Orientation: from the footprint's main axis and the entrance node or `front` field. Never guessed from a photo alone.
- Ground: the landmark sits on the bare-earth DTM. A plinth or flat pad is cut and filled under the footprint plus a margin, the same way terrain fits roads.
- The repaired buildings inside the landmark zone are removed (logged). Roads that cross a footprint raise a map repair issue.
- Surroundings come from OSM polygons first (gardens, walls, gates, parking), then from the type's default rules (a tomb in a garden gets a char bagh layout and a boundary wall only if reference shows one).
- The generator keeps a clear ring around every landmark zone and fills it with the landmark's own dressing (crowds, vendors, guards, parked buses), never with ordinary buildings.
- Hero landmarks carry the far LOD that keeps them visible over the city at their `visibility` distance.

### Art cards and stand-ins

- Hero: one model card (kind model, `model_lm_<id>`) with a step by step prompt, the reference photo list and notes on what must read at speed. Texture cards for its main materials. The current ingest limit (25,000 triangles, 3 materials) may be too low for a hero; P0-010 decides a hero limit or a split into parts.
- Signature: one facade or material texture card per landmark where the area kit material is not enough.
- Marker: no card. It uses its area kit material.
- Every card is registered with `node harness/bin/assets.mjs add` after the style sign-off, in batches Anmol can make in one sitting. Before that, only intents.
- Stand-ins are procedural and good enough to judge position, scale and silhouette: a parts kit driven by the registry fields, so India Gate reads as an arch, Qutub Minar as a fluted tower, Humayun's Tomb as a dome on a plinth.

### Game roles of hero landmarks

- Navigation: minimap and map icons, road sign destinations, visible in the skyline.
- Mission spots: start, end or waypoint of missions (exact use follows the game design sign-off).
- Photo spots: a pose point with the best view direction and time of day (the `game.photo_spot` field).

## 2. Area profiles

### Area division from open data

Licences are beliefs until the P0-018 data bench checks them.

| Source | Gives | Licence (to verify) |
|---|---|---|
| Master Plan of Delhi land use maps (MPD 2021, MPD 2041 draft), DDA | Planned land use zones | Government publication, reuse terms unclear; often scanned PDFs that need tracing |
| Census 2011 ward and town data (data.gov.in) | Population, density, households | Government Open Data Licence India (believed) |
| Ward boundaries (MCD wards, NDMC, cantonment) from open repositories | Polygons to hang profiles on | Varies per repository (some ODbL or CC BY) |
| OSM `landuse=*`, `place=suburb|neighbourhood|quarter`, colony names | Land use, colony names and outlines | ODbL |
| Building footprint density (merged footprints from map repair) | Grain: footprint size, coverage, spacing | Google Open Buildings (CC BY 4.0 or ODbL, believed), Microsoft footprints (ODbL) |
| NDVI from Sentinel-2 | Greenery per cell | Copernicus data, free with attribution |
| Night lights (VIIRS) | Activity and wealth proxy at coarse scale | Believed public or CC BY; check |

Method (to confirm in P0-010):
1. Lay a grid of cells (about 100 m, estimate) and give each cell a feature vector: land use, footprint size and coverage, building count, height hints, road density, NDVI, night lights, density from census.
2. Seed areas from named colonies and wards, then merge or split cells by feature similarity, with roads and rail lines preferred as boundaries.
3. Claude assigns each area an archetype and tunes the values from the features and reference photos. Every value carries an evidence line.
4. Anmol reviews in the map inspector and edits. Edits go to the area's override file and to the inbox (source `inspector`).

### Files

- `harness/data/areas/areas.geojson`: one polygon per area with `id`, `name`, `archetype`, `blend_m`.
- `harness/data/areas/archetypes/<archetype>.json`: shared defaults per kind of place (for example `old_city_bazaar`, `lutyens_bungalow`, `colonial_cbd`, `institutional_offices`, `dda_flats`, `builder_floors`, `kothi_colony`, `gated_society`, `urban_village`, `unauthorised_colony`, `market`, `mall_complex`, `industrial`, `campus`, `ridge_and_parks`). The list grows from data, not from a fixed idea of Delhi.
- `harness/data/areas/profiles/<area_id>.json`: the area's own values on top of its archetype. Claude tunes these; the inspector edits them.

### Profile schema (draft)

```json
{
  "id": "chandni_chowk", "archetype": "old_city_bazaar", "name": "Chandni Chowk",
  "buildings": {
    "mix": { "haveli": 0.25, "shop_house": 0.45, "commercial_block": 0.15, "religious": 0.05, "other": 0.10 },
    "floors": { "p10": 2, "p50": 3, "p90": 5 },
    "setback_m": [0, 0.5], "frontage_m": [3, 8], "ground_floor": "shops on every street frontage",
    "colours": ["#c9a27a", "#e6d3b3", "#8a5a44"], "materials": ["lime plaster", "brick", "red sandstone trim"],
    "balconies": "jharokha and cantilever, frequent", "roof": { "water_tanks": 0.7, "dish": 0.4, "solar": 0.05 },
    "wires": "very high", "signage": { "density": "very high", "scripts": ["hi", "en", "ur"] }, "upkeep": "mixed"
  },
  "greenery": { "street_trees": "rare", "species": ["neem", "peepal"], "parks": "few" },
  "street": { "road_condition": "worn", "cleanliness": "mixed", "footpath": "narrow, often occupied" },
  "life": {
    "vendors": "very high", "rickshaws": { "cycle": "high", "e": "high" }, "parked_cars": "low",
    "pedestrians": "very high", "animals": { "dogs": "medium", "cows": "low" }
  },
  "traffic": { "mix": { "two_wheeler": 0.35, "e_rickshaw": 0.25, "cycle_rickshaw": 0.15, "car": 0.10, "auto": 0.10, "goods": 0.05 },
               "density_by_hour": [0.1, 0.05, "...24 values..."] },
  "sound": { "bed": "amb_old_city_day", "horn_rate": "high", "calls": "vendors" },
  "wealth_detail": { "ac_units": "medium", "car_class": "small", "facade_repair": "patched", "glass": "low" },
  "evidence": { "floors": "footprint height tags and Open Buildings, n=...", "life": "reference photo set refs_cc_01..12" },
  "confidence": "medium"
}
```

Fields cover everything in Anmol's message: building types and their mix, heights, colours, materials, balconies, water tanks, wires and signage density, greenery and tree types, road condition and cleanliness, street life (vendors, rickshaws, parked cars, pedestrians, stray animals), traffic mix and density by time of day, noise and ambience, wealth as visual detail.

### The generator (Fable tier)

- Deterministic: the same profile, map and seed give the same city. Seeds come from the tile and parcel ids.
- Parcels: merged footprints from map repair when present; otherwise lots cut along road frontage at the profile's frontage width.
- Per parcel: building type from the mix (fitted to the footprint shape), floors from the height distribution, facade modules from the area kit, roof props, ground floor use (shops on arterial and market frontage).
- Street dressing along road edges from the profile densities: poles and wires, transformers, sign boards, vendors and carts, parked vehicles, trees by species, bins, walls and gates, people and animals spawn weights.
- Smooth edges: inside each area's `blend_m` band (60 to 120 m, estimate) the generator samples from a weighted mix of the two profiles, so a lane of kothis does not stop at a straight line. Roads and rail are preferred seams, where blending can be short.
- Output: instance placements per tile (module id, transform, tint), plus collider boxes from the same geometry.
- Variety: within an area, neighbours must differ (type, floors, colour or module), using the profile's spread, not one repeated block.

### Area kits

- One kit per archetype: modular facade, roof, balcony, shopfront and prop pieces that share one texture atlas (one KTX2 array or atlas per kit, format decided in P0-010).
- Kits are procedural first, then upgraded with texture cards in the signed style.

### Map inspector: area view

Part of the map inspector page from `MAP_REPAIR.md`:
- Map coloured by area (archetype colour, area outline, blend bands shaded).
- Click an area: its profile fields with evidence lines, a 3D preview of a generated block, and edit controls.
- Save writes the area override file (versioned in git) and an inbox entry with source `inspector`.
- Landmark layer: tier icons, click to fly to a landmark, see its registry entry and flagged issues (position disagreement, missing footprint).

## 3. Respect rule

Every community is shown with respect and accuracy, from data and reference, never caricature.
- Every profile value and every landmark field has an evidence line (a data source or a reference photo set). No value is set from a cliche.
- Variety and life, not stereotypes: every area has a spread of building types, colours, ages and people. No single type covers more than about 70% of an area unless the data says so.
- People in every area vary in age, gender, clothing and activity. No group is defined by one costume, job or behaviour.
- Places of worship appear only where they really are (registry or OSM), built with the same care as any landmark. Religious symbols are never used as decoration to label an area.
- Lower income areas, urban villages and unauthorised colonies get the same craft and detail as wealthy ones. Wealth shows in upkeep and materials, not in mocking people or dirt for its own sake.
- No real people, no real party symbols, no real brand logos on signs (invented business names in the right scripts).
- The VERIFY.md rubric gets a respect line after the style sign-off, and the art-reviewer checks it on every image.

## 4. Pilot

Build and prove both layers on the map repair pilot area before scaling up:
- Areas: Connaught Place (colonial CBD with colonnades), ITO (institutional offices and stacked flyovers), Chandni Chowk (old city bazaar). Three contrasting profiles on purpose.
- One metro line: proposal is a Blue Line stretch around Pragati Maidan and Indraprastha (elevated, near ITO). Anmol chooses.
- 2 or 3 hero landmarks. Proposal near the pilot: Red Fort and Jama Masjid (Chandni Chowk end), and either the Connaught Place inner circle or India Gate (about 2 km from CP). Anmol chooses in the interview.
- Exit for the pilot: landmark position tests pass, the side by side reference sheet is read and passes, the area difference metric passes, perf is inside the signed budgets on the pilot camera paths. Then scale area by area in the order Anmol gives.

## 5. Performance approach

Estimates until the P0-016 bench and the pilot measure them.
- Generated buildings and dressing: instanced per kit module (Godot MultiMesh, or merged meshes, whichever the render bench measures better). Draw calls grow with kits in view, not with buildings.
- One texture atlas per area kit, VRAM compressed (Godot import: BPTC or S3TC on desktop, ASTC where the bench says so).
- LOD per small cell: full modules near, merged block shells mid, impostors or a skyline ring far. Hero landmarks keep their own LOD chain and far silhouette.
- Each system has its own budget inside the signed `perf_budgets.json`: generated buildings, street dressing, landmarks, life (people, vendors, animals). Tiles carry placement data with a byte budget.
- Measure the pilot on fixed camera paths at 60 and 100 km/h before any scale-up.

## 6. Verification

- Landmark position (composite map): positions are checked inside the landmark's district frame (district offset plus the projected position). A unit test projects every registry entry with `confidence.position` high and checks the baked position and orientation. Tolerance (estimate): hero 5 m and 5 degrees, signature 10 m, marker 15 m. A scenario teleports to each pilot hero and reads its world position through the hooks; north is -Z and the landmark is on the right side of the map.
- Source agreement: OSM centroid vs Wikidata P625 above 50 m is a flagged issue in the map health report, never silently placed.
- Side by side: lookproof poses matched to reference photos for each pilot area and hero (same view direction, similar focal length). `lookproof.mjs --sheet` builds the sheet; the verifier reads it by eye against a rubric (silhouette, colour, density, street life). Reference photos are linked with their licence and kept out of the shipped build.
- Areas visibly different, by metric: per area, from generated output and from lookproof shots: building height histogram, facade colour histogram (Lab), props per 100 m of road, tree cover, sign density. The distance between each pair of pilot areas must pass a threshold set from the first measurement, and the verifier also reads the shots.
- Variety inside an area: no two adjacent parcels identical; entropy of the type mix above a floor.
- Smooth edges: property change across an area edge spread over the blend band (no step at one line), checked on sample transects.
- Respect: rubric line read by the verifier on pilot shots.

## 7. Phase 0 discovery (where each part is decided)

- P0-005 (interview sitting 1): which landmarks matter most to Anmol, which areas to do first, plus the audit's open questions.
- P0-006 (style options): how a hero, signature and marker landmark and two contrasting area kits look in each candidate style, with AI prompt fit and asset volume per tier.
- P0-009 (stand-in scene): procedural stand-ins for one landmark per tier and two contrasting area kit blocks, so every style test renders them.
- P0-011, P0-012 (style tests): the lookproof views include those stand-ins.
- P0-010 (architecture options): decisions for the landmark registry pipeline and the area profile pipeline, and the inspector area view.
- P0-018 (data bench): source and licence check for landmark and area sources, and a pilot census.
- P0-014, P0-021 (later rounds): confirm the hero list and the area order from the census.
- P0-023 (plan the game): adds the build tasks listed below after the map repair pilot.

## 8. Build tasks after the map repair pilot (P0-023 adds them)

1. Landmark registry build: sources ingest, match and merge, tier scoring, `landmarks.json` and overrides (Fable tier).
2. Landmark placement pipeline: footprint, orientation, plinth fit, landmark zone, surroundings, LOD hook-up (Fable tier).
3. Landmark stand-in parts kit and the pilot heroes as stand-ins; art cards for the pilot heroes (art-director).
4. Area division and area profile data for the pilot areas, with evidence lines.
5. Area profile generator: parcels, buildings, street dressing, edge blending, instancing and atlases (Fable tier).
6. Map inspector area and landmark views.
7. Pilot verification: landmark position tests, reference side by side sheet, area difference metric, perf on the pilot paths.
8. OSM attribution ("© OpenStreetMap contributors") and every other source credit shown in the game.

## 9. Open questions for Anmol

Answered in interview sitting 1 (2026-11-10, inbox source "interview"; details in `CITY_BRIEF.md`):
- First hero landmarks: Connaught Place circle, India Gate, Red Fort (inbox mmwarq9yx). India Gate is about 2 km south of CP, so the pilot area stretches down Kartavya Path or uses a connector (P0-028 decides the layout).
- Districts in the compressed map: central core, Old Delhi, East Delhi across the Yamuna, South with Gurgaon and the airport, plus story places: GB Road, Jantar Mantar (protests), Vasant Kunj, Delhi Gymkhana, the Golf Club, Khan Market, one haunted place (inbox mmwarq9we).
- Release: free and public (inbox mmwarqa1h). Prefer data licences that would still allow a later sale (decisions.md "Speeds and map size").
- Political posters: invented parties only (inbox mmwarqa41).
- Map size: "smaller than gta5 but not too small to feel boring and not vast" (inbox mmwartrys).
- Look: B stylised realistic, with D's grime in Old Delhi (inbox mmwarkusg). Area profiles get a `wear` value (0 to 1) that drives the grime layer; see `STYLE_OPTIONS.md` "Landmark tiers and area kits per candidate".

Proposed tiers for the places he named (to confirm in sitting 2 or P0-014): heroes CP circle, India Gate, Red Fort; heroes later Jama Masjid, Qutub Minar, Humayun's Tomb; signature Jantar Mantar, Khan Market, Delhi Gymkhana, the haunted place, IGI terminal, Yamuna bridges; GB Road, Vasant Kunj and the Golf Club grounds as area profiles with marker buildings. Full table in `CITY_BRIEF.md` "Landmarks".

Composite map questions (P0-028 writes them for sitting 2): must-have districts, how big the map should feel, which NCR parts, where each character lives and works, the Yamuna and East Delhi placement, the pilot districts.

Still open:
1. Which heroes come after the first three?
2. Which areas come first after the pilot?
3. Which metro line for the pilot? (Proposal: the Blue Line stretch near Pragati Maidan and Indraprastha, or the Yellow Line through Chandni Chowk, Rajiv Chowk and Central Secretariat, which links all three hero landmarks' districts.)
4. Which haunted place? (Candidates in `CITY_BRIEF.md`.)
5. Police look: close to the real Delhi Police, or an invented city force?
