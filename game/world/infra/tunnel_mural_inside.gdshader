// The murals inside a roofed tunnel (P2-032): the art of tunnel_mural.gdshaderinc, unshaded at an even light level,
// as lit by the two continuous LED strip lines: no light pools, no sky ambient.
shader_type spatial;
render_mode unshaded, cull_back;

uniform float light_level = 0.82;
#include "res://world/infra/tunnel_mural.gdshaderinc"
