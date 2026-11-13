// The stand-in look of a humanoid (P1-023): one mannequin mesh, its clothes painted from the rest pose so nothing can
// poke through the body. The mesh (tools/build_humanoid.gd) carries COLOR.r = body region / 8 (0 head, 1 torso, 2 hips,
// 3 arm, 4 hand, 5 leg, 6 foot) and CUSTOM0 = rest position in model metres (+Z front, +X the model's left) and, on
// arms and hands, the share along the arm (0 shoulder joint, 1 wrist). Each lead sets the uniforms (game/characters/
// leads.gd). Clean cloth and skin colours, satin skin, matte cloth; no grime on people (STYLE_BIBLE.md "Characters").
shader_type spatial;
render_mode cull_back;

uniform vec3 skin : source_color = vec3(0.66, 0.42, 0.27);
uniform vec3 hair : source_color = vec3(0.11, 0.10, 0.10);
uniform vec3 shirt : source_color = vec3(0.70, 0.62, 0.45);
uniform vec3 sleeve_col : source_color = vec3(0.70, 0.62, 0.45);
uniform vec3 inner_a : source_color = vec3(0.9, 0.7, 0.2);
uniform vec3 inner_b : source_color = vec3(0.1, 0.4, 0.5);
uniform vec3 trousers : source_color = vec3(0.2, 0.2, 0.22);
uniform vec3 shoes : source_color = vec3(0.14, 0.13, 0.13);
uniform vec3 accent_a : source_color = vec3(0.69, 0.23, 0.18);
uniform vec3 accent_b : source_color = vec3(0.96, 0.94, 0.89);
uniform vec3 belt_col : source_color = vec3(0.29, 0.2, 0.14);
uniform vec3 metal : source_color = vec3(0.83, 0.65, 0.22);
// Where the sleeve ends along the arm (0..1), and the shirt's hem height (m, rest pose).
uniform float sleeve = 0.55;
uniform float hem = 0.92;
// Hairline height at the front and at the back of the head (m, rest pose).
uniform float hair_front = 1.715;
uniform float hair_back = 1.6;
// Features, 0 or 1: a gamchha over the left shoulder, a belt with a holster, an open jacket with a printed shirt and a
// chain, sunglasses pushed up, sandals.
uniform float gamchha = 0.0;
uniform float belt = 0.0;
uniform float jacket = 0.0;
uniform float glasses = 0.0;
uniform float sandals = 0.0;
// A thin moustache; police shirt details (epaulettes, two pocket flaps, a name plate).
uniform float moustache = 0.0;
uniform float uniform_marks = 0.0;
// Face heights (m, rest pose): the eyes and brows of the male mannequin (the female one is 5 mm lower).
uniform float eye_y = 1.69;

varying float region;
varying vec4 rest;

void vertex() {
	region = COLOR.r * 8.0;
	rest = CUSTOM0;
}

bool is_region(float r) {
	return abs(region - r) < 0.5;
}

void fragment() {
	vec3 p = rest.xyz;
	vec3 c = shirt;
	float rough = 0.88;
	float ax = abs(p.x);
	if (is_region(0.0)) {
		// head and neck: hair above a hairline that drops from the brow to the nape
		float line = mix(hair_back, hair_front, smoothstep(-0.03, 0.07, p.z));
		c = skin;
		rough = 0.62;
		if (p.y > line) {
			c = hair;
			rough = 0.7;
		}
		// a simple face: brows, eyes (dark, no whites), the line of the mouth; nothing cartoon sized
		if (p.z > 0.075) {
			float ex = ax - 0.033;
			if ((ex * ex) / (0.012 * 0.012) + pow(p.y - eye_y, 2.0) / (0.0055 * 0.0055) < 1.0) { c = vec3(0.13, 0.09, 0.07); rough = 0.3; }
			if (abs(p.y - (eye_y + 0.022 - 0.08 * max(ax - 0.03, 0.0))) < 0.0035 && ax > 0.012 && ax < 0.052) c = hair;
			if (abs(p.y - (eye_y - 0.075)) < 0.0025 && ax < 0.021) c = skin * 0.62;
			if (moustache > 0.5 && p.y > eye_y - 0.068 && p.y < eye_y - 0.055 && ax < 0.03) c = hair;
		}
		if (glasses > 0.5 && p.z > 0.035 && p.y > line - 0.005 && p.y < line + 0.03 && ax < 0.085) {
			c = vec3(0.09, 0.09, 0.1);
			rough = 0.25;
		}
		if (p.y < 1.5 && jacket > 0.5 && p.z > 0.0) {
			// the open collar of the printed shirt shows skin; the chain sits on it
			float yc = 1.43 + 0.05 * pow(ax / 0.07, 2.0);
			if (abs(p.y - yc) < 0.006 && ax < 0.07) { c = metal; rough = 0.3; }
		}
	} else if (is_region(3.0) || is_region(4.0)) {
		c = skin;
		rough = 0.62;
		if (is_region(3.0) && rest.w < sleeve) {
			c = sleeve_col;
			rough = 0.88;
			if (rest.w > sleeve - 0.05 && sleeve < 0.9) c = sleeve_col * 0.82;
			if (uniform_marks > 0.5 && rest.w < 0.12 && p.y > 1.475) c = belt_col;
		}
	} else if (is_region(5.0)) {
		// the hips' sides follow the thigh bones: the hem and the belt go round them too
		c = p.y > hem ? shirt : trousers;
		if (belt > 0.5 && abs(p.y - hem) < 0.022) c = belt_col;
	} else if (is_region(6.0)) {
		c = shoes;
		if (sandals > 0.5) {
			c = skin;
			rough = 0.62;
			bool strap = (p.y < 0.085 && abs(p.z - 0.06) < 0.025) || p.y < 0.035;
			if (strap) { c = shoes; rough = 0.8; }
		}
	} else {
		// torso and hips: shirt (or jacket) above the hem, trousers below
		c = p.y > hem ? shirt : trousers;
		if (jacket > 0.5 && p.y > hem && p.z > 0.0 && ax < 0.075) {
			// open jacket: the printed shirt down the front
			float s = mod(floor((p.y + p.x * 0.6) * 28.0), 3.0);
			c = s < 1.0 ? inner_b : inner_a;
			float yc = 1.43 + 0.05 * pow(ax / 0.07, 2.0);
			if (abs(p.y - yc) < 0.006 && ax < 0.07) { c = metal; rough = 0.3; }
		}
		if (belt > 0.5 && abs(p.y - hem) < 0.022) {
			c = belt_col;
			if (ax < 0.03 && p.z > 0.0) { c = metal; rough = 0.35; }
		}
		if (belt > 0.5 && p.x < -0.12 && p.y < hem - 0.02 && p.y > 0.8 && p.z > -0.04 && p.z < 0.07) {
			c = vec3(0.12, 0.11, 0.11);
			rough = 0.5;
		}
		if (uniform_marks > 0.5 && p.y > hem) {
			// pocket flaps and their buttons, a navy name plate on the right breast, dark epaulettes
			float px = ax - 0.08;
			if (p.z > 0.04 && abs(px) < 0.035 && p.y > 1.29 && p.y < 1.33) c = shirt * 0.78;
			if (p.z > 0.04 && p.x < -0.045 && p.x > -0.115 && p.y > 1.255 && p.y < 1.272) c = vec3(0.16, 0.2, 0.33);
			if (ax > 0.13 && p.y > 1.475) c = belt_col;
		}
	}
	if (gamchha > 0.5 && (is_region(1.0) || (is_region(3.0) && rest.w < 0.12)) && p.x > 0.07 && p.x < 0.19 && p.y > 1.1) {
		// a checked cotton gamchha over the left shoulder, front and back
		float k = mod(floor(p.y * 26.0) + floor((p.x + p.z) * 26.0), 2.0);
		c = k < 1.0 ? accent_a : accent_b;
		rough = 0.9;
	}
	ALBEDO = c;
	ROUGHNESS = rough;
	SPECULAR = 0.35;
	RIM = 0.25;
	RIM_TINT = 0.5;
}
