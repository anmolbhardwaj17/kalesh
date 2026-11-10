# Style interview script (Phase 0)

The orchestrator runs these rounds with the owner. Use AskUserQuestion when it is available (multiple choice with an "other" answer), else plain questions in the terminal. Ask one round at a time, at most 6 questions per round, and wait for the answers. Record every answer verbatim (`node harness/bin/task.mjs inbox-add "<his words>" --source interview`, then `inbox-ack` with "style round N"), and pass all answers so far to the planner in STYLE_DISCOVERY mode after each round.

Rules:
- Never answer for the owner, never assume. "I don't know" is an answer: offer two or three concrete options next round.
- Show before asking where you can: the current game shots in round 1, the side by side sheet from round 3 on.
- Plain English, short questions, no jargon without a one-line explanation ("toon shading: flat bands of light, like a cartoon").
- Keep a running summary at the top of STYLE_OPTIONS.md ("What we know so far") so the owner can correct it.

## Round 1: references and mood (before any test)

Show: 3 or 4 shots of the game as it is now (from the ADOPT baseline).

1. Name 2 to 5 games whose look you love for this game. What exactly do you like in each (colour, lighting, shapes, mood, UI)?
2. Any films, shows, illustrators, paintings or photos that have the feeling you want? Links or names.
3. Three words for how a player should feel looking at it (for example: cosy, tense, lonely, playful, grim, dreamy).
4. What do you NOT want it to look like? Any game or style that would be wrong for it?
5. What do you like about how it looks today, and what would you throw away?
6. Who plays it, on what (laptop, desktop gaming PC, phone, tablet), and at what resolution? What is the weakest machine it must run well on?

## Round 2: concrete axes

Show: the planner's candidate list with one line and one reference image link (or a description) each.

1. Palette: warm or cold, saturated or muted, dark or bright overall? Any colours that must be there (brand, character)?
2. Lighting: soft and flat, dramatic with strong shadows, neon and night, golden hour, overcast? Does time of day or weather change?
3. Camera: first person, third person behind, top down, isometric, side view, fixed angles? How close?
4. Shapes and detail: chunky and simple, detailed and realistic, hand made and imperfect, pixel grid?
5. Characters: realistic proportions, stylised, chibi, abstract? Faces with expressions or not?
6. Assets: who makes art? You with AI image tools (which ones), AI 3D model tools, store packs, or mostly procedural? How much time per week can you give to making art?

## Round 2b: the place (games set in a city or a real location)

Use when the game is set in a real or invented place, or moves to a new one (for example a driving game moving from one city to another). Fill `CITY_BRIEF.md` from the answers.

1. What is the place in your head: which districts, streets or views must a player recognise? Any personal memories of it?
2. Which landmarks must appear, and how close does the player get to them (drive past, in the skyline, a hero location)?
3. Roads and traffic: what kinds of roads (lanes, flyovers, old lanes, dirt shoulders), and what is on them (cars, auto-rickshaws, two-wheelers, buses, trucks, animals)? How chaotic should traffic feel?
4. Signs and text: which scripts and languages, what kinds of signs (road signs, shop boards, hoardings, painted walls)? Any phrases you want, checked by you?
5. Light and weather: which time of day and season is the place at its best for this game (harsh summer noon, golden evening, monsoon, winter fog, night lights)?
6. Fidelity: from the options (stylised low-poly city, stylised realistic, realistic PBR with baked lighting, photo-textured), which is closest to what you picture, given the honest costs in performance at speed and number of assets?

## Round 3: side by side tests

Show: `harness/reports/look/style_options.jpg` (every candidate rendered in the real game) and the comparison table with measured frame times.

1. Which one or two are closest? What is right and wrong in each?
2. Would a mix work (for example the toon lighting of B with the palette of D)?
3. Any candidate that is out?
4. Is the measured performance acceptable on your weakest machine (for a vehicle game: while driving at top speed through the busiest area), or should we trade look for speed (or the other way)?
5. Anything in the comparison that surprised you or that you do not believe?
6. What would you need to see to decide (another scene, a character close-up, night, UI over play)?

## Round 4 and later: refine until sign-off

Show: the refined test(s) and an updated sheet.

1. Is this the style? If not, what one change would get it there?
2. Palette, lighting and UI details you want changed.
3. The budgets: these frame time, load time and draw call numbers become the rules every task is checked against. Agreed?
4. The AI art prompts: here is a sample prompt and (if made) a sample image for one texture and one character in this style. Does it match?

## Sign-off

Ask exactly: "Do you sign off <style name> as the look of <game>, with these budgets, so I can write the style bible and start building? A yes in your own words is the sign-off." Only an explicit yes counts. Record it with `node harness/bin/task.mjs signoff "<his exact words>"`, then work through `SIGNOFF_CHECKLIST.md`.
