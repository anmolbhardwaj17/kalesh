# Fidelity bar: a Watch Dogs 2 street frame, in stylised B, on an M2

Written 2026-11-14 for Anmol's direction: "the game we want to match it with, which is Watch Dogs 2 ... our game should look that level. Do whatever is needed to achieve that, keeping in mind the game should run as well." Read with OWNER_EYE.md (his corrections), STYLE_BIBLE.md (the signed look) and perf_budgets.json (the signed budgets, unchanged).

The question every look task, verifier and look critic asks of every shot: **would this frame sit next to a Watch Dogs 2 street shot without looking cheap?** Stylised B stays the look (simplified, warm, not photoreal). The bar is about richness, finish and life, not about copying WD2's San Francisco.

## What makes a Watch Dogs 2 street frame read as high fidelity

Each row: what WD2 does, how we get there in Godot 4.7 Forward+ on the M2 within the budgets, and where the game stands today. "Today" is read from the shots of 2026-11-14 (`kit_*.png`, `city_*.png`, `relight_city_night.png`). Costs are estimates until a task measures them with `--style-off`.

| # | Trait | What WD2 does | Our route (technique, budget line, estimated cost) | Today |
|---|---|---|---|---|
| 1 | Prop density | Every 5 m of pavement holds something: bins, hydrants, signs, planters, bikes, cones, newspaper boxes. Nothing is bare at player height. | Area-profile dressing as MultiMesh per 125 m cell (P2-013, P2-036, P2-038): poles, wires across the street, boards, AC units, tarps, stalls, carts, parked two-wheelers. Dressing line 0.5 ms. Data, not hand placement. | Bare. Footpaths and road edges are empty in every shot; Lutyens and CP have open sand plains. |
| 2 | Life | Dozens of people walking, talking, sitting; steady traffic; parked cars both sides. | Before P3: parked vehicles and standing or sitting people at the baked life points (instanced, idle loops). P3: crowds and traffic. Vehicles 0.4 ms, people 0.6 ms. | None. No person, no moving or parked vehicle in any city shot. |
| 3 | Material detail | Every surface has a normal map, roughness variation and a second detail layer up close: brick relief, cracked plaster, scuffed metal. | One tiling detail normal per layer in `surface_b.gdshader` within about 20 m, roughness from the mask, a second finer scale already exists. One extra array fetch, about 0.1 to 0.2 ms. Amends STYLE_BIBLE "Normal maps are not used" (the task records it). AI texture cards (P2-011) bring the real detail later. | Flat matte. Kit textures have windows and balconies drawn, but read as printed paper at street level. |
| 4 | Wear and grime | Soft, layered: rain streaks under sills, soot over vents, dirt bands at wall bases, edge wear, stains on pavement, gum and cracks. | Rework the wear mask: noise-driven, streaks under every ledge (trim rows), damp base band, soot over shutters, edge wear at corners, faded paint. Decals within 55 m for posters and stains. Shader only, about 0.05 ms. | Wrong kind. Wear shows as blocky white blobs and pixel-check patches (OWNER_EYE: "never blocky patches"). |
| 5 | Ground and roads | Asphalt with patches, cracks, tyre marks, oil, manholes, faded and fresh paint; kerbs with chips; pavement tiles. | Road texture layer with wear by class and area, markings and patches in a decal atlas laid by the bake, kerb paint, pavers by area (P2-035, P2-044, P2-047). About 0 to 0.2 ms. | Flat single-colour asphalt, one zebra, plain grey kerbs, flat-colour footpaths. |
| 6 | Shop fronts and windows | Shop windows with interiors and goods, awnings, lit signs; upper windows with curtains and depth. | Interior mapping (a parallax cube-room shader from a small atlas) for shop interiors and upper windows; goods spill on the footpath; awnings and half-down shutters. About 0.1 to 0.2 ms. The same shader carries lit windows at night. | One repeated "coloured shelf" module in every shop; windows are flat dark panes. |
| 7 | Signage | Dense, varied, real-looking signs at many sizes; emissive at night. | Real Indian sign kinds per area with wear (P2-048), stacked boards, flex, glow boxes; emissive at night through the `glow` and `neon` materials. Dressing line. | Clean generated pink and yellow boards; Anmol: "look so AI". |
| 8 | Light and shadow | Crisp sun shadows, contact shadows, ambient occlusion in every corner, warm bounce, neutral-to-warm shade. | Keep sun shadows, SSAO and SSIL low; add baked vertex AO in the tiles (P2-014); fix the shade colour so shadow on asphalt and walls is neutral warm-grey, never saturated blue. 0 ms for the shade fix. | Shade on asphalt reads saturated navy blue: the cheapest-looking thing in every day shot. No contact darkening at wall bases. |
| 9 | Reflections and sheen | Wet streets, glass towers reflecting the sky, car paint, metal shutters. | Reflection probes at hero places (P2-014) plus a sky cube for the rest; fresnel on glass, car paint and shutters; wet and oil patches with low roughness. No SSR. About 0.1 to 0.3 ms. | Everything matte; glass towers read as grey cards. |
| 10 | Atmosphere and sky | Clouds, sun disc, aerial perspective that layers distance, light shafts. | Procedural cloud layer and sun disc in the sky shader, distance haze already warm (keep), dust motes in sun shafts (exists), skyline with no hole (P2-012, P2-039). About 0.05 ms. | Haze is good and warm. Sky is a flat gradient. |
| 11 | Foliage | Street trees, planters, hedges and lawns with wind. | Species by area (P2-037) with impostors past 150 m; lawns, hedges and median planting. Charged to the city line; about 0.3 ms with impostors (estimate). | No trees in the city shots; bare sand where Lutyens lawns and trees should be. |
| 12 | Small motion | Trees, flags and cloth sway; birds; steam; traffic lights change. | Vertex wind on trees, tarps, flags, laundry and wires; pigeons and kites as cheap particles; steam at tea stalls. About 0.05 to 0.1 ms. | Static except the flag. |
| 13 | Night | Neon and emissive signs, lit windows, light pools, wet reflections, headlights. | P3-007 and P14-002: emissive windows and signs (cheap), at most about 16 real lamps in view, light pools by spot falloff. Lights line 0.8 ms. | The streamed city has no lamps, windows or signs at night. |
| 14 | Image quality | Clean edges on wires and railings, no crawling at distance. | Measure FXAA, SMAA, MSAA 2x and TAA (1.23 ms measured) on wires and railings; pick the cheapest that stops the crawl; trade the afternoon heat shimmer if needed. | No AA by default; thin railings and wires will crawl once they exist. |
| 15 | Vehicles and people up close | Detailed player car and pedestrians at the camera distance. | Procedural vehicles to the STYLE_BIBLE detail floor (panel lines, lamps, mirrors, wheels, interior hint), parked variants with LODs. About 0.1 ms. | The player auto is three stacked boxes. |

## Gap list, ranked by how much it moves the look per millisecond

1. **Shade and grade on the streamed city** (0 ms): neutral warm shade instead of navy, contrast curve, clouds and a sun disc in the sky. Every day frame changes at no cost.
2. **Road and footpath surfaces** (about 0.1 ms): worn textured asphalt, patches, markings, kerb paint, pavers by area. Roads fill a third of every driving frame.
3. **Life without AI** (about 0.4 ms of the vehicles and people lines): parked two-wheelers and cars, autos at their stands, people standing, sitting and vending at life points. Turns a set into a city before P3 lands.
4. **Soft wear and detail normals** (about 0.2 ms): replaces the blocky patches Anmol already rejected; gives walls depth at street level.
5. **Shop fronts with depth and clutter within 15 m** (about 0.4 ms): interior-mapped shops and windows, goods, awnings, wires across the street, poles and boards.
6. **Vehicles to the detail floor** (about 0.1 ms): the auto is in every driving frame.
7. **Signs from real references, with wear and night glow** (inside the dressing line).
8. **Trees, lawns and median planting** (about 0.3 ms with impostors): the Lutyens and CP shots are bare without them.
9. **Reflections and sheen** (about 0.2 ms): glass, paint, shutters and wet patches.
10. **Night city** (0.8 ms line): emissive windows and signs first, few real lamps.
11. **Small motion** (about 0.1 ms).
12. **Anti-aliasing** (0.3 to 1.2 ms): needed once wires and railings are dense; measured, then chosen.

Budget check. The streamed city measures 3.3 to 4.1 ms GPU today (city_golden, 2026-11-14) against the 10 ms warn line; the system lines (look 3.6, city 3.5, people 0.6, vehicles 0.4, dressing 0.5, lights 0.8, HUD 0.1, stretch 0.5) stay as signed. The P2-010 buildings rerun read 3.19 ms against a 2.0 ms line on a busy machine: it is re-measured quiet before anything is added on top. A feature that does not fit its line is paid for by a measured trade (for example SSIL low against baked vertex AO, or the heat shimmer against AA), recorded in decisions.md, never by raising a budget.

## What we do not do

- No SSR, no SDFGI, no volumetric fog, no PCSS (measured too costly in P0; the lean path stays).
- No hand modelling of ordinary buildings: kits, data and shaders first. Hand work only at hero places and mission spaces.
- No photoreal textures: detail comes in the stylised B palette and finish.
- No look gain that breaks the M2 budgets. Not done means not done.

## The look critic (recurring)

A verifier on Sonnet runs after every 3 to 4 finished look tasks (tasks named "Look critic N"; P2-040 is the last one before the gate). It drives and walks the pilot at the play camera in golden and one other light, reads at most 8 shots (about 1600 px) beside the dated current photos of the same places (area boards, P2-049) and this file, and answers per shot: the bar question, the OWNER_EYE.md lines, and which row of the table above is weakest. It returns a findings list: place, shot, row number, blocker or polish (emptiness and anything OWNER_EYE.md names is a blocker), and a one-line fix. The orchestrator turns findings into tasks without asking Anmol and adds the next critic when it is due.
