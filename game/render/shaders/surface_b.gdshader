// Surface shader of style test B (stylised_b, STYLE_OPTIONS.md batch B): the stylised_grime surface shader plus
// generated tiling textures (game/render/textures/tile_*.png, a Texture2DArray built in stylised_b.gd) and a
// stronger, more specific Old Delhi grime layer. Walls, roads, footpaths, shutters and leaves of the vertex-coloured
// stand-ins; the texture layer is picked from the surface kind and the vertex colour (brick, footpath tile and grey
// concrete colours of the stand-in kit), mapped in world space (no UVs). Grime is driven by the per-block wear value
// (instance uniform "wear"): rising damp with a tide line, soot and rain streaks that start under the floor bands
// (never full-height streaks), tea-coloured water stains with dark rims, peeling paint that shows old paint or brick,
// patched plaster, dust on roofs, oil, litter specks and sharp-edged puddles on the street.
// The realistic reference look (style realistic, P0-038) turns on the PBR layer with pbr = 1: a height per surface
// (from the texture layer, or procedural noise on the bare ground) turned into a normal by screen-space derivatives,
// roughness and AO from the joints, a second finer texture scale, a dirt and dry grass ground between the blocks,
// and wet and dusty surface response (uniforms wetness and dustiness, per light). With pbr = 0 the output is unchanged.
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

#include "res://render/shaders/surface_b.gdshaderinc"
