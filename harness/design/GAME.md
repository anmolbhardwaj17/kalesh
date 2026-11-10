# Dilli Darshan: Game Design

<!-- Template. The planner fills it in ADOPT mode from the game as found ("as found" sections), and the owner's answers turn
it into the design. Every section: short, concrete, checkable. Mark mentor decisions with "(owner, YYYY-MM-DD)" and keep
the reason in one line. Builders read only the sections docs/READ_MAP.md lists for their area, so keep headings stable. -->

## As found (ADOPT, YYYY-MM-DD)

<!-- What the game is today, before the harness: genre, what a player can do from boot to the end of the current content,
what is finished, half done or broken, content counts (levels, enemies, items), known bugs. Facts only, with file paths.
Open questions for the owner go in a list at the end. -->

## Pillars

<!-- 3 to 5 lines. What the game must always feel like. Every feature is judged against these. Example of a good pillar:
"Stealth over combat: every encounter can be passed unseen". A bad one: "Fun gameplay". -->

## Scope guardrails (hard rules for the builders)

<!-- What is out of scope, size limits (levels, playtime, characters), platforms, browsers, input devices, online or not.
Why: builders add features when nothing says no. -->

## Core loop

<!-- The minute to minute loop and the session loop, as numbered steps. -->

## Player verbs

<!-- Every action the player has, with its input (keyboard, mouse, gamepad, touch) and what it does. One line each. -->

## Systems

<!-- One subsection per core system (stealth model, combat, economy, crafting, physics puzzles...). For each: the rules,
the numbers that tune it (and where they live in code or data), and how it is verified (scenario or test name). -->

## Movement and camera feel

<!-- The numbers that define feel: speeds, acceleration, jump height and time, camera distance, field of view, collision
rules near walls. Each number measurable by a scenario (VERIFY.md). Why: "feels floaty" cannot be verified, "apex in
0.35 s" can. -->

## Milestones

<!-- The playable units (kit.config.json milestoneWord). The list lives in harness/data/milestones.json; here: the
structure (chapters or worlds), how long each is, what each must contain (goals, optional goals, secrets), and the rules
for every play script (VERIFY.md "Play scripts"). -->

## Level design rules

<!-- Rules every level or scene follows: alternative routes, readability of goals, checkpoints, difficulty ramp, the
small-detail rule (props near the player so the world feels lived in), teaching each new verb before it is needed. -->

## Progression and economy

## HUD

<!-- What is on screen during play, where, and when it hides. The HUD never covers the player (shot rule). -->

## Menus

## Audio

## Accessibility

<!-- Remappable input, subtitles, reduced motion, colour-blind safe signals, difficulty options. Each with its check. -->
