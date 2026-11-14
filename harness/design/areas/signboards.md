# Shop sign boards of the pilot areas (P2-048)

Written 2026-11-14 for Anmol's note that the kit boards "look so AI". Sources: the free, dated Wikimedia Commons
photos on `signboards_board.jpg` (numbers #1 to #22 below; credits in the table at the end), the owner's reference set
in `harness/design/reference/owner/` (cited as O-files; press and game images, never committed or copied, the two game
screenshots set the quality bar only), and the area boards `<area>_board.jpg` (P2-049, dated). Every photo used for
signs is from 2019 or later; Chandni Chowk main road photos are from after the 2021 redevelopment. The game side is in
`tools/kits/make_signs.mjs` (the boards), `game/world/kits/kit_pieces.gd` (how they hang) and `kits.json` `shares`
(how many of each kind per area).

## What real Delhi boards are (all areas)

Kinds seen, and how each is made:
- **Hand-painted tin or wooden board** over the shutter: a flat GI sheet or planks on an angle iron frame, screwed to the
  wall or hung from two straps on the lintel. Enamel paint, letters by a sign painter: uneven brush strokes, a black or
  dark drop shadow offset down and right, a painted border line. Hindi big over English small, or the two side by side
  with a painted rule between. Often an "Estd." or "स्था." year in a corner, a phone number, a goods list band along
  the bottom, sometimes an arrow. (#2 "since 1889", #3, #6, #16; O-signboards/03 book depot, film distributors, the
  jeweller with an estd year and phone; O-signboards/01 as the bar.)
- **Printed flex banner** on a welded pipe frame: one sheet the width of the shop, about 1 m tall, often stuck over the
  older painted board. Bold printed type (condensed sans), product photos in a row, "deals in" goods lists, two or three
  phone numbers, an address line. Bright yellow, blue, red, white grounds. (#6, #12, #13, #14; O-gb_road/03 at night.)
- **Acrylic glow box**: an aluminium box about 15 to 20 cm deep with a printed acrylic face, lit from inside by tubes;
  white or one strong colour, crisp type, a colour stripe. Newer shops, chemists, clinics, hotels. (#1, #9, #11, #15.)
- **LED letters and outlines**: channel letters or LED strips round the board or the facade (Paharganj hotels, #9, #10).
  In the game they are the glow faces and the night glow; separate channel letters are a follow-up.
- **Lettering painted on walls and shutters**: straight on the plaster or the shutter, no board: shop names, "गली में"
  with an arrow, coaching and transport adverts. Flakes with the plaster. (O-signboards/03 "जोबट" shutter.)
- **Round enamel-style boards**: a disc with a coloured ring, Hindi in the middle ("पुराना सोना चाँदी"), screwed through
  top and bottom; chips show black steel and rust. (O-signboards/03.)
- **Tall vertical boards** up the facade on brackets, standing out from the wall so the street reads them both ways:
  hotel and lodge names, clinics, coaching, stacked letters. (#9, #10, O-signboards/03 Paharganj.)
- **Stacked board walls**: boards and flex sheets on every floor, under windows and on blank walls, three and four
  deep (Paharganj and GB Road, #1, #6, #7, O-gb_road/02).
- **Small boards**: tailors (with a painted figure), dry cleaners, repairs, clinics, about 60 by 30 cm beside a door.
  (O-signboards/01 tailor and laundry boards.)
- **Paper notices**: "To Let", tuition, electrician, with tear-off phone strips, pasted on walls and poles (#7).

Scripts: Hindi (Devanagari) on almost every board in the old city and GB Road, usually first; English on the same
board; Urdu (Nastaliq) on old city boards near Jama Masjid and on official boards (#4, #5); Punjabi rarely (the
trilingual name stone of Chandni Chowk, owner photo O-chandni_chowk_main/04). Fonts: painted boards use high contrast
display serifs and slab serifs with drop shadows, or brush hands; printed flex uses condensed bold sans; glow boxes use
clean sans. Colours: yellow ground with red letters, red ground with cream, blue with white, white with red or blue,
green with cream, black with yellow; sun fades reds to pink and blues to grey.

Mounting: screwed flat to the wall, on an angle iron frame with straps to the lintel, on pipe frames with struts, on
brackets standing out; a slight tilt is common; never floating. Bracket lamps (a curved arm and a conical shade) light
some painted boards from above (O-signboards/01, 02). Wires and cable bundles run across the boards everywhere in the
old city.

Wear (Anmol 2026-11-14, "rusted or the board is bent, rusted, broken, color is coming off"): rust streaks running down
from screws and the bottom edge, faded and uneven paint, peeling to bare metal or wood, chipped edges and enamel chips,
bent and dented tin corners, torn and sagging flex, missing letters with a ghost of the old paint, dust in the corners
and along the top lip, dirt runs. Much more in the old city than in Connaught Place.

## Per area

| Area (kit) | Kinds, most common first | Scripts | Wear | Photos |
|---|---|---|---|---|
| Chandni Chowk main road (bazaar) | glow boxes and painted boards stacked two or three high, flex over older boards, vertical boards, enamel discs at jewellers and sweet shops, small boards and notices at doors | Hindi first, English, some Urdu | heavy on painted boards, light on new glow boxes | #1 (2024-03-25), #2 (2022-04-13), #3 (2022-06-18); O-chandni_chowk_main/02, 03 |
| Old Delhi galis (gali) | painted tin and wooden boards, wall lettering with arrows, paper notices, small boards, few glow boxes | Hindi, Urdu, English | heaviest: rust, peeling, missing letters | #4, #5 (2022-09-10), #6, #7, #8 (2026-02-07); O-signboards/03 |
| GB Road and Ajmeri Gate (hardware) | big printed flex of machine parts shops (yellow, blue, red) with product pictures and phone numbers, flex stacked on upper floors, vertical boards, painted boards under them | Hindi and English | heavy: faded flex, tears, rust on frames | #19 (2022-04-13, station side only); O-gb_road/02 (day), O-gb_road/03 (night) |
| Paharganj Main Bazaar (hotel) | hotel and guest house glow boxes, tall vertical boards up every facade, stacked boards on every floor, LED outlines, travel agency flex | English first, Hindi | medium: dusty, sun faded | #9, #10, #11 (2024-10-28, night); O-signboards/03 Paharganj stacks |
| Janpath (market) | printed acrylic and flex boards one per shop at one height with shop numbers and phone numbers, goods lists, few painted | English, little Hindi | light to medium | #12, #13 (2025-02-18), #14 (2022-08-16) |
| Connaught Place inner and outer (colonnade) | neat showroom glow boxes and slim painted boards under the colonnade, one per bay, centred | English, some Hindi | little | #15 (2025-08-14), #16 (2024-03-04), #17 (2022-11-19) |
| ITO and Daryaganj (office) | painted and glow boards on offices, printed placards in the book market | Hindi and English | medium | #18 (2022-08-28) |
| Jantar Mantar, India Gate, Red Fort (lutyens) | almost no shop boards: official signage, kiosks | Hindi and English | little | #20 (2022-08-25), #21 (2022-09-12), #22 (2024-11-06) |

Sizes (measured from the photos against shutters of about 2.5 to 3 m): painted fascia 2.5 to 3 m by 0.5 to 0.8 m;
flex 2.5 to 3 m by 0.9 to 1.2 m; glow box 2 to 2.8 m by 0.5 to 0.7 m, 15 to 20 cm deep; vertical 0.5 to 0.7 m by 2 to
4 m; enamel disc 0.5 to 0.6 m across; small boards 0.5 to 0.8 m by 0.3 to 0.4 m; paper notices A5 to A4.
Density: in the old city, Paharganj and GB Road nearly every shop has a board, and many facades carry two to five more
up the floors; in CP one sign per bay; around India Gate and Jantar Mantar none.

## In the game (P2-048)

- One 2048 px sign atlas per kit (`game/world/kits/textures/<kit>_signs.png`, made by `tools/kits/make_textures.mjs`
  through `make_signs.mjs`), in eight groups: fascia (20 painted tin or wooden boards), flex (8), glow (8), wall
  lettering (4), vertical (8, the even ones glow boxes), enamel (4), small (8), paper notices (8). `boards.json` lists
  every cell with its name and generic words.
- Wear is painted into each cell with the kit's amount (`STYLE` in make_signs.mjs): gali 0.85, hardware 0.8, bazaar
  0.72, hotel 0.6, market 0.45, office 0.35, colonnade 0.16, lutyens 0.15, times a random 0.5 to 1.3 per board.
- Pieces (`kit_pieces.gd`): `board` (flat), `board_tilt` (turned 2 degrees, a bent corner), `board_lamp` (two bracket
  lamps, lit at night), `flex` (pipe frame on struts), `glow` (aluminium box, backlit), `vboard` (standing out on
  brackets, both faces), `band` (under an upper window), `stack` (flex and a painted board on a blank upper wall),
  `enamel` (disc right of a door), `small` (left of a door), `notice` (paper on the wall), `wallsign` (lettering on a
  plain wall). A shop bay takes one front board of the first five (shares in `kits.json` add up); the cell is picked
  by the bay, so neighbours differ.
- Night: the project global `kit_night` (set by the look from the day clock) lights glow faces and the even vertical
  boards, the lamp heads, and the boards under lamps; glow boxes and lamp boards throw a soft pool on the pavement in
  front (`game/render/shaders/sign_pool.gdshader`).
- Names only from `game/data/names/<area>.json` (respect rule; the parody entries' `board_style` picks their kind and
  their `tagline` becomes a second line). Other words are generic shop words. Phone numbers are one digit short
  (mobile 9 digits, landline 7), so no real line is shown. Fonts are free (OFL) and credited in
  `tools/kits/fonts/CREDITS.md`; the text is shaped with HarfBuzz (harfbuzzjs) into the atlas.
- Not yet: separate LED channel letters, lettering painted on closed shutters (needs closed shutters at night,
  P3-007), cable bundles crossing the boards (street dressing), a per-area name lookup for shop houses of one kit in
  another area (P2-010 follow-up). GB Road has no free current photos of its shop boards on Commons; the owner photos
  cover it, and a photo request is noted for Anmol.

## Photo credits (signboards_board.jpg)

| # | Area | File | Date | Author | Licence |
|---|---|---|---|---|---|
| 1 | chandni_chowk_main | [Old Delhi market, Jama Masjid.jpg](https://commons.wikimedia.org/wiki/File:Old_Delhi_market,_Jama_Masjid.jpg) | 2024-03-25 | Benison P Baby | CC BY-SA 4.0 |
| 2 | chandni_chowk_main | [A shop at Paranthe Wali Gali, Delhi, India.jpg](https://commons.wikimedia.org/wiki/File:A_shop_at_Paranthe_Wali_Gali,_Delhi,_India.jpg) | 2022-04-13 | Ravi Dwivedi | CC BY-SA 4.0 |
| 3 | chandni_chowk_main | [Zeenat Mahal at Lal Kuan in Old Delhi.jpg](https://commons.wikimedia.org/wiki/File:Zeenat_Mahal_at_Lal_Kuan_in_Old_Delhi.jpg) | 2022-06-18 | Beqwiq | CC BY-SA 4.0 |
| 4 | chandni_chowk_galis | [Meena Bazar in Old Delhi 01.jpg](https://commons.wikimedia.org/wiki/File:Meena_Bazar_in_Old_Delhi_01.jpg) | 2022-09-10 | Pinakpani | CC BY-SA 4.0 |
| 5 | chandni_chowk_galis | [Meena Bazar in Old Delhi 17.jpg](https://commons.wikimedia.org/wiki/File:Meena_Bazar_in_Old_Delhi_17.jpg) | 2022-09-10 | Pinakpani | CC BY-SA 4.0 |
| 6 | chandni_chowk_galis | [25 - Old Delhi Bazaar.jpg](https://commons.wikimedia.org/wiki/File:25_-_Old_Delhi_Bazaar.jpg) | 2026-02-07 | Misa.stefanovic.07 | CC BY-SA 4.0 |
| 7 | chandni_chowk_galis | [23 - Old Delhi Bazaar.jpg](https://commons.wikimedia.org/wiki/File:23_-_Old_Delhi_Bazaar.jpg) | 2026-02-07 | Misa.stefanovic.07 | CC BY-SA 4.0 |
| 8 | chandni_chowk_galis | [18 - Old Delhi Bazaar.jpg](https://commons.wikimedia.org/wiki/File:18_-_Old_Delhi_Bazaar.jpg) | 2026-02-07 | Misa.stefanovic.07 | CC BY-SA 4.0 |
| 9 | paharganj_station | [Diwali market at Pahar ganj Delhi 02.jpg](https://commons.wikimedia.org/wiki/File:Diwali_market_at_Pahar_ganj_Delhi_02.jpg) | 2024-10-28 | Goutam1962 | CC BY-SA 4.0 |
| 10 | paharganj_station | [Diwali market at Pahar ganj Delhi 14.jpg](https://commons.wikimedia.org/wiki/File:Diwali_market_at_Pahar_ganj_Delhi_14.jpg) | 2024-10-28 | Goutam1962 | CC BY-SA 4.0 |
| 11 | paharganj_station | [Diwali market at Pahar ganj Delhi 18.jpg](https://commons.wikimedia.org/wiki/File:Diwali_market_at_Pahar_ganj_Delhi_18.jpg) | 2024-10-28 | Goutam1962 | CC BY-SA 4.0 |
| 12 | janpath | [Tibetan Market, at Janpath in New Delhi 05.jpg](https://commons.wikimedia.org/wiki/File:Tibetan_Market,_at_Janpath_in_New_Delhi_05.jpg) | 2025-02-18 | Pinakpani | CC BY 4.0 |
| 13 | janpath | [Tibetan Market, at Janpath in New Delhi 04.jpg](https://commons.wikimedia.org/wiki/File:Tibetan_Market,_at_Janpath_in_New_Delhi_04.jpg) | 2025-02-18 | Pinakpani | CC BY 4.0 |
| 14 | janpath | [Tibet Market, Janpath in New Delhi 08.jpg](https://commons.wikimedia.org/wiki/File:Tibet_Market,_Janpath_in_New_Delhi_08.jpg) | 2022-08-16 | Pinakpani | CC BY-SA 4.0 |
| 15 | cp_inner_circle | [A View of Connaught Place, New Delhi.jpg](https://commons.wikimedia.org/wiki/File:A_View_of_Connaught_Place,_New_Delhi.jpg) | 2025-08-14 | Akankshasharma584 | CC BY-SA 4.0 |
| 16 | cp_inner_circle | [PPH Connaught Place Showroom.jpg](https://commons.wikimedia.org/wiki/File:PPH_Connaught_Place_Showroom.jpg) | 2024-03-04 | Pallav.journo | CC BY-SA 4.0 |
| 17 | cp_outer_circle | [Everyday Buzz at Connaught Place, Delhi.jpg](https://commons.wikimedia.org/wiki/File:Everyday_Buzz_at_Connaught_Place,_Delhi.jpg) | 2022-11-19 | Thesocialtalks | CC0 |
| 18 | ito | [Daryaganj Book Market in Daryaganj, New Delhi 19.jpg](https://commons.wikimedia.org/wiki/File:Daryaganj_Book_Market_in_Daryaganj,_New_Delhi_19.jpg) | 2022-08-28 | Pinakpani | CC BY-SA 4.0 |
| 19 | gb_road_ajmeri_gate | [New Delhi Railway Station Ajmeri Gate side, India. 03.jpg](https://commons.wikimedia.org/wiki/File:New_Delhi_Railway_Station_Ajmeri_Gate_side,_India._03.jpg) | 2022-04-13 | Ravi Dwivedi | CC BY-SA 4.0 |
| 20 | jantar_mantar | [Sansad Marg, a street in New Delhi, India 03.jpg](https://commons.wikimedia.org/wiki/File:Sansad_Marg,_a_street_in_New_Delhi,_India_03.jpg) | 2022-08-25 | Pinakpani | CC BY-SA 4.0 |
| 21 | india_gate_kartavya_path | [Kartavya Path in the evening in New Delhi 04.jpg](https://commons.wikimedia.org/wiki/File:Kartavya_Path_in_the_evening_in_New_Delhi_04.jpg) | 2022-09-12 | Pinakpani | CC BY-SA 4.0 |
| 22 | red_fort_surroundings | [Lal qila from chandni chowk.jpg](https://commons.wikimedia.org/wiki/File:Lal_qila_from_chandni_chowk.jpg) | 2024-11-06 | Krishnav25 | CC0 |

Dates are the EXIF or author date on the file page. Remake the board with `node harness/design/areas/signboards_board.mjs`
(search: `signboards_search.mjs`).
