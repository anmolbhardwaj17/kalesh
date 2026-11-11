## Road bench scene (P0-019, ARCH_OPTIONS.md rows LN, HR, J, EL, TF). Started with the game arg --arch=roads:<site>
## (ito or cp). It shows the stand-in tile that node harness/bench/roads.mjs baked from the lane model prototype
## (tools/bake/roads/): game/bench/roads/gen/<site>.ktl (the T1 tile of P0-018, read by bench/tiles/tile_t1.gd) and
## <site>.json (tile origin, camera poses, probe points). One material per mesh name, one collider chunk per frame.
## Debug hook bench(cmd, opts):
##   info            what is loaded: triangles, collider chunks, load and attach times
##   poses           the pose names of the site
##   pose {name}     moves the camera (a top pose looks straight down with north up, an eye pose is at driver height)
##   probe           a ray down at every probe point of the bake: the collider against the drawn surface height
## Run by node harness/bench/arch.mjs roads (harness/bench/roads.plan.mjs). Never loaded by the game.
extends Node3D

const TileT1 := preload("res://bench/tiles/tile_t1.gd")
const GEN := "res://bench/roads/gen/"
const COLOURS := {
	"road": Color(0.2, 0.2, 0.21), "parking": Color(0.36, 0.36, 0.39), "gore": Color(0.42, 0.38, 0.27), "kerb": Color(0.74, 0.73, 0.69),
	"footpath": Color(0.72, 0.65, 0.54), "planter": Color(0.36, 0.44, 0.24), "median": Color(0.5, 0.55, 0.42), "marking": Color(0.95, 0.95, 0.92),
	"wall": Color(0.66, 0.65, 0.62), "underside": Color(0.5, 0.5, 0.48), "pier": Color(0.6, 0.59, 0.56), "ground": Color(0.37, 0.43, 0.27),
	"hedge": Color(0.2, 0.36, 0.17), "railing": Color(0.18, 0.49, 0.23), "colonnade": Color(0.945, 0.933, 0.902),
}

var info := {"ready": false}
var cam: Camera3D
var site := ""
var poses := {}
var probes: Array = []
var _materials := {}


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
		_materials[key] = m
	site = get_node("/root/GameArgs").arch_setup()
	if site == "":
		site = "ito"
	var meta_text := FileAccess.get_file_as_string(GEN + site + ".json")
	var meta: Variant = JSON.parse_string(meta_text) if meta_text != "" else null
	if typeof(meta) != TYPE_DICTIONARY:
		info = {"ready": true, "error": "no baked site '%s' in %s: run node harness/bench/roads.mjs" % [site, GEN]}
		print("bench roads: ", info.error)
		return
	for p: Dictionary in meta.poses:
		poses[str(p.name)] = p
	probes = meta.probes
	var t1 := Time.get_ticks_usec()
	var tile := TileT1.load_tile(GEN + str(meta.tile))
	if not tile.ok:
		info = {"ready": true, "error": str(tile.error)}
		print("bench roads: ", info.error)
		return
	var load_ms := (Time.get_ticks_usec() - t1) / 1000.0
	var root: Node3D = tile.root
	for child in root.get_children():
		if child is MeshInstance3D:
			var mat: String = str(child.get_meta("material", child.name))
			(child as MeshInstance3D).material_override = _materials.get(mat, _materials.wall)
			if mat == "marking":
				(child as MeshInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		elif child is MultiMeshInstance3D:
			(child.multimesh as MultiMesh).mesh = _module(str(child.get_meta("module", "")))
	add_child(root)
	# one collider chunk per frame (Jolt builds a mesh collider on the main thread when the body enters the space)
	var attach := PackedFloat64Array()
	for body: StaticBody3D in tile.bodies:
		await get_tree().process_frame
		var t := Time.get_ticks_usec()
		root.add_child(body)
		attach.append(float(Time.get_ticks_usec() - t))
	var worst := 0.0
	var total := 0.0
	for v in attach:
		worst = maxf(worst, v)
		total += v
	if poses.has("top"):
		look_at_pose("top")
	var state := get_world_3d().direct_space_state
	var cls := state.get_class() if state != null else "unknown"
	info = {
		"ready": true, "site": site, "name": str(meta.get("name", site)), "engine": "Jolt Physics" if cls.begins_with("Jolt") else ("GodotPhysics3D" if cls.begins_with("Godot") else cls),
		"triangles": tile.triangles, "colliderTriangles": tile.collider_triangles, "colliderChunks": tile.bodies.size(), "placements": tile.placements,
		"tileBytes": tile.bytes, "loadMs": snappedf(load_ms, 0.01), "attachTotalMs": snappedf(total / 1000.0, 0.01), "attachWorstChunkMs": snappedf(worst / 1000.0, 0.01),
		"poses": poses.keys(), "buildMs": Time.get_ticks_msec() - t0,
	}
	print("bench roads: %s ready, %d triangles, %d collider chunks" % [site, int(tile.triangles), tile.bodies.size()])


func bench_call(cmd: String, opts: Dictionary) -> Variant:
	match cmd:
		"info":
			return info
		"poses":
			return poses.keys()
		"pose", "path":
			var name := str(opts.get("name", "top"))
			if not poses.has(name):
				return {"error": "unknown pose '%s' (poses: %s)" % [name, ", ".join(poses.keys())]}
			look_at_pose(name)
			return {"pos": [cam.global_position.x, cam.global_position.y, cam.global_position.z], "kind": str(poses[name].kind), "moving": false}
		"probe":
			return _probe()
	return {"error": "unknown bench command '%s' (info, poses, pose, probe)" % cmd}


func look_at_pose(name: String) -> void:
	var p: Dictionary = poses[name]
	var pos := Vector3(float(p.pos[0]), float(p.pos[1]), float(p.pos[2]))
	var target := Vector3(float(p.target[0]), float(p.target[1]), float(p.target[2]))
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


## A ray down at every probe point: the collider must be where the drawn surface is.
func _probe() -> Dictionary:
	var space := get_world_3d().direct_space_state
	var worst := 0.0
	var worst_what := ""
	var missing := 0
	var sum := 0.0
	var n := 0
	for p: Dictionary in probes:
		var from := Vector3(float(p.x), float(p.y) + 2.0, float(p.z))
		var q := PhysicsRayQueryParameters3D.create(from, from + Vector3(0, -6, 0))
		var hit := space.intersect_ray(q)
		if hit.is_empty():
			missing += 1
			continue
		var err := absf(float(hit.position.y) - float(p.y))
		sum += err
		n += 1
		if err > worst:
			worst = err
			worst_what = str(p.what)
	return {"points": probes.size(), "hits": n, "missing": missing, "maxErrorM": snappedf(worst, 0.0001), "meanErrorM": snappedf(sum / maxi(1, n), 0.0001), "worst": worst_what}


## Stand-in modules for the hero road's placements. An instance sits on the ground at its origin.
func _module(module: String) -> Mesh:
	var out := ArrayMesh.new()
	match module:
		"column":
			var c := CylinderMesh.new()
			c.top_radius = 0.26
			c.bottom_radius = 0.29
			c.height = 4.6
			c.radial_segments = 10
			c.rings = 1
			_append(out, c, Transform3D(Basis(), Vector3(0, 2.3, 0)), _materials.colonnade)
		"lamp":
			var pole := CylinderMesh.new()
			pole.top_radius = 0.07
			pole.bottom_radius = 0.11
			pole.height = 9.0
			pole.radial_segments = 8
			pole.rings = 1
			_append(out, pole, Transform3D(Basis(), Vector3(0, 4.5, 0)), _materials.wall)
			var arm := BoxMesh.new()
			arm.size = Vector3(0.12, 0.1, 3.4)
			_append(out, arm, Transform3D(Basis(), Vector3(0, 8.9, 0)), _materials.wall)
		"tree":
			var trunk := CylinderMesh.new()
			trunk.top_radius = 0.22
			trunk.bottom_radius = 0.3
			trunk.height = 5.0
			trunk.radial_segments = 8
			trunk.rings = 1
			var bark := StandardMaterial3D.new()
			bark.albedo_color = Color(0.36, 0.29, 0.22)
			bark.roughness = 0.95
			_append(out, trunk, Transform3D(Basis(), Vector3(0, 2.5, 0)), bark)
			var crown := SphereMesh.new()
			crown.radius = 4.2
			crown.height = 6.4
			crown.radial_segments = 12
			crown.rings = 6
			var leaf := StandardMaterial3D.new()
			leaf.albedo_color = Color(0.27, 0.42, 0.2)
			leaf.roughness = 0.95
			_append(out, crown, Transform3D(Basis(), Vector3(0, 7.6, 0)), leaf)
		_:
			var b := BoxMesh.new()
			b.size = Vector3(0.5, 1.0, 0.5)
			_append(out, b, Transform3D(Basis(), Vector3(0, 0.5, 0)), _materials.wall)
	return out


func _append(into: ArrayMesh, prim: PrimitiveMesh, xf: Transform3D, mat: Material) -> void:
	var st := SurfaceTool.new()
	st.append_from(prim, 0, xf)
	st.commit(into)
	into.surface_set_material(into.get_surface_count() - 1, mat)


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
	sun.directional_shadow_max_distance = 700.0
	add_child(sun)
	cam = Camera3D.new()
	cam.fov = 60.0
	cam.near = 0.15
	cam.far = 6000.0
	add_child(cam)
	cam.make_current()
