## Style test A, the realistic reference look (game arg --style=realistic, STYLE_OPTIONS.md "Realistic vs stylised
## B", P0-038). Owner round 4: "Show me realistic too first", with Watch Dogs 2 as the fidelity bar. It extends batch B
## (stylised_b.gd) so every dressing piece, the bazaar-only grime and the Delhi detail are the same, and the
## comparison is about rendering only:
## - surfaces: the PBR layer of surface_b.gdshader (pbr = 1): a normal from the height of every texture layer, a finer
##   second texture scale, AO and roughness from the joints, earth and dry grass on the bare ground between blocks,
##   wet and dusty surface response per light (light_preset wet, dust), less low-frequency plaster mottling;
## - light: a physical sky (Rayleigh and Mie scattering from the sun direction) by day, SSR, SSAO and SSIL (SDFGI
##   measured and left opt-in, see environment()), volumetric fog over the whole view with sun shafts, a filmic
##   tonemap and a neutral to warm LUT, TAA;
## - night: sodium street lights with inverse square falloff, so the road shows lamp pools, and light cones in the haze.
## Same four lights (--light=dawn|afternoon|golden|night, or --time). People keep their clean satin material.
## --style-off=<a,b> adds ssr, taa, gfog (the global volumetric fog) and physky to batch B's volfog, shimmer,
## dressing, lights and textures, to measure what each costs. Opt-in tokens on the same arg: sdfgi_on (SDFGI),
## aces_on (ACES tonemap), fsr2@<scale> or metalfx@<scale> (render the 3D view at that scale and upscale it).
extends "res://render/styles/stylised_b.gd"


func _build_materials() -> Dictionary:
	var m := super()
	for k in ["matte", "road", "leaf", "shutter"]:
		var s: ShaderMaterial = m[k]
		s.set_shader_parameter("pbr", 1.0)
		s.set_shader_parameter("bump", 1.0)
		s.set_shader_parameter("mottle", 0.35)
		s.set_shader_parameter("wetness", light.wet)
		s.set_shader_parameter("dustiness", light.dust)
	# cars and metal: a little more real (clear coat over a slightly rougher base, glass that reflects the scene)
	var paint: StandardMaterial3D = m["paint"]
	paint.roughness = 0.38
	paint.metallic = 0.3
	paint.clearcoat = 1.0
	paint.clearcoat_roughness = 0.08
	var glass: StandardMaterial3D = m["glass"]
	glass.roughness = 0.03
	glass.metallic = 0.9
	var metal: StandardMaterial3D = m["metal"]
	metal.roughness = 0.5
	metal.metallic = 0.8
	return m


# ---------------------------------------------------------------- environment


func environment() -> Environment:
	if _env != null:
		return _env
	var env := super()
	var day: bool = light.night < 0.5
	if day and not off.has("physky"):
		env.sky.sky_material = _physical_sky()
	# Filmic: ACES (tried first) crushed the shaded street to black at golden and dawn on these dark asphalt stand-ins
	env.tonemap_mode = Environment.TONE_MAPPER_ACES if off.has("aces_on") else Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = light.exposure * preset.exposure_scale
	env.tonemap_white = 6.0
	# more sky light in the shade so shadow sides keep their colour instead of going black
	env.ambient_light_energy = light.ambient_energy * 1.8
	# GI: SSIL and the sky ambient, plus batch B's soft bounce lights in the bazaar lane. SDFGI is opt-in
	# (--style-off=sdfgi_on): on these stand-ins it read the narrow bazaar lane near black by day even after 12 s to
	# converge, with or without the dressing (P0-038 measured), so it is not the best GI option here yet.
	if off.has("sdfgi_on"):
		env.sdfgi_enabled = true
		env.sdfgi_use_occlusion = true
		env.sdfgi_read_sky_light = true
		env.sdfgi_cascades = 4
		env.sdfgi_min_cell_size = 0.25
		env.sdfgi_bounce_feedback = 0.5
		env.sdfgi_energy = 1.4
		env.sdfgi_normal_bias = 1.1
		env.sdfgi_probe_bias = 1.1
	env.ssao_intensity = 1.2
	env.ssao_radius = 0.9
	env.ssil_intensity = 0.8
	env.ssil_radius = 5.0
	if not off.has("ssr"):
		env.ssr_enabled = true
		env.ssr_max_steps = 64
		env.ssr_fade_in = 0.15
		env.ssr_fade_out = 2.0
		env.ssr_depth_tolerance = 0.25
	# haze: half of it as depth fog, the rest as volumetric fog that the sun and the lamps light (shafts and cones)
	env.fog_density = light.fog_density * 0.55
	env.fog_sky_affect = light.fog_sky_affect * 0.7
	if not off.has("gfog") and not off.has("volfog"):
		env.volumetric_fog_enabled = true
		env.volumetric_fog_density = light.fog_density * (1.6 if day else 2.4)
		env.volumetric_fog_albedo = light.fog_color.lerp(Color.WHITE, 0.25)
		env.volumetric_fog_anisotropy = 0.65
		env.volumetric_fog_length = 120.0
		env.volumetric_fog_ambient_inject = 0.25 if day else 0.6
		env.volumetric_fog_sky_affect = 0.0
		env.volumetric_fog_gi_inject = 0.5
	# glow only for real light sources (lamps, signs, the sun in the haze)
	env.glow_intensity = 0.35
	env.glow_bloom = 0.01
	env.glow_hdr_threshold = 1.2
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_ADDITIVE
	env.glow_strength = 0.9
	# a neutral to warm grade: half of the stylised tints, closer to natural saturation
	env.adjustment_contrast = preset.contrast
	env.adjustment_saturation = preset.saturation
	env.adjustment_color_correction = lut(light.shadow_tint * 0.5, light.highlight_tint * 0.6,
		lerpf(1.0, light.grade_saturation, 0.45))
	_env = env
	return env


## Daylight sky from the sun direction: Rayleigh and Mie scattering, Mie heavy for Delhi dust (turbidity high).
func _physical_sky() -> PhysicalSkyMaterial:
	var ps := PhysicalSkyMaterial.new()
	ps.rayleigh_coefficient = 2.0
	ps.rayleigh_color = Color(0.3, 0.42, 0.62)
	ps.mie_coefficient = 0.01
	ps.mie_eccentricity = 0.82
	ps.mie_color = light.fog_color.lerp(Color(0.9, 0.85, 0.75), 0.4)
	ps.turbidity = 8.0
	ps.sun_disk_scale = 1.4
	ps.ground_color = light.ground_bottom
	ps.energy_multiplier = 2.2
	return ps


## Heat shimmer from batch B, plus TAA on the viewport (the realistic look leans on it against shimmer and noise).
func decorate_environment(we: WorldEnvironment) -> void:
	super(we)
	if not we.is_inside_tree():
		return
	var vp := we.get_viewport()
	vp.screen_space_aa = Viewport.SCREEN_SPACE_AA_DISABLED
	# upscaler test (performance target: about 1080p rendered, upscaled): --style-off=fsr2@0.75 renders the 3D view at
	# that scale and upscales it with FSR 2.2 (its own temporal AA, so TAA goes off); metalfx@<s> on the Metal driver
	for k in off:
		var parts: PackedStringArray = String(k).split("@")
		if parts.size() == 2 and parts[1].is_valid_float() and parts[0] in ["fsr2", "metalfx"]:
			vp.scaling_3d_mode = Viewport.SCALING_3D_MODE_FSR2 if parts[0] == "fsr2" else Viewport.SCALING_3D_MODE_METALFX_TEMPORAL
			vp.scaling_3d_scale = clampf(float(parts[1]), 0.25, 1.0)
			print("style: realistic 3D view at scale %.2f, upscaled with %s" % [vp.scaling_3d_scale, parts[0]])
			return
	if not off.has("taa"):
		vp.use_taa = true


func setup_sun(sun: DirectionalLight3D) -> void:
	super(sun)
	sun.shadow_blur = 0.6
	sun.shadow_normal_bias = 1.2
	sun.light_volumetric_fog_energy = 1.0 if light.night < 0.5 else 0.3
	sun.light_angular_distance = maxf(light.sun_angular_deg, 0.6)


# ---------------------------------------------------------------- night lights


## Sodium street light with inverse square falloff (attenuation 2): a bright pool under the lamp that fades over
## about 10 m, a soft cone edge, and a visible cone in the haze.
func _street_lamp(xf: Transform3D, _d := {}) -> void:
	var s := SpotLight3D.new()
	s.light_color = SODIUM
	s.light_energy = 170.0 * light.night
	s.spot_range = 26.0
	s.spot_angle = 68.0
	s.spot_angle_attenuation = 1.6
	s.spot_attenuation = 2.0
	s.light_specular = 0.6
	s.light_volumetric_fog_energy = 0.35
	s.shadow_enabled = false
	s.transform = Transform3D(Basis(Vector3.RIGHT, -PI * 0.5), xf.origin)
	_h.add_child(s)


# ---------------------------------------------------------------- GI


## Batch B dressing, then thin detail (wires, frames, grilles, bunting: the no-shadow meshes) leaves SDFGI: voxelised
## at 25 cm cells (with --style-off=sdfgi_on) they would close the bazaar lane like a roof.
func _dress(mi: MeshInstance3D) -> void:
	super(mi)
	if _h == null or not is_instance_valid(_h) or _h.get_parent() != mi:
		return
	for c in _h.get_children():
		if c is GeometryInstance3D and (c as GeometryInstance3D).cast_shadow == GeometryInstance3D.SHADOW_CASTING_SETTING_OFF:
			(c as GeometryInstance3D).gi_mode = GeometryInstance3D.GI_MODE_DISABLED


# ---------------------------------------------------------------- P0-034 setup kept for this reference look


## The realistic reference sets more from the light in environment() (physical sky by day, volumetric fog, its own
## grade) than light_environment() covers: it keeps the rebuild on a scene load instead of the live relight (P1-028).
func can_relight() -> bool:
	return false


## Realistic keeps the P0-034 batch B setup (stylised B's lean path, P0-037, is for the performance target).
func _lean() -> bool:
	return false


## Dust and haze over a worn block: a fog volume, denser near the ground (volumetric fog).
func _haze(xf: Transform3D, d: Dictionary) -> void:
	var fv := FogVolume.new()
	fv.name = "AreaHaze"
	fv.shape = RenderingServer.FOG_VOLUME_SHAPE_BOX
	var hw: float = d.hw
	fv.size = Vector3(hw * 2.0 + 26.0, 24.0, d.z1 - d.z0 + 16.0)
	fv.position = Vector3(xf.origin.x, 11.0, (d.z0 + d.z1) * 0.5)
	var fm := FogMaterial.new()
	fm.density = light.area_haze * _wear * 0.5
	fm.albedo = light.area_haze_color
	fm.height_falloff = 0.12
	fm.edge_fade = 0.35
	fv.material = fm
	_h.add_child(fv)
