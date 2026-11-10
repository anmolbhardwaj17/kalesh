# Knowledge (core)

Gotchas that hold across every area of this repo, one line each. Area gotchas go in harness/state/knowledge/<area>.md (area names match the docs/READ_MAP.md headings). Keep this file under 12 KB; the planner's CONSOLIDATE mode merges and prunes.

- Every harness page is opened with ?debug=1&verify=1 (kit.config.json pageQuery). Debug UI must hide under verify=1 or it shows in every shot.
- A console.error fails verification. Use console.warn or nothing for expected situations.
- Wait on game conditions in sim time (window.__sim until/waitSim), never on fixed wall clock sleeps: a loaded machine runs less game per ms.
- Lessons from the old game are in harness/design/SALVAGE_AUDIT.md: section 5 (root cause of each base-layer failure) and section 8 (one-line rules). Read the rows for your area before building roads, terrain, tiles, physics or the bake.
- Dashboard: if http://localhost:4488/ answers 'missing dashboard', the running server is stale (started before a folder rename). Kill the process on 4488 and start node harness/bin/dashboard.mjs again.
- Verifiers always run in the snapshot (node harness/bin/snapshot.mjs, then work in .worktrees/verify), even with one agent at a time; otherwise their shots mix with the builder's and the dashboard verifier strip stays empty.
- GPU times on this Mac are only true while the GPU is busy. Since about midnight of 2026-11-11 (IST; the cause is not known, it was not so for the P0-009 baseline) a Godot window runs at 120 fps at most even with `--disable-vsync` (Vulkan and Metal), and under that cap the reading is wrong, most likely because the Apple GPU clocks down: any scene cheaper than about 7 ms reads 6 to 7 ms of `gpuMs` (the look B stack over an empty ground reads 6.6 ms and costs 3.6 ms). The stylised B readings of 6.5 to 6.7 ms (P0-037, perf_budgets.json "measured") were taken under the cap. For a true cost keep the GPU busy: the bench ballast (`harness/bench/arch.mjs`: `gpuP95`, or `frameCostP50` from frame times, which also works on Metal). Never trust a plain `perf` reading when the frame is under 8.3 ms.
