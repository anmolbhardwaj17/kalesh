## Stitch bench scene (P0-029, ARCH_OPTIONS.md rows X, FP, DC, SC, FL, LP). Started with the game arg --arch=stitch.
## It shows the stitched world that node harness/bench/stitch.mjs baked with tools/bake/stitch/: the pilot districts
## at their placement offsets, the edge bands, the authored connectors and the port closures, as 250 m T1 tiles in
## game/bench/stitch/gen/ (read by bench/tiles/tile_t1.gd) listed in gen/index.json with the camera poses.
## A tile is placed by its origin only: no node here has a rotation or a scale (bench('transforms') counts them).
## Debug hook bench(cmd, opts):
##   info                 what is loaded: tiles, triangles, load time
##   poses                the pose names
##   pose {name}          moves the camera (a top pose looks straight down with north up, an eye pose is at player height)
##   pan {step}           frame `step` of the slow pan at the far district (index.json "pan")
##   rebase {x, z}        moves the whole world by (-x, -z), so the place (x, z) sits at the engine origin: the same
##                        view with small coordinates, to compare against the far view (FP1)
##   pins                 world position of every landmark pin as the engine has it
##   transforms           nodes under the world whose basis is not the identity (must be 0)
## Run by node harness/bench/arch.mjs stitch (harness/bench/stitch.plan.mjs). Never loaded by the game.
extends Node3D

const TileT1 := preload("res://bench/tiles/tile_t1.gd")
const GEN := "res://bench/stitch/gen/"
const COLOURS := {
	"ground": Color(0.6, 0.58, 0.53), "filler": Color(0.4, 0.47, 0.29), "riverbed": Color(0.45, 0.41, 0.31), "water": Color(0.22, 0.42, 0.58),
	"road": Color(0.2, 0.2, 0.21), "road_minor": Color(0.3, 0.3, 0.31), "road_gen": Color(0.4, 0.34, 0.27),
	"building": Color(0.8, 0.76, 0.68), "shell": Color(0.6, 0.6, 0.61), "landmark": Color(0.7, 0.32, 0.23),
	"barrier": Color(0.86, 0.16, 0.1), "gate": Color(0.13, 0.3, 0.2), "wall": Color(0.66, 0.65, 0.62), "verge": Color(0.42, 0.44, 0.31),
	"pin": Color(0.9, 0.1, 0.8),
	"parking": Color(0.36, 0.36, 0.39), "gore": Color(0.42, 0.38, 0.27), "kerb": Color(0.74, 0.73, 0.69), "footpath": Color(0.72, 0.65, 0.54),
	"planter": Color(0.36, 0.44, 0.24), "median": Color(0.5, 0.55, 0.42), "marking": Color(0.95, 0.95, 0.92), "underside": Color(0.5, 0.5, 0.48),
	"pier": Color(0.6, 0.59, 0.56),
}
const NO_SHADOW := ["marking", "water", "pin", "ground", "filler", "riverbed"]

var info := {"ready": false}
var cam: Camera3D
var world: Node3D
var poses := {}
var pan := {}
## The place that sits at the engine origin (metres, kept as 64-bit floats).
var rebase_x := 0.0
var rebase_z := 0.0
var _materials := {}
var _pins: Array[MeshInstance3D] = []


func _ready() -> void:
	var t0 := Time.get_ticks_msec()
	_look()
	for key: String in COLOURS:
		var m := StandardMaterial3D.new()
		m.albedo_color = COLOURS[key]
		m.roughness = 0.92
		if key == "marking":
			m.roughness = 0.6
			m.emission_enabled = true
			m.emission = Color(0.35, 0.35, 0.33)
		elif key == "water":
			m.roughness = 0.25
		elif key == "pin":
			m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		_materials[key] = m
	world = Node3D.new()
	world.name = "World"
	add_child(world)
	var text := FileAccess.get_file_as_string(GEN + "index.json")
	var index: Variant = JSON.parse_string(text) if text != "" else null
	if typeof(index) != TYPE_DICTIONARY:
		info = {"ready": true, "error": "no baked world in %s: run node harness/bench/stitch.mjs" % GEN}
		print("bench stitch: ", info.error)
		return
	for p: Dictionary in index.poses:
		poses[str(p.name)] = p
	if typeof(index.get("pan")) == TYPE_DICTIONARY:
		pan = index.pan
	var triangles := 0
	var bytes := 0
	var load_us := 0
	var layers := {}
	var n := 0
	for row: Dictionary in index.tiles:
		var tile := TileT1.load_tile(GEN + str(row.file))
		if not tile.ok:
			info = {"ready": true, "error": str(tile.error)}
			print("bench stitch: ", info.error)
			return
		var root: Node3D = tile.root
		# a tile is placed by its origin: a translation, nothing else
		root.position = Vector3(float(row.origin[0]), float(row.origin[1]), float(row.origin[2]))
		for child in root.get_children():
			if child is MeshInstance3D:
				var mi := child as MeshInstance3D
				var mat: String = str(mi.get_meta("material", mi.name))
				mi.material_override = _materials.get(mat, _materials.wall)
				if NO_SHADOW.has(mat):
					mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
				if mat == "pin":
					_pins.append(mi)
		world.add_child(root)
		triangles += int(tile.triangles)
		bytes += int(tile.bytes)
		load_us += int(tile.thread_us)
		layers[str(row.layer)] = int(layers.get(str(row.layer), 0)) + 1
		n += 1
		if n % 60 == 0:
			await get_tree().process_frame
	if poses.has("top_all"):
		look_at_pose("top_all")
	info = {
		"ready": true, "tiles": n, "tilesByLayer": layers, "triangles": triangles, "tileBytes": bytes, "tileReadMs": snappedf(load_us / 1000.0, 0.1),
		"pins": _pins.size(), "poses": poses.keys(), "pan": pan.get("name", ""), "buildMs": Time.get_ticks_msec() - t0,
	}
	print("bench stitch: ready, %d tiles, %d triangles" % [n, triangles])


func bench_call(cmd: String, opts: Dictionary) -> Variant:
	match cmd:
		"info":
			return info
		"poses":
			return poses.keys()
		"pose", "path":
			var name := str(opts.get("name", "top_all"))
			if not poses.has(name):
				return {"error": "unknown pose '%s' (poses: %s)" % [name, ", ".join(poses.keys())]}
			look_at_pose(name)
			return {"pos": [cam.global_position.x, cam.global_position.y, cam.global_position.z], "kind": str(poses[name].kind), "moving": false}
		"pan":
			if pan.is_empty() or not poses.has(str(pan.pose)):
				return {"error": "the baked world has no pan"}
			return _pan(int(opts.get("step", 0)))
		"rebase":
			rebase_x = float(opts.get("x", 0.0))
			rebase_z = float(opts.get("z", 0.0))
			world.position = Vector3(-rebase_x, 0.0, -rebase_z)
			return {"x": rebase_x, "z": rebase_z}
		"pins":
			var out := []
			for mi in _pins:
				var c: Vector3 = mi.global_transform * mi.get_aabb().get_center()
				out.append({"name": str(mi.name), "x": float(c.x) + rebase_x, "y": float(c.y), "z": float(c.z) + rebase_z})
			return {"pins": out, "rebase": [rebase_x, rebase_z]}
		"transforms":
			return _transforms()
	return {"error": "unknown bench command '%s' (info, poses, pose, pan, rebase, pins, transforms)" % cmd}


func look_at_pose(name: String) -> void:
	var p: Dictionary = poses[name]
	var pos := Vector3(float(p.pos[0]) - rebase_x, float(p.pos[1]), float(p.pos[2]) - rebase_z)
	var target := Vector3(float(p.target[0]) - rebase_x, float(p.target[1]), float(p.target[2]) - rebase_z)
	cam.global_position = pos
	if str(p.kind) == "top":
		# straight down with north (-Z) up
		cam.projection = Camera3D.PROJECTION_ORTHOGONAL
		cam.size = float(p.size)
		cam.look_at(target, Vector3(0, 0, -1))
	else:
		cam.projection = Camera3D.PROJECTION_PERSPECTIVE
		cam.fov = float(p.size)
		cam.look_at(target, Vector3.UP)


## Frame `step` of the slow pan: the pose moved by step * stepM and turned by step * yawStepDeg. The sums are done
## in 64-bit floats; the camera then takes them as the engine stores them (32-bit).
func _pan(step: int) -> Dictionary:
	var p: Dictionary = poses[str(pan.pose)]
	var px := float(p.pos[0]) + float(pan.stepM[0]) * step
	var py := float(p.pos[1]) + float(pan.stepM[1]) * step
	var pz := float(p.pos[2]) + float(pan.stepM[2]) * step
	var dx := float(p.target[0]) - float(p.pos[0])
	var dy := float(p.target[1]) - float(p.pos[1])
	var dz := float(p.target[2]) - float(p.pos[2])
	var yaw := deg_to_rad(float(pan.yawStepDeg) * step)
	var rx := dx * cos(yaw) - dz * sin(yaw)
	var rz := dx * sin(yaw) + dz * cos(yaw)
	cam.projection = Camera3D.PROJECTION_PERSPECTIVE
	cam.fov = float(p.size)
	cam.global_position = Vector3(px - rebase_x, py, pz - rebase_z)
	cam.look_at(Vector3(px + rx - rebase_x, py + dy, pz + rz - rebase_z), Vector3.UP)
	return {"step": step, "pos": [px, py, pz], "engine": [cam.global_position.x, cam.global_position.y, cam.global_position.z]}


## Every node under the world must be placed by a translation only.
func _transforms() -> Dictionary:
	var checked := 0
	var bad := 0
	var first := ""
	var stack: Array[Node] = [world]
	while not stack.is_empty():
		var node: Node = stack.pop_back()
		for child in node.get_children():
			stack.append(child)
		if node is Node3D:
			checked += 1
			if not (node as Node3D).transform.basis.is_equal_approx(Basis.IDENTITY):
				bad += 1
				if first == "":
					first = str(node.get_path())
	return {"checked": checked, "notIdentity": bad, "first": first}


func _look() -> void:
	var env := Environment.new()
	var sky := Sky.new()
	var sm := ProceduralSkyMaterial.new()
	sm.sky_top_color = Color(0.3, 0.48, 0.78)
	sm.sky_horizon_color = Color(0.72, 0.78, 0.84)
	sm.ground_bottom_color = Color(0.3, 0.3, 0.3)
	sm.ground_horizon_color = Color(0.66, 0.68, 0.7)
	sky.sky_material = sm
	env.sky = sky
	env.background_mode = Environment.BG_SKY
	# a neutral fill: the sky's own blue would tint the asphalt
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.78, 0.78, 0.75)
	env.ambient_light_energy = 0.55
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-52, -38, 0)
	sun.light_energy = 1.15
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 400.0
	add_child(sun)
	cam = Camera3D.new()
	cam.fov = 60.0
	cam.near = 0.15
	cam.far = 9000.0
	add_child(cam)
	cam.make_current()
