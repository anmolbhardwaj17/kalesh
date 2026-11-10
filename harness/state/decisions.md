# Decisions

Short, current decisions only: date, decision, why. One entry per choice. When this file passes about 12 KB, move old entries to decisions_archive.md (the planner's CONSOLIDATE mode does it) and keep a one line summary here.

Format:

## YYYY-MM-DD: <decision in a few words>
Decision: <what was decided>
Why: <the reason, in one or two lines>
By: <owner | orchestrator | planner | builder>


## 2026-11-10: Phase 0 adds architecture discovery with its own sign-off
Decision: Phase 0 runs ARCHITECTURE DISCOVERY next to style discovery: an options table (harness/design/ARCH_OPTIONS.md), measured benches on this machine, and Anmol's sign-off recorded with task.mjs archsignoff. Gate P0 needs both sign-offs.
Why: the old driving game failed at its base layer (mirror axis, roads, terrain, a 2346 line tile manager). Anmol wants the engine and systems chosen on evidence before any building.
By: orchestrator (setup)

## 2026-11-10: New repo, old game read only
Decision: Dilli Darshan starts in a new repo on a minimal Vite, TypeScript and three.js scaffold. /Users/apple/Desktop/code/delhi-drive is a read-only reference. One coordinate system: east +X, north -Z, 1 unit = 1 m, no mirroring.
Why: Anmol decided the old game is too broken at base level to rework.
By: owner

## 2026-11-10: Fable model only for the hardest work
Decision: Fable runs (budget in harness/state/fable_budget.json, limit 25) go only to the Phase 0 salvage audit, architecture discovery, the first two phase plans, the core systems (roads and junctions, terrain fit, coordinates and bake, streaming, physics worker and handling, render foundation), 3rd attempts and hard bugs blocked twice. Tasks carry a model field set by the planner. When the budget is spent, Opus runs instead.
Why: Anmol has a limited Fable budget and wants it where it matters most.
By: owner

## 2026-11-10: A map repair layer between the sources and the mesh build
Decision: source map data is treated as broken. A repair layer (harness/design/MAP_REPAIR.md) ingests OSM, Overture, merged building footprints and a bare-earth DTM, validates with a rule engine, auto-repairs with a log, applies versioned per-tile overrides, solves elevations, and only then builds meshes. Pilot: Connaught Place, ITO and Pragati Maidan flyovers, Chandni Chowk, one metro line. It is part of the architecture sign-off; its rules, elevation solver and junction builder are Fable tier.
Why: Anmol accepts the data is broken and wants it found and fixed on every bake, not shown on screen.
By: owner

## 2026-11-10: Lane-level road model and a map inspector
Decision: roads are built as lane sets with tapers, gores and flyover lane splits (never shared index points), checked for overlapping faces, lane continuity and taper limits; this is the top Fable task. A 3D map inspector page lets Anmol pick among Claude's proposed fixes for unclear or high-impact issues; choices go to per-tile overrides and the inbox. It is an early task after the architecture sign-off.
Why: centrelines on one shared node made carriageways collapse in the old game; Anmol wants to review hard map cases himself without blocking the build.
By: owner

## 2026-11-10: Dashboard restyle
Anmol asked for a dark, minimal dashboard in the Saans font. Restyled harness/dashboard/index.html: neutral black (no blue tint), Saans and Saans Mono served locally from harness/dashboard/fonts (route /fonts/). The Saans files are TRIAL builds with a personal use only licence (fonts/LICENSE.txt): fine for this private local dashboard, never ship them in the game build.

## 2026-11-10: Game design discovery is the third Phase 0 sign-off
Decision: Phase 0 adds GAME DESIGN DISCOVERY (harness/design/GAME_DESIGN_OPTIONS.md, interview rounds, explicit sign-off recorded with task.mjs designsignoff). Gate P0 needs style, architecture and game design sign-offs. Standing rules for every plan from then on: each phase is checked against the GAME.md pillars; every mission task's acceptance includes fun criteria (clear goal, fair fail, a reason to retry, a reward that matters) as well as function; no mission system is built before the game design sign-off.
Why: a car driving around Delhi is a tech demo, not a game; Anmol wants a real core loop built from what makes Delhi Delhi (inbox mmwap8jxg).
By: owner

## 2026-11-10: Salvage audit and quality audit run as one Fable task
Decision: the Phase 0 quality audit ("why it felt thin") is written in the same Fable run as the salvage audit, scored against the old game, since the new repo is a scaffold with nothing to audit yet.
Why: both read the old repo deeply; one run saves a second full read in low usage mode.
By: planner

## 2026-11-10: Projection is WGS84 transverse Mercator around India Gate (provisional)
Decision: `src/geo/projection.ts` maps lat/lon to world metres with a transverse Mercator (Krüger series, 3rd order) on the WGS84 ellipsoid, central meridian through the origin (India Gate, 28.612894 N, 77.229446 E), scale 1 on that meridian, origin northing subtracted. East +X, north -Z, up +Y. No mirroring. Scale error is about 0.2 m at 25 km east or west, round trip under 1 cm. Provisional: the architecture sign-off may replace it (for example with a local ENU or a tile-local origin).
Why: needs no dependency, is accurate to centimetres over the whole city, and keeps the axis rule in one place with tests.
By: builder
