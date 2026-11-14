// The murals inside a roofed tunnel (P2-032): the art of tunnel_mural.gdshaderinc, shaded per pixel by the two
// continuous LED strip lines (tunnel_light.gdshaderinc): gloss paint over a concrete grain, no light pools, no sky.
shader_type spatial;
render_mode unshaded, cull_back;

uniform float light_level = 0.86;
#define VERTEX_LIGHT
#include "res://world/infra/tunnel_light.gdshaderinc"

void vertex() {
	TUNNEL_VERTEX
}

#include "res://world/infra/tunnel_mural.gdshaderinc"
