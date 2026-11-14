// The inside of a roofed tunnel (P2-032): vertex colour, unshaded at an even light level, as lit by the two continuous
// LED strip lines along its soffit. No sun, no sky ambient (the soffit never reads sky blue), no light pools; the
// same at any hour, as a tunnel's lights are. `shade` darkens faces that look down a little (the soffit, the underside of a
// tray) so the shapes still read.
shader_type spatial;
render_mode unshaded, cull_back;

uniform float light_level = 0.82;
uniform float shade = 0.12;

void fragment() {
	vec3 c = COLOR.rgb;
	vec3 lin = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
	vec3 n = (INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz;
	float k = 1.0 - shade * max(-n.y, 0.0);
	ALBEDO = lin * light_level * k;
}
