# Map repair layer

Design for Kalesh (the game was called Dilli Darshan until 2026-11-10). Signed with the architecture by Anmol on 2026-11-11: "Yes, I sign off on the architecture." (decisions.md "Architecture record (P0-022)"). This is the binding design of the map pipeline. The measured comparison behind it is in [`ARCH_OPTIONS.md`](ARCH_OPTIONS.md) sections 4 and 7, "Map repair layer and map inspector plan" and "District layout recommendation" (benches P0-018 data, P0-019 roads, P0-029 stitch); ids in brackets (RE1, LN1 ...) point at its rows. Every number is an estimate unless it names a report file.

Related: [`DELHI_WORLD.md`](DELHI_WORLD.md) (the composite map, landmarks and area profiles), `SALVAGE_AUDIT.md` sections 5 and 8 (why the old game's base layer failed).

## Why

Source map data is broken. OSM and the other sources have roads that should join and do not, roads that do not touch the ground, flyovers that end in mid air, buildings on top of roads, and missing footpaths. The old game built meshes straight from that data, so every flaw showed on screen. Kalesh puts a repair layer between the sources and the mesh build: it finds what is broken and fixes it, on every bake, with a log.

The bake runs offline in Node and TypeScript under `tools/bake/` (B1). The Godot game only reads the finished `KTL1` tiles (T1, format in TECH.md "Tile format"). Nothing in the game reads raw sources. Module layout: `docs/ARCHITECTURE.md` "Target module map".

## Sources

Licences below were checked at the source by P0-018 on 2026-11-11 (URL, date and the licence phrase are in `harness/reports/arch/pilot_data.json` and `world_sources.json`; every downloaded file is pinned by date and checksum in `data/SOURCES.json`). Not readable by the script and still beliefs: the ASI copyright page, the Sentinel notice, CartoDEM. One belief was wrong: the Microsoft footprints are CDLA Permissive 2.0, not ODbL. Anmol's release is free and public; the standing preference is sources that would still allow a later sale (decisions.md "Speeds and map size").

| Use | Source | Licence and credit | Quality check in the pilot | Status |
|---|---|---|---|---|
| Road network | OpenStreetMap, a fresh extract of the block boxes | ODbL 1.0. Credit "© OpenStreetMap contributors" in the game. A derived database that is shared must be offered under ODbL, so the repaired map data is published openly (owner answer, architecture round 1) | Share of roads with `lanes`, `width`, `oneway`, `layer` and `bridge` tags; dangling ends; unjoined crossings | The only road source (RS2) |
| Road cross-check | Overture Maps, transportation theme | ODbL 1.0 (checked) | Measured (pilot_data.json): every carriageway segment is OSM (6 of 4,712 also carry a TomTom property). It adds nothing | Not used |
| Buildings | Overture Maps, buildings theme: OSM, Microsoft, Google Open Buildings and Esri already merged, with a source tag per building | ODbL (Overture release notes). Credit OSM and Overture | Duplicates left, OSM tags kept, coverage in Old Delhi | Used (BS1). Landmarks join on OSM directly, because Overture drops the wikidata tag |
| Buildings, fallback | Our own merge of OSM, Google Open Buildings (CC BY 4.0 or ODbL, checked) and Microsoft footprints (CDLA Permissive 2.0, checked: the licence text goes with any shared copy of the data, no share-alike) | as listed | Measured (pilot_data.json): more coverage (28% against 26% in Chandni Chowk) but 1,858 footprints with a road centre line through them against 7 | Not used: Overture is better on roads |
| Building heights | OSM `height` and `building:levels`, Overture `height`, then the area profile's floor counts; landmarks by hand. Google Open Buildings 2.5D is not used (it needs an Earth Engine account; owner answer, round 2) | as above | Share of buildings with any height (4 to 19% in the pilot, measured) | In order |
| Ground height | GEDTM30, a 30 m bare-earth model, smoothed over 60 m | CC BY 4.0 (checked on the Zenodo record, which calls the release a test release). Credit line | Measured (terrain_sources.json): raw it fails (worst step 2.72 m in 15 m along roads); smoothed over 60 m it passes (roughness 0.03 m, worst step 0.49 m, 0 outliers) | Used (GS1), smoothed over 60 m |
| Ground height, fallback | Copernicus GLO-30 (a surface model) with our own ground filter: sample only roads, parks and open ground, drop cells under buildings, fit a smooth surface | Free with a credit line, commercial use allowed | Same checks | Fallback if GEDTM30 is withdrawn (GS2) |
| Ground height, cross-check only | FABDEM | CC BY-NC-SA 4.0: non-commercial and share-alike. Never shipped, never baked into tiles | Used as the yardstick in the bench | GS3 |
| Ground height, out | CartoDEM | Needs a Bhuvan account (an owner action); reuse terms unclear | none | Out unless GS1 and GS2 both fail |
| Reference for hero roads and repairs | Street photos (Mapillary, Wikimedia Commons) and Sentinel-2 imagery | Per image; reference only. Linked by URL with the licence noted. Never baked into the game | Read by eye | Reference |

Why not a surface model as it is: rooftops and trees in the data make roads float or sink (`SALVAGE_AUDIT.md` section 6).

## Pipeline (runs on every bake)

0. **Map selection** (once, then on change). `harness/data/districts.json` lists the blocks and districts. A block is one continuous piece of real city with one frame (the centre block is the whole centre of Delhi at true scale; each far district is its own block). A district has a block, a stage (pilot, release, later) and a focus flag. Outlines follow real edges (arterials, rail lines, walls, the river, park edges). The outer edge of the map and the corridors get an edge band of 60 to 100 m of low detail shells. Only data inside a block outline plus the band is ingested (CG2, DC2, FL4; owner decision "One seamless open city, no gaps").
1. **Ingest and normalise** every source into one topology graph per block: nodes, edges with layer, level, width, surface and class, and polygons for buildings, areas and platforms. One coordinate space from here on: block-local metres, east +X, north -Z. Every space has a named type in the code, and a magnitude check runs where baked data enters the game.
2. **Pair and classify.** Two one-way OSM ways of one street are recognised as one street before any width is assigned. Each road gets a class with Delhi defaults (left-hand traffic).
3. **Validate** with the rule engine. Every issue gets a stable id, a rule id, a place (lat and lon, block metres, tile), an impact score and a confidence.
4. **Auto-repair**, deterministic and logged (AR1): a repair applies on its own when its confidence is 0.8 or more and its impact is low ("Auto-repair bounds" below). Everything else is queued for the map inspector with proposals. A queued issue never blocks a bake: its top proposal is applied as provisional until Anmol picks. Measured on the pilot (pilot_data.json): 1,052 issues, 73% automatic, 27 high impact ones queued.
5. **Overrides**: patch files per world tile, versioned in git, applied after auto-repair. They survive re-bakes and new extracts.
6. **Lane model**: roads become reference lines with lane sections; junctions become objects (below).
7. **Corridors and the map edge**: inside a block streets simply run on, with no ports. Far districts are joined to the centre by corridors: authored connectors (`harness/data/connectors/<id>.json`, "Connector format" below) built by the same lane model (SC1), with generated city from the neighbouring area profiles on both sides (FL4). Roads that leave the map through its outer edge end at a boundary port and are closed by rule: a gate, a loop, a barricade or an explained dead end (measured: 80.2% of ports close by rule, stitch.json).
8. **Elevation solver**: one height per node on the whole graph, connectors included (below).
9. **Mesh build** from the repaired, stitched and solved graph only: lane surfaces, junction surfaces, kerbs, railings and parapets from deck edges, ground fitted to the road edges, colliders from the same vertices, navmesh polygons, lane graph for traffic.
10. **Tiles and reports**: 250 m tiles with a version stamp and a byte budget; the map health report; the issue list for the inspector. A failed invariant stops the bake before it writes tiles.

## District frames and stitching

Signed 2026-11-11. The map is one continuous open world with no bare ground (decisions.md "One seamless open city, no gaps"; layout C's district list and stages, `DELHI_WORLD.md` section 0). Data: `harness/data/districts.json`. Contract: TECH.md "World layout".

- **Blocks.** A block is one continuous piece of the map with one frame and one road graph. The centre block runs from Kashmere Gate to Nizamuddin and from Karol Bagh and the Central Ridge to the east bank with Laxmi Nagar, with the Yamuna and its floodplain drawn as the real place. Its frame is the transverse Mercator of `tools/geo/projection.ts` around India Gate, at factor 1.0: every real place sits at its real position, so every pair keeps its real bearing and distance. Each far district (Mehrauli with Qutub, Vasant Kunj, the airport, Cyber City; later Noida) is its own block with its own frame origin.
- **Placement method.** `offset = pivot.world + factor * geoToWorld(origin, pivot)`, pivot India Gate at world (621.6, 467.2). Factor 1.0 for the centre, 0.5 for every far block (owner answer, round 2). A real point lands at `offset + geoToWorld(lat, lon, block origin)`. Translation only: no rotation, no scale, no mirroring, so north stays -Z everywhere. No offset is set by hand.
- **Focus districts** (`districts` in the file) are outlines inside a block where hand attention goes: hero roads, hand-drawn area profiles, inspector review. They are not cuts: inside a block streets simply run on, with no ports and no connectors. Places with a block and a placement but no outline yet are listed under `planned`.
- **Pair gate.** The bake prints the pair table (real against game bearing and distance, by the geodesic on the ellipsoid) into the health report (`pairs`, with the other layout numbers in `layout`) and fails if a pair inside the centre block is off by more than 0.5 degrees or 0.5%. The places are `harness/data/districts/places.json` (24 centre places today, each read from a named OpenStreetMap element); once tiles are written the same gate runs on the pin positions read back from the tile bytes. A centre place paired with a far place may be off by up to about 20 degrees at factor 0.5 (computed); far places are exact as seen from India Gate (gate: 0.1 degree, 0.5% of half the real distance).
- **Far blocks stay compact.** A far block is true scale inside but sits at half its real distance, so two far blocks close together in reality collide unless they are small. Their outlines (`harness/data/districts/<id>.geojson`, drawn in P1-008 with checked frame origins: Qutub Minar, DLF Promenade, Terminal 3, DLF Cyber Hub) must not overlap any other block once placed and must keep 250 m clear for a corridor. Measured: least gap 371 m (Mehrauli and Vasant Kunj). Aerocity is left to the airport road corridor: inside the airport block it would land on the Vasant Kunj malls.
- **World origin** stays at the centre of the layout C map box (India Gate at 621.6, 467.2) until the first bake with a far block, which runs the recentre step (`tools/bake/layout/recentre.ts`): one vector, a whole number of 250 m tiles, subtracted from every stored position, so the origin sits on the centre of the smallest circle round the map. Measured: that circle has a radius of 7.98 km and the farthest position is 8.03 km out after the step, inside the 8,192 m where a 32-bit float still steps by 0.49 mm (FP1, measured fine at 7 km). The centre of the map box would leave Cyber City 9.0 km out.
- **World grid.** Tile ids come from world metres on one 250 m grid (`tools/bake/layout/grid.ts`), shared by the tile cutter, the overrides files and the inspector.
- **Records.** The bake records the block id with every tile, landmark, mission anchor and spawn point.
- **Landmark tests** check the position in the block frame within the tier tolerance (`DELHI_WORLD.md` "6. Verification"). A second test checks the relative layout (Red Fort is north-east of Jama Masjid at the true distance).
- **Height.** A block has one ground model and one height solve, so there is nothing to stitch inside it. A far block keeps its real ground heights, shifted by one height offset solved over all its joins together (one median per district left 9 m of fall inside Chandni Chowk in the bench, measured).
- **No bare ground.** Inside the centre the space between focus districts is real city from the same sources (Paharganj, Karol Bagh, Daryaganj, Mandi House, Pragati Maidan and the rest), with archetype area profiles chosen by rule. Corridors to far blocks carry generated city from the neighbouring area profiles, blended across the edge. Real open land (the river and floodplain, the Ridge, lawns, rail yards) is drawn as the real place. Generated city never takes the name of a real colony; it carries the real name of the road it runs along.
- **Bridges over the Yamuna** inside the centre block are real OSM roads, built by the lane model and the elevation solver with a deck rule over water. They are not connectors.
- **The map edge.** The outer edge of the map and the sides of corridors get an edge band of 60 to 100 m of low detail shells (16% more tile data, measured). Roads that leave the map end at a boundary port and close by rule (gate, loop, barricade or an explained dead end; 80.2% closed by rule in the bench). Code: `tools/bake/layout/edge.ts` (roads cut at an outline, ports) and `closures.ts` (one closure per port), moved from the stitch bench; they are used only where the map really ends, never between focus districts.
- **Map and minimap** show the game layout, north up. Real names stay on real places; a connector carries the real name of the road it stands for (Ring Road, NH-48).

### Connector format

A corridor to a far block is one file `harness/data/connectors/<id>.json`, built by the lane model and the elevation solver like any real road (code: `tools/bake/connectors/connectors.ts`; `specProblems` checks the file).

| Field | Meaning |
|---|---|
| `id` | lower case letters, digits and underscores; the file name |
| `name`, `standsFor` | the real road's name, shown on the map and signs, and the real road it stands for |
| `kind` | `ring_arc`, `flyover`, `bridge` or `link` |
| `status` | `draft`, `checked` (read in the inspector) or `bench_only` |
| `class` | road class with a design speed and a least curve radius: motorway 80 km/h and 230 m, trunk 60 and 120 m, primary 50 and 80 m, secondary 40 and 50 m, tertiary 30 and 25 m |
| `lanes` | `{forward, backward}`, at least one each way (the same count both ways until the lane model builds uneven ones) |
| `from`, `to` | `{block, port}`: the block it leaves and the name of the road at that port (the bench files still say `district`) |
| `points` | control points `{x, z}` in world metres (east +X, north -Z); the first and last lie on the two ports. A smooth curve through them leaves each end along the port's road |
| `spans` | optional `{from, to, kind, layer, over}`: control point numbers a bridge or flyover runs between, and what it passes over |
| `under` | optional roads or tracks it passes over, authored the same way and built on the ground under it |
| `notes` | free text |

Rules (R-STITCH): no key can carry a rotation, scale, mirror or flip; grades and curve radii stay inside the class limits; clearance over anything under it is at least 5.5 m; each end sits within 0.05 m of its port; the height step at a port is under 0.1 m; a connector never runs through the inside of a block. Measured on the three bench connectors (stitch.json): 0 violations, 47 to 130 ms to bake each. The three files in the folder today were placed for the island layout of the stitch bench and are marked `bench_only`. The first release corridors (Aurobindo Marg, the Ring Road south arc with Dhaula Kuan as an authored junction, NH-48, MG Road, the airport road) are listed in `districts.json` `corridors` and are authored when the far blocks are built.

## Rule engine

Rules are TypeScript modules in `tools/bake/rules/` (RE1). Each has an id, an area, a detect function, an optional repair function, a confidence, unit tests and a line in the generated catalogue. Rules run in a fixed, tested order. The same input always gives the same output.

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
| Layout and stitching (R-STITCH) | The signed seamless rule, run before the first bake step (`tools/bake/layout/gate.ts`): 01 the layout file follows the placement method (factors 1.0 and 0.5, offsets by the method, no key that could carry a rotation, a scale or a mirror); 02 every block is placed by a translation only (north on -Z, east on +X, determinant +1, no scale); 03 every pair of centre places keeps its real bearing within 0.5 degrees and its real distance within 0.5%; 04 every far block's origin is on its real bearing from India Gate within 0.1 degree at 0.5 of its real distance within 0.5%; 05 placed outlines of different blocks do not overlap and keep 250 m for a corridor; 06 the map box is under 16 km wide and no position is more than 8,192 m from the world origin, today and after the recentre. Inside a block there are no ports: streets run on through focus districts. Still to add with the corridors and the map edge: every boundary port at the map edge is closed (connector, junction, loop or explained dead end); connector grades and curve radii within the limits for their class; no connector runs through the inside of a block |
| Hero roads (R-HERO) | Every hero road has a spec file; the baked lane count, widths, median, kerbs and footpaths equal the spec; the repair layer never changes a hero road's cross-section on its own; each spec field has a reference |
| Terrain (R-TERR) | No ground vertex above the road inside a corridor; no road vertex more than the limit above its ground unless it is a structure; height source outliers against the road profile |

### Rules added before the pilot bake

The eight rules of the census stay. Added before the pilot bake (from the road and stitch benches): R-LANE-FIT (shift a carriageway drawn closer than its lanes are wide; redraw a slip road drawn as a short diagonal; take a lane count from the road ahead), whole-street lane inference (the 4 taper findings at ITO), and the metro, foot bridge, stitch, hero and remaining terrain rules of the table above. Each rule has unit tests and runs in under about 60 ms per district (eight rules measured at 14 to 54 ms).

### Auto-repair bounds

A repair applies on its own at confidence 0.8 or more and a low impact. Low impact means: a join of 5 m or less; a missing bridge layer tag; a building reaching 1.5 m or less into a class-default road width (the width gives way, the building stays); an exact duplicate footprint; a height outlier of 3 m or less; a sideways carriageway shift of 2.5 m or less. Never automatic: anything on a hero road, a one-way with no pair (marked explained, never changed: the CP radials are true one-ways), a slip road redraw over 2.5 m, a change of lane count on a trunk or primary road. A queued issue never blocks a bake: its top proposal is applied as provisional, drawn in the game and listed in the inspector, and Anmol's pick replaces it through an override. Pilot census (pilot_data.json): 1,052 issues, 768 (73%) automatic, 284 queued, 27 of them high impact. Planning rates: about 75 issues and 2 high impact ones per km2 in the planned centre, about 420 per km2 in dense unplanned fabric such as Laxmi Nagar (almost all automatic building slivers).

### Issue record

One JSON object per issue in `issues.json` of the bake output (read by the inspector):

`id` (a stable hash of the rule and the feature ids), `rule`, `block`, `district` (the focus district, if any), `tile`, `lat`, `lon`, `x`, `z`, `features` (source ids), `impact` (0 to 1, from road class, hero status and distance to mission places), `confidence`, `status` (open, auto_repaired, overridden, explained), and `proposals`: a list of `{action, params, confidence, reasoning, preview}` where `preview` is a polyline in block metres that the inspector draws.

### Repair log

`repairs.jsonl` in the bake output, one line per applied repair: rule, issue id, before, after, confidence, and the patch in the same form as an override. A summary goes to `harness/reports/map/health.json`. Repairs are data: each one can be switched off by an override naming its issue id. Repair instead of drop; every drop is logged with its source id.

### Overrides format

`harness/data/overrides/<tileX>_<tileZ>.json` (OV1), one array of patches per world tile (the tile indices of the one 250 m world grid). The sample patches of the data bench under `harness/data/overrides/<district>/` move to this layout with the first rule engine task.

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

EL1. One height per node, solved on the whole graph, so two roads can never disagree about a shared node.

- Ground roads stay close to the ground model (weighted, so noise in the model is smoothed along the road).
- Grades and vertical curves stay inside limits per road class.
- Where one road crosses over another, the solver keeps the clearance. Tags (`layer`, `bridge`, `tunnel`) only say which road is above; they never set a height.
- Bridges and flyovers are smooth profiles between abutments. The solver places the abutments, so a ramp gets the length its climb needs.
- Connectors are ordinary roads between ports with fixed end heights.
- Output: a height for every lane-edge vertex, plus supports: abutments, piers and embankments.

Tests: no step at any node; grade and clearance within limits; every structure end touches the ground. Production needs a sparse solver for a whole block (the bench solver is dense and cubic: ITO 421 knots in 59 ms), and crossfall and vertical curve limits.

## Lane-level road model

LN1. This is the top Fable task. Proven on ITO and the CP inner circle (roads.json): 0 m2 overlap, 0 lane continuity breaks, 0 height steps.

- **Reference line and lane sections.** Each road has a reference line. Along it, lane sections list the lanes on each side with a width function, so a taper, a lane drop or a gore is plain data. Widths come from the `lanes` and `width` tags, or from Delhi defaults per class. Traffic is left-hand.
- **Diverges and merges** get proper taper lengths and gore areas. Lanes shift sideways and separate; two carriageways never share an index point. A split gives each branch its own reference line and its own height profile.
- **Flyovers**: the centre lanes climb while the left and right service lanes continue at grade. Side lanes taper into the start of the next flyover.
- **Junctions** are objects built from node clusters, with connecting lanes for every allowed movement.
- **The same model feeds everything**: the road mesh, the kerbs and railings, the colliders, the navmesh and the lane graph that traffic and police follow.
- The file format is our own JSON, modelled on OpenDRIVE (the road simulator standard), not its XML.

Checks (in the rule engine and the gate counts): no overlapping road faces; lane continuity through every split and merge; taper length within the limits for the road class.

## Hero roads

Anmol (2026-11-10): some roads must be realistic, like the CP ones, Janpath, Lutyens and the gardens. HR1.

- A hero road keeps its real layout from OSM at true scale, like every road inside a district, and adds a checked cross-section.
- **Spec file** `harness/data/hero_roads/<id>.json`: the OSM ways it covers, lanes per direction and their widths, median type and width, kerb type, footpath width per side, parking, roundabout islands (radius, lanes, entries), tree lines (species, spacing, offset from the kerb), street furniture (lamp type and spacing, bollards, railings, signals, benches), special edges (the CP colonnade, garden railings and gates), and for each field a reference photo link with its licence.
- The spec overrides tags and class defaults. The repair layer never changes a hero road's cross-section on its own (rule R-HERO).
- **Check**: lookproof poses matched to the reference photos, side by side on a sheet that the verifier reads; the same pairs show in the inspector for Anmol.
- **First hero roads**: the CP inner, middle and outer circles and the radials; Janpath with the market; the Lutyens avenues and roundabouts (Kartavya Path, the India Gate hexagon, Safdarjung Road); the edges of Lodhi Garden and the India Gate lawns.
- Ordinary roads come from the lane model and the area profiles.

## Junction mesh builder

J3. Each junction surface is built from lane edges: the arms are cut back, neighbouring arms are joined with corner arcs, and one surface is triangulated. A polygon union of all road surfaces then proves that the overlap area is zero, and is the fallback for clusters the construction cannot solve. Kerbs, railings and parapets are outputs of the same builder: every free deck edge gets an edge treatment, and its collider comes from the same curve. The polygon union uses `clipper2-ts` and simple faces are cut with `earcut`, both in the bake only (owner answer, round 2).

## Terrain that fits the roads

TF2. Inside blocks the ground is a set of block polygons triangulated to the exact road, footpath and building edges, with heights from the solver. Road and ground share their edge, so nothing floats or sinks and no depth bias hides a misfit. A height grid is used only for open land (the floodplain, the Ridge, the golf course) and the backdrop ring. Bridges and flyovers get real supports and ends. Production uses a constrained Delaunay ground with points inside the blocks (ear clipping alone gave 80% needle triangles and no relief inside a block, measured), cut at the 250 m tile edges.

## Map inspector (human in the loop)

MI1 and IV1: a small web page in this repo (`tools/inspector/`), linked from the dashboard and served on the dashboard port. It reads the baked tiles and `issues.json`.

- It shows the repaired map in 3D with a north-up top view, and every open issue marked.
- Click an issue and the camera flies to it.
- Claude has already written proposals with 3D preview lines ("connect to road A", "connect to road B", "terminate here", "remove"), each with a confidence score and the reasoning.
- Anmol picks one or types a note. The choice is written to that tile's overrides file, which survives re-bakes, and to the inbox (`harness/state/inbox.jsonl`, source `inspector`), so the loop sees it.
- Claude handles clear cases itself and queues only unclear or high-impact ones, sorted by impact.
- Layers: issues; lanes (widths, splits, merges, tapers, so Anmol can check ramps); hero roads beside their reference photos; districts and connectors; areas and landmarks (`DELHI_WORLD.md` "Map inspector").
- An "open in game" button teleports the running game to the same spot through the debug server, so he can see the true game picture.
- three.js is a dev dependency of the harness only. The page uses no outside map tiles or services.

It is the first task after Phase 0, so Anmol can start reviewing during the pilot. Like the dashboard, it never blocks work: open items wait in the queue while Claude keeps building. Build order, one task each: (1) issues, with the 27 high impact pilot issues first; (2) lanes (widths, splits, merges, tapers; ITO has 10 split zones and 4 taper findings); (3) hero roads beside their photos, focus outlines, corridors and roads that end at the map edge; (4) areas and landmarks (the 351 pilot candidates with their proposed tiers, the 7 name-fallback matches flagged).

## Verification

- A **map health report** per bake (`harness/reports/map/health.json`): issues found by rule, repaired automatically, fixed by overrides, stale overrides, and left open.
- **Gate counts**: at each phase gate, open boundary ports, floating ends, unjoined ends, overlapping road faces, broken lane continuity at splits and merges, and tapers out of limits are zero, or each remaining one is explained in the report.
- **Tests in the bake**: no ground above a road inside a corridor; collider against drawn surface within 0.05 m on sampled points; tile seams match exactly; a known landmark lands at its district position.
- The **verifier screenshots every repaired site** (before and after where possible) and reads them. Hero roads are read against their reference photos.
- A **map health panel** on the dashboard shows the latest report and links to the map inspector.

## Pilot

Anmol's pick (sitting 2): Connaught Place with Jantar Mantar, India Gate, ITO with Pragati Maidan, and Chandni Chowk with Red Fort. In the signed seamless map the pilot is the pilot centre, one continuous piece of the centre block: those four as focus districts plus Paharganj with the New Delhi station, GB Road and everything between them, about 20 km2 (estimate). Janpath, Barakhamba Road, Minto Road and BSZ Marg are ordinary real roads inside it. The station forecourt for mission M01 is inside it. The hard cases are all inside it:

- Connaught Place: radial roads, inner and outer circles, the first hero roads.
- The ITO and Pragati Maidan flyovers: stacked flyovers, ramps, the tunnel.
- Chandni Chowk: dense old city, narrow lanes, buildings tight to roads.
- India Gate: the hexagon and the Lutyens avenues.
- One metro line: the Blue Line stretch from Mandi House past Pragati Maidan to Indraprastha (elevated viaduct, stations, foot over bridges; planner call P0-022, `DELHI_WORLD.md` section 4).
- The Yamuna bank at ITO, so the river edge and the start of the Vikas Marg bridge are proven in the pilot. Corridors are proven with the first far block.

Then the rest of the centre block with Laxmi Nagar, then the far blocks with their corridors, then the later unlocks.

## Model tier

Fable tier tasks (project rules, "Fable tier"): the lane-level road model first, then the repair rules and auto-repair, the elevation solver, the junction and lane mesh builder, terrain that fits roads, and the coordinate system and bake pipeline. The map inspector page is a normal builder task.
