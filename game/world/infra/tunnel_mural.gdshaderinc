// The art of the Pragati Maidan tunnel murals (P2-032), shared by tunnel_mural.gdshader (lit by the scene: the open
// ramps) and tunnel_mural_inside.gdshader (inside a roofed tunnel: lit by its LED strip lines per pixel, VERTEX_LIGHT,
// tunnel_light.gdshaderinc). From the owner's photos (harness/design/reference/owner/pragati_maidan_tunnel/): paint
// brushed by hand on concrete, not clean vector art. Shape edges wobble a little, every colour carries brush streaks
// and a slight shift from motif to motif, the concrete shows through in flecks, the wall has its panel joints every
// 6 m and some grime at its foot. UV.x is metres along the wall run, UV.y metres over the road.
//   kind 0  inside: a yellow wall with a flowing green wave band between ochre borders with white and red dots; the
//           band's motifs change every 16 m (leaves and birds, Madhubani fish, flowers on a vine, Warli dancers)
//   kind 1  the ramp walls: cream with grey-blue dandelion discs, a blue river band with white curls, pink lotus,
//           white and brown swans, trees of three kinds (banyan, teal cypress, sapling), a saffron band with a scalloped
//           edge and a white line under the coping (COLOR.r * 16 is the height left to the wall top): the tricolour
//           with the kit's green base
//   kind 2  a pillar of the wide section: its colour (COLOR.rgb) with a mandala and borders (UV.x across the face,
//           0 to 1.1 on the front; a side face has UV.x from 3)
uniform int kind = 0;
uniform float roughness_base = 0.75;

const vec3 YELLOW = vec3(0.925, 0.776, 0.165);
const vec3 OCHRE = vec3(0.827, 0.604, 0.09);
const vec3 GREEN = vec3(0.184, 0.541, 0.235);
const vec3 LEAF = vec3(0.47, 0.72, 0.28);
const vec3 WHITE = vec3(0.95, 0.94, 0.91);
const vec3 RED = vec3(0.78, 0.16, 0.16);
const vec3 INK = vec3(0.1, 0.09, 0.08);
const vec3 ORANGE = vec3(0.93, 0.5, 0.13);
const vec3 PINK = vec3(0.91, 0.47, 0.6);
const vec3 CREAM = vec3(0.937, 0.902, 0.784);
const vec3 DISC = vec3(0.62, 0.7, 0.76);
const vec3 BLUE = vec3(0.176, 0.388, 0.678);
const vec3 SKY = vec3(0.56, 0.75, 0.886);
const vec3 SAFFRON = vec3(0.941, 0.478, 0.165);
const vec3 LOTUS = vec3(0.886, 0.365, 0.612);
const vec3 TREE = vec3(0.247, 0.49, 0.227);
const vec3 TREE_DARK = vec3(0.13, 0.3, 0.15);
const vec3 TEAL = vec3(0.16, 0.5, 0.52);
const vec3 TRUNK = vec3(0.42, 0.29, 0.18);
const vec3 BROWN = vec3(0.45, 0.25, 0.16);
const vec3 CONCRETE = vec3(0.66, 0.65, 0.62);

float fill(float d) {
	// 1 inside (d < 0), anti-aliased over a little more than a pixel (a brushed edge, never a vector edge)
	float w = max(fwidth(d) * 1.2, 1e-4);
	return 1.0 - smoothstep(-w, w, d);
}

vec3 to_linear(vec3 c) {
	return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

float hash(float n) {
	return fract(sin(n * 12.9898) * 43758.5453);
}

float hash2(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
	return vnoise(p) * 0.55 + vnoise(p * 2.03 + 7.1) * 0.3 + vnoise(p * 4.1 + 3.3) * 0.15;
}

// a hand's wobble: shapes are drawn on a slightly warped plane (about 1.5 cm)
vec2 hand(vec2 p) {
	return p + (vec2(vnoise(p * 6.0), vnoise(p * 6.0 + 31.7)) - 0.5) * 0.03;
}

float seg(vec2 p, vec2 a, vec2 b) {
	vec2 pa = p - a;
	vec2 ba = b - a;
	float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
	return length(pa - ba * h);
}

float tri(vec2 p, vec2 p0, vec2 p1, vec2 p2) {
	vec2 e0 = p1 - p0;
	vec2 e1 = p2 - p1;
	vec2 e2 = p0 - p2;
	vec2 v0 = p - p0;
	vec2 v1 = p - p1;
	vec2 v2 = p - p2;
	vec2 q0 = v0 - e0 * clamp(dot(v0, e0) / dot(e0, e0), 0.0, 1.0);
	vec2 q1 = v1 - e1 * clamp(dot(v1, e1) / dot(e1, e1), 0.0, 1.0);
	vec2 q2 = v2 - e2 * clamp(dot(v2, e2) / dot(e2, e2), 0.0, 1.0);
	float s = sign(e0.x * e2.y - e0.y * e2.x);
	vec2 d = min(min(vec2(dot(q0, q0), s * (v0.x * e0.y - v0.y * e0.x)), vec2(dot(q1, q1), s * (v1.x * e1.y - v1.y * e1.x))), vec2(dot(q2, q2), s * (v2.x * e2.y - v2.y * e2.x)));
	return -sqrt(d.x) * sign(d.y);
}

// a leaf: an ellipse pointed at both ends, along direction a
float leaf(vec2 p, vec2 c, float a, float len, float wid) {
	vec2 d = p - c;
	vec2 q = vec2(cos(a) * d.x + sin(a) * d.y, -sin(a) * d.x + cos(a) * d.y);
	float t = clamp(q.x / len, -1.0, 1.0);
	return abs(q.y) - wid * (1.0 - t * t);
}

// a flying bird: two short arcs as a "v"
float bird(vec2 p, vec2 c, float s) {
	vec2 d = (p - c) / s;
	d.x = abs(d.x);
	float y = 0.35 * d.x - 0.25 * d.x * d.x;
	return (abs(d.y - y) - 0.07) * s + max(d.x - 1.0, 0.0) * s;
}

// a Madhubani fish (local q, nose at -x): body, tail, eye; returns the body distance, the eye in .y
vec2 fish(vec2 q) {
	float body = (length(q * vec2(1.0 / 0.22, 1.0 / 0.085)) - 1.0) * 0.085;
	float tail = tri(q, vec2(0.18, 0.0), vec2(0.33, 0.09), vec2(0.33, -0.09));
	float eye = length(q - vec2(-0.13, 0.015)) - 0.018;
	return vec2(min(body, tail), eye);
}

// a Warli dancer (local q, feet at the origin, about 0.55 m tall), arms up when `up`
float warli(vec2 q, float up) {
	float d = length(q - vec2(0.0, 0.47)) - 0.055;
	d = min(d, tri(q, vec2(-0.09, 0.4), vec2(0.09, 0.4), vec2(0.0, 0.255)));
	d = min(d, tri(q, vec2(0.0, 0.255), vec2(-0.08, 0.12), vec2(0.08, 0.12)));
	float limbs = min(seg(q, vec2(-0.04, 0.13), vec2(-0.1, 0.0)), seg(q, vec2(0.04, 0.13), vec2(0.11, 0.0)));
	vec2 hl = vec2(-0.2, 0.3 + 0.12 * up);
	vec2 hr = vec2(0.2, 0.3 + 0.12 * (1.0 - up));
	limbs = min(limbs, min(seg(q, vec2(-0.08, 0.39), vec2(-0.15, 0.31)), seg(q, vec2(-0.15, 0.31), hl)));
	limbs = min(limbs, min(seg(q, vec2(0.08, 0.39), vec2(0.15, 0.31)), seg(q, vec2(0.15, 0.31), hr)));
	return min(d, limbs - 0.013);
}

// brush streaks, a colour shift per motif cell and flecks of the concrete showing through
vec3 brushed(vec3 col, vec2 uv, float cell, bool upright) {
	float streak = (upright ? vnoise(vec2(uv.x * 24.0, uv.y * 1.4 + cell)) : vnoise(vec2(uv.x * 1.4 + cell, uv.y * 24.0))) - 0.5;
	float mottle = fbm(uv * 2.2) - 0.5;
	col *= 1.0 + streak * (upright ? 0.06 : 0.1) + mottle * 0.09;
	col *= vec3(1.0) + (vec3(hash(cell), hash(cell + 1.7), hash(cell + 3.1)) - 0.5) * 0.07;
	float fleck = smoothstep(0.82, 0.9, vnoise(uv * vec2(38.0, 52.0))) * smoothstep(0.55, 0.75, vnoise(uv * 3.0 + 11.0));
	return mix(col, CONCRETE, fleck * 0.45);
}

// the wall itself: panel joints every 6 m and grime at its foot
vec3 concrete(vec3 col, vec2 uv) {
	float j = abs(mod(uv.x + 3.0, 6.0) - 3.0);
	col *= 1.0 - 0.38 * fill(j - 0.009) - 0.08 * fill(j - 0.04);
	float foot = smoothstep(1.4, 0.55, uv.y + 0.35 * (fbm(vec2(uv.x * 1.5, 0.0)) - 0.5));
	float drips = smoothstep(0.62, 0.95, vnoise(vec2(uv.x * 5.0, uv.y * 0.5))) * smoothstep(2.6, 0.8, uv.y);
	return col * (1.0 - 0.2 * foot - 0.1 * drips);
}

vec3 inside(vec2 uv0) {
	vec2 uv = hand(uv0);
	float s = uv.x;
	float y = uv.y;
	float c = 2.4 + 0.55 * sin(s * 0.33) + 0.2 * sin(s * 0.9);
	float d = abs(y - c);
	vec3 col = YELLOW;
	col = mix(col, OCHRE, fill(d - 0.62));
	col = mix(col, GREEN * (0.92 + 0.16 * vnoise(vec2(s * 0.7, y * 3.0))), fill(d - 0.48));
	// a thin white line and dots on both ochre borders
	col = mix(col, WHITE, fill(abs(d - 0.5) - 0.012));
	for (int side = -1; side <= 1; side += 2) {
		float by = c + float(side) * 0.56;
		float k = floor(s / 0.32);
		vec2 dc = vec2((k + 0.5) * 0.32, by);
		float r = length(vec2(s, y) - dc) - 0.05 - 0.01 * hash(k);
		col = mix(col, mod(k, 3.0) < 1.0 ? RED : WHITE, fill(r));
	}
	// the band's motif changes every 16 m
	float panel = floor(s / 16.0);
	float theme = mod(panel, 4.0);
	float inb = step(d, 0.46);
	if (theme < 1.0) {
		// leaves and white and red birds
		float cell = floor(s / 0.9);
		vec2 lc = vec2((cell + 0.5) * 0.9, c + (hash(cell) - 0.5) * 0.4);
		float la = (hash(cell + 7.0) - 0.5) * 1.6;
		float lf = leaf(vec2(s, y), lc, la, 0.26, 0.09);
		col = mix(col, LEAF * (0.9 + 0.2 * hash(cell + 2.0)), fill(lf) * inb);
		col = mix(col, TREE_DARK, fill(abs(lf) - 0.008) * inb);
		float bc = floor(s / 1.8);
		vec2 bp = vec2((bc + 0.3) * 1.8, c + 0.2 * sin(bc * 3.1));
		col = mix(col, mod(bc, 3.0) < 1.0 ? RED : WHITE, fill(bird(vec2(s, y), bp, 0.18 + 0.08 * hash(bc))) * inb);
	} else if (theme < 2.0) {
		// Madhubani fish, nose to tail, outlined in ink and hatched
		float cell = floor(s / 1.1);
		float dir = mod(cell, 2.0) < 1.0 ? 1.0 : -1.0;
		vec2 q = (vec2(s, y) - vec2((cell + 0.5) * 1.1, c + 0.1 * sin(cell * 2.3))) * vec2(dir, 1.0);
		vec2 f = fish(q);
		vec3 fc = mod(cell, 3.0) < 1.0 ? ORANGE : (mod(cell, 3.0) < 2.0 ? YELLOW : PINK);
		float hatch = step(0.5, fract((q.x + q.y) * 16.0));
		col = mix(col, fc * (0.88 + 0.12 * hatch), fill(f.x) * inb);
		col = mix(col, INK, fill(abs(f.x) - 0.01) * inb);
		col = mix(col, INK, fill(f.y) * inb);
	} else if (theme < 3.0) {
		// flowers on a vine
		float vy = c + 0.16 * sin(s * 2.6);
		col = mix(col, TREE_DARK, fill(abs(y - vy) - 0.014) * inb);
		float cell = floor(s / 0.6);
		vec2 fc = vec2((cell + 0.5) * 0.6, c + 0.16 * sin((cell + 0.5) * 0.6 * 2.6) + (mod(cell, 2.0) < 1.0 ? 0.2 : -0.2));
		vec2 dp = vec2(s, y) - fc;
		float th = atan(dp.y, dp.x);
		float pet = length(dp) - 0.12 * (0.55 + 0.45 * abs(cos(2.5 * th + cell)));
		col = mix(col, mod(cell, 2.0) < 1.0 ? WHITE : PINK, fill(pet) * inb);
		col = mix(col, INK, fill(abs(pet) - 0.007) * inb);
		col = mix(col, YELLOW, fill(length(dp) - 0.03) * inb);
		col = mix(col, LEAF, fill(leaf(vec2(s, y), vec2(fc.x + 0.3, vy), 0.6 * sin(cell), 0.12, 0.045)) * inb);
	} else {
		// Warli dancers in white, hand in hand
		float cell = floor(s / 0.45);
		vec2 q = vec2(s, y) - vec2((cell + 0.5) * 0.45, c - 0.3);
		col = mix(col, WHITE, fill(warli(q, mod(cell, 2.0))) * inb);
		col = mix(col, WHITE, fill(abs(y - (c - 0.36)) - 0.01) * inb);
	}
	// small white flowers here and there on the yellow over the band
	float fk = floor(s / 2.3);
	vec2 sp = vec2((fk + hash(fk)) * 2.3, c + 0.95 + 0.4 * hash(fk + 4.0));
	vec2 sd = vec2(s, y) - sp;
	float sth = atan(sd.y, sd.x);
	float sm = length(sd) - 0.07 * (0.6 + 0.4 * abs(cos(2.5 * sth)));
	col = mix(col, mod(fk, 2.0) < 1.0 ? RED : WHITE, fill(sm) * step(0.7, d));
	col = brushed(col, uv0, panel * 3.0 + floor(s / 1.2), false);
	return concrete(col, uv0);
}

vec3 tree(vec3 col, vec2 p, vec2 tp, float k) {
	float t = mod(k, 3.0);
	if (t < 1.0) {
		// a banyan: trunk, a broad crown of dark leaf blobs, hanging roots
		col = mix(col, TRUNK, fill(max(abs(p.x - tp.x) - 0.1, abs(p.y - (tp.y - 0.75)) - 0.75)));
		float crown = length((p - tp) * vec2(0.75, 1.15)) - 0.75;
		col = mix(col, TREE, fill(crown));
		for (int i = 0; i < 7; i++) {
			float a = float(i) * 0.898;
			col = mix(col, TREE_DARK, fill(length(p - tp - vec2(cos(a) * 0.55, sin(a) * 0.4)) - 0.15));
		}
		float root = abs(fract((p.x - tp.x) * 4.0) - 0.5) - 0.06;
		col = mix(col, TRUNK, fill(root) * step(abs(p.x - tp.x), 0.8) * step(tp.y - 1.3, p.y) * step(p.y, tp.y - 0.35) * step(0.3, abs(p.x - tp.x)));
	} else if (t < 2.0) {
		// teal cypresses, three side by side
		for (int i = 0; i < 3; i++) {
			vec2 c0 = tp + vec2(float(i - 1) * 0.42, -0.2 + 0.15 * float(i % 2));
			float h = tri(p, c0 + vec2(-0.2, -0.75), c0 + vec2(0.2, -0.75), c0 + vec2(0.0, 0.85));
			col = mix(col, i == 1 ? TEAL * 0.8 : TEAL, fill(h));
			col = mix(col, WHITE * 0.85, fill(abs(h + 0.06) - 0.006) * step(p.y, c0.y + 0.6));
		}
	} else {
		// a sapling: a thin trunk and a small round crown
		col = mix(col, TRUNK, fill(max(abs(p.x - tp.x) - 0.04, abs(p.y - (tp.y - 0.65)) - 0.6)));
		float crown = length((p - tp - vec2(0.0, 0.1)) * vec2(1.0, 0.9)) - 0.4;
		col = mix(col, LEAF * 0.85, fill(crown));
		col = mix(col, TREE_DARK, fill(abs(crown) - 0.01));
	}
	return col;
}

vec3 ramp(vec2 uv0, float left) {
	vec2 uv = hand(uv0);
	float s = uv.x;
	float y = uv.y;
	vec2 p = vec2(s, y);
	vec3 col = CREAM;
	// grey-blue dandelion discs on a staggered 0.9 m grid, over the river
	vec2 g = vec2(s + 0.45 * mod(floor(y / 0.9), 2.0), y) / 0.9;
	vec2 gc = (floor(g) + 0.5) * 0.9 - vec2(0.45 * mod(floor(y / 0.9), 2.0), 0.0);
	vec2 dp = p - gc;
	float th = atan(dp.y, dp.x);
	float rr = length(dp);
	float spokes = (abs(fract(th * 2.546) - 0.5) - 0.18) * rr;
	float on = step(2.05, y) * step(0.45, hash2(floor(g)));
	col = mix(col, DISC, fill(max(rr - 0.3, spokes)) * on);
	col = mix(col, DISC * 0.8, fill(abs(rr - 0.3) - 0.01) * on);
	col = mix(col, DISC * 0.7, fill(rr - 0.05) * on);
	// the river: a blue band with white curls
	float rc = 1.35 + 0.22 * sin(s * 0.5);
	float rd = abs(y - rc);
	col = mix(col, BLUE, fill(rd - 0.38));
	float rip = abs(sin((s * 2.2 + sin(y * 9.0 + s) * 0.6))) - 0.25;
	col = mix(col, SKY, fill(rip) * fill(rd - 0.3) * step(0.08, rd));
	float ck = floor(s / 1.3);
	vec2 cc = vec2((ck + 0.5) * 1.3, rc + 0.12 * sin(ck));
	float curl = abs(length(p - cc) - 0.1) - 0.012;
	col = mix(col, WHITE, fill(max(curl, -(p.y - cc.y))) * fill(rd - 0.36));
	// a lotus every 18 m: petals over two leaves on the water
	float lk = floor(s / 18.0);
	vec2 lp = vec2(lk * 18.0 + 6.0, 2.15);
	vec2 ld = p - lp;
	float lth = atan(ld.y, ld.x);
	float lotus = length(ld) - (0.36 + 0.24 * abs(cos(3.5 * lth))) * step(0.0, ld.y + 0.05);
	col = mix(col, LOTUS, fill(lotus));
	col = mix(col, PINK * 1.1, fill(lotus + 0.12) * step(0.0, ld.y));
	col = mix(col, LOTUS * 0.6, fill(abs(lotus) - 0.01));
	col = mix(col, TREE, fill(leaf(p, lp + vec2(-0.5, -0.2), 0.2, 0.45, 0.13)));
	col = mix(col, TREE, fill(leaf(p, lp + vec2(0.5, -0.2), -0.2, 0.45, 0.13)));
	// a swan every 13 m (owner photo 01): a body on the water, a tall S neck with the head bent down, an orange beak;
	// white, brown or black, every other one with its wings raised
	float sk = floor(s / 13.0);
	vec2 sp = vec2(sk * 13.0 + 10.0, 1.8);
	vec2 sd = p - sp;
	sd.x *= mod(sk, 2.0) < 1.0 ? 1.0 : -1.0;
	float body = max(length((sd - vec2(-0.1, 0.05)) * vec2(1.0, 1.9)) - 0.45, -sd.y - 0.1);
	float neck = min(min(seg(sd, vec2(0.22, 0.1), vec2(0.38, 0.45)), seg(sd, vec2(0.38, 0.45), vec2(0.33, 0.8))), min(seg(sd, vec2(0.33, 0.8), vec2(0.17, 0.98)), seg(sd, vec2(0.17, 0.98), vec2(0.05, 0.92)))) - 0.055;
	float head = length(sd - vec2(0.07, 0.9)) - 0.075;
	float swan = min(min(body, neck), head);
	float feathers = 0.0;
	if (mod(sk, 4.0) < 2.0) {
		// a raised wing: a fan of feathers over the back, scalloped at its edge
		vec2 dw = sd - vec2(-0.18, 0.12);
		float wth = atan(dw.y, dw.x);
		float wing = max(max(length(dw) - 0.5 * (0.82 + 0.18 * abs(cos(7.0 * wth))), -dw.y), dw.x - 0.2);
		swan = min(swan, wing);
		feathers = fill(abs(fract(wth * 2.228) - 0.5) - 0.04) * fill(wing + 0.06) * step(0.12, length(dw));
	}
	float sm = mod(sk, 3.0);
	col = mix(col, sm < 1.0 ? WHITE : (sm < 2.0 ? BROWN : INK * 1.5), fill(swan));
	col = mix(col, INK, fill(abs(swan) - 0.008));
	col = mix(col, sm < 1.0 ? INK : WHITE, feathers * 0.6);
	col = mix(col, ORANGE, fill(tri(sd, vec2(0.03, 0.94), vec2(0.03, 0.86), vec2(-0.13, 0.84))));
	// a tree every 23 m, of three kinds
	float tk = floor((s + 7.0) / 23.0);
	col = tree(col, p, vec2(tk * 23.0 - 7.0 + 1.2, 2.9), tk);
	// the saffron band under the coping, its lower edge in scallops, a white line under it (the tricolour, the
	// kit's green base below)
	float edge = 0.95 - 0.18 * abs(sin(s * 1.7));
	col = mix(col, WHITE, fill(left - edge - 0.07));
	col = mix(col, SAFFRON, fill(left - edge));
	col = brushed(col, uv0, floor(s / 1.5), false);
	return concrete(col, uv0);
}

vec3 pillar(vec2 uv0, vec3 base) {
	vec2 uv = hand(uv0);
	vec3 col = base;
	float side = step(2.0, uv.x);
	if (side < 0.5) {
		vec2 c = vec2(0.55, 2.8);
		vec2 d = uv - c;
		float r = length(d);
		float th = atan(d.y, d.x);
		col = mix(col, WHITE, fill(r - 0.48));
		col = mix(col, base * 0.7, fill(r - (0.42 + 0.035 * cos(16.0 * th))));
		col = mix(col, YELLOW, fill(r - (0.32 + 0.06 * abs(cos(6.0 * th + 0.3)))));
		col = mix(col, WHITE, fill(abs(r - 0.25) - 0.012));
		float dots = length(vec2(fract(th * 2.546) - 0.5, (r - 0.2) * 9.0)) - 0.18;
		col = mix(col, RED, fill(dots) * step(r, 0.24) * step(0.16, r));
		col = mix(col, ORANGE, fill(r - (0.12 + 0.03 * cos(8.0 * th))));
		col = mix(col, WHITE, fill(r - 0.035));
		// a band of small diamonds up the shaft, over and under the disc
		float dy = mod(uv.y, 0.45) - 0.225;
		float dia = abs(uv.x - 0.55) + abs(dy) - 0.075;
		col = mix(col, WHITE, fill(dia) * (step(3.45, uv.y) + step(uv.y, 2.15) * step(1.35, uv.y)));
		// dotted borders down both edges of the face
		float ex = min(uv.x, 1.1 - uv.x);
		col = mix(col, WHITE, fill(length(vec2(ex - 0.07, mod(uv.y, 0.16) - 0.08)) - 0.022));
	} else {
		// a side: stripes of the base and a darker shade, the dotted border
		col = mix(col, base * 0.75, step(0.5, fract(uv.y * 1.6)) * 0.6);
		col = mix(col, WHITE, fill(length(vec2(fract(uv.x * 4.0) - 0.5, mod(uv.y, 0.2) - 0.1) * vec2(0.25, 1.0)) - 0.02));
	}
	col = brushed(col, uv0, 5.0, true);
	return col;
}

void fragment() {
	vec3 c;
	if (kind == 0) {
		c = inside(UV);
	} else if (kind == 1) {
		c = ramp(UV, COLOR.r * 16.0);
	} else {
		c = pillar(UV, COLOR.rgb);
	}
#ifdef VERTEX_LIGHT
	float fade = clamp(1.0 - length(VERTEX) / 60.0, 0.0, 1.0);
	vec3 nb = t_bump(v_wnrm, v_wpos, 11.0, 0.02 * fade);
	ALBEDO = tunnel_shade(to_linear(c), nb, normalize(CAMERA_POSITION_WORLD - v_wpos), v_s0, v_s1, 32.0, 0.25, light_level);
#else
	ALBEDO = to_linear(c);
	ROUGHNESS = roughness_base;
#endif
}
