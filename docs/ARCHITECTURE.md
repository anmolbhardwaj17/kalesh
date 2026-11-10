# Architecture (as built)

Layout follows `harness/design/TECH.md`. This file lists what actually exists. Update it when you add a module (builders do this as part of every task that adds one).

<!-- Template. The planner writes "How the pieces fit" and the source map in ADOPT mode by reading the adopted code.
Then one section per system, named so docs/READ_MAP.md can point at it, each with: what it does, the main files, the
contracts it keeps, how it is verified (scenario, test), and the task id that added or changed it. -->

## How the pieces fit

<!-- Boot sequence (index.html -> entry -> renderer, loop, input, assets, first screen), the main loop (fixed step or
variable), how scenes or levels load, how assets resolve by id, and where window.__game is installed (?debug=1). -->

## Source map

| Path | What |
|---|---|

## Systems

<!-- One subsection per system. -->

## Tooling (outside `src/`)

| Path | What |
|---|---|
| `harness/bin/task.mjs` | The only writer of `harness/state/backlog.json`: status, next, start, done, fail, phases, gates, inbox, milestones, sign-off. |
| `harness/bin/verify.mjs` | Builds, serves the build, runs scenarios and milestone play scripts in Chromium, judges budgets, writes `harness/reports/latest.json` and shots. `--quick`, `--only`, `--milestone`, `--all`, `--repeat`. |
| `harness/bin/browser.mjs` | Static server, Chromium launch (GPU first, then software GL), page open with console capture, `waitReady`, `debugCall`, the step runner. |
| `harness/bin/shoot.mjs` | Ad hoc screenshots and play-throughs. |
| `harness/bin/lookproof.mjs` | Look proof sets, compare against the approved reference, side by side sheets, perf per view. |
| `harness/bin/perfbudget.mjs`, `perfgate.mjs`, `gpucost.mjs` | Budgets from `perf_budgets.json`, the frame time gate, the stable GPU cost. |
| `harness/bin/quickset.mjs`, `harness/verify/quick.json` | The `--quick` scenario set. |
| `harness/bin/freshreport.mjs`, `lib.mjs treeHash` | Reuse of a quick run on the identical tree. |
| `harness/bin/gatecheck.mjs`, `gateretry.mjs`, `harness/verify/shared_paths.json` | Phase gate paths: the full run, or a retry when no shared file changed. |
| `harness/bin/milestoneset.mjs` | Which milestones count for which gate. |
| `harness/bin/flakecheck.mjs`, `cliguard.mjs` | Repeat runs with pass counts; name checks before any run. |
| `harness/bin/snapshot.mjs`, `lane.mjs`, `sweep.mjs`, `playcopy.mjs` | Worktrees: verify snapshot, lane 2, regression sweep, the dashboard's stable play copy. |
| `harness/bin/dashboard.mjs`, `notice.mjs`, `assets.mjs`, `ingest.mjs` | The owner's dashboard, its notices, asset requests and uploads. |
| `harness/bin/budgetwait.mjs`, `waitpredicate.mjs`, `shotretry.mjs`, `pageretry.mjs`, `screencast.mjs`, `frameseq.mjs`, `seqsheet.mjs`, `shotdiff.mjs`, `tmpclean.mjs`, `docpaths.mjs` | Load-safe waits and retries, screen recording and frame sequences, contact sheets, pixel diffs, temp cleanup, doc path checks. |
