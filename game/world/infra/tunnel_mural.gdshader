// The Pragati Maidan tunnel's painted walls (P2-032, TUN-T1, from the owner's photos in
// harness/design/reference/owner/pragati_maidan_tunnel/), drawn in the fragment shader so the art stays sharp at any
// distance (edges anti-aliased with fwidth). UV.x is metres along the wall run, UV.y metres over the road.
//   kind 0  inside: a yellow wall with a flowing green wave band, ochre borders with white and red dots, leaf and
//           bird motifs in the band
//   kind 1  the ramp walls: cream with flower discs, a blue river band with ripples, lotus, swans and trees, a
//           saffron band with a scalloped edge under the coping (COLOR.r * 16 is the height left to the wall top)
//   kind 2  a pillar of the wide section: its colour (COLOR) with a mandala disc (UV.x across the pillar, 0 to 1.1)
shader_type spatial;
render_mode cull_back;

const float light_level = 1.0;
#include "res://world/infra/tunnel_mural.gdshaderinc"
