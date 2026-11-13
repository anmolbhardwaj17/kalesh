# Delhi Metro: viaducts, stations, entrances, tunnels

Tags: [S] source, [P] read from a photo in img/, [E] estimate (see README.md). Written 2026-11-13.

The metro is the most consistent structure family in Delhi: one owner (DMRC), a house style, and a small set of parts. In the pilot, five lines meet: Red Line (elevated, partly at grade), Yellow Line (deep underground), Blue Line (underground at Rajiv Chowk, elevated east of Mandi House over the railway and the Yamuna), Violet Line (underground, the "Heritage Line" between ITO and Kashmere Gate) and the Airport Express (underground from New Delhi station) [S: Wikipedia; OSM]. A future Magenta Line extension (RK Ashram Marg to Indraprastha, deep tunnel, layer -5) is under construction [S: OSM].

Gauge: the first lines (Red, Yellow, Blue) are 1,676 mm broad gauge because the Railway Ministry required it; the newer lines (Green, Violet, and others) are 1,435 mm standard gauge [S: Wikipedia Delhi Metro]. The Airport Express is standard gauge [E].

## MET-VB1 Phase I elevated viaduct (single box girder, Y piers)

- **Where.** Red Line east of Kashmere Gate: Tis Hazari and Pul Bangash end, over the Yamuna to Shastri Park (OSM "Delhi Metro Red Line", layers 2 and 3, bridge, about 25 km of way in the data) [S: Wikipedia Red Line opened 24 December 2002; OSM]. Phase I is also the older Blue Line viaduct east of Barakhamba Road.
- **Shape.** A single box girder carries both tracks, curved in plan, supported by round or oval tapered piers that flare into a wide Y or T shaped cap beam; piers 1.4 to 1.8 m wide, spans 25 to 30 m, deck about 9.5 m wide, soffit 6 to 7.5 m above the road [P: metro_viaduct_red_line_gulabi_bagh.jpg] [E].
- **Edge.** Concrete parapet with a bold sloped face; on the road below, black and white painted kerbs, striped yellow and black end walls; lamp poles on the median; green creepers and planters at the pier foot [P].
- **Colour.** Grey concrete #8c8a85, lighter than flyovers; faint soot band at the soffit edge; no paint on piers, except murals where schools painted mosaics on some pillars [S: Wikipedia Delhi Metro art].
- **Rail on top.** Ballastless track on plinths (slab track) with 1,676 mm gauge and 25 kV overhead catenary on masts every 30 m or on gantries at stations [E].
- **Wear.** 0.2: clean grey, slight staining.

## MET-VB2 Phase II and III viaduct (twin U girders)

- **Where.** Blue Line east of Mandi House toward Indraprastha and the Yamuna, the later extensions, and everything beyond the pilot. In the pilot, the OSM Blue Line elevated way is layer 2 bridge, plus a short ramp piece at layer 1 [S: OSM].
- **Shape.** Standard spans are 28 m twin U girders, each U carrying one track (the tender: "Standard spans for viaduct shall be 28 m Twin U-Girder Spans") [S: DMRC tender snippet]. Single column pier at least 1.8 m diameter in the viaduct and at most 2.2 m across in station spans [S: same]. U girders weigh about 11 t/m, pier cap 4 m wide for a twin U versus 6 to 7 m for a single box [S: Indian Concrete Journal snippet]. Portal piers (two columns and a cross beam) at road crossings with a clear span of 12 to 19 m, maximum height about 16 m [S: snippet]. Special spans 37 to 45 m [S: snippet].
- **Look.** Two parallel curved U shaped troughs, outside faces vertical and smooth with an inset parapet, a gap between the troughs where an emergency walkway or cable duct lies; pier caps with pocket bearings; crash barrier on the road median at the pier [E].
- **Wear.** 0.1 to 0.3; some piers painted with a mural band or covered with green walls [S: DMRC art note].

## MET-VB3 Special river and railway spans

- **Blue Line extradosed bridge.** The Blue Line has "India's second extradosed bridge across the Northern Railways mainlines near Pragati Maidan" and crosses the Yamuna between Indraprastha and Yamuna Bank [S: Wikipedia Delhi Metro]. In the pilot: the Blue Line layer 2 bridge ways near (28.622, 77.2475), 1 to 3 km of line in the data.
- **Look.** A low sculptural deck with short pylons above the deck and stay cables fanning to the girder, painted grey; cable spacing 4 to 6 m; clear navigational space under; the Yamuna section on 40 to 60 m spans with round pier shafts and rounded cutwaters [E].
- **Violet Line reference.** The elevated Violet Line (outside the pilot) has a 100 m bridge over Indian Railways mainlines and a 167.5 m cable stayed bridge across a road flyover [S: Wikipedia].

## MET-RAMP Ramp and portal where the line leaves the tunnel

- **Where.** Blue Line near Mandi House (OSM "Blue Line" layer 1 bridge and layer 0 pieces, 710 and 571 m) and at RK Ashram Marg (28.6356, 77.2147) [S: OSM].
- **Look.** Cut and cover U trough between retaining walls, concrete portal beam with a DMRC blue panel, a fenced shaft, trackway still on plinths, ballast absent [E].

## MET-STN-EL Elevated station

- **Where in the pilot.** Supreme Court (Pragati Maidan), Indraprastha, RK Ashram Marg on the Blue Line (computed from OSM: nearest line is elevated) [S: OSM]; Tis Hazari and Pul Bangash on the Red Line; the box includes "Shastri Park" side stations just outside.
- **Structure.** Two levels over the road: a concourse level at about 6 to 7 m, platform level above (a generic metro description of concourse plus platform, [S: NBM and CW snippet]); platform 12 to 13.5 m above ground [S: Construction World snippet, project not identified]; platform length 140 to 185 m for 6 to 8 coaches (185 m is the only figure found, on another project) [S/E]. Roof: a long curved or sloped metal sheet roof in grey or silver over the platform, deep eaves, full width glass or perforated screens with steel columns [E].
- **Entrance.** A street level kiosk with an escalator, stair and lift: a blue fascia sign (Hindi and English), granite clad plinth (grey and maroon granite), steel and glass canopy, a grille boundary fence, bus-shelter style furniture [P: metro_ashram_entrance_flyover.jpg].
- **Platform edge.** Platform edge doors on newer stations, a yellow safety line 1 m from the edge, tactile strips; side walls stainless steel railings after the 2024 Gokulpuri wall accident [S: Wikipedia Delhi Metro].
- **Signs.** The roundel station sign: blue ring and red ring around a white disc with the station name in Hindi (blue band) and English, a line colour stripe [P: Commons "Civil Lines (Delhi) metro station.jpg", CC BY-SA 4.0 Santosh4118, not saved here: https://commons.wikimedia.org/wiki/File:Civil_Lines_(Delhi)_metro_station.jpg].

## MET-STN-UG Underground station

- **Where.** Rajiv Chowk (Blue and Yellow interchange; the OSM footprint way 1158884368 is in `harness/data/underground.json`), New Delhi, Chawri Bazar, Chandni Chowk, Patel Chowk, Central Secretariat, Janpath, Barakhamba Road, Mandi House, ITO, Delhi Gate, Jama Masjid, Lal Quila, Airport Express terminal [S: OSM, bake].
- **Depth and size.** Chawri Bazar is India's second deepest metro station at 25 m below ground [S: Wikipedia]. A standard underground station platform is 225 m long (another station is 289 m, and the smallest on the Pink Line 151.6 m) [S: Hindustan Times and Construction World snippets]. Rajiv Chowk is the second busiest station, about 216,000 passengers a day (October 2023) [S: Wikipedia].
- **Look.** A long white box: flat ceiling of white metal panels with linear LED strips in a grid, black cable trays, side walls in white or grey cladding panels with vents, polished stone floor with stripes, rectangular columns clad in the same panels, a central stair and lift core in glass and steel [P: metro_underground_station.jpg]. Rajiv Chowk platform: lower ceiling with warm lit yellow panels, LED destination boards in amber (Hindi and English), crowds, platform edge with yellow line [P: metro_rajiv_chowk_platform.jpg].
- **Art.** Rajiv Chowk has the Nobel Memorial Wall with portraits of seven Indian laureates; INA station an art gallery; heritage panels on the Central Secretariat to Qutub Minar section [S: Wikipedia]. The Violet "Heritage Line" stations (Lal Quila, Jama Masjid, Delhi Gate, ITO side) carry local design themes [S: Wikipedia names the line; E for the looks].
- **Entrances.** Many each, stair and escalator from street kiosks like MET-STN-EL, plus connections into Palika Bazaar and the CP subways [S: Square Yards snippet on Rajiv Chowk gates 2, 3 and 6 leading into the inner circle and Palika Bazaar].
- **Wear.** 0.05 to 0.2: clean, polished, stainless.

## MET-TUN Metro running tunnel (between stations)

- **Where.** Violet Line (4 ways, about 14 km of way in the data), Yellow Line, Blue Line, Airport Express (OSM subway, tunnel=yes, layers -1 to -5) [S: OSM].
- **Look.** A round bored tunnel about 5.6 m inside diameter, or a box where cut and cover: pale grey precast concrete rings, twin tracks on a concrete plinth with slab track, a walkway on one side with a handrail, cable trays on the wall, lights every 15 m, emergency exits every 750 m [E]. Seen by the player only through a ramp portal or a station window, so keep it cheap.

## Pilot line list for the kit

| Line | Gauge | Mode in pilot | Variants |
|---|---|---|---|
| Red | 1,676 mm | elevated and at grade | VB1, STN-EL |
| Yellow | 1,676 mm | underground, deep | STN-UG, TUN |
| Blue | 1,676 mm | underground to RK Ashram, elevated east of Mandi House | VB2, VB3, RAMP, STN-EL, STN-UG |
| Violet | 1,435 mm | underground (Heritage Line ITO to Kashmere Gate) | STN-UG, TUN |
| Airport Express | 1,435 mm [E] | underground New Delhi to Shivaji Stadium | STN-UG, TUN |
| Magenta ext. | 1,435 mm [E] | construction, deep | none yet |

## Sources

- Wikipedia Delhi Metro (read 2026-11-13): https://en.wikipedia.org/wiki/Delhi_Metro (phases, gauges, art, accidents, Yamuna crossings, the extradosed bridge).
- Wikipedia Violet Line, Airport Express, Rajiv Chowk station (read 2026-11-13): https://en.wikipedia.org/wiki/Violet_Line_(Delhi_Metro), https://en.wikipedia.org/wiki/Airport_Express_(Delhi_Metro), https://en.wikipedia.org/wiki/Rajiv_Chowk_metro_station
- DMRC tender and Indian Concrete Journal viaduct notes (search snippets 2026-11-13): https://news.railanalysis.com/?p=50384, https://www.icjonline.com/static/downloads/pdf/concrete-bridges/section-13/3.pdf, https://nbmcw.com/product-technology/precast/elevated-corridors-for-metro-road-connectivity.html, https://www.constructionworld.in/articles/other/Strong-Connection/21123
- Hindustan Times and Construction World station platform lengths (snippets): https://www.pressreader.com/india/hindustan-times-delhi/20180409/281603831040273, https://www.constructionworld.in/transport-infrastructure/metro-rail-and-railways-infrastructure/aerocity-metro-station--longest-platform-on-delhi-s-silver-line/41842
- OSM and bake: harness/data/underground.json, variant_map.md.
- Photos: `img/metro_viaduct_red_line_gulabi_bagh.jpg` (Ravik, public domain, 2007), `img/metro_underground_station.jpg` (Sd280391, CC BY-SA 3.0, 2012), `img/metro_rajiv_chowk_platform.jpg` (Immanuelle, CC BY 4.0, 2024), `img/metro_ashram_entrance_flyover.jpg` (Santosh4118, CC BY-SA 4.0, 2022). Credits in img/CREDITS.json.
