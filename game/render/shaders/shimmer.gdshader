// Heat shimmer of style test B (stylised_b, afternoon): a full-screen pass (a 2 x 2 quad drawn at the near plane)
// that wobbles the picture a little where it shows the ground 18 to 220 m away, the way hot air over asphalt does.
// Near things (people, the car, anything within 15 m) and the sky are left alone.
shader_type spatial;
render_mode unshaded, cull_disabled, depth_test_disabled, depth_draw_never, shadows_disabled, fog_disabled;

uniform float strength = 1.0;
uniform sampler2D screen_tex : hint_screen_texture, filter_linear, repeat_disable;
uniform sampler2D depth_tex : hint_depth_texture, filter_nearest, repeat_disable;

void vertex() {
	POSITION = vec4(VERTEX.xy, 1.0, 1.0);
}

float ground_mask(vec2 suv, mat4 inv_proj, mat4 inv_view) {
	float depth = texture(depth_tex, suv).r;
	if (depth <= 0.00001) {
		return 0.0;
	}
	vec4 vp = inv_proj * vec4(suv * 2.0 - 1.0, depth, 1.0);
	vp.xyz /= vp.w;
	vec3 wp = (inv_view * vec4(vp.xyz, 1.0)).xyz;
	float dist = -vp.z;
	return smoothstep(18.0, 45.0, dist) * (1.0 - smoothstep(140.0, 220.0, dist)) * (1.0 - smoothstep(0.3, 2.2, wp.y));
}

void fragment() {
	vec2 suv = SCREEN_UV;
	float m = ground_mask(suv, INV_PROJECTION_MATRIX, INV_VIEW_MATRIX);
	vec2 off = vec2(sin(suv.y * 260.0 + TIME * 5.0) + sin(suv.y * 97.0 - TIME * 3.1) * 0.6, sin(suv.x * 180.0 + TIME * 4.2) * 0.5);
	vec2 uv2 = suv + off * 0.0009 * strength * m;
	// only take the moved sample when it also lands on far ground (no smearing of near edges into the haze)
	float m2 = ground_mask(uv2, INV_PROJECTION_MATRIX, INV_VIEW_MATRIX);
	ALBEDO = texture(screen_tex, mix(suv, uv2, step(0.01, m2))).rgb;
}
