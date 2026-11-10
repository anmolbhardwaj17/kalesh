# Kalesh: Game Design

Status: signed by Anmol on 2026-11-10 ("yes, I sign off on this game design"). Source of the signed answers: `harness/design/GAME_DESIGN_OPTIONS.md` (round 2), the interview answers in `harness/state/inbox.jsonl` (source "interview") and the 2026-11-10 entries in `harness/state/decisions.md`. The game was called Dilli Darshan until 2026-11-10; it is now **Kalesh** (Anmol: "ok we will do kalesh").

How to read this doc: every section is short and checkable. "(owner, 2026-11-10)" marks Anmol's answer. "(Claude call)" marks a choice Claude made where he said "see what's best" or did not answer; those can change at a playtest without a new sign-off. Numbers are a starting tune unless marked as a rule. Builders read only the sections `docs/READ_MAP.md` lists for their area, so the headings stay stable.

## Fantasy

You live three lives in one Delhi. An auto driver who knows every gali, a cop who is honest enough to be in the way, and a small-time fixer who can get anything for a price. Each has their own life, money and trouble. Their stories cross, then collide, in loud filmi set pieces across real Delhi places: Connaught Place, India Gate, ITO, Chandni Chowk, Red Fort, and more as the city opens up. It plays like a Hindi action film shot in a real, honest city: chases over flyovers, fights in bazaar lanes, a wanted level that sends the police after you, and quiet city life between the action.

## Pillars

Signed set A, "Three lives, one Dilli" (owner, 2026-11-10). Every feature serves all three. Every phase plan says for each task which pillar it serves (VERIFY.md "Writing acceptance criteria").

1. **Three lives, one city.** Every mission moves one character's life forward and touches another's. The city is shared: what one character does can show up in another's day.
2. **Filmi, never cheap.** Action as loud as a Hindi action film: chases, fistfights, gunfights, slow-motion moments. Every fight has a reason and a cost in the story. Never cruel, never a joke at someone's expense.
3. **The city opens up.** Real Delhi is the reward. Each chapter opens new districts, places and people through the story, never an invisible wall. First sight of a landmark is a moment.

The respect rule (below) is a standing rule for every feature, not a pillar.

## Respect rule (refined, owner 2026-11-10)

Show real conditions honestly, never as spectacle or a joke. Anmol: "i want to show some part of it as its actually true".
- **Real people and groups:** no real people, no real politicians, no real parties (invented parties only, owner), no real brands on signs, no real police units, officers or cases. The police force is invented and Delhi-like (owner).
- **Poverty:** shown where it is true, as part of the city and never its only face. Built with the same craft as rich areas. Poor characters have dignity, agency and humour. Never a punchline, never a backdrop to shoot through.
- **Crime:** criminals are people with reasons. No community, caste or religion is the criminal group. Gangs are invented. Drugs can exist in the story (East Delhi) without glamour or how-to detail.
- **Police:** people doing a job, some good, some corrupt, as individuals. The cop's story can show pressure and corruption without mocking the force.
- **Violence:** over-the-top in style, never cruel. No torture scenes, no violence against children (children are never damageable; they flee), no sexual violence, no real religious or communal conflict. No gore beyond small blood hits.
- **Places of worship:** appear only where they really are, built with care, never a combat arena and never decoration that labels an area.
- **GB Road (owner, 2026-11-10, decisions.md "GB Road treatment"):** the red-light trade exists in the story. Hardware shops at street level, brothels upstairs as background. People who live and work there are shown with dignity, never as props or jokes. Missions are about the crime around it: the cop raids traffickers and rescues people, the fixer deals with pimps and money, the auto driver drives out someone who wants to escape. No sex, no nudity, no paying for sex as a mechanic, no exploitation of real people. Other dark places (Malcha Mahal, East Delhi dens) follow the same rule: story and atmosphere, never spectacle.
- Every mission review and art review checks this rule. The VERIFY.md rubric gets a respect line with the style sign-off.

## Scope guardrails (hard rules for the builders)

- **Platform:** desktop game in Godot 4 (owner). Mac (this M2 Pro and similar) and Windows gaming PCs or better (owner). A web demo may come later; not now. No consoles, no phones, no touch.
- **Input:** keyboard and mouse first; gamepad (Xbox layout) by the first release. Every action remappable.
- **Offline, single player.** No online play, no accounts, no ads, no in-app purchases. Free and public release (owner).
- **One active player at a time.** Chapters with a lead (owner); the other two are scripted NPCs in that chapter. Save all three player states from day 1 so free switching can unlock later without a rewrite.
- **Combat grows in steps.** The first playable slice uses the SLICE items of the capability list only. RELEASE items come after the slice is fun. LATER items are not built before the first release unless Anmol asks. Nothing on the capability list is dropped silently: a change of tag needs a decisions.md entry.
- **Map grows in steps.** Pilot districts first, then the first release map, then later unlocks (see "Map and districts"). No district is built before the pilot plays well.
- **Driving stays central.** Every mission has at least one drive that matters. On-foot parts stay at about 40% of a mission's time or less.
- **Content size (estimate, set at phase planning):** first release about 25 to 30 story missions over 3 acts, plus side activities per character. The first playable slice is 4 missions.
- **No feature without a pillar.** If a task cannot say which pillar it serves, it is not planned.
- **Art and audio never block.** Procedural or stand-in placeholders until Anmol's ChatGPT images arrive through dashboard cards (owner).

## Structure: chapters with a lead

Signed: chapters (owner, 2026-11-10). The auto driver leads first (owner).
- The story runs in chapters. Each chapter has one lead. Free roam between that chapter's missions is as the lead.
- Merged missions sit at the peak of each act. They switch the player between the three at set story beats (a relay, a crossing or a converge).
- Merge patterns: **crossing** (one character's mission leaves a mark in another's: a dropped bag, a wrecked car, a rumour), **relay** (a hand-off mid-mission), **converge** (all three at one set piece).
- Free switching (any time, like GTA V) is a LATER unlock after Act 1 if playtests want it. Built for from day 1 by saving all three states.
- Act plan (estimate, the content writer and phase planning refine it): Act 1 in the pilot districts (driver, cop, fixer chapters and the Red Fort merged mission); Act 2 opens the east bank and the rest of Old Delhi; Act 3 opens the south, the airport and Gurugram. Later unlocks add Noida, Shahdara and Akshardham.

## The three characters

Working roles only. Names, ages, backstories and voices come from the content writer (STORY.md). First look ideas (proposal only, not decided): `harness/design/reference/mood_three_characters.jpg` shows a worn auto driver with a gamchha, a woman police officer in khaki, and a flashy fixer in a maroon jacket. The cop's gender is open; the image proposes a woman sub-inspector.

| | The Driver (leads first) | The Cop | The Fixer |
|---|---|---|---|
| One line | Rents an auto, drives fares across the city, gets pulled into trouble by one passenger | A sub-inspector at a central police station, honest enough to be in the way | Arranges anything for a price in Old Delhi's back lanes: documents, deliveries, debts |
| Home and work (owner: as proposed) | Lives in East Delhi (Laxmi Nagar), works the stands at CP, the railway station and Metro exits | Station near ITO and CP, patrols the central core | Works out of Chandni Chowk and Paharganj, deals in East Delhi |
| Vehicles | Auto (about 65 km/h); any car when the story calls for it | Patrol car (about 140), police motorcycle | Scooter (about 90); any car he takes |
| Signature skill (works in a vehicle) | Knows every gali: shortcuts, gap weaving, near misses | Pursuit: calls a barricade at the next junction, PIT takedown, arrests | Nerve: tailing, getaways, talking his way in |
| On foot | Brawler, improvised weapons | Trained: lathi, pistol, arrest takedown | Street fighter, pistol, knife (no gore) |
| City life between missions | Fares and fare twists, rival autos, Metro race | Patrol calls (fight, robbery, crash) | Jobs for contacts: pickups, debts, deliveries |
| Wanted level | Normal | Normal in the slice; a flipped "internal pressure" version (breaking the law brings suspension risk and a rival officer, not police stars) is a LATER option, decided when the cop's chapters are planned (Claude call) | Normal, plus rival crews |
| Life arc (proposal) | Pay off the auto and the debt, keep the family out of it | Promotion or integrity | Get out from under a bigger boss |

Story frame (proposal for the content writer): a counterfeit money racket runs through Chandni Chowk's wholesale lanes. The fixer moves it, the cop is tracking it, and the driver unknowingly carries a courier's bag. All gangs and politicians are invented.

## Core loop

Balance: about half action and story, half city life (owner, 2026-11-10).

| | 30 seconds | 5 minutes | 1 hour |
|---|---|---|---|
| Driver | Weave through traffic, horn, find the gap, pick the gali or the main road | One fare or one story mission: pick up, route, a twist (a chase, a deadline, a passenger in trouble), drop off | A chapter: 2 or 3 story missions, fares and side jobs between, money toward owning the auto, a new district or person |
| Cop | Hold the pursuit line, call a barricade at the next junction, close in | One case beat: respond to a call, chase, a foot fight, an arrest or a shootout | A chapter: a case of 2 or 3 missions, patrol calls between, pressure from above, a lead on the racket |
| Fixer | Slip through a crowd, spot the tail, fight or run | One job: pick up, deliver, collect, with a fight or a getaway | A chapter: jobs for contacts, money and standing, a rival crew, a new district opens |
| All three | Traffic, crowds, the wanted level | A merged mission every 2 or 3 chapters | The city opens up and the three stories close in on each other |

Session loop: start where you saved (end of the last mission) as the chapter's lead; a clear next story marker and 2 or 3 city life options nearby; play a mission or a side activity; autosave; the next marker.

Tension sources: the wanted level and chases (owner), rival crews, deadlines, traffic, the story's stakes for each character. Money is soft (it buys things, it never blocks the story).

Driving rules (Claude call, stands unless Anmol objects): action arcade. Cars take a beating before they fail, handling is forgiving at speed. Red lights and wrong-side driving matter only when police see it (wanted level).

## Player verbs

Keyboard and mouse defaults; every one remappable. Gamepad in brackets (Xbox layout, by first release). Tags as in the capability list: SLICE, RELEASE, LATER.

On foot:
- Move: WASD (left stick). Look: mouse (right stick). SLICE
- Sprint: hold Shift (click left stick). SLICE
- Crouch: C toggle (B). SLICE
- Jump, and vault a low wall up to 1.2 m when facing one: Space (A). SLICE
- Enter or exit a vehicle: F (Y). Taking a stopped car with a driver in it is RELEASE (carjack).
- Melee: left mouse light attack, 3-hit combo (X); block: hold Q (LB); dodge: V (B in combat); takedown on a staggered enemy: E when prompted (Y). SLICE
- Aim: hold right mouse (LT), soft lock-on to the nearest threat in view; shoot: left mouse while aiming (RT); reload: R (X). SLICE
- Throw (brick, bottle): G (RB). SLICE
- Switch weapon: mouse wheel or 1 to 4 (d-pad). SLICE. Weapon wheel: hold Tab (hold LB). RELEASE
- Arrest (cop only, on a downed or surrendering target): hold E (hold Y). SLICE
- Talk or interact: E (Y). SLICE

In a vehicle:
- Throttle W (RT), brake and reverse S (LT), steer A and D (left stick). SLICE
- Handbrake: Space (A). SLICE
- Horn: H (click left stick). The horn is a verb: traffic and people react. SLICE
- Look back: C (click right stick). Camera view toggle (wide or close chase): V (back). SLICE
- Call a barricade ahead (cop, in a pursuit): B (RB). SLICE
- Shoot from a vehicle (drive-by, aim to the side): RELEASE

Everywhere:
- Map: M (view). Pause: Esc (start). SLICE
- Character switch at a story beat: when the prompt shows, T (d-pad up). SLICE. Free switch any time: LATER.
- Phone (missions, contacts, fares): Up arrow (d-pad up hold). RELEASE

## Capability list (full; nothing here is forgotten)

Anmol asked for this list (owner, 2026-11-10: "have a list of all capabilites so later it doesnt forget like climbing, swimming, weapons and other things"). Combat starts lean and grows. Tags:
- **SLICE**: in the first playable slice (missions M01 to M04).
- **RELEASE**: by the first public release.
- **LATER**: after the first release, or when Anmol asks.

A tag changes only with a decisions.md entry. Each phase plan checks this list and says which items it builds.

### On foot movement

| Capability | When | Notes |
|---|---|---|
| Walk, jog, sprint with stamina | SLICE | Numbers in "Movement and camera feel" |
| Crouch | SLICE | Lower profile, quieter; no stealth system yet |
| Jump | SLICE | Small hop, for kerbs and gaps |
| Vault low walls and railings up to 1.2 m | SLICE | Auto-detected ledges |
| Enter and exit vehicles (driver and passenger seats) | SLICE | Auto: climb in from the side |
| Fall and roll, fall damage | RELEASE | Damage above 4 m |
| Ladders | RELEASE | Placed ladders and stairs to rooftops |
| Climbing walls and ledges (rooftops, Old Delhi roofs) | LATER | Ledge grab up to 2.2 m, roof to roof jumps |
| Swimming (Yamuna, park ponds) | LATER | Until then deep water is a fail with a stated reason ("Deep water"), and mission routes keep players away from it |
| Ragdoll on knockdown | SLICE | Physics bones, short |
| Push through crowds | SLICE | Bump people aside at walk; sprinting into people knocks them (with weight, see civilians) |

### Melee

| Capability | When | Notes |
|---|---|---|
| Fists: 3-hit combo, block, dodge | SLICE | |
| Takedown on a staggered enemy | SLICE | One per character style (brawler, trained, street) |
| Hit reactions and knockdown | SLICE | |
| Melee weapons: lathi, bat | SLICE | The cop has the lathi |
| Knife (fixer) | RELEASE | No gore |
| Improvised weapons picked up (pipe, chair, crate) | RELEASE | Driver's style |
| Environment finishers (stall, shutter, wall, car door) | RELEASE | |
| Grapples and throws | LATER | |
| Weapons in melee (pistol whip, disarm) | LATER | |

### Weapons

| Capability | When | Notes |
|---|---|---|
| Pistol | SLICE | |
| Lathi or bat | SLICE | Melee weapon slot |
| One thrown item (brick or bottle) | SLICE | Stuns |
| Revolver | RELEASE | |
| Shotgun | RELEASE | |
| SMG | RELEASE | |
| Rifle | RELEASE | Police armed units carry it |
| Grenade or molotov class thrown weapon | RELEASE | |
| 10 or more weapons, weapon wheel with attachments | LATER | |
| Buying weapons through the fixer's contacts | RELEASE | No real gun shops |
| Picking up dropped weapons | SLICE | |

### Shooting and aiming

| Capability | When | Notes |
|---|---|---|
| Over-the-shoulder aim with soft lock-on | SLICE | Lock range 25 m |
| Free aim (lock-on off) | RELEASE | Setting |
| Headshots | SLICE | 2x damage |
| Cover: snap to auto cover points, blind fire, peek | RELEASE | Not in the slice (no cover system) |
| Shooting from vehicles (drive-by, passenger shooting) | RELEASE | |
| Aim from bikes and scooters | LATER | |
| Slow-motion moment (filmi focus, short) | RELEASE | One per fight, earned; supports pillar 2 |

### Vehicles (types)

| Capability | When | Notes |
|---|---|---|
| Auto rickshaw (CNG, three wheels) | SLICE | Driver's vehicle, about 65 km/h |
| Scooter | SLICE | Fixer's vehicle, about 90 km/h |
| Ordinary car (hatchback, sedan) | SLICE | About 140 km/h |
| Patrol car | SLICE | Cop's vehicle, about 140 km/h |
| Motorcycle (police and civilian) | RELEASE | About 120 km/h |
| Fast cars | RELEASE | 180 to 200 km/h, rare |
| SUV, taxi, tempo, truck | RELEASE | Traffic and drivable |
| DTC bus | RELEASE | Drivable, slow |
| Cycle rickshaw, e-rickshaw | RELEASE | Old Delhi traffic; e-rickshaw drivable |
| Helicopter or drone (police, wanted top level) | RELEASE | AI only; never player flown in the first release |
| Boats on the Yamuna | LATER | |
| Metro as a ride (fast travel between stations) | LATER | The Metro train runs on its track as scenery from RELEASE |

### Vehicle actions

| Capability | When | Notes |
|---|---|---|
| Handbrake turns, gap weaving, near-miss chains | SLICE | |
| Horn as a verb (traffic and people react) | SLICE | |
| Damage model (dents, smoke, disabled) | SLICE | Simple first: health and smoke; dents RELEASE |
| Pursuit: call a barricade at the next junction (cop) | SLICE | Uses real junctions from the lane model |
| PIT and ram takedowns | RELEASE | Cop and enemies |
| Tailing at a distance (stay close, stay unseen) | RELEASE | Fixer and cop missions |
| Carjacking | RELEASE | |
| Passengers who talk and react | SLICE | Fares and story passengers |
| Vehicle repair and customising | LATER | Puncture shops, auto paint |
| Radio stations | RELEASE | Original music only |

### Police and wanted

| Capability | When | Notes |
|---|---|---|
| Wanted levels 1 to 3 | SLICE | Rules in "Police and wanted" |
| Wanted levels 4 and 5 (roadblocks, armed units, helicopter or drone) | RELEASE | |
| Search circle and line-of-sight escape | SLICE | |
| Barricades at real junctions | SLICE | At level 2 and up |
| Spike strips | RELEASE | |
| Busted and wasted with respawn | SLICE | Police station and hospital |
| Witnesses phone it in | SLICE | |
| Search grids, dogs | LATER | |
| Cop's flipped "internal pressure" meter | LATER | Option, see the cop |

### Civilians and crowds

| Capability | When | Notes |
|---|---|---|
| Crowds near the player: walk, flee, cower | SLICE | 30 to 60 agents in the bazaar |
| Civilians can be hurt, with weight | SLICE | Owner; rules in "Civilians and violence" |
| Panic that spreads | RELEASE | 60 to 120 agents |
| Crowd density 150 and more | LATER | |
| Ambient life: vendors, chai, cricket, queues, cows, dogs | RELEASE | Per area profile (DELHI_WORLD.md) |
| Civilians who remember (an area stays wary for a while) | RELEASE | |

### Characters and switching

| Capability | When | Notes |
|---|---|---|
| Three playable characters, one shared animation set | SLICE | Stand-ins until art arrives |
| Switch at story beats in merged missions | SLICE | |
| All three player states saved (place, vehicle, money, weapons, health, wanted) | SLICE | Day 1 rule |
| Free switching any time (sky camera) | LATER | After Act 1 if playtests want it |
| Off-screen life (where the others are when you switch) | LATER | With free switching |
| Outfits | LATER | |

### Missions and activities

| Capability | When | Notes |
|---|---|---|
| Mission system: objectives, checkpoints, fail reasons, instant retry, rewards | SLICE | |
| Story missions per character and merged missions | SLICE | 4 in the slice |
| Fares (driver) | SLICE | One fare type in the slice, as part of M01 |
| Patrol calls (cop), jobs (fixer) | RELEASE | |
| Races (Metro race, night auto race, CP laps, flyover sprint) | RELEASE | |
| Landmark first sight and the stamp book | RELEASE | |
| Events (fog run, Holi, Diwali, monsoon, baraat) | LATER | One or two may land in RELEASE as story missions |
| Mission replay with best scores | RELEASE | |
| Photo spots | LATER | |

### World and city life

| Capability | When | Notes |
|---|---|---|
| Pilot districts on the lane model | SLICE | About 7.2 km2 |
| Traffic: light to medium, signals, buses, autos, bikes | SLICE | Delhi lane discipline, with honking |
| Time of day: hot hazy afternoon, golden evening | SLICE | Owner's test lights; night RELEASE |
| Full day and night cycle | RELEASE | |
| Weather: winter fog, monsoon rain | LATER | |
| First release map (layout B plus Gurugram, Laxmi Nagar, Kashmere Gate, Humayun's Tomb) | RELEASE | |
| Later unlocks (Noida, Shahdara, Akshardham) | LATER | |
| Interiors (a few: police station, safe houses, a dhaba) | RELEASE | Most buildings closed |

### Progression and economy

| Capability | When | Notes |
|---|---|---|
| Money per character, shown on completion | SLICE | |
| Districts open through the story | SLICE | The slice opens the pilot only |
| Skills that grow with use (driving, shooting, stamina) | RELEASE | Few and felt |
| Buying vehicles, weapons, safe houses | RELEASE | |
| Owning the auto (driver's arc goal) | RELEASE | |

### Camera, presentation and UI

| Capability | When | Notes |
|---|---|---|
| Third person behind, on foot and in vehicles | SLICE | Owner: third person behind |
| HUD: minimap, wanted, health, weapon, money, objective | SLICE | |
| Short in-engine story scenes with subtitles | SLICE | No cinematic cutscenes at AAA level |
| Full map screen with districts | SLICE | |
| Voiced dialogue | RELEASE | Requests on the dashboard; text placeholders until then |
| Photo mode | LATER | |

## Systems

Every system has its rules here, its tuning numbers in a data file the building task names (one file per system under `game/data/`), and its scenarios in `harness/verify/scenarios.json`.

### Mission system

- A mission is a list of objectives with checkpoints. Each objective has a goal text, a marker and a fail list.
- Fun rules for every mission (checked per VERIFY.md "Writing acceptance criteria"): the goal is on screen within 5 s of the mission start; every fail shows its reason in words and offers an instant retry from the last checkpoint (under 3 s to playable again); every mission has a reason to retry (a time, a score or a medal to beat); the completion screen shows a reward that matters (money, a district or place opened, a story turn, a stamp).
- Every mission has at least one drive that matters (a chase, a getaway, a deadline or a tail). On-foot time at about 40% or less.
- Missions and spawn points are stored in district-local coordinates (district id plus position), so a district can move without breaking mission data.
- Mission data lives in `game/data/missions/<ID>.json`; the ids match `harness/data/milestones.json`.

### Combat and on foot

Lean first (SLICE items), growing to RELEASE (owner). Starting numbers (Claude call, tuned in playtests):
- Player health 100. Out of combat for 8 s, health regenerates to 50. Medkits and food stalls restore more (RELEASE).
- Fists 10, 10, 20 damage on the 3-hit combo; the third hit knocks down a basic enemy. Lathi or bat 25 per hit. Block takes 70% off melee damage. Dodge gives 0.25 s of no damage.
- Takedown: any enemy that took 2 hits in 1.5 s staggers for 1 s; a takedown in that window knocks them out.
- Pistol: 12 rounds, 34 damage, 2x on the head, 40 m range, soft lock-on 25 m.
- Thrown brick or bottle: stuns for 1.5 s, 15 damage.
- Basic enemy: 100 health. Enemy kinds in the slice: melee thug, pistol thug, foot cop, police driver, civilian.
- Animation: one shared humanoid set retargeted to all characters (60 to 90 clips for the slice, estimate). Library and licence are decided in architecture discovery.

### Police and wanted

Name: **Lal Batti** is proposed as the wanted level's name in game (the red beacon); 1 to 5 red beacons on the HUD (Claude proposal, Anmol may rename).
- Raises: a crime seen by police, or reported by a witness who phones it in after 5 s. Assault +1. Hurting a civilian +1, killing a civilian sets at least 2. Shooting in public +1, near police +2. Hurting police sets at least 3. Red light and wrong side +1 only when a police unit sees it.
- Response: level 1: foot police and 1 patrol car. Level 2: 2 or 3 cars and a barricade at the next junction ahead. Level 3: 4 cars, armed units with pistols. Level 4 (RELEASE): roadblocks and spike strips. Level 5 (RELEASE): a police helicopter or drone.
- Escape: leave the search circle (radius 150 m at level 1, 250 m at 2, 400 m at 3) and stay out of police sight for 15 s, 30 s or 45 s. Galis, flyovers and the Yamuna bridges are the escape routes.
- Busted: held for 3 s on foot or boxed in a stopped vehicle for 3 s. Wake at the nearest police station, lose 10% of money and the guns. Wasted: wake at the nearest hospital, lose 10% of money. Inside a mission, either is a mission fail with a reason and an instant retry.
- Pursuit AI drives the lane graph; barricades use real junctions from the lane model.

### Civilians and violence

Civilians can be hurt, with weight (owner, 2026-11-10).
- Hurting a civilian raises the wanted level hard (above). Nearby people flee and cower. The character reacts with a line that treats it as wrong.
- No reward ever comes from hurting civilians. A mission fails if a protected person dies.
- Children are never damageable. No violence at places of worship. The respect rule applies to every case.
- RELEASE: the area stays wary for a while (fewer fares and jobs there for 10 game minutes).

### Vehicles and driving

- Arcade handling, forgiving at speed, cars take a beating (vehicle health 1000; smoke under 300; disabled at 0).
- The first car tune starts from the delhi-drive numbers kept in decisions.md ("KEEP ... car handling numbers"), measured by feel probes; the auto and scooter get their own tune.
- Traffic follows lanes and signals with Delhi habits (honking, gap filling, buses pulling out), at light to medium density in the slice.

### Characters and save

- One active player. A chapter sets the lead. Merged missions switch at beats: a short camera move to the next character, under 2 s.
- The save holds all three states (place, vehicle, money, weapons, health, wanted, chapter progress). Autosave after each mission and at each switch.

## Movement and camera feel

Starting numbers, each measurable by a scenario (VERIFY.md). They are a start, not the target: Anmol judges feel in the playtests.

On foot (Claude call):
- Walk 1.6 m/s, jog 3.8 m/s, sprint 6.5 m/s for 8 s of stamina (regen in 5 s), crouch 1.2 m/s.
- Jump apex 0.45 m in 0.30 s. Vault up to 1.2 m, done in 0.6 s.
- Turn to face a new direction (180 degrees) in 0.25 s while jogging.

Vehicles (top speeds: decisions.md "Speeds and map size"; acceleration and braking are Claude calls):

| Vehicle | Top speed | Acceleration | Braking |
|---|---|---|---|
| Auto | about 65 km/h | 0 to 40 km/h in 5 to 6 s | 60 to 0 in 18 to 22 m |
| Scooter | about 90 km/h | 0 to 60 km/h in 5 to 6 s | 80 to 0 in 25 to 32 m |
| Ordinary car, patrol car | about 140 km/h | 0 to 100 km/h in 10 to 12 s | 100 to 0 in 38 to 45 m |
| Fast car (RELEASE) | 180 to 200 km/h | 0 to 100 km/h in 5 to 6 s | 100 to 0 in 34 to 40 m |

Camera (owner: third person behind):
- Vehicle chase camera: the delhi-drive rig kept in decisions.md ("KEEP ... chase camera numbers"): wide chase 6.6 m behind and 2.5 m up, close chase 4.5 m and 2.05 m, base FOV 70 degrees plus up to 21 at speed. The auto uses the close chase by default. The camera never goes under 0.5 m above the vehicle.
- On foot: 3.0 m behind the head pivot at 1.65 m, shoulder offset 0.45 m to the right, FOV 65 degrees (55 when aiming, plus 5 when sprinting). Walls between the camera and the player fade; the camera never comes closer than 0.6 m to the head and never clips into geometry.
- Character switch: a camera move under 2 s.
- The minimap and map are north up (TECH.md coordinate rule: north is -Z).

## Map and districts

Signed in the map round (owner, 2026-11-10); details in `harness/design/DELHI_WORLD.md` section 0 and `MAP_REPAIR.md`.
- A compressed Delhi: real districts at true scale from OSM data, moved closer by translation only (no rotation, no mirror), joined by authored connectors, the ring roads, the river and the bridges. "smaller than gta5 but not too small to feel boring and not vast" (owner).
- Layout C (Delhi plus NCR) is the full map, built in stages (owner):
  - **Pilot** (Act 1 and the slice): Connaught Place with Jantar Mantar, India Gate, ITO, Chandni Chowk with Red Fort. About 7.2 km2.
  - **First release:** layout B's districts plus Gurugram, Laxmi Nagar, Kashmere Gate with ISBT, Humayun's Tomb with Nizamuddin.
  - **Later unlocks:** Noida, Shahdara, Akshardham.
- Hero landmarks first: Connaught Place circle, India Gate, Red Fort (owner).
- Story places (owner): GB Road (treatment in the respect rule), Jantar Mantar (protests), Vasant Kunj, Delhi Gymkhana, the Golf Club, Khan Market, and Malcha Mahal as the haunted place.
- The map pipeline and engine choices are set by the architecture sign-off (ARCH_OPTIONS.md, TECH.md).

## Milestones

The playable units are missions (kit.config.json `milestoneWord`). The list lives in `harness/data/milestones.json`; play scripts in `harness/verify/milestones/<ID>.js` follow VERIFY.md "Play scripts".

### First playable slice (required)

The slice is Act 1 in miniature, in the pilot districts. The order is the play order: the driver first (owner).

| ID | Mission | Lead | Shows |
|---|---|---|---|
| M01 | Train at 6:10 | Driver | Fare pickup, gap weaving, the gali shortcut, a deadline, the bag left behind |
| M02 | Barricade at ITO | Cop | Pursuit over the ITO flyovers, a barricade call, a foot chase and takedown |
| M03 | Chandni Chowk pickup | Fixer | On foot in the bazaar crowd, a fistfight, a scooter getaway at wanted 1 |
| M04 | Red Fort rush (merged) | All three | Switching at beats, a pistol fight, a chase finale |

Pilot gap (Claude call): M01 ends at New Delhi railway station, which sits in district D07 (Paharganj), outside the signed pilot. The pilot adds the station forecourt on the Ajmeri Gate side (about 0.2 km2, estimate) as part of the connector between CP and Chandni Chowk. If the pilot build cannot fit it, the content writer moves the drop-off to a station gate inside the pilot instead; the beats stay.

### Mission and activity list (round 2, scored)

Score: 2 x fun + Delhi + map reuse + effort points (S 3, M 2, L 1); planner estimates. Slice missions marked.

| # | Mission or activity | Who | What happens | Score | When |
|---|---|---|---|---|---|
| 1 | Barricade at ITO | Cop | A stolen car flees from CP; pursue it over the ITO flyovers, call a barricade, finish on foot with a takedown | 21 | SLICE (M02) |
| 2 | Chandni Chowk pickup | Fixer | Collect a package in the bazaar on foot; a rival crew jumps you; fistfight, then a scooter getaway at wanted 1 | 21 | SLICE (M03) |
| 3 | Train at 6:10 | Driver | Get a family to New Delhi station before their train; a passenger leaves a bag behind | 20 | SLICE (M01) |
| 4 | Red Fort rush | All (merged) | The bag is the fixer's package; the cop is tailing. Driver escapes, fixer fights in a parking lot, cop's chase finale | 20 | SLICE (M04) |
| 5 | Metro race | Driver | Beat the Metro train between two stations, the train on the track beside you | 21 | RELEASE |
| 12 | Yamuna bridge getaway | Fixer | Lose a wanted level across the bridges into East Delhi | 22 | RELEASE (Act 2) |
| 6 | Night patrol call | Cop | A random call: a fight, a robbery, a crash; respond, sort it | 19 | RELEASE |
| 7 | Collect the debt | Fixer | Find a man who owes money, chase him through a market, decide how hard to push | 19 | RELEASE |
| 9 | Airport run | Driver, Fixer | Get someone from the airport to Old Delhi before the people who want them catch up | 20 | RELEASE (Act 3) |
| 10 | Wedding baraat chase | Any | A chase runs into a wedding procession; find the way round | 19 | RELEASE |
| 16 | Undercover ride | Cop, Driver | The cop rides in the driver's auto to follow a target unseen | 19 | RELEASE |
| 17 | Landmark first sight | All | First view of a landmark: a short reveal and a stamp | 19 | RELEASE |
| 15 | Fare rush and rival autos | Driver | Race rival autos to a hail at the stand | 18 | RELEASE |
| 11 | Haunted night | Any | A night mission at Malcha Mahal in winter fog | 18 | RELEASE (Act 3) |
| 8 | Protest at Jantar Mantar | Cop, Fixer | Crowds and tempers; the cop keeps order, the fixer works the crowd | 17 | RELEASE |
| 13 | Raid in East Delhi | Cop | A raid on a den; shootout on stairs and rooftops | 17 | RELEASE (needs cover) |
| 18 | Street fight at Paharganj | Fixer | Street fight rounds for money against tougher fighters | 16 | RELEASE |
| 14 | Gymkhana favour | Fixer | A rich client at the club wants something done quietly | 15 | RELEASE |
| 19 | GB Road raid | Cop | Raid the traffickers above the hardware shops; get the people held there out safe | not scored | RELEASE (Act 2) |
| 20 | GB Road money | Fixer | Deal with the pimps and the money that runs through the street | not scored | RELEASE (Act 2) |
| 21 | Way out | Driver | Drive out a woman who wants to escape GB Road, with the people who want her back on your tail | not scored | RELEASE (Act 2) |

GB Road missions (19 to 21) follow the respect rule's GB Road line; their scores come at phase planning.

The driver's side jobs and fare twists are the round 1 list (GAME_DESIGN_OPTIONS.md appendix): stand fares, "Bhaiya, shortcut lo", exam day, Paranthe Wali Gali run, CP laps, night auto race, near-miss chains and the rest. The respect rule applies to every row.

## Level design rules

Missions and districts:
- The goal is readable within 5 s: a marker, a short goal line, and the target visible or pointed at.
- Every chase and getaway has at least two routes: the main road and a gali or service lane. Route acceptance: one input-only route scenario per route.
- Checkpoints at least every 90 s of play. A fail never sends the player back more than 90 s.
- Teach each new verb in a safe moment before a mission needs it under pressure.
- Small-detail rule: the space near the player holds the props the area profile asks for (stalls, signs, wires, parked bikes, people).
- Landmarks are framed: each hero landmark has a first-sight shot on a mission route.
- Every space a mission uses is checked at player height (player-height shots in the task's acceptance).

## Progression and economy

Players return for "a city that opens up" and "the story of the three" (owner).
- **The city opens up (core):** each chapter opens a district through the story (a bridge reopens, a case leads south, the airport road). Never an invisible wall: closed districts are closed for a story reason (a barricade, a flooded road, no reason to go yet) and shown on the map as unopened.
- **The story of the three (core):** chapters end on hooks; merged missions are the peaks of each act; each life arc moves.
- **Money per character:** the driver earns fares and jobs toward owning the auto; the cop earns salary and case rewards; the fixer earns job payments. Money buys vehicles, weapons (fixer's contacts) and safe houses (RELEASE). Money never blocks a story mission.
- **Skills:** driving, shooting and stamina grow with use (RELEASE), few and felt.
- **Landmarks and places:** first sight stamps and side activities at story places (RELEASE).
- **Left out:** daily jobs and streaks (a chore).

## HUD

Full HUD design, research, components, motion and mockups: `harness/design/HUD.md` (P0-030, proposal until Anmol answers its questions; the look follows the signed style). Where HUD.md and the list below differ, HUD.md is the newer proposal.

What is on screen in play. The HUD never covers the player (shot rule).
- Bottom left: minimap, north up, with the objective marker and police; health bar under it (SLICE).
- Top right: wanted level as 1 to 5 red beacons (Lal Batti, proposed), money, current weapon and ammo (SLICE).
- Top centre: the goal line, shown within 5 s of a mission start and after each new objective; a mission timer when there is one (SLICE).
- Bottom right in a vehicle: speed in km/h (SLICE).
- Bottom centre: subtitles and interaction prompts (SLICE).
- On a switch: a small portrait of the new lead for 2 s (SLICE).
- Hidden in story scenes, on the map screen and in pause. Shape and colour both carry meaning (accessibility).

## Menus

- Title: continue, new game, settings, quit (SLICE).
- Pause: resume, map, settings, quit to title (SLICE).
- Map screen: districts, opened and unopened, markers, waypoint (SLICE).
- Settings: graphics preset, resolution, controls remap, audio volumes, subtitles, camera shake (SLICE: graphics, audio, subtitles; remap by RELEASE).
- Mission replay with best scores (RELEASE). Stamp book (RELEASE).

## Audio

- Vehicles: a three-layer engine blend per vehicle; the four CC0 placeholders kept from delhi-drive until real sounds arrive (decisions.md). Horns per vehicle.
- City: ambience per area (bazaar, traffic core, lawns, river), traffic honks, calls of vendors.
- Combat: punches, guns, police sirens.
- Music: a score for chases and fights (filmi), original only. Radio stations (RELEASE).
- Dialogue: Hindi and English mix in subtitles, voiced lines by RELEASE through dashboard requests. Text placeholders until then.

## Accessibility

- Remappable keys and buttons (RELEASE; checked by a scenario that remaps and drives).
- Subtitles on by default, with speaker names (SLICE).
- Soft lock-on aim on by default (SLICE).
- Signals carry shape and colour (wanted beacons, markers) for colour-blind players.
- Camera shake and motion blur can be turned off (SLICE: shake).
- Missions retry instantly from checkpoints; difficulty options (RELEASE).

## As found (ADOPT, 2026-11-10, history)

The repo started as a minimal scaffold: a box car on a ground plane with the hook contract. The game moved to Godot 4 in Phase 0 (P0-024 to P0-027); see TECH.md for what exists now. The round 1 draft pillars ("Real Delhi", "Solid base", "Rich and polished", "Fast in the browser") were replaced by the signed pillars above. Their technical parts live on as rules in MAP_REPAIR.md, TECH.md and VERIFY.md (solid roads and terrain, collisions match visuals, budgets).

## Open questions

- The wanted level's name: "Lal Batti" is proposed.
- The cop's gender and all three names: the content writer proposes, Anmol may change them.
