// The light inside a roofed tunnel (P2-032 attempt 2), shared by tunnel_lit.gdshader and tunnel_mural_inside.gdshader.
// The two continuous LED strip lines on the soffit are the only light: no sun, no sky ambient, no point lights, so
// the same at any hour. Each vertex carries the vectors to the nearest points of its two strips (CUSTOM0 and CUSTOM1,
// game/world/infra/kit_tunnel_light.gd); they interpolate exactly, so every pixel is shaded from them: diffuse from a
// line source (cos over distance; a face along the tunnel gets only the bounce), the glossy streak of each strip on the
// paint and the road, the glow round a strip on the soffit, and a bump of the surface's grain.
// The including shader declares `light_level`, puts TUNNEL_VERTEX in its vertex() and calls tunnel_shade() from its
// fragment() with the varyings.
varying vec4 v_s0;
varying vec4 v_s1;
varying vec3 v_wpos;
varying vec3 v_wnrm;

const float T_AMBIENT = 0.34;
const float T_DOWN_BOUNCE = 0.16;
const float T_GAIN = 1.45;
const float T_SOFT = 1.2;
const float T_HALO = 0.45;
const vec3 T_STRIP = vec3(1.0, 0.98, 0.94);

// the vertex() body of an including shader: world position, normal and the two strip vectors (local frame turned)
#define TUNNEL_VERTEX v_wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; v_wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz); v_s0 = vec4((MODEL_MATRIX * vec4(CUSTOM0.xyz, 0.0)).xyz, CUSTOM0.w); v_s1 = vec4((MODEL_MATRIX * vec4(CUSTOM1.xyz, 0.0)).xyz, CUSTOM1.w);

float t_h3(vec3 p) {
	return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}

float t_vn(vec3 p) {
	vec3 i = floor(p);
	vec3 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	float a = mix(mix(t_h3(i), t_h3(i + vec3(1, 0, 0)), f.x), mix(t_h3(i + vec3(0, 1, 0)), t_h3(i + vec3(1, 1, 0)), f.x), f.y);
	float b = mix(mix(t_h3(i + vec3(0, 0, 1)), t_h3(i + vec3(1, 0, 1)), f.x), mix(t_h3(i + vec3(0, 1, 1)), t_h3(i + vec3(1, 1, 1)), f.x), f.y);
	return mix(a, b, f.z);
}

// the normal bent by a grain of `scale` per metre and `amount` (finite differences of the noise, on the surface)
vec3 t_bump(vec3 n, vec3 p, float scale, float amount) {
	float e = 0.35 / scale;
	float h0 = t_vn(p * scale);
	vec3 g = vec3(t_vn((p + vec3(e, 0, 0)) * scale) - h0, t_vn((p + vec3(0, e, 0)) * scale) - h0, t_vn((p + vec3(0, 0, e)) * scale) - h0) / e;
	g -= n * dot(g, n);
	return normalize(n - g * amount / scale);
}

void t_strip(vec4 s, vec3 n, vec3 v, float gloss, inout float e, inout float halo, inout float spec) {
	if (s.w < 0.5) {
		return;
	}
	float r = max(length(s.xyz), 0.05);
	vec3 l = s.xyz / r;
	float emit = sqrt(max(l.y, 0.0));
	e += max(dot(n, l), 0.0) * emit / max(r, 0.25);
	halo += exp(-r / 0.55);
	vec3 h = normalize(l + v);
	spec += pow(max(dot(n, h), 0.0), gloss) * emit * max(dot(n, l), 0.0) / (1.0 + 0.12 * r);
}

// albedo (linear) lit by the strips at the pixel: n the (bumped) world normal, v the unit vector to the camera, s0 and
// s1 the strip vectors (v_s0, v_s1), gloss the highlight's sharpness, ks its strength
vec3 tunnel_shade(vec3 albedo, vec3 n, vec3 v, vec4 s0, vec4 s1, float gloss, float ks, float level) {
	float e = 0.0;
	float halo = 0.0;
	float spec = 0.0;
	t_strip(s0, n, v, gloss, e, halo, spec);
	t_strip(s1, n, v, gloss, e, halo, spec);
	float light = T_AMBIENT + T_DOWN_BOUNCE * max(-n.y, 0.0) + T_GAIN * (1.0 - exp(-T_SOFT * e)) + T_HALO * min(halo, 1.0);
	// glossier at a grazing look (the strips' streaks far down the road, owner photo 02)
	float fres = 0.25 + 0.75 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
	return (albedo * light + T_STRIP * spec * ks * fres * (gloss + 8.0) / 12.0) * level;
}
