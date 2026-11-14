// The light a lit sign board throws on the pavement in front of it at night (P2-048, WORLD_LOGIC.md "a shop sign glows
// on the pavement under it"): a flat quad just over the street, drawn additive, strongest at the wall and fading out
// and to the sides; nothing by day (kit_night is the project global the look sets). UV: x across, y out from the wall.
shader_type spatial;
render_mode blend_add, depth_draw_never, cull_disabled, unshaded, shadows_disabled, fog_disabled;

global uniform float kit_night;
uniform vec3 tint = vec3(1.0, 0.8, 0.55);
uniform float gain = 0.22;

void fragment() {
	float across = 1.0 - pow(abs(UV.x * 2.0 - 1.0), 2.2);
	// soft at the wall end too (the quad starts in front of the shop step) and fading out over the reach
	float out_ = smoothstep(0.0, 0.18, UV.y) * pow(1.0 - clamp(UV.y, 0.0, 1.0), 2.0);
	float a = across * out_ * kit_night * gain;
	ALBEDO = tint * a;
}
