// The body of the stylised B surface shader (surface_b.gdshader), shared with the area kit shader (kit_b.gdshader,
// P2-010), which defines KIT: wear and wall colour from the MultiMesh custom data or the shell UV2, the kit's own
// layers and atlas picked by a part code. Without KIT the output is the signed look, unchanged.

// 0 masonry and plaster ("matte"), 1 asphalt and paving ("road"), 2 leaves and grass ("leaf"), 3 rolling shutter
uniform int surface_kind = 0;
uniform float roughness_base = 0.92;
uniform float detail = 1.0;
uniform float albedo_saturation = 1.0;
uniform float wear_scale = 0.0;
uniform vec3 backlight_tint = vec3(0.0);
uniform float tex_mix = 1.0;
// realistic layer (0 = off, the stylised_b look)
uniform float pbr = 0.0;
uniform float bump = 1.0;
uniform float mottle = 1.0;
uniform float wetness = 0.0;
uniform float dustiness = 0.0;
// calmer stylised B surfaces (P0-037; 0 keeps the P0-034 output, the realistic look leaves it at 0): softer plaster
// swirl and crack veins on dark walls and at eye height, faint tar lines on the asphalt, earth and dry grass on the
// bare ground between blocks (the realistic look has its own earth through pbr)
uniform float calm = 0.0;
uniform sampler2DArray tiles : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
#ifndef KIT
instance uniform float wear = 0.0;
#else
// area kits (P2-010, kit_b.gdshader): the kit's tiling layers and its trim and decal atlas; the wall colour and the
// wear of a module come from the MultiMesh custom data (0xRRGGBB, wear), of a shell from its UV2 (TECH.md "Rendering
// of the city": a per-instance uniform has room for about 4,096 instances only)
uniform sampler2DArray kit_tiles : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D kit_atlas : source_color, filter_linear_mipmap_anisotropic;
uniform vec3 kit_accents[8];
uniform int kit_accent_count = 1;
uniform bool kit_shell = false;
uniform vec3 kit_shell_colour = vec3(0.78, 0.7, 0.58);
// few and flat varyings (P2-010 perf: the module vertex stream is the main cost of the city): the wall colour and
// wear in one, the part code, colour mode and the two bay hashes in another; the world position and normal are
// rebuilt in fragment() from VERTEX and NORMAL
varying flat vec4 k_a;
varying flat vec4 k_b;
varying vec2 k_uv;
#endif

const int L_PLASTER = 0;
const int L_BRICK = 1;
const int L_CONCRETE = 2;
const int L_ASPHALT = 3;
const int L_PAVER = 4;
const int L_SHUTTER = 5;
// stand-in kit colours (sRGB) that pick a texture layer (game/scenes/standin/kit.gd)
const vec3 KIT_BRICK = vec3(0.561, 0.369, 0.271);
const vec3 KIT_PAVER = vec3(0.604, 0.553, 0.502);
// the bare ground boxes between blocks (builder.gd _ground)
const vec3 KIT_GROUND_A = vec3(0.612, 0.561, 0.471);
const vec3 KIT_GROUND_B = vec3(0.604, 0.541, 0.439);

#ifndef KIT
varying vec3 wpos;
varying vec3 wnrm;
#endif

vec3 to_linear(vec3 c) {
	return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

#ifdef KIT
// the kit shader reads its noise from a baked tiling square (tools/kits/make_noise.mjs: 64 noise cells; grey a 4 octave
// fbm with the same amplitudes, alpha one octave of value noise): one fetch instead of 16 or 4 hashes; the grime layer
// calls fbm five times and value noise four times a wall pixel (P2-010 perf)
uniform sampler2D kit_noise : filter_linear_mipmap, repeat_enable;

float vnoise(vec2 p) {
	return texture(kit_noise, p * (1.0 / 64.0)).a;
}

float fbm(vec2 p) {
	return texture(kit_noise, p * (1.0 / 64.0)).r;
}
#else
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
#endif

float luma(vec3 c) {
	return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec4 layer(vec2 uv, float tile, int l) {
	return texture(tiles, vec3(uv / tile, float(l)));
}

// height of a texture layer sample for the bump (joints and cracks sit lower)
float theight(vec4 t) {
	return luma(t.rgb) * 0.7 - t.a * 0.5;
}

// a finer second sample of the same layer, so close surfaces hold detail (texel density about 3x)
vec4 fine(vec4 t, vec2 tuv, float tile, int l) {
	if (pbr <= 0.0) {
		return t;
	}
	vec4 f = layer(tuv + vec2(0.37, 0.61), tile * 0.31, l);
	return vec4(t.rgb * mix(1.0, clamp(luma(f.rgb) / max(luma(t.rgb), 0.02), 0.6, 1.5), 0.35), max(t.a, f.a * 0.6));
}

void vertex() {
#ifndef KIT
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
#else
	k_uv = UV;
	if (kit_shell) {
		float t = UV2.x;
		vec3 tint = t > 0.5 ? vec3(floor(t / 65536.0), mod(floor(t / 256.0), 256.0), mod(t, 256.0)) / 255.0 : kit_shell_colour;
		k_a = vec4(tint, UV2.y);
		k_b = vec4(0.0, 1.0, 0.0, 0.0);
	} else {
		// one draw per bay (the instance's origin): accent colour and sign board cell
		vec3 o = MODEL_MATRIX[3].xyz;
		float v1 = hash12(floor(o.xz * 4.0) * 0.37 + vec2(0.5));
		float v2 = hash12(floor(o.xz * 4.0) * 0.23 + vec2(floor(o.y * 2.0) * 1.7, 3.1));
		k_a = INSTANCE_CUSTOM;
		k_b = vec4(UV2.x, UV2.y, v1, v2);
	}
#endif
}

void fragment() {
#ifdef KIT
	vec3 wpos = (INV_VIEW_MATRIX * vec4(VERTEX, 1.0)).xyz;
	vec3 wnrm = normalize((INV_VIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
	vec3 k_tint = k_a.rgb;
	float wear = k_a.a;
	float k_code = k_b.x;
	float k_mode = k_b.y;
	float k_var = k_b.z;
	float k_var2 = k_b.w;
#endif
	vec3 srgb = COLOR.rgb;
	int sk = surface_kind;
	float metal = 0.0;
#ifdef KIT
	int code = int(k_code + 0.5);
	int mode = int(k_mode + 0.5);
	float kg = 1.0;
	vec3 tint = dot(k_tint, vec3(1.0)) > 0.001 ? k_tint : kit_shell_colour;
	int na = max(kit_accent_count, 1);
	vec3 acc = kit_accents[int(k_var * 7.999) % na];
	vec3 acc2 = kit_accents[int(k_var2 * 7.999) % na];
	if (kit_shell) {
		// far shells: windows and shop openings drawn from the facade UV where no module stands (bays across, floors up)
		bool up = abs(wnrm.y) > 0.7;
		if (up) {
			code = 3;
			srgb = mix(tint, vec3(0.6, 0.58, 0.55), 0.6);
		} else if (k_uv.x > 0.0 || k_uv.y > 0.0) {
			float fu = fract(k_uv.x);
			float fv = fract(k_uv.y);
			if (k_uv.y >= 1.0 && fu > 0.32 && fu < 0.68 && fv > 0.26 && fv < 0.74) {
				code = 11;
				srgb = vec3(0.24, 0.23, 0.22);
				mode = 0;
			} else if (k_uv.y < 1.0 && fu > 0.12 && fu < 0.88 && fv > 0.04 && fv < 0.78) {
				// a closed rolling shutter
				code = 4;
				srgb = vec3(0.5, 0.51, 0.5);
				mode = 0;
			} else {
				srgb = tint;
			}
		} else {
			srgb = tint;
		}
	} else if (mode == 1) {
		srgb = tint * COLOR.rgb;
	}
	if (mode == 1) {
		// old paint bleaches in the sun: a worn wall loses a third of its colour
		srgb = mix(srgb, vec3(dot(srgb, vec3(0.2126, 0.7152, 0.0722))), 0.35 * clamp(wear, 0.0, 1.0));
	}
	if (mode == 2 && !kit_shell) {
		srgb = acc * COLOR.rgb;
	} else if (mode == 3 && !kit_shell) {
		srgb = acc2 * COLOR.rgb;
	}
#endif
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
	// bump height in metres (realistic layer), and whether this is the bare ground between blocks
	float hgt = 0.0;
	bool earth = false;
#ifdef KIT
	if (true) {
		// the kit's own layers, picked by the part code (UV2.x); a wall painted in a brick tint shows brick, a grey one concrete
		int L = code;
		if (code == 0 && mode == 1 && sat > 0.28 && smax < 0.62 && srgb.r > srgb.b * 1.35) {
			L = 1;
		} else if (code == 0 && mode == 1 && sat < 0.09) {
			L = 3;
		}
		float m = fbm(uv * 0.55) - 0.5;
		if (L <= 7) {
			float sc = L == 0 ? 2.0 : (L == 1 ? 0.96 : (L == 2 ? 2.4 : (L == 3 ? 2.4 : (L == 4 ? 1.0 : (L == 5 ? 1.2 : (L == 6 ? 3.0 : 1.0))))));
			vec4 t = texture(kit_tiles, vec3(tuv / sc, float(L)));
			if (L == 1 || L == 2 || L == 5) {
				col = t.rgb * (mode == 0 ? base / max(vec3(0.6), base) : vec3(1.0));
				col *= 1.0 + detail * m * 0.08;
			} else {
				col = base * t.rgb * 2.0 * (1.0 + detail * m * 0.1 * mottle);
			}
			mask = t.a;
			brick = L == 1;
			rough = L == 6 ? 0.1 : (L == 4 ? 0.55 : (L == 5 ? 0.75 : (L == 2 ? 0.82 : 0.92)));
			if (L == 4) {
				sk = 3;
				metal = 0.35;
			} else if (L == 6) {
				sk = 3;
				kg = 0.25;
			}
		} else if (code == 8) {
			// painted iron: grilles, railings, gates
			col = base * (0.9 + vnoise(uv * 9.0) * 0.2);
			rough = 0.5;
			metal = 0.3;
			sk = 3;
			kg = 0.5;
		} else if (code == 9) {
			col = texture(kit_atlas, k_uv).rgb * (mode == 0 ? base / max(vec3(0.6), base) : base);
			rough = 0.8;
			sk = 3;
			kg = 0.5;
		} else if (code == 10) {
			// a sign board: one of the 32 named cells of the atlas, by bay (respect rule: no grime on the lettering)
			float cell = floor(k_var2 * 31.999);
			vec2 cuv = (vec2(mod(cell, 4.0), floor(cell / 4.0)) + clamp(k_uv, vec2(0.01, 0.03), vec2(0.99, 0.97))) * vec2(0.25, 0.0625);
			col = texture(kit_atlas, cuv).rgb;
			rough = 0.6;
			sk = 3;
			kg = 0.0;
		} else {
			// a dark interior behind an opening
			col = base * (0.85 + vnoise(uv * 3.0) * 0.3);
			rough = 1.0;
			sk = 3;
			kg = 0.3;
		}
	} else
#endif
	if (sk == 0) {
		float m = fbm(uv * 0.55) - 0.5;
		float g = vnoise(uv * 11.0) - 0.5;
		col *= 1.0 + detail * (m * 0.12 * mottle + g * 0.04);
		rough = clamp(rough + detail * g * 0.1, 0.0, 1.0);
		if (tex_mix > 0.0) {
			if (!vertical && distance(srgb, KIT_PAVER) < 0.05) {
				vec4 t = fine(layer(tuv, 1.2, L_PAVER), tuv, 1.2, L_PAVER);
				hgt = theight(t) * 0.012;
				// the checker is kept soft (a third of the stand-in colour stays) so it does not glare under lamps
				col = mix(col, mix(t.rgb * (lum / 0.27), col * (0.75 + t.a * -0.3 + luma(t.rgb) * 1.0), 0.35), tex_mix);
				mask = t.a;
				rough = mix(rough, 0.8, t.a);
			} else if (distance(srgb, KIT_BRICK) < 0.06) {
				vec4 t = fine(layer(tuv, 0.96, L_BRICK), tuv, 0.96, L_BRICK);
				hgt = theight(t) * 0.014;
				col = mix(col, t.rgb * (lum / 0.17), tex_mix);
				mask = t.a;
				brick = true;
			} else if (sat < 0.09 && smax < 0.78) {
				vec4 t = fine(layer(tuv, 2.4, L_CONCRETE), tuv, 2.4, L_CONCRETE);
				hgt = theight(t) * 0.006;
				col *= mix(1.0, t.r * 2.0, tex_mix);
				mask = t.a;
			} else {
				vec4 t = fine(layer(tuv, 2.0, L_PLASTER), tuv, 2.0, L_PLASTER);
				hgt = theight(t) * 0.006;
				// calm: the cracks and swirl read as marble veins on dark walls and at eye height, so keep them faint there
				float dark = 1.0 - smoothstep(0.03, 0.16, lum);
				float eye = 1.0 - smoothstep(2.6, 4.2, wpos.y);
				float k = 1.0 - calm * clamp(0.35 + dark * 0.4 + eye * 0.2, 0.0, 0.75);
				col *= mix(1.0, t.r * 2.0, tex_mix * 0.85 * k);
				mask = t.a * k;
			}
		}
	} else if (sk == 1) {
		float g = hash12(floor(uv * 36.0)) - 0.5;
		float m = fbm(uv * 0.22) - 0.5;
		col *= 1.0 + detail * (g * 0.08 + m * 0.14);
		rough = clamp(rough - detail * (0.12 + m * 0.2), 0.45, 1.0);
		earth = (pbr > 0.0 || calm > 0.0) && wpos.y < 0.05 && min(distance(srgb, KIT_GROUND_A), distance(srgb, KIT_GROUND_B)) < 0.025;
		if (earth) {
			// bare ground between blocks: dusty earth, darker damp patches, dry grass and pebbles
			col = base;
			float big = fbm(uv * 0.08 + 4.0);
			float mid = fbm(uv * 0.6 + 8.0);
			float n = vnoise(uv * 7.0);
			col *= 0.66 + big * 0.3 + (mid - 0.5) * 0.26 + (n - 0.5) * 0.1;
			col = mix(col, col * vec3(1.06, 0.95, 0.84), smoothstep(0.45, 0.7, big));
			float grass = smoothstep(0.58, 0.72, fbm(uv * 0.25 + 17.0)) * smoothstep(0.35, 0.65, vnoise(uv * 3.0));
			col = mix(col, vec3(0.16, 0.15, 0.07) + vec3(0.06, 0.05, 0.0) * n, grass * 0.85);
			if (calm > 0.0 && pbr <= 0.0) {
				// stylised B ground cover: wide patches of dry grass, a few darker scrub clumps, readable from 30 m up
				float gc = smoothstep(0.46, 0.6, fbm(uv * 0.18 + 23.0)) * (0.55 + 0.45 * smoothstep(0.3, 0.6, vnoise(uv * 2.2)));
				col = mix(col, vec3(0.2, 0.21, 0.07) + vec3(0.05, 0.04, 0.0) * n, gc * 0.8 * calm);
				float scrub = smoothstep(0.66, 0.7, fbm(uv * 0.7 + 5.0)) * step(0.4, gc);
				col = mix(col, vec3(0.05, 0.08, 0.025), scrub * 0.8 * calm);
			}
			vec2 pc = floor(uv * 9.0);
			vec2 pf = fract(uv * 9.0) - 0.5;
			float peb = step(0.86, hash12(pc + 2.0)) * (1.0 - smoothstep(0.12, 0.3, length(pf + (vec2(hash12(pc), hash12(pc + 5.0)) - 0.5) * 0.3)));
			col = mix(col, base * (0.7 + hash12(pc + 7.0) * 0.6), peb * 0.8);
			mask = (1.0 - n) * 0.4;
			hgt = (mid * 0.02 + n * 0.006 + peb * 0.012 + grass * 0.01);
			rough = 0.96;
		} else if (tex_mix > 0.0) {
			if (smax > 0.36) {
				vec4 t = fine(layer(tuv, 2.4, L_CONCRETE), tuv, 2.4, L_CONCRETE);
				hgt = theight(t) * 0.006;
				col *= mix(1.0, t.r * 2.0, tex_mix);
				mask = t.a;
			} else {
				// two scales blended by a slow noise, so the patches and tar lines do not repeat on a grid
				float pick = smoothstep(0.4, 0.6, vnoise(uv * 0.045 + 7.0));
				vec4 t = mix(layer(tuv, 7.0, L_ASPHALT), layer(tuv.yx + vec2(3.7, 1.3), 11.3, L_ASPHALT), pick);
				if (pbr > 0.0) {
					// aggregate: a fine grain on top of the patches, so the road holds detail up close
					vec4 f = layer(tuv * 1.0 + vec2(0.31, 0.17), 1.3, L_ASPHALT);
					t.rgb *= mix(1.0, clamp(luma(f.rgb) / max(luma(t.rgb), 0.02), 0.7, 1.35), 0.4);
					hgt = (luma(f.rgb) * 0.004 + theight(t) * 0.004);
				}
				// tar lines show faintly in most places, darker in a few stretches
				float tarv = smoothstep(0.5, 0.75, vnoise(uv * 0.05 + 3.0));
				float mult = mix(t.r * 2.0, max(t.r * 2.0, 0.82), t.a * (1.0 - tarv * 0.7));
				// calm: the long tar lines read as swirl cracks (dark rimmed outlines, glossy under the lamps): one faint
				// even tone over the whole line and none of its gloss
				if (calm > 0.0) {
					// undo the line in the texture value (make_textures.gd darkens v towards 0.14 sRGB by the line mask),
					// so the asphalt under it shows; a fifth of the line stays
					float a = clamp(t.a, 0.0, 1.0);
					float sr = pow(max(t.r, 0.0), 1.0 / 2.2);
					float v0 = (sr - 0.14 * a) / max(1.0 - a, 0.15);
					v0 = mix(clamp(v0, 0.0, 1.0), 0.5, smoothstep(0.5, 0.85, a));
					float under = pow(v0, 2.2) * 2.0;
					mult = mix(mult, mix(under, t.r * 2.0, 0.2), calm);
				}
				col *= mix(1.0, mult, tex_mix);
				mask = t.a * (0.3 + tarv * 0.7) * (1.0 - calm * 0.85);
				// tar lines and patch edges are a little glossier
				rough = mix(rough, 0.55, mask * tex_mix);
			}
		}
	} else if (sk == 3) {
		vec4 t = layer(tuv, 1.0, L_SHUTTER);
		hgt = theight(t) * 0.01;
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
#ifdef KIT
	w *= kg;
#endif
	if (w > 0.001 && sk != 2) {
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
			float paint = step(0.12, lum) * (sk == 0 ? 1.0 : 0.0);
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
			if (sk == 1) {
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
			col = mix(col, mix(vec3(fl), col, 0.5) * 1.08 + vec3(0.01, 0.006, 0.0), blotch * 0.45 * w * (1.0 - calm * 0.4));
		}
		rough = mix(rough, 1.0, w * 0.3 * (vertical ? 1.0 : 0.5));
	}
	float ao = 1.0;
	if (pbr > 0.0 && sk != 2) {
		// dust: settles on flat tops and the street, and splashes up the wall base
		if (dustiness > 0.0) {
			float dn = fbm(uv * 0.35 + 41.0);
			vec3 dc = vec3(0.47, 0.41, 0.32);
			// a thin film on the asphalt (more at the edges of the patches), thicker on roofs, ledges and footpaths
			float dm = vertical ? (1.0 - smoothstep(0.1, 0.9, wpos.y)) * 0.35
				: (sk == 1 ? smoothstep(0.45, 0.85, dn) * 0.16 : smoothstep(0.3, 0.75, dn) * 0.35);
			if (earth) {
				dm *= 0.5;
			}
			col = mix(col, dc * (0.85 + dn * 0.3), clamp(dm * dustiness, 0.0, 0.6));
			rough = mix(rough, 1.0, dm * dustiness);
		}
		// wet: a damp sheen on the street and footpaths, standing water in the joints and low patches
		if (wetness > 0.0 && !vertical && wpos.y < 0.4) {
			float wn = fbm(uv * 0.12 + 61.0);
			float wm = wetness * (0.45 + 0.55 * smoothstep(0.4, 0.62, wn)) + mask * wetness * 0.4;
			float pool = smoothstep(0.62, 0.66, wn) * wetness;
			if (earth) {
				wm *= 0.6;
				pool *= 0.4;
			}
			wm = clamp(wm, 0.0, 1.0);
			col *= mix(1.0, 0.55, wm);
			rough = mix(rough, 0.18, wm);
			rough = mix(rough, 0.03, pool);
			hgt *= 1.0 - max(wm * 0.6, pool);
		}
		ao = 1.0 - mask * 0.55;
		// height to normal by screen-space derivatives (Mikkelsen 2010), faded with distance against shimmer
		vec3 dpx = dFdx(wpos);
		vec3 dpy = dFdy(wpos);
		vec3 n = normalize(wnrm);
		vec3 r1 = cross(dpy, n);
		vec3 r2 = cross(n, dpx);
		float det = dot(dpx, r1);
		float hx = dFdx(hgt);
		float hy = dFdy(hgt);
		float fade = 1.0 - smoothstep(18.0, 60.0, length(wpos - CAMERA_POSITION_WORLD));
		vec3 grad = sign(det) * (hx * r1 + hy * r2);
		vec3 nb = normalize(abs(det) * n - grad * bump * fade);
		if (abs(det) > 1e-9) {
			NORMAL = normalize((VIEW_MATRIX * vec4(nb, 0.0)).xyz);
		}
		AO = ao;
		AO_LIGHT_AFFECT = 0.25;
	}
	ALBEDO = col;
	ROUGHNESS = rough;
#ifdef KIT
	METALLIC = metal;
#else
	METALLIC = sk == 3 ? 0.35 : 0.0;
#endif
	SPECULAR = pbr > 0.0 ? 0.5 : 0.4;
#ifndef KIT
	// (no kit sets a backlight: leaving it out keeps the backlight term out of the kit's light loop)
	BACKLIGHT = backlight_tint * col;
#endif
}
