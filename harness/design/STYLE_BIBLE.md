# Dilli Darshan: Style Bible

<!-- Written ONLY after the owner signs off a style in Phase 0 (task.mjs signoff). Until then this file holds this
template and the line "Not signed off yet: see STYLE_OPTIONS.md". The planner writes it from the chosen column of
STYLE_OPTIONS.md, the reference board and the owner's words. Builders read it for anything visual; the art-director and
art-reviewer read "AI image prompts" before every pass. Every rule here should be checkable on a screenshot. -->

Status: Not signed off yet: see STYLE_OPTIONS.md.

## One-line look

<!-- One sentence a stranger could paint from, plus the 2 or 3 references it is built on (from the reference board). -->

## Palette

<!-- Named colours with hex values, what each is for (ground, walls, accents, danger, UI), and colours that are banned.
A grade or LUT, if any, and how far it may shift colours. -->

## Lighting presets

<!-- One per time of day, weather or mood the game uses: key light colour and direction, fill, ambient, fog, shadows,
exposure. Where the numbers live in code. -->

### Readability floor

<!-- The player, the ground around them and the next goal are clearly visible in every shot, including night and dark
scenes. Give the measurable floor (for example: mean luma over 0.08, under 40 percent near-black pixels), and what may
glow (only small emissives) so nothing washes out. -->

## Materials and shading

<!-- The shading model (flat, toon ramp with N bands, PBR roughness ranges, painterly textures), outlines (width, colour,
when), texture density (texels per metre at the play camera), normal map strength, what is procedural and what is a file. -->

## Scale and camera

<!-- Real world scale in metres, the player's size, camera distance, height and field of view per mode, near plane rules
(no clipping into walls or the player), how the camera behaves in tight spaces. -->

## Shapes

<!-- Silhouette rules: chunky or thin, bevels, how much detail per object, the small-detail rule (props near the player). -->

## Characters

<!-- Proportions, how characters read at the play camera, animation style (snappy or weighty), each main character's
fixed look (matches STORY.md). -->

## Effects

<!-- Particles, post effects (bloom limits, depth of field, AO, motion blur), and their cost budget per preset. -->

## UI

<!-- Fonts, sizes, colours, panels, icon style, motion. The HUD never covers the player. -->

## Performance budget of the look

<!-- The signed numbers from harness/verify/perf_budgets.json in words: frame time p95, draw calls, triangles, GPU memory
and load time per preset on the target machine, and which features each preset turns off. -->

## Approved reference shots

<!-- harness/look_proof/approved/ (lookproof.mjs --approve), which views it has, and the tolerances in
harness/verify/look_rules.json. A look task compares against these. -->

## AI image prompts

<!-- For the art-director: the image tool, then per asset kind (texture, decal, icon, portrait, key art, backdrop, ui,
sprite, model) a style anchor (the sentence that starts every prompt of that kind), the technical tail (view, background,
size, tileable, transparency, "no text, no letters, no logos"), and one example prompt that worked. -->

### Style anchors

### Technical tails

### Audio prompt style

<!-- For sound effects and music: the sound palette, reverb, loudness, loops. -->
