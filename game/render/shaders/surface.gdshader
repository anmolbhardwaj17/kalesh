// Shared surface shader of the Phase 0 style tests (look B and B+D, game/render/styles/stylised.gd): walls,
// roads and leaves of the vertex-coloured stand-ins. Adds procedural surface detail in world space (no UVs needed)
// and, in stylised_grime, a grime layer driven by the per-block wear value (instance uniform "wear", from the
// builder's AREA_WEAR): damp at the wall base, soot and rain streaks, faded paint, patched plaster, dust on tops
// and oil and dust on the street. People and signs use other materials, so they stay clean.
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

// 0 masonry and plaster (key "matte"), 1 asphalt and paving (key "road"), 2 leaves and grass (key "leaf")
uniform int surface_kind = 0;
uniform float roughness_base = 0.92;
uniform float detail = 1.0;
uniform float albedo_saturation = 1.0;
uniform float wear_scale = 0.0;
uniform vec3 backlight_tint = vec3(0.0);
instance uniform float wear = 0.0;

varying vec3 wpos;
varying vec3 wnrm;

vec3 to_linear(vec3 c) {
	return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
		mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
	float a = 0.5;
	float s = 0.0;
	for (int i = 0; i < 4; i++) {
		s += a * vnoise(p);
		p = p * 2.03 + vec2(17.1, 9.2);
		a *= 0.5;
	}
	return s;
}

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec3 base = to_linear(COLOR.rgb);
	float lum = dot(base, vec3(0.2126, 0.7152, 0.0722));
	base = max(mix(vec3(lum), base, albedo_saturation), vec3(0.0));
	vec3 an = abs(wnrm);
	bool vertical = an.y < 0.7;
	// planar coordinates on the face: walls use (along the wall, height), floors and roofs use (x, z)
	vec2 uv = vertical ? (an.x > an.z ? wpos.zy : wpos.xy) : wpos.xz;
	float rough = roughness_base;
	vec3 col = base;
	if (surface_kind == 0) {
		float m = fbm(uv * 0.55) - 0.5;
		float g = vnoise(uv * 11.0) - 0.5;
		col *= 1.0 + detail * (m * 0.16 + g * 0.06);
		rough = clamp(rough + detail * g * 0.1, 0.0, 1.0);
	} else if (surface_kind == 1) {
		float g = hash12(floor(uv * 36.0)) - 0.5;
		float m = fbm(uv * 0.22) - 0.5;
		col *= 1.0 + detail * (g * 0.12 + m * 0.2);
		rough = clamp(rough - detail * (0.12 + m * 0.2), 0.45, 1.0);
	} else {
		float m = vnoise(wpos.xz * 1.6 + vec2(wpos.y * 1.9, wpos.y * -1.3));
		float m2 = vnoise(wpos.xz * 0.15);
		col *= 1.0 + detail * ((m - 0.5) * 0.4 + (m2 - 0.5) * 0.3);
		col.r *= 1.0 + detail * (m2 - 0.5) * 0.35;
	}
	float w = clamp(wear * wear_scale, 0.0, 1.0);
	if (w > 0.001 && surface_kind != 2) {
		float h = wpos.y;
		if (vertical) {
			// damp and splash at the base: a ragged line between 0.4 and 2 m
			float line = 0.5 + fbm(vec2(uv.x * 0.9, 3.1)) * 1.6;
			float damp = 1.0 - smoothstep(line - 0.35, line + 0.25, h);
			col = mix(col, col * vec3(0.46, 0.43, 0.36), damp * 0.85 * w);
			// soot and rain streaks running down the face
			float streak = smoothstep(0.45, 0.8, fbm(vec2(uv.x * 2.4, uv.y * 0.11 + 5.0)));
			float streak2 = smoothstep(0.55, 0.9, vnoise(vec2(uv.x * 7.0, uv.y * 0.35)));
			col = mix(col, vec3(0.035, 0.03, 0.025), (streak * 0.65 + streak2 * 0.3) * w);
			// patched plaster: blocky cells of fresher lime
			vec2 cell = floor(uv * vec2(0.8, 1.25));
			float patched = step(0.88, hash12(cell + 11.0)) * step(1.2, h);
			col = mix(col, vec3(0.42, 0.39, 0.33), patched * 0.65 * w);
		} else {
			// dust on roofs, ledges and the street
			float dust = smoothstep(0.35, 0.8, fbm(uv * 0.4 + 2.0));
			col = mix(col, vec3(0.2, 0.165, 0.12), dust * 0.4 * w);
			if (surface_kind == 1) {
				float oil = smoothstep(0.62, 0.76, fbm(uv * 0.7 + 9.0));
				col = mix(col, col * 0.4, oil * 0.85 * w);
				float wet = smoothstep(0.68, 0.74, fbm(uv * 0.35 + 21.0));
				col = mix(col, col * 0.3, wet * 0.9 * w);
				rough = mix(rough, 0.2, wet * w);
				rough = mix(rough, 0.55, oil * w);
				float grit = hash12(floor(uv * 14.0) + 5.0);
				col = mix(col, vec3(0.16, 0.13, 0.095), step(0.93, grit) * 0.6 * w);
			}
		}
		// faded, sun-bleached paint in big blotches
		float blotch = smoothstep(0.5, 0.78, fbm(uv * 0.3 + 3.7));
		float fl = dot(col, vec3(0.2126, 0.7152, 0.0722));
		col = mix(col, mix(vec3(fl), col, 0.45) * 1.1 + vec3(0.012, 0.008, 0.0), blotch * 0.6 * w);
		rough = mix(rough, 1.0, w * 0.4);
	}
	ALBEDO = col;
	ROUGHNESS = rough;
	METALLIC = 0.0;
	SPECULAR = 0.4;
	BACKLIGHT = backlight_tint * col;
}
