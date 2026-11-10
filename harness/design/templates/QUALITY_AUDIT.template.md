# Dilli Darshan: Why it feels thin (quality audit)

<!-- Copy to harness/design/QUALITY_AUDIT.md. Written in ADOPT (Phase 0) by the planner from shots, short drives or play
sessions through the hooks, measurements and the code, BEFORE style discovery, so the owner sees an honest picture and the
style rounds aim at the real gaps. Be honest: a polished game would pass every bar below; say plainly where this one does
not. Every finding has evidence (a shot path, a measured number, a file:line) and a fix size (S under a task, M one task,
L several tasks). Sections that do not apply to the genre say "n/a" with one line why. -->

Date: YYYY-MM-DD. Build: <commit>. Machine: <model, GL renderer>. Evidence folder: `harness/reports/audit/`.

## Summary

<!-- Five lines: the three biggest reasons it feels thin, the one biggest strength to protect, and the overall score
against the bar (count of bars met per section). -->

## The quality bar

<!-- What "polished and rich" means for THIS game, with 2 or 3 reference games the owner named or that sit in its genre.
Each section below scores: meets the bar / close / far, with the evidence. -->

## Visuals

| Area | Bar (what a polished game has) | Found | Evidence | Fix size |
|---|---|---|---|---|
| Lighting | Key, fill and bounce read the time of day; contact shadows; no flat unlit look | | | |
| Materials | Varied roughness and wear; no single flat colour per object; road, wall and metal read as what they are | | | |
| Density | The play space is full at the play camera: no empty stretches longer than a few seconds of play | | | |
| Props | Small props near the player and along the path (signs, bins, cables, plants, clutter) | | | |
| Sky and distance | A sky that matches the light; distance fog or haze; a skyline or far shapes, not a void | | | |
| Post processing | Tone mapping and grade in place; bloom only on emissives; AO or equivalent; no banding | | | |

## Feel (movement, or driving for a vehicle game)

<!-- For a driving game, measure with the hooks: speed over time from standstill, top speed, steering response at low and
high speed, slip angle before a skid, braking distance, camera distance and FOV at speed, shake. For other genres use the
player's verbs. -->

| Area | Bar | Found (measured) | Evidence | Fix size |
|---|---|---|---|---|
| Handling | Responsive at low speed, stable at high speed, a readable limit before losing grip | | | |
| Speed sense | The player feels fast: FOV widens with speed, motion cues (road lines, roadside objects, blur), sound rises | | | |
| Camera | Follows with lag and look-ahead, never clips, stays readable in turns and collisions | | | |
| FOV and shake | FOV range per speed; subtle shake on rough surfaces and impacts, never constant | | | |
| Collisions | Hits feel physical (sound, shake, sparks) and fair (no invisible walls, no sticking) | | | |

## Audio

| Area | Bar | Found | Evidence | Fix size |
|---|---|---|---|---|
| Engine (or main loop sound) | Layers that follow speed and load (rpm, gear shifts), not one looped tone | | | |
| Ambience | Place sound beds that change by area and time (city hum, birds, crowds, wind) | | | |
| Horns, voices, one-shots | Events have sounds; traffic and people make the place sound alive | | | |
| Mix | Nothing clips; music sits under effects; volume settings work | | | |

## VFX

| Area | Bar | Found | Evidence | Fix size |
|---|---|---|---|---|
| Dust and smoke | Wheels or feet kick up dust on dirt; exhaust or smoke where it fits | | | |
| Skid marks and decals | Marks persist for a while and fade; impacts leave marks | | | |
| Heat haze, rain, weather | Weather and heat effects that sell the place, priced against the budget | | | |
| Impacts | Sparks, debris, flashes on hits | | | |

## Traffic and life

| Area | Bar | Found | Evidence | Fix size |
|---|---|---|---|---|
| Traffic | Other vehicles with believable behaviour (lanes, stopping, horns), density that fits the place | | | |
| People and animals | Pedestrians, vendors, animals where the place has them | | | |
| Ambient motion | Things move: flags, trees, signs, laundry, birds | | | |

## UI and HUD

| Area | Bar | Found | Evidence | Fix size |
|---|---|---|---|---|
| HUD | Speed, map or direction, goals readable at a glance; styled to the game | | | |
| Menus | Title, pause, settings, results styled and responsive; no default browser look | | | |
| Feedback | Every action and goal change is acknowledged (sound, motion, text) | | | |

## Performance

| Area | Bar | Found (measured) | Evidence | Fix size |
|---|---|---|---|---|
| Frame time p95 during play (driving at top speed for a vehicle game) | Under the draft budget on the target machine | | | |
| Draw calls and triangles at the busiest view | Under budget, with instancing for repeated objects | | | |
| Pop-in at draw distance | Objects and LODs appear without visible popping at play speed | | | |
| Load time | Under budget; a loading screen if long | | | |
| Hitches | No frame over 50 ms while streaming or spawning | | | |

## What to protect

<!-- The things that already work and must not regress (with the scenario that will guard each). -->

## Proposed order

<!-- The fixes grouped into tasks, biggest feel per effort first. These feed the phases planned after the style sign-off. -->
