## Tile format bench scene (P0-018, ARCH_OPTIONS.md rows T, TL, ST). Started with the game arg --arch=tiles:<setup>.
## The setup only names the run; what loads is chosen by the harness through the debug hook bench(cmd, opts):
##   info                                the setup, the physics engine, what is loaded
##   run {test = "load", format, files, loads}    loads every file of `files` `loads` times and measures it
##   run {test = "memory", format, files, copies} loads `copies` sets and keeps them (the harness reads the process)
##   run {test = "free"}                 frees everything that was kept
##   poll {test}                         {running, done, result}
##   pose {name}                         moves the camera
## Formats: t1 = our binary tile read by GDScript on a WorkerThreadPool thread (tile_t1.gd); t2 = a Godot .res
## (a PackedScene written by pack_t2.gd) loaded with ResourceLoader threaded loads and instantiated on a worker
## thread; t3 = a .glb loaded with GLTFDocument on a worker thread, its col_* meshes turned into trimesh shapes.
## Every format ends as the same nodes: MeshInstance3D per material, one StaticBody3D per collider chunk. The main
## thread attaches the meshes in one step and then one collider chunk per frame (TL1), because Jolt builds a mesh
## collider on the main thread when the body enters the space (P0-017).
## Run by node harness/bench/arch.mjs tiles (through harness/bench/pilot_data/tiles.mjs). Never loaded by the game.
extends Node3D

const TileT1 := preload("res://bench/tiles/tile_t1.gd")
const Util := preload("res://bench/physics/util.gd")
const POSES := {
	"overview": [Vector3(125, 210, 420), Vector3(125, 0, 110)],
	"street": [Vector3(60, 14, 235), Vector3(150, 4, 90)],
}
const COLOURS := {"ground": Color(0.47, 0.5, 0.4), "roads": Color(0.25, 0.25, 0.27), "buildings": Color(0.78, 0.7, 0.6)}

var info := {"ready": false}
var cam: Camera3D
var results := {}
var running := ""
var _materials := {}
var _module_mesh: BoxMesh
var _kept: Array[Node3D] = []
var _recording := false
var _frames := PackedFloat64Array()
var _last_us := 0


func _ready() -> void:
	var t0 := Time.get_ticks_msec()
	_look()
	for key: String in COLOURS:
		var m := StandardMaterial3D.new()
		m.albedo_color = COLOURS[key]
		m.roughness = 0.9
		_materials[key] = m
	_module_mesh = BoxMesh.new()
	_module_mesh.size = Vector3(2.6, 2.8, 0.25)
	_module_mesh.material = _materials.buildings
	look_at_pose("overview")
	var state := get_world_3d().direct_space_state
	var cls := state.get_class() if state != null else "unknown"
	info = {
		"setup": get_node("/root/GameArgs").arch_setup(), "engine": "Jolt Physics" if cls.begins_with("Jolt") else ("GodotPhysics3D" if cls.begins_with("Godot") else cls),
		"workerThreads": OS.get_processor_count(), "buildMs": Time.get_ticks_msec() - t0, "ready": true,
	}
	print("bench tiles: %s on %s ready" % [info.setup, info.engine])


func _process(_delta: float) -> void:
	var now := Time.get_ticks_usec()
	if _recording and _last_us > 0:
		_frames.append(float(now - _last_us))
	_last_us = now


# ------------------------------------------------------------------ hooks


func bench_call(cmd: String, opts: Dictionary) -> Variant:
	match cmd:
		"info":
			var live := info.duplicate()
			live["running"] = running
			live["done"] = results.keys()
			live["kept"] = _kept.size()
			live["nodes"] = get_tree().get_node_count()
			return live
		"run":
			var test := str(opts.get("test", ""))
			if not test in ["load", "memory", "free"]:
				return {"error": "unknown test '%s' (tests: load, memory, free)" % test}
			if running != "":
				return {"error": "test '%s' is still running" % running}
			results.erase(test)
			_run(test, opts)
			return {"started": test}
		"poll":
			var test := str(opts.get("test", ""))
			return {"running": running, "done": results.has(test), "result": results.get(test)}
		"pose", "path":
			var name := str(opts.get("name", "overview"))
			if not POSES.has(name):
				return {"error": "unknown pose '%s' (poses: %s)" % [name, ", ".join(POSES.keys())]}
			look_at_pose(name)
			return {"pos": [cam.global_position.x, cam.global_position.y, cam.global_position.z], "moving": false}
	return {"error": "unknown bench command '%s' (info, run, poll, pose)" % cmd}


func _run(test: String, opts: Dictionary) -> void:
	running = test
	var t0 := Time.get_ticks_msec()
	var res: Dictionary
	match test:
		"load":
			res = await _test_load(opts)
		"memory":
			res = await _test_memory(opts)
		_:
			res = await _test_free()
	res["wallMs"] = Time.get_ticks_msec() - t0
	results[test] = res
	running = ""
	print("bench tiles: test %s done in %d ms" % [test, res.wallMs])


# ------------------------------------------------------------------ loading one tile, off the main thread


## Loads one tile file of a format. Returns {ok, root, bodies, thread_us (work on worker threads), wait_us (wall
## time from the request until the nodes are ready), triangles, collider_triangles, placements}.
func _load_one(format: String, path: String) -> Dictionary:
	var t0 := Time.get_ticks_usec()
	var out := {}
	if format == "t2":
		var err := ResourceLoader.load_threaded_request(path, "PackedScene", true, ResourceLoader.CACHE_MODE_IGNORE)
		if err != OK:
			return {"ok": false, "error": "load_threaded_request(%s) failed: %d" % [path, err]}
		while ResourceLoader.load_threaded_get_status(path) == ResourceLoader.THREAD_LOAD_IN_PROGRESS:
			await get_tree().process_frame
		if ResourceLoader.load_threaded_get_status(path) != ResourceLoader.THREAD_LOAD_LOADED:
			return {"ok": false, "error": "threaded load of %s failed" % path}
		var scene: PackedScene = ResourceLoader.load_threaded_get(path)
		out["resource_us"] = Time.get_ticks_usec() - t0
		var task := WorkerThreadPool.add_task(_instantiate_t2.bind(scene, out))
		while not WorkerThreadPool.is_task_completed(task):
			await get_tree().process_frame
		WorkerThreadPool.wait_for_task_completion(task)
		out["thread_us"] = int(out.resource_us) + int(out.get("instantiate_us", 0))
	else:
		var task := WorkerThreadPool.add_task(_load_worker.bind(format, path, out))
		while not WorkerThreadPool.is_task_completed(task):
			await get_tree().process_frame
		WorkerThreadPool.wait_for_task_completion(task)
	out["wait_us"] = Time.get_ticks_usec() - t0
	return out


## Worker thread: reads a T1 tile or a .glb into nodes.
func _load_worker(format: String, path: String, out: Dictionary) -> void:
	if format == "t1":
		out.merge(TileT1.load_tile(path))
	else:
		_load_glb(path, out)


## Worker thread: a PackedScene to nodes, the collider bodies split off so they can be attached a few per frame.
func _instantiate_t2(scene: PackedScene, out: Dictionary) -> void:
	var t0 := Time.get_ticks_usec()
	var root: Node3D = scene.instantiate()
	var bodies: Array[StaticBody3D] = []
	var triangles := 0
	var collider_triangles := 0
	var placements := 0
	for child in root.get_children():
		if child is StaticBody3D:
			# the packed scene made root the owner: clear it, or adding the body back later warns about the owner
			child.owner = null
			for sub in child.get_children():
				sub.owner = null
			root.remove_child(child)
			bodies.append(child)
			var shape: ConcavePolygonShape3D = (child.get_child(0) as CollisionShape3D).shape
			collider_triangles += shape.get_faces().size() / 3
		elif child is MeshInstance3D:
			triangles += (child.mesh as ArrayMesh).surface_get_array_index_len(0) / 3
		elif child is MultiMeshInstance3D:
			placements += (child.multimesh as MultiMesh).instance_count
	out.merge({"ok": true, "root": root, "bodies": bodies, "triangles": triangles, "collider_triangles": collider_triangles, "placements": placements, "instantiate_us": Time.get_ticks_usec() - t0})


## Worker thread: a .glb to the same nodes. Meshes named col_* become one trimesh body each.
func _load_glb(path: String, out: Dictionary) -> void:
	var t0 := Time.get_ticks_usec()
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	var err := doc.append_from_file(path, state)
	if err != OK:
		out.merge({"ok": false, "error": "GLTFDocument.append_from_file(%s) failed: %d" % [path, err]})
		return
	var scene := doc.generate_scene(state)
	if scene == null:
		out.merge({"ok": false, "error": "GLTFDocument.generate_scene gave no scene for %s" % path})
		return
	var root := Node3D.new()
	root.name = "TileGlb"
	var bodies: Array[StaticBody3D] = []
	var triangles := 0
	var collider_triangles := 0
	for child in scene.get_children():
		var mesh: Mesh = null
		if child is MeshInstance3D:
			mesh = child.mesh
		elif child is ImporterMeshInstance3D:
			mesh = (child.mesh as ImporterMesh).get_mesh()
		if mesh == null:
			continue
		if str(child.name).begins_with("col_"):
			var body := StaticBody3D.new()
			body.name = str(child.name)
			var cs := CollisionShape3D.new()
			cs.shape = mesh.create_trimesh_shape()
			body.add_child(cs)
			bodies.append(body)
			collider_triangles += mesh.surface_get_array_index_len(0) / 3
		else:
			var mi := MeshInstance3D.new()
			mi.name = str(child.name)
			mi.mesh = mesh
			root.add_child(mi)
			triangles += mesh.surface_get_array_index_len(0) / 3
	scene.free()
	out.merge({"ok": true, "root": root, "bodies": bodies, "triangles": triangles, "collider_triangles": collider_triangles, "placements": 0, "thread_us": Time.get_ticks_usec() - t0})


## Main thread: the tile's meshes in one step, then one collider chunk per frame. Returns the time of each step (us).
func _attach(tile: Dictionary, at: Vector3) -> PackedFloat64Array:
	var steps := PackedFloat64Array()
	var root: Node3D = tile.root
	var t := Time.get_ticks_usec()
	for child in root.get_children():
		if child is MeshInstance3D:
			(child as MeshInstance3D).material_override = _materials.get(str(child.name), _materials.buildings)
		elif child is MultiMeshInstance3D:
			(child.multimesh as MultiMesh).mesh = _module_mesh
	root.position = at
	add_child(root)
	steps.append(float(Time.get_ticks_usec() - t))
	for body: StaticBody3D in tile.bodies:
		await get_tree().process_frame
		t = Time.get_ticks_usec()
		root.add_child(body)
		steps.append(float(Time.get_ticks_usec() - t))
	return steps


func _frames_idle(n: int) -> void:
	for i in n:
		await get_tree().process_frame


func _test_load(opts: Dictionary) -> Dictionary:
	var format := str(opts.get("format", "t1"))
	var files: Array = opts.get("files", [])
	var loads := int(opts.get("loads", 20))
	# frames with nothing going on: what a frame costs before any tile work
	await _frames_idle(20)
	_frames = PackedFloat64Array()
	_recording = true
	await _frames_idle(90)
	_recording = false
	var baseline := Util.stats(_frames, 0.001)
	var thread := PackedFloat64Array()
	var wait := PackedFloat64Array()
	var extra := PackedFloat64Array()
	var attach_mesh := PackedFloat64Array()
	var attach_chunk := PackedFloat64Array()
	var attach_total := PackedFloat64Array()
	var set_thread := PackedFloat64Array()
	var set_attach := PackedFloat64Array()
	var load_frames := PackedFloat64Array()
	var attach_frames := PackedFloat64Array()
	var counts := {}
	for i in loads + 1:
		var tiles: Array[Node3D] = []
		var sum_thread := 0.0
		var sum_attach := 0.0
		for k in files.size():
			_frames = PackedFloat64Array()
			_recording = true
			var tile: Dictionary = await _load_one(format, str(files[k]))
			_recording = false
			if not tile.get("ok", false):
				return {"error": str(tile.get("error", "load failed")), "format": format}
			if i > 0:
				load_frames.append_array(_frames)
			_frames = PackedFloat64Array()
			_recording = true
			var steps: PackedFloat64Array = await _attach(tile, Vector3(float(k % 2) * 250.0, 0, float(k / 2) * 250.0))
			await get_tree().process_frame
			await get_tree().process_frame
			_recording = false
			tiles.append(tile.root)
			if i == 0:
				# the first load pays for file cache and first use of code paths: kept out of the numbers
				counts = {"triangles": int(counts.get("triangles", 0)) + int(tile.triangles), "colliderTriangles": int(counts.get("colliderTriangles", 0)) + int(tile.collider_triangles), "colliderChunks": int(counts.get("colliderChunks", 0)) + (tile.bodies as Array).size(), "placements": int(counts.get("placements", 0)) + int(tile.placements)}
				continue
			attach_frames.append_array(_frames)
			thread.append(float(tile.thread_us))
			wait.append(float(tile.wait_us))
			if tile.has("instantiate_us"):
				extra.append(float(tile.instantiate_us))
			var total := 0.0
			for s in steps.size():
				total += steps[s]
				if s == 0:
					attach_mesh.append(steps[s])
				else:
					attach_chunk.append(steps[s])
			attach_total.append(total)
			sum_thread += float(tile.thread_us)
			sum_attach += total
		if i > 0:
			set_thread.append(sum_thread)
			set_attach.append(sum_attach)
		if i < loads:
			for t in tiles:
				t.queue_free()
			await _frames_idle(3)
		else:
			_kept.append_array(tiles)
	var res := {
		"format": format, "files": files, "loads": loads, "counts": counts,
		"perTile": {
			"threadMs": Util.stats(thread, 0.001), "requestToReadyMs": Util.stats(wait, 0.001), "attachTotalMs": Util.stats(attach_total, 0.001),
			"attachMeshStepMs": Util.stats(attach_mesh, 0.001), "attachChunkStepMs": Util.stats(attach_chunk, 0.001),
		},
		"perSet": {"tiles": files.size(), "threadMs": Util.stats(set_thread, 0.001), "attachMs": Util.stats(set_attach, 0.001)},
		"frames": {"idle": baseline, "whileLoading": Util.stats(load_frames, 0.001), "whileAttaching": Util.stats(attach_frames, 0.001)},
	}
	if extra.size() > 0:
		res.perTile["instantiateMs"] = Util.stats(extra, 0.001)
	return res


func _memory_now() -> Dictionary:
	return {
		"staticMB": Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0,
		"bufferMB": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_BUFFER_MEM_USED) / 1048576.0,
		"videoMB": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_VIDEO_MEM_USED) / 1048576.0,
	}


func _test_memory(opts: Dictionary) -> Dictionary:
	var format := str(opts.get("format", "t1"))
	var files: Array = opts.get("files", [])
	var copies := int(opts.get("copies", 8))
	await _frames_idle(10)
	var before := _memory_now()
	for i in copies:
		for k in files.size():
			var tile: Dictionary = await _load_one(format, str(files[k]))
			if not tile.get("ok", false):
				return {"error": str(tile.get("error", "load failed")), "format": format}
			# far from the camera and apart from each other, so they do not overlap
			await _attach(tile, Vector3(2000.0 + float(i) * 600.0, 0, float(k) * 600.0))
			_kept.append(tile.root)
	await _frames_idle(10)
	var after := _memory_now()
	var n := float(copies)
	return {
		"format": format, "copies": copies, "tilesPerCopy": files.size(),
		"staticMBPerCopy": Util.r((after.staticMB - before.staticMB) / n, 3), "bufferMBPerCopy": Util.r((after.bufferMB - before.bufferMB) / n, 3),
		"videoMBPerCopy": Util.r((after.videoMB - before.videoMB) / n, 3),
	}


func _test_free() -> Dictionary:
	var n := _kept.size()
	for t in _kept:
		if is_instance_valid(t):
			t.queue_free()
	_kept.clear()
	await _frames_idle(5)
	return {"freed": n}


# ------------------------------------------------------------------ a plain readable look


func look_at_pose(name: String) -> void:
	var p: Array = POSES[name]
	cam.global_position = p[0]
	cam.look_at(p[1], Vector3.UP)


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
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.7
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50, -30, 0)
	sun.light_energy = 1.1
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 500.0
	add_child(sun)
	cam = Camera3D.new()
	cam.fov = 55.0
	cam.near = 0.2
	cam.far = 6000.0
	add_child(cam)
	cam.make_current()
