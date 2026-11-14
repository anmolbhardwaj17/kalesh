# World logic: does this scene make sense?

Anmol 2026-11-14: "understanding the environment, the logic behind it, if it's logical or not, scientifically things are in the right place or not." A frame can be pretty and still wrong: light with no source, a pole in the air, a dry road in the rain. This file is the rulebook. Every look builder and verifier reads it next to OWNER_EYE.md and FIDELITY_BAR.md. Two layers check it: automatic checks in the bake and the game (numbers, every run), and the look critic, who answers the questions below for every critic pass.

## 1. Light and shadow
- Every light on a surface has a visible source, and every source lights what is near it. A continuous strip gives even light; a lamp gives a pool; a shop sign glows on the pavement under it.
- Emitters glow (bloom, emissive) and are brighter than what they light. Nothing glows that has no power.
- Sky light only reaches where the sky is visible: none inside tunnels, subways, rooms, under flyovers and deep galis (darker, lit by their own lamps).
- Sun shadows all point the same way, match the sun's height for the hour, and every object casts one (or has a reason not to).
- Night: street lamps, signs, windows and vehicles are the light; lamps that are on at night are off by day; lit windows vary, not all at once.

## 2. Gravity and support
- Nothing floats. Every pole, sign, wire, lamp, tank, AC unit, balcony, bridge and prop rests on or hangs from something that can hold it, and the contact is visible (base plate, bracket, pier).
- Wires run from pole to pole or pole to building, sag between supports, and never end in the air.
- Water runs downhill: drains at low points, puddles in dips and potholes, river and canal surfaces flat and below their banks, wet streaks below whatever drips.
- Ramps and stairs are walkable or drivable: road grades about 6% or less on ramps, steps 15 to 18 cm high, every stair reaches a floor or a door.

## 3. Scale and proportion
- Doors about 2.1 m, floors about 3 to 3.5 m, kerbs 15 to 20 cm, bollards about 0.6 to 0.9 m, cars about 1.5 m tall and autos about 1.7 m, lane widths about 3 to 3.5 m, people 1.5 to 1.85 m.
- Text on signs is readable at its intended distance and sized for it (road signs big, shop boards medium, posters small).

## 4. Cause and effect in wear and weather
- Wear follows a cause: rust streaks below iron (railings, grilles, AC brackets), soot near traffic, kitchens and generators, damp at the wall base and under leaks, fading on sun-facing walls, polish where hands and feet go, grime highest at street level.
- Weather is consistent everywhere at once: if it rained, all open ground is wet and reflective while ground under covers stays dry; dust and haze grow with distance at one rate.
- Time is consistent: shadow length, sky colour, open or closed shutters, crowd size and lit lamps all agree on the hour.

## 5. Urban logic
- Every door leads somewhere and is reachable (no door into a wall or into the air without a stair).
- Shops face the street; signs face the people who read them; road signs face oncoming traffic on the correct side; signals stand at stop lines.
- Lamp posts stand on kerbs and medians, never in a running lane; bollards are where vehicles are kept out; zebra crossings meet kerb ramps or gaps.
- Parked vehicles sit on the correct side, off running lanes, in plausible spots (outside shops, at stands); autos queue at stands near stations and markets.
- Roofs have what Delhi roofs have (water tanks, railings, dish antennas, clothes lines), and AC units have a drip line and a pipe.
- Crowds gather where there is a reason (shops open, a station, a temple), and thin out where there is none.

## 6. Physics in motion
- Vehicles sit on their wheels on the road (no sinking or hovering), lean and pitch the right way on turns and brakes, and collide with what they can see.
- Cloth, flags, smoke and dust move with one wind direction.
- Water and wet surfaces reflect what is above them.

## How it is checked
- Automatic (every bake and quick run, cheap): a support check for props and fittings (a ray down or to the nearest wall finds a holder within a few cm), wires end on supports, emitters have a light within their radius or a baked glow, interiors and tunnels have the sky ambient masked, scale ranges per prop class, drains at low points, sign facing within 45 degrees of its readers or of oncoming traffic, lamp posts not on running lanes. Failures are listed with place and id, like the map health report.
- By eye: the look critic answers every heading above for each critic pass, with a shot per finding. A clear break of this rulebook fails a look task, the same as a missing feature.
