# Dilli Darshan: Game Design

<!-- Template. The planner fills it in ADOPT mode from the game as found ("as found" sections), and the owner's answers turn
it into the design. Every section: short, concrete, checkable. Mark mentor decisions with "(owner, YYYY-MM-DD)" and keep
the reason in one line. Builders read only the sections docs/READ_MAP.md lists for their area, so keep headings stable. -->

## As found (ADOPT, 2026-11-10)

Dilli Darshan is a new repo, not an adopted game. What exists today is a minimal scaffold:
- One scene: a 2 km sand coloured ground plane, one straight grey road strip along the Z axis, a red north post 50 m north of the origin (`src/main.ts`).
- A box car (yellow body, dark cabin) driven with the arrow keys by a simple kinematic model (`src/car.ts`, tuned in `CAR`: accel 8, brake 14, drag 0.6, max 30 m/s, turn rate 1.6). No physics engine, no collisions.
- A chase camera 10 m behind and 4.5 m up. A one-line HUD hint. No menus, audio, save, traffic or world data.
- The hook contract `window.__game` (`src/debug/hooks.ts`) and unit tests for the coordinate rule and the car (`src/car.test.ts`, `src/debug/hooks.test.ts`). `verify --quick` was green on 2026-11-10 (boot_title, hooks_contract, perf_baseline) on an Apple M2 Pro (ANGLE Metal).
- Content counts: 1 scene, 1 vehicle, 0 missions.

The intended game (owner inbox, 2026-11-10): an open-world driving game set in Delhi, built from real map data put through a map repair layer (`harness/design/MAP_REPAIR.md`), with lane-level roads, rich Delhi assets, polished. The old game `/Users/apple/Desktop/code/delhi-drive` is a read-only reference (salvage audit in Phase 0).

Open questions for the owner (asked in the Phase 0 interview rounds, never invented):
1. What does the player do besides free drive: missions (taxi, delivery, sightseeing "Dilli Darshan" tour), races, exploration goals?
2. Which vehicles: hatchback, auto-rickshaw, scooter, bus? Which one first?
3. Day only, or a day and night cycle, fog and smog, monsoon rain?
4. Traffic and pedestrians: how dense, how chaotic (Delhi honking and lane discipline, or a calmer version)?
5. Target hardware and browsers beyond this M2 Pro: other laptops, phones, tablets?
6. How big must the first playable city area be (pilot area only, or a wider New Delhi core)?

## Draft pillars (from the owner's inbox, 2026-11-10; confirm in the interview)

- Real Delhi: the roads, junctions, flyovers and landmarks are where they are on the map, and a Delhiite recognises them.
- Solid base: no floating or sunk roads, no overlapping faces, no railings in the wrong place, collisions match what you see.
- Rich and polished: every street feels lived in (props, signs, traffic, sound), never thin.
- Fast in the browser: smooth on this machine within the signed budgets, streaming without hitches.

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
