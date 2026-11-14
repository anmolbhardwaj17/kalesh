// Area kit surface (P2-010): the stylised B surface shader (surface_b.gdshaderinc) with KIT on, for the facade modules
// of game/world/kits/ (MultiMesh per module per 125 m cell, wall colour and wear in the custom data) and the generated
// building shells (colour and wear in UV2, far windows from the facade UV). No instance uniform: thousands of
// MultiMesh nodes may use it.
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

#define KIT
#include "res://render/shaders/surface_b.gdshaderinc"
