// The stylised B sky (P2-052, FIDELITY_BAR.md row 10): the ProceduralSkyMaterial gradient (top, horizon, ground) plus a
// sun disc with a soft halo and a procedural cloud layer, lit by the sun by day and by the city's warm glow from below
// at night. Light 0 is the scene's DirectionalLight3D (the sun by day, the moon at night), so the disc always sits
// where the shadows say. No TIME: the radiance map is rebuilt only when the look relights (a moving sky would rebuild
// it every frame). Uniforms are set by game/render/styles/stylised_b.gd from the light preset.
shader_type sky;

uniform vec3 sky_top : source_color = vec3(0.4, 0.56, 0.75);
uniform vec3 sky_horizon : source_color = vec3(0.86, 0.79, 0.66);
uniform vec3 ground_horizon : source_color = vec3(0.83, 0.77, 0.64);
uniform vec3 ground_bottom : source_color = vec3(0.44, 0.39, 0.31);
uniform float sky_curve = 0.15;
uniform float energy = 1.0;
// the old procedural sun glow (degrees out from the sun, falloff curve), now only a soft halo
uniform float glow_deg = 30.0;
uniform float glow_curve = 0.15;
uniform float glow_amount = 0.6;
// the disc: radius in degrees and brightness over the sky (0 = no disc)
uniform float disc_deg = 1.2;
uniform float disc_energy = 6.0;
uniform float cloud_cover = 0.35;
uniform vec3 cloud_color : source_color = vec3(1.0, 0.97, 0.92);
uniform vec3 cloud_shade : source_color = vec3(0.62, 0.62, 0.64);
uniform float city_glow = 0.0;
uniform vec2 cloud_offset = vec2(0.0);

float h12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

float vn(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(h12(i), h12(i + vec2(1.0, 0.0)), u.x), mix(h12(i + vec2(0.0, 1.0)), h12(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
	float a = 0.5;
	float s = 0.0;
	for (int i = 0; i < 5; i++) {
		s += a * vn(p);
		p = mat2(vec2(0.8, -0.6), vec2(0.6, 0.8)) * p * 2.02 + vec2(11.3, 7.1);
		a *= 0.5;
	}
	return s;
}

void sky() {
	vec3 d = EYEDIR;
	float v_angle = acos(clamp(d.y, -1.0, 1.0));
	vec3 col;
	if (d.y >= 0.0) {
		float c = 1.0 - v_angle / (PI * 0.5);
		col = mix(sky_horizon, sky_top, clamp(1.0 - pow(1.0 - c, 1.0 / sky_curve), 0.0, 1.0));
	} else {
		float c = (v_angle - PI * 0.5) / (PI * 0.5);
		col = mix(ground_horizon, ground_bottom, clamp(1.0 - pow(1.0 - c, 50.0), 0.0, 1.0));
	}
	col *= energy;
	vec3 sun_col = LIGHT0_ENABLED ? LIGHT0_COLOR : vec3(1.0);
	float sun_e = LIGHT0_ENABLED ? LIGHT0_ENERGY : 0.0;
	float sun_ang = LIGHT0_ENABLED ? acos(clamp(dot(LIGHT0_DIRECTION, d), -1.0, 1.0)) : PI;
	float sun_up = LIGHT0_ENABLED ? LIGHT0_DIRECTION.y : -1.0;
	// halo: the old procedural glow, softer (it read as a blown white blob at golden and dawn)
	float g = clamp(sun_ang / radians(max(glow_deg, 0.1)), 0.0, 1.0);
	float halo = pow(1.0 - g, 1.0 / max(glow_curve, 0.01)) * glow_amount + exp(-sun_ang * 9.0) * 0.35 * glow_amount;
	col += sun_col * sun_e * 0.35 * halo * step(-0.05, d.y);
	// clouds: a flat layer over the city, seen through the haze near the horizon
	if (cloud_cover > 0.001 && d.y > 0.0) {
		vec2 uv = d.xz / (d.y + 0.06) * 0.55 + cloud_offset;
		float n = fbm(uv * 1.3);
		// the radiance map (ambient and reflections, rebuilt on every relight) takes plain clouds: no streaks, no self
		// shadow, so a live relight stays cheap
		bool full = !AT_CUBEMAP_PASS;
		float lo = 1.0 - cloud_cover;
		float dens = smoothstep(lo, lo + 0.22, n);
		// streaks of thin high cloud (Delhi's dusty sky is rarely clear blue)
		float cirrus = full ? smoothstep(0.55, 0.85, fbm(vec2(uv.x * 0.35, uv.y * 2.4) + 3.7)) * 0.35 * cloud_cover : 0.0;
		// (by day only: at night the moon is light 0 and the thin streaks read as scratches)
		dens = max(dens, cirrus * clamp(sun_e - 0.4, 0.0, 1.0));
		// self shadow: the cloud is darker where more cloud lies toward the sun
		vec2 to_sun = LIGHT0_ENABLED ? normalize(LIGHT0_DIRECTION.xz + vec2(1e-4)) : vec2(0.0);
		float n2 = full ? fbm(uv * 1.3 + to_sun * 0.12) : n;
		float lit = clamp(0.55 + (n - n2) * 4.0, 0.0, 1.0);
		float day = clamp(sun_up * 4.0 + 0.3, 0.0, 1.0) * clamp(sun_e, 0.0, 1.0);
		// the shaded underside takes a little of the sky round it, the lit side the sun's colour
		vec3 under = mix(cloud_shade, col / max(energy, 0.01), 0.25);
		vec3 base = mix(under, cloud_color * mix(vec3(1.0), sun_col, 0.35), lit) * energy;
		// silver lining near the sun
		base += sun_col * sun_e * 0.25 * exp(-sun_ang * 4.0) * (1.0 - dens) * day;
		// at night the clouds take the sodium glow of the city from below, strongest low in the sky
		vec3 glow = vec3(1.0, 0.55, 0.3) * city_glow * (0.6 + 0.4 * (1.0 - d.y));
		vec3 cc = mix(base * mix(0.25, 1.0, day), glow + base * 0.15, (1.0 - day) * step(0.001, city_glow));
		float fade = smoothstep(0.02, 0.22, d.y);
		col = mix(col, cc, dens * fade * 0.92);
	}
	// the disc last: over the clouds' thin edges, dimmed by thick cloud in front of it
	if (disc_deg > 0.0 && LIGHT0_ENABLED) {
		float r = radians(disc_deg);
		float disc = 1.0 - smoothstep(r * 0.85, r, sun_ang);
		col = mix(col, sun_col * disc_energy, disc * step(-0.02, d.y));
	}
	COLOR = col;
}
