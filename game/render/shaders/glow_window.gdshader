// Lit window panes of the live look (stylised_b, P1-028): glow.gdshader's unshaded vertex colour times a gain, for
// panes whose own random draw (the vertex colour's alpha) is under the window share; the others collapse to a point
// (no fragments, no discard), so the stand-in's dark glass shows. The share follows the day clock, so the windows come
// on one by one in the evening and go out in the morning without a rebuild.
shader_type spatial;
render_mode unshaded, cull_back;

uniform float gain = 1.0;
uniform float share = 0.0;

void vertex() {
	if (COLOR.a >= share) {
		VERTEX = vec3(0.0);
	}
}

void fragment() {
	vec3 c = COLOR.rgb;
	ALBEDO = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)) * gain;
}
