# verify-and-harness-tooling

One line per gotcha.
- task.mjs CLI tests run on a scratch copy with HARNESS_ROOT (see harness/bin/signoffs.test.mjs); a sign-off is one row in harness/bin/signoffs.mjs.
- A dashboard may already run on port 4488: test a changed dashboard with HARNESS_DASHBOARD_PORT=4499, or the old process serves the old /api/state.
- To change an open task's title, desc or acceptance use `node harness/bin/task.mjs edit <id> --desc-append "..." --accept-add "a|b"` (also --title, --desc, --accept to replace). Never hand-edit backlog.json.
