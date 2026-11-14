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
