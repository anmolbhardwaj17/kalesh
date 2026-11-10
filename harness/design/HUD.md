# Kalesh: HUD and UI

Status: proposal for Anmol to react to (P0-030, 2026-11-10). Not signed. The HUD build happens after the style sign-off, and its final look follows `STYLE_BIBLE.md`. Anmol's words that started this: the stand-in HUD (text box, plain cross compass, speed box, `harness/look_proof/baseline/hud_play.png`) is not acceptable; he wants a proper modern HUD with in-world hints, targets and mission displays, inspired by GTA V, what GTA VI has shown, and other modern games.

How to read this doc: research first (what we take and what we avoid from each game), then the principles, the visual language, the layouts, the component list with tags and costs, the special systems (route guidance, Lal Batti, mission screens), motion, accessibility, checkable rules for the build, and the questions for Anmol. Tags match GAME.md: SLICE (first playable slice, M01 to M04), RELEASE, LATER. "(Claude call)" marks a choice Anmol has not made yet.

Mockups (1920x1080, HUD drawn over the mood references): `harness/design/hud_mockups/01_driving.png`, `02_on_foot.png`, `03_combat_wanted.png`, `04_mission_passed.png`. Sources and the render script: `harness/design/hud_mockups/src/` (`node harness/design/hud_mockups/src/render.mjs`). The backgrounds are Anmol's ChatGPT mood images, not game frames; the HUD is the subject.

## Research (10 references)

Inspiration only. We never copy a game's exact layout, icons, fonts or colours. Each row says what we take and what we avoid.

| Game | What it does (as shown or documented) | We take | We avoid |
|---|---|---|---|
| **GTA V** (2013) | Rectangular radar bottom left, with health, armour and the special ability as thin bars under it; wanted stars top right that flash while police search; cash shows only when it changes; objective text in white at the bottom with key words coloured (place, enemy, ally); help box top left; GPS route drawn on the radar; big "mission passed" moment with a score list; "wasted" and "busted" full screen. | Vitals folded under the minimap. Wanted level as a row of icons that blinks while searching. Cash shown only on change. Coloured key words in the objective. A real pass moment with stats. | Its fonts and yellow mission colour. Objective text at the very bottom, where it fights the subtitles. The radar that lies flat at the bottom edge with no breathing room. |
| **GTA VI** (Extended Look gameplay video, about 27 Aug 2026, as reported by press) | Health and Focus bars top left that disappear when no threat is near; ammo, wanted stars and a row of police unit icons (officer, car, helicopter) top right; rounded rectangle minimap bottom left with a pink GPS line and a live distance readout; the minimap tints red during a police search; floating prompts at the point of use (knock, bag) and stacked context verbs on the right edge; real time text message cards, even mid fight; an Instagram-like social feed and a livestream overlay on the phone. Fans called the look plain and "undercooked". | Vitals that hide when calm. Distance readout on the route. The minimap tinted by the search. Prompts that sit on the object. Message cards as the phone's voice in play. A "who is coming" response row under the wanted level (RELEASE). | A plain, generic icon set with no personality (the main fan complaint). Anything not shown publicly is a guess here: the final pass and fail screens, the full map screen and settings are **not publicly shown (guess)**. |
| **Red Dead Redemption 2** (2018) | Sparse HUD by default, small minimap bottom left, the HUD hides while exploring, every element can be shrunk or turned off, prompts in the lower right corner. Players reported missing prompts in the corners. | Minimal by default and a per element on, off or "contextual" setting. The rule that an element earns its place on screen. | Prompts in a corner far from the action (players missed them). |
| **Ghost of Tsushima** (2020) | No waypoints; the Guiding Wind blows toward the objective; very little HUD. The accessibility review found the white wind streaks lose contrast in snow, and subtitles cannot be resized. | Guidance in the world, not only on a map: our road ribbon plays the same role for driving. Guidance must survive with the minimap off. | Low contrast guidance with no fallback. Fixed size subtitles. |
| **Forza Horizon 5** (2021) | A route line drawn on the road surface, with an option to show it only at braking points; a GPS voice that can be turned off. Colour blind players report the route and map are hard to read. | A road ribbon in the lane to take, only near the next turn, fading with distance. A setting for always, near turns, or off. | A full length painted line that turns the street into a race track. Colour as the only signal. |
| **Watch Dogs 2** (2016) | The phone is the main interface: hacks and many actions are icons on a phone; a loud, graphic street style. | The phone as the home of messages, contacts and jobs (RELEASE). A graphic voice that feels local, not corporate. | Its glitch and hacker visual language. It does not fit three ordinary Delhi lives. |
| **Cyberpunk 2077** (2020) | HUD in four fixed corners like The Witcher 3; minimap top right. The minimap was criticised for missed exits at driving speed and reworked in patch 1.3; 2.0 added a HUD safe zone option. | A minimap that zooms out with speed and shows the next turn early. A safe zone setting. | A dense HUD in every corner. A minimap too zoomed in for the speed. |
| **Sleeping Dogs** (2012) | Health and Face meters wrapped around the minimap; the minimap is built from loaded world chunks; police blips hand animated. Closest to our scale: an Asian city, a cop story, fist fights and chases. | Meters that belong to the minimap. Character specific meter next to health (our Gali, Pursuit, Nerve). Hand tuned police blips. | Its 2012 bevelled look. |
| **Marvel's Spider-Man 2** (2023) | Clean prompts; options for the size of in-world waypoints, icons and prompts, a contrasting HUD background, high contrast mode, UI parallax off, holds to toggles. | The accessibility set almost as a checklist: marker and prompt size, HUD backing, hold to toggle, high contrast. | UI parallax (we do not add it at all). |
| **Mafia: Definitive Edition and Sleeping Dogs style mission cards** (common pattern) | A chapter title card over a held frame at mission start. | A chapter card with the lead's name (Adhyay 1, The Cop). | Long unskippable cards. |

What the research says overall: the best modern open world HUDs hide by default, put guidance in the world, keep the minimap for "where am I", and make the big moments (mission start, pass, fail, wanted) feel like events. The weakest ones (by player reports) are generic in look, put prompts far from the action, or use colour alone.

## Principles

1. **Quiet by default.** In calm free roam only the minimap is fully on. Vitals hide when full and calm; cash, weapon and wanted show when they matter. Target: the driving HUD covers under 9% of the screen.
2. **The world first, the HUD second.** Objective pins, prompts, enemy marks and the road ribbon live in the world, on the thing they point at. The minimap confirms; it is not the only guide.
3. **Readable at speed.** At 120 km/h the player must see the next turn 6 s ahead (turn card plus ribbon), the minimap zooms out with speed, and nothing important sits in the middle 40% by 50% of the screen except world markers and the reticle.
4. **One meaning, one shape, one colour.** Objective: marigold diamond. Hostile: red down chevron. Police: blue arrow with a red dot. Ally or contact: tint circle. Shape always carries the meaning, so colour blind players lose nothing.
5. **Events feel like events.** Mission start, objective change, wanted raise, pass, fail and switch each get a short, designed moment with motion and sound, and then get out of the way.
6. **Three lives, three tints.** Each lead has a tint (Driver auto green, Cop police blue, Fixer rani pink) on small accents only: the player arrow, the skill bar, the mission line, the pass card. The rest of the HUD is shared, so the game feels like one game.
7. **Dilli, not generic.** Place names in Devanagari and Latin like real Delhi signs, an auto fare meter for the driver, a Lal Batti beacon for the wanted level, stamps for mission medals, Hinglish subtitles. No real brands (respect rule).
8. **Restraint over decoration.** Warm dark glass, thin hairlines, one display face and one text face. No sci-fi frames, no glitch, no chrome.
9. **Everything can change size or go away.** HUD scale, text scale, per element on, contextual or off, and guidance that still works with the minimap off.

## Visual language

- **Fonts (free, licences checked):** Teko (Indian Type Foundry, SIL Open Font License 1.1, Latin and Devanagari) for titles, numbers and labels; Mukta (Ek Type, SIL Open Font License 1.1, Latin and Devanagari) for objective text, prompts, subtitles and messages. Both from Google Fonts. The Godot default font has no Devanagari (decisions.md, P0-009), so both ship with the game as .ttf files. Godot's advanced text server shapes Devanagari through HarfBuzz.
- **Colours (proposal, tuned at the style bible):** text warm white `#F6EFE4` (dim 70%, faint 42%); glass `#110D0A` at 56% with blur; hairline warm white at 16%; objective marigold `#FFB224`; danger `#FF3B36`; police blue `#4F8DFF`; tints Driver `#46D67C`, Cop `#5AAEFF`, Fixer `#FF4F9A`; fare meter LED `#FF7A45`.
- **Shapes:** rounded glass panels (10 px radius, 22 px for the minimap), 1 px hairlines, 6 px bars, key glyphs as light rounded squares. Text without a panel gets a soft shadow and, over busy backgrounds, a soft dark scrim behind it.
- **Safe margins:** 64 px left and right, 56 px top and bottom at 1080p (scales with resolution and the safe zone setting).
- **Sizes at 1080p and 100% scale:** body text 19 to 23 px, never under 15 px; titles 24 to 150 px; minimap 312 px driving, 268 px on foot.

## Layouts

Driving (mockup 01):
```
+------------------------------------------------------------------+
| -- TRAIN AT 6:10                                   [Lal Batti]   |
| Drop Sharma-ji at New Delhi Station                 (hidden: 0)  |
| (04:12)                                                          |
|                              <> 650 m  (objective pin in world)  |
|                                 ^ ^ ^  (road ribbon, next turn)  |
| [-> 150 m  Right, Janpath]                        [METER Rs 86]  |
| +--------+                                          .-'''-.      |
| | minimap|                                         (  42   )     |
| | head up|      SHARMA-JI  Bhaiya, thoda jaldi...    km/h        |
| +--------+                                                       |
| health ====  gali ===                                            |
+------------------------------------------------------------------+
```
On foot (mockup 02): the minimap shrinks to 268 px and fades when idle; the speed and meter go away; prompts sit on the person or object with a leader line; the area reveal shows top centre on first entry; phone messages top right; cash bottom right only when it changes.
```
+------------------------------------------------------------------+
| -- CHANDNI CHOWK PICKUP         चाँदनी चौक         [Bunty: msg]  |
| Collect the bag from Gupta-ji   CHANDNI CHOWK                    |
|                                 Old Delhi, 4:52 pm               |
|   (o)--[E Talk  Gupta-ji]                                        |
|        [Q Buy jalebi Rs 40]                                      |
| +------+                                                         |
| |mini  |                                             Rs 12,450   |
| +------+ health  nerve                                           |
+------------------------------------------------------------------+
```
Combat with wanted (mockup 03): Lal Batti beacons top right with a state word (SEEN, SEARCHING), weapon card under them, red chevrons over hostiles, lock-on brackets and a health pip on the target, a hold ring prompt for takedowns, a hit counter, damage arcs on the screen edge, the minimap with the red search circle, police blips and a red and blue rim.
```
+------------------------------------------------------------------+
| -- LAXMI NAGAR, AFTER DARK                 (*)(*)(*)( )( )       |
| Shake off Pappu's boys                 लाल बत्ती · LAL BATTI SEEN |
|                                                    [FISTS brick] |
|           v        v         v                                   |
|(        hostiles        [ target ]  (E) TAKEDOWN                 |
|(  damage arc                          3 HITS                     |
| +--------+                                                       |
| | search | red and blue rim while police chase                   |
| +--------+ health (red, low)                                     |
+------------------------------------------------------------------+
```
Mission start (no mockup, same parts as the pass card): letterbox bars slide in, the chapter chip (`ADHYAY 1 · THE COP · MISSION 2`), the title in Devanagari large and English spaced under it, then the first objective rises into the top centre and settles into the tracker. Skippable after 1 s. 3 s total.

Mission passed (mockup 04): letterbox, a dark gradient from the left, chapter chip, title, a tint slab `PASSED सफल`, 5 stat lines, up to 3 stamps (the medals of a mission, which feed the stamp book at RELEASE), cash and standing reward on the right, Replay and Continue.

Mission failed (no mockup): the world slows and desaturates, a short reason line in large type (`BUSTED · पकड़े गए`, `WASTED`, `THE TRAIN LEFT`, `SHARMA-JI WAS HURT`), one hint line, and two prompts: `Retry from checkpoint` (default, instant) and `Quit mission`. No stats on fail.

## Component list

Cost: S is a few hours for a builder, M about one session, L more than one session. Godot notes say how it is built.

| Component | What it shows and when | Tag | Cost and how |
|---|---|---|---|
| Minimap | Rounded square, heading up in vehicles and north up on foot (Claude call; GAME.md said north up, question 3). Roads from the baked lane model, parks, landmarks, objective, contacts, police, hostiles, street name in two scripts. Zooms out with speed (80 m visible radius on foot, about 320 m at 120 km/h). | SLICE | M. Baked 2D road texture per map tile at bake time, drawn in a SubViewport, rotated and masked by a shader; blips are Control nodes. Budget about 0.3 ms (estimate). |
| Vitals | Health (4 segments) and the lead's skill bar (Gali, Pursuit, Nerve) under the minimap; armour bar only when worn. Hide when full and calm for 8 s. | SLICE | S. ProgressBar or a small shader. |
| Objective tracker | Top left: mission name with the tint line, the goal with marigold key words, one sub line, a timer when there is one. A new goal first shows top centre large for 4 s, then moves to the tracker. | SLICE | S. Rich text with colour tags from the mission data. |
| World objective pin | Marigold diamond with a distance, on the place or person; clamps to the screen edge as an arrow when off screen; fades within 15 m and hands over to the prompt. | SLICE | S. Camera3D unproject with edge clamping. |
| Route on minimap | Marigold line on the minimap to the objective, white for a player waypoint. | SLICE | M. Path search on the lane graph (shared with pursuit AI), polyline in the minimap view. |
| Road ribbon | Chevrons on the road in the lane to take, about 150 to 250 m ahead, strongest near the next turn, fading at both ends. Setting: always, near turns (default), off. | SLICE | M. A mesh strip along the lane centrelines 2 cm above the road, unshaded additive material with scrolling chevrons, rebuilt when the route changes. |
| Turn card | Above the minimap: turn arrow, distance, road name, then the next step. Shows 6 s ahead at current speed (at least 150 m). | SLICE | S. From the route's manoeuvre list. |
| Arrival cue | Pin pulses, ribbon ends in a ring on the ground at the stop point, a short chime, "Stop here" in the tracker. | SLICE | S. |
| Interaction prompt | On the person or object with a leader line: key glyph and verb, the target's name under it, up to one secondary verb dimmed. Holds show a ring. Falls back to bottom centre if the anchor is off screen. Glyphs follow the active device and remaps. | SLICE | S to M. Input glyph map for keyboard and Xbox layout. |
| Subtitles | Bottom centre, speaker name in the speaker's colour (leads in their tint), Hinglish line, optional English translation line below. Background box with set opacity. | SLICE | S. |
| Speed | Bottom right: big number, a thin arc to the vehicle's top speed, km/h. Arc goes red near the vehicle's damage limit. | SLICE | S. |
| Fare meter | Driver on a fare: an LED style meter above the speed with fare, km and time. The driver's money widget on a fare. | SLICE | S. |
| Lal Batti (wanted) | Top right: 1 to 5 beacons, Devanagari and Latin label, state word. Details below. | SLICE (1 to 3), RELEASE (4, 5) | S. Plus a minimap search circle and rim shader. |
| Police response row | Small icons under the beacons: foot police, cars, barricade, armed units, helicopter or drone. | RELEASE | S. |
| Weapon card | Top right under the wanted level: weapon icon, name, ammo (clip and total), throwable count with its key. Shows on change, in combat and while aiming; hides after 4 s calm. | SLICE | S. Icons are drawn line art in our own style. |
| Reticle and lock-on | A small dot reticle when aiming; soft lock brackets on the target with a health pip; a hit mark on hits. Melee lock shows the brackets only. | SLICE | S. |
| Hostile marks | Small red down chevrons over hostiles that are in a fight with you; nothing over calm people. | SLICE | S. |
| Damage arcs | Red arc on the screen edge toward the hit, 0.9 s. Low health vignette under 30%. | SLICE | S. Screen shader. |
| Detection meter | For the fixer's tailing and pickups: an arc over a watcher that fills white, then orange, then red when he notices. | SLICE (M03) | S. |
| Money | Cash with a count up and a coloured change line, top right or bottom right on foot, only on change and in shops. | SLICE | S. |
| Notifications | Phone message cards top right (avatar, name, Hinglish line, translation), 6 s, queue of 3, never during a mission card. | SLICE | S. |
| Area reveal | Top centre, on first entry to a district or hero place, and on each chapter's first drive: Devanagari name large, Latin spaced under it, area, time and weather. 3 s. | SLICE | S. Names from DELHI_WORLD.md area profiles. |
| Character switch | At story beats: the new lead's portrait chip with the tint for 2 s, the HUD tint cross fades. A fuller switch transition (camera lift over the city) is LATER. | SLICE (chip), LATER (transition) | S, then M. |
| Mission start card | See layouts. | SLICE | M. With the mission system's data. |
| Mission pass card | See layouts and mockup 04. | SLICE (stats and cash), RELEASE (stamps feed the stamp book) | M. |
| Mission fail and retry | See layouts. Instant retry from the checkpoint. | SLICE | S to M. |
| Busted and wasted | Outside missions: the same fail look with the place you wake up and the money lost. | SLICE | S. |
| Pause menu | Resume, map, settings, quit to title over a blurred held frame. | SLICE | S. |
| Map screen | Full map from the baked tiles, districts opened and closed, markers, waypoint, legend, zoom and pan. | SLICE | L. |
| HUD settings | Scale, text scale, subtitle size, per element on, contextual or off, ribbon mode, colour blind mode, high contrast backing, hold to toggle, reduced motion. | SLICE (scale, subtitles, ribbon, off switches), RELEASE (rest) | M. |
| Phone | The lead raises a phone: messages, contacts, jobs and fares, map, an invented social feed (no real brands). | RELEASE | L. |
| Weapon wheel | Hold Tab: radial wheel, the game slows to 0.3x while open. | RELEASE | M. |
| Cop extras | Barricade call ready chip [B] with a cooldown ring during pursuits; arrest hold ring. | SLICE | S. |
| Photo mode | Hide HUD, free camera, filters. | LATER | M. |

## Route guidance

- Three layers that agree: the minimap line (where), the turn card (what next), the road ribbon (which lane, now). Any one can be off and the other two still guide.
- The turn card leads by time, not distance: it shows the next manoeuvre 6 s ahead at the current speed, at least 150 m.
- The ribbon only covers the next 150 to 250 m and is strongest 40 to 120 m ahead. It is never under the player's vehicle and never over the subtitle area. Chevrons are spaced so 3 to 5 are visible.
- Off route: the line goes grey for 1 s and reroutes; no nagging voice. A GPS voice is RELEASE and off by default.
- Galis and shortcuts (the driver's skill): the route can prefer main roads or galis (a setting in the map screen); the driver's known shortcuts show as dotted tint lines on the minimap.
- Arrival: the ribbon ends in a ground ring at the stop point, the pin pulses, a soft chime.

## Lal Batti (wanted level)

Name proposed in GAME.md; 1 to 5 red beacons. Rules are in GAME.md "Police and wanted"; this is the presentation.

- **Shape:** a squat police beacon with light rays, lit or empty. Not stars, not a bell.
- **States:** Seen (beacons steady and glowing, state word `SEEN`), Searching (out of sight: beacons blink at 1 Hz, state word `SEARCHING`, a thin ring under the beacons empties over the escape time of 15, 30 or 45 s), Lost (beacons drain left to right in 0.6 s, a short "lost them" sting).
- **Raise:** the new beacon pops (scale 1.0 to 1.25 to 1.0 in 0.3 s) with a siren chirp. A witness phoning it in shows a small phone icon by the beacons during the 5 s before the raise, so the player can still stop it.
- **Minimap:** the search circle in red at 16% fill with a dashed edge, police blips, and a red and blue rim on the minimap while police are chasing. The rim turns off with reduced motion.
- **Response row (RELEASE):** foot, car, barricade, armed, air icons light as each unit type joins.

## Bilingual text

- UI text is English by default with Hindi place names, titles and labels shown in both scripts (as Delhi street signs do). Subtitles are Hinglish in Latin script with an optional English translation line. (Claude call; question 4.)
- Settings for later: English, Hindi or both for UI text; Devanagari or Latin for Hindi subtitles.
- Every text string goes through the content files (content-writer), never hard coded, so a Hindi UI is a translation job, not a rebuild.

## Motion rules

- Enter 200 ms ease out, exit 160 ms ease in, slide 12 to 16 px. No bounce, except reward count ups and beacon pops.
- A new objective: top centre large for 4 s, then a 350 ms move and shrink into the tracker.
- Idle fade: on foot and calm for 8 s, the minimap drops to 60% and the vitals hide. Damage, a wanted change, a prompt or the map key wake it at once.
- Numbers ease: speed over 120 ms, cash counts up over 600 ms.
- Mission pass: the world slows to 0.3x over 0.4 s, letterbox in 0.3 s, title rises 24 px with a fade, stats tick in 90 ms apart, stamps land with a small rotation (minus 6 degrees to 0) and a thump, cash counts up. Skippable after 1 s.
- HUD elements never shake with the camera. Damage arcs are the only screen effect that reacts to hits.
- Reduced motion: fades only, no pulses, no rim, no slow motion on cards.

## Accessibility

- HUD scale 75 to 150%, text scale separate, subtitles in 4 sizes with a background opacity slider (Tsushima's fixed subtitles were a known problem).
- Size of world pins and prompts as its own setting (as Spider-Man 2 does).
- Colour blind modes swap the danger, police and route colours; shapes already carry every meaning.
- High contrast backing: every text gets a solid dark panel.
- Holds can be toggles. Prompts show the remapped key.
- Every element can be off; guidance still works through the ribbon and the turn card with the minimap off.
- Contrast: text at least 4.5:1 against what is right behind it, checked in shots.

## Checkable rules for the HUD build tasks

The planner turns these into acceptance criteria when the HUD is planned (after the style sign-off).
- Driving pose (lookproof view `hud_play`): HUD covers under 9% of the frame; nothing but world markers in the centre 40% by 50% box.
- Safe margins of at least 64 px left and right and 56 px top and bottom at 1920x1080, scaled by the safe zone setting.
- No text under 15 px at 1080p and 100% scale; Devanagari renders with correct conjuncts and matras (a shot of `चाँदनी चौक` and `आईटीओ नाकाबंदी` compared against the mockups).
- The objective shows within 1 s of a mission start and after every new objective (a hook event `hud_objective` with the text).
- The turn card shows the next manoeuvre at least 6 s before it at 60 and 120 km/h (scenario through the hooks).
- Lal Batti beacon count equals the wanted level at every change, and the state word matches seen or searching (scenario).
- Every hud element can be read through `debug.hud` (visible, text, value) so verify can check it without OCR.
- HUD frame cost under 0.6 ms on this machine (estimate to replace with a measurement in the perf scenario).

## Changes from GAME.md "HUD"

Proposals, kept until Anmol answers: the minimap is heading up while driving (GAME.md said north up); a new objective shows top centre and then settles top left (GAME.md said top centre only); the lead's skill bar sits under health; the driver's fare meter is a HUD element on fares; prompts sit on the object, with bottom centre only as the fallback.

## Questions for Anmol

1. **Overall feel of the HUD.** A) As in the mockups: warm dark glass, clean, quiet until needed. B) Louder and more filmi: bigger type, bolder colour, poster style titles. C) Even more minimal: almost nothing on screen, like Red Dead 2.
2. **Route guidance on the road.** A) Chevrons on the road near turns plus the minimap line (as in mockup 01). B) Minimap line only, like GTA V. C) A full line on the road all the way, like Forza.
3. **Minimap.** A) Turns with the car while driving, north up on foot (as in the mockups). B) Always north up. C) Always turns with you.
4. **Hindi and English.** A) English UI with Hindi place names and titles in both scripts, Hinglish subtitles (as in the mockups). B) Hindi first, English small under it. C) A setting with English, Hindi or both.
5. **Wanted level.** A) Lal Batti with 5 red beacons (as in mockup 03). B) Keep Lal Batti but use a different icon (tell me which). C) Another name.
6. **Mission passed card.** A) Stats, stamps and cash (as in mockup 04). B) Simpler: title, PASSED and cash only. C) Bigger filmi moment: a freeze frame of the action with the title over it, then the stats.

Also say if a character colour feels wrong (Driver green, Cop blue, Fixer pink).

## Sources

- GTA VI HUD in the Extended Look video, third party description: https://allthings.how/gta-6-hud-icons-and-meters-explained-extended-look/
- GTA VI UI reception: https://kotaku.com/fans-online-are-debating-if-gta-6s-ui-is-too-simple-and-boring-looks-undercooked-2000729307 , https://khelnow.com/gaming/gta-6-fans-are-calling-games-ui-too-simple-unfinished-202608
- GTA VI social feed in trailers: https://charlieintel.com/gta/gta-6-fans-spot-in-game-social-media-platform-similar-to-instagram-290181
- GTA V interface: https://www.gamepressure.com/gtav/user-interface/z35707 , https://www.grandtheftwiki.com/Heads-up_Display
- Red Dead Redemption 2 HUD options: https://www.gamespot.com/articles/here-are-red-dead-redemption-2s-hud-options/1100-6461911/ , https://www.playstationlifestyle.net/2018/10/01/red-dead-redemption-2-hud-details/amp/
- Ghost of Tsushima guidance and accessibility: https://caniplaythat.com/?p=10831 , https://www.pushsquare.com/news/2020/04/ps4_exclusive_ghost_of_tsushima_wont_have_waypoints_telling_you_where_to_go
- Forza Horizon 5 driving line and GPS: https://kotaku.com/before-you-start-five-settings-to-change-in-forza-hori-1848004522 , https://www.gamepressure.com/forza-horizon-5/gps-voice-how-to-turn-it-off/zcf132
- Watch Dogs hacking UI: https://www.hudsandguis.com/2013/07/24/watchdogs-hacking-ui/ , https://watchdogs.fandom.com/wiki/Hacking
- Cyberpunk 2077 HUD and minimap: https://medium.com/super-jump/a-ux-analysis-of-cyberpunk-2077s-hud-f74afe6b9961 , https://www.pcgamer.com/uk/8-months-after-launch-cyberpunk-2077s-minimap-is-getting-fixed
- Sleeping Dogs minimap and meters: https://en.wikipedia.org/wiki/Sleeping_Dogs_(video_game) , https://medium.com/@jestey/sleeping-dogs-minimap-technical-fundamentals-43544aefc1e6
- Spider-Man 2 accessibility: https://insider-gaming.com/spider-man-2-accessibility-options-revealed/ , https://caniplaythat.com/2023/09/28/more-accessibility-features-of-marvels-spider-man-2-revealed/
- Fonts: https://fonts.google.com/specimen/Teko , https://fonts.google.com/specimen/Mukta (both SIL Open Font License 1.1)

Some pages could not be fetched (paywall or blocked); their facts come from search summaries and are marked as reported, not checked against footage.
