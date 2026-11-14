## Style test B, batch B (game arg --style=stylised_b, STYLE_OPTIONS.md "Batch B"): look B+D (stylised_grime.gd)
## plus the owner's style round 3 asks: a day-night cycle (--light=dawn|afternoon|golden|night or --time=<0..24>,
## day_cycle.gd), much stronger grime on the Old Delhi bazaar only, Delhi detail dressing, generated tiling textures
## and a trim sheet, per-area haze and dust, heat shimmer and night lights.
## Everything here is render setup, materials, decals, lights, particles and procedural dressing laid on the
## stand-ins from the anchors their builder records (geo.gd Sink.anchors: windows, shops, roofs, tanks, lamps,
## vehicles, footpaths, the bazaar lane). Gameplay, camera and UI are untouched, and the default look never loads
## this file. Every sign, stencil and poster is invented (no real brands, parties or offices).
## --style-off=<a,b> switches features off to measure their cost: volfog, shimmer, dressing, lights, textures, decals,
## ssao, ssil, glow, sunshadow (and shadow options nopcss, noblend, split2, near80, dshadow; ssq; p34 = P0-034 setup).
## P0-037 lean path (_lean(), the performance target; realistic.gd turns it off): see environment() and setup_sun().
extends "res://render/styles/stylised_grime.gd"

const SURFACE_B := preload("res://render/shaders/surface_b.gdshader")
const SHIMMER_SHADER := preload("res://render/shaders/shimmer.gdshader")
const GLOW_WINDOW_SHADER := preload("res://render/shaders/glow_window.gdshader")
const HAZE_SHADER := preload("res://render/shaders/haze_b.gdshader")
const Geo := preload("res://scenes/standin/geo.gd")
const Kit := preload("res://scenes/standin/kit.gd")
const TEX_DIR := "res://render/textures/"
const LAYERS := ["plaster", "brick", "concrete", "asphalt", "paver", "shutter"]
const DRESS_SEED := 20261112
## Trim sheet rows (v ranges of trim.png).
const T_BAND := Rect2(0, 0.0, 1, 0.25)
const T_SILL := Rect2(0, 0.25, 1, 0.25)
const T_PAINT := Rect2(0, 0.5, 1, 0.25)
const T_DRUM := Rect2(0, 0.75, 1, 0.25)
## Invented shop names in Hindi (Devanagari), for hand-painted boards.
const HINDI := ["गुप्ता मिष्ठान भंडार", "शर्मा जनरल स्टोर", "न्यू राजा टेलर्स", "बंसल बर्तन भंडार", "जय माता दी किराना",
	"खान बिरयानी", "आनंद फोटो स्टूडियो", "मेहता ड्राई क्लीनर्स", "सिंह टायर वर्क्स", "लक्ष्मी साड़ी केंद्र",
	"पंडित चाट भंडार", "रॉयल मोबाइल", "दुर्गा हार्डवेयर", "नूर क्लॉथ हाउस", "हरी ओम दवाखाना", "कपूर ज्वैलर्स"]
const GRILLE_COLS := [Color("#1f3b2f"), Color("#1c1c1e"), Color("#e9e6dc"), Color("#2c4f7c"), Color("#4a2f22")]
const FRAME_COLS := [Color("#e8e4d8"), Color("#2f5d50"), Color("#6b4a2e"), Color("#3c5a8a"), Color("#8a8d86")]
const CLOTH_COLS := [Color("#c2185b"), Color("#f2c230"), Color("#1f6f8b"), Color("#e67e22"), Color("#f4efe4"),
	Color("#3a7d44"), Color("#7a4a8c"), Color("#b03a2e"), Color("#2c3e70")]
const NEON_COLS := [Color("#ff3fa4"), Color("#36e0ff"), Color("#7dff5a"), Color("#ffd23f"), Color("#ff5a36")]
const DOG_COLS := [Color("#b98a5a"), Color("#7a5232"), Color("#d8c3a0"), Color("#3a302a")]
const SODIUM := Color("#ffa04a")

var off := {}
static var _tiles: Texture2DArray = null
static var _trim: Texture2D = null
static var _grille: Texture2D = null
static var _font: SystemFont = null

# per decorate call
var _s: Geo.Sink
## small detail that casts no shadow (wires, frames, lit panels, neon): shadow passes were the main dressing cost
var _n: Geo.Sink
var _u := {}
var _h: Node3D
var _r := RandomNumberGenerator.new()
var _wear := 0.0
var _avoid: Array = []
## a second dressing rng for the night lights a live scene makes ahead (P1-028): the main one keeps its order, so the
## day dressing is the same with or without them
var _r2 := RandomNumberGenerator.new()

# live relight (P1-028): what follows the day clock inside a loaded scene
## [light node, energy per unit of night (-1: a daylight bounce light), night from which it shows]
var _night_lights: Array = []
## [haze ShaderMaterial, block wear]
var _hazes: Array = []
## [shimmer MeshInstance3D, its ShaderMaterial]
var _shimmers: Array = []


## Switch features off by name (cost measuring); rebuilds the materials.
func set_off(list: PackedStringArray) -> void:
	for k in list:
		off[k.strip_edges()] = true
	_mats = _build_materials()


# ---------------------------------------------------------------- environment


func environment() -> Environment:
	if _env != null:
		return _env
	var env := super()
	if not _lean():
		_volfog_for_haze_volumes(env)
	else:
		# P0-037 (performance target, about 10 to 11 ms GPU): no volumetric fog at all, the bazaar haze is a cheap depth
		# haze box (_haze); the screen-space light passes run at low quality (the soft look stays, about 1.5 ms less)
		if not off.has("ssq"):
			RenderingServer.environment_set_ssil_quality(RenderingServer.ENV_SSIL_QUALITY_LOW, true, 0.5, 2, 50.0, 300.0)
			RenderingServer.environment_set_ssao_quality(RenderingServer.ENV_SSAO_QUALITY_LOW, true, 0.5, 2, 50.0, 300.0)
	# cost measuring only (--style-off): the screen-space passes of the base look
	if off.has("ssao"):
		env.ssao_enabled = false
	if off.has("ssil"):
		env.ssil_enabled = false
	if off.has("glow"):
		env.glow_enabled = false
	return env


## The light-driven settings (stylised.gd) plus the lean path's night fill and dawn contrast, so a live relight sets
## them too.
func light_environment(env: Environment, sync := true) -> void:
	super(env, sync)
	# lit sign boards of the area kits and their pavement pools (P2-048: the project global kit_night)
	RenderingServer.global_shader_parameter_set("kit_night", 0.0 if off.has("lights") else clampf(light.night, 0.0, 1.0))
	if not _lean():
		return
	# moonlit sky fill at night: a cool grey-blue ambient so no surface that faces away from every lamp goes black
	var n: float = light.night
	if n > 0.0:
		env.ambient_light_color = Color(0.36, 0.42, 0.58)
		env.ambient_light_sky_contribution = 1.0 - 0.55 * n
		env.ambient_light_energy = light.ambient_energy * (1.0 + 0.9 * n)
	else:
		# the Environment defaults (what a daylight build never touched)
		env.ambient_light_color = Color(0, 0, 0, 1)
		env.ambient_light_sky_contribution = 1.0
	# dawn reads flat through its thick haze: a little more contrast and slightly thinner haze
	var dawn := _dawn_weight()
	env.adjustment_contrast = preset.contrast + 0.08 * dawn
	env.fog_density = light.fog_density * (1.0 - 0.15 * dawn)


## The lean (performance target) path of stylised B; the realistic reference look (realistic.gd) keeps the P0-034 setup.
## --style-off=p34 measures the P0-034 setup against it.
func _lean() -> bool:
	return not off.has("p34")


## 1 for a low morning sun in the east (the dawn preset, or early hours on --time), 0 otherwise.
func _dawn_weight() -> float:
	if light.sun_azimuth_deg > 180.0 or light.sun_elevation_deg < -5.0:
		return 0.0
	return clampf((20.0 - light.sun_elevation_deg) / 13.0, 0.0, 1.0) * clampf((0.7 - light.night) / 0.3, 0.0, 1.0)


## Volumetric fog only feeding the per-area FogVolume (P0-034 batch B; the realistic look still uses it).
func _volfog_for_haze_volumes(env: Environment) -> void:
	if off.has("volfog"):
		return
	env.volumetric_fog_enabled = true
	env.volumetric_fog_density = 0.0
	env.volumetric_fog_albedo = light.area_haze_color
	env.volumetric_fog_anisotropy = 0.55
	env.volumetric_fog_length = 140.0
	env.volumetric_fog_detail_spread = 2.0
	env.volumetric_fog_ambient_inject = 0.35
	env.volumetric_fog_sky_affect = 0.0
	env.volumetric_fog_temporal_reprojection_enabled = true


func setup_sun(sun: DirectionalLight3D) -> void:
	super(sun)
	if _lean():
		# P0-037, measured in the bazaar (Vulkan): the sun's soft shadows (PCSS, from its angular size) cost about
		# 1.8 ms and blending the shadow splits about 1 ms more. A plain filtered shadow with a wider blur keeps the
		# soft stylised edge; the shadow map itself (triangles, distance, splits) was not the cost.
		sun.light_angular_distance = 0.0
		sun.shadow_blur = 1.6
		sun.directional_shadow_blend_splits = false
	if off.has("nopcss"):
		sun.light_angular_distance = 0.0
	if off.has("noblend"):
		sun.directional_shadow_blend_splits = false
	if off.has("split2"):
		sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	if off.has("near80"):
		sun.directional_shadow_max_distance = minf(light.shadow_max_distance, 80.0)
	if off.has("sunshadow"):
		sun.shadow_enabled = false


## Every wall decal: cost measuring with --style-off=decals.
func _decal(holder: Node3D, p: Vector3, y: float, n: Vector3, size: Vector2, tex: Texture2D, strength: float) -> void:
	if off.has("decals"):
		holder.add_child(Node3D.new())
		return
	super(holder, p, y, n, size, tex, strength)


## Heat shimmer over hot asphalt: a full-screen pass that wobbles the far ground a little (afternoon only).
## A live look (P1-028) makes it at any hour and shows it only while the light is hot (heat 0.3 or more). A
## WorldEnvironment with the metadata no_heat_shimmer gets none.
func decorate_environment(we: WorldEnvironment) -> void:
	if off.has("shimmer") or we.get_parent() == null or (light.heat < 0.3 and not can_relight()):
		return
	# a scene can opt out (the flat scaffold test ground: on its long plain edges the wobble read as broken geometry)
	if we.get_meta("no_heat_shimmer", false):
		return
	var q := QuadMesh.new()
	q.size = Vector2(2, 2)
	var m := ShaderMaterial.new()
	m.shader = SHIMMER_SHADER
	m.set_shader_parameter("strength", light.heat)
	q.material = m
	var mi := MeshInstance3D.new()
	mi.name = "HeatShimmer"
	mi.mesh = q
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.custom_aabb = AABB(Vector3(-1e5, -1e5, -1e5), Vector3(2e5, 2e5, 2e5))
	mi.set_meta("dressing", true)
	mi.visible = light.heat >= 0.3
	_shimmers.append([mi, m])
	we.get_parent().add_child.call_deferred(mi)


# ---------------------------------------------------------------- materials


func _build_materials() -> Dictionary:
	var m := super()
	m["matte"] = _surface_b(0, 0.92)
	m["road"] = _surface_b(1, 0.95)
	var leaf := _surface_b(2, 0.95)
	leaf.set_shader_parameter("albedo_saturation", 0.95)
	leaf.set_shader_parameter("backlight_tint", Vector3(0.35, 0.4, 0.15))
	m["leaf"] = leaf
	m["shutter"] = _surface_b(3, 0.6)
	m["plastic"] = _std(0.45, 0.0)
	var cloth := _std(0.85, 0.0)
	cloth.backlight_enabled = true
	cloth.backlight = Color(0.35, 0.3, 0.25)
	cloth.cull_mode = BaseMaterial3D.CULL_DISABLED
	m["cloth"] = cloth
	var tarp := _std(0.6, 0.0)
	tarp.backlight_enabled = true
	tarp.backlight = Color(0.25, 0.3, 0.4)
	tarp.cull_mode = BaseMaterial3D.CULL_DISABLED
	m["tarp"] = tarp
	m["lit"] = _glow(1.0 + 1.6 * light.night)
	m["tube"] = _glow(1.6 + 1.4 * light.night)
	m["neon"] = _glow(1.8 + 3.0 * light.night)
	# window panes of a live look (P1-028): every window has one, lit while its own draw is under the window share
	var win := ShaderMaterial.new()
	win.shader = GLOW_WINDOW_SHADER
	win.set_shader_parameter("gain", 1.0 + 1.6 * light.night)
	win.set_shader_parameter("share", 0.0 if off.has("lights") else light.window_share)
	m["winlit"] = win
	var trim := _std(0.85, 0.0)
	trim.albedo_texture = _trim_tex()
	trim.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	m["trim"] = trim
	var grille := _std(0.5, 0.3)
	grille.albedo_texture = _grille_tex()
	grille.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	grille.alpha_scissor_threshold = 0.5
	grille.cull_mode = BaseMaterial3D.CULL_DISABLED
	grille.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	m["grille"] = grille
	return m


func _surface_b(kind: int, rough: float) -> ShaderMaterial:
	var s := ShaderMaterial.new()
	s.shader = SURFACE_B
	s.set_shader_parameter("surface_kind", kind)
	s.set_shader_parameter("roughness_base", rough)
	s.set_shader_parameter("detail", preset.detail)
	s.set_shader_parameter("albedo_saturation", preset.albedo_saturation)
	s.set_shader_parameter("wear_scale", preset.wear_scale)
	s.set_shader_parameter("tex_mix", 0.0 if off.has("textures") else 1.0)
	s.set_shader_parameter("tiles", _tile_array())
	if _lean():
		# P0-037: softer marbled plaster, faint tar lines, ground cover on the bare earth
		s.set_shader_parameter("calm", 1.0)
		s.set_shader_parameter("mottle", 0.7)
	return s


func _glow(gain: float) -> ShaderMaterial:
	var g := ShaderMaterial.new()
	g.shader = GLOW_SHADER
	g.set_shader_parameter("gain", gain)
	return g


# ---------------------------------------------------------------- live relight (P1-028)


## True when this look makes its night lights and lit windows at any hour and moves them with the day clock.
func _live() -> bool:
	return can_relight() and not off.has("lights")


## The light-driven materials, then every tracked night light, haze box and shimmer pass, at the new light.
func _relight_materials() -> void:
	super()
	var n: float = light.night
	(_mats["lit"] as ShaderMaterial).set_shader_parameter("gain", 1.0 + 1.6 * n)
	(_mats["tube"] as ShaderMaterial).set_shader_parameter("gain", 1.6 + 1.4 * n)
	(_mats["neon"] as ShaderMaterial).set_shader_parameter("gain", 1.8 + 3.0 * n)
	var win: ShaderMaterial = _mats["winlit"]
	win.set_shader_parameter("gain", 1.0 + 1.6 * n)
	win.set_shader_parameter("share", 0.0 if off.has("lights") else light.window_share)
	var keep: Array = []
	for e in _night_lights:
		if is_instance_valid(e[0]):
			_set_night_light(e[0], e[1], e[2])
			keep.append(e)
	_night_lights = keep
	keep = []
	for e in _hazes:
		if (e[0] as ShaderMaterial).get_reference_count() > 1:
			_set_haze(e[0], e[1])
			keep.append(e)
	_hazes = keep
	keep = []
	for e in _shimmers:
		if is_instance_valid(e[0]):
			(e[0] as MeshInstance3D).visible = light.heat >= 0.3
			(e[1] as ShaderMaterial).set_shader_parameter("strength", light.heat)
			keep.append(e)
	_shimmers = keep


## Registers a night light the dressing made and sets it for the light now. energy is the light's energy at full night
## (it scales with night); a negative energy marks a daylight bounce light (bright by day, off at night).
func _night_light(l: Light3D, energy: float, from_night := 0.2) -> void:
	_set_night_light(l, energy, from_night)
	_night_lights.append([l, energy, from_night])


func _set_night_light(l: Light3D, energy: float, from_night: float) -> void:
	var n: float = light.night
	if energy < 0.0:
		var e: float = (1.0 - n) * 0.55
		l.light_energy = e
		l.light_color = light.sun_color.lerp(Color.WHITE, 0.4)
		l.visible = e >= 0.05
	else:
		l.light_energy = energy * n
		l.visible = n >= from_night


## Counts for the debug state (state().time.live): the night light nodes this look tracks and how many show now.
func live_stats() -> Dictionary:
	var on := 0
	var night := 0
	for e in _night_lights:
		if is_instance_valid(e[0]) and float(e[1]) >= 0.0:
			night += 1
			if (e[0] as Node3D).visible:
				on += 1
	return {"night": light.night, "windowShare": light.window_share, "nightLights": night, "nightLightsOn": on,
		"hazes": _hazes.size(), "shimmer": light.heat >= 0.3 and not _shimmers.is_empty()}


## A generated texture as an Image (imported texture first; the raw PNG only before the project was imported).
static func _image(path: String) -> Image:
	var img: Image = null
	if ResourceLoader.exists(path):
		var tex := load(path) as Texture2D
		if tex != null:
			img = tex.get_image()
	if img == null or img.is_empty():
		img = Image.load_from_file(path)
	if img == null or img.is_empty():
		img = Image.create_empty(8, 8, false, Image.FORMAT_RGBA8)
		img.fill(Color(0.5, 0.5, 0.5, 0.0))
	if img.get_format() != Image.FORMAT_RGBA8:
		img.convert(Image.FORMAT_RGBA8)
	img.generate_mipmaps()
	return img


## The six generated tiling layers (game/render/tools/make_textures.gd) as one Texture2DArray.
static func _tile_array() -> Texture2DArray:
	if _tiles == null:
		var imgs: Array[Image] = []
		for l in LAYERS:
			imgs.append(_image(TEX_DIR + "tile_" + l + ".png"))
		_tiles = Texture2DArray.new()
		_tiles.create_from_images(imgs)
	return _tiles


static func _trim_tex() -> Texture2D:
	if _trim == null:
		_trim = ImageTexture.create_from_image(_image(TEX_DIR + "trim.png"))
	return _trim


static func _grille_tex() -> Texture2D:
	if _grille == null:
		_grille = ImageTexture.create_from_image(_image(TEX_DIR + "grille.png"))
	return _grille


static func _devanagari() -> SystemFont:
	if _font == null:
		_font = SystemFont.new()
		_font.font_names = PackedStringArray(["Kohinoor Devanagari", "ITF Devanagari", "Devanagari Sangam MN",
			"Noto Sans Devanagari", "Nirmala UI", "Mangal"])
		_font.font_weight = 600
	return _font


# ---------------------------------------------------------------- signs


## Hand-painted boards: about two in five shop boards carry an invented Hindi name instead of the English one.
func decorate_label(l: Label3D) -> void:
	if l.has_meta("styled"):
		return
	l.set_meta("styled", true)
	var k := absi(hash(l.text + str(l.transform.origin.snapped(Vector3.ONE * 0.1))))
	if l.text.length() > 6 and k % 5 < 2:
		l.text = HINDI[k % HINDI.size()]
		l.font = _devanagari()
		l.pixel_size *= 1.15


func _label(text: String, xf: Transform3D, width: float, col: Color, hindi := false) -> void:
	var l := Label3D.new()
	l.text = text
	l.font_size = 48
	if hindi or _has_devanagari(text):
		l.font = _devanagari()
	var chars := maxf(3.0, text.length())
	l.pixel_size = minf(0.011, width * 0.85 / (chars * 0.55 * l.font_size))
	l.modulate = col
	l.shaded = true
	l.double_sided = false
	l.alpha_cut = Label3D.ALPHA_CUT_DISCARD
	l.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	# a Label3D faces +Z; our frames face local -Z
	l.transform = xf * Transform3D(Basis(Vector3.UP, PI), Vector3.ZERO)
	l.set_meta("styled", true)
	_h.add_child(l)


static func _has_devanagari(t: String) -> bool:
	for i in t.length():
		var c := t.unicode_at(i)
		if c >= 0x0900 and c <= 0x097F:
			return true
	return false


# ---------------------------------------------------------------- dressing


func decorate(mi: MeshInstance3D) -> void:
	if mi.has_meta("dressing"):
		return
	super(mi)
	if String(mi.name).begins_with("Landmark_") and not off.has("lights") and (light.night >= 0.2 or _live()):
		_floodlight(mi)
	if mi.has_meta("anchors"):
		# dress once the whole scene is in (people and vehicles of other blocks are known then)
		_dress.call_deferred(mi)


func _dress(mi: MeshInstance3D) -> void:
	if not is_instance_valid(mi) or not mi.is_inside_tree():
		return
	var anchors: Array = mi.get_meta("anchors")
	_wear = float(mi.get_meta("wear", 0.0))
	_r.seed = DRESS_SEED + absi(hash(String(mi.name)))
	_r2.seed = DRESS_SEED + 1 + absi(hash(String(mi.name)))
	_s = Geo.Sink.new()
	_n = Geo.Sink.new()
	_u = {}
	_h = Node3D.new()
	_h.name = "Dressing"
	_avoid = []
	for sib in mi.get_parent().get_children():
		for a in sib.get_meta("anchors", []):
			if a[0] == "person" or a[0] == "vehicle":
				_avoid.append(a[1].origin)
	var dress := not off.has("dressing")
	# night lights: made when the scene loads at night, or at any hour by a live look (hidden until the night comes)
	var at_night: bool = not off.has("lights") and light.night >= 0.2
	var lights: bool = at_night or _live()
	for a in anchors:
		var kind: String = a[0]
		var xf: Transform3D = a[1]
		var d: Dictionary = a[2]
		if dress:
			match kind:
				"window":
					_window(xf, d)
				"ac":
					_ac(xf)
				"balcony":
					_balcony(xf, d)
				"shop":
					_shop(xf, d, at_night)
				"board":
					_board(xf, d)
				"board2":
					_board2(xf, d)
				"roof":
					_roof(xf, d)
				"tank":
					_tank(xf, d)
				"path":
					_path(d)
				"junction":
					_junction(d)
				"lane":
					_lane(xf, d)
				"pole":
					_pole_lamp(xf, d, lights)
		elif kind == "shop" and lights:
			_shop_light(xf, d, _r if at_night else _r2)
		if lights:
			match kind:
				"lamp":
					_street_lamp(xf, d)
				"vehicle":
					_vehicle_lights(xf, d)
		if kind == "lane":
			if not off.has("volfog"):
				_haze(xf, d)
			if not off.has("lights"):
				_bounce(xf, d)
	for pair in [[_s, "DressingMesh", true], [_n, "DressingDetail", false]]:
		var dm := MeshInstance3D.new()
		dm.name = pair[1]
		dm.mesh = (pair[0] as Geo.Sink).to_mesh(_mats)
		dm.set_meta("dressing", true)
		dm.set_instance_shader_parameter("wear", _wear)
		if not pair[2] or off.has("dshadow"):
			dm.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		_h.add_child(dm)
	for k in _u:
		var um := MeshInstance3D.new()
		um.name = "Dressing_" + k
		um.mesh = _u[k].to_mesh(_mats[k])
		um.set_meta("dressing", true)
		if k == "grille":
			um.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		_h.add_child(um)
	mi.add_child(_h)


func _push(xf: Transform3D) -> void:
	_s.push(xf)
	_n.push(xf)


func _pop() -> void:
	_s.pop()
	_n.pop()


func _uv(key: String) -> UVMesh:
	if not _u.has(key):
		_u[key] = UVMesh.new()
	return _u[key]


## Outward wall normal (world) of a facade frame: the kit's fronts face local -Z.
static func _out(xf: Transform3D) -> Vector3:
	return (xf.basis * Vector3(0, 0, -1)).normalized()


func _free_of_people(p: Vector3, r: float) -> bool:
	for q in _avoid:
		if Vector2(p.x - q.x, p.z - q.z).length() < r:
			return false
	return true


## A small wall decal at a local point of a facade frame; it fades out by 55 m (small stains read as nothing further).
func _decal_at(xf: Transform3D, local: Vector3, size: Vector2, tex: Texture2D, strength: float) -> void:
	var p := xf * local
	_decal(_h, Vector3(p.x, 0, p.z), p.y, _out(xf), size, tex, strength)
	var d := _h.get_child(_h.get_child_count() - 1) as Decal
	if d == null:
		return
	d.distance_fade_begin = 40.0
	d.distance_fade_length = 15.0


func _window(xf: Transform3D, d: Dictionary) -> void:
	var tight := _wear > 0.3
	_push(xf)
	# sill and, often, a concrete sunshade (chhajja) over the window
	_uv("trim").box(_s.stack[-1], Vector3(0, -0.8, -0.11), Vector3(1.5, 0.08, 0.24), T_SILL, 1.0, Color(0.92, 0.9, 0.86))
	if _r.randf() < 0.45:
		_uv("trim").box(_s.stack[-1], Vector3(0, 0.92, -0.3), Vector3(1.75, 0.07, 0.6), T_SILL, 1.0, Color(0.9, 0.88, 0.84))
	# frame bars on the glass
	var fc: Color = Kit.pick(_r, FRAME_COLS)
	_n.box("satin", fc, Vector3(0, 0, -0.065), Vector3(0.05, 1.45, 0.02))
	_n.box("satin", fc, Vector3(0, 0.25, -0.065), Vector3(1.05, 0.045, 0.02))
	var draw := _r.randf()
	var lit: bool = draw < light.window_share and not off.has("lights")
	var lc: Color = [Color("#ffd9a0"), Color("#ffcf8a"), Color("#e9f1ff"), Color("#bcd6ff")][_r.randi_range(0, 3)]
	if _live():
		# every window gets a pane that lights while its draw is under the window share (glow_window.gdshader), so the
		# windows come on one by one as the evening goes (P1-028); the same draw as the pinned look's lit panes
		_n.box("winlit", Color(lc.r, lc.g, lc.b, draw), Vector3(0, 0, -0.058), Vector3(1.0, 1.4, 0.01))
	elif lit:
		_n.box("lit", lc, Vector3(0, 0, -0.058), Vector3(1.0, 1.4, 0.01))
	if _r.randf() < 0.35:
		var cc: Color = Kit.pick(_r, CLOTH_COLS)
		var side := -1.0 if _r.randf() < 0.5 else 1.0
		if lit:
			_n.box("lit", Color(lc.r * cc.r, lc.g * cc.g, lc.b * cc.b) * 0.8 + Color(0.1, 0.08, 0.05), Vector3(side * 0.26, 0, -0.062), Vector3(0.48, 1.38, 0.01))
		else:
			_n.box("cloth", cc, Vector3(side * 0.26, 0, -0.062), Vector3(0.48, 1.38, 0.01))
	if _r.randf() < (0.65 if tight else 0.45):
		_uv("grille").quad(_s.stack[-1], Vector3(0, 0, -0.13), Vector2(1.2, 1.55), Rect2(0, 0, 1, 1), Kit.pick(_r, GRILLE_COLS))
		for x in [-0.58, 0.58]:
			_s.box("metal", Color("#2a2c2e"), Vector3(x, 0, -0.09), Vector3(0.03, 1.5, 0.08))
	_pop()
	# soot and rain under the sill (stronger on worn blocks)
	if _wear > 0.3 and _r.randf() < 0.5:
		var l := _r.randf_range(0.9, 2.2)
		_decal_at(xf, Vector3(_r.randf_range(-0.2, 0.2), -0.85 - l * 0.5, 0), Vector2(_r.randf_range(0.7, 1.4), l), _tex2("sill"), clampf(_wear * 1.1, 0.0, 1.0))


func _ac(xf: Transform3D) -> void:
	_push(xf)
	# outdoor unit front: round fan grille, slats, brackets to the wall, a drip pipe
	var fan := Transform3D(Basis(Vector3.RIGHT, PI * 0.5) * Basis.from_scale(Vector3(0.2, 0.02, 0.2)), Vector3(0.14, 0.0, -0.555))
	_n.put("metal", Geo.unit_cyl(Geo.SEG_MID), fan, Color("#3a3c3e"))
	_n.put("metal", Geo.unit_cyl(Geo.SEG_SMALL), Transform3D(Basis(Vector3.RIGHT, PI * 0.5) * Basis.from_scale(Vector3(0.05, 0.03, 0.05)), Vector3(0.14, 0.0, -0.56)), Color("#8a8d90"))
	for i in 5:
		_n.box("satin", Color("#9a9c98"), Vector3(-0.24, -0.16 + i * 0.08, -0.556), Vector3(0.22, 0.02, 0.01))
	for x in [-0.3, 0.3]:
		_s.rod("metal", Color("#4a4d50"), Vector3(x, -0.29, -0.5), Vector3(x, -0.29, 0.02), 0.015)
		_s.rod("metal", Color("#4a4d50"), Vector3(x, -0.29, -0.45), Vector3(x, -0.75, 0.02), 0.015)
	_n.rod("satin", Color("#d8d6cf"), Vector3(0.36, -0.27, -0.12), Vector3(0.36, -1.6, -0.06), 0.012)
	_pop()
	_decal_at(xf, Vector3(0.1, -1.1, 0.25), Vector2(0.8, 1.5), _tex2("drip"), 0.55 + _wear * 0.45)


func _balcony(xf: Transform3D, d: Dictionary) -> void:
	var bw: float = d.bw
	_push(xf)
	_uv("grille").quad(_s.stack[-1], Vector3(0, 0.47, -0.035), Vector2(bw, 0.85), Rect2(0, 0.0, bw / 0.9, 1), Kit.pick(_r, GRILLE_COLS))
	_s.box("metal", Color("#2a2c2e"), Vector3(0, 0.93, 0), Vector3(bw + 0.04, 0.05, 0.08))
	# potted plants on the slab behind the rail
	for i in _r.randi_range(0, 3):
		var x := _r.randf_range(-bw * 0.4, bw * 0.4)
		_pot(Vector3(x, 0.0, 0.3))
	var line := bool(d.laundry) or _r.randf() < 0.35
	if line:
		var y := 1.55
		_n.wire("satin", Color("#cfcac0"), Vector3(-bw * 0.48, y, 0.25), Vector3(bw * 0.48, y, 0.25), 0.05, 0.006)
		var x := -bw * 0.42
		while x < bw * 0.4:
			var c: Color = Kit.pick(_r, CLOTH_COLS)
			var long := _r.randf() < 0.25
			var sz := Vector3(_r.randf_range(0.3, 0.5), 1.05 if long else _r.randf_range(0.35, 0.6), 0.015)
			_s.box("cloth", c, Vector3(x + sz.x * 0.5, y - 0.03 - sz.y * 0.5, 0.25), sz)
			x += sz.x + _r.randf_range(0.05, 0.25)
	_pop()


func _pot(p: Vector3) -> void:
	_s.cyl("matte", Color("#a85a3a"), p + Vector3(0, 0.13, 0), 0.13, 0.26, Geo.SEG_SMALL, 1.3)
	var r := _r.randf_range(0.14, 0.24)
	_s.ball("leaf", Kit.shade(Kit.LEAF, _r.randf_range(0.9, 1.3)), p + Vector3(0, 0.3 + r * 0.6, 0), Vector3(r, r * 1.1, r), Geo.SEG_SMALL)


## at_night: the scene was dressed at night (night lights from the main rng, as before P1-028); a live look also gives
## shops a light at any other hour, picked with the second rng and hidden until it is dark.
func _shop(xf: Transform3D, d: Dictionary, at_night: bool) -> void:
	var ow: float = d.ow
	var w: float = d.w
	var tight: bool = d.tight
	var closed: bool = light.night > 0.6 and _r.randf() < 0.4
	_push(xf)
	# rolling shutter: ribbed half-raised shutter over the old strip, guide rails, the rolled drum under the board
	_s.box("shutter", Kit.shade(Kit.SHUTTER, _r.randf_range(0.85, 1.15)), Vector3(0, 2.55, -0.09), Vector3(ow, 0.5, 0.02))
	for x in [-ow * 0.5, ow * 0.5]:
		_s.box("metal", Color("#55595c"), Vector3(x, 1.45, -0.07), Vector3(0.06, 2.75, 0.07))
	_uv("trim").box(_s.stack[-1], Vector3(0, 2.83, -0.12), Vector3(ow + 0.1, 0.1, 0.12), T_DRUM, 1.0, Color(0.75, 0.76, 0.76))
	if closed:
		_s.box("shutter", Kit.shade(Kit.SHUTTER, _r.randf_range(0.8, 1.1)), Vector3(0, 1.4, -0.6), Vector3(ow, 2.7, 0.03))
	else:
		# the shop tube light under the board, bright by day and night
		_n.box("tube", Color("#eef4ff"), Vector3(0, 2.72, -0.22), Vector3(minf(1.2, ow * 0.6), 0.035, 0.035))
		if tight and _r.randf() < 0.6:
			# strings of snack packets and goods hanging at the opening
			for k in _r.randi_range(2, 4):
				var x := (-1.0 if k % 2 == 0 else 1.0) * _r.randf_range(ow * 0.25, ow * 0.45)
				var c: Color = Kit.pick(_r, Kit.BOARDS)
				_n.rod("satin", Color("#cfcac0"), Vector3(x, 2.7, -0.62), Vector3(x, 1.85, -0.62), 0.005)
				for j in 4:
					_n.box("satin", Kit.shade(c, _r.randf_range(0.85, 1.15)), Vector3(x, 2.55 - j * 0.22, -0.625), Vector3(0.12, 0.14, 0.015), _r.randf_range(-0.3, 0.3))
	if tight and _r.randf() < 0.4:
		# electricity meter boxes on the wall pier, wires going up
		var mx := w * 0.5 - 0.22
		_s.box("satin", Color("#8f938f"), Vector3(mx, 2.3, -0.08), Vector3(0.32, 0.5, 0.14))
		_s.box("satin", Color("#20262a"), Vector3(mx, 2.38, -0.155), Vector3(0.18, 0.12, 0.01))
		for k in 3:
			_n.rod("satin", Kit.BLACK, Vector3(mx - 0.08 + k * 0.08, 2.55, -0.1), Vector3(mx - 0.1 + k * 0.1, 4.4 + k * 0.1, -0.12), 0.01)
	_pop()
	# about half the open shops get a real light (the rest glow through their tube): lights cost 2 ms in the lane.
	# Lean (P0-037): one open shop in three, and only once it is properly dark (the night sky fill does the rest)
	var share := 0.34 if _lean() else 0.5
	if not closed and at_night and (light.night >= 0.5 or not _lean()):
		if _r.randf() < share:
			_shop_light(xf, d, _r)
	elif not closed and _live() and _r2.randf() < share:
		_shop_light(xf, d, _r2)
	# paan stains at the wall base beside the shop and torn poster layers on the pier (worn blocks)
	if _wear > 0.5:
		if _r.randf() < 0.7:
			_decal_at(xf, Vector3(w * 0.5 - 0.15, _r.randf_range(0.35, 0.8), 0), Vector2(0.5, 0.6) * _r.randf_range(0.8, 1.4), _tex2("paan"), 1.0)
		if _r.randf() < 0.6:
			_decal_at(xf, Vector3(w * 0.5, _r.randf_range(1.8, 2.3), 0), Vector2(0.55, 0.75), _tex2("torn"), 1.0)


func _shop_light(xf: Transform3D, d: Dictionary, rng: RandomNumberGenerator) -> void:
	var o := OmniLight3D.new()
	o.light_color = Color("#e8f0ff") if rng.randf() < 0.6 else Color("#ffd49a")
	o.light_energy = (2.2 if _lean() else 1.8) * light.night
	o.omni_range = 7.0 if _lean() else 6.0
	o.omni_attenuation = 1.4
	o.light_specular = 0.3
	o.position = xf * Vector3(0, 2.3, -1.0)
	o.light_volumetric_fog_energy = 0.0
	# lean: only once it is properly dark (the night sky fill does the rest)
	_night_light(o, 2.2 if _lean() else 1.8, 0.5 if _lean() else 0.2)
	_h.add_child(o)


func _board(xf: Transform3D, d: Dictionary) -> void:
	if _r.randf() > (0.35 if _wear > 0.3 else 0.22):
		return
	var w: float = d.w
	var h: float = d.h
	var c: Color = Kit.pick(_r, NEON_COLS)
	_push(xf)
	for y in [-h * 0.5 - 0.02, h * 0.5 + 0.02]:
		_n.box("neon", c, Vector3(0, y, -0.03), Vector3(w + 0.04, 0.035, 0.03))
	for x in [-w * 0.5 - 0.02, w * 0.5 + 0.02]:
		_n.box("neon", c, Vector3(x, 0, -0.03), Vector3(0.035, h + 0.04, 0.03))
	_pop()


func _board2(xf: Transform3D, d: Dictionary) -> void:
	var c: Color = d.get("color", Color.WHITE)
	var ink := Color("#1a1a1a") if c.get_luminance() > 0.55 else Color("#fbf7ea")
	_label(HINDI[_r.randi_range(0, HINDI.size() - 1)], xf * Transform3D(Basis.IDENTITY, Vector3(0, 0, -0.01)), d.w, ink, true)


func _roof(xf: Transform3D, d: Dictionary) -> void:
	var w: float = d.w
	var dp: float = d.d
	var far: bool = d.get("far", false)
	if far and _wear < 0.3:
		return
	var z0 := -dp * 0.5 + 0.7
	var z1 := -dp * 0.5 + maxf(1.2, dp * 0.33)
	_push(xf)
	if _r.randf() < 0.3:
		# unfinished next floor: column stubs with rusty rebar sticking up
		for cx in [-w * 0.5 + 0.35, w * 0.5 - 0.35]:
			var cz := z0 + 0.1
			_s.box("matte", Kit.CEMENT, Vector3(cx, 0.25, cz), Vector3(0.3, 0.5, 0.3))
			for k in 4:
				var o := Vector3((k % 2) * 0.16 - 0.08, 0, (k / 2) * 0.16 - 0.08)
				_n.rod("metal", Color("#4a3426"), Vector3(cx, 0.5, cz) + o, Vector3(cx, 0.5 + _r.randf_range(0.8, 1.4), cz) + o + Vector3(_r.randf_range(-0.12, 0.12), 0, _r.randf_range(-0.12, 0.12)), 0.012)
	if _r.randf() < 0.3:
		# dish antenna on a short pole
		var p := Vector3(_r.randf_range(-w * 0.35, w * 0.35), 0, _r.randf_range(z0, z1))
		_s.rod("metal", Color("#8a8d90"), p, p + Vector3(0, 1.1, 0), 0.025)
		_s.put("satin", Geo.unit_dome(Geo.SEG_MID), Transform3D(Basis(Vector3.RIGHT, deg_to_rad(-65)) * Basis.from_scale(Vector3(0.32, 0.1, 0.32)), p + Vector3(0, 1.2, 0)), Color("#e4e2dc"))
	if not far and _r.randf() < 0.35:
		# clothes line between two poles
		var a := Vector3(-w * 0.35, 0, _r.randf_range(z0, z1))
		var b := Vector3(w * 0.35, 0, a.z + _r.randf_range(-0.3, 0.3))
		for p in [a, b]:
			_s.rod("metal", Color("#6b7073"), p, p + Vector3(0, 1.7, 0), 0.02)
		_n.wire("satin", Color("#cfcac0"), a + Vector3(0, 1.65, 0), b + Vector3(0, 1.65, 0), 0.12, 0.006)
		var t := 0.12
		while t < 0.88:
			var c: Color = Kit.pick(_r, CLOTH_COLS)
			var sz := Vector3(_r.randf_range(0.3, 0.55), _r.randf_range(0.4, 0.9), 0.015)
			var p := a.lerp(b, t) + Vector3(0, 1.62 - 0.12 * 4.0 * t * (1.0 - t) - sz.y * 0.5, 0)
			_s.put("cloth", Geo.unit_box(), Transform3D(Basis(Vector3.UP, atan2(-(b - a).z, (b - a).x)) * Basis.from_scale(sz), p), c)
			t += _r.randf_range(0.1, 0.18)
	if _r.randf() < 0.22:
		# a blue tarp over junk
		var p := Vector3(_r.randf_range(-w * 0.3, w * 0.3), 0.3, _r.randf_range(z0, z1))
		_s.box("matte", Color("#6b5a48"), p + Vector3(0, -0.1, 0), Vector3(1.0, 0.4, 0.8))
		_s.box("tarp", Color("#2f6fb8"), p + Vector3(0, 0.12, 0), Vector3(1.5, 0.05, 1.1), _r.randf_range(-0.4, 0.4))
	if not far:
		for i in _r.randi_range(0, 3):
			_pot(Vector3(_r.randf_range(-w * 0.4, w * 0.4), 0, z0 - 0.2))
	_pop()


## Roof water tank: ribbed plastic body, domed top with a lid and a stand, enclosing the stand-in cylinder (which read
## as a hole from above).
func _tank(xf: Transform3D, d: Dictionary) -> void:
	var raised: bool = d.get("lid", true)
	var r := _r.randf()
	var body := Color("#2a2c2e") if r < 0.7 else (Color("#d9d6ce") if r < 0.85 else Color("#3d6e9e"))
	var lid := body.lightened(0.28) if r < 0.7 else body.darkened(0.12)
	_push(xf)
	_s.cyl("plastic", body, Vector3(0, 0.62, 0), 0.6, 1.24, Geo.SEG_MID)
	for y in [0.3, 0.62, 0.94]:
		_s.cyl("plastic", body.lightened(0.08), Vector3(0, y, 0), 0.615, 0.05, Geo.SEG_MID)
	_s.dome("plastic", body.lightened(0.05), Vector3(0, 1.24, 0), 0.6, 0.13, Geo.SEG_MID)
	_s.cyl("plastic", lid, Vector3(0, 1.39, 0), 0.24, 0.1, Geo.SEG_MID)
	_s.cyl("plastic", lid.lightened(0.15), Vector3(0, 1.445, 0), 0.2, 0.012, Geo.SEG_MID)
	if raised:
		for z in [-0.3, 0.3]:
			_s.box("matte", Kit.CEMENT, Vector3(0, -0.075, z), Vector3(1.25, 0.15, 0.28))
	_s.rod("satin", Color("#8a8f92"), Vector3(0.55, 0.15, 0), Vector3(0.55, -0.12 if raised else 0.05, 0), 0.03)
	_s.rod("satin", Color("#8a8f92"), Vector3(0.55, -0.12 if raised else 0.05, 0), Vector3(1.6, -0.12 if raised else 0.05, 0.2), 0.03)
	_pop()


func _path(d: Dictionary) -> void:
	var x0: float = d.x0
	var x1: float = d.x1
	var kerb: float = d.kerb
	var road: float = d.road
	var top: float = d.top
	var z0: float = maxf(d.z0, -150.0)
	var z1: float = minf(d.z1, 150.0)
	var shop_x := x0 + 0.9 if road > 0 else x1 - 0.9
	var kerb_in := kerb - road * 0.7
	var face_road := -PI * 0.5 if road > 0 else PI * 0.5
	# black and yellow painted kerb near the junction
	var zj := z0 if absf(z0) < absf(z1) else z1
	var zj_far := zj + signf(zj) * 36.0
	_uv("trim").box(Transform3D.IDENTITY, Vector3(kerb, (top + 0.03) * 0.5, (zj + zj_far) * 0.5), Vector3(0.235, top + 0.03, absf(zj_far - zj)), T_PAINT, 0.5, Color.WHITE)
	var z := z0 + 6.0
	var n := 0
	while z < z1 - 4.0:
		var r := _r.randf()
		var p := Vector3(shop_x, top, z)
		if r < 0.3 and _free_of_people(p, 1.6):
			# a row of parked scooters and bikes at the shop side, noses to the shops
			for k in _r.randi_range(3, 5):
				var q := p + Vector3(0, 0, k * 0.85)
				if _free_of_people(q, 0.8):
					_push(Kit.at(q, face_road + PI + _r.randf_range(-0.25, 0.25)))
					Kit.scooter(_s, Kit.pick(_r, [Color("#c0392b"), Color("#1c1c1e"), Color("#e8e8e4"), Color("#1f5fa8"), Color("#7a7d7e")]))
					_pop()
			z += 5.0
		elif r < 0.42:
			_electric_box(Vector3(kerb_in - road * 0.15, top, z), face_road)
		elif r < 0.56:
			_broken_kerb(kerb, road, top, z)
		elif r < 0.66 and _free_of_people(p, 1.5):
			_dog(p + Vector3(road * 0.6, 0, 0), _r.randf_range(0, TAU), _r.randf() < 0.6)
		elif r < 0.72 and _free_of_people(p + Vector3(road * 1.3, 0, 0), 2.0):
			_cart(p + Vector3(road * 1.3, 0, 0), _r.randf_range(-0.2, 0.2))
		elif r < 0.85:
			for i in _r.randi_range(1, 2):
				_pot(Vector3(shop_x - road * 0.45, top, z + i * 0.5))
		z += _r.randf_range(7.0, 13.0)
		n += 1
	# a milestone on the west footpath, north half
	if road > 0 and z1 < 0:
		_milestone(Vector3(kerb_in, top, -95.0), -PI * 0.5)
	# wires along the shop fronts from pier to pier
	var wx := x0 + 0.25 if road > 0 else x1 - 0.25
	var wz := z0
	while wz < z1 - 8.0:
		var b := wz + _r.randf_range(7.0, 10.0)
		for k in 2:
			_n.wire("satin", Kit.BLACK, Vector3(wx, 4.6 + k * 0.22, wz), Vector3(wx, 4.6 + k * 0.22 + _r.randf_range(-0.1, 0.1), b), _r.randf_range(0.15, 0.45))
		wz = b


func _electric_box(p: Vector3, yaw: float) -> void:
	_push(Kit.at(p, yaw))
	_s.box("paint", Color("#3f6b4a"), Vector3(0, 0.7, 0), Vector3(0.9, 1.3, 0.5))
	_s.box("paint", Color("#355c40"), Vector3(0, 1.38, 0), Vector3(1.0, 0.06, 0.6))
	_s.box("matte", Kit.CEMENT, Vector3(0, 0.05, 0), Vector3(1.1, 0.1, 0.7))
	_s.box("satin", Color("#f2c230"), Vector3(0.0, 1.05, -0.255), Vector3(0.3, 0.26, 0.01))
	for k in 3:
		_n.rod("satin", Kit.BLACK, Vector3(-0.3 + k * 0.1, 1.3, 0.2), Vector3(-0.5 + k * 0.15, 0.0, 0.5), 0.02)
	_pop()
	var f := Kit.at(p, yaw)
	_label("खतरा 440V", f * Transform3D(Basis.IDENTITY, Vector3(0, 0.7, -0.26)), 0.75, Color("#f4efe4"), true)
	_label("KVS-27", f * Transform3D(Basis.IDENTITY, Vector3(0, 0.45, -0.26)), 0.5, Color("#f4efe4"))


func _broken_kerb(kerb: float, road: float, top: float, z: float) -> void:
	# a missing kerb stone (dark gap), the stone lying tipped on the road, chips and rubble
	_s.box("matte", Color("#3a342c"), Vector3(kerb, top + 0.025, z), Vector3(0.26, 0.012, 0.85))
	_s.box("matte", Color("#4a443b"), Vector3(kerb + road * 0.12, top * 0.5, z), Vector3(0.03, top, 0.85))
	_push(Transform3D(Basis(Vector3.UP, _r.randf_range(-0.4, 0.4)) * Basis(Vector3.BACK, road * 0.35), Vector3(kerb + road * 0.45, 0.12, z + 0.2)))
	_s.box("matte", Kit.KERB, Vector3.ZERO, Vector3(0.22, 0.2, 0.8))
	_pop()
	for i in 5:
		var c := Vector3(kerb + road * _r.randf_range(0.2, 0.9), 0.03, z + _r.randf_range(-0.6, 0.6))
		_s.box("matte", Kit.shade(Kit.KERB, _r.randf_range(0.7, 1.0)), c, Vector3.ONE * _r.randf_range(0.05, 0.12), _r.randf_range(0, PI))


func _dog(p: Vector3, yaw: float, lying: bool) -> void:
	var c: Color = Kit.pick(_r, DOG_COLS)
	var c2 := c.lightened(0.25)
	_push(Kit.at(p, yaw))
	if lying:
		_s.ball("satin", c, Vector3(0, 0.14, 0), Vector3(0.2, 0.14, 0.38), Geo.SEG_MID)
		_s.ball("satin", c, Vector3(0.02, 0.17, -0.36), Vector3(0.1, 0.1, 0.12), Geo.SEG_MID)
		_s.ball("satin", c2, Vector3(0.03, 0.12, -0.48), Vector3(0.05, 0.05, 0.08), Geo.SEG_SMALL)
		for x in [-0.06, 0.08]:
			_s.box("satin", c, Vector3(x, 0.05, -0.45), Vector3(0.06, 0.05, 0.22))
		_s.rod("satin", c, Vector3(0, 0.1, 0.34), Vector3(0.2, 0.04, 0.55), 0.03)
		for x in [-0.05, 0.08]:
			_s.box("satin", c.darkened(0.2), Vector3(x, 0.27, -0.33), Vector3(0.04, 0.06, 0.04))
	else:
		_s.ball("satin", c, Vector3(0, 0.48, 0), Vector3(0.15, 0.16, 0.36), Geo.SEG_MID)
		for lx in [-0.08, 0.08]:
			for lz in [-0.24, 0.24]:
				_s.rod("satin", c, Vector3(lx, 0.45, lz), Vector3(lx, 0.02, lz - 0.02), 0.035)
		_s.rod("satin", c, Vector3(0, 0.55, -0.3), Vector3(0, 0.68, -0.4), 0.06)
		_s.ball("satin", c, Vector3(0, 0.72, -0.44), Vector3(0.09, 0.09, 0.11), Geo.SEG_MID)
		_s.ball("satin", c2, Vector3(0, 0.68, -0.56), Vector3(0.045, 0.045, 0.07), Geo.SEG_SMALL)
		for x in [-0.05, 0.05]:
			_s.box("satin", c.darkened(0.2), Vector3(x, 0.82, -0.42), Vector3(0.035, 0.07, 0.035))
		_s.rod("satin", c, Vector3(0, 0.55, 0.32), Vector3(0, 0.7, 0.5), 0.025)
	_pop()


func _cart(p: Vector3, yaw: float) -> void:
	_push(Kit.at(p, yaw))
	Kit.handcart(_s, _r)
	for x in [-0.5, 0.5]:
		for z in [-0.9, 0.9]:
			_s.rod("metal", Kit.STEEL, Vector3(x, 0.85, z), Vector3(x, 2.1, z), 0.02)
	_s.box("tarp", Kit.pick(_r, [Color("#2f6fb8"), Color("#e67e22"), Color("#2e8b57")]), Vector3(0, 2.15, 0), Vector3(1.4, 0.03, 2.3), 0.0)
	_pop()


func _milestone(p: Vector3, yaw: float) -> void:
	var f := Kit.at(p, yaw)
	_push(f)
	_s.box("matte", Color("#efece4"), Vector3(0, 0.3, 0), Vector3(0.5, 0.6, 0.22))
	_s.put("satin", Geo.unit_cyl(Geo.SEG_MID), Transform3D(Basis(Vector3.RIGHT, PI * 0.5) * Basis.from_scale(Vector3(0.25, 0.22, 0.25)), Vector3(0, 0.6, 0)), Color("#f2c230"))
	_s.box("matte", Kit.CEMENT, Vector3(0, 0.03, 0), Vector3(0.6, 0.06, 0.32))
	_pop()
	_label("लाल किला", f * Transform3D(Basis.IDENTITY, Vector3(0, 0.66, -0.115)), 0.42, Color("#1a1a1a"), true)
	_label("RED FORT", f * Transform3D(Basis.IDENTITY, Vector3(0, 0.42, -0.115)), 0.42, Color("#1a1a1a"))
	_label("4 km", f * Transform3D(Basis.IDENTITY, Vector3(0, 0.22, -0.115)), 0.3, Color("#1a1a1a"))


func _junction(d: Dictionary) -> void:
	var c: float = d.carriage
	var half: float = d.half
	for b in [[Vector3(-c + 0.9, 0, -half + 3.0), 0.15], [Vector3(-c + 0.9, 0, -half + 5.4), -0.1], [Vector3(15.4, 0, 24.0), 0.0]]:
		_barricade(b[0], PI * 0.5 + b[1])


## Steel traffic barricade with black and yellow boards and an invented stencil.
func _barricade(p: Vector3, yaw: float) -> void:
	var f := Kit.at(p, yaw)
	_push(f)
	for x in [-0.95, 0.95]:
		_s.rod("metal", Color("#3a3d40"), Vector3(x, 0.0, -0.25), Vector3(x, 1.1, 0), 0.025)
		_s.rod("metal", Color("#3a3d40"), Vector3(x, 0.0, 0.25), Vector3(x, 1.1, 0), 0.025)
		_s.box("metal", Color("#3a3d40"), Vector3(x, 0.02, 0), Vector3(0.08, 0.04, 0.6))
	_s.box("satin", Color("#f2f0ea"), Vector3(0, 1.0, -0.03), Vector3(1.4, 0.24, 0.02))
	_pop()
	for y in [0.42, 0.72]:
		_uv("trim").box(f, Vector3(0, y, -0.03), Vector3(2.0, 0.22, 0.03), T_PAINT, 1.0, Color.WHITE)
	_label("TRAFFIC  यातायात", f * Transform3D(Basis.IDENTITY, Vector3(0, 1.0, -0.045)), 1.25, Color("#b0261c"), true)


func _lane(xf: Transform3D, d: Dictionary) -> void:
	var hw: float = d.hw
	var z0: float = d.z0
	var z1: float = d.z1
	var cx := xf.origin.x
	# tangled wire bundles across the lane (heavier than the stand-in), loops and droops
	var z := z0 + 3.0
	while z < z1:
		var ya := _r.randf_range(6.2, 9.8)
		for k in _r.randi_range(3, 6):
			var a := Vector3(cx - hw + 0.1, ya + _r.randf_range(-0.3, 0.3), z + _r.randf_range(-0.6, 0.6))
			var b := Vector3(cx + hw - 0.1, ya + _r.randf_range(-0.5, 0.5), z + _r.randf_range(-1.5, 1.5))
			_n.wire("satin", Kit.BLACK, a, b, _r.randf_range(0.3, 1.4), _r.randf_range(0.01, 0.02))
		if _r.randf() < 0.35:
			# a coil of spare cable hanging off the bundle
			var c := Vector3(cx + _r.randf_range(-hw * 0.6, hw * 0.6), ya - 1.0, z)
			for i in 10:
				var a0 := i * TAU / 10.0
				var a1 := (i + 1) * TAU / 10.0
				_n.rod("satin", Kit.BLACK, c + Vector3(cos(a0) * 0.25, sin(a0) * 0.25, 0), c + Vector3(cos(a1) * 0.25, sin(a1) * 0.25, 0), 0.012)
		z += _r.randf_range(4.0, 7.0)
	# cable bundles along both shop rows just above the boards
	for xs in [-1.0, 1.0]:
		var wz := z0
		while wz < z1 - 3.0:
			var b := wz + _r.randf_range(4.0, 6.0)
			for k in 3:
				_n.wire("satin", Kit.BLACK, Vector3(cx + xs * (hw - 0.15), 4.05 + k * 0.12, wz), Vector3(cx + xs * (hw - 0.15), 4.05 + k * 0.12, b), _r.randf_range(0.1, 0.35), 0.012)
			wz = b
	# festive bunting strings
	for i in 4:
		var bz := _r.randf_range(z0 + 5.0, z1 - 5.0)
		var y := _r.randf_range(5.6, 6.6)
		var a := Vector3(cx - hw + 0.1, y, bz)
		var b := Vector3(cx + hw - 0.1, y, bz + _r.randf_range(-1.0, 1.0))
		_n.wire("satin", Color("#cfcac0"), a, b, 0.4, 0.006)
		for k in 14:
			var t := (k + 0.5) / 14.0
			var p := a.lerp(b, t) - Vector3(0, 0.4 * 4.0 * t * (1.0 - t) + 0.12, 0)
			_n.put("satin", Geo.unit_box(), Transform3D(Basis(Vector3.BACK, PI * 0.25) * Basis.from_scale(Vector3(0.16, 0.16, 0.01)), p), Kit.pick(_r, NEON_COLS + CLOTH_COLS))
	# tarps strung over the vendors
	for i in 3:
		var tz := _r.randf_range(z0 + 8.0, z1 - 12.0)
		var side := -1.0 if i % 2 == 0 else 1.0
		var tf := Transform3D(Basis(Vector3.BACK, side * 0.18), Vector3(cx + side * (hw - 1.3), 3.35, tz))
		_s.put("tarp", Geo.unit_box(), tf * Transform3D(Basis.from_scale(Vector3(2.6, 0.03, 3.2)), Vector3.ZERO), Kit.pick(_r, [Color("#2f6fb8"), Color("#e67e22"), Color("#c0392b")]))
	# stray dogs resting by the walls
	for i in 4:
		var p := Vector3(cx + (-1.0 if i % 2 == 0 else 1.0) * (hw - 0.55), 0.06, _r.randf_range(z0 + 4.0, z1 - 4.0))
		if _free_of_people(p, 1.2) and Vector2(p.x - (cx + 0.4), p.z - 41.5).length() > 3.5:
			_dog(p, _r.randf_range(0, TAU), i != 1)


## Dust and haze over a worn block: a box drawn with the cheap depth haze shader (haze_b.gdshader), denser near the
## ground. The realistic look overrides this with the P0-034 FogVolume (volumetric fog).
func _haze(xf: Transform3D, d: Dictionary) -> void:
	var hw: float = d.hw
	var size := Vector3(hw * 2.0 + 26.0, 24.0, d.z1 - d.z0 + 16.0)
	var centre := Vector3(xf.origin.x, 11.0, (d.z0 + d.z1) * 0.5)
	var bm := BoxMesh.new()
	bm.size = size
	var m := ShaderMaterial.new()
	m.shader = HAZE_SHADER
	m.set_shader_parameter("box_min", centre - size * 0.5)
	m.set_shader_parameter("box_max", centre + size * 0.5)
	_set_haze(m, _wear)
	_hazes.append([m, _wear])
	m.set_shader_parameter("height_falloff", 0.12)
	m.set_shader_parameter("max_alpha", 0.5)
	bm.material = m
	var mi := MeshInstance3D.new()
	mi.name = "AreaHaze"
	mi.mesh = bm
	mi.position = centre
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.set_meta("dressing", true)
	_h.add_child(mi)


## The haze colour and density of a block's haze box for the light now (lit by the sun by day, sodium at night).
func _set_haze(m: ShaderMaterial, wear: float) -> void:
	var n: float = light.night
	var day_light: float = 0.3 + 0.3 * light.sun_energy * (1.0 - n)
	var c: Color = light.area_haze_color.srgb_to_linear() * day_light
	c = c.lerp(SODIUM.srgb_to_linear() * 0.1, n)
	m.set_shader_parameter("haze_color", Vector3(c.r, c.g, c.b))
	m.set_shader_parameter("density", light.area_haze * wear * 0.32)


## Warm floodlights on a landmark at night (India Gate style), from the ground in front of it.
func _floodlight(mi: MeshInstance3D) -> void:
	var box := mi.get_aabb()
	var c := box.get_center()
	var holder := Node3D.new()
	holder.name = "Floodlights"
	for side in [-1.0, 1.0]:
		var p := Vector3(box.position.x - 6.0, 0.4, c.z + side * box.size.z * 0.3)
		var target := Vector3(c.x, box.position.y + box.size.y * 0.6, c.z)
		var s := SpotLight3D.new()
		s.light_color = Color("#ffd9a8")
		s.light_energy = 6.0 * light.night
		s.spot_range = box.size.length() * 0.9 + 10.0
		s.spot_angle = 40.0
		s.spot_attenuation = 0.6
		s.light_volumetric_fog_energy = 0.0
		s.transform = Transform3D(Basis.looking_at(target - p, Vector3.UP), p)
		_night_light(s, 6.0)
		holder.add_child(s)
	mi.add_child.call_deferred(holder)


## A lamp on a bazaar electricity pole: bracket, a bare bulb shade, and a cool tube light at night.
func _pole_lamp(xf: Transform3D, d: Dictionary, lights: bool) -> void:
	var o := xf.origin
	var tow: float = d.get("to", 1.0)
	var head := o + Vector3(tow * 0.9, 5.6, 0)
	_s.rod("metal", Kit.STEEL, o + Vector3(0, 5.8, 0), head + Vector3(0, 0.05, 0), 0.03)
	_s.box("satin", Color("#3a3d40"), head, Vector3(0.5, 0.08, 0.18))
	_n.box("tube", Color("#eef4ff"), head + Vector3(0, -0.05, 0), Vector3(0.45, 0.03, 0.05))
	if lights:
		var s := SpotLight3D.new()
		s.light_color = Color("#dfe9ff")
		s.light_energy = 3.0 * light.night
		s.spot_range = 9.0
		s.spot_angle = 65.0
		s.light_specular = 0.3
		s.transform = Transform3D(Basis(Vector3.RIGHT, -PI * 0.5), head)
		_night_light(s, 3.0)
		_h.add_child(s)


## Daylight bounced off the sunlit upper walls into a narrow lane (the bazaar sits in its own shade at golden):
## a few soft warm lights high in the lane, off at night (a live look makes them at night too, hidden).
func _bounce(xf: Transform3D, d: Dictionary) -> void:
	var e: float = (1.0 - light.night) * 0.55
	if e < 0.05 and not _live():
		return
	var z: float = d.z0 + 6.0
	while z < d.z1:
		var o := OmniLight3D.new()
		o.light_color = light.sun_color.lerp(Color.WHITE, 0.4)
		o.light_energy = e
		o.omni_range = 10.0
		o.omni_attenuation = 0.8
		o.light_specular = 0.0
		o.light_volumetric_fog_energy = 0.0
		o.position = Vector3(xf.origin.x, 6.0, z)
		_night_light(o, -1.0)
		_h.add_child(o)
		z += 16.0


## Sodium street light: inverse square falloff (attenuation 2) from the 8 to 10 m head, so each lamp throws a warm
## pool that is bright under the head and fades over 10 to 15 m, tipped 15 degrees out along the arm so the pool lies
## on the carriageway (the same light count as before: no extra cost). The dark asphalt needs a strong source.
func _street_lamp(xf: Transform3D, d := {}) -> void:
	var s := SpotLight3D.new()
	s.light_color = SODIUM
	s.light_energy = 300.0 * light.night
	s.spot_range = 30.0
	s.spot_angle = 68.0
	s.spot_angle_attenuation = 1.2
	s.spot_attenuation = 2.0
	s.light_specular = 0.5
	s.shadow_enabled = false
	s.light_volumetric_fog_energy = 0.0
	var arm := (xf.basis * Vector3(0, 0, signf(float(d.get("dz", -1.0))))).normalized()
	var aim := (Vector3.DOWN * cos(deg_to_rad(15.0)) + arm * sin(deg_to_rad(15.0))).normalized()
	s.transform = Transform3D(Basis.looking_at(aim, arm), xf.origin)
	_night_light(s, 300.0)
	_h.add_child(s)


func _vehicle_lights(xf: Transform3D, d: Dictionary) -> void:
	var kind: String = d.get("kind", "car")
	if kind == "scooter":
		return
	var front: float = {"car": -2.35, "auto": -1.5, "bus": -6.1}.get(kind, -2.3)
	var s := SpotLight3D.new()
	s.light_color = Color("#fff1d8")
	s.light_energy = 2.2 * light.night
	s.spot_range = 22.0
	s.spot_angle = 28.0
	s.spot_attenuation = 1.6
	s.shadow_enabled = false
	s.light_volumetric_fog_energy = 0.0
	s.transform = xf * Transform3D(Basis(Vector3.RIGHT, deg_to_rad(-7)), Vector3(0, 0.8, front))
	_night_light(s, 2.2)
	_h.add_child(s)
	if kind != "auto":
		var t := OmniLight3D.new()
		t.light_color = Color("#ff2a1a")
		t.light_energy = 0.6 * light.night
		t.omni_range = 2.5
		t.light_volumetric_fog_energy = 0.0
		t.position = xf * Vector3(0, 0.8, -front + 0.2)
		_night_light(t, 0.6)
		_h.add_child(t)


# ---------------------------------------------------------------- decal textures for batch B


func _tex2(kind: String) -> Texture2D:
	if _textures.has(kind):
		return _textures[kind]
	var img: Image
	match kind:
		"sill":
			img = _runs(32, 96, Color(0.07, 0.06, 0.05), 0.85, 0.3)
		"drip":
			img = _runs(48, 96, Color(0.16, 0.14, 0.1), 0.7, 0.18)
		"paan":
			img = _splat(64, 64)
		"torn":
			img = _torn(48, 64)
	var t := ImageTexture.create_from_image(img)
	_textures[kind] = t
	return t


## Narrow dark runs from the top edge (soot under a sill, AC drips), fading down.
func _runs(w: int, h: int, c: Color, alpha: float, freq: float) -> Image:
	var img := Image.create_empty(w, h, false, Image.FORMAT_RGBA8)
	var noise := FastNoiseLite.new()
	noise.seed = 19
	noise.frequency = freq
	for y in h:
		for x in w:
			var col := noise.get_noise_2d(x, 0.0) * 0.5 + 0.5
			var reach := 0.3 + col * 0.7
			var fy := float(y) / h
			var run := clampf((col - 0.3) * 3.0, 0.0, 1.0) * clampf((reach - fy) * 4.0, 0.0, 1.0)
			var top := clampf(1.0 - fy * 6.0, 0.0, 1.0) * 0.5
			var edge := clampf((1.0 - absf((x + 0.5) / w * 2.0 - 1.0)) * 2.5, 0.0, 1.0)
			img.set_pixel(x, y, Color(c.r, c.g, c.b, clampf(run + top, 0.0, 1.0) * edge * alpha))
	return img


## Red-brown betel spit splashes with drips at a wall base.
func _splat(w: int, h: int) -> Image:
	var img := Image.create_empty(w, h, false, Image.FORMAT_RGBA8)
	var noise := FastNoiseLite.new()
	noise.seed = 23
	noise.frequency = 0.14
	var blobs := [Vector3(0.45, 0.35, 0.22), Vector3(0.62, 0.5, 0.12), Vector3(0.3, 0.55, 0.09), Vector3(0.7, 0.28, 0.07)]
	for y in h:
		for x in w:
			var u := (x + 0.5) / w
			var v := (y + 0.5) / h
			var a := 0.0
			for b in blobs:
				var r := Vector2(u - b.x, v - b.y).length() + noise.get_noise_2d(x, y) * 0.05
				a = maxf(a, clampf((b.z - r) * 18.0, 0.0, 1.0))
			# drips running down from the splash
			var dcol := noise.get_noise_2d(x * 3.0, 7.0)
			if dcol > 0.35 and v > 0.4:
				a = maxf(a, clampf((0.9 - v) * 3.0, 0.0, 1.0) * clampf((dcol - 0.35) * 6.0, 0.0, 1.0))
			var k := 0.8 + noise.get_noise_2d(x * 2.0, y * 2.0) * 0.2
			img.set_pixel(x, y, Color(0.42 * k, 0.07 * k, 0.05 * k, a * 0.85))
	return img


## Layers of old torn posters: faded paper, scraps of colour, ragged edges.
func _torn(w: int, h: int) -> Image:
	var img := Image.create_empty(w, h, false, Image.FORMAT_RGBA8)
	var noise := FastNoiseLite.new()
	noise.seed = 29
	noise.frequency = 0.12
	var cols := [Color("#d9cfb8"), Color("#c0392b"), Color("#f2c230"), Color("#1f5fa8"), Color("#e8e2d0")]
	for y in h:
		for x in w:
			var n := noise.get_noise_2d(x, y)
			var layer := clampi(int((n + 1.0) * 2.5), 0, 4)
			var c: Color = cols[layer]
			var border := mini(mini(x, w - 1 - x), mini(y, h - 1 - y))
			var a := 0.0 if border < 2 + int((noise.get_noise_2d(x * 2.0, y * 2.0) + 1.0) * 4.0) else 0.9
			if n > 0.55:
				a = 0.0
			var fade := 0.75 + noise.get_noise_2d(x * 3.0, y * 3.0) * 0.15
			img.set_pixel(x, y, Color(c.r * fade, c.g * fade, c.b * fade, a))
	return img


# ---------------------------------------------------------------- textured dressing meshes


## Boxes and quads with UVs (the stand-in Sink has none): trim sheet pieces and grilles.
class UVMesh:
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	var uv := PackedVector2Array()
	var c := PackedColorArray()
	var idx := PackedInt32Array()

	## One face: centre, half axes along u and v (v runs down the texture), outward normal, UV rect.
	func face(xf: Transform3D, ctr: Vector3, au: Vector3, av: Vector3, nrm: Vector3, r: Rect2, col: Color) -> void:
		var base := v.size()
		var pts := [ctr - au + av, ctr + au + av, ctr + au - av, ctr - au - av]
		var uvs := [Vector2(r.position.x, r.position.y), Vector2(r.end.x, r.position.y), Vector2(r.end.x, r.end.y),
			Vector2(r.position.x, r.end.y)]
		var wn := (xf.basis * nrm).normalized()
		for i in 4:
			v.append(xf * pts[i])
			n.append(wn)
			uv.append(uvs[i])
			c.append(col)
		# front faces wind clockwise seen from outside: (b - a) x (c - a) points away from the normal
		var a0 := v[base]
		var a1 := v[base + 1]
		var a2 := v[base + 2]
		if (a1 - a0).cross(a2 - a0).dot(wn) > 0.0:
			idx.append_array([base, base + 2, base + 1, base, base + 3, base + 2])
		else:
			idx.append_array([base, base + 1, base + 2, base, base + 2, base + 3])

	## A quad in the local XY plane at ctr facing local -Z.
	func quad(xf: Transform3D, ctr: Vector3, size: Vector2, r: Rect2, col: Color) -> void:
		face(xf, ctr, Vector3(size.x * 0.5, 0, 0), Vector3(0, size.y * 0.5, 0), Vector3(0, 0, -1), r, col)

	## A box centred at ctr. Every face takes the v range of the row rect; u runs u_per_m tiles per metre along the
	## face's horizontal edge.
	func box(xf: Transform3D, ctr: Vector3, size: Vector3, row: Rect2, u_per_m: float, col: Color) -> void:
		var h := size * 0.5
		var rx := Rect2(0, row.position.y, size.x * u_per_m, row.size.y)
		var rz := Rect2(0, row.position.y, size.z * u_per_m, row.size.y)
		var rt := Rect2(0, row.position.y, size.x * u_per_m, row.size.y * 0.1)
		face(xf, ctr + Vector3(0, 0, -h.z), Vector3(h.x, 0, 0), Vector3(0, h.y, 0), Vector3(0, 0, -1), rx, col)
		face(xf, ctr + Vector3(0, 0, h.z), Vector3(-h.x, 0, 0), Vector3(0, h.y, 0), Vector3(0, 0, 1), rx, col)
		face(xf, ctr + Vector3(-h.x, 0, 0), Vector3(0, 0, h.z), Vector3(0, h.y, 0), Vector3(-1, 0, 0), rz, col)
		face(xf, ctr + Vector3(h.x, 0, 0), Vector3(0, 0, -h.z), Vector3(0, h.y, 0), Vector3(1, 0, 0), rz, col)
		face(xf, ctr + Vector3(0, h.y, 0), Vector3(h.x, 0, 0), Vector3(0, 0, h.z), Vector3(0, 1, 0), rt, col)
		face(xf, ctr + Vector3(0, -h.y, 0), Vector3(h.x, 0, 0), Vector3(0, 0, -h.z), Vector3(0, -1, 0), rt, col)

	func to_mesh(mat: Material) -> ArrayMesh:
		var mesh := ArrayMesh.new()
		if v.is_empty():
			return mesh
		var a := []
		a.resize(Mesh.ARRAY_MAX)
		a[Mesh.ARRAY_VERTEX] = v
		a[Mesh.ARRAY_NORMAL] = n
		a[Mesh.ARRAY_TEX_UV] = uv
		a[Mesh.ARRAY_COLOR] = c
		a[Mesh.ARRAY_INDEX] = idx
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, a)
		mesh.surface_set_material(0, mat)
		return mesh
