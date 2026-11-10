# Dilli Darshan: City research brief (Delhi)

Filled from interview sitting 1 (2026-11-10, inbox source "interview") and Anmol's direction messages (inbox mmwaowrf4, mmwapw3co, mmwarg8cw). Anything not from Anmol is general research marked "to confirm" until a reference photo set or Anmol confirms it. No real brand names or logos, no real political parties (invented parties only, Anmol), no real people. Every number is an estimate unless it names a source.

Owner's one-line picture of the place: "Delhi must look like Delhi, area by area." (inbox mmwapw3co). And: "the city should be in delhi, on top of that map, we can have a lot more things" (inbox mmwaqyyxq).

The map is a compressed Delhi: real districts at true scale inside, moved closer, joined by authored connector roads (decisions.md "Engine Godot 4, and a compressed Delhi map"; DELHI_WORLD.md section 0). Size: "smaller than gta5 but not too small to feel boring and not vast" (inbox mmwartrys). The district list and layout are confirmed in P0-028 and sitting 2.

## Districts and route

From Anmol's place answer (inbox mmwarq9we): "Central core, Old Delhi, East Delhi across Yamuna, South + Gurgaon + airport. All these are there but i want some dark places too which are famous for some stories ... so missions can be there".

| District (Anmol's list) | What it looks like (to confirm with references) | Look notes | Kit |
|---|---|---|---|
| Central core: Connaught Place, India Gate and Kartavya Path, ITO, Pragati Maidan, Jantar Mantar, Khan Market, Lutyens | White colonial colonnades in two rings (CP); wide tree-lined avenues and roundabouts; government blocks and stacked flyovers (ITO); low white bungalows behind walls (Lutyens) | Clean, planned, green; wear low | CP colonnade, Lutyens bungalow road, ITO institutional |
| Old Delhi: Chandni Chowk, Red Fort, Jama Masjid, GB Road | Tight shop houses three to five floors, stacked shop boards, tangled wires, galis 2 to 4 m wide, cycle rickshaws, handcarts, crowds | Grime high (Anmol: D's dirt on Old Delhi) | Old city bazaar |
| East Delhi across the Yamuna: Laxmi Nagar, Shahdara side | Dense builder floors and markets, Metro on pillars over the main road, bridges over the river | Wear medium (to confirm). Anmol: "famous for cheap and drugs for certain mission and life of game" (inbox mmwarg8cw): shown with the respect rule | Dense residential market (to confirm) |
| South plus Gurgaon plus the airport: Vasant Kunj, Hauz Khas, Qutub area, NH-48, Cyber City, IGI | Mixed: DDA flats and gated societies, malls, glass towers in Gurgaon, a wide expressway to the airport | Clean to medium wear; glass and concrete in Gurgaon | Gated society, glass tower business district, mall |
| Story places Anmol named | GB Road, Jantar Mantar (protests), Vasant Kunj, Delhi Gymkhana, the Delhi Golf Club, Khan Market, "some horror story place" | Each is a mission place; see Landmarks | |

Route idea (proposal, P0-028 decides the layout): Ring Road and Outer Ring Road arcs join the districts, NH-48 runs south to Gurgaon and the airport, the Yamuna bridges (ITO barrage area, Signature Bridge) join East Delhi, flyovers at ITO and Pragati Maidan.

Rules for builders: each district has its own area kit and a `wear` value; edges between districts blend over a band, never a hard line. Filler between districts is generated ordinary city, never labelled as a real place.

## Landmarks

Tier rule from DELHI_WORLD.md section 1: hero (detailed model, recognised at driving speed), signature (right silhouette and colour), marker (right footprint and massing). "Named by" says who put it on the list. Tiers for anything not named a hero by Anmol are proposals.

| Landmark | Named by | Proposed tier | Why it matters | District | References |
|---|---|---|---|---|---|
| Connaught Place circle | Anmol (first heroes) | hero | The heart of New Delhi; colonnaded rings; pilot area | Central core | Wikimedia "Connaught Place at night" (look board); more to collect |
| India Gate | Anmol (first heroes) | hero | National icon at the end of Kartavya Path; skyline marker | Central core | to collect |
| Red Fort | Anmol (first heroes) | hero | Old Delhi's anchor; huge red sandstone walls facing Chandni Chowk | Old Delhi | to collect |
| Jantar Mantar | Anmol (story place: protests) | signature | Protest site and 18th century observatory; missions with crowds | Central core | to collect |
| GB Road | Anmol (story place) | area street, no landmark model | A known dark story place. Story and atmosphere only, no sexual content, no exploitation of real people (decisions.md "Speeds and map size") | Old Delhi | to collect with care |
| Vasant Kunj | Anmol (story place) | area (marker buildings) | Wealthy South Delhi colony and malls; contrast with Old Delhi | South | to collect |
| Delhi Gymkhana Club | Anmol (story place) | signature | Elite club in Lutyens Delhi; missions with power and money | Central core | to collect |
| Delhi Golf Club | Anmol (story place) | marker (grounds) plus signature clubhouse | Green elite space; old tombs inside the grounds (to confirm) | Central core | to collect |
| Khan Market | Anmol (story place) | signature | Upmarket market; contrast with Chandni Chowk | Central core | to collect |
| A haunted place | Anmol ("some horror story place") | signature | Night missions and atmosphere. Which one is open: candidates Agrasen ki Baoli (near CP), Khooni Darwaza (near ITO), Malcha Mahal (Ridge forest), Bhuli Bhatiyari ka Mahal (Ridge) | to pick | to collect |
| IGI Airport | Anmol (place list, mmwarg8cw) | signature (terminal) | Entry to the city; arrivals and chases | South | to collect |
| Yamuna bridges (ITO area, Signature Bridge) | Anmol (Yamuna, mmwarg8cw) | signature | The river divides the map; bridges are chase choke points | Connector | to collect |
| Jama Masjid | Anmol's direction list (mmwapw3co) | hero later (proposal) | Old Delhi skyline next to Chandni Chowk | Old Delhi | to collect |
| Qutub Minar | Anmol's direction list | hero later (proposal) | South Delhi skyline marker | South | to collect |
| Humayun's Tomb | Anmol's direction list | hero later (proposal) | Mughal garden tomb | South-central | to collect |
| Lotus Temple, Akshardham | Anmol's direction list | signature (proposal) | Modern icons; Akshardham sits in East Delhi | South, East | to collect |
| Rashtrapati Bhavan | Anmol's direction list | signature (proposal; hero only if missions need it) | Head of Kartavya Path | Central core | to collect |
| Lodhi Garden tombs, Hauz Khas | Anmol's direction list | signature | Parks and ruins for on-foot missions | South-central | to collect |
| Metro stations of the pilot line | Anmol's direction list | signature kit per station style | Navigation and chases | All | to collect |
| Major markets, stadiums, malls | Anmol's direction list | marker by default | Massing and material only | All | from OSM |

Rules for builders: a landmark sits at its real position inside its district frame (district offset plus projected position) and its real orientation. Heroes get a procedural stand-in from the parts kit until the model card arrives. Places of worship only where they really are, built with the same care as any landmark. No real people on posters or statues beyond the monument itself.

## Road types

Research, to confirm with references and the repaired map (MAP_REPAIR.md has the lane model):
- Arterial roads: 6 to 8 lanes with a raised median (painted kerb stones, often black and yellow), service lanes on the side in many places, bus stops in the kerb lane.
- Flyovers and underpasses at most big junctions (ITO, Pragati Maidan); centre lanes climb, service lanes stay at grade (Anmol's lane-level model, inbox mmwaoz9kb).
- Roundabouts in Lutyens Delhi; CP has radial roads into two rings.
- Colony roads: 2 lanes, parked cars both sides, speed breakers.
- Old Delhi galis: 2 to 4 m wide, no lanes, shared with handcarts, cycle rickshaws, scooters and people.
- Surfaces: asphalt with patches and potholes, concrete on some flyovers, dirt shoulders, broken footpaths, open drains with covers in old areas.
- Barriers: concrete jersey barriers, steel railings on medians, police barricades (movable).
- Lane discipline: loose; horns constant; vehicles fill every gap.

Rules for builders: road width comes from the lane model, never eyeballed. Kerb and median paint, potholes and patches are decals and data, not modelled per road.

## Signage and script

- Scripts (to confirm): Devanagari (Hindi) and Latin (English) on almost every sign; many official signs in Delhi also carry Gurmukhi (Punjabi) and Urdu. Shop boards mostly English and Hindi, often both.
- Road signs: green direction boards on arterials, blue on some city roads (to confirm with photos).
- Shop boards: flex prints stacked one above the other in markets, hand-painted boards in old areas, glowing signs at night.
- Walls: painted ads, posters (invented parties only, Anmol), coaching centre ads (invented names).
- Word list: to collect, every phrase checked by Anmol or a reference before use.

Rules for builders: all names invented; no real brands, parties or people. Text renders from a font set that covers the scripts above, with free licences that allow a public release.

## Vehicles

Research, to confirm. Speeds from decisions.md "Speeds and map size" (est).

| Vehicle | Share of traffic (est, to confirm) | Look | Top speed in game (est) | Player |
|---|---|---|---|---|
| Two-wheelers (scooters, motorcycles) | very high | Many colours, often two riders | 90 km/h (scooter) | Fixer (proposal) |
| Cars (hatchbacks, sedans, SUVs) | high | White, silver, grey most common | about 140, fast cars 180 to 200 (rare) | Any |
| Auto-rickshaws (CNG) | high | Green body, yellow roof | about 65 | Driver |
| E-rickshaws, cycle rickshaws | medium in old areas | Battery rickshaws, pedal rickshaws | slow | |
| Buses | medium | City buses in several liveries (to confirm current colours) | | |
| Trucks, tempos, handcarts | low in the core, more at night and on outer roads | Decorated trucks | | |
| Police vehicles | low | Delhi Police patrol vans and cars (livery to confirm; question below) | about 140 | Cop |

Rules for builders: autos are the colour accent of the city. Liveries are invented or generic; no real company names.

## Street life

- People of every age, gender and community, in what people really wear (respect rule, DELHI_WORLD.md section 3). Crowds dense in Old Delhi and markets, thin in Lutyens.
- Vendors and stalls, chai stands, fruit carts, cycle repair, puncture shops.
- Animals: stray dogs everywhere, cows on some roads, monkeys near Lutyens and Ridge areas (to confirm by area).
- Wires and cable bundles, water tanks on roofs, washing lines, construction and scaffolding.
- Real conditions shown honestly (Anmol: "i want to show some part of it as its actually true"): roadside homes, rag pickers, crowded settlements exist where they really are, shown with the same craft as rich areas, never as spectacle or a joke, never the city's only face.

Rules for builders: life density comes from the area profile, not from one global number. No group defined by one costume, job or behaviour.

## Weather, light and time of day

| Time | Sun colour and height | Sky | Haze or smog | Shadows | Mood |
|---|---|---|---|---|---|
| Hot hazy afternoon (test preset, Anmol) | White-yellow, high (55 to 70 degrees, est) | Pale, washed out near the horizon | Heavy dust haze, distant buildings fade by 600 to 900 m (est) | Short, hard | Heat, glare, energy |
| Golden evening (test preset, Anmol) | Deep orange, low (5 to 15 degrees) | Warm gradient, dusty pink | Haze glows with the sun | Long, warm | Warm, cinematic, the city's best hour |
| Night (later) | Sodium orange street lights, white LEDs on new roads, sign glow | Brownish sky glow | Light smog halos | Pools of light | Busy, alive |
| Winter fog (later) | Grey, sun barely visible | White | Very heavy fog, 30 to 100 m visibility (est) | None | Quiet, eerie; good for the haunted place |
| Monsoon (later) | Grey light | Dark clouds | Rain, wet roads, flooding underpasses | Soft | Chaos on the roads |

Rules for builders: the two test presets are the first lighting presets; others come after the style sign-off.

## Materials

Research, to confirm with reference photos. Palette hex values are first estimates to resample from references.

| Material | Where | Hex (est) |
|---|---|---|
| Red sandstone | Red Fort, Mughal monuments, some Lutyens buildings | #A4533B |
| Buff sandstone | Lutyens buildings, India Gate | #C9A77C |
| White painted plaster | CP colonnades, Lutyens bungalows | #E8E3D5 |
| Lakhori brick and lime plaster | Old Delhi shop houses | #8F5E45 brick, #D8CDB4 plaster |
| Faded painted plaster (mint, pink, ochre) | Old Delhi and East Delhi | #9EC3A8, #D9A79A, #D6A84E |
| Grey cement and concrete | Builder floors, flyovers | #8C8A84 |
| Glass and steel | Gurgaon towers, malls | #5E7A8A |
| Rolling steel shutters | Shops everywhere | #7A7D7E |
| Asphalt | Roads | #3E3D3A |
| Auto green and yellow | Autos (the city's accent) | #3FA36B, #F2C230 |
| Hazy afternoon sky | Sky near the horizon | #D9C9A6 |
| Sodium light | Night street lights | #FFA040 |

Wear: Old Delhi heavy (soot, stains, patched plaster, posters); planned areas light. The `wear` value per area drives it (STYLE_OPTIONS.md B+D).

Rules for builders: one atlas plus one trim sheet per area kit; wear in the shared shader and decals, not baked into every texture.

## Sound of the place

Research, to confirm: constant horns of many kinds, auto engines (two-stroke rattle in old ones, CNG hum), scooter buzz, bus air brakes, vendor calls, temple bells and the call to prayer only where those places really are, crows and pigeons, distant construction, music from shops, cricket commentary from a radio. Per district beds: Old Delhi dense voices and handcart bells, Lutyens birds and wind in trees, ITO traffic roar, Gurgaon air conditioning hum and traffic.

## References

| # | Reference | What it shows | Use for |
|---|---|---|---|
| 1 | Look board artifact https://claude.ai/artifact/Tfw397gkZcj3KCgkV2LdSP | Four game looks next to real Delhi photos | Style choice (STYLE_OPTIONS.md) |
| 2 | Chandni Chowk street, 2008 (Wikimedia Commons, credit Bahnfrend) | Wires, shop boards, crowds, dusty light | Old city bazaar kit |
| 3 | Connaught Place at night (Wikimedia Commons, credit Slyronit) | Colonnades, sodium light | CP kit, night preset |
| 4 | Delhi streets in the morning (Wikimedia Commons, credit Vinayaraj) | Autos, scooters, bollards, worn road | Traffic mix, road surface |
| 5 | Autos outside Purana Qila (Wikimedia Commons, credit Slyronit) | Auto colours, dusty ground | Vehicle colours |
| 6 | Pilot reference photo sets per area and hero | to collect (DELHI_WORLD.md section 6, side by side checks) | Verification sheets |

## Open questions for the owner

Answered in sitting 1 (no need to ask again): heroes (CP circle, India Gate, Red Fort), districts, story places, release (free, public), posters (invented parties only), map size feel.

Still open:
1. Which haunted place? a. Agrasen ki Baoli (near CP) b. Khooni Darwaza (near ITO) c. Malcha Mahal or Bhuli Bhatiyari ka Mahal (Ridge forest) d. A made-up one.
2. Police look: a. Close to the real Delhi Police uniform and vehicles b. A clearly invented city force with a similar feel.
3. Which heroes come after the first three? (Proposal: Jama Masjid, Qutub Minar, Humayun's Tomb.)
4. Which areas come first after the pilot? (P0-028 and P0-014 ask this with the district layout.)
5. Any phrases, shop names or memories of a place you want in the game?
