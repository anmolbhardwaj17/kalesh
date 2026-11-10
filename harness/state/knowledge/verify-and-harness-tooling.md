# verify-and-harness-tooling

One line per gotcha.
- task.mjs CLI tests run on a scratch copy with HARNESS_ROOT (see harness/bin/signoffs.test.mjs); a sign-off is one row in harness/bin/signoffs.mjs.
- A dashboard may already run on port 4488: test a changed dashboard with HARNESS_DASHBOARD_PORT=4499, or the old process serves the old /api/state.
- To change an open task's title, desc or acceptance use `node harness/bin/task.mjs edit <id> --desc-append "..." --accept-add "a|b"` (also --title, --desc, --accept to replace). Never hand-edit backlog.json.
- Godot: run anything through `node harness/bin/godot.mjs` (pinned binary). A `-s` SceneTree script must touch scene nodes on the first `_process`, not in `_initialize` (root not in the tree yet: "Cannot get path of node" errors). GDScript `%` has no `%e`. Godot colours output even into a pipe; godot.mjs strips ANSI before matching ERROR lines. A script error before quit() leaves the engine running forever, so pass `--quit-after`.
- `node harness/bin/godot.mjs frame <png>` takes one windowed frame through Movie Maker (about 12 s for 30 frames on the M2 Pro, Metal Forward+).
