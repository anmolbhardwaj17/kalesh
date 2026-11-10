## Style test B, stylised realistic, rich and warm (game arg --style=stylised, STYLE_OPTIONS.md "B"). Settings in
## stylised.tres (a style_preset.gd), the time of day in light_<id>.tres (a light_preset.gd). Builds the Environment
## (AgX tonemap, glow, SSAO, SSIL, sun-lit haze, procedural sky, a warm 3D LUT), sets the sun and its soft shadows,
## and swaps the stand-in materials by key (kit.gd materials()) for the shared surface shader and tuned standard
## materials. Driven by game/render/style_runner.gd. stylised_grime.gd extends this with the grime layer.
extends RefCounted

const SURFACE_SHADER := preload("res://render/shaders/surface.gdshader")
const GLOW_SHADER := preload("res://render/shaders/glow.gdshader")
const LUT_SIZE := 33

var preset: Resource
var light: Resource
var _mats := {}
var _env: Environment
static var _lut_cache := {}


func _init(style_preset: Resource, light_preset: Resource) -> void:
	preset = style_preset
	light = light_preset
	_mats = _build_materials()


# ---------------------------------------------------------------- environment


func environment() -> Environment:
	if _env != null:
		return _env
	var env := Environment.new()
	var sm := ProceduralSkyMaterial.new()
	sm.sky_top_color = light.sky_top
	sm.sky_horizon_color = light.sky_horizon
	sm.ground_horizon_color = light.ground_horizon
	sm.ground_bottom_color = light.ground_bottom
	sm.sky_energy_multiplier = light.sky_energy
	sm.sun_angle_max = light.sun_disc_deg
	sm.sun_curve = light.sun_curve
	var sky := Sky.new()
	sky.sky_material = sm
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = light.ambient_energy
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = preset.tonemap
	env.tonemap_exposure = light.exposure * preset.exposure_scale
	env.tonemap_agx_contrast = preset.agx_contrast
	env.glow_enabled = preset.glow
	env.glow_intensity = preset.glow_intensity
	env.glow_strength = preset.glow_strength
	env.glow_bloom = preset.glow_bloom
	env.glow_hdr_threshold = preset.glow_threshold
	env.glow_blend_mode = Environment.GLOW_BLEND_MODE_SOFTLIGHT
	env.ssao_enabled = preset.ssao
	env.ssao_radius = preset.ssao_radius
	env.ssao_intensity = preset.ssao_intensity
	env.ssao_power = preset.ssao_power
	env.ssao_light_affect = preset.ssao_light_affect
	env.ssil_enabled = preset.ssil
	env.ssil_radius = preset.ssil_radius
	env.ssil_intensity = preset.ssil_intensity
	env.fog_enabled = true
	env.fog_mode = Environment.FOG_MODE_EXPONENTIAL
	env.fog_light_color = light.fog_color
	env.fog_density = light.fog_density
	env.fog_sun_scatter = light.fog_sun_scatter
	env.fog_aerial_perspective = light.fog_aerial
	env.fog_sky_affect = light.fog_sky_affect
	env.fog_height = light.fog_height
	env.fog_height_density = light.fog_height_density
	env.adjustment_enabled = true
	env.adjustment_contrast = preset.contrast
	env.adjustment_saturation = preset.saturation
	env.adjustment_color_correction = lut(light.shadow_tint, light.highlight_tint, light.grade_saturation)
	_env = env
	return env


## Compass azimuth (0 north, 90 east) and elevation in degrees to the unit vector pointing at the sun, in the game
## frame (east +X, north -Z, up +Y). Pure; tested in game/tests/test_style.gd.
static func sun_vector(azimuth_deg: float, elevation_deg: float) -> Vector3:
	var az := deg_to_rad(azimuth_deg)
	var el := deg_to_rad(elevation_deg)
	return Vector3(sin(az) * cos(el), sin(el), -cos(az) * cos(el))


func setup_sun(sun: DirectionalLight3D) -> void:
	var to_sun := sun_vector(light.sun_azimuth_deg, light.sun_elevation_deg)
	# a DirectionalLight3D shines along its -Z: point -Z away from the sun (looking_at points -Z at the target)
	var b := Basis.looking_at(-to_sun, Vector3.UP if absf(to_sun.y) < 0.99 else Vector3.FORWARD)
	if sun.get_parent() is Node3D:
		sun.global_basis = b
	else:
		sun.basis = b
	sun.light_color = light.sun_color
	sun.light_energy = light.sun_energy
	sun.light_angular_distance = light.sun_angular_deg
	sun.shadow_enabled = true
	sun.shadow_blur = 1.0
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS
	sun.directional_shadow_blend_splits = true
	sun.directional_shadow_max_distance = light.shadow_max_distance
	sun.directional_shadow_fade_start = 0.85


## The grade as a LUT_SIZE^3 3D texture (applied after the tonemap): saturation, then shadow and highlight tints.
func lut(shadow_tint: Vector3, highlight_tint: Vector3, sat: float) -> ImageTexture3D:
	var key := "%s|%s|%s" % [shadow_tint, highlight_tint, sat]
	if _lut_cache.has(key):
		return _lut_cache[key]
	var n := LUT_SIZE
	var slices: Array[Image] = []
	for bz in n:
		var img := Image.create_empty(n, n, false, Image.FORMAT_RGB8)
		for gy in n:
			for rx in n:
				var c := grade(Vector3(rx, gy, bz) / float(n - 1), shadow_tint, highlight_tint, sat)
				img.set_pixel(rx, gy, Color(c.x, c.y, c.z))
		slices.append(img)
	var tex := ImageTexture3D.new()
	tex.create(Image.FORMAT_RGB8, n, n, n, false, slices)
	_lut_cache[key] = tex
	return tex


## One grade step on a display-space colour (0..1). Pure; tested in game/tests/test_style.gd.
static func grade(c: Vector3, shadow_tint: Vector3, highlight_tint: Vector3, sat: float) -> Vector3:
	var l := c.dot(Vector3(0.2126, 0.7152, 0.0722))
	var o := Vector3(l, l, l) + (c - Vector3(l, l, l)) * sat
	var s := (1.0 - l) * (1.0 - l)
	var h := l * l
	o += shadow_tint * s + highlight_tint * h
	return o.clamp(Vector3.ZERO, Vector3.ONE)


# ---------------------------------------------------------------- materials


func _build_materials() -> Dictionary:
	var m := {}
	m["matte"] = _surface(0, 0.92)
	m["road"] = _surface(1, 0.95)
	var leaf := _surface(2, 0.95)
	leaf.set_shader_parameter("albedo_saturation", 0.95)
	leaf.set_shader_parameter("backlight_tint", Vector3(0.35, 0.4, 0.15))
	m["leaf"] = leaf
	var satin := _std(0.55, 0.0)
	satin.rim_enabled = preset.rim > 0.0
	satin.rim = preset.rim
	satin.rim_tint = 0.6
	m["satin"] = satin
	m["metal"] = _std(0.4, 0.65)
	var paint := _std(0.3, 0.2)
	paint.clearcoat_enabled = true
	paint.clearcoat = 0.7
	paint.clearcoat_roughness = 0.15
	m["paint"] = paint
	m["glass"] = _std(0.05, 0.85)
	var glow := ShaderMaterial.new()
	glow.shader = GLOW_SHADER
	glow.set_shader_parameter("gain", light.lamp_gain)
	m["glow"] = glow
	return m


func _surface(kind: int, rough: float) -> ShaderMaterial:
	var s := ShaderMaterial.new()
	s.shader = SURFACE_SHADER
	s.set_shader_parameter("surface_kind", kind)
	s.set_shader_parameter("roughness_base", rough)
	s.set_shader_parameter("detail", preset.detail)
	s.set_shader_parameter("albedo_saturation", preset.albedo_saturation)
	s.set_shader_parameter("wear_scale", preset.wear_scale)
	return s


func _std(rough: float, metal: float) -> StandardMaterial3D:
	var s := StandardMaterial3D.new()
	s.vertex_color_use_as_albedo = true
	s.vertex_color_is_srgb = true
	s.roughness = rough
	s.metallic = metal
	return s


## The styled material for a stand-in material (matched by its key in resource_name), or null to keep it.
func material_for(original: Material) -> Material:
	if original == null:
		return null
	return _mats.get(original.resource_name)


## Called for every MeshInstance3D that enters the tree, after its materials are swapped. Look B adds nothing.
func decorate(_mi: MeshInstance3D) -> void:
	pass
