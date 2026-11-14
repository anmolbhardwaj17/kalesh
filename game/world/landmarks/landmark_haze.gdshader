// The skyline material of the landmarks (P2-007): levels 1 to 3 of every kit landmark and the far landmarks of the
// backdrop. Lit like the stand-ins (vertex colour albedo, matte), but the depth haze is the scene's own fog with a
// ceiling: the look's fog (STYLE_BIBLE.md "Lighting presets", 0.0026 to 0.0042 per metre) hides everything past about
// 1 km, and DELHI_WORLD.md asks for heroes "visible over the city" from afar. Up to the distance where the scene fog
// reaches `cap` the two are the same, so a level change at 350 m shows no jump; past it a landmark stays a pale
// silhouette in the haze. fog_color, fog_density and cap are set by game/world/systems/landmarks.gd from the
// WorldEnvironment of the current light.
shader_type spatial;
render_mode fog_disabled, cull_back, diffuse_burley, specular_disabled;

uniform vec3 fog_color : source_color = vec3(0.86, 0.77, 0.62);
uniform float fog_density = 0.0026;
uniform float cap = 0.75;
// the look's textured stone reads at about this share of its vertex colour (stylised.gd FLAT_GAIN) with a little
// more saturation (stylised_b albedo saturation): level 1 matches level 0 across the switch
uniform float gain = 0.6;
uniform float saturation = 1.0;

varying float dist;

void vertex() {
	dist = length((MODELVIEW_MATRIX * vec4(VERTEX, 1.0)).xyz);
}

void fragment() {
	// the stand-in kit's vertex colours are sRGB
	vec3 base = pow(COLOR.rgb, vec3(2.2));
	float lum = dot(base, vec3(0.2126, 0.7152, 0.0722));
	ALBEDO = max(mix(vec3(lum), base, saturation), vec3(0.0)) * gain;
	ROUGHNESS = 0.92;
	float f = 1.0 - exp(-dist * fog_density);
	FOG = vec4(fog_color, min(f, cap));
}
