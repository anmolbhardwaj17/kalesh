// The art of the tunnel murals (P2-032), shared by tunnel_mural.gdshader (lit by the scene: the open ramps) and
// tunnel_mural_inside.gdshader (inside a roofed tunnel: lit evenly as from its LED strip lines, never by the sky).
uniform int kind = 0;
uniform float roughness_base = 0.75;

const vec3 YELLOW = vec3(0.925, 0.776, 0.165);
const vec3 OCHRE = vec3(0.827, 0.604, 0.09);
const vec3 GREEN = vec3(0.184, 0.541, 0.235);
const vec3 LEAF = vec3(0.47, 0.72, 0.28);
const vec3 WHITE = vec3(0.95, 0.94, 0.91);
const vec3 RED = vec3(0.78, 0.16, 0.16);
const vec3 CREAM = vec3(0.937, 0.902, 0.784);
const vec3 DISC = vec3(0.706, 0.788, 0.847);
const vec3 BLUE = vec3(0.176, 0.388, 0.678);
const vec3 SKY = vec3(0.56, 0.75, 0.886);
const vec3 SAFFRON = vec3(0.941, 0.478, 0.165);
const vec3 LOTUS = vec3(0.886, 0.365, 0.612);
const vec3 TREE = vec3(0.247, 0.49, 0.227);
const vec3 TREE_DARK = vec3(0.16, 0.36, 0.17);
const vec3 TRUNK = vec3(0.42, 0.29, 0.18);
const vec3 BROWN = vec3(0.45, 0.25, 0.16);

float fill(float d) {
	// 1 inside (d < 0), anti-aliased over one pixel
	float w = max(fwidth(d), 1e-4);
	return 1.0 - smoothstep(-w, w, d);
}

vec3 to_linear(vec3 c) {
	return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}

float hash(float n) {
	return fract(sin(n * 12.9898) * 43758.5453);
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

vec3 inside(vec2 uv) {
	float s = uv.x;
	float y = uv.y;
	float c = 2.4 + 0.55 * sin(s * 0.33) + 0.2 * sin(s * 0.9);
	float d = abs(y - c);
	vec3 col = YELLOW;
	col = mix(col, OCHRE, fill(d - 0.62));
	col = mix(col, GREEN, fill(d - 0.48));
	// a scalloped ochre edge with dots on both borders
	for (int side = -1; side <= 1; side += 2) {
		float by = c + float(side) * 0.55;
		float k = floor(s / 0.32);
		vec2 dc = vec2((k + 0.5) * 0.32, by);
		float r = length(vec2(s, y) - dc) - 0.055;
		col = mix(col, mod(k, 3.0) < 1.0 ? RED : WHITE, fill(r));
	}
	// leaves and birds in the band
	float cell = floor(s / 0.9);
	vec2 lc = vec2((cell + 0.5) * 0.9, c + (hash(cell) - 0.5) * 0.4);
	float la = (hash(cell + 7.0) - 0.5) * 1.6;
	col = mix(col, LEAF, fill(leaf(vec2(s, y), lc, la, 0.26, 0.09)) * step(d, 0.48));
	float bc = floor(s / 2.7);
	vec2 bp = vec2((bc + 0.3) * 2.7, c + 0.12 * sin(bc * 3.1));
	col = mix(col, WHITE, fill(bird(vec2(s, y), bp, 0.22)) * step(d, 0.48));
	return col;
}

vec3 ramp(vec2 uv, float left) {
	float s = uv.x;
	float y = uv.y;
	vec3 col = CREAM;
	// flower discs on a 0.9 m grid: eight petals round a centre
	vec2 g = vec2(s, y) / 0.9;
	vec2 gc = (floor(g) + 0.5) * 0.9;
	vec2 dp = vec2(s, y) - gc;
	float th = atan(dp.y, dp.x);
	float rr = length(dp);
	float petals = rr - 0.27 * (0.75 + 0.25 * cos(8.0 * th));
	float on = step(2.05, y) * step(mod(floor(g.x) + floor(g.y), 2.0), 0.5);
	col = mix(col, DISC, fill(petals) * on);
	col = mix(col, CREAM, fill(rr - 0.07) * on);
	// the river: a blue band with lighter ripples
	float rc = 1.35 + 0.22 * sin(s * 0.5);
	float rd = abs(y - rc);
	col = mix(col, BLUE, fill(rd - 0.38));
	float rip = abs(sin((s * 2.2 + sin(y * 9.0 + s) * 0.6))) - 0.25;
	col = mix(col, SKY, fill(rip) * fill(rd - 0.3) * step(0.08, rd));
	// a lotus every 18 m: petals over two leaves on the water
	float lk = floor(s / 18.0);
	vec2 lp = vec2(lk * 18.0 + 6.0, 2.15);
	vec2 ld = vec2(s, y) - lp;
	float lth = atan(ld.y, ld.x);
	float lotus = length(ld) - (0.32 + 0.22 * abs(cos(3.5 * lth))) * step(0.0, ld.y + 0.05);
	col = mix(col, LOTUS, fill(lotus));
	col = mix(col, TREE, fill(leaf(vec2(s, y), lp + vec2(-0.45, -0.18), 0.2, 0.4, 0.12)));
	col = mix(col, TREE, fill(leaf(vec2(s, y), lp + vec2(0.45, -0.18), -0.2, 0.4, 0.12)));
	// a swan every 13 m: a body, a neck and a head
	float sk = floor(s / 13.0);
	vec2 sp = vec2(sk * 13.0 + 10.0, 1.95);
	vec2 sd = vec2(s, y) - sp;
	float body = length(sd * vec2(1.0, 1.8)) - 0.42;
	float neck = abs(length(sd - vec2(0.38, 0.45)) - 0.3) - 0.05;
	neck = max(neck, -sd.x + 0.25);
	float head = length(sd - vec2(0.62, 0.72)) - 0.08;
	float swan = min(min(body, neck), head);
	col = mix(col, mod(sk, 2.0) < 1.0 ? WHITE : BROWN, fill(swan));
	// a tree every 23 m: a trunk and a crown of leaf blobs
	float tk = floor((s + 7.0) / 23.0);
	vec2 tp = vec2(tk * 23.0 - 7.0 + 1.2, 2.9);
	col = mix(col, TRUNK, fill(max(abs(s - tp.x) - 0.09, abs(y - 2.15) - 0.6)));
	float crown = length((vec2(s, y) - tp) * vec2(0.9, 1.1)) - 0.75;
	col = mix(col, TREE, fill(crown));
	for (int i = 0; i < 6; i++) {
		float a = float(i) * 1.047;
		col = mix(col, TREE_DARK, fill(length(vec2(s, y) - tp - vec2(cos(a), sin(a)) * 0.42) - 0.16));
	}
	// the saffron band under the coping, its lower edge in scallops, a white line under it
	float edge = 0.95 - 0.18 * abs(sin(s * 1.7));
	col = mix(col, WHITE, fill(left - edge - 0.06));
	col = mix(col, SAFFRON, fill(left - edge));
	return col;
}

vec3 pillar(vec2 uv, vec3 base) {
	vec2 c = vec2(0.55, 2.7);
	vec2 d = uv - c;
	float r = length(d);
	float th = atan(d.y, d.x);
	vec3 col = base;
	col = mix(col, WHITE, fill(r - 0.46));
	col = mix(col, base * 0.75, fill(r - (0.36 + 0.06 * cos(12.0 * th))));
	col = mix(col, WHITE, fill(r - (0.24 + 0.05 * cos(8.0 * th + 0.4))));
	col = mix(col, LOTUS, fill(r - 0.1));
	// a band of small diamonds up the shaft
	float dy = mod(uv.y, 0.5) - 0.25;
	col = mix(col, WHITE, fill(abs(uv.x - 0.55) + abs(dy) - 0.08) * step(3.4, uv.y));
	col = mix(col, WHITE, fill(abs(uv.x - 0.55) + abs(dy) - 0.08) * step(uv.y, 2.0) * step(1.3, uv.y));
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
	ALBEDO = to_linear(c) * light_level;
	ROUGHNESS = roughness_base;
}
