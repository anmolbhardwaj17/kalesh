# Indian Railways: track, platforms, stations, yards, halts, level crossings

Tags: [S] source, [P] read from a photo in img/, [E] estimate (see README.md). Written 2026-11-13.

Metro viaducts are in `metro.md`; rail bridges (Loha Pul, underbridges, the rail cut under a road) in `bridges.md`. This file is the ground-level railway: the permanent way, the platforms and the yards of Northern Railway in the pilot. About 127 km of rail way is in the baked pilot (420 rail features) [S: harness/reports/map/health.json graph counts].

## RAIL-BG Main line and yard track (broad gauge)

- **Where.** The Howrah and Mumbai lines into New Delhi and Old Delhi, the yards at both stations, the lines to Tilak Bridge, Shivaji Bridge, Pragati Maidan and Sadar Bazar. Baked as OSM `railway=rail` ways: "Mumbai - Delhi Railway" (19 ways, 10.2 km), "Howrah - Delhi Railway" (21 ways, 9.2 km) and 327 unnamed ways (yard tracks, about 105 km) [S: bake].
- **Track structure.** Gauge 1,676 mm (5 ft 6 in) [S: Wikipedia Delhi Metro mentions the Railways broad gauge]. Rails 52 or 60 kg/m, 60 kg on the main corridors [S: IIT Kanpur SATHEE railway notes, snippet]. Prestressed concrete sleepers (PSC), about 2.75 m long, spaced 60 to 65 cm, so 1,540 to 1,660 per km [S: snippet, sources differ]. Ballast: crushed stone, 250 to 300 mm under the sleeper, shoulder 350 mm wide, a trapezoid bed about 4.5 m wide at the top [S for depth, E for the rest]. The rail head stands about 0.2 m above the top of the sleeper [E].
- **Track centres.** About 5.3 m on the main line, 4.3 m in yards (the minimum of the schedule of dimensions) [E].
- **Overhead line (25 kV AC).** Contact wire at 5.2 to 6.5 m above rail level (nominal about 5.6 m) [S: snippet]; steel masts on both sides or portal gantries over the yard, spaced about 54 to 58 m on straights [E]; catenary wire plus contact wire, cantilever arms with white porcelain or grey polymer insulators [P: rail_delhi_junction_track_ohe.jpg].
- **Colours.** Ballast grey-brown, sleepers pale grey concrete with dark oil stains, rails rust brown with a bright steel running surface, masts dull grey galvanized, weeds green between the tracks in the yard, trash and plastic along the shoulder [P].
- **Signals.** Coloured light signals on tall masts or low shunt signals on the ground, point motors, point indicators, a signal cabin in the yard [E].
- **Wear.** 0.6 to 0.8 outside the platform zone; clean and swept at the platform.
- **Kit.** Track module (two rails, PSC sleeper every 0.6 m, ballast trapezoid), a switch module, OHE mast, portal gantry, signal mast, cable trough, weed and trash decals.

## RAIL-PLAT Platforms and roofs

- **Facts.** High level platform: top 760 to 840 mm above rail level, platform face 1,670 to 1,680 mm from track centre (Schedule of Dimensions, broad gauge) [S: IR SOD copies, snippet]. Platform width 4 m (side) or 6 m (island) minimum [S: Works Manual summary, unverified]. New Delhi station has 16 platforms [S: Wikipedia]. Old Delhi has 18 platforms, two of them long enough for two 24-coach trains end to end [S: Wikipedia].
- **Look.** Asphalt or cement concrete floor with a yellow-white safety line 1 m from the edge, a brown-grey coping stone at the edge, steel columns every 6 to 8 m carrying a continuous long roof of blue profiled sheets (sloped, steel frame, deep eaves), numbered platform boards (yellow with black text), hanging train information displays, benches, water kiosks, trolleys. Coaches red-maroon or blue with white stripes depending on the service [P: rail_new_delhi_platform_roofs.jpg, rail_delhi_junction_track_ohe.jpg].
- **Roof blue.** Approximately #2f6fb4, weathered to grey blue at the edges.

## RSTN-NDLS New Delhi station (hero yard)

- **Where.** North of Connaught Place, at Paharganj and Ajmeri Gate [S: Wikipedia]. OSM station node 6131069513 and way 463710713 "New Delhi Railway Station (Ajmeri Gate)"; platforms 1 to 16 as OSM platform ways [S: OSM].
- **Facts.** Primary hub of the capital, 16 platforms, more than 400 trains a day [S]; the single platform station of 1926 to 1956 became today's [S]; a new three-storey 9,000 m2 building on the Ajmeri Gate side opened September 2009 [S]; a ₹2,469 crore redevelopment is planned (target January 2029) with new buildings on both sides, seven flyovers around it and two vehicle tunnels [S]. The 242 m skywalk joins the foot over bridge to the metro [S]. Route Relay Interlocking, a Guinness world record in 1999 [S].
- **Paharganj side.** Older red-brown brick and plaster facade, a forecourt for autos, porters, a ramp and a road flyover overhead; the Ajmeri Gate side shows the 2009 building, glass and steel with a stone frieze [E].
- **Foot over bridge.** A steel arched skeleton FOB crossing the road forecourt (see `foot_over_bridges.md`).

## RSTN-OLD Old Delhi (Delhi Junction)

- **Where.** Near Red Fort and Chandni Chowk, OSM station node 913095905 "Delhi Junction", at (28.661, 77.2277) [S: OSM].
- **Facts.** The present building was built 1900 to 1903 in red sandstone to match the Red Fort, with two platforms at opening; remodelled 1934 to 1935; 18 platforms today, four pit lines for washing trains [S: Wikipedia].
- **Look.** A red sandstone and brick Mughal-revival facade with domed turrets and arches, long forecourt, clock tower, the 1990s Kashmere Gate side entrance, platform roofs in blue sheet [E, plus P for the platform roofs].
- **Level crossings.** Ten OSM level crossing nodes around (28.661, 77.2317) and two at (28.662, 77.230) are yard crossings used by staff and pedestrians across the tracks [S: OSM].

## RSTN-HALT Suburban halts: Pragati Maidan, Tilak Bridge, Shivaji Bridge, Sadar Bazar

- **Where.** Node ids in variant_map.md. Pragati Maidan halt has 2 platforms; Tilak Bridge 4 platforms, built 1924 as Hardinge Bridge, with new 5th and 6th lines and platforms being added; Shivaji Bridge (code CSB) 4 platforms, named for the Minto/Shivaji Bridge nearby; Sadar Bazar [S: Wikipedia].
- **Look.** Low concrete platform 100 to 200 m long, a small station building in beige or yellow paint with a tin or sheet roof, steel foot bridge, a few benches, a sodium lamp, name boards in Hindi, English, Urdu on yellow, deep weeds at the edge, sparse crowd [E].
- **Kit.** Compact platform kit without the long roof: shelter every 40 m.

## RAIL-RING Delhi Ring Railway

- **Facts.** A 35 km loop with 21 stations, laid in 1975 as the Delhi Avoiding Line, running parallel to the Inner Ring Road, about 3,700 passengers a day in total; operating 8 am to 7 pm; a plan to join it to the metro [S: Wikipedia]. In the pilot the line runs at Pragati Maidan (OSM, 2 ways, 866 m, at (28.617, 77.247)).
- **Look.** Single or double track on an embankment, minimal fencing, sleepers half buried in weeds, concrete poles, little traffic; use it for the "quiet edge" railway [E].

## RAIL-LC Level crossings

- **Where.** OSM `railway=level_crossing` nodes: 27 in the pilot, in clusters at Delhi Junction (12), Sadar Bazar (9), Pragati Maidan (2), RK Ashram side (2), Tilak Bridge (2) [S: OSM, see variant_map.json]. Most are pedestrian crossings of yard tracks and platform ends, not road gates.
- **Look.** A raised rubber or concrete panel between rails, a pedestrian crossing sign, bells, a barrier arm with red-white stripes if a road, a gate keeper's hut with "Gate" in white on red, warning boards "Stop Look Listen" [E].

## RAIL-DIS Disused spurs

- **Where.** "Rajghat Power Plant Feeder Line" (2.2 km) and "Indraprastha Power Plant Feeder Line" (0.66 km) (OSM, `railway=disused`) plus an abandoned spur near (28.618, 77.249) [S: OSM].
- **Look.** Overgrown ballast, rusty rail visible in grass, rails cut where the road crosses, sleepers half buried, no overhead line [E].

## Boundary walls and fences

- Railway boundary: brick or RCC wall 1.8 to 2.5 m high with barbed wire along the top, white-painted numbered stones every 50 m, and a "No Trespassing" board; behind it, rows of jhuggis in some places (portray with dignity) [E].
- Under bridge portals: yellow-black hazard stripes on pier faces.

## Sources

- Wikipedia New Delhi railway station, Old Delhi railway station, Delhi Ring Railway, Tilak Bridge, Shivaji Bridge, Pragati Maidan stations (read 2026-11-13): https://en.wikipedia.org/wiki/New_Delhi_railway_station, https://en.wikipedia.org/wiki/Old_Delhi_railway_station, https://en.wikipedia.org/wiki/Delhi_Ring_Railway, https://en.wikipedia.org/wiki/Tilak_Bridge_railway_station, https://en.wikipedia.org/wiki/Shivaji_Bridge_railway_station, https://en.wikipedia.org/wiki/Pragati_Maidan_railway_station
- Indian Railways Schedule of Dimensions BG, revised 2022 (search result, document not opened): https://indianrailways.gov.in/railwayboard/uploads/directorate/civil_engg/2024/ACS%20no_%203%20to%20IRSOD%20Revised%202022.pdf; summary copies at https://rskr.irimee.in/sites/default/files/SOD-EXPLANATION.pdf (snippet: platform height 760 to 840 mm, edge distance 1670 to 1680 mm).
- Track components (SATHEE, IIT Kanpur; search snippets): https://rrb.iitk.ac.in/sathee-railway-exams/student-corner/railway-gk/track-engineering/track-components and https://sathee.iitk.ac.in/sathee-railway-exams/student-corner/railway-gk/indian-railway-features/technical-specifications. These are exam preparation pages: figures disagree (sleeper spacing 60 to 75 cm, ballast 250 to 350 mm); take them as ranges.
- OSM and bake: variant_map.md.
- Photos: `img/rail_new_delhi_platform_roofs.jpg`, `img/rail_delhi_junction_track_ohe.jpg` (Ravi Dwivedi, CC BY-SA 4.0, 2022). Credits in img/CREDITS.json.
