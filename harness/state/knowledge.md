# Knowledge (core)

Gotchas that hold across every area of this repo, one line each. Area gotchas go in harness/state/knowledge/<area>.md (area names match the docs/READ_MAP.md headings). Keep this file under 12 KB; the planner's CONSOLIDATE mode merges and prunes.

- Every harness page is opened with ?debug=1&verify=1 (kit.config.json pageQuery). Debug UI must hide under verify=1 or it shows in every shot.
- A console.error fails verification. Use console.warn or nothing for expected situations.
- Wait on game conditions in sim time (window.__sim until/waitSim), never on fixed wall clock sleeps: a loaded machine runs less game per ms.
- Lessons from the old game are in harness/design/SALVAGE_AUDIT.md: section 5 (root cause of each base-layer failure) and section 8 (one-line rules). Read the rows for your area before building roads, terrain, tiles, physics or the bake.
- Dashboard: if http://localhost:4488/ answers 'missing dashboard', the running server is stale (started before a folder rename). Kill the process on 4488 and start node harness/bin/dashboard.mjs again.
