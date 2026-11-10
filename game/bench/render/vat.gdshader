// Baked vertex animation for far crowd people (render bench P0-016, ARCH_OPTIONS.md AN2). The walk cycle of the
// skinned stand-in is baked into two float textures (x = vertex, y = frame): positions and normals. Each MultiMesh
// instance carries its phase and speed in INSTANCE_CUSTOM (x = phase 0..1, y = cycles per second). UV2.x is the
// vertex column. No skeleton and no CPU work per person.
shader_type spatial;

uniform sampler2D vat_pos : filter_nearest, repeat_disable;
uniform sampler2D vat_nrm : filter_nearest, repeat_disable;
uniform float frames = 24.0;
uniform float roughness = 0.55;

vec3 to_linear(vec3 c) {
	return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

void vertex() {
	float t = fract(TIME * INSTANCE_CUSTOM.y + INSTANCE_CUSTOM.x) * frames;
	float f0 = floor(t);
	float f1 = mod(f0 + 1.0, frames);
	float k = t - f0;
	vec2 a = vec2(UV2.x, (f0 + 0.5) / frames);
	vec2 b = vec2(UV2.x, (f1 + 0.5) / frames);
	VERTEX = mix(textureLod(vat_pos, a, 0.0).xyz, textureLod(vat_pos, b, 0.0).xyz, k);
	NORMAL = normalize(mix(textureLod(vat_nrm, a, 0.0).xyz, textureLod(vat_nrm, b, 0.0).xyz, k));
	COLOR.rgb = to_linear(COLOR.rgb);
}

void fragment() {
	ALBEDO = COLOR.rgb;
	ROUGHNESS = roughness;
}
