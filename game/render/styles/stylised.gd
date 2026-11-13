## Style test B, stylised realistic, rich and warm (game arg --style=stylised, STYLE_OPTIONS.md "B"). Settings in
## stylised.tres (a style_preset.gd), the time of day in light_<id>.tres (a light_preset.gd). Builds the Environment
## (AgX tonemap, glow, SSAO, SSIL, sun-lit haze, procedural sky, a warm 3D LUT), sets the sun and its soft shadows,
## and swaps the stand-in materials by key (kit.gd materials()) for the shared surface shader and tuned standard
## materials. Driven by game/render/style_runner.gd. stylised_grime.gd extends this with the grime layer.
extends RefCounted

const SURFACE_SHADER := preload("res://render/shaders/surface.gdshader")
const GLOW_SHADER := preload("res://render/shaders/glow.gdshader")
const LUT_SIZE := 33
## Metadata on a plain StandardMaterial3D that marks it a flat stand-in colour (material_for gives it a darker twin).
const FLAT_META := "flat_stand_in"
const FLAT_GAIN := 0.45

var preset: Resource
var light: Resource
var _mats := {}
## flat stand-in material -> its styled twin
var _flat := {}
var _env: Environment
static var _lut_cache := {}
# live relight (P1-028): the worker-thread LUT task, the key it builds, the key on screen, the next one wanted
var _lut_task := -1
var _lut_building := ""
var _lut_shown := ""
var _lut_want: Array = []
var _lut_slices: Array[Image] = []


func _init(style_preset: Resource, light_preset: Resource) -> void:
	preset = style_preset
	light = light_preset
	_mats = _build_materials()


# ---------------------------------------------------------------- environment


func environment() -> Environment:
	if _env != null:
		return _env
	var env := Environment.new()
	var sky := Sky.new()
	sky.sky_material = ProceduralSkyMaterial.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = preset.tonemap
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
	env.adjustment_enabled = true
	env.adjustment_contrast = preset.contrast
	env.adjustment_saturation = preset.saturation
	_env = env
	light_environment(env, true)
	return env


## The settings of an Environment that follow the light (sky, ambient, exposure, haze, grade). environment() calls it
## once; relight() calls it again on the same Environment when the day clock moves (P1-028), so a loaded scene follows
## the clock without a rebuild. `sync` false builds a new grade LUT off the main thread (poll() puts it in).
func light_environment(env: Environment, sync := true) -> void:
	var sm := env.sky.sky_material as ProceduralSkyMaterial if env.sky != null else null
	if sm != null:
		sm.sky_top_color = light.sky_top
		sm.sky_horizon_color = light.sky_horizon
		sm.ground_horizon_color = light.ground_horizon
		sm.ground_bottom_color = light.ground_bottom
		sm.sky_energy_multiplier = light.sky_energy
		sm.sun_angle_max = light.sun_disc_deg
		sm.sun_curve = light.sun_curve
	env.ambient_light_energy = light.ambient_energy
	env.tonemap_exposure = light.exposure * preset.exposure_scale
	env.fog_light_color = light.fog_color
	env.fog_density = light.fog_density
	env.fog_sun_scatter = light.fog_sun_scatter
	env.fog_aerial_perspective = light.fog_aerial
	env.fog_sky_affect = light.fog_sky_affect
	env.fog_height = light.fog_height
	env.fog_height_density = light.fog_height_density
	_set_lut(env, light.shadow_tint, light.highlight_tint, light.grade_saturation, sync)


# ---------------------------------------------------------------- live relight (P1-028)


## True when relight() can follow the day clock inside a loaded scene. A style whose environment() sets more from the
## light than light_environment() does (realistic.gd) answers false: it keeps the rebuild on a scene load.
func can_relight() -> bool:
	return true


## Moves the whole look to a new light preset in place: the Environment (sky, ambient, exposure, haze, grade), the
## light-driven materials and whatever the style tracks (stylised_b: night lights, lit windows, haze boxes, heat
## shimmer). The runner sets the scene's sun again after it (setup_sun). No node is made or freed here except by a
## style that owns them; `sync` true builds a missing grade LUT at once (a pinned jump), false on a worker thread.
func relight(light_preset: Resource, sync := false) -> void:
	light = light_preset
	if _env != null:
		light_environment(_env, sync)
	_relight_materials()


## The light-driven material settings (the glow gain); stylised_b adds its own.
func _relight_materials() -> void:
	var g: ShaderMaterial = _mats.get("glow")
	if g != null:
		g.set_shader_parameter("gain", light.lamp_gain)


## Called every frame by the runner: puts a finished worker-thread LUT into the Environment and starts the next one.
## Returns true when it did (the runner times it).
func poll() -> bool:
	if _lut_task < 0 or not WorkerThreadPool.is_task_completed(_lut_task):
		return false
	WorkerThreadPool.wait_for_task_completion(_lut_task)
	_lut_task = -1
	var tex := ImageTexture3D.new()
	tex.create(Image.FORMAT_RGB8, LUT_SIZE, LUT_SIZE, LUT_SIZE, false, _lut_slices)
	_lut_slices = []
	_lut_shown = _lut_building
	if _env != null:
		_env.adjustment_color_correction = tex
	if _lut_want.size() > 0 and _lut_want[0] != _lut_shown:
		_start_lut(_lut_want)
	return true


## Waits for a worker-thread LUT (the runner calls it before it drops this style or stops).
func finish() -> void:
	if _lut_task >= 0:
		WorkerThreadPool.wait_for_task_completion(_lut_task)
		_lut_task = -1
		_lut_slices = []


## True while a grade LUT is being built off the main thread or waits to be.
func lut_busy() -> bool:
	return _lut_task >= 0


## The grade for these tints: the exact LUT (cached) when sync, else the nearest quantised one from a worker thread.
## Live LUTs are quantised (tints 1/512, saturation 1/256: below one display step) so a slow clock builds a few, not one
## per relight, and are not cached (a cache keyed by a running blend would only grow).
func _set_lut(env: Environment, shadow_tint: Vector3, highlight_tint: Vector3, sat: float, sync: bool) -> void:
	var key := "%s|%s|%s" % [shadow_tint, highlight_tint, sat]
	if sync or _lut_cache.has(key):
		env.adjustment_color_correction = lut(shadow_tint, highlight_tint, sat)
		_lut_shown = key
		_lut_want = []
		return
	var qs := (shadow_tint * 512.0).round() / 512.0
	var qh := (highlight_tint * 512.0).round() / 512.0
	var qsat := roundf(sat * 256.0) / 256.0
	var qkey := "q%s|%s|%s" % [qs, qh, qsat]
	if qkey == _lut_shown or (_lut_task >= 0 and qkey == _lut_building):
		_lut_want = []
		return
	_lut_want = [qkey, qs, qh, qsat]
	if _lut_task < 0:
		_start_lut(_lut_want)


func _start_lut(want: Array) -> void:
	_lut_building = want[0]
	_lut_want = []
	_lut_task = WorkerThreadPool.add_task(_lut_slices_job.bind(want[1], want[2], want[3]), false, "grade LUT")


## Worker thread: the LUT slices as images (no texture: that is made on the main thread in poll()).
func _lut_slices_job(shadow_tint: Vector3, highlight_tint: Vector3, sat: float) -> void:
	_lut_slices = lut_slices(shadow_tint, highlight_tint, sat)


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
	var tex := ImageTexture3D.new()
	tex.create(Image.FORMAT_RGB8, n, n, n, false, lut_slices(shadow_tint, highlight_tint, sat))
	_lut_cache[key] = tex
	return tex


## The LUT_SIZE slices of the grade LUT (blue is the slice). Pure: safe on a worker thread.
static func lut_slices(shadow_tint: Vector3, highlight_tint: Vector3, sat: float) -> Array[Image]:
	var n := LUT_SIZE
	var slices: Array[Image] = []
	for bz in n:
		var img := Image.create_empty(n, n, false, Image.FORMAT_RGB8)
		for gy in n:
			for rx in n:
				var c := grade(Vector3(rx, gy, bz) / float(n - 1), shadow_tint, highlight_tint, sat)
				img.set_pixel(rx, gy, Color(c.x, c.y, c.z))
		slices.append(img)
	return slices


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


## The styled material for a stand-in material (matched by its key in resource_name), or null to keep it. A flat
## stand-in colour (metadata FLAT_META: the scaffold's ground and road, the streamed city's tile materials until the
## P2 city look) gets a darker twin (flat_gain): the kit's textured surfaces read at about FLAT_GAIN of their vertex
## colour, and the plain light colours (sand, dust, footpaths) under the look's exposure read near white (P1-028).
func material_for(original: Material) -> Material:
	if original == null:
		return null
	var m: Material = _mats.get(original.resource_name)
	if m == null and original is StandardMaterial3D and original.has_meta(FLAT_META):
		m = _flat_twin(original)
	return m


## The albedo gain of a flat stand-in colour (linear): FLAT_GAIN for light colours, none for dark ones (asphalt stays
## asphalt, so a road with no lamps at night does not sink into black). Pure.
static func flat_gain(linear: Color) -> float:
	var l := linear.r * 0.2126 + linear.g * 0.7152 + linear.b * 0.0722
	return lerpf(1.0, FLAT_GAIN, smoothstep(0.06, 0.3, l))


func _flat_twin(o: StandardMaterial3D) -> StandardMaterial3D:
	if _flat.has(o):
		return _flat[o]
	var tw := o.duplicate() as StandardMaterial3D
	var c := o.albedo_color.srgb_to_linear()
	var g := flat_gain(c)
	tw.albedo_color = Color(c.r * g, c.g * g, c.b * g, c.a).linear_to_srgb()
	_flat[o] = tw
	return tw


## Called for every MeshInstance3D that enters the tree, after its materials are swapped. Look B adds nothing.
func decorate(_mi: MeshInstance3D) -> void:
	pass
