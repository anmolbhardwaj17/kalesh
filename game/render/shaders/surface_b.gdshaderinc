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
// sign boards (P2-048, tools/kits/make_signs.mjs): the kit's 2048 px sign atlas, its groups of cells (x, y, cell w, h in
// atlas fractions; columns and count), and the night (project global, set by the look: glow boxes and lamps emit)
uniform sampler2D kit_signs : source_color, filter_linear_mipmap_anisotropic;
global uniform float kit_night;
// signs on shell walls (P2-048 fix round 3): how thickly the kit's streets carry boards on walls with no modules (the
// side lanes and back walls of the galis, Paharganj and GB Road are wall to wall boards, Connaught Place has few), and
// the share of those boards that are lit boxes
uniform float shell_signs = 0.0;
uniform float shell_glow = 0.2;
const vec4 SIGN_RECT[8] = vec4[](vec4(0.0, 0.0, 0.25, 0.0625), vec4(0.0, 0.3125, 0.25, 0.09375), vec4(0.0, 0.5, 0.25, 0.0625),
	vec4(0.0, 0.625, 0.25, 0.0625), vec4(0.0, 0.6875, 0.0625, 0.25), vec4(0.5, 0.6875, 0.125, 0.125), vec4(0.5, 0.8125, 0.125, 0.0625),
	vec4(0.0, 0.9375, 0.125, 0.0625));
const ivec2 SIGN_GRID[8] = ivec2[](ivec2(4, 20), ivec2(4, 8), ivec2(4, 8), ivec2(4, 4), ivec2(8, 8), ivec2(4, 4), ivec2(4, 8), ivec2(8, 8));
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
	vec3 emit = vec3(0.0);
	float kg = 1.0;
	vec3 tint = dot(k_tint, vec3(1.0)) > 0.001 ? k_tint : kit_shell_colour;
	int na = max(kit_accent_count, 1);
	vec3 acc = kit_accents[int(k_var * 7.999) % na];
	vec3 acc2 = kit_accents[int(k_var2 * 7.999) % na];
	// a sign drawn on a shell wall (fix round 3): its group (-1 none), its place in the cell (v down), the cell hash, the
	// size of the board against the bay (for the texture gradient), how strongly it shows, and the shade under a board
	int s_grp = -1;
	vec2 s_q = vec2(0.0);
	float s_hash = 0.0;
	vec2 s_scale = vec2(1.0);
	float s_fade = 0.0;
	float s_under = 0.0;
	bool s_shut = false;
	int s_cell = -1;
	vec2 s_dkx = dFdx(k_uv);
	vec2 s_dky = dFdy(k_uv);
	if (kit_shell) {
		// far shells: windows and shop openings drawn from the facade UV where no module stands (bays across, floors up)
		bool up = abs(wnrm.y) > 0.7;
		// the bay's width and the floor's height in metres, from how fast the facade UV runs along the wall
		vec3 tng = normalize(cross(vec3(0.0, 1.0, 0.0), wnrm) + vec3(1e-5, 0.0, 0.0));
		float alongw = dot(wpos, tng);
		float bay_m = clamp(length(vec2(dFdx(alongw), dFdy(alongw))) / max(length(vec2(s_dkx.x, s_dky.x)), 1e-6), 1.6, 14.0);
		float flr_m = clamp(length(vec2(dFdx(wpos.y), dFdy(wpos.y))) / max(length(vec2(s_dkx.y, s_dky.y)), 1e-6), 2.4, 6.0);
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
				// a closed rolling shutter: bare galvanised grey, or painted in one of the kit's accents (by bay)
				code = 4;
				float hs0 = hash12(vec2(floor(k_uv.x) * 1.7 + 3.0, dot(k_tint, vec3(37.0, 59.0, 11.0))));
				// (the paints Delhi shutters carry: grey blue, dull green, brown, cream; never a bright accent)
				int sp = int(hs0 * 37.0) % 4;
				vec3 sacc = sp == 0 ? vec3(0.34, 0.43, 0.52) : (sp == 1 ? vec3(0.37, 0.45, 0.37) : (sp == 2 ? vec3(0.46, 0.37, 0.3) : vec3(0.58, 0.55, 0.45)));
				srgb = hs0 < 0.45 ? vec3(0.5, 0.51, 0.5) : sacc;
				mode = 0;
			} else {
				srgb = tint;
			}
			float sdist = length(VERTEX);
			if (shell_signs > 0.001 && sdist < 120.0 && k_uv.y >= 0.0) {
				// boards, lettering and notices where a street has them: one hash set per bay and floor of this wall
				float sseed = dot(k_tint, vec3(91.0, 53.0, 17.0)) + floor(wnrm.x * 3.0 + 0.5) * 7.0 + floor(wnrm.z * 3.0 + 0.5) * 13.0;
				vec2 hk = vec2(floor(k_uv.x) + sseed, floor(k_uv.y) * 3.7 + sseed * 0.37);
				float h1 = hash12(hk);
				float h2 = hash12(hk + 17.3);
				float h3 = hash12(hk + 41.9);
				float xm = (fu - 0.5) * bay_m;
				float ym = fv * flr_m;
				s_fade = 1.0 - smoothstep(85.0, 120.0, sdist);
				if (k_uv.y < 1.0) {
					// over the shutter: a painted board or a lit box, as wide as the space under the floor band allows
					float bh = min(min(bay_m * 0.86, 2.7) * 0.25, flr_m * 0.22 - 0.1);
					float bw = bh * 4.0;
					float by0 = 0.78 * flr_m + 0.06;
					vec2 q = vec2(xm / bw + 0.5, 1.0 - (ym - by0) / bh);
					// lettering painted on the shutter, and a poster or two pasted low on it
					float lw = min(bay_m * 0.66, 2.3);
					vec2 ql = vec2(xm / lw + 0.5, 1.0 - (ym - (0.4 * flr_m - lw * 0.125)) / (lw * 0.25));
					vec2 qp = vec2((xm - (h3 - 0.5) * bay_m * 0.3) / 0.7 + 0.5, 1.0 - (ym - 0.55) / 0.35);
					// paper on the pier between two bays (a bay boundary inside the wall)
					float bnd = floor(k_uv.x + 0.5);
					float hp = hash12(vec2(bnd + sseed, 5.1));
					float pwid = min(bay_m * 0.22, 0.64);
					vec2 qn = vec2((fract(k_uv.x + 0.5) - 0.5) * bay_m / pwid + 0.5, 1.0 - (ym - (1.25 + hp * 0.5)) / (pwid * 0.5));
					if (h1 < shell_signs * 0.92 && bh > 0.3 && q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) {
						s_grp = h2 < shell_glow ? 2 : 0;
						s_q = q;
						s_hash = h3;
						s_scale = vec2(bay_m / bw, flr_m / bh);
					} else if (h1 < shell_signs * 0.92 && bh > 0.3 && q.x > -0.01 && q.x < 1.01 && q.y > 1.0 && q.y < 1.22) {
						// the board stands off the wall: its shadow on the wall and the shutter drum under it
						s_under = 1.0 - (q.y - 1.0) / 0.22;
					} else if (bnd >= 1.0 && hp < shell_signs * 0.7 && pwid > 0.4 && qn.x > 0.0 && qn.x < 1.0 && qn.y > 0.0 && qn.y < 1.0) {
						s_grp = 7;
						s_q = qn;
						s_hash = hash12(vec2(bnd + sseed, 9.3));
						s_scale = vec2(bay_m / pwid, flr_m / (pwid * 0.5));
					} else if (code == 4 && h2 > 1.0 - shell_signs * 0.6 && ql.x > 0.0 && ql.x < 1.0 && ql.y > 0.0 && ql.y < 1.0) {
						s_grp = 3;
						s_shut = true;
						s_q = ql;
						s_hash = h1;
						s_scale = vec2(bay_m / lw, flr_m / (lw * 0.25));
					} else if (code == 4 && h3 < shell_signs * 0.45 && qp.x > 0.0 && qp.x < 1.0 && qp.y > 0.0 && qp.y < 1.0) {
						s_grp = 7;
						s_q = qp;
						s_hash = h2;
						s_scale = vec2(bay_m / 0.7, flr_m / 0.35);
					}
				} else if (code != 11) {
					// upper floors: a board in the band under the window, two small boards on the pier left of it, and
					// lettering painted on the plaster over it (the stacked fronts of the photos)
					float bh = min(flr_m * 0.19, 0.6);
					float bw = min(bh * 4.0, bay_m * 0.84);
					bh = bw * 0.25;
					vec2 q = vec2(xm / bw + 0.5, 1.0 - (ym - 0.05 * flr_m) / bh);
					float sw = min(bay_m * 0.25, 0.74);
					vec2 qa = vec2((xm + 0.335 * bay_m) / sw + 0.5, 1.0 - (ym - 0.36 * flr_m) / (sw * 0.5));
					vec2 qb = vec2((xm + 0.335 * bay_m) / sw + 0.5, 1.0 - (ym - 0.56 * flr_m) / (sw * 0.5));
					float lw = min(bay_m * 0.8, 2.2);
					lw = min(lw, flr_m * 0.2 * 4.0);
					vec2 qw = vec2(xm / lw + 0.5, 1.0 - (ym - 0.77 * flr_m) / (lw * 0.25));
					if (h1 < shell_signs * 0.42 && q.x > 0.0 && q.x < 1.0 && q.y > 0.0 && q.y < 1.0) {
						s_grp = 0;
						s_q = q;
						s_hash = h2;
						s_scale = vec2(bay_m / bw, flr_m / bh);
					} else if (h2 < shell_signs * 0.5 && sw > 0.45 && qa.x > 0.0 && qa.x < 1.0 && qa.y > 0.0 && qa.y < 1.0) {
						s_grp = 6;
						s_q = qa;
						s_hash = h3;
						s_scale = vec2(bay_m / sw, flr_m / (sw * 0.5));
					} else if (h3 < shell_signs * 0.42 && sw > 0.45 && qb.x > 0.0 && qb.x < 1.0 && qb.y > 0.0 && qb.y < 1.0) {
						s_grp = 6;
						s_q = qb;
						s_hash = h1;
						s_scale = vec2(bay_m / sw, flr_m / (sw * 0.5));
					} else if (h3 > 1.0 - shell_signs * 0.3 && qw.x > 0.0 && qw.x < 1.0 && qw.y > 0.0 && qw.y < 1.0) {
						s_grp = 3;
						s_q = qw;
						s_hash = h2;
						s_scale = vec2(bay_m / lw, flr_m / (lw * 0.25));
					}
				}
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
	if (!kit_shell && code == 10 && (int(COLOR.b * 255.0 + 0.5) & 17) == 1) {
		// a piece painted or pasted on the wall (wall lettering, paper notices, the round enamel board: flag 1, white is
		// the key): the wall itself is drawn here, with its own layer, colour and grime, and the sign goes over it like
		// a sign on a shell wall (fix round 3: the keyed part was a flat patch of wall colour)
		s_grp = clamp(int(COLOR.r * 255.0 + 0.5), 0, 7);
		int slot0 = int(COLOR.g * 255.0 + 0.5);
		ivec2 G0 = SIGN_GRID[s_grp];
		s_cell = (int(k_var2 * float(G0.y) * 0.9999) + int(k_var * 7.0) * slot0 + slot0 * 3) % G0.y;
		s_q = k_uv;
		s_fade = 1.0;
		code = 0;
		mode = 1;
		srgb = tint;
		srgb = mix(srgb, vec3(dot(srgb, vec3(0.2126, 0.7152, 0.0722))), 0.35 * clamp(wear, 0.0, 1.0));
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
			vec2 auv = k_uv;
			bool goods = auv.y > 0.75 && auv.x > 0.25 && auv.x < 0.75;
			if (goods) {
				// shop goods (P2-048): one of the kit's three goods cells per bay (make_goods.mjs), so neighbours differ
				float lu = clamp(auv.x - (auv.x >= 0.5 ? 0.5 : 0.25), 0.002, 0.248);
				auv.x = 0.25 + floor(k_var2 * 2.999) * 0.25 + lu;
			}
			col = texture(kit_atlas, auv).rgb * (mode == 0 ? base / max(vec3(0.6), base) : base);
			if (goods) {
				// real goods colours, a little duller than print, darker deep in the shop and low down
				col = mix(vec3(luma(col)), col, 0.82) * (0.78 + 0.22 * (1.0 - clamp(fract(auv.y * 4.0) * 1.2, 0.0, 1.0)));
				// at night the shop's tube lights (upright on the two jambs, kit_pieces.gd tube) light them: brightest by
				// the jambs at tube height, falling off to the middle and the floor (the light the goods reflect, not a
				// glow of their own)
				float gy = fract(auv.y * 4.0);
				float gx = abs(fract((auv.x - 0.25) * 4.0) * 2.0 - 1.0);
				float tube = (0.45 + 0.55 * gx * gx) * (1.0 - 0.55 * smoothstep(0.35, 1.0, gy));
				emit = col * vec3(0.92, 0.95, 1.0) * kit_night * (0.14 + 0.5 * tube) * (0.75 + 0.3 * k_var);
			} else if (mode != 0 && auv.y > 0.5 && auv.y < 0.75 && auv.x > 0.25 && auv.x < 0.5) {
				// a door leaf (fix round 3: doors were black voids): old paint is not that dark, and at night the bulkhead
				// lamp under the lintel lights it, brightest at the top
				// (the door cell is a mid grey relief with its panels and studs: times the accent it was near black; the
				// leaf takes the accent as its paint colour)
				col = min(col * 3.6, vec3(0.8));
				float dy = (auv.y - 0.5) * 4.0;
				emit = col * vec3(1.0, 0.74, 0.46) * kit_night * (0.04 + 0.34 * pow(1.0 - dy, 2.0));
			}
			rough = 0.8;
			sk = 3;
			kg = 0.5;
		} else if (code == 10) {
			// a sign board (P2-048): the vertex colour carries its sign group (r), its slot on the piece (g) and flags (b:
			// 1 white is the wall, 2 glow box, 4 lit by a bracket lamp, 8 the lamp head); the cell is picked by bay, so
			// neighbours differ. Wear is painted into each cell (respect rule: no grime over the lettering).
			int grp = int(COLOR.r * 255.0 + 0.5);
			int slot = int(COLOR.g * 255.0 + 0.5);
			int flags = int(COLOR.b * 255.0 + 0.5);
			if ((flags & 8) != 0) {
				// the lamp head: a warm bulb under a dark shade, on at night only
				col = vec3(0.05, 0.045, 0.04);
				emit = vec3(1.0, 0.72, 0.42) * 7.0 * kit_night;
				rough = 0.4;
			} else if ((flags & 32) != 0) {
				// a shop's tube light: milky white by day, a cool white light at night
				col = vec3(0.72, 0.73, 0.7);
				emit = vec3(0.82, 0.92, 1.0) * 5.0 * kit_night;
				rough = 0.3;
			} else {
				int g8 = clamp(grp, 0, 7);
				vec4 R = SIGN_RECT[g8];
				ivec2 G = SIGN_GRID[g8];
				int cell = (int(k_var2 * float(G.y) * 0.9999) + int(k_var * 7.0) * slot + slot * 3) % G.y;
				vec2 cuv = R.xy + vec2(float(cell % G.x), float(cell / G.x)) * R.zw + clamp(k_uv, vec2(0.006), vec2(0.994)) * R.zw;
				// (a sharper mip than the default, so a far board still shows dark letters on its ground and reads as a sign)
				col = texture(kit_signs, cuv, -0.7).rgb;
				if ((flags & 16) != 0) {
					// lettering painted on a rolled-down shutter (P2-048 galis): the key is the shutter itself (the same
					// ribbed layer and bay accent the shutter under it draws), the letters a bright paint picked per bay;
					// about half the shutters carry none
					float key = smoothstep(0.86, 0.97, min(col.r, min(col.g, col.b)));
					if (k_var > 0.55) {
						key = 1.0;
					}
					vec3 sb = to_linear(acc);
					sb = max(mix(vec3(luma(sb)), sb, albedo_saturation), vec3(0.0));
					vec3 shut = sb * texture(kit_tiles, vec3(tuv, 4.0)).rgb * 2.0;
					int pc = int(k_var2 * 3.999);
					vec3 ink = pc == 0 ? vec3(0.85, 0.62, 0.08) : (pc == 1 ? vec3(0.86, 0.85, 0.8) : (pc == 2 ? vec3(0.62, 0.06, 0.04) : vec3(0.05, 0.05, 0.06)));
					col = mix(ink * (0.85 + 0.3 * vnoise(uv * 23.0)), shut, key);
					metal = 0.35 * key;
				} else if ((flags & 1) != 0) {
					// painted on the wall, a round enamel board or paper: white is the key and shows the wall
					float key = smoothstep(0.86, 0.97, min(col.r, min(col.g, col.b)));
					vec3 wallc = to_linear(tint) * (0.9 + 0.2 * fbm(uv * 0.55));
					col = mix(col, wallc, key);
				}
				if ((flags & 2) != 0 && (g8 != 4 || cell % 2 == 0)) {
					// a backlit acrylic face: glows through at night, brighter than anything it lights (WORLD_LOGIC 1)
					// exposure safe (P2-048 night round): the face keeps its colours and letters, brightest in the middle with
					// a soft falloff to the frame, never a white slab
					vec2 cq = abs(k_uv * 2.0 - 1.0);
					float mid = 1.0 - 0.35 * smoothstep(0.2, 1.0, max(cq.x, cq.y * 0.8));
					// far boxes dim (fix round 3): a small lit face a street away must not read as a lit window
					float far_k = 1.0 - 0.78 * smoothstep(28.0, 80.0, length(VERTEX));
					emit = min(col * 1.25 * mid, vec3(0.95)) * kit_night * far_k;
					// a loose tube: on a few boxes a part of the face flickers, each on its own seed and beat
					float beat = step(0.22, fract(sin(floor(TIME * 8.0 + k_var * 5.0) * 12.9898 + k_var2 * 78.233) * 43758.55));
					if (g8 == 4) {
						// far off, a lit vertical board shows as its bright column of letters only: a thin upright strip of
						// light reads as a sign blade, a lit box the size of a window reads as a window
						emit *= mix(1.0, 1.0 - smoothstep(0.16, 0.3, abs(k_uv.x - 0.5)), smoothstep(30.0, 70.0, length(VERTEX)));
						// the running border of a lit vertical board (make_signs.mjs: a dark channel with a bulb every 15 px in
						// the outer 0.115 of the width): on about seven in ten the light runs round the board at night in
						// lit and dark stretches, the others burn steady; each board on its own phase (k_var)
						vec2 eb = min(k_uv, vec2(1.0) - k_uv);
						if (eb.x < 0.115 || eb.y < 0.029) {
							float per = eb.x < 0.115 ? (k_uv.x < 0.5 ? -k_uv.y * 4.0 : k_uv.y * 4.0) : (k_uv.y < 0.5 ? k_uv.x : -k_uv.x);
							// (stretches about 0.7 m lit and 0.5 m dark, moving about 1.4 m a second: wide enough to read from
							// across the street, where one bulb is a pixel or two)
							float run = k_var > 0.15 ? step(0.42, fract(per * 0.5 - TIME * 1.2 + k_var * 7.0)) : 1.0;
							emit = (col * 2.6 + vec3(0.05, 0.035, 0.012)) * (0.03 + 0.97 * run) * kit_night * far_k * (1.0 - 0.85 * smoothstep(30.0, 70.0, length(VERTEX)));
							// (a bulb that is off is dark glass, not a pale dot in the street's light)
							col *= mix(1.0, 0.2 + 0.8 * run, kit_night);
						} else if (k_var2 > 0.8 && abs(k_uv.y - (0.3 + 0.35 * k_var)) < 0.07) {
							// one letter of a few boards flickers
							emit *= 0.15 + 0.85 * beat;
						}
					} else if (k_var2 > 0.88 && abs(k_uv.x - (0.2 + 0.6 * k_var)) < 0.16) {
						emit *= 0.25 + 0.75 * beat;
					}
				}
				if ((flags & 4) != 0) {
					// lit from above by its bracket lamp or tube light at night: bright under the lamps, falling off down
					// (exposure safe: a white flex sheet under its tubes stays a lit sheet with its print, never a white slab)
					emit = min(col * 0.72 * (1.0 - 0.62 * clamp(k_uv.y, 0.0, 1.0)), vec3(0.5)) * kit_night * (1.0 - 0.45 * smoothstep(30.0, 85.0, length(VERTEX)));
				}
				bool lit_face = ((flags & 2) != 0 && (g8 != 4 || cell % 2 == 0)) || (flags & 4) != 0;
				if (!lit_face && (flags & 17) == 0) {
					// an unlit board: its frame shades the edge (it stands off the wall), and at night it takes only the light
					// of lamps and lit boards near it (sign_pool.gdshader spill), not a flat sky fill
					vec2 eq = min(k_uv, vec2(1.0) - k_uv);
					col *= 0.72 + 0.28 * smoothstep(0.0, 0.06, min(eq.x, eq.y * 0.5));
					col *= 1.0 - 0.45 * kit_night;
				}
				rough = (flags & 2) != 0 ? 0.25 : ((flags & 16) != 0 ? 0.55 : 0.65);
			}
			sk = 3;
			kg = (flags & 16) != 0 ? 1.0 : 0.2;
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
#ifdef KIT
	if (s_under > 0.0) {
		col *= 1.0 - 0.42 * s_under * s_fade;
	}
	if (s_grp >= 0) {
		// a sign on a shell wall (fix round 3): the same cells the kit pieces hang, drawn flat on the wall or the shutter
		vec4 R = SIGN_RECT[s_grp];
		ivec2 G = SIGN_GRID[s_grp];
		int cell = s_cell >= 0 ? s_cell : int(s_hash * float(G.y) * 0.9999);
		vec2 cuv = R.xy + vec2(float(cell % G.x), float(cell / G.x)) * R.zw + clamp(s_q, vec2(0.006), vec2(0.994)) * R.zw;
		vec3 sc = textureGrad(kit_signs, cuv, s_dkx * s_scale * R.zw, s_dky * s_scale * R.zw).rgb;
		if (s_grp == 3 || s_grp == 7 || s_grp == 5) {
			// painted on the wall or the shutter, or paper pasted on it: white is the key
			float mn = min(sc.r, min(sc.g, sc.b));
			// (the atlas is a dithered palette image under block compression: its white is not always quite white)
			float key = smoothstep(0.78, 0.92, mn);
			if (s_grp == 3 || (s_grp == 7 && cell >= 6)) {
				// brushed lettering: a texel is part ink, part white; the ink's share comes from its darkest channel
				// and the ink colour is taken back out of the mix, so a far letter keeps its colour (no pale fringe)
				float a = clamp((1.0 - mn) / 0.97, 0.0, 1.0);
				sc = clamp((sc - vec3(1.0 - a)) / max(a, 0.08), vec3(0.0), vec3(1.0));
				key = 1.0 - smoothstep(0.1, 0.6, a);
			}
			if (s_shut) {
				int pc = int(s_hash * 3.999);
				vec3 ink = pc == 0 ? vec3(0.85, 0.62, 0.08) : (pc == 1 ? vec3(0.86, 0.85, 0.8) : (pc == 2 ? vec3(0.62, 0.06, 0.04) : vec3(0.05, 0.05, 0.06)));
				sc = ink * (0.8 + 0.4 * vnoise(uv * 23.0));
				// old shutter paint is thin: the ribs show through it
				key = max(key, 0.25);
			}
			col = mix(col, sc * (1.0 - 0.4 * kit_night), (1.0 - key) * s_fade);
		} else {
			// a board: its frame shades the rim, a lit box glows at night, a painted one takes only the street's light
			vec2 eq = min(s_q, vec2(1.0) - s_q) * vec2(s_grp == 6 ? 2.0 : 4.0, 1.0);
			sc *= 0.5 + 0.5 * smoothstep(0.0, 0.07, min(eq.x, eq.y));
			if (s_grp == 2) {
				vec2 cq = abs(s_q * 2.0 - 1.0);
				emit = min(sc * 1.1 * (1.0 - 0.35 * smoothstep(0.2, 1.0, max(cq.x, cq.y * 0.8))), vec3(0.9)) * kit_night * s_fade * (1.0 - 0.5 * smoothstep(35.0, 90.0, length(VERTEX)));
			} else {
				sc *= 1.0 - 0.45 * kit_night;
			}
			col = mix(col, sc, s_fade);
			rough = mix(rough, s_grp == 2 ? 0.25 : 0.65, s_fade);
			metal *= 1.0 - s_fade;
			mask *= 1.0 - s_fade;
			kg = mix(kg, 0.2, s_fade);
		}
	}
#endif
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
#ifdef KIT
			// area kits (P2-010 fix round): soft, natural grime that holds up at player height (the noise is a baked 8 bit
			// texture, so every edge is a smoothstep over a few hundredths, never a hard threshold that shows its texels)
			// rain and soot streaks under every floor band (sills, chhajjas, the parapet): the start of each streak wanders
			// and fades in, the streak darkens the paint rather than painting black
			float band = 0.4 + 3.2 * ceil((h - 0.4) / 3.2) + (vnoise(vec2(uv.x * 1.3, 7.0)) - 0.5) * 0.5;
			float below = band - h;
			float len = 0.6 + vnoise(vec2(uv.x * 2.2, 0.5)) * 2.4;
			float run = smoothstep(0.42, 0.78, vnoise(vec2(uv.x * 4.5, 2.0))) * smoothstep(0.0, 0.35, below) * (1.0 - smoothstep(0.2, len, below));
			run *= step(1.2, band) * (0.55 + 0.45 * vnoise(vec2(uv.x * 30.0, h * 1.2)));
			col = mix(col, col * vec3(0.5, 0.47, 0.42), run * 0.75 * w);
			// tea-coloured water stains, soft edged with a faint darker rim
			float sf = fbm(uv * 0.5 + 13.0);
			float stain = smoothstep(0.56, 0.66, sf);
			float rim = smoothstep(0.6, 0.64, sf) * (1.0 - smoothstep(0.66, 0.71, sf));
			col = mix(col, col * vec3(0.8, 0.72, 0.58), stain * 0.5 * w);
			col = mix(col, col * 0.72, rim * 0.35 * w);
			// peeling paint: small flakes along the wall base and under the bands, an older, darker coat or brick under them
			// (only where paint really fails: the splash zone at the base and the drip line under each band)
			float near = max(1.0 - smoothstep(0.7, 1.5, h), 1.0 - smoothstep(0.1, 0.55, below));
			float pf = fbm(uv * 2.2 + 31.0);
			float paint = step(0.12, lum) * (sk == 0 ? 1.0 : 0.0) * near;
			float peel = smoothstep(0.63, 0.66, pf) * step(0.3, h) * paint;
			float edge = smoothstep(0.6, 0.63, pf) * (1.0 - peel) * paint;
			// (from the lit wall, not the paint colour: a flake must never read paler than the wall round it)
			vec3 under = mix(vec3(luma(col)), col, 0.45) * 0.72;
			if (tex_mix > 0.0 && !brick && hash12(floor(uv * 0.35)) > 0.5) {
				under = layer(tuv, 0.96, L_BRICK).rgb * 0.75;
			}
			col = mix(col, under, peel * w);
			// a thin dirty lip round each flake
			col = mix(col, col * 0.82, edge * 0.5 * w);
			// patched plaster: soft clouds of fresher, paler lime
			float patched = smoothstep(0.6, 0.72, fbm(uv * 0.42 + 51.0)) * smoothstep(1.0, 1.6, h);
			col = mix(col, mix(vec3(luma(col)), col, 0.6) * 1.12, patched * 0.35 * w);
#else
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
#endif
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
	EMISSION = emit;
#else
	METALLIC = sk == 3 ? 0.35 : 0.0;
#endif
	SPECULAR = pbr > 0.0 ? 0.5 : 0.4;
#ifndef KIT
	// (no kit sets a backlight: leaving it out keeps the backlight term out of the kit's light loop)
	BACKLIGHT = backlight_tint * col;
#endif
}
