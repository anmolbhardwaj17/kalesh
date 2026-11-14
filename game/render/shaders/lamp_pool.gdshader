// The pool a street lamp throws on the road at night (P2-052, game/render/street_lamps.gd): a flat quad just over the
// asphalt, drawn additive, an elongated soft ellipse brightest under the head; nothing by day (strength 0). Costs no
// light: only the few lamps nearest the camera are real SpotLights. UV: the quad's own 0..1 square.
shader_type spatial;
render_mode blend_add, depth_draw_never, cull_disabled, unshaded, shadows_disabled, fog_disabled;

uniform vec3 tint : source_color = vec3(1.0, 0.72, 0.45);
uniform float strength = 0.0;

void fragment() {
	vec2 p = (UV - vec2(0.5)) * 2.0;
	float r = length(p);
	float a = pow(clamp(1.0 - r, 0.0, 1.0), 1.8) * strength;
	ALBEDO = tint * a;
}
