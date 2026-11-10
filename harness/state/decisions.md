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
