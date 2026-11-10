## Render architecture bench scene (P0-016, ARCH_OPTIONS.md "Bench tasks"). Started with the game arg
## --arch=render:<setup>, where the setup is a list of tokens joined by "+":
##   world      city (2 km by 2 km, default), kit (500 m dense old city block), tx (texture panels), empty (a ground
##              plane only: the fixed cost of the look)
##   drawing    i1, i2, i3 (default i3); lod (LD1 visibility ranges and mesh LOD); oc (OC1 occluders)
##   lighting   sdfgi (L2 on top of the look B light), light_<dawn|afternoon|golden|night> (default golden)
##   aa, scale  taa, msaa4, fxaa, fsr2@<s>, fsr1@<s>, bilinear@<s>, metalfx@<s> (temporal), metalfxs@<s> (spatial)
##   crowd      crowd_an1, crowd_an2 (300 walking people around the centre junction, crowd.gd)
##   textures   tx_vram, tx_raw, tx_unc (world tx: which import of the generated kit textures to load)
## The look is the signed stylised B on its lean path: the style's own environment, sun and materials (the
## surface_b shader with its tiling texture array), SSAO, SSIL, glow, fog and a depth haze box. No dressing, decals,
## signs or night lights: those are measured by the style tasks.
## The harness drives it through the debug hook bench(cmd, opts) -> bench_call here: info, path, pose (ballast and blank are answered by the debug server in any scene).
## Run by node harness/bench/arch.mjs render. Never loaded by the default game.
extends Node3D

const World := preload("res://bench/render/world.gd")
const Crowd := preload("res://bench/render/crowd.gd")
const Kit := preload("res://scenes/standin/kit.gd")
const HAZE_SHADER := preload("res://render/shaders/haze_b.gdshader")
const TX_SHADER := preload("res://bench/render/tx.gdshader")
const STYLE := "res://render/styles/stylised_b"
const TEX_DIR := "res://bench/render/tex_gen/"
## name -> [start, direction, km/h]. A speed of 0 is a fixed view.
const PATHS := {
	"city": {
		"drive60": [Vector3(-300, 2.2, -2.75), Vector3(1, -0.05, 0), 60.0],
		"drive140": [Vector3(-300, 2.2, -2.75), Vector3(1, -0.05, 0), 140.0],
		"drive200": [Vector3(-300, 2.2, -2.75), Vector3(1, -0.05, 0), 200.0],
		"walk5": [Vector3(-30, 1.87, -7.0), Vector3(1, -0.03, 0.05), 5.0],
		"crowd": [Vector3(-12, 1.87, -7.0), Vector3(1, -0.04, 0.12), 0.0],
		"over": [Vector3(-420, 70, -90), Vector3(1, -0.28, 0.2), 0.0],
	},
	"kit": {
		"walk5": [Vector3(-60, 1.7, 12.5), Vector3(1, 0.02, 0), 5.0],
		"lane": [Vector3(-60, 1.7, 12.5), Vector3(1, 0.04, 0), 0.0],
		"over": [Vector3(-235, 42, -235), Vector3(1, -0.3, 1), 0.0],
	},
	"tx": {
		"wall": [Vector3(0, 2.2, 9.5), Vector3(0, -0.05, -1), 0.0],
	},
	"empty": {
		"wall": [Vector3(0, 2.2, 9.5), Vector3(0, -0.05, -1), 0.0],
	},
}

var tokens: PackedStringArray = []
var info := {"ready": false}
var _layout := "city"
var _cam: Camera3D
var _style: RefCounted
var _light: Resource
var _mats := {}
var _path := {}


func _ready() -> void:
	var t0 := Time.get_ticks_msec()
	tokens = get_node("/root/GameArgs").arch_setup().split("+", false)
	for l in ["kit", "tx", "empty"]:
		if has(l):
			_layout = l
	_look()
	_camera()
	var out := {"setup": "+".join(tokens), "layout": _layout}
	if _layout == "tx":
		out["textures"] = _texture_panels()
	elif _layout == "empty":
		_ground_plane()
	else:
		_build_world(out)
	if has("crowd_an1") or has("crowd_an2"):
		var crowd := Crowd.new()
		crowd.name = "Crowd"
		crowd.setup("an1" if has("crowd_an1") else "an2", _mats["satin"])
		add_child(crowd)
		out["crowd"] = crowd.stats
	out["buildMs"] = Time.get_ticks_msec() - t0
	out["ready"] = true
	info = out
	print("bench render: %s built in %d ms" % ["+".join(tokens), out.buildMs])


func has(token: String) -> bool:
	return token in tokens


func _value(prefix: String, fallback: float) -> float:
	for t in tokens:
		if t.begins_with(prefix + "@") and t.substr(prefix.length() + 1).is_valid_float():
			return float(t.substr(prefix.length() + 1))
	return fallback


func _process(_delta: float) -> void:
	if _path.is_empty():
		return
	var t := minf((Time.get_ticks_usec() - int(_path.t0)) / 1e6, float(_path.seconds))
	_cam.global_position = (_path.start as Vector3) + (_path.dir as Vector3) * float(_path.speed) * t


# ------------------------------------------------------------------ hooks


## Commands from the harness (debug hook bench(cmd, opts)). An {"error": text} answer becomes an error response.
func bench_call(cmd: String, opts: Dictionary) -> Variant:
	match cmd:
		"info":
			var vp := get_viewport()
			var live := info.duplicate()
			live["viewport"] = {"width": vp.size.x, "height": vp.size.y, "scaling3dMode": vp.scaling_3d_mode,
				"scaling3dScale": vp.scaling_3d_scale, "taa": vp.use_taa, "msaa3d": vp.msaa_3d, "screenSpaceAa": vp.screen_space_aa,
				"occlusionCulling": vp.use_occlusion_culling, "meshLodThreshold": vp.mesh_lod_threshold}
			live["nodes"] = get_tree().get_node_count()
			live["paths"] = PATHS[_layout].keys()
			return live
		"path", "pose":
			var name := str(opts.get("name", ""))
			if not PATHS[_layout].has(name):
				return {"error": "unknown path '%s' (paths: %s)" % [name, ", ".join(PATHS[_layout].keys())]}
			var p: Array = PATHS[_layout][name]
			var dir := (p[1] as Vector3).normalized()
			var flat := Vector3(dir.x, 0, dir.z).normalized()
			var speed := float(p[2]) / 3.6
			_cam.global_position = p[0]
			_cam.look_at((p[0] as Vector3) + dir, Vector3.UP)
			if cmd == "pose":
				_path = {}
				_cam.global_position = (p[0] as Vector3) + flat * speed * float(opts.get("t", 2.5))
			else:
				_path = {"start": p[0], "dir": flat, "speed": speed, "seconds": float(opts.get("seconds", 6.0)), "t0": Time.get_ticks_usec()}
			var at := _cam.global_position
			return {"name": name, "kmh": p[2], "pos": [at.x, at.y, at.z], "moving": cmd == "path" and speed > 0.0}
	return {"error": "unknown bench command '%s' (info, path, pose)" % cmd}


# ------------------------------------------------------------------ look B load


func _look() -> void:
	var light_id := "golden"
	for t in tokens:
		if t.begins_with("light_"):
			light_id = t.substr(6)
	_light = load("res://render/styles/light_%s.tres" % light_id)
	_style = load(STYLE + ".gd").new(load(STYLE + ".tres"), _light)
	var env: Environment = _style.environment()
	if has("sdfgi"):
		env.sdfgi_enabled = true
	var we := WorldEnvironment.new()
	we.name = "Environment"
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.name = "Sun"
	add_child(sun)
	_style.setup_sun(sun)
	var base: Dictionary = Kit.materials()
	for key in base:
		var m: Material = _style.material_for(base[key])
		_mats[key] = m if m != null else base[key]
	var vp := get_viewport()
	if has("taa"):
		vp.use_taa = true
	if has("msaa4"):
		vp.msaa_3d = Viewport.MSAA_4X
	if has("fxaa"):
		vp.screen_space_aa = Viewport.SCREEN_SPACE_AA_FXAA
	var modes := {"fsr2": Viewport.SCALING_3D_MODE_FSR2, "fsr1": Viewport.SCALING_3D_MODE_FSR, "bilinear": Viewport.SCALING_3D_MODE_BILINEAR,
		"metalfx": Viewport.SCALING_3D_MODE_METALFX_TEMPORAL, "metalfxs": Viewport.SCALING_3D_MODE_METALFX_SPATIAL}
	for k in modes:
		var s := _value(k, 0.0)
		if s > 0.0:
			vp.scaling_3d_mode = modes[k]
			vp.scaling_3d_scale = clampf(s, 0.25, 1.0)
	# without the lod token nothing uses a LOD: no visibility ranges (world.gd) and no mesh LOD index buffers
	if not has("lod"):
		vp.mesh_lod_threshold = 0.0
	if has("oc"):
		vp.use_occlusion_culling = true


func _camera() -> void:
	_cam = Camera3D.new()
	_cam.name = "BenchCamera"
	_cam.fov = 70.0
	_cam.near = 0.1
	_cam.far = 3000.0
	add_child(_cam)
	_cam.make_current()
	var first: String = PATHS[_layout].keys()[0]
	bench_call("pose", {"name": first})


func _build_world(out: Dictionary) -> void:
	var t0 := Time.get_ticks_msec()
	var world := World.new(_mats)
	world.build_data(_layout)
	var t1 := Time.get_ticks_msec()
	var root := Node3D.new()
	root.name = "World"
	add_child(root)
	var mode := "i1" if has("i1") else ("i2" if has("i2") else "i3")
	var wear := 0.9 if _layout == "kit" else 0.45
	out["world"] = world.stats
	out["draw"] = world.realise(root, mode, has("lod") and mode == "i3", wear)
	if has("oc"):
		out["occluders"] = world.add_occluders(root)
	out["dataMs"] = t1 - t0
	out["realiseMs"] = Time.get_ticks_msec() - t1
	_haze(world.half)


## The depth haze box of the lean look (stylised_b.gd _haze): one box over the dense part of the world.
func _haze(half: float) -> void:
	var size := Vector3(minf(half * 2.0, 760.0), 26.0, minf(half * 2.0, 760.0))
	var centre := Vector3(0, 12.0, 0)
	var bm := BoxMesh.new()
	bm.size = size
	var m := ShaderMaterial.new()
	m.shader = HAZE_SHADER
	m.set_shader_parameter("box_min", centre - size * 0.5)
	m.set_shader_parameter("box_max", centre + size * 0.5)
	var night: float = _light.night
	var day: float = 0.3 + 0.3 * _light.sun_energy * (1.0 - night)
	var haze_col: Color = _light.area_haze_color
	var c: Color = haze_col.srgb_to_linear() * day
	m.set_shader_parameter("haze_color", Vector3(c.r, c.g, c.b))
	var area_haze: float = _light.area_haze
	m.set_shader_parameter("density", area_haze * 0.9 * 0.32)
	m.set_shader_parameter("height_falloff", 0.12)
	m.set_shader_parameter("max_alpha", 0.5)
	bm.material = m
	var mi := MeshInstance3D.new()
	mi.name = "AreaHaze"
	mi.mesh = bm
	mi.position = centre
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)


## World "empty" (and under the texture panels): one ground plane, so a setup measures the look's fixed cost alone.
func _ground_plane() -> void:
	var ground := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(400, 400)
	plane.material = _mats["road"]
	ground.mesh = plane
	add_child(ground)


# ------------------------------------------------------------------ textures (TX1 against TX3)


## Loads one import of the generated kit textures (tools/make_tex.gd writes them, the runner imports them) and
## shows every layer on a panel. Returns what was loaded, the load time and the formats.
func _texture_panels() -> Dictionary:
	var mode := "vram" if has("tx_vram") else ("raw" if has("tx_raw") else "unc")
	var out := {"mode": mode, "files": [], "missing": []}
	var tex := {}
	var t0 := Time.get_ticks_usec()
	for n in ["kit_albedo", "kit_normal", "trim", "decal"]:
		var path := TEX_DIR + "%s_%s.png" % [n, mode]
		if not ResourceLoader.exists(path):
			out.missing.append(path)
			continue
		var t: Resource = load(path)
		tex[n] = t
		var e := {"name": n, "class": t.get_class()}
		if t is TextureLayered:
			e["width"] = t.get_width()
			e["height"] = t.get_height()
			e["layers"] = t.get_layers()
			e["format"] = t.get_format()
			e["mipmaps"] = t.has_mipmaps()
		elif t is Texture2D:
			e["width"] = t.get_width()
			e["height"] = t.get_height()
			e["mipmaps"] = t.has_mipmaps()
		out.files.append(e)
	out["loadMs"] = (Time.get_ticks_usec() - t0) / 1000.0
	_ground_plane()
	if tex.has("kit_albedo") and tex.has("kit_normal"):
		var layers: int = tex["kit_albedo"].get_layers()
		for i in layers:
			var q := QuadMesh.new()
			q.size = Vector2(2.4, 2.4)
			var m := ShaderMaterial.new()
			m.shader = TX_SHADER
			m.set_shader_parameter("albedo_tex", tex["kit_albedo"])
			m.set_shader_parameter("normal_tex", tex["kit_normal"])
			m.set_shader_parameter("layer", float(i))
			q.material = m
			var mi := MeshInstance3D.new()
			mi.mesh = q
			mi.position = Vector3(-6.5 + (i % 6) * 2.6, 1.4 + (i / 6) * 2.6, 0)
			add_child(mi)
	var x := -3.0
	for n in ["trim", "decal"]:
		if tex.has(n):
			var q := QuadMesh.new()
			q.size = Vector2(5.0, 5.0)
			var m := StandardMaterial3D.new()
			m.albedo_texture = tex[n]
			m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
			q.material = m
			var mi := MeshInstance3D.new()
			mi.mesh = q
			mi.position = Vector3(x, 2.6, -3.0)
			mi.rotation.y = 0.0
			mi.position.x = x * 3.2
			add_child(mi)
		x += 6.0
	return out
