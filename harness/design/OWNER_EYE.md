# Owner's eye: what Anmol checks, so nobody has to ask him

Every builder brief for a look task, every verifier and every look audit reads this file, harness/design/WORLD_LOGIC.md (does the scene make physical and urban sense) and harness/design/REALITY_MATCH.md (every object compared with real photos, scored, improved until it passes). A verifier fails a task that breaks any line here, the same as a missing feature. The orchestrator adds a line each time Anmol corrects something, so he never has to say it twice.

## The bar
- Watch Dogs 2 is the fidelity bar (STYLE_BIBLE.md). Ask of every shot: would this frame sit next to a Watch Dogs 2 street shot without looking cheap? Density of props, material detail, decals and grime, signage, light and shadow, life on the street.
- It must run smoothly on a Mac M2. Look gains that break the budgets are not done.

## Real Delhi, today
- Build each place as it looks today, from dated current photos, not from the map shape alone (decisions.md 2026-11-14). Check the date of every photo; old photos are never used for surfaces, signs or colours.
- Check the road surface, kerbs, median, poles, wires, trees, wall colours, signs and clutter against the photos. Chandni Chowk main road is red sandstone and car-free, not asphalt.
- Wall colours come from the area photos. Bright colours only where the photos show them; in the old city, colour is on goods and signs, walls are dusty.
- Famous places keep their own style (the Pragati Maidan tunnel wall art, India Gate, CP whitewash colonnades). A generic version fails.

## Detail and wear
- Delhi houses have balcony grilles and railings, roof parapets with railings, gate and window grilles, and outside stairs.
- Scripts per board follow the place and trade: Hindi only, English only, Urdu only, or two together where real boards do (old city Hindi, near Jama Masjid Urdu, GB Road and Paharganj mostly English, CP English); never all three by default (2026-11-14).
- Sign boards look like real Indian shop signs: flex banners, painted tin, glow boxes, stacked boards, Hindi, English and Urdu, phone numbers. Never clean generated graphics. Each board carries real layout richness: several lines (name, goods, phone, address), mixed fonts, outlines and shadows, icons or printed photos, borders; hotel verticals with neon or LED lettering, star ratings, amenities, bulb or LED borders that flicker or chase at night. A single colour rectangle with one line of plain text fails (2026-11-14).
- Things wear: rust, faded and peeling paint, bent boards, torn flex, stains, soot, rain streaks. Wear is soft and natural, never blocky patches.
- Emptiness is a blocker, never polish. A street or junction that feels bare fails.
- Light fittings are attached to something real, line up with the structure, glow, and match the light they cast. A floating or angled bar of flat white fails (tunnel lights, 2026-11-14).
- Light on surfaces matches its source: a continuous strip gives even light, never spaced pools; no sky light inside tunnels or rooms (2026-11-14).
- Street lights are real lights near the camera (lighting road, kerb, poles, walls, cars) and projected decals far away; never flat painted ellipses; heads glow with a little haze; LED warm white on main roads (2026-11-14).

## Systems are finished, not first steps
- A system is done when it is complete everywhere it applies in the pilot (tunnels with depth, roof, walls, lights and inside, not an open trench). A planned split is named in the title and told to Anmol.

## Measuring
- Report perf with the machine load. A miss on a busy machine is rerun when quiet or judged against a reference scene in the same run.

## Reporting
- Say plainly what is still a stand-in. Show Anmol finished work, not work he has to correct.
