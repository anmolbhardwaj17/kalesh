// What is lit from inside in a roofed tunnel (P2-032): the LED strip lines, the lenses of the pillars' uplights, sign
// faces and lane signals. Unshaded vertex colour times `gain` and the colour's alpha (1 for a strip, less for a sign
// face), so a strip is well past the glow threshold and blooms at any hour (`exposure_comp` takes the scene's
// exposure back out), seen through the tunnel's haze: the strips fade and warm with distance.
shader_type spatial;
render_mode unshaded, cull_back;

uniform float gain = 7.0;
#include "res://world/infra/tunnel_light.gdshaderinc"

void fragment() {
	vec3 c = COLOR.rgb;
	c = mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
	// a strip's own light is warm white; the haze takes it slower than a lit surface (it is far brighter)
	float d = length(VERTEX);
	vec3 lit = c * mix(vec3(1.0), T_LIGHT, 0.6) * (gain * COLOR.a);
	float f = 1.0 - exp(-d * T_HAZE_DENSITY * 0.55);
	ALBEDO = mix(lit, T_HAZE * 2.5, f) * (light_level * exposure_comp);
	FOG = vec4(0.0);
}
