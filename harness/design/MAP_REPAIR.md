# Map repair layer

Design for Kalesh (the game was called Dilli Darshan until 2026-11-10). First written at setup, replanned for Godot 4 and the composite map, and refined in architecture discovery (P0-010, 2026-11-10). The choices marked "Rec" are the planner's recommendations in [`ARCH_OPTIONS.md`](ARCH_OPTIONS.md) section 7; nothing is decided until Anmol's architecture sign-off. Every number is an estimate unless it names a report file. The benches P0-018 (data), P0-019 (roads) and P0-029 (stitch) measure them.

Related: [`DELHI_WORLD.md`](DELHI_WORLD.md) (the composite map, landmarks and area profiles), `SALVAGE_AUDIT.md` sections 5 and 8 (why the old game's base layer failed).

## Why

Source map data is broken. OSM and the other sources have roads that should join and do not, roads that do not touch the ground, flyovers that end in mid air, buildings on top of roads, and missing footpaths. The old game built meshes straight from that data, so every flaw showed on screen. Kalesh puts a repair layer between the sources and the mesh build: it finds what is broken and fixes it, on every bake, with a log.

The bake runs offline in Node and TypeScript under `tools/bake/` (Rec B1). The Godot game only reads the finished tiles (Rec T1). Nothing in the game reads raw sources.

## Sources

Licences below are what the planner found on 2026-11-10 (web search of the publishers' and catalogue pages). P0-018 checks each one at the source, records the URL, the date and the licence text in `harness/reports/arch/pilot_data.json` and `world_sources.json`, and pins every downloaded file by date and checksum. Anmol's release is free and public; the standing preference is sources that would still allow a later sale (decisions.md "Speeds and map size").

| Use | Source | Licence and credit | Quality check in the pilot | Status |
|---|---|---|---|---|
| Road network | OpenStreetMap, a fresh extract of the district boxes | ODbL 1.0. Credit "© OpenStreetMap contributors" in the game. A derived database that is shared must be offered under ODbL, so the repaired map data is published openly (question 1 in ARCH_OPTIONS.md) | Share of roads with `lanes`, `width`, `oneway`, `layer` and `bridge` tags; dangling ends; unjoined crossings | Base (Rec RS1) |
| Road cross-check | Overture Maps, transportation theme | ODbL (believed) | What it has that OSM lacks. It is built mostly from OSM, so expect little | Second look only |
| Buildings | Overture Maps, buildings theme: OSM, Microsoft, Google Open Buildings and Esri already merged, with a source tag per building | ODbL (Overture release notes). Credit OSM and Overture | Duplicates left, OSM tags kept, coverage in Old Delhi | Rec BS1 |
| Buildings, fallback | Our own merge of OSM, Google Open Buildings (CC BY 4.0 or ODbL, believed) and Microsoft footprints (ODbL, believed) | as listed | Overlap and centroid match rates | If BS1 is poor (BS2) |
| Building heights | OSM `height` and `building:levels`, Overture `height`, then the area profile's floor counts | as above | Share of buildings with any height | In order |
| Ground height | GEDTM30, a 30 m bare-earth model | CC BY (project page and lecture record; the Zenodo licence field is checked in P0-018). Credit line | Height at 20 open-ground control points, roughness along 20 road profiles, steps under dense blocks | Rec GS1 if it passes |
| Ground height, fallback | Copernicus GLO-30 (a surface model) with our own ground filter: sample only roads, parks and open ground, drop cells under buildings, fit a smooth surface | Free with a credit line, commercial use allowed | Same checks | Rec GS2 |
| Ground height, cross-check only | FABDEM | CC BY-NC-SA 4.0: non-commercial and share-alike. Never shipped, never baked into tiles | Used as the yardstick in the bench | GS3 |
| Ground height, out | CartoDEM | Needs a Bhuvan account (an owner action); reuse terms unclear | none | Out unless GS1 and GS2 both fail |
| Reference for hero roads and repairs | Street photos (Mapillary, Wikimedia Commons) and Sentinel-2 imagery | Per image; reference only. Linked by URL with the licence noted. Never baked into the game | Read by eye | Reference |

Why not a surface model as it is: rooftops and trees in the data make roads float or sink (`SALVAGE_AUDIT.md` section 6).

## Pipeline (runs on every bake)

0. **District selection** (once, then on change). `harness/data/districts.json` lists the chosen districts: id, name, stage (pilot, release, later), frame origin (lat and lon), placement offset in game metres, height offset, and the file of its clip polygon (`harness/data/districts/<id>.geojson`). Clip polygons follow real edges (arterials, rail lines, walls, the river, park edges), with an edge band of 60 to 100 m kept as low detail shells (Rec DC3). Only data inside a clip polygon plus the band is ingested.
1. **Ingest and normalise** every source into one topology graph per district: nodes, edges with layer, level, width, surface and class, and polygons for buildings, areas and platforms. One coordinate space from here on: district-local metres, east +X, north -Z. Every space has a named type in the code, and a magnitude check runs where baked data enters the game.
2. **Pair and classify.** Two one-way OSM ways of one street are recognised as one street before any width is assigned. Each road gets a class with Delhi defaults (left-hand traffic).
3. **Validate** with the rule engine. Every issue gets a stable id, a rule id, a place (lat and lon, district metres, tile), an impact score and a confidence.
4. **Auto-repair**, deterministic and logged (Rec AR1): a repair applies on its own when its confidence is 0.8 or more and its impact is low. Everything else is queued for the map inspector with proposals.
5. **Overrides**: patch files per tile, versioned in git, applied after auto-repair. They survive re-bakes and new extracts.
6. **Lane model**: roads become reference lines with lane sections; junctions become objects (below).
7. **Stitching and connectors**: roads that leave a district through its clip line end at a boundary port. Authored connectors (`harness/data/connectors/<id>.json`: control points in game metres, road class, lane set, real name) join ports of different districts and are built by the same lane model (Rec SC1). Small ports are closed by a short generated street net in the filler, a gate, a loop or an explained dead end (Rec FL1).
8. **Elevation solver**: one height per node on the whole graph, connectors included (below).
9. **Mesh build** from the repaired, stitched and solved graph only: lane surfaces, junction surfaces, kerbs, railings and parapets from deck edges, ground fitted to the road edges, colliders from the same vertices, navmesh polygons, lane graph for traffic.
10. **Tiles and reports**: 250 m tiles with a version stamp and a byte budget; the map health report; the issue list for the inspector. A failed invariant stops the bake before it writes tiles.

## District frames and stitching

Signed in the map round by Anmol: a composite map of real districts, layout C in stages (`DELHI_WORLD.md` section 0). The mechanics below are Rec X1, DC3, SC1 and FL1 in ARCH_OPTIONS.md.

- **One frame per district.** A district is projected with the transverse Mercator of `tools/geo/projection.ts` around its own frame origin, so distances and angles inside it stay true to within centimetres. Then it is moved by its placement offset. Translation only: no rotation, no scale, no mirroring, so north stays -Z everywhere.
- **World position** of a real point = district offset + project(lat, lon, district origin). The bake records the district id with every tile, landmark, mission anchor and spawn point.
- **World origin** is the centre of the map box, so no position is more than about 6 km from it and 32-bit floats are enough (Rec FP1).
- **Landmark tests** check the position inside the district frame, within the tier tolerance (`DELHI_WORLD.md` "6. Verification"). A second test checks the layout inside a district (Red Fort is north-east of Jama Masjid at the true distance).
- **Height**: each district keeps its real ground heights, shifted by one district height offset so neighbours meet near the same level (Delhi is mostly flat, about 200 to 230 m). Filler ground blends between district edges.
- **Gaps between districts** are filled by connector roads, the river, parks, rail corridors, generated filler blocks from area profiles, and terrain. Filler never claims to be a real place.
- **Map and minimap** show the game layout, north up. Real names stay on real places; a connector carries the real name of the road it stands for (Ring Road, NH-48).

## Rule engine

Rules are TypeScript modules in `tools/bake/rules/` (Rec RE1). Each has an id, an area, a detect function, an optional repair function, a confidence, unit tests and a line in the generated catalogue. Rules run in a fixed, tested order. The same input always gives the same output.

| Area | Rules (ids start with the prefix) |
|---|---|
| Roads (R-ROAD) | Dangling ends near another road (join or explain); crossings without a shared node on the same layer; duplicate and overlapping ways; two one-way ways of one street not paired; width sanity per class and lane count; lane count changes with no taper room |
| Bridges and flyovers (R-BRIDGE) | Unsupported ends; ramps that end in the air; vertical clearance over what they cross; grade limits; a bridge tag with no ground road at either end |
| Intersections (R-JUNC) | Approach angles; overlapping road surfaces at a junction; one junction object per node cluster; a junction arm shorter than its corner radius |
| Lanes (R-LANE) | Lane continuity through every split and merge; taper length within the class limits; no two carriageways share an index point; gore area present at every diverge |
| Footpaths (R-FOOT) | Generated from road edges where the class needs them and the data has none; footpath vertices inside a carriageway |
| Buildings (R-BLDG) | Overlapping roads or each other; bad polygons (self-crossing, tiny, slivers); duplicates across sources; missing heights inferred from levels or from the area profile |
| Metro and rail (R-RAIL) | Elevated viaducts get piers; stations link to their line and to the street |
| Foot over bridges (R-FOB) | Stairs or ramps connect to footpaths at both ends |
| District stitching (R-STITCH) | Every boundary port is closed (connector, junction, loop or explained dead end); connector grades and curve radii within the limits for their class; no connector crosses a district interior unless it is a real road there; clip polygons do not overlap after placement; districts keep a minimum gap for the connector corridor; no transform has a rotation, a scale or a mirror |
| Hero roads (R-HERO) | Every hero road has a spec file; the baked lane count, widths, median, kerbs and footpaths equal the spec; the repair layer never changes a hero road's cross-section on its own; each spec field has a reference |
| Terrain (R-TERR) | No ground vertex above the road inside a corridor; no road vertex more than the limit above its ground unless it is a structure; height source outliers against the road profile |

### Issue record

One JSON object per issue in `issues.json` of the bake output (read by the inspector):

`id` (a stable hash of the rule and the feature ids), `rule`, `district`, `tile`, `lat`, `lon`, `x`, `z`, `features` (source ids), `impact` (0 to 1, from road class, hero status and distance to mission places), `confidence`, `status` (open, auto_repaired, overridden, explained), and `proposals`: a list of `{action, params, confidence, reasoning, preview}` where `preview` is a polyline in district metres that the inspector draws.

### Repair log

`repairs.jsonl` in the bake output, one line per applied repair: rule, issue id, before, after, confidence, and the patch in the same form as an override. A summary goes to `harness/reports/map/health.json`. Repairs are data: each one can be switched off by an override naming its issue id. Repair instead of drop; every drop is logged with its source id.

### Overrides format

`harness/data/overrides/<district>/<tileX>_<tileZ>.json` (Rec OV1), one array of patches:

```json
{
  "id": "ov_cp_0012",
  "issue": "R-ROAD-01:way/123:way/456",
  "action": "connect",
  "target": { "ids": ["way/123", "way/456"], "anchor": { "lat": 28.6312, "lon": 77.2190 }, "tolerance_m": 15 },
  "params": { "to": "way/456" },
  "why": "Radial 3 joins the outer circle here in street photos",
  "by": "owner",
  "source": "inspector",
  "date": "2026-11-12"
}
```

(Values are illustrative.) Actions: `connect`, `terminate`, `remove`, `set_tag`, `move_node`, `set_lanes`, `set_height`, `replace_geometry`, `disable_repair`. A patch is filed under the tile of its anchor. On a new extract the target is found by id first, then by the anchor within the tolerance. A patch whose target is not found is listed as stale in the health report and stays in the file; it is never dropped silently. Claude writes patches after reading shots of the site; Anmol's inspector choices write the same format.

## Elevation solver

Rec EL1. One height per node, solved on the whole graph, so two roads can never disagree about a shared node.

- Ground roads stay close to the ground model (weighted, so noise in the model is smoothed along the road).
- Grades and vertical curves stay inside limits per road class.
- Where one road crosses over another, the solver keeps the clearance. Tags (`layer`, `bridge`, `tunnel`) only say which road is above; they never set a height.
- Bridges and flyovers are smooth profiles between abutments. The solver places the abutments, so a ramp gets the length its climb needs.
- Connectors are ordinary roads between ports with fixed end heights.
- Output: a height for every lane-edge vertex, plus supports: abutments, piers and embankments.

Tests: no step at any node; grade and clearance within limits; every structure end touches the ground.

## Lane-level road model

Rec LN1. This is the top Fable task.

- **Reference line and lane sections.** Each road has a reference line. Along it, lane sections list the lanes on each side with a width function, so a taper, a lane drop or a gore is plain data. Widths come from the `lanes` and `width` tags, or from Delhi defaults per class. Traffic is left-hand.
- **Diverges and merges** get proper taper lengths and gore areas. Lanes shift sideways and separate; two carriageways never share an index point. A split gives each branch its own reference line and its own height profile.
- **Flyovers**: the centre lanes climb while the left and right service lanes continue at grade. Side lanes taper into the start of the next flyover.
- **Junctions** are objects built from node clusters, with connecting lanes for every allowed movement.
- **The same model feeds everything**: the road mesh, the kerbs and railings, the colliders, the navmesh and the lane graph that traffic and police follow.
- The file format is our own JSON, modelled on OpenDRIVE (the road simulator standard), not its XML.

Checks (in the rule engine and the gate counts): no overlapping road faces; lane continuity through every split and merge; taper length within the limits for the road class.

## Hero roads

Anmol (2026-11-10): some roads must be realistic, like the CP ones, Janpath, Lutyens and the gardens. Rec HR1.

- A hero road keeps its real layout from OSM at true scale, like every road inside a district, and adds a checked cross-section.
- **Spec file** `harness/data/hero_roads/<id>.json`: the OSM ways it covers, lanes per direction and their widths, median type and width, kerb type, footpath width per side, parking, roundabout islands (radius, lanes, entries), tree lines (species, spacing, offset from the kerb), street furniture (lamp type and spacing, bollards, railings, signals, benches), special edges (the CP colonnade, garden railings and gates), and for each field a reference photo link with its licence.
- The spec overrides tags and class defaults. The repair layer never changes a hero road's cross-section on its own (rule R-HERO).
- **Check**: lookproof poses matched to the reference photos, side by side on a sheet that the verifier reads; the same pairs show in the inspector for Anmol.
- **First hero roads**: the CP inner, middle and outer circles and the radials; Janpath with the market; the Lutyens avenues and roundabouts (Kartavya Path, the India Gate hexagon, Safdarjung Road); the edges of Lodhi Garden and the India Gate lawns.
- Ordinary roads come from the lane model and the area profiles.

## Junction mesh builder

Rec J3. Each junction surface is built from lane edges: the arms are cut back, neighbouring arms are joined with corner arcs, and one surface is triangulated. A polygon union of all road surfaces then proves that the overlap area is zero, and is the fallback for clusters the construction cannot solve. Kerbs, railings and parapets are outputs of the same builder: every free deck edge gets an edge treatment, and its collider comes from the same curve.

## Terrain that fits the roads

Rec TF2. Inside districts the ground is a set of block polygons triangulated to the exact road, footpath and building edges, with heights from the solver. Road and ground share their edge, so nothing floats or sinks and no depth bias hides a misfit. A height grid is used only for open land (the floodplain, the Ridge, the golf course) and the backdrop ring. Bridges and flyovers get real supports and ends.

## Map inspector (human in the loop)

Rec MI1 and IV1: a separate web page in this repo, linked from the dashboard and served on the dashboard port. It reads the baked tiles and `issues.json`. A Godot tool scene and an editor plugin were the other options (ARCH_OPTIONS.md).

- It shows the repaired map in 3D with a north-up top view, and every open issue marked.
- Click an issue and the camera flies to it.
- Claude has already proposed options with 3D preview lines ("connect to road A", "connect to road B", "terminate here", "remove"), each with a confidence score and the reasoning.
- Anmol picks one or types a note. The choice is written to that tile's overrides file, which survives re-bakes, and to the inbox (`harness/state/inbox.jsonl`, source `inspector`), so the loop sees it.
- Claude handles clear cases itself and queues only unclear or high-impact ones, sorted by impact.
- Layers: issues; lanes (widths, splits, merges, tapers, so Anmol can check ramps); hero roads beside their reference photos; districts and connectors; areas and landmarks (`DELHI_WORLD.md` "Map inspector").
- An "open in game" button teleports the running game to the same spot through the debug server, so he can see the true game picture.
- three.js is a dev dependency of the harness only. The page uses no outside map tiles or services.

It is an early task right after the architecture sign-off, so Anmol can start reviewing during the pilot. Like the dashboard, it never blocks work: open items wait in the queue while Claude keeps building. Build order: issues and lanes first, then hero roads and districts, then areas and landmarks.

## Verification

- A **map health report** per bake (`harness/reports/map/health.json`): issues found by rule, repaired automatically, fixed by overrides, stale overrides, and left open.
- **Gate counts**: at each phase gate, open boundary ports, floating ends, unjoined ends, overlapping road faces, broken lane continuity at splits and merges, and tapers out of limits are zero, or each remaining one is explained in the report.
- **Tests in the bake**: no ground above a road inside a corridor; collider against drawn surface within 0.05 m on sampled points; tile seams match exactly; a known landmark lands at its district position.
- The **verifier screenshots every repaired site** (before and after where possible) and reads them. Hero roads are read against their reference photos.
- A **map health panel** on the dashboard shows the latest report and links to the map inspector.

## Pilot

Anmol's pick (sitting 2): Connaught Place with Jantar Mantar, India Gate, ITO with Pragati Maidan, and Chandni Chowk with Red Fort, about 7.2 km2, joined by Janpath, Barakhamba Road and BSZ Marg as connectors. The New Delhi station forecourt may join as a small extra for mission M01 (decisions.md "Game design record"). The hard cases are all inside it:

- Connaught Place: radial roads, inner and outer circles, the first hero roads.
- The ITO and Pragati Maidan flyovers: stacked flyovers, ramps, the tunnel.
- Chandni Chowk: dense old city, narrow lanes, buildings tight to roads.
- India Gate: the hexagon and the Lutyens avenues.
- One metro line: an elevated viaduct, stations, foot over bridges (which line is still open, `DELHI_WORLD.md` section 9).
- Three connectors, so stitching is proven in the pilot too.

Then the first release districts, then the later unlocks.

## Model tier

Fable tier tasks (project rules, "Fable tier"): the lane-level road model first, then the repair rules and auto-repair, the elevation solver, the junction and lane mesh builder, terrain that fits roads, and the coordinate system and bake pipeline. The map inspector page is a normal builder task.
