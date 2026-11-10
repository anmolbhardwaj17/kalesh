# Map repair layer

Design starting point, written at setup (2026-11-10). Phase 0 architecture discovery refines it, measures it and puts it in front of Anmol for the architecture sign-off. Nothing here is decided until then.

Update 2026-11-10 (replan for Godot 4 and the compressed map, decisions.md "Engine Godot 4, and a compressed Delhi map"): the game is a composite map of real districts, not a 1:1 Delhi (proposal, pending Anmol, see "District frames and stitching" below and `DELHI_WORLD.md` "0. Composite map"). The bake runs offline (Node or Python tooling outside Godot, decided in architecture discovery) and writes tiles that the Godot game streams. The map inspector may be a web page or a Godot tool scene (an `ARCH_OPTIONS.md` decision).

## Why

Source map data is broken. OSM and the other sources have roads that should join and do not, roads that do not touch the ground, flyovers that end in mid air, buildings on top of roads, and missing footpaths. The old game built meshes straight from that data, so every flaw showed up on screen. Dilli Darshan puts a repair layer between the sources and the mesh build: it finds what is broken and fixes it, on every bake, with a log.

## Sources

Each source is checked in Phase 0 for licence (and attribution needs) and for quality over the pilot area.

| Use | Source | Note |
|---|---|---|
| Road network base | OSM | Cross-checked against Overture Maps (transportation) for missing or wrong links. |
| Buildings | OSM, Google Open Buildings, Microsoft building footprints | Merged into one set, duplicates removed (overlap and centroid match), OSM tags kept where present. |
| Terrain | A bare-earth model: FABDEM or CartoDEM | Not the Copernicus GLO-30 surface model: rooftops and trees in a surface model make roads float or sink. |
| Validation only | Open satellite imagery | Used to check repairs and to spot what the data misses. Never baked into the game. |

## Pipeline (runs on every bake)

0. **District selection** (once, then on change): `harness/data/districts.json` lists the chosen districts, each with a real clip polygon (lat and lon), a frame origin (lat and lon of its centre) and a placement offset in game metres. Only data inside a clip polygon (plus a small margin for boundary roads) is ingested.
1. **Ingest and normalize** every source into one topology graph: nodes, edges with layer, level, width, surface and class, and polygons for buildings, areas and platforms. One coordinate system: east +X, north -Z, 1 unit = 1 m.
2. **Validate** with a rule engine. Every issue gets a type, a location (lat and lon plus world metres), the tile, and a confidence.
3. **Auto-repair**, deterministic and logged: same input gives the same output, and each fix records the rule, the before and after, and the confidence.
4. **Per-tile overrides**: patch files per tile, versioned in git, applied after auto-repair, that survive a re-bake. Claude writes them after reviewing screenshots of the site. Each patch names the issue it fixes and why.
5. **Stitching and connectors**: roads that leave a district through its clip polygon end at a boundary port. Authored connectors (`harness/data/connectors/`: ring road arcs, flyovers, arterials, the Yamuna and its bridges, the airport road) join ports of different districts. Each connector is a spline with a road class, lane set and grade, built by the same lane model and elevation solver as real roads. Every boundary port ends in a connector, a junction with another port, a turning loop or an explained dead end.
6. **Elevation solver**: ground roads follow the bare-earth DTM, and the DTM is flattened under them (with a shoulder blend). Bridges and flyovers are splines between abutments, held to clearance and grade limits.
7. **Mesh build** only from the repaired and stitched graph. Nothing reads the raw sources after step 1.

## District frames and stitching (proposal, pending Anmol)

- **One frame per district.** A district is projected with the same transverse Mercator as before, but around its own frame origin, so distances and angles inside it stay true to within centimetres. Then it is moved by its placement offset. Translation only: no rotation, no scale, no mirroring, so north stays -Z everywhere and the old axis lesson holds.
- **World position** of a real point = district offset + project(lat, lon, district origin). The bake records the district id with every tile and every landmark.
- **Landmark tests** check the position inside the district frame: the landmark's projected position plus its district offset, within the tier tolerance (`DELHI_WORLD.md` "6. Verification"). A second test checks the relative layout inside a district (for example Red Fort is north-east of Jama Masjid at the true distance).
- **Height**: each district keeps its real bare-earth DTM, shifted by one district height offset so neighbours meet near the same level (Delhi is mostly flat, about 200 to 230 m). Filler terrain between districts blends the edges.
- **Gaps between districts** are filled by connector roads, the river, parks, rail corridors, generated filler blocks from area profiles, and terrain. Filler never claims to be a real place.
- **Rules added to the catalogue**: every boundary port is closed (connector, junction, loop or explained dead end); connector grades and curve radii within the limits for their class; no connector crosses a district interior unless it is a real road there; district clip polygons do not overlap after placement; districts keep a minimum gap for the connector corridor.
- **Map and minimap** show the game layout (compressed), north up. Real names stay on real places; connectors carry the real name of the road they stand for (Ring Road, NH-48) where it makes sense.

## Rule catalogue

| Area | Rules |
|---|---|
| Roads | Dangling ends near another road (join or explain); crossings without a shared node on the same layer; duplicate and overlapping ways; width sanity per class and lane count. |
| Bridges and flyovers | Unsupported ends; ramps that end in the air; vertical clearance over what they cross; grade limits. |
| Intersections | Approach angles; overlapping road surfaces at a junction; one junction surface per node cluster. |
| Footpaths | Generated from road edges where the class needs them and the data has none. |
| Buildings | Overlapping roads or each other; bad polygons (self-crossing, tiny, slivers); missing heights inferred from levels or from typology. |
| Metro and rail | Elevated viaducts get piers; stations link to their line and to the street. |
| Foot over bridges | Stairs or ramps connect to footpaths at both ends. |

## Lane-level road model

OSM centrelines meet at one shared node, so in the old game carriageways that merge or split collapsed into each other. Dilli Darshan builds roads from real-world lane geometry instead:

- **Lane sets.** Each road becomes a set of lanes with widths from the `lanes` and `width` tags, or defaults per Delhi road class.
- **Diverges and merges** get proper taper lengths and gore areas. Lanes shift sideways and separate; two carriageways never share an index point.
- **Flyovers**: the centre lanes climb while the left and right service lanes continue at grade.
- **Side lanes** taper into the start of the next flyover.
- **Junction surfaces** are built from lane-edge curves with corner radii, with no overlapping faces.

This is the top Fable task (CLAUDE.md "Fable tier").

Checks (in the rule engine and the gate counts):
- no overlapping road faces
- lane continuity through every split and merge
- taper length within the limits for the road class

## Map inspector (human in the loop)

A separate 3D web page in this repo, linked from the dashboard, served on the dashboard port (or the port next to it).

- It shows the repaired map with every open issue marked.
- Click an issue and the camera flies to it.
- Claude has already proposed options with 3D preview lines ("connect to road A", "connect to road B", "terminate here", "remove"), each with a confidence score and the reasoning.
- Anmol picks one or types a note. The choice is written to that tile's overrides file, which survives re-bakes.
- Claude handles clear cases itself and queues only unclear or high-impact ones, sorted by impact.
- The page also shows lane widths, splits and merges, so Anmol can check ramps.
- Every choice and note also lands in the inbox (`harness/state/inbox.jsonl`, source `inspector`), so the loop sees it.

It is an early task right after the architecture sign-off, so Anmol can start reviewing during the pilot. Like the dashboard, it never blocks work: open items wait in the queue while Claude keeps building.

## Verification

- A **map health report** per bake: issues found by type, repaired automatically, fixed by overrides, and left open.
- **Gate counts**: at each phase gate, open boundary ports, floating ends, unjoined ends, overlapping road faces, broken lane continuity at splits and merges, and tapers out of limits are zero, or each remaining one is explained in the report.
- The **verifier screenshots every repaired site** (before and after where possible) and reads them.
- A **map health panel** on the dashboard shows the latest report and links to the map inspector.

## Pilot area first

With the composite map, the pilot is the first districts to be selected and stitched. Proposal: Connaught Place with ITO and Pragati Maidan, plus Chandni Chowk, plus one connector between them, so stitching is proven in the pilot too. Anmol confirms the district list and layout in the interview.


Build and prove the layer on a small, hard area before scaling up:
- Connaught Place (radial roads, inner and outer circles)
- The ITO and Pragati Maidan flyovers (stacked flyovers, ramps, underpasses)
- Chandni Chowk (dense old city, narrow lanes, buildings tight to roads)
- One metro line (elevated viaduct, stations, foot over bridges)

Then scale to the wider city.

## Model tier

Fable tier tasks (CLAUDE.md "Fable tier"): the lane-level road model first (the top Fable task), then the repair rules, the elevation solver and the junction builder. The map inspector page is a normal Opus builder task.
