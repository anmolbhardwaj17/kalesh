// Cheap per-area haze of style B (stylised_b, P0-037): replaces the FogVolume and the volumetric fog pass. A box
// drawn with its back faces and no depth test; for each pixel the view ray is clipped to the box (slab test) and to
// the scene depth, and the haze builds up with the length of ray inside the box (thicker near the ground). One depth
// read per pixel and no lighting: about the cost of one transparent full-screen quad, wherever the box is on screen.
shader_type spatial;
render_mode unshaded, cull_front, depth_test_disabled, depth_draw_never, blend_mix, fog_disabled, shadows_disabled;

uniform sampler2D depth_tex : hint_depth_texture, filter_nearest;
uniform vec3 box_min = vec3(-10.0);
uniform vec3 box_max = vec3(10.0);
// linear colour of the haze as it reads in this light, and its strength
uniform vec3 haze_color = vec3(0.5);
uniform float density = 0.01;
uniform float height_falloff = 0.12;
uniform float max_alpha = 0.6;
// soft sides: the haze thins over this many metres inside each vertical side of the box
uniform float edge = 6.0;
// no haze in the first metres in front of the camera, so near people and shop fronts stay crisp
uniform float clear_near = 6.0;

void fragment() {
	float d = texture(depth_tex, SCREEN_UV).r;
	vec4 v = INV_PROJECTION_MATRIX * vec4(SCREEN_UV * 2.0 - 1.0, d, 1.0);
	v.xyz /= v.w;
	vec3 wp = (INV_VIEW_MATRIX * vec4(v.xyz, 1.0)).xyz;
	vec3 ro = CAMERA_POSITION_WORLD;
	vec3 seg = wp - ro;
	float scene_t = length(seg);
	vec3 rd = seg / max(scene_t, 1e-4);
	vec3 inv = 1.0 / (rd + vec3(1e-6));
	vec3 ta = (box_min - ro) * inv;
	vec3 tb = (box_max - ro) * inv;
	vec3 tn = min(ta, tb);
	vec3 tf = max(ta, tb);
	float t0 = max(max(max(tn.x, tn.y), tn.z), clear_near);
	float t1 = min(min(min(tf.x, tf.y), tf.z), scene_t);
	float len = max(t1 - t0, 0.0);
	// density at the middle of the ray segment: thicker near the ground, thinner towards the open sides
	vec3 mid = ro + rd * (t0 + t1) * 0.5;
	float h = max(mid.y - box_min.y, 0.0);
	vec2 side = min(mid.xz - box_min.xz, box_max.xz - mid.xz);
	float soft = smoothstep(0.0, edge, min(side.x, side.y));
	float k = density * exp(-height_falloff * h) * soft;
	float a = 1.0 - exp(-k * len);
	ALBEDO = haze_color;
	ALPHA = min(a, max_alpha);
}
