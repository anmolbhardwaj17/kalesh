# Notes for the next phase

Things found during a phase that belong to a later one (moved tasks, ideas, known gaps). The planner reads this at PLAN_PHASE and folds the items in.

## The game plan (P0-023, 2026-11-11)

Phases after P0, in order. P1 and P2 are planned in detail. The others have a goal, exit criteria and milestones only and are planned when reached.

| Phase | Name | Planned |
|---|---|---|
| P1 | Foundation: drive and walk the real pilot centre | 27 tasks |
| P2 | Pilot made rich: landmarks, areas and hero roads in stylised B | 28 tasks |
| P3 | Life and action: traffic, crowds, combat, police, HUD and story tools | 4 seeds (P3-001 plans it) |
| P4 | First playable slice: M01 to M04 | 6 seeds (P4-001 plans it) |
| P5 | Act 1 complete: M05 to M10 and the first switch | when reached |
| P6 | City life in the pilot: fares, patrol calls, jobs and strangers | when reached |
| P7 | The centre opens: the rest of the centre block with Laxmi Nagar | when reached |
| P8 | The far south: Qutub, Vasant Kunj, the airport and Gurugram | when reached |
| P9 | Act 2: Paisa (M11 to M24) | when reached |
| P10 | Act 3: Gaddari (M25 to M38) | when reached |
| P11 | East of the river for Act 4: the floodplain, Shahdara and Noida | when reached |
| P12 | Act 4: Jalaawatan (M39 to M52) | when reached |
| P13 | Act 5: Kalesh (M53 to M67) | when reached |
| P14 | Polish and first release | 3 seeds (P14-001 plans it) |

Rules that hold for every later PLAN_PHASE:
- Every task names its pillar ("Pillar: ..."). Every mission task carries the four fun criteria of VERIFY.md, the driving share check and the respect rule check. Every area and art task carries the respect rule (DELHI_WORLD.md section 3) and cites its area sheet in harness/design/areas/, with an acceptance line that compares game shots with the reference board.
- Check the GAME.md capability list at every plan and say which items the phase builds. A tag changes only with a decisions.md entry.
- **Seeded phases.** `task.mjs phase-add` does not mark a phase as unplanned, so `task.mjs next` would hand out seed tasks as if they were the whole plan. P3, P4 and P14 therefore start with a planner task ("Plan phase <P>") that every seed depends on. A phase with no tasks prints PHASE_NEEDS_PLANNING as usual. If a later planner seeds another phase, add the same planning task there.
- **Milestones.** milestones.json lists M01 to M67. M05 to M67 are optional entries today. The planner of each act's phase writes their beats, fails and checks and sets `required: true`, or the gates will not count them.
- **Fable budget.** 10 of 25 runs were used in Phase 0. The plan tags 10 tasks (below), which leaves 5 for third attempts and hard bugs. PLAN_PHASE for P1 and P2 was done in the P0-023 run. Later plans run on the normal tier. Tag a new core system build as Fable only with room in the budget.

## For P1

Fable tagged (7), one hard thing each:
- P1-008 Layout and block frames in the bake (the coordinate system and map bake pipeline, with district selection and stitching)
- P1-010 Repair rules and auto-repair for a whole block
- P1-012 Lane-level road model for the pilot centre (the top Fable task)
- P1-013 Elevation solver for a whole block
- P1-014 Junction and road mesh builder with the overlap proof
- P1-015 Ground that fits the roads
- P1-019 Streaming core and the first streamed systems

Not tagged on purpose: P1-020 (vehicle model V2 and the car tune). The bench vehicle already measures well, so it runs on Opus; the third attempt rule moves it to Fable if it fails twice. The render pipeline foundation was built in Phase 0 (stylised B); P1-002 only makes it the default.

Style switches: `stylised_b` becomes the default in P1-002. The switches that were not chosen (`stylised`, `stylised_grime`) stay behind `--style=` until the P1 gate and are folded into `stylised_b.gd` and removed in P2-001. `realistic` stays as an unmaintained, documented reference. `--style=none` stays as the flat fast-verify look.

Where each carried item landed:
- From P0-022: perfbudget.mjs reads the scene kind (P1-005); Jolt by name and the C1 sim clock (P1-006); the world origin recentre step is written and tested in P1-008 and used at the first far bake in P8; far district outlines and origins (P1-008); stitch.mjs is island-only and is retired or rewritten (P1-008); CONSOLIDATE of decisions.md, 85 KB (P1-004, early because every agent reads it); the car retune to 140 km/h (P1-020); the auto turn tune (P1-021); collider chunks and bridged deck joints (P1-016) and the chunked attach (P1-019).
- From P0-015: the default look on the day clock (P1-002); the fold of the old styles and one approved reference per light (P2-001); the known gaps of the style bible (polish seeds P14-002 and P14-003; texture, vehicle, people and tree cards in P2-011); area sheets before any area build (P2-002, P2-004 and every area pass); streamed city budgets measured (P1-026, P2-027).
- From P0-020: the GAME.md rewrite for the seamless city and the cutscene runtime was done in P0-022 and is current.
- From P0-035: the reference top-up for ITO, the Chandni Chowk galis, Jantar Mantar and the Red Fort road views is P2-002, before those areas are dressed.
- Owner note on hero roads: P2-015 and P2-016. Owner note on cutscenes and dialogue: seeds P3-003 and P3-004 (slice: in-engine scenes with subtitles and drive talk, jaw by loudness or a timed flap); lip sync, the face set and directed big cutscenes are RELEASE and come with the act phases once voices exist.

Other notes for P1:
- HUD: P1-003 (agent orchestrator, priority 5) shows Anmol the four mockups and asks the six questions of HUD.md. It never blocks: take it by id when he is at the terminal, keep a Needs-you notice until then, and move it on (P2, then P3 at priority 1) if a gate arrives first. The HUD build seed P3-002 depends on it.
- Baked tiles and `data/` are gitignored. P1-018 gives verify a committed test block, a bake hash, and tiles in the snapshot worktree and the play copy. Before it lands, scenarios that need the city cannot run in a snapshot.
- New dev packages (three, flatbush, meshoptimizer, a constrained Delaunay package if one is chosen) each need a decisions.md entry. An install was refused by the permission system once in Phase 0: do not work around a refusal; each task names its fallback.
- The combat foundation and police were listed for the foundation phase in the task text. They are planned in P3 (see the decisions.md entry "Game plan after Phase 0"): they need the navmesh, the lane graph and the crowd, and P1 is full with the base world.

## For P2

Fable tagged (3): P2-005 Landmark registry build, P2-006 Landmark placement pipeline, P2-009 Area profile generator (parcels, building shells, facade placements and edge blending). The kits, dressing, LOD and the look pass are Opus tasks so the generator run does one thing.

- Order: the style fold and the reference top-up first; sign names (content writer); area data; registry, placement, heroes; generator, kits, LOD, dressing, the look on the city; hero roads; inspector steps 3 and 4; the Blue Line; five area passes; three pilot verification tasks; credits.
- The five area passes create the input-only route scenarios the slice missions reuse (route_m01_*, route_m02_*, route_m03_*, route_m04_*).
- Reference photos stay internal: never under game/ or public/, never in a build.
- The pilot must pass P2-027 (perf on the pilot paths) before any scale-up phase starts.

## For P3 (P3-001 plans it)

Systems in build order, all SLICE items of the capability list:
1. Navmesh and lane graph export from the bake (tools/bake/nav/, game/world/systems/navmesh.gd and lanes.gd), one navmesh region per tile joined at the edges. The navmesh build was not measured in Phase 0: measure it.
2. Traffic (TR1, game/ai/traffic.gd): lane followers, signals, gap acceptance, Delhi habits (honking, gap filling, buses pulling out), light to medium density, a traffic car wakes to physics only near the player or when hit (at most 16). The horn as a verb. Near-miss detection and gap weaving.
3. Pedestrians and the crowd (AN2): skinned within 25 m (cap 40), vertex animation to 120 m, 30 to 60 people in the bazaar who walk, part, flee and cower, from the tiles' life points. Civilians can be hurt, with weight; children are never damageable. Re-measure with the real rig.
4. Combat foundation (CB1, moved here from the foundation phase): fists with the 3-hit combo, block, dodge, takedown, lathi or bat, the pistol with soft lock-on and headshots, one thrown item, dropped weapons, hit reactions, up to 8 ragdolls, the GAME.md numbers, the slice enemy kinds.
5. Police and wanted levels 1 to 3 (moved here): raises, witnesses, the search circle and line-of-sight escape, barricades at real junctions, busted and wasted, pursuit on the lane graph. The cop's "call a barricade" uses the same barricade code.
6. Slice vehicles in play: damage (health, smoke, disabled), passengers who talk and react, the patrol car.
7. Mission system: runner, objectives, checkpoints at least every 90 s, fail reasons, instant retry under 3 s, the completion screen, money per character. A small test mission proves the four fun criteria before P4.
8. Save: versioned JSON with a migration test, all three character states from day 1, autosave.
9. HUD (seed P3-002, depends on P1-003), the map screen (north up, districts opened and unopened), title, pause and settings (graphics, audio, subtitles, camera shake).
10. Story runtime (seeds P3-003 and P3-004).
11. Audio base: buses, the three-layer engine blend on the four CC0 placeholders, horns, ambience beds from the area profiles, combat sounds, sirens; requests for the rest.
12. One content writer task (barks for passengers, crowd, police and thugs; UI text) and one art-director task.
Every system re-measures its line of perf_budgets.json `systems` in the pilot.

## For P4 (P4-001 plans it)

- The slice is M01 to M04: four solo missions, Bittu first, no merge and no switching (GAME.md wins over the older task text of P0-023).
- Seeds: the slice script (P4-002, content writer, first) and one mission task per mission (P4-003 to P4-006) with the fun criteria, routes and play scripts in harness/verify/milestones/<ID>.js. Split a mission seed into a scene task and a mission task if it is too big. FD0 stays in milestones.json.
- M03 includes the short standoff with the pistol (decisions.md "Pistol stays in the slice, used in M03"); milestones.json M03 was aligned in P0-023.
- M04 is mostly on foot by its signed beats. Check its on-foot share against the "about 40%" rule first; if the beats cannot meet it, record the exception in decisions.md or lengthen the scooter getaway.
- Add one art task, a set piece pass last, the playtest checklist, a Mac build and a Windows build with a notice.

## For P5 and later

- P5 builds the RELEASE items its missions need: switching at story beats (M10, two switches under 2 s), tailing (M05, M09), the police motorcycle (M05), night (M02 already needs a readable night; M09 is a night tail), the graded flashback look (M06), the pistol fight with more than one enemy (M10), and the four big scenes of Act 1.
- P6: city life per character, stranger chains (STORY_OUTLINE.md section 10), activities, stamps, money and buying, mission replay, ambient life, panic, the full day and night cycle. Trim to what the pilot can hold; the rest moves to the act phases with a note.
- P7 and P8: an art-director research task per new area (area sheet and board) before its build task. Laxmi Nagar has about 420 issues per km2, almost all automatic. P8 runs the world origin recentre and gives the inspector its corridor layer; the three bench_only connector files are replaced by real corridors.
- P9 to P13: the content writer writes each act's lines before its missions; each act's phase also builds the RELEASE systems its missions need (cover for the den raid, more weapons, wanted levels 4 and 5, drive-by, carjacking, interiors, the Metro train as scenery).
- P14: polish seeds P14-002 and P14-003; verifier POLISH lists are added to them as notes during the build, or to a new polish task per area.

## Unsettled (for the planner who reaches it, or for Anmol through the inbox)

- **Act 4 places.** GAME.md tags Noida and Shahdara as later unlocks, but STORY_OUTLINE.md uses them in Act 4 (M43, M48, M49). P11 builds them before Act 4; the tag change needs a decisions.md entry when P11 is planned.
- **Places in the story that are on no map list:** the TV studio in Okhla (M29), the Seva hospital (Act 2 and Noida in Act 4), police HQ (M33, M54). Decide per act: a real place inside the map, an interior, or a move to a place already built.
- **Order of acts and map.** The plan follows Anmol's area order (the rest of the centre, then the far south) before Act 2. If the wait for new missions feels long at the P6 gate, P7 and P8 can be cut to what Act 2 needs (Kashmere Gate, Gymkhana, Daryaganj, Laxmi Nagar and Gurugram) and the rest moved before Act 3.
- **HUD answer.** If Anmol has not answered P1-003 when everything else in P3 is done, P3 waits on the HUD by his own rule (no HUD build before he sees the mockups).
- **Names.** The wanted level name "Lal Batti" and the three working names are still proposals in GAME.md "Open questions".
