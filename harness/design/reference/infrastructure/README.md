# Delhi infrastructure references

Owner request (Anmol 2026-11-13): every tunnel, underpass, flyover, bridge, metro and rail structure must look finished and consistent, built from how these things really look in Delhi, with the local varieties (STYLE_BIBLE.md "Infrastructure"). This folder is the reference for the kits. Task P2-033, written 2026-11-13.

## Files

| File | Covers |
|---|---|
| `tunnels.md` | Car tunnels, vehicle underpass boxes, basement service tunnels, building passages (variants TUN-T1 to T4) |
| `underpasses_subways.md` | Older road underpasses, road under rail arch, pedestrian subways (UND-U1, U2; SUB-S1 to S5) |
| `flyovers.md` | T beam flyovers, precast box girder flyovers, ramps, elevated corridors, fittings (FLY-T1, B1, R1, E1) |
| `bridges.md` | Yamuna road bridges, Loha Pul truss, cable stay, rail over road, road over rail, barrages (BRI-*, RBR-*) |
| `metro.md` | DMRC viaducts, elevated and underground stations, entrances, metro tunnel (MET-*) |
| `rail.md` | Indian Railways track, platforms, stations, yards, halts, level crossings (RAIL-*, RSTN-*) |
| `foot_over_bridges.md` | Station FOBs, ITO skywalk, PWD steel FOBs, metro links (FOB-B1 to B4) |
| `variant_map.md` and `variant_map.json` | Every structure in the baked pilot mapped to its variant |
| `img/` | 15 Wikimedia Commons photos (licences in `img/CREDITS.json`) |

## How to read a variant

Each variant block has: where it appears, key shapes, dimensions, colours and materials, signage and lighting, wear, game kit notes, and sources. Every fact carries a tag:

- **[S]** stated in a source listed at the bottom of the file (link and date). Where only a search snippet was read and the page was not opened, the source line says so.
- **[P]** read by eye from a photo saved in `img/` (the file name is given).
- **[E]** an estimate from Indian standard practice (IRC road codes, the Railways Schedule of Dimensions, DMRC norms) or judgement. Check against a drawing or a clearer photo before a kit is called final. The numbers are good enough to build a first kit, not to sign off an exact scale.

Colours are approximate, read from the photos: concrete grey about #8c8a85, soot stain about #3d3b38, crash rail orange about #e0661f, kerb paint black and white, hazard yellow and black, Indian Railways platform roof blue about #2f6fb4, rust brown steel about #7a4a2e.

## The ten rules every structure kit follows

1. One variant per structure, chosen from `variant_map.json`. Do not mix variants on one structure.
2. Real Delhi dressing on every structure: painted kerbs, orange or grey crash rails, drainage downpipes, lamp poles, joints, bearings, soot streaks under decks, stickers and posters only at head height on pier bases.
3. Concrete is never flat grey: soot and monsoon streaks (darker under the deck edge, pale where rain washes), stained pier bases to 1.5 m, and clean paint bands where the owner agency repaints (kerbs, murals).
4. The kit sits on the road and ground the bake produced; it never bends the lane model. Use the deck, lane and clearance values in the variant block.
5. Lighting is part of the kit: sodium orange on old structures, white LED on new ones (tunnels, DMRC, Signature Bridge).
6. Signage is Delhi signage (Hindi and English, blue and white directions, NHAI or PWD names, yellow chevrons), invented where a real mark would be a brand.
7. Respect rule: informal life under flyovers (vendors, parked autos, resting people) is shown with dignity and never as mockery.
8. Each structure kind has a hero close-up and a wide shot in the city; check against the photos in `img/` side by side.
9. Variation: two or three paint, wear and dressing variants per variant so a long flyover does not repeat one pier.
10. Sources are for looking only. Nothing here is copied pixel for pixel into game textures; photos are references.
