// The inside of a roofed tunnel (P2-032): vertex colour, shaded per pixel by the two continuous LED strip lines of its
// soffit and seen through the tunnel's own haze (tunnel_light.gdshaderinc: no sun, no sky, the same at any hour).
//   surface 0  fittings, kerbs, lane lines, garlands: the colour with a fine grain (COLOR.a: the share of bounce)
//   surface 1  the road (UV: metres along the run, metres across from the kerb line; COLOR.a * 4: metres to the
//              nearest kerb line): dark grey asphalt, its aggregate barely seen, darker tyre lanes, and what a decal
//              would add: a few oil stains and damp patches (the only wet sheen), sealed cracks, patch repairs,
//              manhole covers, skid marks, a little dust at the kerb; a rough, low sheen under the strips
//   surface 4  the same road under the marigold garlands (TUN-T1): a thin scatter of petals along the kerb
//   surface 2  a painted concrete wall or dado (UV: metres along, metres over its foot; COLOR.a * 8: metres left to
//              its top): panel seams, roller marks, streaks running down from the top and from the seams, a dirty
//              splashed band at the foot, a few small chips at the seams. A kerb barrier band (UV.y under -0.5:
//              -1 - metres over the foot) stays clean but for dust and tyre scuffs low down
//   surface 3  the soffit and its curve to the wall (UV: metres along, metres across; COLOR.a * 4: metres to the
//              nearest wall): board marks, water stains, soot beside the walls, darker into the corners
shader_type spatial;
render_mode unshaded, cull_back;

uniform int surface = 0;
#include "res://world/infra/tunnel_light.gdshaderinc"

void vertex() {
	TUNNEL_VERTEX
}

vec3 lin(vec3 c) {
	return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

const vec3 CONCRETE = vec3(0.36, 0.35, 0.32);
const vec3 DUST = vec3(0.3, 0.27, 0.21);
const vec3 GRIME = vec3(0.36, 0.33, 0.29);
const vec3 PETAL = vec3(0.8, 0.34, 0.03);
const vec3 PETAL_2 = vec3(0.75, 0.5, 0.05);

void fragment() {
	TUNNEL_DIRS
	vec3 base = lin(COLOR.rgb);
	vec3 n = v_wnrm;
	vec2 w = v_wpos.xz;
	float near = clamp(1.0 - t_dist / 45.0, 0.0, 1.0);
	vec3 c;
	vec3 nb = n;
	float gloss = 40.0;
	float ks = 0.08;
	float ao = COLOR.a;
	if (surface == 1 || surface == 4) {
		vec2 uv = UV;
		float edge = COLOR.a * 4.0;
		vec3 grain = t_n2d(w * 60.0);
		c = base * (0.88 + 0.24 * t_fbm(w * 0.17)) * (0.96 + 0.08 * t_n2(w * 1.7));
		c *= 1.0 + (grain.x - 0.5) * 0.16 * near;
		// tyre lanes: two darker, smoother bands a lane (3.5 m lanes from the kerb line), their edges wandering
		float lane = uv.y - 0.3 + 0.18 * (t_n2(vec2(uv.x * 0.07, 3.0)) - 0.5);
		float track = smoothstep(0.55, 0.15, abs(abs(fract(lane / 3.5) - 0.5) * 3.5 - 0.88)) * (0.6 + 0.4 * t_n2(vec2(uv.x * 0.3, floor(lane / 1.75))));
		track *= smoothstep(0.0, 0.4, edge);
		c *= 1.0 - 0.26 * track;
		// oil: a stain in about one lane cell in four (7 m cells down the lane middles), long along the lane
		vec2 oc = vec2(uv.x / 7.0, lane / 3.5);
		vec2 oid = floor(oc);
		vec2 of = (fract(oc) - 0.5) * vec2(7.0, 3.5) - (vec2(t_h2(oid + 2.0), t_h2(oid + 5.0)) - 0.5) * vec2(3.5, 0.5);
		float oil = step(0.74, t_h2(oid)) * smoothstep(1.0, 0.3, length(of * vec2(0.45, 1.5)) + 0.5 * t_n2(uv * 2.3));
		// damp: a rare broad patch, the only wet look
		float damp = smoothstep(0.67, 0.74, t_fbm(vec2(uv.x * 0.06, uv.y * 0.2) + 9.0));
		c *= 1.0 - 0.36 * oil - 0.3 * damp;
		// patch repairs: a darker square now and then with a sealed edge
		vec2 pc = vec2(uv.x / 11.0, uv.y / 3.5);
		vec2 pid = floor(pc);
		vec2 pf = (fract(pc) - 0.5) * vec2(11.0, 3.5);
		float has = step(0.88, t_h2(pid + 3.0));
		vec2 half_sz = vec2(1.0 + 1.8 * t_h2(pid), 0.7 + 0.6 * t_h2(pid + 9.0));
		float pd = max(abs(pf.x) - half_sz.x, abs(pf.y) - half_sz.y);
		c *= 1.0 - has * (0.14 * smoothstep(0.02, -0.02, pd) + 0.3 * smoothstep(0.03, 0.0, abs(pd)));
		// sealed cracks: thin dark wandering lines in a few stretches
		float crack = (1.0 - smoothstep(0.0, 0.01, abs(t_n2(uv * 0.45 + 3.0) - 0.5))) * smoothstep(0.6, 0.7, t_n2(uv * 0.06 + 9.0));
		c *= 1.0 - 0.45 * crack * (0.3 + 0.7 * near);
		// a manhole cover about every 45 m in the first lane: a cast iron disc in a dark frame
		float mk = floor(uv.x / 45.0);
		vec2 md = vec2(uv.x - (mk + 0.3 + 0.4 * t_h2(vec2(mk, 1.0))) * 45.0, uv.y - (1.2 + 3.5 * floor(t_h2(vec2(mk, 2.0)) * 2.0)));
		float mr = length(md);
		float cover = smoothstep(0.34, 0.325, mr);
		float ribs = step(0.5, fract(md.x * 9.0)) * step(0.5, fract(md.y * 9.0));
		c = mix(c, vec3(0.05, 0.05, 0.05) * (1.0 + 0.7 * ribs * near), cover);
		c *= 1.0 - 0.5 * smoothstep(0.03, 0.0, abs(mr - 0.36));
		// skid marks: a pair of thin rubber streaks in one 30 m stretch in three
		float sk = floor(uv.x / 30.0);
		float sx = uv.x - sk * 30.0;
		float sy = uv.y - (0.9 + 5.0 * t_h2(vec2(sk, 4.0)) + 0.012 * sx);
		float skid = step(0.66, t_h2(vec2(sk, 6.0))) * smoothstep(0.0, 3.0, sx) * smoothstep(16.0, 9.0, sx) * (smoothstep(0.11, 0.05, abs(sy)) + smoothstep(0.11, 0.05, abs(sy - 1.45)));
		c *= 1.0 - 0.3 * skid * (0.6 + 0.4 * t_n2(uv * vec2(1.5, 30.0)));
		// a little dust drifted to the kerb
		float drift = smoothstep(0.7, 0.05, edge + 0.4 * (t_n2(vec2(uv.x * 0.45, 1.0)) - 0.5));
		c = mix(c, DUST, drift * (0.2 + 0.25 * t_n2(w * 3.3)));
		if (surface == 4) {
			// marigold petals shed from the garlands and swept to the kerb: a thin scatter
			float strew = smoothstep(0.75, 0.05, edge) * smoothstep(0.4, 0.75, t_n2(vec2(uv.x * 0.21, 7.0)));
			vec2 cell = floor(uv * 24.0);
			vec2 cf = fract(uv * 24.0) - 0.5 - (vec2(t_h2(cell + 1.3), t_h2(cell + 7.9)) - 0.5) * 0.5;
			float petal = step(1.0 - 0.2 * strew, t_h2(cell)) * smoothstep(0.3, 0.18, length(cf * vec2(1.0, 1.0 + t_h2(cell + 2.0))));
			float fw = clamp(fwidth(uv.x) * 24.0, 0.0, 1.0);
			c = mix(c, mix(PETAL, PETAL_2, t_h2(cell + 4.0)), mix(petal, 0.05 * strew, fw));
		}
		nb = t_bend(n, grain.yz * 0.012 * near);
		// a rough, low sheen; smoother where tyres polish it, wet only on oil and damp
		gloss = 46.0 + 30.0 * track + 220.0 * oil + 60.0 * damp;
		ks = 0.06 + 0.04 * track + 0.2 * oil + 0.09 * damp + 0.2 * cover;
		ks *= 1.0 - 0.7 * drift;
		ao = mix(0.5, 1.0, smoothstep(0.0, 0.7, edge));
	} else if (surface == 2 && UV.y < -0.5) {
		// a kerb barrier band: clean paint, dust settled low, tyre scuffs along its foot
		float s = UV.x;
		float h = -UV.y - 1.0;
		c = base * (0.95 + 0.08 * t_n2(vec2(s * 0.8, h * 3.0)));
		float scuff = smoothstep(0.55, 0.8, t_n2(vec2(s * 1.1, h * 22.0))) * smoothstep(0.26, 0.04, h) * smoothstep(0.35, 0.6, t_n2(vec2(s * 0.13, 5.0)));
		c = mix(c, vec3(0.03, 0.03, 0.03), scuff * 0.7);
		c = mix(c, GRIME, smoothstep(0.12, 0.0, h) * 0.45);
		gloss = 30.0;
		ks = 0.07;
		ao = mix(0.6, 1.0, smoothstep(0.0, 0.3, h));
	} else if (surface == 2) {
		float s = UV.x;
		float h = UV.y;
		float left = COLOR.a * 8.0;
		// the paint, a step greyer, each 3 m panel its own tone, broad uneven fading, roller marks up and down
		float panel = floor(s / 3.0);
		c = mix(base, vec3(dot(base, vec3(0.3, 0.6, 0.1))), 0.18) * (0.93 + 0.1 * t_h2(vec2(panel, 3.0)));
		c *= 0.9 + 0.2 * t_fbm(vec2(s * 0.11, h * 0.3)) + 0.05 * (t_n2(vec2(s * 9.0, h * 0.6)) - 0.5);
		// panel seams: an upright joint every 3 m and a lift joint at 2.4 m
		float js = abs(mod(s + 1.5, 3.0) - 1.5);
		float jh = abs(h - 2.4);
		float jw = max(fwidth(s), 0.004);
		float seam = max(1.0 - smoothstep(0.007, 0.007 + jw, js), (1.0 - smoothstep(0.005, 0.005 + jw, jh)) * 0.7);
		c *= 1.0 - 0.5 * seam;
		// streaks running down: from the top (the trays and strips over it), each its own length, and a longer one
		// under some seams; they wander a little and thin out as they fall
		float col_id = s * 5.5 + 0.35 * t_n2(vec2(s * 0.9, h * 0.35));
		float lane_n = t_n2(vec2(col_id, 0.5));
		float reach = 0.8 + 4.2 * t_n2(vec2(s * 0.37, 8.0)) * t_n2(vec2(col_id * 0.31, 2.5));
		float run = smoothstep(0.5, 0.85, lane_n) * smoothstep(reach, reach * 0.25, left);
		float seam_run = smoothstep(0.07, 0.0, js + 0.03 * (t_n2(vec2(h * 1.3, panel)) - 0.5)) * step(0.45, t_h2(vec2(panel, 7.0))) * smoothstep(1.0 + 3.5 * t_h2(vec2(panel, 9.0)), 0.2, left);
		c = mix(c, c * GRIME, clamp(0.8 * run + 0.7 * seam_run, 0.0, 0.85));
		c *= 1.0 - 0.3 * smoothstep(1.0, 0.0, left + 0.5 * (t_n2(vec2(s * 0.8, 6.0)) - 0.5));
		// the dirty band at the foot: road spray, thrown highest where it is thrown most, streaked along the wall
		float lift = 0.35 + 0.9 * t_fbm(vec2(s * 0.19, 4.0));
		float foot = smoothstep(lift + 0.45, lift - 0.2, h) * (0.6 + 0.4 * t_n2(vec2(s * 1.3, h * 9.0)));
		c = mix(c, c * GRIME * 1.1, foot * 0.85);
		c = mix(c, DUST, smoothstep(0.22, 0.0, h) * 0.3);
		// a few small chips to the concrete, at the seams low down
		float chip = smoothstep(0.86, 0.9, t_n2(vec2(s, h) * 26.0)) * smoothstep(0.16, 0.02, js) * smoothstep(1.6, 0.2, h) * near;
		c = mix(c, CONCRETE, chip * 0.8);
		vec3 g = t_n2d(vec2(s, h) * 17.0);
		nb = t_bend(n, g.yz * 0.03 * near);
		gloss = 26.0;
		ks = 0.07;
		ao = mix(0.55, 1.0, smoothstep(0.0, 0.9, h)) * mix(0.72, 1.0, smoothstep(0.0, 0.7, left));
	} else if (surface == 3) {
		float s = UV.x;
		float wall = COLOR.a * 4.0;
		// paint over board-marked concrete: a board line every 1.2 m along, pours of slightly different tone
		c = mix(base, vec3(dot(base, vec3(0.3, 0.6, 0.1))), 0.25) * (0.92 + 0.08 * t_h2(vec2(floor(s / 7.2), 5.0)));
		c *= 0.92 + 0.16 * t_fbm(w * 0.21);
		float jb = abs(mod(s + 0.6, 1.2) - 0.6);
		float jp = abs(mod(s + 3.6, 7.2) - 3.6);
		float jw = max(fwidth(s), 0.004);
		c *= 1.0 - 0.1 * (1.0 - smoothstep(0.006, 0.006 + jw, jb)) - 0.35 * (1.0 - smoothstep(0.012, 0.012 + jw, jp));
		// water stains: a few ringed blotches, seepage along some pour joints, soot along the walls
		float stain = t_fbm(w * 0.2 + 31.0);
		float ring = smoothstep(0.02, 0.0, abs(stain - 0.7)) * 0.5;
		float seep = smoothstep(0.5, 0.0, jp + 0.3 * t_n2(w * 0.8)) * smoothstep(0.5, 0.75, t_n2(vec2(floor((s + 3.6) / 7.2), 3.0) + w * 0.12));
		c *= 1.0 - 0.13 * smoothstep(0.62, 0.8, stain) - 0.1 * ring - 0.3 * seep;
		c = mix(c, c * GRIME * 1.2, smoothstep(1.6, 0.0, wall + 0.8 * (t_n2(vec2(s * 0.4, 9.0)) - 0.5)) * 0.75);
		vec3 g = t_n2d(w * 15.0);
		nb = t_bend(n, g.yz * 0.03 * near);
		gloss = 18.0;
		ks = 0.04;
		ao = mix(0.6, 1.0, smoothstep(0.0, 1.3, wall));
	} else {
		float g = t_n2(v_wpos.xz * 9.0 + v_wpos.y * 7.0) - 0.5;
		c = base * (1.0 + 0.1 * g * near) * (0.84 + 0.2 * t_fbm(v_wpos.xz * 1.3 + v_wpos.y * 0.9));
		// dust settled on what faces up, a little grime on everything, streaks down what stands upright
		c = mix(c, DUST, 0.2 * max(n.y, 0.0) + 0.05);
		float run = smoothstep(0.5, 0.85, t_n2(vec2((v_wpos.x * n.z - v_wpos.z * n.x) * 7.0, v_wpos.y * 0.5)));
		c = mix(c, c * GRIME, 0.45 * run * (1.0 - abs(n.y)));
		gloss = 30.0;
		ks = 0.1;
	}
	ALBEDO = tunnel_out(tunnel_shade(c, nb, t_v, v_s0, v_s1, t_d0, t_d1, gloss, ks, ao), t_dist);
	FOG = vec4(0.0);
}
