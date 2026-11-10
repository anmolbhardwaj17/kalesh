# Dilli Darshan: Verification

<!-- Template with the harness rules filled in. The planner adds the game's own rubric lines (from the signed style) and
scenario conventions. Verifiers apply the rubric and the severity rule to every shot they read. -->

## Levels

| Level | Command | What it proves |
|---|---|---|
| L0 static | `npm run typecheck && npm test` | Types and pure logic. |
| L1 boot | `node harness/bin/verify.mjs --quick` | `npm run build` succeeds, the game boots (Godot run, "Godot runs" below), `window.__game.ready` becomes true within the load budget, zero console errors, screenshots of the first screen and of the quick set: the core scenarios plus at most 12 mapped to the changed files ("Quick set" below; `--quick --full` runs every scenario that is not `allOnly`). |
| L2 milestone | `node harness/bin/verify.mjs --milestone L07` | The play script beats the milestone under real rules within its budget; shots at start and end (and at each beat the script shoots). |
| L3 full | `node harness/bin/verify.mjs --all` | L1 + every scenario incl. perf + every milestone with a play script. Required for every phase gate and the final gate. |
| L1 focused | `node harness/bin/verify.mjs --only <name,prefix*>` | Typecheck, tests, build, boot and only the named scenarios. For builders iterating on one feature. Its report has mode "only" and never counts for a gate. Every name and `--milestone` id must exist: an unknown one (or a space separated list) exits 2 before the build, with close matches (`cliguard.mjs`). |
| Look | `node harness/bin/lookproof.mjs --set <name> && --compare <name>` | The look views against the approved reference shots, within `look_rules.json`. |
| Ad hoc | `node harness/bin/shoot.mjs ...` | Any view, any input sequence, any eval. Use it freely while building. |

### shoot.mjs behaviour

Run `node harness/bin/shoot.mjs` with no arguments for the option list. Order of operations: `--load`, `--teleport`, `--keys`, `--camera`, `--hud`, `--script`, `--eval`, `--wait`, `--input`, then the shots. `--input` values may be numbers (`jump:1`), booleans (`crouch:true`) or pairs (`move:0,1:1500`). `--quality` adds `&quality=<q>`.

### Scenario options

Each entry in `harness/verify/scenarios.json` has `name`, `steps`, and optional:
- `perf: true` measure a perf window (debug.perf) after the steps, in `--all` and `--only` (and in `--quick` with `perfQuick: true`); judged against `perf_budgets.json`. Runs alone and first, on an idle GPU.
- `allOnly: true` skip in `--quick` (long or heavy scenarios); `quickMapped: true` lets a changed file still pull it into quick.
- `quality`, `query` (extra URL params), `dpr`, `viewport`, `lockstep: true` (page gets `lockstep=1`), `solo: true` (run alone), `budget` (override one budget for this scene, with a `_note` why), `load: true` (used as load by flakecheck).
Steps (`harness/bin/browser.mjs` runStep): `{wait: ms}`, `{call: name, args, timeout}` (a debug hook), `{eval: js}`, `{waitFor: js, timeout}` (polled, answered time only), `{settle: s}` (s seconds of SIM, polled per frame: use it after a load and before a game shot instead of a wall wait), `{key}`, `{hold, ms}`, `{input, value, ms}`, `{script: path, timeout, data}` (a page-side script, below), `{viewport: [w, h]}`, `{reload: true}`, `{emulate: {...}}`, `{click: [x, y]}`, `{perf: ms}`, `{shot: name}` (names ending `_<w>x<h>` must have that size), `{sheets: true}`, `{cpuThrottle: n}`. A `wait` next to an action is the settle time after it.

### Speed

- Scenarios run in a pool of pages of one Chromium (default 4, `--jobs N`); perf scenarios run alone and first; `--all --dry` prints the order.
- Pages share the GPU, so a scenario must not assume a frame rate: wait on state (`waitFor`, `settle`, sim helpers), not on a fixed `wait` that is just long enough. A scenario that only passes with `--jobs 1` is a flaky scenario.
- Script budgets: a script step's `timeout` is its budget. A script that marks progress (`S.progress(label)`) runs on past it while marks keep coming, up to 3 times the budget; a silent one fails as stalled and the timeout prints the last lines of its log.
- Flake check: `node harness/bin/flakecheck.mjs a,b --runs 10 --jobs 2 --load 2` builds once, runs each scenario N times while a second verify loads the machine, and prints pass counts. Any count under N is a flake to fix at the root.

### Quick set

`verify --quick` runs the core set of `harness/verify/quick.json` plus at most `maxExtras` scenarios mapped to the changed files. Target: 20 to 45 scenarios and about 5 minutes. An area `{path, scenarios}` maps a path prefix to the scenarios that really exercise it; a file uses only its most specific areas. Test files and harness state map to nothing. A changed script or scenarios.json entry pulls in its scenarios first. `--quick --dry [--changed a,b]` prints the set. A clean tree (a verifier's snapshot) maps the last commit's files. `--quick` and `--all` record a tree hash so `freshreport.mjs --tree` can reuse a run on the identical tree.

### Godot runs

kit.config.json `target` is `godot`, so verify, shoot, flakecheck and gateretry run the Godot game (`harness/bin/godotdriver.mjs`, picked by `driver.mjs`). No browser is launched; the report says `"driver": "godot"`. The web driver (`browser.mjs`, target `web`) stays for a later web demo.

- **Build.** `npm run build` is the headless import of `game/` into `game/.godot/` (kit.config.json `buildDir`). `npm run typecheck` adds a parse check of every `.gd` file and of the harness `.mjs` files.
- **One run per scenario.** Each scenario, the boot check and each milestone launch the pinned Godot fresh: `godot --path game --resolution WxH --quit-after N -- --debug --debug-port=<free port> --verify` plus the scenario's game args. `quality` adds `--quality=<q>`, `lockstep: true` adds `--lockstep`, `query: "a=1&b"` adds `--a=1 --b` (so does `HARNESS_QUERY`). `viewport: [w, h]` sets the window size (default 1280x720). `HARNESS_GODOT_ARGS` adds engine args, for example `--rendering-driver vulkan` for GPU times on macOS. Default `--jobs` is 2 (two game windows side by side).
- **Windowed vs headless.** Runs are windowed by default: they render, so they take shots and measure perf. A scenario with `headless: true` runs Godot headless (no window, no GPU): only for script-only checks. Its `{shot}` and `{perf}` steps fail, and a script's `S.shot` is skipped with a log line. Headless frames end on `process_frame` (nothing is drawn), so `frames(n)` and snapshots still work.
- **Scripts.** Page-side scripts (`harness/verify/scripts/*.js`, milestone play scripts, `lib/sim.js`) run unchanged in a node vm whose global is a window shim (`godotshim.mjs`). `state`, `clock`, `events` and `hold()` read the newest snapshot; every other hook is a request to the debug server. `input`, `setCamera`, `timeScale`, `hud` and `hold({...})` send and return at once (TCP keeps the order); a request that fails and was not awaited fails the script. `window.__shot`, `__hostLoad` and `__probeNoDebug` (hooks_no_debug) exist; `__realInput` and screen recording are web only.
- **Steps.** `call`, `eval`, `waitFor`, `settle`, `input`, `script`, `perf`, `shot`, `sheets` and `wait` work. `key`, `hold`, `click`, `emulate`, `reload`, `cpuThrottle` and a `viewport` step are browser steps and fail with a clear error: drive the game with `input`.
- **Console errors.** Any `ERROR`, `SCRIPT ERROR` or `USER ERROR` line in Godot's output, any `error` event from the game (`game/debug/debug_logger.gd`), a `console.error` in a script, a game that exits on its own, or a debug server that never answers. `WARNING` lines go to the report's warnings.
- **Where things go.** Shots are the debug server's `shot(path)` (the viewport as a PNG) in `harness/reports/shots/` (or `--shots`). The engine output lines that count as errors or warnings are in the report (`consoleErrors`, `warnings`); `godot.mjs` and the smoke test keep their own output (`harness/reports/godot/`). Load time is launch to the first ready snapshot.

## Debug hook contract

See `docs/GAME_HOOKS.md`. Scenario `hooks_contract` checks it.

## Play scripts (anti-cheat for our own bot)

Each milestone with a play script (`harness/verify/milestones/<ID>.js`) is played start to finish by that script:
1. Real inputs only (`debug.input`, or trusted mouse and keys through `window.__realInput`). No position writes, no flag writes, no skipping objectives, no `teleport`.
2. Waits on game conditions in sim time (`S.until`, `S.waitSim`), never on fixed wall sleeps.
3. Reaches the game's own "milestone done" state (`state().milestone.done` or a `milestone:done` event), not a state the script sets.
4. Logs what it did (`S.log`) and shoots each beat (`S.shot`), so a failure is read without a rerun.
5. Fits its budget (`budgetMs` in milestones.json) on a loaded machine, marking progress on long runs.

## Writing acceptance criteria

- Checkable by a command, a test, a scenario or a named shot. "Feels good" is not a criterion; "apex reached in 0.30 to 0.40 s of sim, measured by scenario jump_feel" is.
- Name the scenario, milestone, lookproof view or test that proves each one, and the number with its range.
- Visual criteria name the shots and the camera (play camera at 1x unless the criterion is about a close-up).
- Camera and framing criteria cover every actor in the scene, the whole duration, and actors that move after the shot is chosen, and require a flakecheck (5 runs; 3 in low usage mode).
- Look changes name the lookproof views and the compare against the approved reference, or say the reference is to be re-approved by the owner.
- Perf-sensitive tasks name the perf scenario and the budget.
- Every milestone task: matches its milestones.json entry beat by beat, `verify --milestone <ID>` passes, shots pass the rubric, `task.mjs milestone <ID> playable`.
- **Fun criteria (signed game design, 2026-11-10).** Every mission task's acceptance includes these four, each checked by a named scenario, the mission's play script or a named shot:
  1. Clear goal: the goal line and the objective marker are on screen within 5 s of sim time after the mission starts (play script asserts `state().mission.goal` is set by t = 5 s; shot `<ID>_goal` shows it).
  2. Fair fail: each fail the mission can hit shows its reason in words (event `mission:fail` with a non-empty `reason`, shot `<ID>_fail`) and the instant retry puts the player back in control at the last checkpoint in under 3 s of sim time (scenario `<id>_fail_retry`).
  3. A reason to retry: the mission records a time, score or medal to beat, and the completion screen shows it next to the best so far (shot `<ID>_done`).
  4. A reward that matters: the completion screen shows the reward (money, a district or place opened, a story turn or a stamp), and the play script checks the reward reached the save (`state().progress`).
- **Pillars in every phase plan.** Every task in a phase plan names the pillar it serves (GAME.md "Pillars": three lives, one city; filmi, never cheap; the city opens up) in its desc, as `Pillar: <name>`. A task that serves no pillar is cut or folded into one that does. Base and tooling tasks name the pillar they unblock.
- **Respect rule.** Every mission, character and area task's acceptance includes a check against GAME.md "Respect rule" (verifier reads the named shots and the mission text for it).
- **Driving stays central.** Every mission task's play script logs the time on foot and in a vehicle; on foot stays at about 40% of the mission or less, and at least one objective is a drive.

## Visual review rubric (verifier agent)

For each screenshot the verifier reads, check:

1. Not blank, not black, not a magenta or missing texture, not a WebGL error screen.
2. The camera is where the game's camera would be and not clipped inside geometry or the player.
3. Lighting matches the scene's mood in STYLE_BIBLE, and the readability floor holds: **the player, the ground around them and the next goal are clearly visible in every shot, including night.** "Very dark" is a FAIL, never a placeholder look.
4. HUD present and readable unless the shot is a cutscene; the HUD and subtitles never cover the player.
5. Small-detail rule: the space near the player has the props STYLE_BIBLE asks for.
6. No obvious z-fighting, floating props, giant or tiny scale errors.
7. Text in the world is real and readable (no missing-glyph boxes).
8. Matches the STYLE_BIBLE palette, shading and mood; for look tasks, within `look_rules.json` of the approved reference or a change the task asked for.
9. No debug overlay in game screenshots unless the scenario asks for it.
10. Lens and framing: no extreme wide-angle look, no near-plane clipping, the camera keeps a sane distance in tight spaces (walls between camera and player fade instead of pushing the camera into the player).
11. Character proportions are the same in every shot: never flattened or stretched on one axis.
12. Bloom and glow only on small emissives: a large blown-out glow that washes out part of the frame is a FAIL.
13. Surfaces read at real size from the play camera: no huge colour blobs, stretched detail or strong fake bumps.
14. Style: the shot reads as stylised B (STYLE_BIBLE.md): warm rich colour, real proportions, soft sun-lit haze, simplified surfaces. Not cartoony or childish, not a generic Western city, not a flat low-poly look, no outlines or toon bands, and not a cold blue-grey wash. FAIL if it looks like one of those.
15. Light: the shot matches its named light (dawn pink and peach haze, afternoon hot and dusty, golden orange with long shadows, night blue sky with warm sodium pools and neon). Look shots compared with `lookproof.mjs --compare` stay within `look_rules.json` (mean 1.5, share 1%) of `approved/` (golden) or the named set for their light (`style_stylised_b_dawn`, `_afternoon`, `_night`), or the task says it changes the look.
16. Readability floor numbers (STYLE_BIBLE.md): mean luma at least 0.15 at night and 0.22 by day, near-black pixels (luma under 0.04) at most 15%, blown-out pixels (luma over 0.97) at most 10% with the sky and sun disc excluded; the road, the player and the next goal are never inside the dark parts.
17. Palette: no pure black or pure white surface in the world, no neon colour in daylight, no large saturated primary surface; a wall that reads cream by day does not turn green or magenta under the grade.
18. Grime by area: wear follows the area (heavy in the Old Delhi bazaar, near zero in Lutyens and Connaught Place); grime is never on people, vehicle windscreens, lane markings or the readable text of a sign; the Lutyens block does not look dirty and the bazaar does not look clean.
19. Delhi detail (the small-detail rule): within 15 m of the player there are at least 6 different Delhi detail pieces from the kit (grilles, AC units, tanks, wires, shutters, hand-painted boards, laundry or tarps, scooters or carts, painted kerbs, a milestone, dogs, bunting) and the mix fits the area. The same detail repeated everywhere, or an empty street, is a FAIL.
20. Area reference (decisions.md "Every area is built from real references"): an area shot is compared with that area's reference board of real photos and its area sheet; the verifier names three things the shot gets right and one thing that makes it this area and no other. A generic Delhi that could be any area is a FAIL.
21. Respect rule (GAME.md "Respect rule", DELHI_WORLD.md section 3): real conditions shown honestly, never as spectacle or a joke. Check every shot and every mission or character text: no caricature or one-costume people; people vary in age, gender, clothing and activity; poor areas have the same craft as rich ones and their people have dignity; no real person, party, brand or police unit on a sign, poster or uniform (invented names only); places of worship only where they really are, built with care, never decoration or a combat arena; no gore beyond small blood hits, no child shown damaged, no violence at a place of worship, no sexual content; GB Road shown as hardware shops with the trade as background only. Any breach is a FAIL, never a POLISH item.
22. People at on-foot distance (3 m camera, 1080p): real proportions, a clear silhouette against the wall behind, at least 6 clothing colours and 3 body builds in a bazaar frame, hands and held items readable, no flattened or stretched figure. The three leads keep their fixed looks (Bittu khaki shirt and gamchha, SI Meera Rana in khaki, Danny in a maroon jacket).
23. Combat effects: muzzle flash, impacts, smoke and sparks are bold and read at once but small (each under 5% of the frame, no lasting blown-out area over 10% for more than 0.3 s); blood is small hits only; nothing cruel. Check a shot taken within 0.3 s of the effect.
24. Night lights: lamps, shop bulbs, windows, neon, headlights and tail lights are small emissives; a street lamp throws a visible warm pool on the road; no black surface facing away from every lamp (the moonlit fill lifts it). Known gaps listed in STYLE_BIBLE.md "Known gaps" are POLISH until the task that fixes them.

**Severity rule:** fail a task only for (a) an acceptance criterion or enforced number that is not met, (b) a rubric problem a player would notice at normal play distance: visible at 1x in a game, milestone, scene or beat shot from the play or follow camera, or (c) a flaky or failing check. A cosmetic flaw that only shows at 2x or more zoom, only in a lab or gallery close-up, or only from a debug camera angle a player never gets, is NOT a fail: list it under POLISH (one line each, with the shot) so the orchestrator files it for the polish phase. When unsure whether a player would notice, say so and lean to POLISH for cosmetic issues and to FAIL for anything that breaks bodies (parts through each other at play distance), readability or play.

Verifier output: `PASS` or `FAIL` with a numbered list of concrete problems and the screenshot paths that show them.

## Shot rules (automatic)

- Every shot asks `debug.shotProblems(name)` when the game has it (the player under the HUD, a subtitle over the player, a debug overlay left on); each answer fails the step.
- A shot named `..._<w>x<h>` or `..._<w>x<h>_dpr<n>` must have that pixel size.
- A screenshot that times out under load is retried while the page still answers (`shotretry.mjs`).
- Shots taken during a fade or a loading screen are retaken by milestone runs when the game reports one (extend verify.mjs if the game has covers to wait for).

## Perf probes

Perf scenarios (`perf: true`) measure one `debug.perf` window after their steps and are judged against `harness/verify/perf_budgets.json` (`perfbudget.mjs`): p95 frame time (warn and fail), fps floor, draw calls, triangles and GPU memory per quality preset, and the page load time. A frame time fail is measured once more before it counts. On software GL frame time is not judged. On a loaded machine (load per core over 1) a frame time fail becomes "not judged: machine loaded". `HARNESS_PERF_STRICT=1` makes the GPU timer a hard limit.

## Look proof workflow (`lookproof.mjs`)

1. `harness/look_proof/poses.json` lists the views (staging steps plus a fixed camera).
2. `--set <name> [--perf] [--query style=x]` shoots every view (and measures it). On Godot each view is a fresh game run at the view's size; `--query style=x` becomes the game arg `--style=x`. `--perf` writes `perf.json` with the machine, the Godot version, the renderer (Forward+ or Mobile), the GPU adapter name and the machine load, plus a row per view (cpu and gpu p95, frame p95, draw calls, triangles, verdict from `perf_budgets.json`). The Metal driver gives no GPU time: set `HARNESS_GODOT_ARGS="--rendering-driver vulkan"` when `gpuMs` matters. Steps that need raw keys, mouse or reload do not exist on Godot: stage a view with `call` and `input` steps.
3. `--compare <name>` against `approved/` within `look_rules.json`; sheets in `harness/reports/look/`.
4. `--approve <name>` only after the owner accepted that look (Phase 0 sign-off, or a look task he accepted on the dashboard).
5. `--sheet a,b,c` puts sets side by side with their worst frame time: the Phase 0 style comparison and any before and after.

## Final gate

`task.mjs gate --final` prints `ALL GATES PASSED` only when every phase is done, no task is open or blocked, the style is signed off, and the latest `verify --all` is ok, newer than the last source commit, with every counted milestone passing and no console errors.
