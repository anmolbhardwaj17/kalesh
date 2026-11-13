# Pilot variant map

Every tunnel, underpass, flyover, bridge, viaduct, rail and foot structure in the baked pilot, mapped to its variant. Written 2026-11-13 from `data/pilot_centre/graph.json` and `osm.json` (read only, nothing in the bake changed). The same data is in `variant_map.json` for tools.

Frame: "bake-local" metres, origin lat 28.612894 lon 77.229446 (the India Gate area), +x east, -z north, as in graph.json. The game map applies its own block offset and recentring (health.json `layout.blocks`), so convert through lat/lon or find a structure by OSM id, and use the bbox only inside the bake frame. The pilot is the centre block (21.8 km2); the four far blocks (Qutub Mehrauli, Vasant Kunj, airport T3, Cyber City) are not baked yet, see the last section.

Variant ids are defined in the kind files. Era and kind of each variant are inferred from the OSM name, class and place unless a source says otherwise; "verify" in a note means check a photo before the kit is final.

## Variant index

| Id | Variant | File |
|---|---|---|
| TUN-T1 | Pragati Maidan main tunnel (2022, mural walls, white LED) | tunnels.md |
| TUN-T2 | Pragati Maidan box underpasses (LMV and 2 lane) | tunnels.md |
| TUN-T3 | Basement and parking service tunnels | tunnels.md |
| TUN-T4 | Building passages, old city | tunnels.md |
| UND-U1 | Flyover-era road underpass, painted concrete, sodium | underpasses_subways.md |
| UND-U2 | Road under masonry rail arch (Minto Bridge) | underpasses_subways.md |
| SUB-S1 | Connaught Place outer circle subways | underpasses_subways.md |
| SUB-S2 | Palika Bazaar underground market | underpasses_subways.md |
| SUB-S3 | Standard civic pedestrian subway (white tile, mural panel) | underpasses_subways.md |
| SUB-S4 | Kartavya Path pedestrian underpasses (2022) | underpasses_subways.md |
| SUB-S5 | Station links and metro concourse corridors | underpasses_subways.md |
| FLY-T1 | Older T beam flyover, twin or portal piers, orange rail | flyovers.md |
| FLY-B1 | Newer precast box girder flyover, single pier | flyovers.md |
| FLY-R1 | Ramps, loops and approaches | flyovers.md |
| FLY-E1 | Elevated corridor on single pier (outside pilot) | flyovers.md |
| BRI-Y1 | Modern Yamuna road bridge (concrete girder) | bridges.md |
| BRI-Y2 | Cable stay (Signature Bridge, outside pilot) | bridges.md |
| RBR-Y1 | Loha Pul steel truss and Yamuna rail bridges | bridges.md |
| RBR-U1 | Rail bridge over road (arch or girder) | bridges.md |
| RBR-CUT | Railway cut under road | bridges.md |
| BRI-ROB | Road over rail and station flyover | bridges.md |
| BRI-MIN | Small service bridge | bridges.md |
| MET-VB1 | Phase I elevated viaduct, single box, Y piers (Red Line) | metro.md |
| MET-VB2 | Phase II and III twin U girder viaduct (Blue Line east) | metro.md |
| MET-VB3 | Metro river and railway special spans | metro.md |
| MET-RAMP | Ramp or portal where the line leaves the tunnel | metro.md |
| MET-STN-EL | Elevated station and street entrance | metro.md |
| MET-STN-UG | Underground station | metro.md |
| MET-UG | Metro running tunnel | metro.md |
| RAIL-BG | Broad gauge main line and yard track | rail.md |
| RAIL-PLAT | Platforms and roofs | rail.md |
| RSTN-NDLS | New Delhi station | rail.md |
| RSTN-OLD | Old Delhi station | rail.md |
| RSTN-HALT | Suburban halts | rail.md |
| RAIL-RING | Delhi Ring Railway | rail.md |
| RAIL-LC | Level crossings | rail.md |
| RAIL-DIS | Disused spurs | rail.md |
| FOB-B1 | New Delhi station arched steel FOB | foot_over_bridges.md |
| FOB-B2 | Railway platform FOB | foot_over_bridges.md |
| FOB-B3 | ITO skywalk and modern PWD skywalk | foot_over_bridges.md |
| FOB-B4 | PWD steel road FOB with stairs and lift | foot_over_bridges.md |
| FOB-B5 | Older plain stair FOB | foot_over_bridges.md |

## Road bridges, flyovers and ramps

| Structure (OSM name) | Class | Lanes | Length in bake | Variant | OSM ways | Centre lat, lon | bbox x0,z0 to x1,z1 | Note |
|---|---|---|---|---|---|---|---|---|
| Sachivalaya Road Flyover | trunk | 4 | 1878 m | FLY-B1 | 125736541, 125736542, 125736543 +3 | 28.63462, 77.24989 | 1690,-2489 to 2558,-2145 | Ring Road / Sachivalaya Marg elevated section, 4 lanes; era unverified, treat as modern precast box girder |
| ITO Flyover | trunk | 3 | 1112 m | FLY-T1 | 1313447924, 1313447925, 1510242193 +2 | 28.62718, 77.24693 | 1695,-2008 to 1728,-1352 | ITO junction flyover, 3 lanes; older junction flyover, treat as T beam on twin or portal piers |
| Vikas Marg | primary | 1,3 | 770 m | BRI-Y1 | 691886473, 691886475, 691886476 +3 | 28.62798, 77.25202 | 1976,-1695 to 2569,-1665 | Vikas Marg across the Yamuna at the ITO barrage (road bridge, multi-span girder) |
| New Delhi Railway Station Flyover | secondary | 2 | 704 m | FLY-T1 | 463710731, 463710732 | 28.64431, 77.21815 | -1381,-3582 to -600,-3461 | Ajmeri Gate to Paharganj station flyover, 2 lanes, over the station yard |
| Sachivalaya Road Flyover Ramp | trunk | 1 | 598 m | FLY-R1 | 125736545, 125736547 | 28.63547, 77.24925 | 1722,-2581 to 2329,-2482 | ramp of the Sachivalaya Road flyover, single lane |
| (unnamed) | tertiary | 2 | 563 m | FLY-T1 | 1305188982, 175803995, 77595118 +1 | 28.65143, 77.23453 | -1327,-5465 to 2247,-2458 | unnamed tertiary flyover, four ways (Daryaganj / Netaji Subhash Marg side) |
| Maharaja Ranjeet Singh Marg | secondary | 2 | 542 m | FLY-T1 | 665921719 | 28.63313, 77.22961 | -248,-2520 to 154,-1826 | paired deck of the Shivaji flyover (same alignment, other carriageway) |
| Shivaji Flyover | secondary | 2 | 542 m | FLY-T1 | 74851427 | 28.6337, 77.22979 | -257,-2623 to 153,-1832 | Shivaji Stadium / Minto Road flyover, 2 lanes |
| ITO Flyover Ramp | trunk | 1 | 491 m | FLY-R1 | 1313447928, 70237513, 70237514 | 28.62787, 77.24787 | 1709,-1828 to 1858,-1551 | ITO flyover ramps (cloverleaf style loops), single lane |
| Vikas Marg | secondary | 2 | 386 m | BRI-Y1 | 70255393, 70255395, 70255399 | 28.62814, 77.25172 | 1979,-1700 to 2568,-1695 | Vikas Marg Yamuna bridge, second carriageway or service deck |
| Hanuman Mandir Flyover | trunk | 3 | 351 m | FLY-T1 | 1313200454, 1313200455, 175800226 | 28.66164, 77.23935 | 778,-5525 to 1128,-5337 | Ring Road flyover at Yamuna Bazar by the Loha Pul approach, 3 lanes |
| Hanuman Mandir Flyover | secondary | 2 | 283 m | FLY-R1 | 1313200456, 175800227 | 28.66149, 77.23941 | 778,-5525 to 1200,-5274 | Hanuman Mandir flyover ramp / link, 2 lanes |
| (unnamed) | pedestrian | 1 | 191 m | FOB-B4 | 264770688, 311524765, 80429832 +1 | 28.65745, 77.24039 | 817,-5398 to 1274,-4315 | pedestrian bridge / steps by the Red Fort and Loha Pul crossing |
| Geeta Colony Road Flyover | secondary | 2 | 157 m | FLY-B1 | 1313204945, 44923699 | 28.65104, 77.24886 | 1823,-4252 to 1958,-4238 | Geeta Colony flyover (east bank), only the part inside the baked outline |
| Mori Gate Road | tertiary | 2 | 137 m | BRI-ROB | 77619341 | 28.66199, 77.22104 | -840,-5544 to -803,-5385 | road over rail bridge at Mori Gate |
| (unnamed) | trunk | 3 | 26 m | FLY-R1 | 1070588894 | 28.6516, 77.2488 | 1823,-4374 to 1938,-4250 | unnamed trunk ramp piece by the Geeta Colony flyover |
| Ring Road | trunk | 4 | 23 m | FLY-T1 | 1070839796 | 28.65903, 77.24638 | 1511,-5165 to 1834,-5034 | short Ring Road bridge piece near the Loha Pul |
| Geeta Colony Road Flyover Ramp | trunk | 2 | 22 m | FLY-R1 | 175769907 | 28.65169, 77.24936 | 1945,-4330 to 1948,-4308 | Geeta Colony flyover ramp |
| (unnamed) | service | 1 | 15 m | BRI-MIN | 1423096198 | 28.64302, 77.22398 | -549,-3423 to -527,-3221 | small service bridge |

## Tunnels and underpasses (road)

| Structure (OSM name) | Class | Lanes | Length in bake | Variant | OSM ways | Centre lat, lon | bbox | Note |
|---|---|---|---|---|---|---|---|---|
| Pragati Maidan Tunnel | secondary | 1,2 | 2542 m | TUN-T1 | 1248027209, 1248027210, 1248027213 +7 | 28.61787, 77.24142 | 829,-997 to 1893,-166 | main tunnel and its cross connections, 6 lanes divided |
| (unnamed) | service | 1 | 1853 m | TUN-T3 | 1076797993, 1187194335, 1187194336 +7 | 28.62003, 77.23972 | -708,-3313 to 1674,90 | Pragati Maidan basement / service tunnels and parking links |
| Pragati Maidan Tunnel | primary | 1 | 398 m | TUN-T2 | 973071385, 973071386, 973071387 +1 | 28.61623, 77.25021 | 1883,-491 to 2112,-228 | Pragati Maidan underpass ramps (Mathura Road side) |
| (unnamed) | tertiary | 2 | 254 m | UND-U1 | 175800331, 292171525 | 28.66218, 77.24098 | 976,-5535 to 1256,-5432 | Ring Road underpass at Yamuna Bazar / Hanuman Mandir (road passing under the flyover complex) |
| (unnamed) | service | 1 | 194 m | TUN-T4 | 1074993014, 1306476300, 1393736864 +6 | 28.6376, 77.22806 | -1255,-5073 to 1080,-967 | building passage (OSM tunnel=building_passage), gateway under buildings |
| (unnamed) | pedestrian | 1 | 105 m | SUB-S4 | 1282119234, 1548439842 | 28.61297, 77.22771 | -237,-73 to -103,50 | Kartavya Path pedestrian underpass at the India Gate end (OSM layer -1, two ways) |
| (unnamed) | pedestrian | 1 | 40 m | TUN-T4 | 1119548732, 803023451, 80429864 | 28.64801, 77.23642 | -718,-4375 to 1054,-2186 | pedestrian building passage, old city |
| (unnamed) | residential | 2 | 29 m | TUN-T4 | 1293039946, 1478807198 | 28.6523, 77.22972 | -363,-5535 to 1134,-4002 | residential lane through a building passage |

Also in OSM and inside the box but not in the baked road graph: the two Janpath pedestrian underpasses (ways 1548439816 and 1548439829), see the pedestrian subway table. The OSM "Underpass" ways of the Pragati Maidan corridor (973071350 and 1322467992, TUN-T2) lie just outside the baked outline and are listed in the last table.

## Metro lines (viaduct and tunnel)

| Line | Layer | Mode | Variant | Ways in bake | Length in data | Centre lat, lon | Note |
|---|---|---|---|---|---|---|---|
| Delhi Metro Violet Line | -2 | tunnel | MET-UG | 4 (188245893, 610024711, 1036191758) | 14092 m | 28.64137, 77.23458 | Violet Line (standard gauge, 1435 mm), underground: Central Secretariat, Mandi House, ITO, Delhi Gate, Jama Masjid, Lal Quila, Chandni Chowk, Kashmere Gate |
| Delhi Metro Yellow Line | -1 | tunnel | MET-UG | 2 (79482957, 610022426) | 4764 m | 28.65383, 77.22803 | Yellow Line north of Chandni Chowk toward Kashmere Gate (broad gauge), underground |
| Delhi Metro Yellow Line | -4 | tunnel | MET-UG | 6 (343626950, 610022433, 660097244) | 4583 m | 28.63122, 77.21829 | Yellow Line deep section: New Delhi, Rajiv Chowk, Patel Chowk, Central Secretariat (Chawri Bazar is 25 m below ground) |
| Blue Line | -2 | tunnel | MET-UG | 2 (52082767, 604707732) | 4562 m | 28.62972, 77.2254 | Blue Line underground: Rajiv Chowk, Barakhamba Road, Mandi House |
| Blue Line | 2 | viaduct or bridge | MET-VB | 4 (43766190, 164931219, 604707724) | 4535 m | 28.62396, 77.24191 | Blue Line elevated viaduct east of Mandi House, with the extradosed bridge over the Northern Railway main lines near Pragati Maidan, to the Yamuna |
| Airport Express Line | -1 | tunnel | MET-UG | 2 (188216912, 604707698) | 3599 m | 28.63313, 77.21655 | Airport Express underground: New Delhi to Shivaji Stadium and Dhaula Kuan (standard gauge) |
| Blue Line | 1 | viaduct or bridge | MET-RAMP | 2 (695925443, 695925444) | 710 m | 28.62539, 77.23788 | Blue Line ramp and short bridge where the line rises out of the tunnel near Mandi House |
| Blue Line | 0 | at grade | MET-RAMP | 2 (914114472, 914114473) | 571 m | 28.63561, 77.2147 | Blue Line at grade near RK Ashram Marg / Jhandewalan (west edge) |
| (unnamed) | -1 | tunnel | MET-UG | 1 (1247668343) | 205 m | 28.63246, 77.22007 | unnamed metro tunnel piece by Rajiv Chowk |

Length is the full length of the OSM ways that touch the baked outline, which can run far outside it (the Blue Line ways reach Dwarka and Noida); use the bbox in the JSON for the extent in the pilot. The deep Magenta extension ("Delhi Metro Magenta Line Extension, RK Ashram Marg to Indraprastha", way 1571169662) is under construction and is not baked.

## Metro and railway stations

| Station | Kind | Mode, line | Variant | lat, lon | OSM id |
|---|---|---|---|---|---|
| Pragati Maidan | indian_railways |   | RSTN-HALT | 28.61603, 77.24722 | node/1988513583 |
| Shivaji Bridge | indian_railways |   | RSTN-HALT | 28.63336, 77.22667 | node/1988513598 |
| Tilak Bridge | indian_railways |   | RSTN-HALT | 28.62805, 77.23741 | node/1988513599 |
| New Delhi | metro | underground Delhi Metro Yellow Line | MET-STN-UG | 28.64335, 77.22274 | node/554257841 |
| Sadar Bazar | indian_railways |   | RSTN-HALT | 28.65789, 77.217 | node/5854161857 |
| New Delhi | indian_railways |   | RSTN-NDLS | 28.6418, 77.22175 | node/6131069513 |
| Indraprastha | metro | elevated Blue Line | MET-STN-EL | 28.62057, 77.24956 | node/6537193575 |
| Ramakrishna Ashram Marg | metro | elevated Blue Line | MET-STN-EL | 28.63913, 77.20857 | node/6539894850 |
| Rajiv Chowk | metro | underground Delhi Metro Yellow Line | MET-STN-UG | 28.63262, 77.21931 | node/6539894851 |
| Barakhambha Road | metro | underground Blue Line | MET-STN-UG | 28.62969, 77.225 | node/6539894855 |
| Mandi House | metro | underground Blue Line | MET-STN-UG | 28.62556, 77.2342 | node/6539894856 |
| Supreme Court | metro | elevated Blue Line | MET-STN-EL | 28.62343, 77.24254 | node/6539894857 |
| Chandni Chowk | metro | underground Delhi Metro Yellow Line | MET-STN-UG | 28.65822, 77.23034 | node/7018886724 |
| Chawri Bazaar | metro | underground Delhi Metro Yellow Line | MET-STN-UG | 28.6491, 77.22651 | node/7018886725 |
| Lal Quila | metro | underground Delhi Metro Violet Line | MET-STN-UG | 28.65729, 77.23666 | node/7282286730 |
| Delhi Gate | metro | underground Delhi Metro Violet Line | MET-STN-UG | 28.6391, 77.24079 | node/7282286733 |
| Rajiv Chowk | metro | underground Blue Line | MET-STN-UG | 28.63269, 77.21969 | node/8018558072 |
| Delhi Junction | indian_railways |   | RSTN-OLD | 28.66072, 77.22765 | node/913095905 |
| New Delhi Airport Express Terminal | metro | underground Airport Express Line | MET-STN-UG | 28.64235, 77.22311 | node/938409545 |
| Janpath | metro | underground Delhi Metro Violet Line | MET-STN-UG | 28.624, 77.21925 | node/9584236507 |
| ITO | metro | underground Delhi Metro Violet Line | MET-STN-UG | 28.62812, 77.24105 | node/9584236508 |
| Mandi House | metro | underground Delhi Metro Violet Line | MET-STN-UG | 28.62546, 77.2342 | node/9920295123 |
| Jama Masjid | metro | underground Delhi Metro Violet Line | MET-STN-UG | 28.64999, 77.23754 | way/360264006 |
| Rajiv Chowk metro station | underground feature |   | MET-STN-UG | (footprint) | way/1158884368 |
| unnamed station | underground feature |   | MET-STN-UG | (footprint) | way/1165151902 |
| Palika Bazaar | underground feature |   | SUB-S2 | (footprint) | way/1393736849 |
| Palika Parking | underground feature |   | TUN-T3 | (footprint) | way/1393736859 |
| unnamed structure | underground feature |   | TUN-T3 | (footprint) | way/351616847 |
| Jama Masjid metro station | underground feature |   | MET-STN-UG | (footprint) | way/360264006 |
| Lal Quila metro station | underground feature |   | MET-STN-UG | (footprint) | way/360264008 |

## Railway lines

| Name | Layer | Mode | Variant | Ways | Length | Centre lat, lon | Note |
|---|---|---|---|---|---|---|---|
| (unnamed) | 0 | at grade | RAIL-BG | 327 (77366952, 77366975, 77366987) | 104921 m | 28.65051, 77.22384 | Indian Railways ballast track, the New Delhi and Delhi Junction yards and approaches (327 unnamed ways) |
| Mumbai - Delhi Railway | 0 | at grade | RAIL-BG | 19 (34940854, 77011085, 77011091) | 10172 m | 28.63055, 77.23254 | Mumbai line main tracks |
| Howrah - Delhi Railway | 0 | at grade | RAIL-BG | 21 (77366957, 77366963, 77366980) | 9213 m | 28.6287, 77.23456 | Howrah line main tracks |
| (unnamed) | 1 | bridge | RBR-U1 | 31 (77011117, 77011123, 77603079) | 1204 m | 28.65249, 77.23706 | rail bridges over roads and yard roads, all Northern Railway: the Minto Bridge, Tilak Bridge, Kashmere Gate and Mori Gate crossings |
| Delhi Ring Railway | 0 | at grade | RAIL-RING | 2 (77011114, 818915049) | 866 m | 28.61666, 77.24714 | Delhi Ring Railway at Pragati Maidan |
| (unnamed) | -1 | tunnel | RBR-CUT | 8 (77603061, 77603074, 77603088) | 527 m | 28.65966, 77.21717 | rail under road (cut and cover, layer -1) between Kashmere Gate and Mori Gate |
| Mumbai - Delhi Railway | 1 | bridge | RBR-U1 | 6 (34940855, 77011094, 77011110) | 233 m | 28.62494, 77.23733 | Mumbai line over Tilak Marg and Minto Road (Tilak Bridge, Shivaji Bridge stations) |
| Howrah - Delhi Railway | 1 | bridge | RBR-U1 | 4 (77366962, 77366985, 77366997) | 187 m | 28.6318, 77.23062 | Howrah line over roads at Tilak Bridge and Minto Bridge |
| (unnamed) | 2 | bridge | RBR-Y1 | 1 (77603072) | 38 m | 28.66186, 77.24499 | Loha Pul approach (Yamuna rail bridge) |
| Old Iron Bridge (Loha Pul) | 2 | bridge | RBR-Y1 | 1 (77603110) | 37 m | 28.66189, 77.24495 | Old Iron Bridge (Loha Pul), double deck steel truss, 1866 |

### Level crossings

| Cluster lat, lon | Count | Variant | OSM nodes (first 4) |
|---|---|---|---|
| 28.617, 77.25 | 2 | RAIL-LC | 2126427164, 3171982196 |
| 28.628, 77.208 | 2 | RAIL-LC | 12319493498, 12319493500 |
| 28.632, 77.236 | 1 | RAIL-LC | 11648437774 |
| 28.632, 77.237 | 1 | RAIL-LC | 11648437773 |
| 28.657, 77.217 | 9 | RAIL-LC | 7629641556, 7629641559, 7629641561, 7629641564 |
| 28.661, 77.232 | 10 | RAIL-LC | 913095842, 3648528735, 3648528736, 3648528737 |
| 28.662, 77.23 | 2 | RAIL-LC | 11939017883, 11939017884 |

## Foot bridges

| OSM way | Length | Variant | lat, lon | Note |
|---|---|---|---|---|
| 1248031156 | 35 m | FOB-B4 | 28.61614, 77.24026 | road or metro-link foot bridge |
| 1248079213 | 56 m | FOB-B4 | 28.62039, 77.24865 | road or metro-link foot bridge |
| 1287299124 | 153 m | FOB-B2 | 28.66163, 77.2271 | Delhi Junction side FOB |
| 1287299130 | 161 m | FOB-B2 | 28.66153, 77.22863 | Delhi Junction side FOB |
| 1294941406 | 38 m | FOB-B4 | 28.63379, 77.22975 | road or metro-link foot bridge |
| 1429504126 | 65 m | FOB-B4 | 28.62764, 77.23809 | road or metro-link foot bridge |
| 1448561131 | 167 m | FOB-B3 | 28.6237, 77.24136 | ITO area skywalk branch (Hans Bhawan side) |
| 200251460 | 64 m | FOB-B4 | 28.63912, 77.20843 | road or metro-link foot bridge |
| 264770688 | 8 m | FOB-B5 | 28.65612, 77.23845 | short old stair or steel FOB |
| 311524765 | 14 m | FOB-B5 | 28.6518, 77.2397 | short old stair or steel FOB |
| 34404746 | 1830 m | FOB-B1 | 28.64231, 77.22153 | New Delhi station foot over bridge network (50 ways, 1.8 km of FOB footway) incl. the arched steel Paharganj FOB |
| 370765173 | 95 m | FOB-B4 | 28.63355, 77.22609 | road FOB by Shivaji Stadium / Minto Road |
| 370765177 | 76 m | FOB-B4 | 28.62839, 77.23676 | road or metro-link foot bridge |
| 435426345 | 40 m | FOB-B4 | 28.6137, 77.24019 | road or metro-link foot bridge |
| 464312306 | 164 m | FOB-B2 | 28.65755, 77.21739 | Sadar Bazar station platform FOB |
| 77614294 | 20 m | FOB-B5 | 28.66133, 77.22257 | short old stair or steel FOB |
| 80414535 | 576 m | FOB-B1 | 28.64342, 77.21957 | New Delhi station main FOB |
| 80429832 | 66 m | FOB-B4 | 28.66006, 77.24209 | Ring Road FOB at Red Fort / Loha Pul crossing |
| 80429897 | 104 m | FOB-B4 | 28.66077, 77.24218 | Ring Road FOB at Red Fort / Loha Pul crossing |
| 814940336 | 51 m | FOB-B3 | 28.62659, 77.24132 | ITO area skywalk link |
| 854903774 | 547 m | FOB-B3 | 28.62472, 77.24112 | ITO Skywalk (400 m + loop, steel, tensile fabric roof, glass lifts) |
| 993862148 | 9 m | FOB-B4 | 28.62403, 77.23869 | road or metro-link foot bridge |
| 993862151 | 9 m | FOB-B4 | 28.62395, 77.23884 | road or metro-link foot bridge |
| 998790348 | 93 m | FOB-B3 | 28.62804, 77.24401 | ITO area skywalk link (Hans Bhawan side) |

## Pedestrian subways and passages (OSM footways with tunnel or a negative layer)

Clusters on a 330 m grid; `ways` counts OSM way pieces, not separate subways.

| Cell lat, lon | Ways | Total length | Variant | Example OSM ids | Names | Note |
|---|---|---|---|---|---|---|
| 28.632, 77.22 | 82 | 1395 m | SUB-S1 | 164675806, 164675821, 164683606 | - | Connaught Place outer circle subways and Rajiv Chowk concourse links (layers -1, -2 and -4 mix pedestrian subway and metro concourse) |
| 28.632, 77.223 | 19 | 201 m | SUB-S1 | 582929434, 1119548714, 1119548715 | - | Connaught Place outer circle subways and Rajiv Chowk concourse links (layers -1, -2 and -4 mix pedestrian subway and metro concourse) |
| 28.635, 77.22 | 18 | 384 m | SUB-S1 | 164675824, 164683604, 164683605 | - | Connaught Place outer circle subways and Rajiv Chowk concourse links (layers -1, -2 and -4 mix pedestrian subway and metro concourse) |
| 28.629, 77.22 | 11 | 246 m | SUB-S1 | 583501522, 583501528, 778204103 | - | Connaught Place outer circle subways and Rajiv Chowk concourse links (layers -1, -2 and -4 mix pedestrian subway and metro concourse) |
| 28.644, 77.223 | 9 | 687 m | SUB-S5 | 260320115, 351475560, 351475561 | - | New Delhi station and Airport Express terminal links |
| 28.632, 77.217 | 8 | 390 m | SUB-S1 | 582349040, 582349041, 582349042 | - | Connaught Place outer circle subways and Rajiv Chowk concourse links (layers -1, -2 and -4 mix pedestrian subway and metro concourse) |
| 28.614, 77.229 | 5 | 188 m | SUB-S4 | 1282119234, 1548439842, 1548439844 | - | Kartavya Path pedestrian underpasses (Janpath North and South where Janpath crosses the avenue, and the India Gate end hexagon crossings) |
| 28.614, 77.217 | 5 | 145 m | SUB-S4 | 1548439813, 1548439814, 1548439816 | Janpath South underpass | Kartavya Path pedestrian underpasses (Janpath North and South where Janpath crosses the avenue, and the India Gate end hexagon crossings) |
| 28.614, 77.22 | 5 | 145 m | SUB-S4 | 1548439818, 1548439821, 1548439829 | Janpath North underpass | Kartavya Path pedestrian underpasses (Janpath North and South where Janpath crosses the avenue, and the India Gate end hexagon crossings) |
| 28.614, 77.226 | 4 | 93 m | SUB-S4 | 1282119230, 1548439839, 1548439840 | - | Kartavya Path pedestrian underpasses (Janpath North and South where Janpath crosses the avenue, and the India Gate end hexagon crossings) |
| 28.653, 77.241 | 2 | 30 m | TUN-T4 | 80429864, 803023451 | - | building passages, old city |
| 28.656, 77.238 | 2 | 135 m | TUN-T4 | 490512500, 490512509 | - | building passages, old city |
| 28.629, 77.223 | 2 | 46 m | SUB-S1 | 582929431, 582929433 | - | Connaught Place outer circle subways and Rajiv Chowk concourse links (layers -1, -2 and -4 mix pedestrian subway and metro concourse) |
| 28.629, 77.217 | 2 | 75 m | SUB-S1 | 778204102, 1297388765 | - | Connaught Place outer circle subways and Rajiv Chowk concourse links (layers -1, -2 and -4 mix pedestrian subway and metro concourse) |
| 28.638, 77.208 | 2 | 47 m | TUN-T4 | 1386106197, 1386106210 | - | building passages, old city |
| 28.641, 77.25 | 2 | 13 m | SUB-S3 | 1450938511, 1450938513 | - | other pedestrian subway or station link |
| 28.635, 77.217 | 2 | 27 m | SUB-S1 | 1488006963, 1494413070 | - | Connaught Place outer circle subways and Rajiv Chowk concourse links (layers -1, -2 and -4 mix pedestrian subway and metro concourse) |
| 28.656, 77.241 | 1 | 15 m | TUN-T4 | 80429801 | - | building passages, old city |
| 28.629, 77.241 | 1 | 17 m | SUB-S3 | 854903777 | - | other pedestrian subway or station link |
| 28.611, 77.232 | 1 | 111 m | SUB-S4 | 1024424766 | - | Kartavya Path pedestrian underpasses (Janpath North and South where Janpath crosses the avenue, and the India Gate end hexagon crossings) |
| 28.614, 77.232 | 1 | 142 m | SUB-S4 | 1025731104 | - | Kartavya Path pedestrian underpasses (Janpath North and South where Janpath crosses the avenue, and the India Gate end hexagon crossings) |
| 28.626, 77.208 | 1 | 20 m | SUB-S3 | 1280140323 | - | other pedestrian subway or station link |
| 28.611, 77.229 | 1 | 9 m | SUB-S4 | 1282119231 | - | Kartavya Path pedestrian underpasses (Janpath North and South where Janpath crosses the avenue, and the India Gate end hexagon crossings) |
| 28.614, 77.235 | 1 | 12 m | SUB-S4 | 1284435345 | - | Kartavya Path pedestrian underpasses (Janpath North and South where Janpath crosses the avenue, and the India Gate end hexagon crossings) |
| 28.659, 77.223 | 1 | 20 m | TUN-T4 | 1377204957 | - | building passages, old city |
| 28.659, 77.226 | 1 | 16 m | TUN-T4 | 1377204959 | - | building passages, old city |
| 28.641, 77.208 | 1 | 15 m | TUN-T4 | 1386106189 | - | building passages, old city |
| 28.668, 77.217 | 1 | 24 m | SUB-S3 | 1498275699 | Rajiv Agrawal Paidal Par Path | Tis Hazari pedestrian subway (Rajiv Agrawal Paidal Par Path) |

## OSM structures inside the box but outside the baked outline, and future structures

| Structure | OSM | lat, lon | Variant | Note |
|---|---|---|---|---|
| Rani Jhansi Flyover (and ramps) | way/464265868, way/708804793 | 28.6636, 77.207 | FLY-B1 | inside the OSM box but outside the baked outline, Pul Bangash / Sadar Bazar end |
| Delhi-Dehradun Expressway bridge pieces | way/175769881 | 28.66, 77.2604 | FLY-B1 | east edge of the box (Shastri Park side); elevated carriageway on Y piers |
| New Yamuna Rail Bridge (under construction) | way/80429909 | 28.6654, 77.2525 | RBR-Y1 | built beside the Loha Pul: new steel girder rail bridge, 992 m (Wikipedia) |
| Delhi Metro Magenta Line extension (construction) | way/1571169662 | 28.6214, 77.2241 | MET-UG | RK Ashram Marg to Indraprastha, layer -5, future deep tunnel |
| Pragati Maidan "Underpass" links (primary_link and secondary_link) | way/973071350, way/1322467992 | 28.6129, 77.2512 | TUN-T2 | OSM "Underpass" ways of the corridor, 568 m and 452 m, at the south-east edge (second one at 28.6035, 77.2402) |
| Metro stations in the box but outside the baked outline | node/268381463 Pul Bangash, node/561316983 Tis Hazari (Red Line, elevated); node/554257833 Shivaji Stadium (Airport Express, underground); node/5453646586 Central Secretariat, node/7018886726 Patel Chowk, node/7018886727 Seva Teerth (Yellow and Violet, underground) | 28.6289, 77.2113 | MET-STN-EL / MET-STN-UG | OSM station nodes inside the pilot box that the baked graph does not include; modes from the line each sits on |
| Rajghat and Indraprastha power plant feeder lines | way/70255390, way/661791150 | 28.6276, 77.2525 | RAIL-DIS | disused industrial spurs, grass-grown track |

## Far blocks (not baked yet): structures to expect

Only the centre block is baked, so the following are listed from general knowledge and need ids when those blocks are baked (DELHI_WORLD.md has the area sheets).

| Block | Structures to expect | Variants |
|---|---|---|
| Qutub Mehrauli | Mehrauli-Gurgaon Road flyovers, Qutub Minar metro station (Yellow Line, elevated) and its viaduct, Ayanagar underpass | FLY-B1, MET-VB2, MET-STN-EL |
| Vasant Kunj | Vasant Kunj and Mahipalpur flyovers, NH 48 (Airport Road) bridges, Airport Express viaduct (25 m girders, elevated), Munirka pedestrian bridge | FLY-B1, MET-VB2, FOB-B4 |
| Airport T3 | Airport Express elevated line and its terminal stations, the Aerocity underground / long platform station, airport road underpasses and flyovers (2 lane box underpass, concrete retaining walls) | MET-VB2, MET-STN-UG, UND-U1, FLY-B1 |
| Cyber City (Gurugram) | Rapid Metro and Yellow Line, Sikanderpur and Cyber City elevated stations, NH 48 and Golf Course Road flyovers, large cloverleafs and signal-free corridors | MET-VB2, MET-STN-EL, FLY-B1 |

## Verify before the kits are final

1. FLY-T1 versus FLY-B1 for each named flyover (era is inferred from name and trunk class): ITO, Hanuman Mandir, Shivaji, Sachivalaya Road, Geeta Colony.
2. The "Vikas Marg" bridge pieces at the ITO barrage: confirm one river bridge or two, and the girder type from a photo.
3. The unnamed tertiary flyover (4 ways, near (28.651, 77.2345)) and the unnamed `trunk` ramp pieces.
4. Whether the Blue Line east of Mandi House is a box girder or U girder viaduct (MET-VB1 or VB2).
5. The Kartavya Path underpass finish (red granite is documented only for the walkways).
6. The rail under road pieces (RBR-CUT) near Kashmere Gate and Mori Gate: confirm they are covered cuttings and not long station subways.
