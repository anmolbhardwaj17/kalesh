# Read map

Which doc sections and source files to read for the area you touch. Heading text below is exact, so `grep -n "^#.*<heading>" <file>` finds it.

**Always read first:** `harness/state/knowledge.md` (core) and `harness/state/decisions.md` (both short), then the `Notes:` file of your area (`harness/state/knowledge/<area>.md`), then the brief. After that read only the sections listed for your area, plus any doc the brief names. Do not read whole design docs. Grep the code before opening whole files. For the reason behind a rule, grep `harness/state/decisions_archive.md`.

Docs: `docs/ARCHITECTURE.md` (ARCH), `harness/design/TECH.md` (TECH), `harness/design/GAME.md` (GAME), `harness/design/VERIFY.md` (VERIFY), `harness/design/STYLE_BIBLE.md` (STYLE), `docs/GAME_HOOKS.md` (HOOKS). Every visual task also reads VERIFY "Visual review rubric (verifier agent)", since the verifier fails against it.

<!-- Template. The planner writes one section per area in ADOPT mode from the real source tree, and keeps it current.
An area is a part of the code a builder works in at one time (8 to 15 areas for a mid size game). Each section:
a Notes line (its knowledge file), then per doc the exact section headings to read, then the source files. Builders
add their new modules here. Example areas below: rename and refill. -->

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
- ARCH: "<render section>".
- TECH: "Render pipeline", "Performance budgets".
- STYLE: all sections that apply to the task.
- VERIFY: "Visual review rubric (verifier agent)", "Look proof workflow (`lookproof.mjs`)", "Perf probes".
- Source: <renderer setup, materials, shaders, post, lights>.

## UI and input
Notes: `harness/state/knowledge/ui-and-input.md`
- ARCH: "<ui section>".
- TECH: "Input".
- GAME: "Player verbs", "HUD", "Menus", "Accessibility".
- STYLE: "UI".
- Source: <ui and input folders>.

## Assets and ingest
Notes: `harness/state/knowledge/assets-and-ingest.md`
- TECH: "Assets".
- STYLE: "AI image prompts".
- Source: `harness/bin/assets.mjs`, `ingest.mjs`, `public/assets/manifest.json`, <the game's asset registry and placeholders>.
