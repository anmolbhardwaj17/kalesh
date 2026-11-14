# Delhi world layers: landmark registry and area profiles

Written 2026-11-10 (planner REPLAN after Anmol's direction change, inbox mmwapw3co; decisions.md "Delhi world layers"), refined in architecture discovery (P0-010, P0-020) and signed with the architecture by Anmol on 2026-11-11: "Yes, I sign off on the architecture." (decisions.md "Architecture record (P0-022)"). Section 0 is the signed map, sections 1 and 2 the landmark registry and area profiles, section 10 the signed pipeline with the row ids of [`ARCH_OPTIONS.md`](ARCH_OPTIONS.md) section 8. Every number is an estimate unless it names a report file. The game is called Kalesh.

## Summary (10 lines)

1. Goal: Delhi looks like Delhi, area by area. Two data layers sit on top of the repaired map (`MAP_REPAIR.md`).
2. The landmark registry (`harness/data/landmarks.json`) lists every notable monument and famous building, with real position, footprint, height, era, orientation, surroundings and references.
3. Landmarks come in three tiers: hero (detailed model, recognised at driving speed), signature (right silhouette and colour), marker (right footprint, massing and material).
4. Area profiles (`harness/data/areas/`) split Delhi into areas from open data and describe each one: building mix, heights, colours, materials, greenery, street life, traffic, sound and wealth as visual detail.
5. A deterministic generator builds ordinary buildings and street dressing from the profile, with smooth blends at area edges. Landmarks always win inside their footprint and surroundings.
6. Both layers are data. Claude tunes them; Anmol reviews and edits them in the map inspector (map coloured by area, click to see and edit).
7. Respect rule: every value comes from data or reference. No caricature. Variety and life, not stereotypes.
8. Pilot first: the pilot centre (Connaught Place, India Gate, ITO, Chandni Chowk, Paharganj and everything between), the Blue Line stretch at Pragati Maidan and the three first heroes. Measure, then scale.
9. Performance: instancing, LOD and one texture atlas per area kit, inside the signed budgets.
10. Verification: landmark positions against real coordinates by test, pilot shots side by side with reference photos read by eye, and a metric that proves the areas look different.

## How the layers fit

```
sources -> blocks and focus outlines -> map repair (graph, footprints, DTM) -> lane model, heights, corridors -> landmark registry -> area profiles -> generator -> tiles -> game (Godot)
```

- The map repair layer gives the clean road graph, merged building footprints and the bare-earth ground. Nothing below reads raw sources.
- The landmark registry claims its footprint plus its surroundings zone. The repaired buildings inside that zone are replaced by the landmark and its surroundings.
- Area profiles cover everything else. The generator reads the profile at each parcel and builds the ordinary city.
- Order of precedence on any square metre: road corridor, then landmark zone, then generated city. A conflict between a road and a landmark footprint is a map repair issue, not a silent overlap.
- Both layers bake with the map (same deterministic, logged, versioned rules as `MAP_REPAIR.md`). Hand edits live in override files that survive every rebake.

## 0. Composite map

Signed. Anmol's answers in the map round (interview sitting 2, 2026-11-10; decisions.md "Sitting 2 results"), his change on the stitch shot (2026-11-11, decisions.md "One seamless open city, no gaps") and the architecture sign-off (2026-11-11, decisions.md "Architecture answers, round 2" and "Architecture record (P0-022)"). Mechanics: `MAP_REPAIR.md` "District frames and stitching"; contract: TECH.md "World layout"; data: `harness/data/districts.json`.

Anmol (inbox mmwarg8cw, 2026-11-10): a compressed Delhi, the way big open world games treat a real city: main areas, monuments, localities, roads, the Yamuna, the airport, parts of NCR and East Delhi, merged into one smaller map. Not a 1:1 copy. "smaller than gta5 but not too small to feel boring and not vast". On the stitch shot (2026-11-11): "some seamless connection should be there ... It's not like these should be different region. There should be easily blendable, like an open" world.

**The signed map:**
- **One seamless open city.** No islands, no bare ground. Streets run across every edge as one road network, and area profiles blend across every edge, so no border shows.
- **The centre at true scale.** Central Delhi is one continuous block at factor 1.0 with one frame (origin India Gate) and one road graph: Kashmere Gate to Nizamuddin, Karol Bagh and the Central Ridge to the Yamuna, the river and floodplain as the real place, and the east bank with Laxmi Nagar. Every place in it is at its real position, so every direction and distance there is real.
- **The far south pulled in on its real bearing.** Mehrauli with Qutub, Vasant Kunj, IGI Airport T3 with Aerocity and Gurugram Cyber City are each their own block, placed on their real bearing from India Gate at 0.5 of their real distance (owner answer). Cyber City is 9.5 km from India Gate, about 4.7 minutes by car at 140 km/h and 10 by auto. A far block is true scale inside, so it has to be compact: its outline (`harness/data/districts/<id>.geojson`, 1.7 to 2.9 km2 each, drawn in P1-008) must keep 250 m clear of every other block once placed (rule R-STITCH). Directions are exact from India Gate and up to about 9 degrees off from Connaught Place (20 at worst for one pair).
- **Corridors** join the far blocks to the centre: authored connectors that carry the real road's name (Aurobindo Marg, the Ring Road south arc with Dhaula Kuan as an authored junction, NH-48, MG Road, the airport road), lined with generated city blended from the neighbouring area profiles. Generated city never takes the name of a real colony.
- **Focus districts** are outlines inside a block where hand attention goes: hero roads, hand-drawn area profiles, inspector review. Between them is real city from the same sources, with archetype profiles chosen by rule and reviewed later.
- **Translation only** everywhere: no rotation, no scale, no mirror; north is -Z.
- **Size.** About 68 km2 and about 1,090 tiles of 250 m at the first release (estimates), about 2.6 times the map work of the island plan and the same frame cost (streaming holds a fixed ring of tiles). Map box about 12.7 by 13.5 km.

**Stages (owner, sitting 2, kept as the district list):**
- **Pilot** (Act 1 and the slice): the pilot centre, one continuous piece of the centre block: Connaught Place with Jantar Mantar, India Gate, ITO with Pragati Maidan, Chandni Chowk with Red Fort as focus districts, plus Paharganj with the New Delhi station, GB Road and everything between them. About 20 km2 (estimate).
- **First release:** the rest of the centre block (Kashmere Gate with ISBT, the Lutyens bungalows and Delhi Gymkhana, Khan Market with Lodhi Garden and the Golf Club, Nizamuddin with Humayun's Tomb, the Central Ridge with Malcha Mahal, Karol Bagh, the Yamuna and its bridges, Laxmi Nagar on the east bank), then the far blocks with their corridors.
- **Later unlocks:** Noida (a far block at 0.5), Shahdara and Akshardham (east bank of the centre block). The east bank stays narrow at the first release.
- `harness/data/districts.json` gives every district a `stage` (pilot, release, later), so the bake and the story open them in order.

**Homes and story places (owner, sitting 2):** the driver lives in Laxmi Nagar and works the CP stands, the station and airport runs, so his day crosses the ITO bridge. The cop works from a made-up station in the ITO district and patrols the core, with VIP duty in Lutyens and at India Gate and protests at Jantar Mantar. The fixer works out of Chandni Chowk and Paharganj, has contacts on GB Road, deals in East Delhi, and meets rich clients at Khan Market, Vasant Kunj and Cyber City. The haunted place is Malcha Mahal in the Central Ridge. The police force is invented and Delhi-like.

### 0.1 Places and what each gives the game

Centres are read from public maps to about 200 m (estimates); the bake uses each place's real data. Block and stage as signed. Cost: S (under 2 build tasks), M (2 to 3), L (3 to 5), XL (5 or more), counted after the base layers exist.

| # | Place | Real centre (lat, lon), est | Block, stage | What it gives the game | Build cost, est |
|---|---|---|---|---|---|
| D01 | Connaught Place: inner and outer circle, radials, Palika Bazaar, Rajiv Chowk Metro | 28.6315, 77.2167 | Centre, pilot, focus | Hero: CP circle. Driver's main fare stand at the Metro exits; cop patrol; fixer meetings in the colonnades. Fares, chases round the circles, a shootout in the corridors. Office crowds, vendors, autos queuing | L: OSM very good; radial junctions and the colonnade kit are the work |
| D02 | Jantar Mantar and Sansad Marg | 28.6271, 77.2166 | Centre, pilot, inside the CP focus district | Jantar Mantar observatory (signature); the protest site. Cop crowd control, fixer works a crowd, driver drops a leader. Agrasen ki Baoli is about 800 m east | S: small; needs the crowd system |
| D03 | India Gate and Kartavya Path: C-Hexagon, lawns, canals, Vijay Chowk | 28.6135, 77.2190 | Centre, pilot, focus | Hero: India Gate. Rashtrapati Bhavan and North and South Block as signatures. Evening crowds, ice cream carts, a chase down the long avenue, cop VIP route. The War Memorial is a no-combat zone (respect rule) | M: simple roads and open lawns; the hero model is the work |
| D04 | ITO and Pragati Maidan: stacked flyovers, Vikas Marg, IP Estate, Bharat Mandapam, the tunnel, Delhi Gate, Khooni Darwaza | 28.6290, 77.2430 | Centre, pilot, focus | The cop's station (made up) and the police HQ area. Pursuits on the flyovers, barricades, the tunnel chase | XL: the hardest road geometry in the map; the lane model's proving ground |
| D05 | Lutyens bungalows and Delhi Gymkhana: Safdarjung Road, roundabouts, tree tunnels | 28.6033, 77.2003 | Centre, release, focus | Delhi Gymkhana (signature). Power and money (invented politicians only, no real residences shown). Tail a car, a VIP heist, cop protection duty | M: repeating bungalow kit and roundabouts; many trees |
| D06 | Khan Market, Lodhi Garden and the Delhi Golf Club | 28.5960, 77.2280 | Centre, release, focus | Khan Market and the Lodhi tombs (signatures). Rich clients for the fixer, cafe meets, a chase across the golf course | M |
| D07 | Paharganj and New Delhi Railway Station | 28.6430, 77.2170 | Centre, pilot | NDLS station (signature). Driver's station stand (M01 ends here); fixer's hotel contacts; backpackers, touts, porters | L: dense lanes plus the station |
| D08 | GB Road and Ajmeri Gate (Swami Shraddhanand Marg) | 28.6480, 77.2240 | Centre, pilot | Story and atmosphere only, under the respect rule: no sexual content, no exploitation of real people. Hardware shops at street level; cop rescue missions; fixer contacts | S: reuses the Old Delhi kit |
| D09 | Chandni Chowk, Red Fort and Jama Masjid: Dariba, Kinari Bazaar, Fatehpuri, Netaji Subhash Marg | 28.6530, 77.2350 | Centre, pilot, focus | Hero: Red Fort; Jama Masjid hero later. Signatures: Sis Ganj Gurudwara, Fatehpuri Masjid, Gauri Shankar Mandir, Lal Mandir (no combat inside any place of worship). The fixer's home ground: on foot in the bazaar, rooftop chases, rickshaws, the "Red Fort rush" | XL: densest area, crowds, narrow lanes, the grime layer (wear high) |
| D10 | Kashmere Gate and ISBT | 28.6670, 77.2280 | Centre, release, focus | ISBT and the old gate (signatures). Arrivals into the city, smuggling by bus, fares | M: the bus terminal and its interchange |
| D11 | The Yamuna: river, floodplain, ghats and bridges (ITO bridge, Nizamuddin bridge, Loha Pul; Signature Bridge on the skyline) | river near ITO 28.6300, 77.2550 | Centre, release (the bank at ITO in the pilot) | Bridges as chokepoints for wanted escapes; night scenes at the ghats; the line between the two halves of the city | M: water and floodplain are cheap per km2; each bridge is a real road on the lane model with a deck rule |
| D12 | Laxmi Nagar and Shakarpur: coaching centres, Vikas Marg market, the elevated Blue Line | 28.6310, 77.2770 | Centre (east bank), release, focus | The driver's home. Dense 4 to 6 storey lanes, the fixer's East Delhi deals, a Metro viaduct chase | L: dense city and the Metro viaduct |
| D13 | Shahdara and Seelampur back lanes | 28.6730, 77.2890 | Centre (east bank), later | Old East Delhi wholesale lanes. The fixer's harder deals and rival crews, told under the respect rule (invented gangs, no real community blamed) | M: reuses the Old Delhi and Laxmi Nagar kits |
| D14 | Akshardham and the Games Village edge | 28.6127, 77.2773 | Centre (east bank), later | Akshardham (signature, a place of worship: no combat inside). A chase along NH-9 | M: one complex signature model |
| D15 | Noida Sector 18 and Film City | 28.5700, 77.3230 | Own block at 0.5, later | NCR new money: malls, Atta Market, the Film City studio gate. A filmi mission on a film set | M: modern tower and mall kit (shared with D22) |
| D16 | Nizamuddin and Humayun's Tomb: Dargah and Basti, Sundar Nursery, Nizamuddin station | 28.5920, 77.2470 | Centre, release, focus | Hero later: Humayun's Tomb. Qawwali nights (atmosphere only), train arrivals at Nizamuddin | L: hero model and a dense basti |
| D17 | Central Ridge with Malcha Mahal (the haunted place) | 28.6420, 77.2020 | Centre, release, focus | Night and fog missions, the ghost story side line for all three | S: one ruin; trees cost perf |
| D18 | Dhaula Kuan interchange | 28.5918, 77.1617 | Authored junction on the corridors, release | The gate from the city to the airport and Gurugram; highway chases on a cloverleaf | M as an authored connector junction |
| D19 | Vasant Kunj: Ambience and DLF Promenade malls, upscale sectors | 28.54247, 77.15600 (DLF Promenade, checked P1-008) | Own block at 0.5, release | Rich clients and the Lutyens set at home (Anmol: "vasant kunj for lutens"), a mall shootout, a farmhouse party | M: mall and gated housing kit |
| D20 | Mehrauli and Qutub Minar: the Qutub complex, Archaeological Park ruins, Mehrauli village | 28.52442, 77.18545 (Qutub Minar, checked P1-008) | Own block at 0.5, release | Hero later: Qutub Minar. Ruins at night | L: hero model, ruins, village lanes |
| D21 | IGI Airport T3 (Aerocity is left to the airport road corridor: at true scale inside the block it would land on the Vasant Kunj malls, measured P1-008) | 28.55485, 77.08417 (Terminal 3, checked P1-008) | Own block at 0.5, release | T3 and the control tower (signatures). Airport runs for the driver, a smuggling line for the fixer, a chase on the perimeter road | M: one big signature terminal; the rest is flat fenced ground |
| D22 | Gurugram Cyber City and Cyber Hub, with the NH-48 toll edge | 28.49490, 77.08870 (DLF Cyber Hub, checked P1-008) | Own block at 0.5, release | Glass towers, Rapid Metro, Cyber Hub (signature). Corporate money, a heist in a tower, highway chases on NH-48 | M: tower kit repeats well; glass needs good reflections |

In-between areas of the centre with no focus outline (Karol Bagh, Daryaganj, Delhi Gate, Rajghat, Mandi House, Bengali Market, Barakhamba Road, Minto Road, Ramlila Maidan, Turkman Gate, Purana Qila and the zoo, Windsor Place) are real city from the first bake, on archetype profiles chosen by rule.

### 0.2 Roads that hold the map together

Inside the centre block every big road is the real road from OSM: Ring Road on the west bank, Mahatma Gandhi Marg, Janpath, Barakhamba Road, Minto Road, BSZ Marg, Mathura Road, Lodhi Road, the Barapullah elevated road, Ridge Road, and the bridges over the Yamuna (Vikas Marg at ITO, the Nizamuddin bridge with Pushta Road on the east bank, Loha Pul later). They are built by the lane model and the elevation solver like any street.

Between the centre and the far blocks the roads are authored connectors (`harness/data/connectors/`, format in `MAP_REPAIR.md` "Connector format"), lined with generated city:

| Corridor | Stands for | Joins | Kind |
|---|---|---|---|
| Aurobindo Marg | Aurobindo Marg | the centre (south of Lodhi) to Mehrauli and Qutub | Arterial |
| Ring Road south arc and Dhaula Kuan | Ring Road from the south of the centre to the Dhaula Kuan interchange | the centre to Vasant Kunj and NH-48 | 6 lane arterial; Dhaula Kuan an authored junction |
| NH-48 | NH-48 from Dhaula Kuan | Vasant Kunj to the airport turn and Cyber City, then off the map towards Jaipur | Expressway |
| Airport road | the T3 link | NH-48 to the T3 forecourt ramps and Aerocity | Expressway spur |
| MG Road | Mehrauli-Gurgaon Road, with the elevated Metro beside it | Qutub to Cyber City | Arterial |
| Later: DND Flyway and NH-9 | the DND Flyway and NH-9 | the centre to Noida | Expressway |

### 0.3 How the map was chosen

The P0-028 draft offered three layouts of islands (A compact core, B Delhi shape, C Delhi plus NCR; sketches in `map_sketches/`, made by `map_sketches/make_sketches.mjs`). Anmol picked C as the district list in stages. The stitch bench (P0-029) built the pilot districts as islands and Anmol rejected the islands on the shot. The architecture round then fixed the layout as above: the centre at true scale (no even factor under 1.0 fits the centre once the real in-between areas are in, computed in `ARCH_OPTIONS.md` "Why the centre factor is 1.0") and the far south at 0.5 (his answer; at 0.8 every pair would be within 5 degrees but Gurugram would sit 15 km out). The sketches stay as history; they are not the map.

### 0.4 Pilot inside the map

The pilot centre (about 20 km2, estimate) is the first piece selected, repaired and baked. It holds all three of Anmol's first heroes (CP circle, India Gate, Red Fort), the ITO flyovers, the Chandni Chowk lanes, the New Delhi station for M01 and the Yamuna bank at ITO. It is the same piece in every later stage, so nothing in it moves when the map grows.

## 1. Landmark registry

### Sources

Licences below were checked at the source by the P0-018 data bench on 2026-11-11 (`harness/reports/arch/world_sources.json`). Still a belief, because the script could not read the page: the ASI copyright page.

| Source | What it gives | Licence (to verify) | Use |
|---|---|---|---|
| ASI list of centrally protected monuments (Delhi circle) | Official names, protection status, a rough locality. Around 170 to 180 entries (estimate) | Government list; facts are reusable, check the site terms | Which monuments must exist. Candidate signature or marker floor for every listed monument |
| Wikidata | Coordinates (P625), heritage status, inception (era), height, architect, Commons category, sitelink count | CC0 | Coordinates cross-check, era, fame score from sitelinks |
| Wikipedia | Descriptions, history, typical views | CC BY-SA, text never shipped | Reference notes for art cards, never copied into the game |
| Wikimedia Commons | Photos to study | Per file; most CC BY or CC BY-SA | Reference only, linked by URL with the licence noted. Never baked in or shipped unless that file's licence allows it and it is recorded |
| OSM `historic=*`, `tourism=attraction|museum|viewpoint`, `amenity=place_of_worship`, `building=*` with names, `railway=station` and `station=subway`, `shop=mall`, `leisure=stadium|park|garden`, `barrier=wall|gate` | Footprint polygons, entrances, walls, gardens, parking, metro stations | ODbL 1.0, attribution in game | Footprint and surroundings (preferred geometry source) |
| Named modern list from Anmol's message | India Gate, Red Fort, Qutub Minar, Humayun's Tomb, Lotus Temple, Akshardham, Jama Masjid, Rashtrapati Bhavan, Connaught Place, Lodhi Garden tombs, Hauz Khas, metro stations, major markets, stadiums, malls | n/a | Hero and signature candidates; his interview answers set the final hero list |

### Data files: `harness/data/landmarks/`

Signed storage (LS2, section 10): one file per hero and signature landmark in `harness/data/landmarks/<id>.json`, one generated `harness/data/landmarks_markers.json` for markers, and one hand-edited `harness/data/landmarks.overrides.json`, so a rebuild of the registry never loses Anmol's or Claude's edits. Every entry uses the schema below and also carries a `block` id and, inside a focus district, a `district` id; a landmark outside every block is marked `far` (skyline only).

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

Built in P2-005 (`npm run landmarks`, code `tools/bake/landmarks/`). What the build added to the storage above:
- `harness/data/landmark_list.json` is the owner list: one line per landmark Anmol named, claimed by its Wikidata id and its OSM id, never by its name. Its tier wins over the score; an edit in `landmarks.overrides.json` wins over the list.
- A landmark file is generated. Nobody edits it by hand: a hand fact (a height read from a reference, a checked position, a footprint read from a photo or satellite view in place of the OSM shape) is an edit in `landmarks.overrides.json` with its evidence line, and the build lays it on top.
- Extra fields on every entry: `match` (how OSM and Wikidata were joined), `evidence` (one line naming the source ids), `position` and `height_evidence` (where the number comes from), `agreement` (metres from the OSM centre to the Wikidata point, and whether the point lies inside the footprint), `flags`, `place` (`ok`, `held` until an edit settles a source disagreement, `unplaced` when there is no OSM object), `area` (the area profile id, or the archetype of the 100 m rule cell), `worship` with `combat_arena: false` on every place of worship (section 3), `underground` with `shell: "none"` on underground structures, `station` with its style, and `infrastructure` with the kit variant id of `harness/design/reference/infrastructure/variant_map.json` for a station or an underground feature (joined by OSM id).
- `far` is true for an owner list landmark outside the outline of the baked stage. It carries its real `bearing_deg` and `distance_m` from the block pivot and `block_planned`, the block it will stand in once that block is baked. Other candidates outside the outline wait for their stage.
- The registry writes its issues to `harness/reports/map/landmarks/issues.json` in the issue record format of `MAP_REPAIR.md`: rule `R-LM-01` (the sources disagree by more than 50 m) and `R-LM-02` (joined by name and distance). They are kept apart from the road issues until the inspector has its landmark view (step 4), because a pick there must write `landmarks.overrides.json`, not a road patch.

### Tiers

| Tier | What the player sees | Built how | Count (estimate) |
|---|---|---|---|
| hero | Recognised from the road at driving speed and in the skyline. Detailed model, own LOD chain, own surroundings | Model card on the dashboard (AI 3D or hand made from a concept image), procedural stand-in until it arrives | 10 to 20 for the whole city, 2 or 3 in the pilot |
| signature | Right silhouette, colour and main material. A Delhiite names it when driving past | Procedural massing from a parts kit (domes, chhatris, arches, colonnades, minarets, shikharas, slabs) plus a facade texture card | 60 to 150 |
| marker | Correct footprint and massing with the right material. Reads as "an old tomb", "a station", "a mall" | Extruded footprint plus roof type and the material from the matching area kit | hundreds to a few thousand |

Tier rule: an automatic score proposes the tier (ASI listed, Wikidata sitelinks, named by Anmol, footprint size, seen from an arterial road). Anmol's answers and inspector edits override it. Metro stations default to a signature kit per station style (elevated, underground entrance, interchange), with the pilot line's stations as signature.

### Placement rules

- Position: the footprint comes from the OSM polygon when one exists. The Wikidata P625 point must lie inside the footprint or within 50 m of its centre, else the entry is flagged for review (not placed silently). Measured on the pilot: by centre alone 21 of 69 are over 50 m, because big sites such as Red Fort (76 m) have their point away from the centre.
- Orientation: from the footprint's main axis and the entrance node or `front` field. Never guessed from a photo alone.
- Ground: the landmark sits on the bare-earth DTM. A plinth or flat pad is cut and filled under the footprint plus a margin, the same way terrain fits roads.
- The repaired buildings inside the landmark zone are removed (logged). Roads that cross a footprint raise a map repair issue.
- Surroundings come from OSM polygons first (gardens, walls, gates, parking), then from the type's default rules (a tomb in a garden gets a char bagh layout and a boundary wall only if reference shows one).
- The generator keeps a clear ring around every landmark zone and fills it with the landmark's own dressing (crowds, vendors, guards, parked buses), never with ordinary buildings.
- Hero landmarks carry the far LOD that keeps them visible over the city at their `visibility` distance.

Built in P2-006 (`tools/bake/landmarks/place.ts`, inside the terrain step of the bake). What the build settled:
- Three ways a landmark stands. A **structure** (the footprint is the thing itself: an arch, a gate, a mosque): a flat pad of the footprint plus a margin (hero 4 m, signature 3 m, marker 1.5 m), cut back 2 m from every road face and from water, at the mean ground level of its ring; its zone is the pad plus a clear ring (hero 12 m, signature 6 m, marker 3 m, times the share its area style gives: 0 in the old city, where shops stand wall to wall). A **site** (the footprint is the grounds: a fort, a park, a stadium, a campus over 25,000 m2, the Connaught Place rings by `zone_radius_m`): the zone is the grounds, the buildings inside are the landmark's parts, and it has a pad only where an edit names one (`pad`: the Lahori Gate for the Red Fort). A **point** (no footprint, or underground): a pin only, never a shell, a pad or a ground cut.
- Buildings in a zone leave the plain buildings: `replaced` (a structure's own massing stands there) or `part` (a site keeps it as its own). Every one is a line of `harness/reports/map/landmarks/replaced.json`. Bake invariant LM-01: no plain building is left with its centre in a zone.
- The front: `orientation_deg` in the registry, from the main axis of the footprint (the long side of its smallest rectangle) and a front bearing an edit read from evidence (`front_bearing_deg` with `front`). Without a front bearing the axis alone is known (`front_known: false`). A round footprint has no axis.
- Ground classes: `pad` (flat within 0.05 m, sharing its edge vertices with the ground around it: invariant LM-02), `forecourt` (the zone's plain ground; lawns and water of the map stay), `wallbase` (the footing of a wall line, and of a fort's outline when the map draws no walls inside it), `moat` (a band outside a fort's wall, only where an edit gives `extent.moat_width_m` with its evidence). Landmarks that stand on one plinth share one pad and one level.
- Stand-in massing in the tiles (materials `landmark` and `landmark_red`) fills LOD 0 until the parts kit (P2-007): a structure as a prism to its height (a broad one as a body with a crown), a site's parts as prisms, a fort's wall with its two heights, open where a road passes.
- The landmark file `landmarks.json` in the tile folder: every placed landmark with its LOD slots (a hero: 3 levels to 350, 900 and 1,800 m, then its far silhouette to 6 km), the far landmarks, the far silhouettes (each under 2,000 triangles) and `limits.heroesAtFullDetailInView` (2). The game reads it in `tile_index.gd`; `landmark_slots.gd` picks the level each one shows and keeps the cap.
- Far landmarks stand on the backdrop through the frame of the block they will stand in (`block_planned`, else the nearest block): on their real bearing from the pivot, at the distance that block's factor gives, so they do not jump when the block is baked. One that would lie within 500 m of a reachable tile is moved outward along its bearing. Invariant LM-03.
- Held entries: an underground station cannot be checked on a satellite picture, so it is checked on the map (the tunnel centre line, the stop positions, the gates); stations on the surface, forts and buildings are read on Esri imagery (`tools/inspector/judge.mjs site`, pictures in `harness/reports/map/landmarks/held/`). Each check is an edit with its reason.

### Art cards and stand-ins

- Hero: one model card (kind model, `model_lm_<id>`) with a step by step prompt, the reference photo list and notes on what must read at speed. Texture cards for its main materials. The prop ingest limit (25,000 triangles, 3 materials) is too low for a hero. Signed (HM2, section 10): a hero is up to 8 parts of up to 25,000 triangles each, up to 6 materials in all, 3 LODs per part and one far silhouette under 2,000 triangles.
- Signature: one facade or material texture card per landmark where the area kit material is not enough.
- Marker: no card. It uses its area kit material.
- Every card is registered with `node harness/bin/assets.mjs add` in batches Anmol can make in one sitting (the style is signed).
- Stand-ins are procedural and good enough to judge position, scale and silhouette: a parts kit driven by the registry fields, so India Gate reads as an arch, Qutub Minar as a fluted tower, Humayun's Tomb as a dome on a plinth.

### Game roles of hero landmarks

- Navigation: minimap and map icons, road sign destinations, visible in the skyline.
- Mission spots: start, end or waypoint of missions (GAME.md mission list).
- Photo spots: a pose point with the best view direction and time of day (the `game.photo_spot` field).

## 2. Area profiles

### Area division from open data

Licences were checked at the source by the P0-018 data bench on 2026-11-11 (`harness/reports/arch/world_sources.json`): census data is under the Government Open Data License India, the DataMeet ward boundaries are CC BY 4.0, VIIRS night lights are CC BY 4.0, Google Open Buildings is CC BY 4.0 or ODbL, and the Microsoft footprints are CDLA Permissive 2.0 (this doc said ODbL before). Still beliefs: the Master Plan maps (the DDA site was unreachable) and the Sentinel notice. Measured: OSM land use, colony names and the footprint grid cover the pilot; wards, census, Sentinel-2 and VIIRS were not needed.

| Source | Gives | Licence (to verify) |
|---|---|---|
| Master Plan of Delhi land use maps (MPD 2021, MPD 2041 draft), DDA | Planned land use zones | Government publication, reuse terms unclear; often scanned PDFs that need tracing |
| Census 2011 ward and town data (data.gov.in) | Population, density, households | Government Open Data Licence India (believed) |
| Ward boundaries (MCD wards, NDMC, cantonment) from open repositories | Polygons to hang profiles on | Varies per repository (some ODbL or CC BY) |
| OSM `landuse=*`, `place=suburb|neighbourhood|quarter`, colony names | Land use, colony names and outlines | ODbL |
| Building footprint density (merged footprints from map repair) | Grain: footprint size, coverage, spacing | Google Open Buildings (CC BY 4.0 or ODbL), Microsoft footprints (CDLA Permissive 2.0) |
| NDVI from Sentinel-2 | Greenery per cell | Copernicus data, free with attribution |
| Night lights (VIIRS) | Activity and wealth proxy at coarse scale | Believed public or CC BY; check |

Signed method (AD2, section 10): Claude draws 3 to 8 area polygons per focus district along roads and rail, seeded by OSM land use and colony outlines, and uses the feature grid below as evidence, not as an automatic clustering. In-between areas of the seamless centre get an archetype profile by rule first. The steps below are the way the evidence is made.

Method:
1. Lay a grid of cells (about 100 m, estimate) and give each cell a feature vector: land use, footprint size and coverage, building count, height hints, road density, NDVI, night lights, density from census.
2. Seed areas from named colonies and wards, then merge or split cells by feature similarity, with roads and rail lines preferred as boundaries.
3. Claude assigns each area an archetype and tunes the values from the features and reference photos. Every value carries an evidence line.
4. Anmol reviews in the map inspector and edits. Edits go to the area's override file and to the inbox (source `inspector`).

### Files

- `harness/data/areas/areas.geojson`: one polygon per area with `id`, `name`, `archetype`, `blend_m`.
- `harness/data/areas/archetypes/<archetype>.json`: shared defaults per kind of place (for example `old_city_bazaar`, `lutyens_bungalow`, `colonial_cbd`, `institutional_offices`, `dda_flats`, `builder_floors`, `kothi_colony`, `gated_society`, `urban_village`, `unauthorised_colony`, `market`, `mall_complex`, `industrial`, `campus`, `ridge_and_parks`). The list grows from data, not from a fixed idea of Delhi.
- `harness/data/areas/profiles/<area_id>.json`: the area's own values on top of its archetype. Claude tunes these; the inspector edits them.

### Profile schema

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

Built (P2-009, `tools/bake/areas/`, docs/ARCHITECTURE.md "Area generator"): parcels (footprints, blueprints, the odd-footprint check, lots on free frontage), buildings (profile by blend weight, floors, type, roof, colour, wear), shells and facade module placements. What the numbers became:
- Blend band: the weight of an area's profile falls in a straight line across its edge, from 1 one band depth inside to 0 one depth outside. The depth on each side is `blend_m` times 1.5, times 0.7 where the edge runs along a road or a rail line, and never under 85 m, because a step of at most 20 percent between samples 25 m apart needs 125 m or more from one profile to the other. Rule ground mixes its 100 m cells with a 200 m tent.
- Floors: the parcels of one tile that follow one profile share its floor distribution, bigger footprints leaning taller; a footprint carries at most 1.2 times the root of its area in floors.
- Lots: in a profile whose buildings stand wall to wall on the street line (setback up to 1 m, or "shops on every street frontage") all free frontage is cut into lots; elsewhere only a hole of up to 60 m in a row. Lots keep off open land, water and drains, rail lines, landmark zones, paved walking areas and footway lines, the ground under a deck and any strip under 14 m deep between two roads. Block interiors are not filled.
- Modules: `<building type>.<part>`, one instance per bay and floor of a wall that looks on a street or on open ground (TECH.md "Tile format").
- Dressing, life points, kits and LOD are their own tasks (P2-010, P2-012, P2-013).

### Area kits

- One kit per archetype: modular facade, roof, balcony, shopfront and prop pieces. Textures (TX1): one VRAM compressed Texture2DArray per kit for tiling materials and one trim and decal atlas per kit, imported by Godot. Modules keep fixed ids so baked placements never change when a module is replaced (KT2).
- Kits are procedural first, then upgraded with texture cards in the signed style.

### Map inspector: area view

Part of the map inspector page from `MAP_REPAIR.md`:
- Map coloured by area (archetype colour, area outline, blend bands shaded).
- Click an area: its profile fields with evidence lines, a 3D preview of a generated block, and edit controls.
- Save writes the area override file (versioned in git) and an inbox entry with source `inspector`.
- Landmark layer: tier icons, click to fly to a landmark, see its registry entry and flagged issues (position disagreement, missing footprint).

### 2a. Pilot area reference sheets (P0-035, 2026-11-11)

Each pilot area has a sheet `harness/design/areas/<area_id>.md` (20 or more cited sources with licences, every fixed heading filled, a "what makes this area unlike the others" section and an edge-blending note) and a thumbnail board `harness/design/areas/<area_id>_board.jpg` (internal reference only, never shipped, never full-size third-party photos in git). The profile values below are read from those sheets and are the start values for `harness/data/areas/profiles/<area_id>.json`. They differ on purpose. Decisions.md "Every area is built from real references".

| Area id (sheet) | Lamps | Footpaths | Boundaries | Buildings | Wear | Confidence |
|---|---|---|---|---|---|---|
| `cp_inner_circle` | steel pole, two arms, 9 m, 28 m spacing, warm white | 6 m cream stone under the colonnade, 3 m with flower bed on the park side, tactile strip | green steel railing 1.2 m, hedge planter, cast bollards | 2 storey white render colonnade, Tuscan columns, parapet, arched pavilions, towers behind | 0.15 | medium |
| `cp_outer_circle` | same two-arm pole plus highmast at big junctions, sodium | 4 to 5 m under the arcade, 2 to 3 m on the road side, yellow-black kerb | pedestrian railing, jersey barriers, subway mouths, gantry signs | 2 storey arcade facing in, 8 to 20 storey glass and concrete towers facing out | 0.2 | medium |
| `janpath` | tall double-arm poles in a median, sodium, fairy lights on market trees | 3 m red and cream chequer walk at the market, 2.5 m grey paver with yellow-black kerb | low black median railing, green NDMC signs, rolled shutters | low 2 storey Tibetan Market row, 4 to 6 storey brand-board offices | 0.25 | medium |
| `india_gate_kartavya_path` | black cast lantern posts 6 to 8 m, 30 m spacing, warm | 6 to 8 m pink crushed stone and paved band, then lawn | green iron railing, white stone posts with chains, barricade stripes | India Gate 42 m buff arch, red and cream sandstone North and South Block, no shops | 0.03 | medium |
| `ito` | highmast and curved-arm poles on flyovers; two curved-arm poles in the median, 10 to 12 m, 35 to 45 m spacing, on Bhairon Marg and Jawaharlal Nehru Marg; sodium | 2.5 to 3 m red-brown paver with yellow tactile strip and a planted verge on Bhairon Marg, 2 to 2.5 m grey kerb walk on Safdar Hashmi Marg, about 1 m on Todarmal Lane, 535 m skywalk | flyover railing, jersey barriers, brick walls 2 m on side streets, yellow police barricades at crossing mouths | 10 to 15 floor grey concrete and glass slab offices (PWD, Police, Shakti Sadan with blue bands), brick-orange Doordarshan block, metro viaducts | 0.35 main roads, 0.5 side streets | medium for road kit and buildings, low for the crossing layout (P2-002) |
| `chandni_chowk_main` | tall double-arm sodium poles on the median, bare shop bulbs, neon at night | 1 to 1.5 m taken by stalls (old state); red sandstone pedestrian priority (redeveloped state) | median iron railing, shutters, temple and gurudwara gates | 3 to 5 storey bazaar blocks, lime plaster and brick, domes, hoardings, hanging wires | 0.9 | medium |
| `chandni_chowk_galis` | bare bulbs, tubes and string lights on shopfronts and awnings, few brackets at lane mouths | none; one worn surface from shutter to shutter, shop spill 0.5 to 1.5 m each side, open drain on one edge; lanes 2.5 to 6 m (bazaar lanes 4 m, Ballimaran 5 to 6 m, Khari Baoli 8 to 10 m) | rolled shutters, haveli iron gates, lane-mouth arches 3 to 4 m wide, tarps | 3 to 5 storey, cantilever and jharokha, painted haveli faces, tangled wires | 1.0 (0.9 in wider lanes) | medium (P2-002) |
| `red_fort_surroundings` | tall twin-arm poles 10 to 12 m at the junction and plaza, steel curved-arm poles 9 to 10 m, ground floodlights up the fort wall | plaza 40 to 60 m across in front of the Lahori Gate (open paving, not a road), 1.5 to 2.5 m shared with hawkers on the Chandni Chowk side | red sandstone rampart and dry moat 15 to 20 m wide with 1 m parapet, yellow barricades, orange cones for queues | red Agra sandstone fort 18 to 33 m, plain white 3 to 4 storey police blocks, temples and old shop fronts across the road | 0.35 | medium (P2-002) |
| `jantar_mantar` | black cast lanterns on stone pillars in the garden, single and double-arm poles 9 m, 35 to 40 m spacing outside | red stone paths in the garden, 3 m pavement at the railing, wide tarmac edge with a 2 m taxi lay-by on Sansad Marg | low stone wall, green iron railing 2.5 m with spear tops, red sandstone wall 1.5 to 2 m, yellow police barricades on wheels | red-orange plaster instruments with cream trim, 5 to 12 storey government blocks, Reserve Bank complex with canopy | 0.1 to 0.15 (more at the protest railing) | medium for the road, low to medium for Jantar Mantar Road (P2-002) |
| `paharganj_station` | bare bulbs, a few sodium poles, neon hotel signs, lit roof hoardings | about 1 m broken shop-front strip; granite forecourt at the station | coloured roll-down shutters, arch entrances, station railings | 4 to 6 storey stacked hotels, rooftop masts, old haveli fragments, station concourse and flyover | 0.8 | medium |
| `gb_road_ajmeri_gate` | curved-arm poles at the gate, high mast with a cluster of heads over the station forecourt, shop tubes and lit signs | none to 1.5 m of broken concrete at the shops (1 to 1.5 m shop spill), 8 to 10 m kerbed apron at the station | iron railing round the gate island, yellow police barricades, rolled shutters on every ground floor | hardware and parts shops at street level with painted boards, 3 to 5 storey shuttered fronts with balconies and cables, 10 m red stone Ajmeri Gate, two-storey station colonnade; the trade above is background only (GAME.md respect rule) | 0.7 to 0.8 (station 0.4) | medium at the gate and station, low mid-road (P2-002) |

Edge blending (what changes first when walking from one area to the next): buildings (age, height, colour) change first, then footpath width and material, then lamp type, then boundary type. Lamps and kerb stripes carry over for about two blocks. Details per area are in the last section of each sheet. This feeds the blend bands in "Smooth edges" above.

Top-up (P2-002, 2026-11-13): ITO, the galis, Jantar Mantar and the Red Fort roads each gained 20 to 24 street-level Commons photos, and the new sheet `gb_road_ajmeri_gate.md` has 30 (hardware street only, under the GB Road line of the respect rule). Every sheet now has a "Map notes" list (missing side roads, dividers, separations, widths seen in the photos) to check against OSM and satellite before the blueprints are drawn. Infrastructure variants are in `harness/design/reference/infrastructure/variant_map.md`. Gaps left: the ITO crossing itself and the middle of GB Road have no openly licensed street-level photo; Mapillary and Flickr need a login or token and were not used, so the owner's own photos or a Mapillary token would close them.

## 3. Respect rule

Every community is shown with respect and accuracy, from data and reference, never caricature.
- Every profile value and every landmark field has an evidence line (a data source or a reference photo set). No value is set from a cliche.
- Variety and life, not stereotypes: every area has a spread of building types, colours, ages and people. No single type covers more than about 70% of an area unless the data says so.
- People in every area vary in age, gender, clothing and activity. No group is defined by one costume, job or behaviour.
- Places of worship appear only where they really are (registry or OSM), built with the same care as any landmark. Religious symbols are never used as decoration to label an area.
- Lower income areas, urban villages and unauthorised colonies get the same craft and detail as wealthy ones. Wealth shows in upkeep and materials, not in mocking people or dirt for its own sake.
- No real people, no real party symbols, no real brand logos on signs (invented business names in the right scripts).
- The VERIFY.md rubric has a respect line (added with the style bible), and the art-reviewer checks it on every image.

## 4. Pilot

Build and prove both layers on the pilot centre (section 0.4) before scaling up:
- Areas: the eleven pilot area sheets of section 2a, from the colonial CBD of Connaught Place to the Chandni Chowk galis and Paharganj. Contrasting profiles on purpose.
- One metro line: the Blue Line stretch from Mandi House past Pragati Maidan to Indraprastha (elevated viaduct, stations, foot over bridges, next to ITO). Planner call (P0-022): it is the elevated line inside the pilot centre, so it proves the viaduct rules; the Yellow Line through Chandni Chowk, Rajiv Chowk and Central Secretariat runs underground there and adds only station entrances, which come with the signature landmarks. Anmol can change it.
- Hero landmarks: Connaught Place circle, India Gate, Red Fort (owner). Jama Masjid is in the pilot as a signature until its hero model.
- Exit for the pilot: landmark position tests pass, the side by side reference sheet is read and passes, the area difference metric passes, perf is inside the signed budgets on the pilot camera paths. Then the rest of the centre block, then the far blocks (section 0 stages).

## 5. Performance approach

Signed with the architecture (TECH.md "Rendering of the city", budgets in `perf_budgets.json` blocks `systems` and `world`):
- Generated buildings: unique shells merged per tile and material; repeated facade modules, props, trees, poles and parked vehicles as MultiMesh per module per 125 m cell. Draw calls grow with kits in view, not with buildings. GPU budget 2.0 ms (part of the 3.5 ms city line).
- Street dressing, decals, signs and grime: 0.5 ms; decals only within 55 m, no shadows from small dressing.
- Landmarks: 0.5 ms; up to 8 parts of 25,000 triangles per hero, 3 LODs per part, one far silhouette under 2,000 triangles; at most 2 heroes at full detail in view.
- Life (people, vendors, animals): skinned within 25 m (cap 40), vertex animation to 120 m, 120 people at release, 0.6 ms GPU.
- One Texture2DArray and one trim and decal atlas per area kit, VRAM compressed (BPTC or S3TC and ASTC or ETC2, both sets), 60 MB per kit at most.
- LOD per 125 m cell: full modules to about 180 m, merged block shells to about 700 m, the skyline beyond. Hero landmarks keep their own LOD chain and far silhouette.
- Grime wear and tint travel in the MultiMesh custom data.
- Tiles carry placement data with a byte budget (about 0.6 MB per dense tile, measured 0.57 MB for 11,793 facade bays).
- Measure the pilot on fixed camera paths at 60, 140 and 200 km/h before any scale-up.

## 6. Verification

- Landmark position: positions are checked in the landmark's block frame (block offset plus the projected position). A unit test projects every registry entry with `confidence.position` high and checks the baked position and orientation. Tolerance: hero 5 m and 5 degrees, signature 10 m, marker 15 m (measured error 0.006 mm in the stitch bench). A scenario teleports to each pilot hero and reads its world position through the hooks; north is -Z and the landmark is on the right side of the map.
- Source agreement: a Wikidata P625 point outside the OSM footprint and more than 50 m from its centre is a flagged issue in the map health report, never silently placed.
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
- P0-010, P0-020 (architecture options) and P0-021 (architecture rounds): done and signed 2026-11-11. The landmark registry pipeline, the area profile pipeline and the inspector views are rows in `ARCH_OPTIONS.md` section 8, recorded in section 10 below.
- P0-018 (data bench): source and licence check for landmark and area sources, and a pilot census.
- P0-014, P0-021 (later rounds): done. The hero order and the area order are in section 9.
- P0-023 (plan the game): adds the build tasks listed below after the map repair pilot.

## 8. Build tasks for the world layers (P0-023 plans them)

Planned in phase P2 (2026-11-11): item 1 is P2-005, item 2 is P2-006, item 3 is P2-007 with the art cards P2-008, item 4 is P2-004 (after the reference top-up P2-002), item 5 is P2-009 with the kits P2-010, LOD P2-012 and dressing P2-013, item 6 is P2-018, item 7 is P2-025, P2-026 and P2-027, item 8 is P2-028.

1. Landmark registry build: sources ingest, match and merge, tier scoring, `landmarks.json` and overrides (Fable tier).
2. Landmark placement pipeline: footprint, orientation, plinth fit, landmark zone, surroundings, LOD hook-up (Fable tier).
3. Landmark stand-in parts kit and the pilot heroes as stand-ins; art cards for the pilot heroes (art-director).
4. Area division and area profile data for the pilot areas, with evidence lines.
5. Area profile generator: parcels, buildings, street dressing, edge blending, instancing and atlases (Fable tier).
6. Map inspector area and landmark views.
7. Pilot verification: landmark position tests, reference side by side sheet, area difference metric, perf on the pilot paths.
8. OSM attribution ("© OpenStreetMap contributors") and every other source credit shown in the game.

## 9. Owner answers and settled questions

Answered in interview sitting 1 (2026-11-10, inbox source "interview"; details in `CITY_BRIEF.md`):
- First hero landmarks: Connaught Place circle, India Gate, Red Fort (inbox mmwarq9yx). India Gate is about 2 km south of CP; in the signed seamless map the pilot centre holds both at true scale.
- Districts in the compressed map: central core, Old Delhi, East Delhi across the Yamuna, South with Gurgaon and the airport, plus story places: GB Road, Jantar Mantar (protests), Vasant Kunj, Delhi Gymkhana, the Golf Club, Khan Market, one haunted place (inbox mmwarq9we).
- Release: free and public (inbox mmwarqa1h). Prefer data licences that would still allow a later sale (decisions.md "Speeds and map size").
- Political posters: invented parties only (inbox mmwarqa41).
- Map size: "smaller than gta5 but not too small to feel boring and not vast" (inbox mmwartrys).
- Look: B stylised realistic, with D's grime in Old Delhi (inbox mmwarkusg). Area profiles get a `wear` value (0 to 1) that drives the grime layer; see `STYLE_OPTIONS.md` "Landmark tiers and area kits per candidate".

Tiers for the places he named: heroes CP circle, India Gate, Red Fort; heroes later Jama Masjid, Qutub Minar, Humayun's Tomb; signature Jantar Mantar, Khan Market, Delhi Gymkhana, the haunted place, IGI terminal, Yamuna bridges; GB Road, Vasant Kunj and the Golf Club grounds as area profiles with marker buildings. Full table in `CITY_BRIEF.md` "Landmarks".

Answered in sitting 2 (2026-11-10): layout C in stages, the first release and later districts, homes as proposed, the pilot, Malcha Mahal as the haunted place, an invented Delhi-like police force (see the top of section 0). Hero roads were added as a tier next to hero landmarks (decisions.md "Hero roads"; `MAP_REPAIR.md` "Hero roads").

The composite map questions he answered (P0-028: layout, extra places, NCR parts, homes, the east bank, the pilot) and the seamless map that replaced the islands are recorded in section 0; the history of the layouts is in section 0.3.

Settled by the architecture sign-off and planner calls (P0-022; Anmol can change any of them through the inbox):
1. Heroes after the first three: Jama Masjid, Humayun's Tomb and Qutub Minar, in the order their districts are built (the "heroes later" of the tier table above).
2. Areas after the pilot: the rest of the centre block outward from the pilot (Kashmere Gate, Karol Bagh and the Ridge, Daryaganj to Rajghat, Lutyens with Khan Market and Lodhi, Nizamuddin), then the Yamuna and Laxmi Nagar, then the far blocks.
3. Metro line for the pilot: the Blue Line stretch at Pragati Maidan (section 4).
4. The architecture questions: answered in rounds 1 and 2 (decisions.md "Architecture answers, round 1" and "round 2").

## 10. Signed pipeline (architecture sign-off, 2026-11-11)

The measured comparison (P0-020) is in [`ARCH_OPTIONS.md`](ARCH_OPTIONS.md) section 8 (world layers), section 4 (composite map) and section 7 (inspector). This is the signed pipeline in one place. All of it runs in the offline bake (`tools/bake/`, Node and TypeScript) after map repair; the game reads the result from the tiles.

### Landmark registry pipeline

1. **Sources and matching (LM1).** Join on ids, not names: OSM objects carry a `wikidata` tag; Wikidata gives coordinates, era, height, heritage status and the ASI monument id. Name and distance matching is only a fallback, and every fallback match is flagged. Heroes and signatures come from Anmol's list and are checked by hand. The registry is built per block, from the block outline plus the far landmarks.
2. **Storage (LS2).** `harness/data/landmarks/<id>.json` per hero and signature, `landmarks_markers.json` generated, `landmarks.overrides.json` for edits. Same schema as section 1, plus `block`, `district` and `far`.
3. **Tier scoring.** A score proposes the tier (named by Anmol, ASI listed, Wikidata sitelinks, footprint size, seen from an arterial or a hero road). Anmol's list and inspector edits win.
4. **Placement (LP2).** Inside a block: block offset plus the projected position in the block frame, on a flattened pad, replacing the repaired buildings in its zone (logged). Outside every block: a far landmark on the backdrop, placed by its real bearing from the nearest block, as a silhouette. A far landmark is never a place the player can reach, and the map does not mark it as one.
5. **Hero models (HM2).** Up to 8 parts per hero, up to 25,000 triangles each, up to 6 materials in all, 3 LODs per part, one far silhouette under 2,000 triangles. LODs are made with Blender in background mode (it is installed on this Mac) or meshoptimizer. The ingest tool gets a hero rule with these limits.
6. **Stand-in parts kit (HM3 as the placeholder).** Domes, chhatris, arches, colonnades, minarets, shikharas and slabs, driven by the registry fields. It is the stand-in for every hero until its model arrives, and the final build for the signature tier.
7. **Checks.** The Wikidata point lies inside the OSM footprint or within 50 m of its centre, or the entry is flagged (measured on the pilot: 21 of 69 are over 50 m by centre alone, 8 of 46 with a footprint; Red Fort is 76 m off only because the site is large); the position test in the block frame; the relative layout test.

### Area profile pipeline

1. **Area division (AD2).** Claude draws 3 to 8 area polygons per focus district along roads and rail, seeded by OSM land use and colony outlines, with the 100 m feature grid as evidence. Anmol edits them in the inspector. In-between areas of the seamless centre get an archetype profile by rule first (from land use and the footprint grid) and a hand-drawn polygon when they become a focus district. Generated city along corridors blends the profiles of its two neighbours.
2. **Profile storage (PS1).** Archetype defaults, a small file per area with only what differs, and an overrides file for inspector edits. Every value has an evidence line. The `wear` value (0 to 1) drives the grime layer of look B+D.
3. **Generator at bake time (AG1).** Parcels, building shells, facade module placements, street dressing and colliders are written into the tiles. Only life (people, vendors, animals, parked two-wheelers) is spawned in the game, from seeded points in the tile.
4. **Kits and atlases (KT2, TX1).** Procedural modules first, replaced module by module through ingest. One Texture2DArray and one trim and decal atlas per kit. Fixed module ids.
5. **Edge blending and seeds (EB1).** Inside each area's blend band the generator mixes the two profiles by distance, shorter at roads and rail. One seeded random generator, written once in the bake; every pick is seeded from the world tile and a parcel id made from the footprint, so a rebake gives the same city.
6. **Checks.** The area difference metric, variety inside an area, smooth edges on transects, and the respect rule read by the verifier (section 6).

### Inspector views

IV1, built in the order of IV3: one page with layers. Issues and lanes first; then hero roads beside their reference photos, the focus outlines and the corridors; then the area view (map coloured by area, profile fields with evidence, a generated block preview, edit controls) and the landmark view (tier icons, fly to, registry entry, flags). Every edit writes an override file and an inbox entry with source `inspector`.

### What the benches measure for these layers

- P0-016 (`harness/reports/arch/render.json`): the area kit block as MultiMesh modules against merged meshes; the crowd.
- P0-018 (`world_sources.json`, `landmarks_pilot_draft.json`): the licence of every landmark and area source, the pilot landmark census with the OSM to Wikidata distances, and which area sources cover the pilot.
- P0-029 (`stitch.json`): landmark position error in the district frame, and the layout inside a district against reality.


## OSM is reference, not the final word (Anmol 2026-11-13)

Anmol: "We don't have to be stuck with what OSM is giving us ... OSM is good for reference ... CP has its own style of buildings and all. We have to follow that as well."

- **Area blueprints.** For places we know (Connaught Place inner and outer circles and radials first, then Janpath, Kartavya Path and India Gate, Chandni Chowk, Paharganj), an authored blueprint in `harness/data/blueprints/<area>.json` sets the blocks: footprint shape, height, floor count, roofline, setbacks, the facade kit and the ground floor (colonnade, arcade, shopfronts). CP's inner and outer circle blocks are the uniform two storey white Georgian colonnade ring, with the tower blocks behind the outer circle, whatever OSM draws. OSM footprints, photos and satellite views are the inputs; the blueprint is the decision.
- **Precedence on any square metre:** road corridor, then landmark zone, then area blueprint, then the generator working from the repaired OSM footprints.
- **Odd OSM buildings.** Outside blueprints, a footprint check flags shapes that would look wrong in game (slivers, spikes, zig-zags, self-overlaps, sizes or heights far outside the area profile). Each flag is checked against photos or satellite (the area reference sheets): if the real building is like that, it stays; if not, it is regularised to the area's typical shape. The map inspector shows these as their own issue kind.
- **Style comes from the area.** Every generated building follows its area profile's style (materials, colours, balconies, railings, roofs), so a block never looks like it belongs to another part of Delhi.

## Water: the Yamuna, canals, drains and ponds (Anmol 2026-11-13)

Anmol: "Do we have plans to have a river system for it proper flowing? Which is hydrologically correct as well. Elevation wise."

Today the bake gives each water body one flat level over a carved bed. The water system replaces that with a network that is right by height and by flow:
- **Network.** OSM `waterway=river|canal|drain|stream` lines and water polygons form one directed graph: the Yamuna, the canals and water channels (the Kartavya Path canals, the Western Yamuna Canal and Agra Canal where the map reaches), the big drains (Najafgarh, Barapullah and the nalas), and ponds and park lakes. Direction comes from OSM where tagged and otherwise from the bare-earth DEM.
- **Heights.** The water surface falls downstream, never rises: the Yamuna falls about 0.2 to 0.3 m per km north to south through Delhi, canals and drains follow their bed slope, and every join is level (a tributary meets the river at the river's surface height). Ponds and the ornamental canals are level pools with an outlet. The bed and banks are cut into the terrain to match, with sloped banks, embankments (bunds) and ghats where the city has them. A check fails the bake on any water surface that rises downstream or steps at a join.
- **Bridges and roads.** Every bridge deck keeps its clearance over the surface (the lane model's missing "deck over water" rule), and culverts carry drains under roads.
- **Look and flow.** The water shader moves in the flow direction at a speed from the slope and class (the river slow and wide, drains faster), with foam at weirs and bridge piers, and colour by kind (the Yamuna's grey green, clean ornamental canals, dark drains). Seasonal level (monsoon high water, winter low) comes later.
- **Play.** Deep water is a stated fail until swimming exists (GAME.md, LATER); boats on the Yamuna are LATER too.
