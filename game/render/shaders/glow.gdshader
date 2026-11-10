// Lamp heads, shop bulbs, signal and tail lamps in the Phase 0 style tests: unshaded vertex colour times a gain.
// A gain above 1 pushes the colour past the glow threshold so it blooms (golden evening).
shader_type spatial;
render_mode unshaded, cull_back;

uniform float gain = 1.0;

void fragment() {
	vec3 c = COLOR.rgb;
	ALBEDO = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)) * gain;
}
