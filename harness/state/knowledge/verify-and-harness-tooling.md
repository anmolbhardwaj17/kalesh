# verify-and-harness-tooling

One line per gotcha.
- task.mjs CLI tests run on a scratch copy with HARNESS_ROOT (see harness/bin/signoffs.test.mjs); a sign-off is one row in harness/bin/signoffs.mjs.
- A dashboard may already run on port 4488: test a changed dashboard with HARNESS_DASHBOARD_PORT=4499, or the old process serves the old /api/state.
- To change an open task's title, desc or acceptance use `node harness/bin/task.mjs edit <id> --desc-append "..." --accept-add "a|b"` (also --title, --desc, --accept to replace). Never hand-edit backlog.json.
- Godot: run anything through `node harness/bin/godot.mjs` (pinned binary). A `-s` SceneTree script must touch scene nodes on the first `_process`, not in `_initialize` (root not in the tree yet: "Cannot get path of node" errors). GDScript `%` has no `%e`. Godot colours output even into a pipe; godot.mjs strips ANSI before matching ERROR lines. A script error before quit() leaves the engine running forever, so pass `--quit-after`.
- `node harness/bin/godot.mjs frame <png>` takes one windowed frame through Movie Maker (about 12 s for 30 frames on the M2 Pro, Metal Forward+).
- Godot debug server: drive the game with `harness/bin/godotclient.mjs` (`launchGame`, `client.call`); `node harness/bin/godotsmoke.mjs` checks every hook in about 15 s. Godot's Metal driver reports 0 GPU ms; pass the engine arg `--rendering-driver vulkan` (MoltenVK) when gpuMs matters. `Performance.TIME_PROCESS` only refreshes about once a second, so per frame CPU time comes from `game/debug/frame_probe.gd`.
- GDScript: a Node method named `_input` (or any engine virtual) with another signature is a parse error that only shows when the script loads; the debug server loads only with --debug, so run the smoke after touching game/debug/. `get_node_or_null("/root/...")` on a node outside the tree logs an error: guard with `is_inside_tree()`.
- vitest: CLI tests that spawn task.mjs need a long testTimeout (30 s); under Godot load they pass 5 s.
