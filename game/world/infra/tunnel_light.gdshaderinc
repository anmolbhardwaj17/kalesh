// The light inside a roofed tunnel (P2-032), shared by tunnel_lit.gdshader, tunnel_mural_inside.gdshader and
// tunnel_glow.gdshader. The two continuous LED strip lines on the soffit are the only light: no sun, no sky ambient,
// no point lights, so the same at any hour (`exposure_comp` takes the scene's exposure back out, infra.gd tick).
// Each vertex carries the vectors to the nearest points of its two strips (CUSTOM0 and CUSTOM1,
// game/world/infra/kit_tunnel_light.gd); they interpolate exactly, so every pixel is shaded from them:
//   - diffuse from a line source (cos over distance, soft): bright under the soffit and on the upper wall, falling
//     off down the wall; a face along the tunnel gets only the bounce
//   - a low warm bounce, darker in corners and at the foot of a wall (the `ao` the surface gives)
//   - the reflection of each strip as a streak: the strip's direction comes from the screen derivatives of its
//     vector, the brightest point of the line for the mirror direction gives a long streak on the road and a sheen
//     on paint, stronger at a grazing look (Fresnel)
//   - the glow round a strip on the soffit
//   - a warm haze of the tunnel's own (the scene's fog is switched off for these pixels): the far end goes darker
//     and warmer, the strips fade with distance
// The including shader puts TUNNEL_VERTEX in its vertex(), TUNNEL_DIRS at the top of its fragment(), calls
// tunnel_shade() and then tunnel_out().
uniform float light_level = 1.0;
uniform float exposure_comp = 1.0;

varying vec4 v_s0;
varying vec4 v_s1;
varying vec3 v_wpos;
varying vec3 v_wnrm;

const vec3 T_LIGHT = vec3(1.0, 0.92, 0.78);
const vec3 T_BOUNCE = vec3(1.0, 0.86, 0.66);
const float T_AMBIENT = 0.085;
const float T_DOWN_BOUNCE = 0.2;
const float T_GAIN = 0.95;
const float T_HALO = 0.42;
const vec3 T_HAZE = vec3(0.15, 0.1, 0.05);
const float T_HAZE_DENSITY = 0.0058;

// the vertex() body of an including shader: world position, normal and the two strip vectors (local frame turned)
#define TUNNEL_VERTEX v_wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; v_wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz); v_s0 = vec4((MODEL_MATRIX * vec4(CUSTOM0.xyz, 0.0)).xyz, CUSTOM0.w); v_s1 = vec4((MODEL_MATRIX * vec4(CUSTOM1.xyz, 0.0)).xyz, CUSTOM1.w);

// the top of the fragment() body of an including shader: the directions of the two strip lines at the pixel (t_d0,
// t_d1), the unit vector to the camera (t_v) and the distance to it (t_dist)
#define TUNNEL_DIRS mat3 t_iv = mat3(INV_VIEW_MATRIX); vec3 t_px = t_iv * dFdx(VERTEX); vec3 t_py = t_iv * dFdy(VERTEX); vec3 t_d0 = t_dir(v_s0.xyz, dFdx(v_s0.xyz) + t_px, dFdy(v_s0.xyz) + t_py); vec3 t_d1 = t_dir(v_s1.xyz, dFdx(v_s1.xyz) + t_px, dFdy(v_s1.xyz) + t_py); vec3 t_v = normalize(CAMERA_POSITION_WORLD - v_wpos); float t_dist = length(VERTEX);

float t_h2(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

float t_n2(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(t_h2(i), t_h2(i + vec2(1.0, 0.0)), f.x), mix(t_h2(i + vec2(0.0, 1.0)), t_h2(i + vec2(1.0, 1.0)), f.x), f.y);
}

// value noise with its gradient: (value, d/dx, d/dy)
vec3 t_n2d(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	vec2 du = 6.0 * f * (1.0 - f);
	float a = t_h2(i);
	float b = t_h2(i + vec2(1.0, 0.0));
	float c = t_h2(i + vec2(0.0, 1.0));
	float d = t_h2(i + vec2(1.0, 1.0));
	return vec3(a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y, du * (vec2(b - a, c - a) + (a - b - c + d) * u.yx));
}

float t_fbm(vec2 p) {
	return t_n2(p) * 0.55 + t_n2(p * 2.07 + 3.1) * 0.3 + t_n2(p * 4.3 + 7.7) * 0.15;
}

// the normal bent by a grain: `g` the grain's gradient along two directions of the surface (any two at right angles),
// about the world axes most across the normal
vec3 t_bend(vec3 n, vec2 g) {
	vec3 t = normalize(abs(n.y) > 0.7 ? vec3(1.0, 0.0, 0.0) - n * n.x : vec3(0.0, 1.0, 0.0) - n * n.y);
	vec3 b = cross(n, t);
	return normalize(n - t * g.x - b * g.y);
}

// the unit direction of a strip line: its vector s changes along the line only, so s' + p' is along the line
vec3 t_dir(vec3 s, vec3 ax, vec3 ay) {
	vec3 a = dot(ax, ax) > dot(ay, ay) ? ax : ay;
	float l = length(a);
	// too little to tell (the pixel's footprint lies across the line): level and at right angles to s
	vec3 flat_dir = vec3(-s.z, 0.0, s.x);
	return l > 1e-6 ? a / l : normalize(flat_dir + vec3(1e-5, 0.0, 0.0));
}

void t_strip(vec4 s, vec3 d, vec3 n, vec3 r, float gloss, inout float e, inout float halo, inout float spec) {
	if (s.w < 0.5) {
		return;
	}
	float dist = max(length(s.xyz), 0.05);
	vec3 l = s.xyz / dist;
	float emit = sqrt(max(l.y, 0.0));
	e += max(dot(n, l), 0.0) * emit / max(dist, 0.3);
	halo += exp(-dist / 0.45);
	// the point of the line nearest the mirror direction (the line runs on: a long streak)
	float rd = dot(r, d);
	float t = clamp(dot(r, s.xyz) * rd / max(1.0 - rd * rd, 1e-3), -70.0, 70.0);
	vec3 m = s.xyz + d * t;
	float ml = max(length(m), 0.05);
	m /= ml;
	float up = smoothstep(0.02, 0.2, m.y) * step(0.0, dot(n, m));
	spec += pow(max(dot(r, m), 0.0), gloss) * up / (1.0 + 0.02 * ml);
}

// albedo (linear) lit by the strips at the pixel: n the (bent) world normal, v the unit vector to the camera, s0 and
// s1 the strip vectors (v_s0, v_s1) with their directions d0 and d1, gloss the reflection's sharpness, ks its
// strength, ao the share of the bounce that reaches the pixel (1 in the open, less in a corner)
vec3 tunnel_shade(vec3 albedo, vec3 n, vec3 v, vec4 s0, vec4 s1, vec3 d0, vec3 d1, float gloss, float ks, float ao) {
	float e = 0.0;
	float halo = 0.0;
	float spec = 0.0;
	vec3 r = reflect(-v, n);
	t_strip(s0, d0, n, r, gloss, e, halo, spec);
	t_strip(s1, d1, n, r, gloss, e, halo, spec);
	float direct = T_GAIN * pow(e, 0.72);
	direct = 1.9 * (1.0 - exp(-direct / 1.9));
	vec3 light = T_BOUNCE * ((T_AMBIENT + T_DOWN_BOUNCE * max(-n.y, 0.0)) * ao) + T_LIGHT * (direct * mix(1.0, ao, 0.65) + T_HALO * min(halo, 1.0) * max(-n.y, 0.0));
	float fres = 0.05 + 0.95 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
	return albedo * light + T_LIGHT * (min(spec, 1.5) * ks * mix(0.35, 1.0, fres) * mix(0.5, 1.0, ao));
}

// the lit colour through the tunnel's haze at `dist` metres, at the tunnel's own exposure
vec3 tunnel_out(vec3 col, float dist) {
	float f = 1.0 - exp(-dist * T_HAZE_DENSITY);
	return mix(col, T_HAZE, f) * (light_level * exposure_comp);
}
