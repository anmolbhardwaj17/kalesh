# Dilli Darshan: Game design options (round 1 draft)

Owner direction 2026-11-10 (inbox mmwap8jxg): a car driving around Delhi is a tech demo, not a game. This doc lays out the options for a real core loop built from what makes Delhi Delhi. Nothing here is decided. The owner's answers in the interview rounds decide; his sign-off is recorded with `task.mjs designsignoff`. No mission system is built before that.

Status: round 1 draft, written by the planner (P0-004). No owner answers yet.

## Summary (10 lines)

1. Fantasy options: new auto driver, cabbie who knows every gali, delivery rider, tour guide, street racer, or a mix. The recommended mix is "new auto driver who becomes the one who knows every gali", with tours as the signature job.
2. Core loop (recommended): 30 s weave and choose a route, 5 min one fare from pick up to tip, 1 h a shift that pays the day's auto rent and grows your name in an area.
3. Tension comes mostly from traffic, time and passengers. Money (rent) is a soft pressure. Police are a small fine, not a chase.
4. 46 missions and activities are ranked below. The top picks all reuse one fare system: Metro race, Train at 6:10, near-miss chains, shortcut fares, Dilli Darshan tours.
5. Progression that is healthy: city knowledge (a gali map that fills in), reputation by area, auto upgrades and styling, regular passengers. Chores to avoid: fuel queues, daily streaks you lose, grinding.
6. Feel: near misses, horn as a verb, weaving through mixed traffic, landmarks revealed as rewards. Three pillar sets are offered; set A "The city is the game" is recommended.
7. First playable (recommended): fares in the pilot area with near-miss and horn, plus the Metro race. It needs a drivable pilot map with named places, a lane graph router and light mixed traffic.
8. The old game tried five modes (dash, taxi, delivery, police, free). They were generic, siloed in a menu, aimed at random road points, and money only bought paint. We keep the lessons, not the modes.
9. References: Crazy Taxi, Euro Truck Simulator 2, Burnout Paradise, Forza Horizon, Taxi Life, Night Call and others, for ideas only.
10. Six round 1 questions at the end, each with 2 to 4 options.

Fantasy letters used in the tables: A new auto driver, B cabbie in a car, C delivery rider, D tour guide, E street racer, F the mix.

## What the old game tried (evidence)

From `harness/design/SALVAGE_AUDIT.md` C10 and a read of delhi-drive `frontend/src/game/` and `docs/context/game-modes.md`:

| Old mode | What it was | What we learn |
|---|---|---|
| Checkpoint Dash | Glowing gates laid on wide roads, drive through in order against a clock, best time saved | Works as a time trial, but the gates were placed by an algorithm on random wide roads. Nothing about the place mattered |
| City Cab | Green pick up marker on a random road, gold drop off, a decaying tip, fares chain forever, best payday saved | The right skeleton. But destinations were points, not places; passengers had no voice; nothing changed after an hour |
| Rush Hour | Timed parcel delivery, streak multiplier, parcel integrity drops on crashes | Integrity and streaks are good tension. A x2.5 streak on a generous base made money climb too fast and was cut by 55% (`economy.js`) |
| Heat | Cop cars chase you, a wanted meter, escape for a payout | Generic, not Delhi. Its HUD card flickered and was removed the same day (M-8) |
| Free Roam | Drive anywhere | Fine as a mode, not a game |
| Wallet | Fares pay in; the only thing to buy was car paint colours | Money with nothing worth buying is a number, not a reason to play |

Lessons carried over: one fare system shared by all job types, not five modes in a hub; destinations are real named places; routes follow the road graph, not a bearing (the old router fixed "the number goes up as you drive the right way"); one economy file; HUD values need a dead band.

## 1. Fantasy

Who the player is, in one sentence each, and why it fits Delhi.

| Option | One sentence | Why it fits Delhi | Vehicle and feel | Risks |
|---|---|---|---|---|
| A. New auto driver | You just rented a green and yellow auto and must learn the city fare by fare to pay the daily rent. | The auto is Delhi's icon. It squeezes through gaps a car cannot, and every Delhiite has an auto story | Small, light, about 50 to 60 km/h top speed. Speed is felt through closeness and gaps, not raw speed | New handling tune needed (the kept tune is for a 1730 kg car). Lower top speed may feel slow if traffic is thin |
| B. Cabbie who knows every gali | A cab driver whose real skill is knowing every shortcut, flyover and gali in the city. | Delhi is a city of shortcuts and galis; "bhaiya, shortcut lo" is something every rider says. The real map becomes the skill | A hatchback cab. The kept car tune and camera apply directly | Less iconic than the auto. Could feel like any taxi game |
| C. Delivery rider | A scooter rider racing food and parcels through the city on a 10 minute promise. | Two-wheelers are most of Delhi's traffic. Quick delivery is part of daily life | Scooter: lean, filter between cars. The fastest feel in traffic | A rider on a bike needs a character model and lean animation (costly). Must show gig work with dignity, not as a joke |
| D. Tour guide | You drive visitors to Delhi's landmarks and give the "Dilli Darshan" tour. | It is the game's name. Delhi's landmarks are world famous | Any vehicle. Calm drives, photo stops | Low tension. Strong only when landmarks look great, which is art heavy |
| E. Street racer | Night races on Ring Road and over the flyovers. | Late-night racing on the flyovers is real in Delhi | Fast car or bike. Pure speed | Generic, not Delhi specific. Glorifies dangerous driving on real streets |
| F. The mix (recommended) | A new auto driver who becomes the one who knows every gali: fares first, tours as the signature job, deliveries and night races as side jobs that unlock later. | Combines Delhi's icon (the auto), its real map (the gali skill) and its name (Darshan tours) | Starts in an auto; a car or scooter could unlock later | Scope creep if all job types arrive at once. Mitigation: one shared fare system, one job type at a time |

## 2. Core loop

### Loops per fantasy

| Fantasy | 30 seconds | 5 minutes | 1 hour | Main tension |
|---|---|---|---|---|
| A. Auto driver | Read the gap, horn, slip past a bus, choose a turn | One fare: quote, pick up, route, drop off, tip | A shift: 8 to 12 fares, pay the day's rent, grow your name at one stand | Traffic, passenger mood, rent |
| B. Cabbie | Pick the faster line, choose flyover or gali | One fare with a promised ETA you must beat | A shift; new shortcuts found and added to your map | Time, traffic |
| C. Delivery rider | Filter between cars, brake late, keep the food level | One order: shop, pick up, rush to the door | A run of orders, rating and streak | Time, food damage |
| D. Tour guide | Line up the next landmark, slow for the view | One stop: arrive, frame the photo, short line about the place | A full tour of 3 to 5 landmarks, guests' rating | Light: time of day, guests' patience |
| E. Street racer | Hit the apex, draft a truck, near miss | One race | A night of races, rivals, standing | Rivals, speed |
| F. The mix | Weave, horn, choose route | One job of any kind, from one shared system | A shift that mixes fares, one tour and a side job; rent paid; a new area or story beat | Traffic, time, passengers, rent |

### Recommended loop (F), as a sketch

```
             +--------------------------------------------------+
             |  1 HOUR: a shift (morning, rush hour, evening)    |
             |  rent due at the end, reputation per area grows,  |
             |  a regular passenger calls, a new stand opens      |
             +------------------------+-------------------------+
                                      |
        +-----------------------------v-----------------------------+
        |  5 MINUTES: one job                                        |
        |  hail or stand -> quote (meter or fixed) -> pick up ->     |
        |  route choice (main road / flyover / gali) -> drop off ->  |
        |  meter + tip (time, smoothness, near misses, horn manners) |
        |  -> stamp if you passed a new landmark                     |
        +-----------------------------+-----------------------------+
                                      |
        +-----------------------------v-----------------------------+
        |  30 SECONDS: the road                                      |
        |  read traffic -> find the gap -> horn -> slip through ->   |
        |  near miss (+tip) -> signal countdown -> pick the turn     |
        +------------------------------------------------------------+
```

### Tension sources

| Source | How it shows | Fits | Cost | Notes |
|---|---|---|---|---|
| Traffic | Mixed autos, buses, bikes, cars, cycle rickshaws; gaps open and close | all | L (needs lane graph AI) | The heart of the 30 s loop. Without it every option is thin |
| Time | Promised arrival, train or exam deadline, food going cold | all | S | Use on some jobs, not all, or it becomes a stopwatch game |
| Passengers | Mood bar, short lines ("bhaiya, jaldi"), tip | A B D F | M (text and voice) | Gives jobs a face. Respect rule applies to every passenger |
| Money | Daily auto rent, meter vs fixed price | A F | S | Soft target: missing rent costs reputation, never a game over |
| Rivals | Other autos race you to a hail; night racers | A E F | M | Good in short bursts |
| Police | Challan (fine) for a red light or wrong side | all | S | Recommended as a small fine only. No chase as core |
| Weather and season | Fog, monsoon flooding, summer heat haze | all | M to L | Strong Delhi flavour, changes how known routes play |
| Events | Baraat, fair at Pragati Maidan, VIP hold, festival nights | all | M to L | Change the map for a while; turn route knowledge into choices |

## 3. Missions and activities

Ranking: score = 2 x fun + Delhi uniqueness + map reuse + effort points (S = 3, M = 2, L = 1). Fun, Delhi and map reuse are 1 to 5 planner estimates, to be checked in playtests. Effort: S is a part of one task once the fare system exists, M is one task, L is several tasks or new art and AI. Map reuse means it plays on the same pilot roads again and again.

Read with care: rank is per item. "Stand fare" sits at 9 but it is the backbone: most items above and below it are a stand fare with a twist (a deadline, a cargo, a route rule). Build the fare system once, then each twist is cheap.

Respect rule (`DELHI_WORLD.md` section 3) applies to every row: passengers of every age, gender and community; festivals of many faiths, each at the real places where they happen; weddings from many communities; no real people, no real party symbols, no real brand names; gig workers and drivers shown with dignity; no community is a joke or an obstacle.

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

Pilot fit: every row from 1 to 20 can run in the pilot area (Connaught Place, ITO and Pragati Maidan flyovers, Chandni Chowk, one metro line), except Night auto race, whose India Gate finish is about 2 km outside it (use a CP finish in the pilot). Minto Bridge (Monsoon underpass) is next to CP.

### Sample mission beat sheet: "Train at 6:10"

```
Goal       Get a family of four with luggage from Chandni Chowk to New Delhi Railway Station by 18:10.
Start      17:52 game time, evening rush. Hail at the Chandni Chowk metro exit.
Beat 1     Pick up. Line: "Bhaiya, New Delhi station, train at 6:10!" Clock shows 18 min.
Beat 2     Route choice on screen: Netaji Subhash Marg (wide, jammed), or the galis past
           Ajmeri Gate (tight, quicker if you know them). Both are real roads in the repaired map.
Beat 3     The jam: a bus stalls ahead. Horn, find the gap, or turn into the gali.
Beat 4     Luggage meter: hard bumps and crashes shake it. A bag falls at 0, cost on the tip.
Beat 5     Final stretch: station forecourt, crowds, find the drop off bay.
Win        Arrive by 18:10. Fare + tip + "On time" stamp. Faster than 14 min unlocks the gali on your map.
Fail       Train missed at 18:10: the family takes a later train, small fare, no tip. Retry from the hail.
Why retry  You saw the gali route and the time it saves. Your best time shows next to the job.
Fun check  Clear goal (the clock), fair fail (a bus you could see coming), reason to retry (a route
           you now know), a reward that matters (a new gali on your map, a better stand).
```

## 4. Progression and reasons to return

| Item | What it is | Verdict | Why |
|---|---|---|---|
| Money | Fares and tips into one wallet | Healthy if it buys things that change play | The old game's wallet only bought paint, so money meant nothing |
| Daily auto rent | A target per shift, as real auto drivers pay | Healthy as a soft target | Gives each shift a goal. Becomes a chore if missing it means a game over or a loss of progress. Missing it costs reputation only |
| Vehicle unlocks | Auto first; later a car (more speed) or a scooter (more filtering) | Healthy | Each vehicle changes how the same streets play. Each costs a handling tune, a model and sounds |
| Upgrades | Engine, brakes, horn, suspension; small and felt | Healthy if felt, chore if +2% numbers | Keep few, each one noticeable in a feel probe |
| Styling | Auto art, lettering, seat covers, lights, the horn tune | Healthy | Expression, and Delhi autos are famously decorated. Cheap content |
| Reputation by area | Your name at CP, ITO, Chandni Chowk grows with good fares | Healthy | Unlocks better fares and new stands in that area. Ties progress to real places |
| City knowledge map | Galis and shortcuts appear on your map once driven; landmarks once seen | Healthy, core | The real map becomes the progress. Grows naturally with each new area |
| Unlocking parts of the city | New areas open as reputation grows | Healthy if it matches how the map grows | Also matches the build: pilot first, then area by area. Chore if gated by invisible walls; use story and fares, not walls |
| Daily and weekly jobs | A seeded job per day or week | Chore risk | Healthy only with no streak to lose and no fear of missing out |
| Story and characters | Regular passengers who come back (a student, a shopkeeper, a visitor) with small arcs | Healthy | A reason to come back tomorrow. Costs writing and voice; text first, voice later |
| Personal bests | Best time per job and route | Healthy | Free with the job system. Local first |
| Online leaderboards | Shared scores | Healthy but costly | Needs a backend and cheat checks. Later, if ever |
| Photo spots | Pose points at hero landmarks, best time of day | Healthy | Turns landmarks into rewards. Keep the count small and each one special |
| Collectibles (stamps, kites, food map) | Things gathered while driving | Healthy if each one is a place; chore if 500 hidden items | Tie each to a real place or event |
| Fuel and CNG | Refuel stops | Chore | Real, but a stop with nothing to decide. Leave out, or make it a free ambient scene |
| Damage and repair | Paying to fix the auto | Mostly chore | A light cost on the tip is enough |

## 5. Game feel

| Element | What it means here | How we measure it (feel probes) |
|---|---|---|
| Speed sense | Low camera, wide FOV at speed, roadside objects close, wind and engine rise. In an auto, 50 km/h past a bus must feel fast | FOV at 0, 30 and 60 km/h; roadside props within 3 m per 100 m of road |
| Near misses | Passing within about 0.6 m of a vehicle at over 25 km/h gives a whoosh, a small tip bump and a chain | Probe counts near misses on a scripted route; no false ones when stopped |
| Horn culture | The horn is a verb. A tap at a blind corner is good manners; holding it at a jam annoys passengers. Traffic and people react | Probe: a horn at a pedestrian ahead makes them step aside within 1 s |
| Weaving | Mixed traffic leaves real gaps; the auto fits where a car does not | Gap widths in the traffic AI; the auto passes a gap of 1.6 m, a car needs 2.0 m |
| Drifts and tilt | A car can slide; an auto can lift onto two wheels in a sharp turn (risky, playful) | Tilt angle and recovery time in a probe |
| Landmarks as rewards | A landmark comes into view: a short camera nudge, a sound sting, a stamp | First-sight event fires once per landmark; shot shows the landmark in frame |

### Three candidate pillar sets

Every feature must serve all three pillars of the chosen set.

| Set | Pillar 1 | Pillar 2 | Pillar 3 | What it leads to |
|---|---|---|---|---|
| A. The city is the game (recommended) | Know the city: real places, routes and shortcuts are the skill | Flow through chaos: weaving, horns and near misses make every minute alive | Every trip shows Delhi: each job ends with something new seen or learned | Fares, tours, knowledge map, area reputation |
| B. Hustle | Every rupee counts: money and time press on every job | Read the road: traffic is a puzzle of gaps | Your auto, your name: styling and reputation are yours | A tighter economy game, more stress, more replay of the same jobs |
| C. Joyride | Speed and style: near misses, drifts, tilt, flyover jumps | Delhi as a playground: landmarks are set pieces | Short bursts: a run in 3 minutes | Arcade races and stunts, less about the real city |

### HUD sketch (recommended loop)

```
+--------------------------------------------------------------------------+
| [Job] Train at 6:10   Chandni Chowk -> New Delhi Stn     14:32 left      |
|       Family of 4   mood [#######---]   luggage [#########-]             |
|                                                                          |
|                                                                          |
|                         (the road, never covered)                        |
|                                                                          |
|                                           NEAR MISS x3  +Rs 12          |
|                                                                          |
| +-----------+                                      Signal: green 08      |
| | minimap   |   Turn left in 120 m onto Asaf Ali Road                    |
| | route     |                                       42 km/h  | Rs 1,240  |
| +-----------+                                       rent today: Rs 850   |
+--------------------------------------------------------------------------+
```

## 6. Scope: the first playable loop and what grows from it

### First playable options (pilot area only)

| Option | What is in it | Fun | Cost | Risk | Needs from the map | Needs from AI traffic | Needs from art |
|---|---|---|---|---|---|---|---|
| S1. Fares + Metro race (recommended) | Stand fares with quote, route, tip; near-miss chain; horn reactions; landmark first-sight stamps; one Metro race | 4 | M: about 6 to 8 tasks on top of the base world | Medium: fun depends on traffic density | Named places and drop off bays, lane graph router, metro track and 2 stations | 40 to 80 mixed vehicles in view, gaps, horns, signals with countdowns | Auto stand-in, passenger stand-ins, stand and bay signs, metro train stand-in |
| S2. Time trials only | CP circle laps, flyover sprint, Metro race, personal bests | 3 | S: 3 to 4 tasks | Low | Lane graph, flyovers, metro track | Light traffic | Few |
| S3. Dilli Darshan tour | One tour of 3 landmarks with photo spots | 3 | M | High: depends on hero landmark art being good early | Hero landmark placement and photo spots | Light traffic, tourist crowds | 2 or 3 hero landmark models (procedural stand-ins look weak) |
| S4. Delivery rush on a scooter | Food runs with timers and damage | 4 | L | High: new vehicle, rider model and lean animation | Galis drivable, shop points | Dense two-wheeler gaps | Rider and scooter model |
| S5. Full shift | Rent, reputation in 3 areas, several job types, a regular passenger | 5 | L: 15 or more tasks | High: too much before the base is proven | All of S1 plus area data | All of S1 | All of S1 plus characters |

### What grows from S1 (each step is fun on its own)

| Step | Adds | Builds on |
|---|---|---|
| 1 | S1: fares, near misses, horn, stamps, Metro race | Map pilot, lane graph, traffic |
| 2 | The shift: rent, reputation per area, knowledge map, shortcut fares, Train at 6:10, Exam day | Fare system |
| 3 | Dilli Darshan tours and photo spots | Hero landmarks from the world layers |
| 4 | Events and weather: fog, monsoon underpass, rush hour at ITO, festival nights | Weather and event layer |
| 5 | Regular passengers with small stories; styling and upgrades | Content writer, art batches |
| 6 | Night auto races and rivals at the stand; a second vehicle | Rival AI, new handling tune |
| 7 | New areas of the city, each with its own jobs and landmarks | Area by area world growth |

## 7. References (inspiration, never copy)

| Game | What fits Dilli Darshan | What to avoid |
|---|---|---|
| Crazy Taxi | The 30 s loop: a fare, a clock, tips for skilful driving, arrows that never leave you lost | Arcade disregard for the place; the city is only a track |
| Euro Truck Simulator 2 | Route knowledge, calm pride in a job done, real places made recognisable | Long empty stretches and slow chores (fuel, rest stops) |
| Taxi Life: A City Driving Simulator | A real city (Barcelona) driven fare by fare, a growing company | Slow pace and an empty feel when traffic and people are thin; the old game's trap too |
| Burnout Paradise | Events start at any junction; shortcuts and billboards to find; the city learned by heart | Crashes as the main reward; aggression |
| Forza Horizon | A festival frame, photo spots, a strong sense of place, big set pieces | Reward overload: many currencies, constant pop-ups |
| Midtown Madness | A real-ish city with several modes on the same streets | Modes in a menu with no link between them |
| Night Call | Passengers with stories; the cab as a small stage | Slow, text heavy |
| Tokyo Xtreme Racer | Night highway racing, named rivals | Racing as the only thing to do |
| GTA series | A living city: radio, chatter, people with routines | Crime fantasy, violence, caricature of communities |
| Death Stranding | Cargo care and the joy of a well chosen route | Long walks between moments |

## Recommendation

1. Fantasy F: a new auto driver who becomes the one who knows every gali. Fares are the core, Dilli Darshan tours are the signature job, deliveries and night races come later as side jobs.
2. Pillar set A, "The city is the game": know the city; flow through chaos; every trip shows Delhi.
3. Loop: 30 s weave and choose, 5 min one fare with a tip, 1 h a shift with soft rent and area reputation.
4. Tone: grounded arcade. Crashes cost time, tip and passenger mood; red lights cost a small challan; no police chase in the core game.
5. Progression: knowledge map, area reputation, auto styling and a few felt upgrades, regular passengers. No fuel queues, no streaks you can lose, online boards later if ever.
6. First playable: S1 (fares, near misses, horn, stamps, Metro race) in the pilot area. Then grow step by step as in section 6.
7. One open risk to settle with the owner: starting in an auto needs a new light-vehicle tune and a model, while the kept handling tune is for a car. Starting in a cab is cheaper; starting in an auto is more Delhi.

## Round 1 questions

Each has 2 to 4 options. The orchestrator asks them; answers are recorded verbatim, never invented.

1. Who is the player?
   - a. A new auto driver who learns the city: fares first, tours and deliveries later (recommended)
   - b. A cab driver in a car who knows every gali
   - c. A delivery rider on a scooter
   - d. A street racer at night
2. Which three pillars should every feature serve?
   - a. The city is the game: know the city, flow through chaos, every trip shows Delhi (recommended)
   - b. Hustle: every rupee counts, read the road, your auto your name
   - c. Joyride: speed and style, Delhi as a playground, short bursts
3. How strict should the driving rules be?
   - a. Arcade: forgiving, crashes only cost time
   - b. Grounded arcade: crashes cost tip and passenger mood, red lights give a small fine (recommended)
   - c. Close to real: real speeds and rules, slower and calmer
4. What should the first playable in the pilot area be?
   - a. Fares with near misses and horn, plus a race against the metro (recommended)
   - b. A Dilli Darshan tour past 3 landmarks
   - c. Time trials only: CP laps and flyover sprints
   - d. A full shift with rent, reputation and several job types (bigger, later)
5. What should bring players back tomorrow? (pick up to 2)
   - a. A city map that fills in with galis and landmarks, plus reputation by area (recommended)
   - b. Regular passengers with small stories
   - c. Auto styling and upgrades
   - d. Daily jobs and personal bests
6. Police and chases?
   - a. No chases; breaking rules gives a small challan only (recommended)
   - b. A police chase as an optional night event
   - c. Chases as a core mode
