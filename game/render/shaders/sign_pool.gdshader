// The light a lit sign board throws around it at night (P2-048, WORLD_LOGIC.md "a shop sign glows on the pavement
// under it"): flat quads drawn additive, nothing by day (kit_night is the project global the look sets). Two kinds, told
// apart by the quad's normal: a pool on the ground in front of the shop (strongest at the wall, fading out and to the
// sides) and a soft round spill on the wall round the board (lighting the wall, the awning and the unlit boards near it).
// Light lands only on what lies at the quad's plane or a little in front of it: the depth buffer gives the surface
// behind each pixel, and a surface below the ground quad (the road past the kerb) or far in front of either (a person,
// a car) gets none, so the pool never spills onto the road. A vertical sign lights its spill only when its cell is one
// of the lit (even) cells, the same hash the kit shader uses (surface_b.gdshaderinc). UV: 0..1 across both quads.
shader_type spatial;
render_mode blend_add, depth_draw_never, depth_test_disabled, cull_disabled, unshaded, shadows_disabled, fog_disabled;

global uniform float kit_night;
uniform vec3 tint = vec3(1.0, 0.78, 0.5);
uniform float gain = 0.7;
uniform float wall_gain = 0.45;
/// 1 for a vertical sign's spill: lit only when the bay's vertical cell is a glow box
uniform int vertical_cells = 0;
uniform sampler2D depth_tex : hint_depth_texture, filter_nearest, repeat_disable;

varying float lit;
varying vec3 wn;

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

void vertex() {
	lit = 1.0;
	if (vertical_cells == 1) {
		vec3 o = MODEL_MATRIX[3].xyz;
		float v2 = hash12(floor(o.xz * 4.0) * 0.23 + vec2(floor(o.y * 2.0) * 1.7, 3.1));
		int cell = int(v2 * 8.0 * 0.9999) % 8;
		lit = cell % 2 == 0 ? 1.0 : 0.0;
	}
	wn = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	if (kit_night <= 0.001 || lit < 0.5) {
		// by day (or for an unlit vertical sign) the quad collapses to a point: no pixel is drawn at all
		VERTEX = vec3(0.0);
	}
}

void fragment() {
	if (kit_night <= 0.001 || lit < 0.5) {
		discard;
	}
	float depth = texture(depth_tex, SCREEN_UV).r;
	vec4 vp = INV_PROJECTION_MATRIX * vec4(SCREEN_UV * 2.0 - 1.0, depth, 1.0);
	vec3 surf = (INV_VIEW_MATRIX * vec4(vp.xyz / vp.w, 1.0)).xyz;
	vec3 here = (INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
	vec3 n = normalize(wn);
	float d = dot(surf - here, n);
	float side = length((surf - here) - n * d);
	float a;
	if (abs(n.y) > 0.5) {
		// the pool on the ground: the surface must be at the quad's height (not the road below the kerb, not a body)
		float across = 1.0 - pow(abs(UV.x * 2.0 - 1.0), 2.0);
		float out_ = smoothstep(0.0, 0.12, UV.y) * pow(1.0 - clamp(UV.y, 0.0, 1.0), 1.6);
		float on = smoothstep(-0.11, -0.06, d * sign(n.y)) * (1.0 - smoothstep(0.16, 0.26, d * sign(n.y))) * (1.0 - smoothstep(0.35, 0.6, side));
		a = across * out_ * gain * on;
	} else {
		// the spill on the wall: round, soft, reaching what stands up to a metre out (boards, awning, shutter drum)
		vec2 c = UV * 2.0 - 1.0;
		float r = length(c);
		float fall = pow(clamp(1.0 - r, 0.0, 1.0), 1.7);
		float on = smoothstep(-0.12, -0.05, d) * (1.0 - smoothstep(0.7, 1.3, d)) * (1.0 - smoothstep(0.5, 0.9, side));
		// the wall takes it all; what stands off the wall (the boards, the awning) less, and the lit board itself almost none
		a = fall * wall_gain * on / (1.0 + max(d, 0.0) * 4.0);
	}
	ALBEDO = tint * a * kit_night;
}
