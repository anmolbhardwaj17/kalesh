# Architecture options

Written by the planner in Phase 0 (mode ARCH_DISCOVERY). The owner signs off one option per decision with `task.mjs archsignoff "<his words>"`. Estimates are marked (est); measured numbers name their bench report in `harness/reports/arch/`.

Machine: <model, GPU, browser, GL or WebGPU adapter>. Style it must serve: <signed or leading style>.

## Decisions

| Decision | Option | Perf on this machine | Quality | Complexity | Risk | Tooling, licence, size | Fit | Bench |
|---|---|---|---|---|---|---|---|---|
| Renderer | WebGL2 (three WebGLRenderer) | | | | | | | |
| Renderer | WebGPU (three WebGPURenderer, WebGL2 fallback) | | | | | | | |
| Physics | <engine> on the main thread | | | | | | | |
| Physics | <engine> in a worker | | | | | | | |
| World data and tiles | <format, tile size, bake tool> | | | | | | | |
| Map repair layer | <sources, rule engine, overrides, elevation solver, health report> | | | | | | | |
| Lane-level road model | <lane sets, tapers and gores, flyover lanes, junction surfaces from lane edges> | | | | | | | |
| Map inspector | <3D review page, issue queue, overrides writer> | | | | | | | |
| Roads and junctions | <road graph to junction mesh method> | | | | | | | |
| Terrain | <terrain that conforms to roads> | | | | | | | |
| Streaming | <tile streaming and memory policy> | | | | | | | |
| Instancing and LOD | <instancing, LOD, impostors> | | | | | | | |
| Textures | KTX2 and Basis vs PNG or WebP | | | | | | | |

## Budgets per system

| System | Budget (ms or MB) | Measured |
|---|---|---|

## Recommendation

One line per decision: the choice and why.

## Questions for the owner

At most 6, each with options.

## Sign-off

Quote and date (also in decisions.md).
