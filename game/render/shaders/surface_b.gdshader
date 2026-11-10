// Surface shader of style test B (stylised_b, STYLE_OPTIONS.md batch B): the stylised_grime surface shader plus
// generated tiling textures (game/render/textures/tile_*.png, a Texture2DArray built in stylised_b.gd) and a
// stronger, more specific Old Delhi grime layer. Walls, roads, footpaths, shutters and leaves of the vertex-coloured
// stand-ins; the texture layer is picked from the surface kind and the vertex colour (brick, footpath tile and grey
// concrete colours of the stand-in kit), mapped in world space (no UVs). Grime is driven by the per-block wear value
// (instance uniform "wear"): rising damp with a tide line, soot and rain streaks that start under the floor bands
// (never full-height streaks), tea-coloured water stains with dark rims, peeling paint that shows old paint or brick,
// patched plaster, dust on roofs, oil, litter specks and sharp-edged puddles on the street.
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

// 0 masonry and plaster ("matte"), 1 asphalt and paving ("road"), 2 leaves and grass ("leaf"), 3 rolling shutter
uniform int surface_kind = 0;
uniform float roughness_base = 0.92;
uniform float detail = 1.0;
uniform float albedo_saturation = 1.0;
uniform float wear_scale = 0.0;
uniform vec3 backlight_tint = vec3(0.0);
uniform float tex_mix = 1.0;
uniform sampler2DArray tiles : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
instance uniform float wear = 0.0;

const int L_PLASTER = 0;
const int L_BRICK = 1;
const int L_CONCRETE = 2;
const int L_ASPHALT = 3;
const int L_PAVER = 4;
const int L_SHUTTER = 5;
// stand-in kit colours (sRGB) that pick a texture layer (game/scenes/standin/kit.gd)
const vec3 KIT_BRICK = vec3(0.561, 0.369, 0.271);
const vec3 KIT_PAVER = vec3(0.604, 0.553, 0.502);

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

float luma(vec3 c) {
	return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec4 layer(vec2 uv, float tile, int l) {
	return texture(tiles, vec3(uv / tile, float(l)));
}

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec3 srgb = COLOR.rgb;
	vec3 base = to_linear(srgb);
	float lum = luma(base);
	base = max(mix(vec3(lum), base, albedo_saturation), vec3(0.0));
	vec3 an = abs(wnrm);
	bool vertical = an.y < 0.7;
	// planar coordinates in metres: walls use (along the wall, height), floors and roofs use (x, z); v runs down
	vec2 uv = vertical ? (an.x > an.z ? wpos.zy : wpos.xy) : wpos.xz;
	vec2 tuv = vertical ? vec2(uv.x, -uv.y) : uv;
	float rough = roughness_base;
	vec3 col = base;
	float mask = 0.0;
	float smax = max(srgb.r, max(srgb.g, srgb.b));
	float sat = smax > 0.0 ? (smax - min(srgb.r, min(srgb.g, srgb.b))) / smax : 0.0;
	bool brick = false;
	if (surface_kind == 0) {
		float m = fbm(uv * 0.55) - 0.5;
		float g = vnoise(uv * 11.0) - 0.5;
		col *= 1.0 + detail * (m * 0.12 + g * 0.04);
		rough = clamp(rough + detail * g * 0.1, 0.0, 1.0);
		if (tex_mix > 0.0) {
			if (!vertical && distance(srgb, KIT_PAVER) < 0.05) {
				vec4 t = layer(tuv, 1.2, L_PAVER);
				// the checker is kept soft (a third of the stand-in colour stays) so it does not glare under lamps
				col = mix(col, mix(t.rgb * (lum / 0.27), col * (0.75 + t.a * -0.3 + luma(t.rgb) * 1.0), 0.35), tex_mix);
				mask = t.a;
				rough = mix(rough, 0.8, t.a);
			} else if (distance(srgb, KIT_BRICK) < 0.06) {
				vec4 t = layer(tuv, 0.96, L_BRICK);
				col = mix(col, t.rgb * (lum / 0.17), tex_mix);
				mask = t.a;
				brick = true;
			} else if (sat < 0.09 && smax < 0.78) {
				vec4 t = layer(tuv, 2.4, L_CONCRETE);
				col *= mix(1.0, t.r * 2.0, tex_mix);
				mask = t.a;
			} else {
				vec4 t = layer(tuv, 2.0, L_PLASTER);
				col *= mix(1.0, t.r * 2.0, tex_mix * 0.85);
				mask = t.a;
			}
		}
	} else if (surface_kind == 1) {
		float g = hash12(floor(uv * 36.0)) - 0.5;
		float m = fbm(uv * 0.22) - 0.5;
		col *= 1.0 + detail * (g * 0.08 + m * 0.14);
		rough = clamp(rough - detail * (0.12 + m * 0.2), 0.45, 1.0);
		if (tex_mix > 0.0) {
			if (smax > 0.36) {
				vec4 t = layer(tuv, 2.4, L_CONCRETE);
				col *= mix(1.0, t.r * 2.0, tex_mix);
				mask = t.a;
			} else {
				// two scales blended by a slow noise, so the patches and tar lines do not repeat on a grid
				float pick = smoothstep(0.4, 0.6, vnoise(uv * 0.045 + 7.0));
				vec4 t = mix(layer(tuv, 7.0, L_ASPHALT), layer(tuv.yx + vec2(3.7, 1.3), 11.3, L_ASPHALT), pick);
				// tar lines show faintly in most places, darker in a few stretches
				float tarv = smoothstep(0.5, 0.75, vnoise(uv * 0.05 + 3.0));
				float mult = mix(t.r * 2.0, max(t.r * 2.0, 0.82), t.a * (1.0 - tarv * 0.7));
				col *= mix(1.0, mult, tex_mix);
				mask = t.a * (0.3 + tarv * 0.7);
				// tar lines and patch edges are a little glossier
				rough = mix(rough, 0.55, mask * tex_mix);
			}
		}
	} else if (surface_kind == 3) {
		vec4 t = layer(tuv, 1.0, L_SHUTTER);
		col *= mix(1.0, t.r * 2.0, tex_mix);
		col = mix(col, t.rgb * lum * 2.0, tex_mix * 0.4);
		rough = mix(0.55, 0.85, t.a);
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
			// rising damp at the base: a ragged line between 0.5 and 1.9 m, a dark tide line and salt above it
			float line = 0.55 + fbm(vec2(uv.x * 0.9, 3.1)) * 1.4;
			float damp = 1.0 - smoothstep(line - 0.3, line + 0.05, h);
			float tide = smoothstep(line - 0.12, line, h) * (1.0 - smoothstep(line, line + 0.06, h));
			float salt = smoothstep(line, line + 0.05, h) * (1.0 - smoothstep(line + 0.05, line + 0.35, h));
			col = mix(col, col * vec3(0.42, 0.39, 0.33), damp * 0.9 * w);
			col = mix(col, vec3(0.06, 0.05, 0.04), tide * 0.6 * w);
			col = mix(col, col * 1.15 + vec3(0.04), salt * 0.5 * w * step(0.5, vnoise(vec2(uv.x * 3.0, 1.7))));
			// soot and rain streaks that run down from the floor band above (stand-in storeys: 3.2 m from 0.4 m)
			float band = 0.4 + 3.2 * ceil((h - 0.4) / 3.2);
			float below = band - h;
			float col_n = vnoise(vec2(uv.x * 2.2, 0.5));
			float len = 0.5 + col_n * 2.2;
			float run = smoothstep(0.45, 0.75, vnoise(vec2(uv.x * 5.5, 2.0))) * (1.0 - smoothstep(0.0, len, below));
			run *= step(1.2, band) * (0.6 + 0.4 * vnoise(vec2(uv.x * 40.0, h * 1.5)));
			col = mix(col, vec3(0.04, 0.035, 0.03), run * 0.8 * w);
			// tea-coloured water stains with a dark rim
			float sf = fbm(uv * 0.5 + 13.0);
			float stain = smoothstep(0.6, 0.63, sf);
			float rim = stain * (1.0 - smoothstep(0.63, 0.67, sf));
			col = mix(col, col * vec3(0.78, 0.68, 0.5), stain * 0.6 * w);
			col = mix(col, col * 0.55, rim * 0.6 * w);
			// peeling paint: sharp-edged patches that show old paint or bare brick, a light lifted edge round them
			float pf = fbm(uv * 1.5 + 31.0) + (h < 3.0 ? 0.03 : 0.0);
			// (not on shutters or the dark shop interiors)
			float paint = step(0.12, lum) * (surface_kind == 0 ? 1.0 : 0.0);
			float peel = smoothstep(0.66, 0.665, pf) * step(0.3, h) * paint;
			float edge = smoothstep(0.645, 0.66, pf) * (1.0 - peel) * paint;
			// older paint under the top coat: a paler, greyer lime wash of the same hue, or bare brick
			vec3 under = mix(vec3(luma(base)), base, 0.45) * 1.35 + vec3(0.05, 0.045, 0.035);
			if (tex_mix > 0.0 && !brick && hash12(floor(uv * 0.35)) > 0.45) {
				under = layer(tuv, 0.96, L_BRICK).rgb * 0.85;
			}
			col = mix(col, under, peel * w);
			col = mix(col, col * 1.25 + vec3(0.05), edge * 0.7 * w);
			// patched plaster: blocky cells of fresher lime
			vec2 cell = floor(uv * vec2(0.8, 1.25));
			float patched = step(0.9, hash12(cell + 11.0)) * step(1.2, h);
			col = mix(col, vec3(0.45, 0.42, 0.36), patched * 0.55 * w);
			// cracks and joints hold dirt
			col = mix(col, col * 0.45, mask * 0.6 * w);
		} else {
			// dust on roofs, ledges and the street (no streaks on flat tops)
			float dust = smoothstep(0.35, 0.8, fbm(uv * 0.4 + 2.0));
			col = mix(col, vec3(0.2, 0.165, 0.12), dust * 0.45 * w);
			if (surface_kind == 1) {
				float oil = smoothstep(0.64, 0.7, fbm(uv * 0.7 + 9.0));
				col = mix(col, col * 0.4, oil * 0.85 * w);
				rough = mix(rough, 0.55, oil * w);
				// sharp-edged puddles in the low spots, a damp darker ring round each
				float pf = fbm(uv * 0.3 + 21.0);
				float puddle = smoothstep(0.705, 0.712, pf);
				float dampr = smoothstep(0.66, 0.705, pf) * (1.0 - puddle);
				col = mix(col, col * 0.62, dampr * 0.8 * w);
				rough = mix(rough, 0.45, dampr * w);
				col = mix(col, col * 0.28, puddle * w);
				rough = mix(rough, 0.03, puddle * w);
				// grit and litter specks (paper, plastic wrappers, leaves)
				vec2 lc = floor(uv * 12.0);
				float lit = step(0.995, hash12(lc + 3.0)) * step(0.5, vnoise(uv * 0.5));
				vec3 litc = mix(vec3(0.75, 0.72, 0.62), vec3(0.6, 0.12, 0.1), step(0.5, hash12(lc + 9.0)));
				litc = mix(litc, vec3(0.12, 0.32, 0.6), step(0.8, hash12(lc + 17.0)));
				col = mix(col, litc * 0.35, lit * 0.8 * (1.0 - puddle) * w);
				float grit = hash12(floor(uv * 45.0) + 5.0) * vnoise(uv * 3.0);
				col = mix(col, vec3(0.16, 0.13, 0.095), step(0.72, grit) * 0.4 * w);
			}
			col = mix(col, col * 0.6, mask * 0.5 * w);
		}
		// faded, sun-bleached paint in big soft blotches (walls only, kept light)
		if (vertical) {
			float blotch = smoothstep(0.5, 0.78, fbm(uv * 0.3 + 3.7));
			float fl = luma(col);
			col = mix(col, mix(vec3(fl), col, 0.5) * 1.08 + vec3(0.01, 0.006, 0.0), blotch * 0.45 * w);
		}
		rough = mix(rough, 1.0, w * 0.3 * (vertical ? 1.0 : 0.5));
	}
	ALBEDO = col;
	ROUGHNESS = rough;
	METALLIC = surface_kind == 3 ? 0.35 : 0.0;
	SPECULAR = 0.4;
	BACKLIGHT = backlight_tint * col;
}
