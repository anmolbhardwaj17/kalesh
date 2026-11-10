# Reskin and relocate phase (template)

Use this when the game moves from one place to another (one city to another, one world theme to another) and gets all-new assets for the new place. Example: a driving game set in Barcelona moved to Delhi. The planner adds it after the Phase 0 sign-off (the style and the city look are agreed first) with `task.mjs phase-add --id P1 --name "Relocate to <new place>" --goal "..." --exit "..."`, and plans it from `plan_RELOCATE.example.json`.

The never-wait rule holds in this phase: every new asset starts as a procedural or kitbashed placeholder, and art requests run beside the build.

## 1. Inventory of place-specific assets

Written by the first task of the phase into `harness/design/RELOCATE_INVENTORY.md`: one row per asset or system that carries the old place. Find them by grepping the source and asset folders for place names, by the asset manifest, and by shots of every area.

| Asset or system | Kind (model, texture, material, decal, sign text, audio, data, code) | Where (path) | Old place specific? | Decision: replace / reuse / remove | Replacement (new id or procedural) | Priority |
|---|---|---|---|---|---|---|
| <building facade set> | model + texture | `public/assets/models/...` | yes (old city architecture) | replace | `model_bldg_<new>_*` | 1 |
| <road surface> | texture | ... | partly (paint style) | replace texture, reuse mesh | `tex_road_<new>_asphalt` | 1 |
| <traffic car models> | model | ... | yes (local brands and shapes) | replace | procedural kit first | 2 |
| <street signs> | decal + text | ... | yes (language, script, colours) | replace | signage system with the new script | 1 |
| <ambience audio> | audio | ... | yes | replace | `sfx_amb_<new>_*` | 2 |
| <driving physics> | code | ... | no | reuse | | |
| <old landmark> | model | ... | yes | remove | | 3 |

Rules: reuse anything that is not place specific (physics, camera, UI logic, generic props); replace what a player would read as the old place; remove what has no counterpart. Every "replace" row gets a placeholder plan (section 4) before any art is requested.

## 2. City research brief

The style discovery (Phase 0) fills `harness/design/CITY_BRIEF.md` from `CITY_BRIEF.template.md` with the owner, so the relocation builds the place he has in mind, not a postcard. It covers landmarks, road types, signage and script, vehicles, street life, weather, light and time of day, and materials, each with references and the rule a builder follows.

## 3. Asset request batches for AI art

The art-director turns the inventory's "replace" rows into requests (`assets.mjs add`, `sfx-add`, `music-add`), grouped into batches the owner can make in one sitting or one AI conversation, so the style stays consistent inside a batch. Suggested batch order:

1. `R1 ground and roads`: road surfaces, lane paint, kerbs, pavements, dirt shoulders, manhole covers (textures and decals). These fill most of every frame.
2. `R2 facades`: building wall materials and window sets for each district type (textures, trim sheets).
3. `R3 signage`: shop sign backgrounds, road sign faces, posters (the game draws the text itself in the new script).
4. `R4 landmarks`: the 3 to 6 landmarks the brief names (concept images first; models later or kitbashed).
5. `R5 vehicles`: traffic vehicle liveries and the player's vehicle skins.
6. `R6 life`: pedestrians, vendors, animals (sprites, impostors or models by fidelity option).
7. `R7 sky and light`: skyboxes or sky gradients per time of day, haze colours.
8. `R8 audio`: ambience beds per district and time, horns, engines of local vehicle types, music.

Each batch has priorities (1 for what the screenshots show most) and a sample prompt that the owner tested in the style rounds.

## 4. Procedural-first fallback

No task waits for art. For every "replace" row the builder first makes a placeholder that already reads as the new place:
- Buildings: procedural massing from footprint rules in the brief (heights, setbacks, balconies, shutters, water tanks, signs), coloured from the brief's palette, with trim from a small shared kit.
- Roads: procedural lane paint and wear, kerb and shoulder types from the brief, decals for patches and markings.
- Signs: the game's signage system with the new script and real phrases from the brief's word list on flat colour boards.
- Vehicles: a parametric vehicle kit (box body, cab, wheels, colours and liveries from the brief), instanced.
- Life: instanced low-poly or impostor people and animals with simple loops.
- Sky and light: gradient sky, sun colour and haze from the brief's time-of-day table.
- Audio: synthesized or layered placeholder beds and horns (the game's audio placeholders), replaced when files arrive.
Placeholders follow the signed style bible and pass the rubric on their own; delivered art swaps in by id through the manifest.

## 5. Acceptance shape for relocation tasks (examples)

- "No old-place asset is visible: shots of every district from the play camera show no old signs, landmarks or liveries (list of lookproof views), and `grep -ri '<old city name>' src public/assets/manifest.json` returns only comments marked legacy."
- "District <name>: lookproof views <a, b, c> match the CITY_BRIEF rules (road type, signage script, building heights) and the approved style reference within look_rules.json, or are re-approved by the owner."
- "Frame time p95 while driving the district's route at top speed stays under the signed budget (perf scenario <name>)."
