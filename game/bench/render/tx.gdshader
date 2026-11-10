// Texture bench panel (render bench P0-016, ARCH_OPTIONS.md TX1 against TX3): one layer of the kit albedo and normal
// arrays on a quad, so the arrays are really in video memory and sampled with mipmaps.
shader_type spatial;

uniform sampler2DArray albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2DArray normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform float layer = 0.0;

void fragment() {
	vec3 uvw = vec3(UV * 2.0, layer);
	ALBEDO = texture(albedo_tex, uvw).rgb;
	NORMAL_MAP = texture(normal_tex, uvw).rgb;
	ROUGHNESS = 0.8;
}
