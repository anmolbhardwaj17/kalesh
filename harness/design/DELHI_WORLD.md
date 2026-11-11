# Delhi world layers: landmark registry and area profiles

Design starting point, written 2026-11-10 (planner REPLAN after Anmol's direction change, inbox mmwapw3co; decisions.md "Delhi world layers"). Refined in architecture discovery (P0-010, 2026-11-10): the map round answers are recorded in section 0, and section 10 lists the pipeline choices with their option ids from [`ARCH_OPTIONS.md`](ARCH_OPTIONS.md) section 8. The map layout, districts and pilot are Anmol's answers. Everything marked "Rec" is a recommendation until the architecture sign-off. Every number is an estimate unless it names a report file. The game is now called Kalesh.

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

## 0. Composite map

**Anmol's answers (interview sitting 2, 2026-11-10; decisions.md "Sitting 2 results"; `GAME.md` "Map and districts"):**
- Layout C (Delhi plus NCR) is the full map, built in stages.
- Pilot: Connaught Place with Jantar Mantar, India Gate, ITO, Chandni Chowk with Red Fort (about 7.2 km2, estimate).
- First release: layout B's districts plus Gurugram, Laxmi Nagar, Kashmere Gate with ISBT, and Humayun's Tomb with Nizamuddin.
- Later unlocks: Noida, Shahdara, Akshardham.
- Homes as proposed in 0.1. The haunted place is Malcha Mahal (in the Central Ridge clip, D17). The police force is invented and Delhi-like.
- `harness/data/districts.json` gives every district a `stage` (pilot, release, later), so the bake and the story open them in order.

**Changed on 2026-11-11 (Anmol on the stitch shot; decisions.md "One seamless open city, no gaps"):** the map is one continuous open world. No bare ground between districts, real in-between areas where they matter (Paharganj, Karol Bagh, Daryaganj, ITO, Mandi House, Pragati Maidan), generated city blended from the neighbouring area profiles elsewhere, one road network across edges, and real directions. The recommended layout for that (the centre as one real block at factor 1.0, far districts on their real bearing at one factor, the corrected offsets, and the tile and bake cost of about 68 km2) is in `ARCH_OPTIONS.md` "District layout recommendation", pending the architecture sign-off. Where the draft below says islands, open-land filler, hand-set offsets or "filler never claimed as a real place", that section now wins; this section is rewritten by the architecture record task after the sign-off.

The text below is the P0-028 draft that he answered. The mechanics are Rec X1 (block frames), CG2, DC2, SC1 and FL4 in `ARCH_OPTIONS.md` section 4 and are described in `MAP_REPAIR.md` "District frames and stitching".

Anmol (inbox mmwarg8cw, 2026-11-10): a compressed Delhi, the way big open world games treat a real city: main areas, monuments, localities, roads, the Yamuna, the airport, parts of NCR and East Delhi, merged into one smaller map. Not a 1:1 copy.

Proposal for the architecture options (Anmol confirms the district list and layout in the interview):
- **Districts at true scale inside.** Each chosen district is clipped from real data (OSM streets, footprints, DTM) and keeps true distances and angles inside it. Landmarks stay where they really are inside their district.
- **Districts moved closer.** Each district gets a placement offset (translation only: no rotation, no scale, no mirroring; north stays -Z). Details in `MAP_REPAIR.md` "District frames and stitching".
- **Authored connectors join them**: ring road arcs, flyovers, the Yamuna with its bridges, the airport road, NH-48 towards Gurugram, the roads into East Delhi and Noida. They use the same lane model and elevation solver as real roads.
- **Filler** between districts comes from area profiles (generated ordinary city, parks, rail corridors), never claimed as a real place.
- **Steps added to the bake**: district selection (`harness/data/districts.json`: clip polygon, frame origin, offset, area profile hints, why it is in the game) before ingest, and stitching with connector authoring (`harness/data/connectors/`) after the per-tile overrides. Connectors are data files Claude authors and Anmol reviews in the map inspector.
- **Seed list from his words** (to turn into 15 to 25 candidates with real size and game role): Connaught Place, India Gate and Rajpath, Chandni Chowk and Red Fort, ITO and Pragati Maidan, a stretch of the Yamuna with bridges, IGI Airport, East Delhi (Laxmi Nagar, Shahdara side), parts of NCR (Gurugram Cyber City, Noida), plus areas the three characters need (a police station or HQ for the cop, auto stands and a resettlement colony for the driver, markets and back lanes for the fixer).
- **Size targets** (estimates, to compare in the layout options): total playable area, number of districts, longest drive across the map at 80 km/h, and bake area in km2. Section 0.3 gives three layouts with north-up sketches.
- **Tests**: a landmark lands at its district offset plus its projected position within the tier tolerance; relative layout inside a district matches reality; every boundary port is closed; north is up on the map and -Z in the world.

### 0.1 Candidate districts (P0-028 draft, pending Anmol)

22 candidates from Anmol's list (central core, Old Delhi, East Delhi across the Yamuna, the south with Gurugram and the airport, and his story places). Every number is an estimate: centres are read from public maps to about 200 m, clip sizes are first proposals, costs are guesses until the P0-018 data bench measures real data. "Must" and "optional" are proposals: must means Anmol named it or a character needs it. Cost: S (under 2 build tasks), M (2 to 3), L (3 to 5), XL (5 or more, hard road geometry or the densest areas), counted after the base layers exist.

| # | District | Real centre (lat, lon), est | Clip at proposal, est | What it gives the game | Must or optional | Data and build cost, est |
|---|---|---|---|---|---|---|
| D01 | Connaught Place: inner and outer circle, radials, Palika Bazaar, Rajiv Chowk Metro | 28.6315, 77.2167 | 1.2 x 1.2 km, 1.4 km2 (with D02: 1.2 x 1.6 km, 1.9 km2) | Hero: CP circle. Driver's main fare stand at the Metro exits; cop patrol; fixer meetings in the colonnades. Missions: fares, chases round the circles, a shootout in the corridors. Life: office crowds, vendors, autos queuing | Must (hero) | L: OSM very good; radial junctions and the colonnade kit are the work |
| D02 | Jantar Mantar and Sansad Marg | 28.6271, 77.2166 | 0.6 x 0.6 km, 0.4 km2, clipped with D01 (450 m apart, so they share one clip in every layout) | Jantar Mantar observatory (signature); the protest site. Cop crowd control, fixer works a crowd, driver drops a leader. Agrasen ki Baoli (haunted candidate) is about 800 m east, just outside the clip unless it grows | Must (story place) | S: small; needs the crowd system |
| D03 | India Gate and Kartavya Path: C-Hexagon, lawns, canals, Vijay Chowk | 28.6135, 77.2190 | 2.2 x 0.8 km, 1.8 km2 | Hero: India Gate. Rashtrapati Bhavan and North and South Block as far signatures. Evening crowds, ice cream carts, a chase down the long avenue, cop VIP route. The War Memorial is a no-combat zone (respect rule) | Must (hero) | M: simple roads and open lawns; the hero model and the far buildings are the work |
| D04 | ITO and Pragati Maidan: stacked flyovers, Vikas Marg, IP Estate, Bharat Mandapam, the tunnel, Delhi Gate, Khooni Darwaza | 28.6290, 77.2430 | 1.4 x 1.2 km, 1.7 km2 | The cop's station (made up, no real station named) and the police HQ area. Pursuits on the flyovers, barricades, the tunnel chase. Khooni Darwaza is a haunted candidate inside | Must (cop's base, pilot) | XL: the hardest road geometry in the map (stacked ramps, tunnel); the lane model's proving ground |
| D05 | Lutyens bungalows and Delhi Gymkhana: Safdarjung Road, roundabouts, tree tunnels | 28.6033, 77.2003 | 1.0 x 0.9 km, 0.9 km2 | Delhi Gymkhana (signature). Power and money (invented politicians only, no real residences shown). Tail a car, a VIP heist, cop protection duty | Must (story place) | M: repeating bungalow kit and roundabouts; many trees (perf) |
| D06 | Khan Market, Lodhi Garden and the Delhi Golf Club | 28.5960, 77.2280 | 1.4 x 1.0 km, 1.4 km2 | Khan Market and the Lodhi tombs (signatures). Rich clients for the fixer, cafe meets, a chase across the golf course | Must (story places) | M: the market is small; the golf course is cheap open ground |
| D07 | Paharganj and New Delhi Railway Station | 28.6430, 77.2170 | 1.2 x 0.9 km, 1.1 km2 | NDLS station (signature). Driver's station stand; fixer's hotel contacts; backpackers, touts, porters. The "Train at 6:10" fare | Must (driver and fixer) | L: dense lanes plus the station; rail yard as cheap filler |
| D08 | GB Road and Ajmeri Gate (Swami Shraddhanand Marg) | 28.6480, 77.2240 | 0.6 x 0.5 km, 0.3 km2 | Story and atmosphere only, under the respect rule: no sexual content, no exploitation of real people. Hardware shops at street level; cop rescue missions; fixer contacts | Must (story place) | S: reuses the Old Delhi kit |
| D09 | Chandni Chowk, Red Fort and Jama Masjid: Dariba, Kinari Bazaar, Fatehpuri, Netaji Subhash Marg | 28.6530, 77.2350 | 1.6 x 1.1 km, 1.8 km2 | Hero: Red Fort; Jama Masjid hero later. Signatures: Sis Ganj Gurudwara, Fatehpuri Masjid, Gauri Shankar Mandir, Lal Mandir (no combat inside any place of worship). The fixer's home ground: on foot in the bazaar, rooftop chases, rickshaws, the "Red Fort rush" | Must (hero, fixer) | XL: densest area, crowds, narrow lanes, the grime layer (wear high) |
| D10 | Kashmere Gate and ISBT | 28.6670, 77.2280 | 1.0 x 0.8 km, 0.8 km2 | ISBT and the old gate (signatures). Arrivals into the city, smuggling by bus, fares | Optional | M: the bus terminal and its interchange |
| D11 | The Yamuna: river, floodplain, ghats and bridges (ITO bridge, Nizamuddin bridge, Loha Pul, DND; Signature Bridge as a far landmark) | river near ITO 28.6300, 77.2550 | corridor 0.4 to 0.5 km wide, 5.5 to 8.9 km long, 2.2 to 4.5 km2 | Bridges as chokepoints for wanted escapes; night scenes at the ghats; the line between the two halves of the city | Must | M: water and floodplain are cheap per km2; each bridge is an authored connector (lane model and elevation solver) |
| D12 | Laxmi Nagar and Shakarpur: coaching centres, Vikas Marg market, the elevated Blue Line | 28.6310, 77.2770 | 1.2 x 1.0 km, 1.2 km2 | The driver's home (proposal). Dense 4 to 6 storey lanes, the fixer's East Delhi deals, a Metro viaduct chase | Must (East Delhi, driver) | L: dense generated city and the Metro viaduct |
| D13 | Shahdara and Seelampur back lanes | 28.6730, 77.2890 | 1.2 x 1.0 km, 1.2 km2 | Old East Delhi wholesale lanes. The fixer's harder deals and rival crews; the drug racket line Anmol mentioned, told under the respect rule (invented gangs, no real community blamed) | Optional | M: reuses the Old Delhi and Laxmi Nagar kits |
| D14 | Akshardham and the Games Village edge | 28.6127, 77.2773 | 1.2 x 1.0 km, 1.2 km2 | Akshardham (signature, a place of worship: no combat inside). A chase along NH-9 | Optional | M: one complex signature model |
| D15 | Noida Sector 18 and Film City | 28.5700, 77.3230 | 1.4 x 1.0 km, 1.4 km2 | NCR new money: malls, Atta Market, the Film City studio gate. A filmi mission on a film set fits the tone | Optional (NCR) | M: modern tower and mall kit (shared with D22) |
| D16 | Nizamuddin and Humayun's Tomb: Dargah and Basti, Sundar Nursery, Nizamuddin station | 28.5920, 77.2470 | 1.2 x 1.0 km, 1.2 km2 | Hero later: Humayun's Tomb. Qawwali nights (atmosphere only), train arrivals at Nizamuddin | Optional (recommended in B) | L: hero model and a dense basti |
| D17 | Haunted place in the Central Ridge (Bhuli Bhatiyari ka Mahal; Malcha Mahal is the other Ridge candidate) | 28.6420, 77.2020 | 0.8 x 0.8 km, 0.6 km2 of forest with one ruin | Night and fog missions, the ghost story side line for all three. If Anmol picks Khooni Darwaza (inside D04) or Agrasen ki Baoli (next to D02), this clip shrinks to Ridge forest filler | Must (one haunted place; which one is open) | S: one ruin; trees cost perf |
| D18 | Dhaula Kuan interchange and the Ridge road | 28.5918, 77.1617 | 1.0 x 0.9 km, 0.9 km2 | The gate from the city to the airport and Gurugram; highway chases on a cloverleaf | Optional: proposal is to author it as a connector junction in B and C, not a real clip | L as a real clip (complex interchange); M as an authored connector |
| D19 | Vasant Kunj: Ambience and DLF Promenade malls, upscale sectors | 28.5410, 77.1560 | 1.2 x 1.0 km, 1.2 km2 | Rich clients and the Lutyens set at home (Anmol: "vasant kunj for lutens"), a mall shootout, a farmhouse party | Must (story place) | M: mall and gated housing kit |
| D20 | Mehrauli and Qutub Minar: the Qutub complex, Archaeological Park ruins, Mehrauli village | 28.5245, 77.1855 | 1.0 x 1.0 km, 1.0 km2 | Hero later: Qutub Minar. Ruins at night; Jamali Kamali in the park is another well known haunted candidate | Optional (recommended in B) | L: hero model, ruins, village lanes |
| D21 | IGI Airport T3 and Aerocity | 28.5530, 77.1000 | 1.8 x 1.0 km, 1.8 km2 (terminal, forecourt ramps, one runway stretch behind a fence, Aerocity hotels) | T3 and the control tower (signatures). Airport runs for the driver, a smuggling line for the fixer, a chase on the perimeter road | Must (Anmol named the airport) | M: one big signature terminal; the rest is flat fenced ground |
| D22 | Gurugram Cyber City and Cyber Hub, with the NH-48 toll edge | 28.4950, 77.0890 | 1.2 x 1.0 km, 1.2 km2 | Glass towers, Rapid Metro, Cyber Hub (signature). Corporate money, a heist in a tower, highway chases on NH-48 | Must (Gurgaon) | M: tower kit repeats well; glass needs good reflections |

Character homes, proposal for every layout (from `GAME_DESIGN_OPTIONS.md` section 1): the driver lives in Laxmi Nagar (D12) and works the CP stands (D01), the station (D07) and airport runs (D21), so his day crosses the ITO bridge. The cop works from a made-up station in the ITO district (D04) and patrols the core, with VIP duty in Lutyens and at India Gate (D05, D03) and protests at Jantar Mantar (D02). The fixer works out of Chandni Chowk and Paharganj (D09, D07), has contacts on GB Road (D08), deals in East Delhi (D12, D13 in C), and meets rich clients at Khan Market, Vasant Kunj and Cyber City (D06, D19, D22).

### 0.2 Connectors: the big roads, the river and the bridges

Connectors are authored data (`harness/data/connectors/`), built with the same lane model and elevation solver as real roads, and carry the real road's name. Lengths are game lengths, not real ones.

| Connector | Stands for | Joins | Kind | Layouts |
|---|---|---|---|---|
| Ring Road | Ring Road and Mahatma Gandhi Marg on the west bank | Holds the core: Old Delhi, ITO, Nizamuddin on the river side, the south arc, Dhaula Kuan in the south west | 6 lane arterial, flyovers at the big junctions | A (river bank and south arc only), B, C (full loop) |
| NH-48 | NH-48 from Dhaula Kuan | Ring Road to the airport and Gurugram, then off the map towards Jaipur | Expressway | A, B, C |
| Airport road | the T3 link | NH-48 to the T3 forecourt ramps and Aerocity | Expressway spur | A, B, C |
| MG Road | Mehrauli-Gurgaon Road | Qutub and Vasant Kunj to Gurugram | Arterial with the elevated Metro beside it | B, C |
| Aurobindo Marg | Aurobindo Marg | the south arc to Qutub | Arterial | B, C |
| Barapullah | the Barapullah elevated road | Nizamuddin to the south of Khan Market and Lodhi | Elevated | B, C |
| Janpath, Barakhamba Road, Minto Road, BSZ Marg, Mathura Road, Lodhi Road, Ridge Road | the same real roads | short links inside the core (CP to India Gate, CP to ITO, CP to Old Delhi, ITO to Old Delhi, ITO to Nizamuddin, India Gate to Khan Market and Nizamuddin, CP to the Ridge) | Arterials | A (some), B, C |
| ITO bridge | Vikas Marg bridge | ITO to Laxmi Nagar | Bridge | A, B, C |
| Nizamuddin bridge and Pushta Road | the NH-24 bridge and the east bank road | Nizamuddin to the east bank, up to Laxmi Nagar, so the river has a loop for escapes | Bridge, arterial | A, B, C |
| Loha Pul | the Old Yamuna Bridge (road below, rail above) | Old Delhi to Shahdara | Bridge | C |
| DND Flyway and NH-9 | the DND Flyway and NH-9 | the south arc to Noida, Noida up to Akshardham | Expressway | C |

### 0.3 Layout options (P0-028 draft, pending Anmol)

Three layouts, all north up, all with districts at true scale moved closer by translation only. Sketches (SVG, north arrow and 2 km scale bar on each): [Layout A](map_sketches/district_layout_a.svg), [Layout B](map_sketches/district_layout_b.svg), [Layout C](map_sketches/district_layout_c.svg). They are drawn from data by `harness/design/map_sketches/make_sketches.mjs`, which also prints the totals below and the placement offset of every district; edit it to move a district and redraw.

- **A. Compact core.** The 15 must places with trimmed clips and merges: CP with Jantar Mantar, Paharganj with GB Road, India Gate without most of Kartavya Path. Only the river bank and south arc of the Ring Road; the south (Vasant Kunj, airport, Cyber City) is pressed into the south west corner. The river is a narrow band on the east with Laxmi Nagar beyond.
- **B. Delhi shape (recommended).** The 15 musts at full clip plus Humayun's Tomb with Nizamuddin and Qutub with Mehrauli. Real compass directions hold: Old Delhi north, the core inside a full Ring Road loop, the Yamuna on the east with Laxmi Nagar across two bridges, the south outside the Ring Road with Dhaula Kuan as the gate to NH-48, the airport and Gurugram in the south west.
- **C. Delhi plus NCR.** B unchanged, plus Kashmere Gate on the north of the Ring Road, Shahdara and Akshardham on a wider east bank with Loha Pul as a third bridge, and Noida Sector 18 and Film City in the south east by the DND Flyway. B's districts keep the same positions, so C is B grown at the edges.

| Totals (all estimates) | A. Compact core | B. Delhi shape | C. Delhi plus NCR |
|---|---|---|---|
| Districts (plus the river) | 12 (D01 and D02, D07 and D08 merged) | 15 (D01 and D02 merged) | 19 |
| District clips | 13.4 km2 | 19.0 km2 | 23.6 km2 |
| Connectors and filler | 2.0 km2 | 3.2 km2 | 3.6 km2 |
| Playable land | 15.4 km2 | 22.2 km2 | 27.2 km2 (above the 15 to 25 target) |
| River and floodplain | 2.2 km2 | 3.8 km2 | 4.5 km2 |
| Detailed bake area (land plus river) | 17.6 km2 | 26.0 km2 | 31.7 km2 |
| Map box, and terrain-only bake (box plus a 0.5 km backdrop ring) | 6.7 x 5.8 km, 52 km2 | 9.1 x 7.5 km, 85 km2 | 10.1 x 8.9 km, 110 km2 |
| Longest drive (dotted on the sketch, 1.1 winding factor) | Cyber City to Laxmi Nagar, 9.9 km | Cyber City to Laxmi Nagar, 12.3 km | Cyber City to Shahdara, 14.2 km |
| Time across at 80 km/h (and in an auto at 65) | 7.4 min (9.1) | 9.2 min (11.3) | 10.6 min (13.1) |
| Landmarks: heroes now, heroes later, signatures | 3, 1 (Jama Masjid), about 23 | 3, 3 (Jama Masjid, Humayun's Tomb, Qutub Minar), about 25 | 3, 3, about 30 |
| Area kits | about 10 | about 11 (the basti reuses the Old Delhi kit) | about 11 to 12 (Shahdara and Noida reuse kits) |
| Bake time on this Mac, before the data bench measures it | 1 to 2 h | 1.5 to 3 h | 2 to 4 h |
| Streaming: tiles if 250 m (tile size is an architecture decision) | about 280 | about 420 | about 510 |

Honest costs:
- **Bake.** Grows with the detailed area: B is about 1.5 times A, C about 1.8 times A. All three stay far under the 50 GB disk Anmol allows (source data under 10 GB, estimate). The terrain-only ring is cheap.
- **Streaming.** The per-tile budget and the speed are the same in all three, so frame cost per second of driving is the same. What grows is disk, bake time and the number of area kits that can be resident at a district edge (at most 3 or 4 at once in all layouts, estimate).
- **Art volume.** The three first heroes are the same in all layouts. B adds two later heroes (Humayun's Tomb, Qutub Minar) and about 2 more signatures; C adds about 5 more signatures (ISBT, Kashmere Gate, Akshardham, Film City gate, Loha Pul). Kits barely grow because the extra districts reuse kits.
- **Road work.** The hard geometry (CP circles, ITO flyovers, the Chandni Chowk lanes) is in every layout. B adds Dhaula Kuan, Barapullah and MG Road; C adds Loha Pul and the DND. Each bridge or elevated connector is about 1 builder task on the lane model (estimate).
- **Risk A.** May feel small after a few hours ("not too small to feel boring"); the south corner is cramped, so the airport and Gurugram feel like a side room; fewer places for three lives.
- **Risk B.** The core is dense, so the central districts sit close (CP to Old Delhi about 2.6 km in the game, 3.0 km in reality); the south is moved most (Cyber City is 5.2 km from CP in the game, 19.6 km in reality), so the drive from Delhi to Gurugram is short but still a highway drive. Fits his size words.
- **Risk C.** Above his 15 to 25 km2 target and about 1.3 times B's work; the wide east bank and Noida need a third bridge and the DND. Better as later unlocks than at the first release.
- **All layouts.** Missions and spawn points are stored in district-local coordinates (district id plus position), so a district can move between layouts without breaking mission data. Moving a district means a rebake of its tiles and its connectors.

Placement offsets in B (game centre minus real centre, relative to CP, from the script): the core moves under 1 km (Old Delhi 0.8 km south, ITO 0.6 km west); the south moves most (Qutub 3.4 km east and 7.7 km north, Vasant Kunj 4.9 and 5.8, the airport 8.2 and 6.4, Cyber City 9.5 and 10.9). No district is rotated, scaled or mirrored.

### 0.4 Pilot inside the layout

The pilot is the first set of districts selected, repaired and stitched (`MAP_REPAIR.md` "Pilot area first"). Proposal: CP with Jantar Mantar, India Gate, ITO and Pragati Maidan, and Chandni Chowk with Red Fort, joined by Janpath, Barakhamba Road and BSZ Marg as authored connectors. That is about 7.2 km2 (estimate) and holds all three of Anmol's first heroes. India Gate adds about 1.8 km2 of simple roads and open lawns to the earlier proposal, so its cost is mostly the hero model. The pilot is the same in A, B and C, so it can start before the layout is final.

### 0.5 Recommendation

Build **Layout B** for the first release: it holds every place Anmol named, keeps real compass directions so Delhi players recognise it, sits in the middle of his size words (about 22 km2, about 9 minutes across at 80 km/h, 11 in an auto), and leaves room at the edges. Plan C's four districts (Kashmere Gate, Shahdara, Akshardham, Noida) as later unlocks, which fits his answer that players return for "a city that opens up": B's districts never move, so adding them is a bake of new tiles and connectors only. Start with the 7.2 km2 pilot above.

### 0.6 Questions for interview sitting 2 (composite map)

Already answered and not asked again: the district groups, the story places, the first three heroes, the map size in his words, the vehicle speeds. The haunted place is asked in section 9.

1. Which map layout should we build? (see the three sketches)
   - a. A, Compact core: about 15 km2, about 7 minutes across at 80 km/h, the cheapest
   - b. B, Delhi shape: about 22 km2, about 9 minutes across, real directions (recommended)
   - c. C, Delhi plus NCR: about 27 km2, about 11 minutes across, a bit bigger than your size words
2. Which optional places must be in the first release? (pick any)
   - a. Humayun's Tomb and Nizamuddin (in B)
   - b. Qutub Minar and Mehrauli (in B)
   - c. Kashmere Gate and the ISBT
   - d. Akshardham
3. Which NCR parts?
   - a. Gurugram Cyber City only
   - b. Gurugram and Noida (Sector 18 and Film City), both at the first release
   - c. Gurugram now, Noida later as the city opens up (recommended)
4. Where do the three live and work?
   - a. As proposed: driver lives in Laxmi Nagar and works CP, the station and the airport; cop at a made-up station at ITO; fixer in Chandni Chowk and Paharganj, with deals in East Delhi (recommended)
   - b. Swap the driver and the fixer: the fixer lives in East Delhi, the driver in Paharganj near the station
   - c. The driver lives in a resettlement colony at the map edge (one more district)
5. How big is the east bank of the Yamuna?
   - a. Narrow: Laxmi Nagar only, two bridges (ITO and Nizamuddin)
   - b. Wide: Laxmi Nagar, Shahdara and Akshardham, three bridges (as in C)
   - c. Narrow at the first release, Shahdara and Akshardham unlock later (recommended)
6. Which districts go in the pilot (the first piece built and proven)?
   - a. CP with Jantar Mantar, ITO and Chandni Chowk with Red Fort: about 5.4 km2
   - b. The same plus India Gate, so all three of your first heroes are in it: about 7.2 km2 (recommended)
   - c. Central core only: CP, India Gate and ITO, about 5.4 km2; Red Fort next

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

### Data file: `harness/data/landmarks.json`

One generated file plus one hand-edited override file (`harness/data/landmarks.overrides.json`), so a rebuild of the registry never loses Anmol's or Claude's edits. P0-010 keeps the schema below and recommends splitting the storage (Rec LS2, section 10): one file per hero and signature landmark in `harness/data/landmarks/<id>.json`, one generated `landmarks_markers.json` for markers, and the overrides file. Every entry also carries a `district` id; a landmark outside every district clip is marked `far` (skyline only).

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

- Hero: one model card (kind model, `model_lm_<id>`) with a step by step prompt, the reference photo list and notes on what must read at speed. Texture cards for its main materials. The prop ingest limit (25,000 triangles, 3 materials) is too low for a hero. Rec HM2 (section 10): a hero is up to 8 parts of up to 25,000 triangles each, up to 6 materials in all, 3 LODs per part and one far silhouette under 2,000 triangles.
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

P0-010 recommends a simpler method for the composite map (Rec AD2, section 10): with about 20 small districts, Claude draws 3 to 8 area polygons per district along roads and rail, seeded by OSM land use and colony outlines, and uses the feature grid below as evidence, not as an automatic clustering. The steps below stay as the way the evidence is made.

Method:
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

- One kit per archetype: modular facade, roof, balcony, shopfront and prop pieces. Textures (Rec TX1): one VRAM compressed Texture2DArray per kit for tiling materials and one trim and decal atlas per kit, imported by Godot. Modules keep fixed ids so baked placements never change when a module is replaced (Rec KT2).
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
| `ito` | highmast and curved-arm poles on flyovers, sodium | 3 to 4 m broken grey or red paver, 535 m skywalk | flyover railing, jersey barriers, brick colonial walls on side streets | 10 to 15 floor grey concrete and glass slab offices, media buildings, metro viaducts | 0.4 | low (thin photos) |
| `chandni_chowk_main` | tall double-arm sodium poles on the median, bare shop bulbs, neon at night | 1 to 1.5 m taken by stalls (old state); red sandstone pedestrian priority (redeveloped state) | median iron railing, shutters, temple and gurudwara gates | 3 to 5 storey bazaar blocks, lime plaster and brick, domes, hoardings, hanging wires | 0.9 | medium |
| `chandni_chowk_galis` | bare bulbs and tubes on shopfronts, few brackets at lane mouths | none; one worn stone or concrete surface 2 to 4 m wide with a drain | shutters, haveli iron gates, arches, tarps | 3 to 5 storey, cantilever and jharokha, painted haveli faces, tangled wires | 1.0 | medium to low (few gali photos) |
| `red_fort_surroundings` | steel curved-arm poles 9 to 10 m, ground floodlights up the fort wall | 2.5 m broken concrete on Netaji Subhash Marg, open stone and asphalt plaza | red sandstone rampart and dry moat, retaining wall railing, yellow barricades | red Agra sandstone fort 18 to 33 m, plain white 3 to 4 storey police blocks | 0.35 | medium |
| `jantar_mantar` | black cast lanterns on stone pillars in the garden, double-arm poles outside | red stone paths in the garden, 3 m paver outside | low stone wall, green iron railing, protest barricades | red-orange plaster instruments with cream trim, 5 to 12 storey government blocks around | 0.1 | low to medium (thin street photos) |
| `paharganj_station` | bare bulbs, a few sodium poles, neon hotel signs, lit roof hoardings | about 1 m broken shop-front strip; granite forecourt at the station | coloured roll-down shutters, arch entrances, station railings | 4 to 6 storey stacked hotels, rooftop masts, old haveli fragments, station concourse and flyover | 0.8 | medium |

Edge blending (what changes first when walking from one area to the next): buildings (age, height, colour) change first, then footpath width and material, then lamp type, then boundary type. Lamps and kerb stripes carry over for about two blocks. Details per area are in the last section of each sheet. This feeds the blend bands in "Smooth edges" above.

Gaps: ITO and the galis are thin on Commons (use Mapillary or street view in a later task); Mapillary and Flickr were not used because they need a token or manual browsing.

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
- P0-010 (architecture options): done. Decisions for the landmark registry pipeline, the area profile pipeline and the inspector views are rows in `ARCH_OPTIONS.md` section 8 and are summarised in section 10 below.
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

Answered in sitting 2 (2026-11-10): layout C in stages, the first release and later districts, homes as proposed, the pilot, Malcha Mahal as the haunted place, an invented Delhi-like police force (see the top of section 0). Hero roads were added as a tier next to hero landmarks (decisions.md "Hero roads"; `MAP_REPAIR.md` "Hero roads").

The composite map questions he answered (P0-028): see [section 0.6](#06-questions-for-interview-sitting-2-composite-map), with the candidate districts in [0.1](#01-candidate-districts-p0-028-draft-pending-anmol), the layouts and sketches in [0.3](#03-layout-options-p0-028-draft-pending-anmol) and the recommendation in [0.5](#05-recommendation): layout, optional places, NCR parts, where each character lives and works, the east bank of the Yamuna, the pilot districts.

Still open:
1. Which heroes come after the first three?
2. Which areas come first after the pilot?
3. Which metro line for the pilot? (Proposal: the Blue Line stretch near Pragati Maidan and Indraprastha, or the Yellow Line through Chandni Chowk, Rajiv Chowk and Central Secretariat, which links all three hero landmarks' districts.)
4. The architecture questions in `ARCH_OPTIONS.md` "Questions for the owner" (licences, signing, Windows testing, the inspector, animation, the hero road list).

## 10. Pipeline choices (architecture discovery, P0-010)

The full comparison with options, costs, risks and the measured numbers (P0-020) is in [`ARCH_OPTIONS.md`](ARCH_OPTIONS.md) section 8 (world layers), section 4 (composite map) and section 7 (inspector). This is the recommended pipeline in one place. All of it runs in the offline bake (`tools/bake/`, Node and TypeScript) after map repair; the game reads the result from the tiles.

### Landmark registry pipeline

1. **Sources and matching (Rec LM1).** Join on ids, not names: OSM objects carry a `wikidata` tag; Wikidata gives coordinates, era, height, heritage status and the ASI monument id. Name and distance matching is only a fallback, and every fallback match is flagged. Heroes and signatures come from Anmol's list and are checked by hand. The registry is built per district, from the district clip plus the far landmarks.
2. **Storage (Rec LS2).** `harness/data/landmarks/<id>.json` per hero and signature, `landmarks_markers.json` generated, `landmarks.overrides.json` for edits. Same schema as section 1, plus `district` and `far`.
3. **Tier scoring.** A score proposes the tier (named by Anmol, ASI listed, Wikidata sitelinks, footprint size, seen from an arterial or a hero road). Anmol's list and inspector edits win.
4. **Placement (Rec LP2).** Inside a clip: district offset plus the projected position in the district frame, on a flattened pad, replacing the repaired buildings in its zone (logged). Outside every clip: a far landmark on the backdrop, placed by its real bearing from the nearest district, as a silhouette. A far landmark is never a place the player can reach, and the map does not mark it as one.
5. **Hero models (Rec HM2).** Up to 8 parts per hero, up to 25,000 triangles each, up to 6 materials in all, 3 LODs per part, one far silhouette under 2,000 triangles. LODs are made with Blender in background mode (it is installed on this Mac) or meshoptimizer. The ingest tool gets a hero rule with these limits.
6. **Stand-in parts kit (HM3 as the placeholder).** Domes, chhatris, arches, colonnades, minarets, shikharas and slabs, driven by the registry fields. It is the stand-in for every hero until its model arrives, and the final build for the signature tier.
7. **Checks.** The Wikidata point lies inside the OSM footprint or within 50 m of its centre, or the entry is flagged (measured on the pilot: 21 of 69 are over 50 m by centre alone, 8 of 46 with a footprint; Red Fort is 76 m off only because the site is large); the position test in the block frame; the relative layout test.

### Area profile pipeline

1. **Area division (Rec AD2).** Claude draws 3 to 8 area polygons per focus district along roads and rail, seeded by OSM land use and colony outlines, with the 100 m feature grid as evidence. Anmol edits them in the inspector. In-between areas of the seamless centre get an archetype profile by rule first (from land use and the footprint grid) and a hand-drawn polygon when they become a focus district. Generated city along corridors blends the profiles of its two neighbours.
2. **Profile storage (Rec PS1).** Archetype defaults, a small file per area with only what differs, and an overrides file for inspector edits. Every value has an evidence line. The `wear` value (0 to 1) drives the grime layer of look B+D.
3. **Generator at bake time (Rec AG1).** Parcels, building shells, facade module placements, street dressing and colliders are written into the tiles. Only life (people, vendors, animals, parked two-wheelers) is spawned in the game, from seeded points in the tile.
4. **Kits and atlases (Rec KT2, TX1).** Procedural modules first, replaced module by module through ingest. One Texture2DArray and one trim and decal atlas per kit. Fixed module ids.
5. **Edge blending and seeds (Rec EB1).** Inside each area's blend band the generator mixes the two profiles by distance, shorter at roads and rail. One seeded random generator, written once in the bake; every pick is seeded from the district id and a parcel id made from the footprint, so a rebake gives the same city.
6. **Checks.** The area difference metric, variety inside an area, smooth edges on transects, and the respect rule read by the verifier (section 6).

### Inspector views

Rec IV1, built in the order of IV3: one page with layers. Issues and lanes first; then hero roads beside their reference photos and the districts with their connectors; then the area view (map coloured by area, profile fields with evidence, a generated block preview, edit controls) and the landmark view (tier icons, fly to, registry entry, flags). Every edit writes an override file and an inbox entry with source `inspector`.

### What the benches measure for these layers

- P0-016 (`harness/reports/arch/render.json`): the area kit block as MultiMesh modules against merged meshes; the crowd.
- P0-018 (`world_sources.json`, `landmarks_pilot_draft.json`): the licence of every landmark and area source, the pilot landmark census with the OSM to Wikidata distances, and which area sources cover the pilot.
- P0-029 (`stitch.json`): landmark position error in the district frame, and the layout inside a district against reality.

