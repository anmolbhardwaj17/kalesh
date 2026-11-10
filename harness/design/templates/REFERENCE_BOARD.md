# Reference board format

The reference board lives in STYLE_OPTIONS.md ("Reference board") during Phase 0 and moves into STYLE_BIBLE.md ("One-line look") after sign-off. It is the shared memory of what the owner showed and said.

## Rows

| # | Reference | Kind | Where to see it | Take | Leave | Round |
|---|---|---|---|---|---|---|
| 1 | <game, film, artist, photo> | game / film / show / art / photo / own sketch | <link, or "owner's file assets_inbox/ref_01.png"> | <what we copy: palette, rim light, chunky shapes...> | <what we do not: gore, photoreal faces...> | 1 |

## Rules

- One row per reference, in the owner's words where possible.
- "Take" and "Leave" are concrete and visual (colours, light, shapes, materials, camera, UI), never "the vibe".
- Images the owner uploads go to `assets_inbox/` with an id starting `ref_` (register with `assets.mjs add --kind keyart --id keyart_ref_01 --intent "owner reference"` so the dashboard accepts the upload); they are never shipped in the game.
- No copyrighted image is copied into the game or into a prompt as "in the style of <living artist>": prompts describe the visual qualities instead.
- Group rows by axis at the end of each round: palette, lighting, shapes, materials, camera, characters, UI, mood.
