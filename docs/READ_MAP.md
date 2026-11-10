# Read map

Which doc sections and source files to read for the area you touch. Heading text below is exact, so `grep -n "^#.*<heading>" <file>` finds it.

**Always read first:** `harness/state/knowledge.md` (core) and `harness/state/decisions.md` (both short), then the `Notes:` file of your area (`harness/state/knowledge/<area>.md`), then the brief. After that read only the sections listed for your area, plus any doc the brief names. Do not read whole design docs. Grep the code before opening whole files. For the reason behind a rule, grep `harness/state/decisions_archive.md`.

Docs: `docs/ARCHITECTURE.md` (ARCH), `harness/design/TECH.md` (TECH), `harness/design/GAME.md` (GAME), `harness/design/VERIFY.md` (VERIFY), `harness/design/STYLE_BIBLE.md` (STYLE), `docs/GAME_HOOKS.md` (HOOKS). Every visual task also reads VERIFY "Visual review rubric (verifier agent)", since the verifier fails against it.


## Verify scripts and harness tooling
Notes: `harness/state/knowledge/verify-and-harness-tooling.md`
- ARCH: "Tooling (outside `src/`)".
- TECH: "npm scripts", "Debug hooks".
- VERIFY: "Levels", "shoot.mjs behaviour", "Scenario options", "Speed", "Quick set", "Play scripts (anti-cheat for our own bot)", "Perf probes", "Look proof workflow (`lookproof.mjs`)", "Final gate".
- HOOKS: all.
- Also: `CLAUDE.md` (the loop), `.claude/agents/verifier.md` when changing what the verifier runs.
- Source: `harness/bin/verify.mjs`, `browser.mjs`, `shoot.mjs`, `lib.mjs`, `task.mjs`, `lookproof.mjs`, `perfbudget.mjs`, `perfgate.mjs`, `quickset.mjs`, `freshreport.mjs`, `gatecheck.mjs`, `gateretry.mjs`, `cliguard.mjs`; `harness/verify/scenarios.json`, `quick.json`, `shared_paths.json`, `perf_budgets.json`, `look_rules.json`, `scripts/`, `milestones/`; the game's debug hook folder.

## Rendering and look
Notes: `harness/state/knowledge/rendering-and-look.md`
- ARCH: "How the pieces fit", "Systems".
- TECH: "Render pipeline", "Performance budgets".
- STYLE: all sections that apply to the task.
- VERIFY: "Visual review rubric (verifier agent)", "Look proof workflow (`lookproof.mjs`)", "Perf probes".
- Source: `src/main.ts` (renderer, lights, scene); style switch modules under `src/render/` once added (Phase 0 style tests).

## UI and input
Notes: `harness/state/knowledge/ui-and-input.md`
- ARCH: "Source map".
- TECH: "Input".
- GAME: "Player verbs", "HUD", "Menus", "Accessibility".
- STYLE: "UI".
- Source: `index.html` (`#hud`), input handling in `src/main.ts`.

## Assets and ingest
Notes: `harness/state/knowledge/assets-and-ingest.md`
- TECH: "Assets".
- STYLE: "AI image prompts".
- Source: `harness/bin/assets.mjs`, `ingest.mjs`, `public/assets/manifest.json`, the game asset registry once added.

## Driving and camera
Notes: `harness/state/knowledge/driving-and-camera.md` (create on first gotcha)
- ARCH: "Systems" (Driving).
- TECH: "Main loop and time", "Coordinates (binding, owner 2026-11-10)".
- GAME: "Movement and camera feel".
- Source: `src/car.ts`, `src/car.test.ts`, the camera block in `src/main.ts`.

## World, map data and bake
Notes: `harness/state/knowledge/world-and-map.md` (create on first gotcha)
- TECH: "Coordinates (binding, owner 2026-11-10)" and the world sections written after the architecture sign-off.
- Design: `harness/design/MAP_REPAIR.md` (all), `harness/design/ARCH_OPTIONS.md` once written.
- Source: `src/geo/` (projection, added by the P0 harness baseline task), bake scripts and benches under `harness/bench/` and `tools/` once added.

## Old game reference (read only)
- `/Users/apple/Desktop/code/delhi-drive`: never edit, build or install there. Read `harness/design/SALVAGE_AUDIT.md` first (written in Phase 0) instead of the old code.
