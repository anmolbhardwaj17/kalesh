// The inside of a roofed tunnel (P2-032): vertex colour, shaded per pixel by the two continuous LED strip lines of its
// soffit (tunnel_light.gdshaderinc: no sun, no sky, no light pools, the same at any hour). surface 0 is painted
// concrete and the fittings (a fine grain, a satin sheen), surface 1 the concrete road (UV metres along and across):
// saw cut joints every 4.5 m, aggregate, darker polished wheel tracks, oil stains and hairline cracks, the strips'
// glossy streaks along it.
shader_type spatial;
render_mode unshaded, cull_back;

uniform float light_level = 0.86;
uniform int surface = 0;
#include "res://world/infra/tunnel_light.gdshaderinc"

void vertex() {
	TUNNEL_VERTEX
}

vec3 lin(vec3 c) {
	return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

void fragment() {
	vec3 base = lin(COLOR.rgb);
	vec3 p = v_wpos;
	vec3 n = v_wnrm;
	float fade = clamp(1.0 - length(VERTEX) / 70.0, 0.0, 1.0);
	if (surface == 1) {
		vec2 uv = UV;
		float mott = t_vn(p * 0.7) * 0.6 + t_vn(p * 3.1) * 0.4;
		float grit = t_vn(p * 38.0);
		vec3 c = base * (0.86 + 0.22 * mott) * (0.94 + 0.12 * grit * fade);
		// wheel tracks: two darker, smoother bands a lane, every 3.5 m across
		float track = smoothstep(0.35, 0.0, abs(abs(fract(uv.y / 3.5) - 0.5) * 3.5 - 0.85));
		c *= 1.0 - 0.1 * track;
		// oil and rubber stains down the lane middles
		float oil = smoothstep(0.62, 0.8, t_vn(vec3(uv.x * 0.9, uv.y * 3.0, 0.0))) * smoothstep(0.6, 0.0, abs(fract(uv.y / 3.5 + 0.5) - 0.5) * 3.5);
		c *= 1.0 - 0.18 * oil;
		// saw cut joints across every 4.5 m and hairline cracks
		float jw = max(fwidth(uv.x), 1e-4);
		float joint = 1.0 - smoothstep(0.006, 0.006 + jw * 1.5, abs(fract(uv.x / 4.5 + 0.5) - 0.5) * 4.5);
		float crack = 1.0 - smoothstep(0.0, 0.006, abs(t_vn(vec3(uv * 1.3, 3.0)) - 0.5) - 0.001);
		crack *= smoothstep(0.68, 0.8, t_vn(vec3(uv * 0.2, 9.0)));
		c *= 1.0 - 0.45 * joint - 0.15 * crack * fade;
		vec3 nb = t_bump(n, p, 14.0, 0.035 * fade);
		ALBEDO = tunnel_shade(c, nb, normalize(CAMERA_POSITION_WORLD - v_wpos), v_s0, v_s1, 24.0 + 40.0 * track, 0.3 + 0.25 * track, light_level);
	} else {
		float g = (t_vn(p * 1.3) - 0.5) * 0.6 + (t_vn(p * 7.0) - 0.5) * 0.4;
		vec3 c = base * (1.0 + 0.06 * g * fade);
		vec3 nb = t_bump(n, p, 9.0, 0.02 * fade);
		ALBEDO = tunnel_shade(c, nb, normalize(CAMERA_POSITION_WORLD - v_wpos), v_s0, v_s1, 28.0, 0.22, light_level);
	}
}
