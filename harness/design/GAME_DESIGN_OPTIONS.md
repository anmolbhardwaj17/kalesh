# Dilli Darshan: Game design options (round 2 draft)

Owner direction 2026-11-10 (inbox mmwap8jxg): a car driving around Delhi is a tech demo, not a game. This doc lays out the options. Nothing is decided until Anmol signs off in his own words (`task.mjs designsignoff`). No mission system is built before that.

Status: round 2 draft (planner, P0-006), after interview sitting 1. The round 1 recommendation (auto driver only, "the city is the game", grounded arcade) was answered with "Rethink all of it", so this draft starts again from his answers. Every number is an estimate.

## Summary (10 lines)

1. Anmol wants three playable characters with their own lives and stories: an auto driver, a cop and a small-time fixer, whose missions merge.
2. Tone: an over-the-top action movie, with guns and fights, on foot anywhere, in a real and honest Delhi.
3. Already answered: police work through a wanted level and chases; players return for "a city that opens up" and "the story of the three".
4. Three structure options for the three characters: chapters with a lead (recommended), free switch like GTA V, or one main character with two guests.
5. Three pillar sets. Recommended: "Three lives, one Dilli": three lives, one city; filmi, never cheap; the city opens up.
6. Three combat and on-foot scopes with honest cost. Recommended: lean for the first slice (fists, two or three weapons, no cover), mid by the first public release.
7. Driving stays central: every mission has a drive that matters, each character's signature skill is in a vehicle, and wanted escapes are drives.
8. The respect rule now covers crime, police and poverty: honest, never spectacle or a joke, invented gangs and parties, no real people.
9. First playable slice: one mission per character plus one merged mission, in the pilot districts (CP, ITO and Pragati Maidan, Chandni Chowk and Red Fort, India Gate).
10. Six round 2 questions at the end: how the three connect, which pillars, who leads first, combat scope, civilians and violence, action vs city life.

## What Anmol has said (sitting 1)

| Question | His answer (inbox id) |
|---|---|
| Who is the player (round 1) | Picked "New auto driver", then in Q4: "Bro game should not be just about auto driver and all, it should have different things man, maybe 3 types of player s and their mission like they have their own life and story and then we ahve missions merging them as well, there should be gun use and all as well, fightng mission and all too, but the city should be in delhi, on top of that map, we can have a lot more things" (mmwaqyyxq) |
| The three players | Auto driver, cop, small-time fixer (mmwar1t1j) |
| Tone of guns and fights | Over-the-top action movie (mmwar1t4i) |
| On foot | Yes, anywhere (mmwar1t71) |
| Earlier picks (auto only, city is the game, grounded arcade) | Rethink all of it (mmwar1t9q). "this last message might change the game feel but tbh thats what i wanna do" (mmwar1tco) |
| Police | Wanted level and chases (mmwartn71) |
| Reasons to return | A city that opens up; The story of the three (mmwartn9f) |
| Top speed | "see whats best accoring to you": per vehicle, auto about 65, scooter 90, car 140, fast cars 180 to 200 (decisions.md "Speeds and map size") |
| Map | Compressed Delhi: districts, story places, NCR parts; "smaller than gta5 but not too small to feel boring and not vast" (mmwartrys) |
| Release | Free, public; invented parties only (mmwarqa1h, mmwarqa41) |
| Look | B stylised realistic with D's grime in Old Delhi (mmwarkusg) |

## 1. The three characters (proposals for the content writer, not decided)

Working roles only. Names, ages and backstories come from the content writer after the sign-off.

| | The Driver | The Cop | The Fixer |
|---|---|---|---|
| One line | Rents an auto, drives fares across the city, and gets pulled into trouble by one passenger | A sub-inspector at a central police station, honest enough to be in the way | Arranges anything for a price in Old Delhi's back lanes: documents, deliveries, debts |
| Home and work (proposal; P0-028 places them) | Lives in East Delhi across the Yamuna, works the stands at CP, the railway station and the Metro exits | Station near ITO or CP, patrols the central core | Works out of Chandni Chowk and Paharganj, deals in East Delhi |
| Vehicles | Auto (about 65 km/h), any car when the story calls for it | Patrol car (about 140), police motorcycle | Scooter (about 90), any car he takes |
| Signature skill | Knows every gali: shortcuts on the map, gap weaving, near misses | Pursuit: calls barricades at junctions, takedowns, arrests | Contacts and nerve: talks his way in, fights his way out |
| On foot | Brawler, improvised weapons | Trained: lathi, pistol, arrest takedown | Street fighter, pistol, knife (no gore) |
| His wanted level | Normal stars | Flipped: breaking the law raises an "internal pressure" meter (suspension, a rival officer hunting him) instead of stars (option) | Normal stars, and rival crews |
| Life arc (proposal) | Pay off the auto and the debt, keep the family out of it | Promotion or integrity | Get out from under a bigger boss |

Story frame to make merging concrete (proposal only): a counterfeit money racket runs through Chandni Chowk's wholesale lanes. The fixer moves it, the cop is tracking it, and the driver unknowingly carries a courier's bag. All gangs and politicians are invented.

## 2. Structure options for three characters

| | S1. Chapters with a lead (recommended) | S2. Free switch (GTA V style) | S3. One lead plus two guests |
|---|---|---|---|
| How it works | The story runs in chapters. Each chapter has a lead; free roam between missions is as that lead. Merged chapters at each act's peak switch between the three at set beats | Any time in free roam, switch to any of the three; each is somewhere in the city living their life. Missions per character; merged missions switch at beats or on demand | The driver is the main character. The cop and fixer play their own short arcs that cut in between his chapters |
| How missions merge | Crossing (one's mission leaves a mark in another's), relay (hand-off mid-mission), converge (all three at one set piece) | All three patterns, plus switch on demand during merged missions | Relay and converge only |
| "Their own life and story" | Strong, in turns | Strongest | Weak for the cop and fixer |
| Cost (est) | Medium: one active player at a time, others scripted as NPCs in their chapters. 3 to 5 tasks for the chapter and switch-at-beat system | High: three persistent player states (position, vehicle, wanted, money, weapons), a sky-camera switch, off-screen life placement, story order rules; 8 to 12 tasks plus much more testing | Low: 2 to 3 tasks |
| Risk | Less freedom: you may want the cop while the chapter is the driver's | Scope and bugs; three of everything to test | Misses what Anmol asked for |
| Grows into | S2: save all three player states from day 1, so free switch can unlock after Act 1 | | S1 |

Recommendation: S1 now, built so free switch (S2) can unlock after the first act if playtests want it.

## 3. Core loop per character

| | 30 seconds | 5 minutes | 1 hour |
|---|---|---|---|
| Driver | Weave through traffic, horn, find the gap, pick the gali or the main road | One fare or one story mission: pick up, route, a twist (a chase, a deadline, a passenger in trouble), drop off | A chapter: 2 or 3 story missions, fares and side jobs between, money toward the auto, a new district or person |
| Cop | Hold the pursuit line, call a barricade at the next junction, close in | One case beat: respond to a call, chase, a foot fight, an arrest or a shootout | A chapter: a case with 2 or 3 missions, patrol events between, pressure from above, a lead on the racket |
| Fixer | Slip through a crowd, spot the tail, fight or run | One job: pick up, deliver, collect, with a fight or a getaway | A chapter: jobs for contacts, money and standing, a rival crew, a new district opens |
| Shared (all three) | Traffic, crowds, the wanted level | A merged mission every 2 or 3 chapters | The city opens up and the three stories close in on each other |

Tension sources: the wanted level and chases (Anmol), rival crews, time (deadlines), traffic, the story's stakes for each character. Money is soft.

Driving rules (Claude's proposal; stands unless Anmol objects): action arcade. Cars take a beating before they fail, handling is forgiving at speed, top speeds per vehicle as above. Red lights and wrong-side driving matter only when police see it (wanted level).

## 4. Three candidate pillar sets

Every feature must serve all three pillars of the chosen set. The respect rule (section 7) is a standing rule for every set, not a pillar.

| Set | Pillar 1 | Pillar 2 | Pillar 3 | What it leads to |
|---|---|---|---|---|
| A. Three lives, one Dilli (recommended) | Three lives, one city: every mission moves one life and touches another | Filmi, never cheap: action as loud as a Hindi action film, but every fight has a reason and a cost in the story | The city opens up: real Delhi is the reward; each chapter opens new districts, places and people | Chapters, merged missions, district unlocks, landmarks as rewards |
| B. Street smart | Know the streets: routes, galis and shortcuts win chases and missions for all three | Every fight costs: short, loud fights with consequences (wanted level, injuries, standing) | Honest Delhi: real places and real conditions, never a joke | More driving skill, tighter fights, slower pace |
| C. Chaos sandbox | Make a scene: traffic, crowds, police and three characters collide | Delhi as a playground: stunts, chases, landmarks as set pieces | Anything is fun in 3 minutes | Systems first, less story |

## 5. Combat and on foot: scope options with honest cost

Costs are estimates for Godot 4 (AnimationTree, NavigationServer3D, physics bones for ragdoll; the P0-017 bench measures them). Animation clips mean a shared humanoid set retargeted to all characters (a free library such as Mixamo, licence checked in P0-010, plus custom clips).

| | O1. Lean (recommended for the first slice) | O2. Mid (recommended by the first public release) | O3. Full |
|---|---|---|---|
| On foot | Walk, run, sprint, crouch, vault low walls, enter and exit vehicles | O1 plus carjacking, ladders, fall and roll | O2 plus rooftop climbing, swimming (Yamuna) |
| Fights | Melee: 3-hit combo, block, dodge, takedown; hit reactions; ragdoll on knockdown | O1 plus environment finishers (stalls, shutters, walls) | O2 plus grapples and weapons in melee |
| Guns | 2 or 3 (pistol, lathi or bat, one thrown), soft lock-on, no cover system | 5 or 6 classes (pistol, revolver, shotgun, SMG, rifle, thrown), cover snap from auto cover points, shooting from vehicles | 10 or more, weapon wheel, aim from bikes |
| Police response | Wanted 1 to 3: patrol cars, foot police, barricades at junctions | Wanted 1 to 5: roadblocks, armed units, a drone or helicopter at the top | O2 plus search grids and dogs |
| Crowds near the player | 30 to 60 agents: walk, flee, cower | 60 to 120 with panic spreading | 150 or more |
| Animation clips (est) | 60 to 90 | 150 to 250 | 300 or more |
| AI (est) | Civilian, melee enemy, pistol enemy, foot cop, police driver | O1 plus cover shooter, flanker, armed unit | O2 plus stealth and search |
| Build tasks (est) | 12 to 18 | 25 to 40 | 50 or more |
| Risk | Fights feel thin if animation is weak | Cover and aim feel need many tuning rounds | Too big for this team before release |

Police and chases (answered: wanted level and chases): pursuit AI drives the lane graph, barricades are placed at real junctions (the lane model gives the spots), escape uses galis, flyovers and the Yamuna bridges. Cost for O1's wanted 1 to 3: 6 to 10 tasks (est).

## 6. How driving stays central

1. Every mission has at least one drive that matters: a chase, a getaway, a deadline or a tail.
2. On-foot parts stay short: at most about 40% of a mission's time (est; tuned in playtests).
3. Each character's signature skill works in a vehicle: the driver's gap weaving and shortcuts, the cop's pursuit and barricades, the fixer's getaways and tailing.
4. Wanted escapes are mostly drives through the real map: galis, service lanes, flyovers, bridges.
5. The map is the arena: chases use the lane-level roads, flyover splits and junctions from MAP_REPAIR.md.

## 7. The respect rule applied to crime, police and poverty

Honest, never spectacle or a joke. No real people, no real parties (invented ones only), no real brands, no real cases.
- Crime: criminals are people with reasons. No community, caste or religion is the criminal group. Gangs are invented. Drugs can exist in the story (Anmol named East Delhi for this) without glamour or how-to detail.
- Police: people doing a job, some good, some corrupt, as individuals. No real officers, units or cases. The cop's story can show pressure and corruption without mocking the force.
- Poverty: shown where it is true (Anmol: "i want to show some part of it as its actually true"), built with the same craft as rich areas. Poor characters have dignity, agency and humour. Never a punchline, never a backdrop to shoot through.
- GB Road and dark places: story and atmosphere, no sexual content, no exploitation of real people.
- Violence: over-the-top in style, never cruel. No torture scenes, no violence against children, no sexual violence, no real religious conflict.

## 8. Missions and activities (round 2 list)

Score as in round 1: 2 x fun + Delhi + map reuse + effort points (S 3, M 2, L 1). Fun, Delhi and reuse are 1 to 5 planner estimates. The round 1 list of fares and city jobs stays as the driver's side jobs (appendix).

| # | Mission or activity | Who | What happens | Fun | Delhi | Effort | Reuse | Score |
|---|---|---|---|---|---|---|---|---|
| 1 | Barricade at ITO | Cop | A stolen car flees from CP. Pursue it over the ITO flyovers, call a barricade at the next junction, finish on foot with a takedown | 5 | 4 | M | 5 | 21 |
| 2 | Chandni Chowk pickup | Fixer | Collect a package in the bazaar on foot, a rival crew jumps you: fistfight, then a scooter getaway through the galis with wanted 1 | 5 | 5 | M | 4 | 21 |
| 3 | Train at 6:10 (twist) | Driver | Get a family to New Delhi station before their train; a passenger leaves a bag behind | 4 | 5 | M | 5 | 20 |
| 4 | Red Fort rush (merged) | All | The bag is the fixer's package; the cop is tailing. Driver escapes, fixer fights in a parking lot, cop's chase finale | 5 | 5 | L | 4 | 20 |
| 5 | Metro race | Driver | Beat the Metro train between two stations, the train on the track beside you | 5 | 5 | M | 4 | 21 |
| 6 | Night patrol call | Cop | A random call: a fight, a robbery, a crash; respond, sort it | 4 | 4 | M | 5 | 19 |
| 7 | Collect the debt | Fixer | Find a man who owes money, chase him through a market, decide how hard to push | 4 | 4 | M | 5 | 19 |
| 8 | Protest at Jantar Mantar | Cop, Fixer | Crowds and tempers; the cop keeps order, the fixer works the crowd for someone | 4 | 5 | L | 3 | 17 |
| 9 | Airport run | Driver, Fixer | Get someone from IGI to Old Delhi before people who want them catch up | 5 | 4 | M | 4 | 20 |
| 10 | Wedding baraat chase | Any | A chase that runs into a wedding procession; find the way round | 5 | 5 | L | 3 | 19 |
| 11 | Haunted night | Any | A night mission at the haunted place in winter fog | 4 | 5 | M | 3 | 18 |
| 12 | Yamuna bridge getaway | Fixer | Lose a wanted level across the bridges into East Delhi | 5 | 4 | S | 5 | 22 |
| 13 | Raid in East Delhi | Cop | A raid on a den; shootout on stairs and rooftops | 5 | 3 | L | 3 | 17 |
| 14 | Gymkhana favour | Fixer | A rich client at the club wants something done quietly | 3 | 4 | M | 3 | 15 |
| 15 | Fare rush and rival autos | Driver | Race rival autos to a hail at the stand | 4 | 4 | M | 4 | 18 |
| 16 | Undercover ride | Cop, Driver | The cop rides in the driver's auto to follow a target without being seen | 4 | 5 | M | 4 | 19 |
| 17 | Landmark first sight | All | The first view of a landmark: a short reveal and a stamp | 3 | 5 | S | 5 | 19 |
| 18 | Street fight at Paharganj | Fixer | An arena-style street fight for money, rounds against tougher fighters | 4 | 3 | M | 3 | 16 |

## 9. Progression and reasons to return (answered: a city that opens up, the story of the three)

| Item | How it works | Verdict |
|---|---|---|
| The city opens up | Each chapter opens a district through the story (a bridge reopens, a case leads south, the airport road), never an invisible wall. Each new district brings missions, people, landmarks and side activities | Core (Anmol) |
| The story of the three | Chapters that end on hooks; merged missions as the peaks of each act; each character's life arc moves | Core (Anmol) |
| Money per character | Driver: fares and jobs toward owning the auto. Cop: salary and case rewards. Fixer: job payments | Healthy if money buys vehicles, weapons, safe houses |
| Skills per character | Driving, shooting, fighting grow with use (light, felt) | Healthy if few and felt |
| Vehicles and weapons | Taken in the world or bought (weapons through the fixer's contacts) | Healthy |
| Landmarks and places as rewards | First sight, photo spots, side activities at story places | Healthy |
| Daily jobs and streaks | | Leave out (chore) |

## 10. First playable slice (pilot districts)

Pilot: Connaught Place, ITO and Pragati Maidan, Chandni Chowk and Red Fort, plus India Gate (Anmol's first heroes; India Gate needs a connector or the layout from P0-028).

| Mission | Who | Shows |
|---|---|---|
| Train at 6:10 (twist) | Driver | Fares, gap weaving, the gali shortcut, the bag left behind |
| Barricade at ITO | Cop | Pursuit on the flyovers, barricade call, foot takedown |
| Chandni Chowk pickup | Fixer | On foot in the dense bazaar, a fistfight, scooter getaway, wanted 1 |
| Red Fort rush | All three, merged | Switch at beats, a pistol fight (O1), a chase finale |

Needs (est): the pilot map on the lane model; light to medium traffic; 30 to 60 people in the bazaar; three character stand-ins on one shared animation set; O1 fights and two guns; wanted 1 to 2; switch at mission beats; the mission system (only after the sign-off); 20 to 30 build tasks after the base world. Every mission's acceptance includes the fun criteria: clear goal, fair fail, a reason to retry, a reward that matters.

## 11. Scope and risk

| Risk | Why | Mitigation |
|---|---|---|
| Scope: three characters, combat, crowds and a city | Each is a large system | S1 chapters, O1 first, pilot districts only until the slice is fun |
| Animation quality | On-foot fights live or die by animation | Shared humanoid set; measure in the P0-017 bench; art cards for key clips |
| Tone clash: over-the-top action in an honest city | Respect rule vs filmi action | Section 7 rules in every mission review; violence never at real groups |
| Base world first | Missions need the lane model, traffic and map | Mission system waits for the sign-off and the pilot map |
| Godot learning curve | New engine for the harness | Godot debug server and driver tasks (P0-024 to P0-027) first |

## 12. References (inspiration, never copy)

| Game | What fits | What to avoid |
|---|---|---|
| GTA V | Three characters, switching, merged heists, a living city | Satire that mocks groups; size we cannot build |
| Sleeping Dogs | A cop in a crime world, strong melee, a real city's street feel | Long fight-only stretches |
| Yakuza 0 and Like a Dragon | Two leads in alternating chapters; a small, dense city full of side stories; over-the-top but heartfelt | Menus and long cutscenes |
| Mafia Definitive Edition | Chapter structure, driving between story beats | A city with nothing to do between missions |
| Max Payne 3 | Over-the-top gunfights with weight | Grim tone everywhere |
| Watch Dogs 2 | A bright real city, readable characters | Gadget clutter |
| Driver: San Francisco | Chases as the core | |
| Hindi action films | Tone of chases, heroics and slow-motion moments | Real people, real politics |

## Recommendation

1. Structure S1: chapters with a lead, merged missions at the peaks, built so free switch can unlock later.
2. Pillar set A: three lives, one city; filmi, never cheap; the city opens up.
3. Combat O1 for the first slice, O2 by the first public release.
4. The driver leads the first chapter: driving first, the city through his eyes, then the cop and the fixer.
5. First playable: the four pilot missions above.

## Round 2 questions

At most 6, each with options. Answered already (not asked again): police = wanted level and chases; reasons to return = a city that opens up and the story of the three.

1. How do the three connect?
   - a. Chapters: each chapter has a lead, merged missions at the peaks; free switching can unlock later (recommended)
   - b. Free switch any time, like GTA V (the biggest cost)
   - c. One main character, the other two in short arcs
2. Which three pillars should every feature serve?
   - a. Three lives, one Dilli: three lives one city; filmi, never cheap; the city opens up (recommended)
   - b. Street smart: know the streets; every fight costs; honest Delhi
   - c. Chaos sandbox: make a scene; Delhi as a playground; fun in 3 minutes
3. Who do players meet first?
   - a. The auto driver (recommended)
   - b. The cop
   - c. The fixer
   - d. All three in a short prologue
4. How big are combat and on foot at the first release?
   - a. Lean: fists, two or three weapons, no cover (first slice), growing to b (recommended)
   - b. Mid: cover, 5 or 6 weapon types, shooting from vehicles
   - c. Full: climbing, swimming, 10 or more weapons
5. Civilians and violence?
   - a. Guns hit only enemies; civilians cannot be harmed
   - b. Civilians can be hurt, it raises the wanted level hard and the story treats it as wrong (recommended)
   - c. Full sandbox, no limits
6. How much of play is action and story vs city life (fares, side jobs, exploring)?
   - a. Mostly action and story
   - b. About half and half (recommended)
   - c. Mostly city life, with action peaks

## Appendix: round 1 driver jobs (kept as the driver's side jobs and fare twists)

From the round 1 draft (P0-004). Fits column letters: A auto driver, B cabbie, C delivery rider, D tour guide, E street racer. Mission 42 "Police chase" is now covered by the wanted level (Anmol). Respect rule applies to every row.

| Rank | Mission or activity | Kind | What happens | Fun | Delhi | Effort | Map reuse | Score | Fits |
|---|---|---|---|---|---|---|---|---|---|
| Rank | Mission or activity | Kind | What happens | Fun | Delhi | Effort | Map reuse | Score | Fits |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Metro race | race | Beat the Blue Line train between two stations near Pragati Maidan. You see the train on the elevated track beside you. | 5 | 5 | M | 4 | 21 | A B C E |
| 2 | Train at 6:10 | fare | Get a family with luggage from Chandni Chowk to New Delhi Railway Station before their train leaves. | 5 | 4 | M | 4 | 20 | A B |
| 3 | Near-miss chain | micro | Pass close to buses, autos and bikes without touching. A chain grows the tip and the score. | 5 | 3 | M | 5 | 20 | all |
| 4 | Night auto race | race | After midnight, rival autos race from Chandni Chowk to India Gate. Empty roads, open speed. | 5 | 4 | M | 4 | 20 | A E |
| 5 | "Bhaiya, shortcut lo" | fare | A passenger in a hurry. The main road is jammed; the gali shortcut is tight and full of life. Bonus for the shortcut. | 4 | 5 | M | 5 | 20 | A B C |
| 6 | Dilli Darshan tour | tour | Two or three visitors, three landmarks in order, a stop at each photo spot, a short line about each place. | 4 | 5 | M | 5 | 20 | A B D |
| 7 | Paranthe Wali Gali run | delivery | Collect hot food from the Chandni Chowk gali and get it to an office in CP before it goes cold. | 4 | 5 | S | 4 | 20 | A C |
| 8 | Exam day | fare | A student must reach an exam centre by 9:30. Signal timers count down at every junction. | 4 | 4 | S | 5 | 20 | A B |
| 9 | Stand fare | fare | Pick up a passenger at an auto stand or metro exit, drop them at a named place. Meter plus tip for time and a smooth ride. | 4 | 4 | M | 5 | 19 | A B C |
| 10 | CP circle laps | race | Time trial around the Connaught Place outer circle, with traffic. Ghost of your best lap. | 4 | 4 | S | 4 | 19 | all |
| 11 | Gali explorer | explore | Named galis and shortcuts appear on your map only once you drive them. Knowledge is the progress. | 4 | 4 | M | 5 | 19 | A B C |
| 12 | Winter fog run | event | December fog, 30 m visibility. Drive a route you know by memory, landmarks loom out of the grey. | 4 | 4 | M | 5 | 19 | all |
| 13 | Photo spot | collect | Find the pose point for a landmark at the right time of day, stop, frame the shot. Scored on framing. | 4 | 4 | M | 5 | 19 | all |
| 14 | Meter or fixed price | fare | Before the ride, quote meter or a fixed price. Too high and the passenger walks to the next auto. | 3 | 5 | S | 5 | 19 | A B |
| 15 | Landmark first sight | collect | The first time you pass a landmark, a postcard stamp and a short reveal shot. Fills your Darshan book. | 3 | 5 | S | 5 | 19 | all |
| 16 | Horn language | micro | The horn is a verb: a tap at a blind gali corner, a long one at a stalled bus. Traffic and people react. | 3 | 5 | S | 5 | 19 | all |
| 17 | Tourist with a list | tour | A visitor names places in their own words ("the big red fort", "the round market"). Work out where they mean. | 3 | 5 | S | 5 | 19 | A B D |
| 18 | Ring Road flyover sprint | race | Time trial over the ITO and Pragati Maidan flyovers. Lines, merges and gaps. | 4 | 3 | S | 4 | 18 | B C E |
| 19 | Fare rush at the stand | rival | A hail on the far side of the road. Rival autos race you for it; first to stop beside the passenger wins. | 4 | 4 | M | 4 | 18 | A |
| 20 | Monsoon underpass | event | Heavy rain floods the underpass at Minto Bridge. Deep water stalls the engine. Find the dry way round. | 4 | 5 | L | 4 | 18 | all |
| 21 | Holi streets | event | Holi morning: slow streets, colour on the windscreen, kids with water guns. A gentle, joyful drive. | 4 | 5 | M | 3 | 18 | all |
| 22 | Diwali lights | event | Diwali night: markets lit up, heavy traffic, many fares, fireworks over the city. | 4 | 5 | L | 4 | 18 | all |
| 23 | Green light launch | micro | Delhi signals show a countdown. Launch on green for a small bonus; jump the red and risk a challan. | 3 | 4 | S | 5 | 18 | all |
| 24 | Mithai box at Diwali | delivery | Deliver a box of sweets. A damage meter drops on bumps and hard braking. | 3 | 4 | S | 5 | 18 | A C |
| 25 | Metro feeder | fare | Short last-mile fares from metro exits. Quick money, many small trips. | 3 | 4 | S | 5 | 18 | A |
| 26 | Food map stamps | collect | Stop at food streets (Chandni Chowk, Bengali Market area) to fill a food map page. | 3 | 5 | S | 4 | 18 | all |
| 27 | Baraat on the road | event | A wedding procession fills the road with a band and dancing guests. Wait, or find another way. Many communities, all shown with care. | 4 | 5 | L | 3 | 17 | all |
| 28 | Groom's car on time | fare | Drive the decorated car to the venue on time while the procession travels at walking pace. | 4 | 5 | L | 3 | 17 | A B |
| 29 | Chandni Chowk crawl | delivery | Deliver through the bazaar at walking pace among cycle rickshaws, carts and crowds. Touch no one. | 4 | 5 | L | 3 | 17 | A C |
| 30 | Shared auto route | fare | A fixed route between two metro stations. Fill the seats, stop where people wave. | 3 | 5 | M | 4 | 17 | A |
| 31 | Pragati Maidan fair | event | A big fair at Pragati Maidan. Crowds, closed gates, high demand for fares, traffic police diversions. | 3 | 5 | M | 4 | 17 | A B |
| 32 | Kite day | collect | On Independence Day, cut kites drift down over Old Delhi. Catch them as you drive. | 3 | 5 | M | 4 | 17 | all |
| 33 | Smooth ride | fare | A passenger with a fever, or carrying a cake. The tip depends on how gently you drive. | 3 | 3 | S | 5 | 17 | A B |
| 34 | Rush hour at ITO | event | A jam builds at ITO. Find a way through or round before the passenger gives up. | 3 | 4 | M | 4 | 16 | all |
| 35 | Night delivery | delivery | Late night parcels across empty roads. Fast and calm. | 3 | 2 | S | 5 | 16 | C |
| 36 | Lost phone | fare | A passenger left a phone in your auto. Catch them at the station before they board. | 3 | 3 | S | 4 | 16 | A B |
| 37 | VIP convoy hold | event | Police hold a road for a convoy. Wait or reroute. No real people. | 2 | 5 | S | 4 | 16 | all |
| 38 | Daily route challenge | race | One seeded fare chain per day, the same for everyone. Personal best, later a leaderboard. | 3 | 2 | S | 4 | 15 | all |
| 39 | Gali handoff | fare | The last 200 m in Old Delhi are too narrow for you. Hand the passenger to a cycle rickshaw and see them off. | 3 | 5 | L | 3 | 15 | A |
| 40 | Clean driving day | micro | A shift with no challans (red lights, wrong side) earns a badge and better fares. | 2 | 3 | S | 5 | 15 | all |
| 41 | Republic Day closures | event | Rehearsal closures near Kartavya Path. Detours, diversion signs. | 2 | 5 | S | 3 | 15 | all |
| 42 | Police chase | chase | Cops chase you after a red light run. Tried in the old game as "Heat". Glorifies reckless driving on real streets. | 4 | 1 | L | 4 | 14 | E |
| 43 | Checkpoint dash | race | Gates along the road against the clock. Tried in the old game. | 3 | 1 | S | 4 | 14 | all |
| 44 | Puncture stop | side | A flat tyre. Limp to a roadside puncture shop and wait. | 2 | 4 | M | 4 | 14 | A B C |
| 45 | CNG queue | side | Queue for CNG at a fuel station. Real, but a chore. | 1 | 5 | S | 4 | 14 | A |
| 46 | Ghost replay duel | race | Race the ghost of your best run, or a friend's shared run. | 3 | 1 | M | 4 | 13 | all |

