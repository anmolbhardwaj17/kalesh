# Dilli Darshan: Style options

<!-- Copy to harness/design/STYLE_OPTIONS.md (planner, STYLE_DISCOVERY mode). Every number marked (est) is an estimate
until its style test measures it; then replace it with the measured value and the machine. Never hide a bad number. -->

Status: round N of the interview. Not signed off.

## What we know so far

<!-- The owner's answers in short, each with the round it came from. He corrects this. -->

## Reference board

See `REFERENCE_BOARD.md` format: one row per reference with what to take from it and what to leave.

| Reference | Kind (game, film, art, photo) | Take | Leave |
|---|---|---|---|

## Target hardware and baseline

- Target machine: <model, GPU, OS, browser>, resolution <w x h>, pixel ratio <n>.
- Measured on: <this machine, GL renderer from the report>, load <1 min load avg>.
- Baseline (the game as found, `harness/look_proof/baseline/perf.json`): frame time p95 <ms> (worst view <name>), fps <n>, draw calls <n>, triangles <n>, load time <ms>.

## Candidates

<!-- 3 to 5. One short paragraph each: what it is, which references it follows, a link or description of a reference
image, and how it would be done in this engine (shaders, post passes, textures). -->

### A. <name>
### B. <name>
### C. <name>

Dropped: <style>: <one line why>.

## Fidelity options for a city or location look

<!-- Use when the game is set in a place (CITY_BRIEF.md). Each option is a column in the comparison too. Costs are honest
estimates first, then measured in the style test (drive the busiest route at top speed). -->

| | Stylised low-poly city | Stylised realistic | Realistic PBR, baked lighting | Photo-textured |
|---|---|---|---|---|
| **Look** | flat or gradient colours, simple massing, strong silhouettes | simplified shapes with painted or simplified real materials | real materials, baked GI and AO, careful light | photo textures or photogrammetry on real shapes |
| **Performance at play speed** (draw distance, LOD levels, instancing, streaming) | cheapest: long draw distance, heavy instancing, few LODs | moderate: LODs and instancing needed, medium draw distance | heavy: lightmaps per block, texture streaming, short draw distance or impostors | heaviest: unique textures, streaming and memory are the limit |
| **Asset volume** (unique buildings, materials, props, vehicles) | small: a kit of tens of parts, colours vary them | medium: a kit plus trim sheets and decals per district | large: many unique materials and lightmap bakes per area | very large: per-building textures, cleanup per asset |
| **Who makes it** | mostly procedural plus a few AI textures | procedural massing plus AI trim sheets and decals | AI textures plus baking pipeline, some modelling | photo sources or AI photo textures, heavy cleanup |
| **AI art prompt fit** | high: flat styles are easy to keep consistent | good with a fixed style anchor | medium: PBR maps need care | low to medium: consistency and seams are hard |
| **Risk** | can look cheap if density is low | needs a strong art direction to avoid mixed looks | bake times, memory, light leaks | uncanny mismatch, performance, licensing of photos |
| **Measured** (frame time p95 driving the busiest route, draw calls, load time) | | | | |

## Comparison

| | A | B | C |
|---|---|---|---|
| **Look** (one line, closest reference) | | | |
| **Feel** (mood, readability of player and goals, how it supports the pillars) | | | |
| **Frame time p95, worst view** (est, then measured on the target) | | | |
| **Draw calls, triangles** (est, then measured) | | | |
| **Shader and post cost** (passes, outlines, AO, bloom; GPU ms per feature) | | | |
| **Load time** (measured) and texture memory | | | |
| **Asset pipeline** (who makes what: procedural, owner with AI images, AI 3D models, packs, hand made; asset count for the game) | | | |
| **AI art prompt fit** (how reliably image models hit this style; style anchor text; consistency across a batch) | | | |
| **Tooling** (shaders, libraries, editors, ingest steps) | | | |
| **Risk** (what can go wrong; what must change in the existing code) | | | |
| **Scope and time** (tasks to adopt it across what exists; tasks per new scene; ongoing cost) | | | |
| **Fit with the existing code** (what stays, what is rewritten) | | | |
| **Readability floor** (night and dark scenes) | | | |
| **Performance at play speed** (draw distance, LOD, instancing, streaming; measured while moving at top speed) | | | |
| **Asset volume** (unique assets the whole game needs in this style) | | | |
| **Scales down** (what the low preset turns off, and how it then looks) | | | |

## Side by side

`harness/reports/look/style_options.jpg` (`node harness/bin/lookproof.mjs --sheet baseline,style_a,style_b,style_c --out style_options`): one row per view, one column per candidate, worst frame time p95 under each label.

## Sample AI prompts per candidate

<!-- One texture and one character prompt per candidate, with the style anchor, so the owner can test the art pipeline. -->

## Recommendation

<!-- The planner's recommendation with the reason in two lines. The owner decides. -->

## Questions for the next round

1.
2.

## Decision log

<!-- Round by round: what the owner said, what changed. The final line quotes the sign-off. -->
