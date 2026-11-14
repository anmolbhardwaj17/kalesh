# Reality match: every object compared with the real thing, scored, improved

Anmol 2026-11-14: "a proper check of everything you are making with how it looks in real life, compare, give a score and improve until it looks good or matches our game language ... a plant, railing, wall, bottle, fire extinguisher, fan and all ... I don't have to provide a list."

## Scope: found automatically, never a hand list
Every visible object class the game draws is in the catalog: kit modules (walls, shutters, railings, grilles, boards, awnings, tanks, AC units), infra pieces (piers, barriers, lamps, fans, fire boxes, kerbs), street props (bollards, bins, poles, signs, plants, pots, benches), landmark parts, vehicles, characters, and anything new a task adds. A catalog tool lists them from the code and data (module ids, kit pieces, infra variants, prop classes), so a new object enters the loop the day it is built.

## For each object
1. Reference: 2 to 4 dated photos of the real thing in Delhi (or the closest real place), from the area boards, the owner's photos, or free sources; the date and source written next to them.
2. Render: the game object alone (front, three quarter, close) and in context at player height, in day and night, through the harness (off-screen).
3. Compare and score, 0 to 10 per line:
   - Shape and proportion (silhouette, parts, thickness)
   - Real size (against WORLD_LOGIC scale ranges and a 1.75 m person)
   - Material and colour (paint, metal, plastic, stone, fabric; colour inside the photo range)
   - Wear and age (cause-and-effect wear, OWNER_EYE)
   - Detail at play distance (enough at 5 to 15 m, not noisy at 50 m)
   - Mounting and context (attached, placed where it really is, WORLD_LOGIC)
   - Light response (shading, shine, glow only if powered)
   - Game language (fits stylised B and the Watch Dogs 2 bar: real, grounded, not toy-like)
4. Pass: average 8 or more and no line under 6. Below that, the object gets a fix (the builder improves it and scores again), up to 3 rounds; then a task with a different approach.

## Where it lives
- harness/reports/reality/<object>.jpg: the side by side sheet (reference left, game right) with the scores printed on it.
- harness/data/reality_scores.json: object id, scores per line, average, pass, date, the commit, reference photos used.
- The dashboard shows the catalog: pass, fail, not yet scored, with the sheets.

## Who runs it
- Every builder that adds or changes a visible object scores it before reporting (self-score, honest, with the sheet).
- Verifiers rescore the objects a task touched; a verifier score below pass fails the task, the same as a missing feature.
- The look critics (P2-051 and later) sweep the whole catalog, worst first, and the orchestrator turns failures into fix tasks without asking Anmol.

## Image textures vs procedural: pick by evidence, never by source
Anmol 2026-11-14: "even when I send back images, see if this image is better or you making a texture is better ... from a wide view you can see the pattern ... or the size makes it grainy or too detailed".
- Every owner image texture is tried in game against the procedural one, A/B, on the same surface, at three distances (2 m, 15 m, 60 m) and in day and night. The one with the higher REALITY_MATCH score wins; ties go to the cheaper one. A mix is allowed (image for close detail, procedural for large variation).
- Fixed texel density: every tiling surface maps at one real scale (walls and roads about 512 px per metre near, the size the card states), so bricks, cracks and aggregate are life size; a texture is never stretched or shrunk to fit.
- No visible repetition from far: tiling surfaces use anti-tiling (stochastic or rotated tiling, a large-scale macro variation layer, and decals placed by rules: stains under sills, cracks, patches), and a repetition check on the 60 m shot (a pattern repeating more than a few times across the frame fails).
- Detail at two scales: a near detail layer that fades out with distance and a far macro layer, so it is never grainy close up or a fine noise far away; mipmaps and anisotropic filtering on.
- The art reviewer and the verifier read the three distance shots before an image texture replaces anything.
