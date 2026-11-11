## Collider test of the physics bench (P0-017), decision K of ARCH_OPTIONS.md, on one 250 m tile (tile.gd):
##   K1  one triangle mesh of everything that is drawn (ground, roads, kerbs, footpaths, building walls, window
##       frames, sills, balconies)
##   K3  one triangle mesh of the surfaces you can drive or walk on, from the same vertices as the drawn mesh, plus
##       one box per building
## Each is loaded 100 times: the shapes are made on a WorkerThreadPool thread, the body is attached on the main
## thread, a ray checks it, then it is freed. Measured: time on the thread, time of the attach call on the main
## thread, the worst frame after it, and the owner rule (a ray down at 20 points hits within 0.05 m of the drawn
## surface). Extras: a second way of loading (server: shape, body and body_add_shape through PhysicsServer3D on the
## thread, body_set_space on the main thread, 20 loads), the K3 surface mesh cut into 16 chunks (the attach cost per
## chunk), and a memory probe: run {memory: "k1" | "k3", copies} attaches that many colliders and keeps them, so
## the harness can read the process memory before and after (Jolt's memory is not in Godot's own counters).
extends RefCounted

const Util := preload("res://bench/physics/util.gd")
const Geo := preload("res://bench/physics/geo.gd")
const Tile := preload("res://bench/physics/tile.gd")

const LOADS := 100
const AT := Vector3(-700.0, 0.0, -300.0)
const LAYER := 16

var b: Node
var clock: Node
var tile: Tile
var root: Node3D
var all_faces := PackedVector3Array()
var ray_failures := 0
var _kept: Array[StaticBody3D] = []


func run(bench: Node, opts: Dictionary) -> Dictionary:
	b = bench
	clock = b.clock
	clock.set_scale(1.0)
	var loads := int(opts.get("loads", LOADS))
	if tile == null:
		tile = Tile.new()
		tile.build()
		root = Node3D.new()
		root.name = "Tile"
		root.position = AT
		b.world.add_child(root)
		for g in [tile.surfaces, tile.detail]:
			var mi := MeshInstance3D.new()
			mi.mesh = (g as Geo).mesh()
			mi.material_override = Geo.material()
			root.add_child(mi)
		all_faces = tile.surfaces.verts.duplicate()
		all_faces.append_array(tile.detail.verts)
		b.look_from(AT + Vector3(-70, 55, 110), AT + Vector3(0, 4, 0))
		await b.ticks(30)
	if opts.has("memory"):
		return await _memory(str(opts.memory), int(opts.get("copies", 8)))
	var out := {"tile": tile.stats, "separateThread": bool(ProjectSettings.get_setting("physics/3d/run_on_separate_thread"))}
	out["k1"] = await _measure("k1", loads)
	out["k3"] = await _measure("k3", loads)
	out["k3"]["chunks16"] = await _chunks(4, 5)
	var total := int(out.k1.loads) + int(out.k3.loads) + int(out.k1.serverWay.loads) + int(out.k3.serverWay.loads)
	out["offMainThread"] = {
		"loads": total, "loadsResourceWay": int(out.k1.loads) + int(out.k3.loads), "rayFailures": ray_failures,
		"note": "resource way: ConcavePolygonShape3D.set_faces and BoxShape3D made on the thread, StaticBody3D attached on the main thread. server way: shape, body and body_add_shape through PhysicsServer3D on the thread, body_set_space on the main thread. engineErrors of this row lists any error the engine printed",
	}
	return out


func _measure(kind: String, loads: int) -> Dictionary:
	var faces := all_faces if kind == "k1" else tile.surfaces.verts
	var res: Dictionary = await _loads(kind, faces, loads, false)
	res["serverWay"] = await _loads(kind, faces, mini(loads, 20), true)
	# the owner rule, on a collider that stays
	var body: StaticBody3D = _attach(_build_job({"kind": kind, "faces": faces, "server": false}))
	await b.ticks(3)
	res["ownerRule"] = _owner_rule()
	body.queue_free()
	await b.ticks(3)
	return res


## Thread job: makes the shapes of one tile collider. job: {kind, faces, server}. Fills job.shapes or job.rids.
func _build_job(job: Dictionary) -> Dictionary:
	var t0 := Time.get_ticks_usec()
	var boxes: Array = [] if job.kind == "k1" else tile.shells
	if job.server:
		var body := PhysicsServer3D.body_create()
		PhysicsServer3D.body_set_mode(body, PhysicsServer3D.BODY_MODE_STATIC)
		PhysicsServer3D.body_set_collision_layer(body, LAYER)
		PhysicsServer3D.body_set_collision_mask(body, 0)
		var rids: Array[RID] = []
		var mesh := PhysicsServer3D.concave_polygon_shape_create()
		PhysicsServer3D.shape_set_data(mesh, {"faces": job.faces, "backface_collision": false})
		PhysicsServer3D.body_add_shape(body, mesh)
		rids.append(mesh)
		for s in boxes:
			var box := PhysicsServer3D.box_shape_create()
			PhysicsServer3D.shape_set_data(box, (s[1] as Vector3) * 0.5)
			PhysicsServer3D.body_add_shape(body, box, Transform3D(Basis(), s[0]))
			rids.append(box)
		job["body"] = body
		job["rids"] = rids
	else:
		var shapes: Array = []
		var mesh := ConcavePolygonShape3D.new()
		mesh.set_faces(job.faces)
		shapes.append([mesh, Vector3.ZERO])
		for s in boxes:
			var box := BoxShape3D.new()
			box.size = s[1]
			shapes.append([box, s[0]])
		job["shapes"] = shapes
	job["threadUs"] = Time.get_ticks_usec() - t0
	return job


func _attach(job: Dictionary) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.collision_layer = LAYER
	body.collision_mask = 0
	for s in job.shapes:
		var cs := CollisionShape3D.new()
		cs.shape = s[0]
		cs.position = s[1]
		body.add_child(cs)
	root.add_child(body)
	return body


func _ray_down(x: float, z: float) -> Dictionary:
	var q := PhysicsRayQueryParameters3D.new()
	q.collision_mask = LAYER
	var base: Vector3 = b.origin + AT
	q.from = base + Vector3(x, 200.0, z)
	q.to = base + Vector3(x, -50.0, z)
	return b.get_world_3d().direct_space_state.intersect_ray(q)


func _loads(kind: String, faces: PackedVector3Array, loads: int, server: bool) -> Dictionary:
	var thread_ms := PackedFloat64Array()
	var attach_ms := PackedFloat64Array()
	var frame_ms := PackedFloat64Array()
	var failures := 0
	var space: RID = b.get_world_3d().space
	for i in loads:
		var job := {"kind": kind, "faces": faces, "server": server}
		var id := WorkerThreadPool.add_task(_build_job.bind(job))
		while not WorkerThreadPool.is_task_completed(id):
			await b.get_tree().process_frame
		WorkerThreadPool.wait_for_task_completion(id)
		thread_ms.append(float(job.threadUs))
		# main thread: attach, then watch the next frames for a hitch
		var t0 := Time.get_ticks_usec()
		var body: StaticBody3D = null
		if server:
			PhysicsServer3D.body_set_state(job.body, PhysicsServer3D.BODY_STATE_TRANSFORM, Transform3D(Basis(), b.origin + AT))
			PhysicsServer3D.body_set_space(job.body, space)
		else:
			body = _attach(job)
		attach_ms.append(Time.get_ticks_usec() - t0)
		var worst := 0.0
		var last := Time.get_ticks_usec()
		for f in 4:
			await b.get_tree().process_frame
			var now := Time.get_ticks_usec()
			worst = maxf(worst, now - last)
			last = now
		frame_ms.append(worst)
		# rays only inside a physics frame (the only place they work when physics runs on its own thread)
		await b.get_tree().physics_frame
		var hit := _ray_down(1.0, 2.0)
		if hit.is_empty() or absf((hit.position as Vector3).y - b.origin.y - Tile.ground_h(1.0, 2.0)) > 0.05:
			failures += 1
		if server:
			PhysicsServer3D.free_rid(job.body)
			for rid in job.rids:
				PhysicsServer3D.free_rid(rid)
		else:
			body.queue_free()
		job.clear()
		await b.get_tree().process_frame
		await b.get_tree().process_frame
	ray_failures += failures
	return {
		"triangles": faces.size() / 3, "boxShapes": 0 if kind == "k1" else tile.shells.size(), "loads": loads,
		"threadMs": Util.stats(thread_ms, 0.001, 3), "attachCallMs": Util.stats(attach_ms, 0.001, 3), "worstFrameAfterAttachMs": Util.stats(frame_ms, 0.001, 2),
		"faceDataMB": Util.r(faces.size() * 12.0 / 1048576.0, 2), "rayFailures": failures,
	}


## The K3 surface mesh cut into n by n chunks, each attached in its own frame: the main thread cost per chunk.
func _chunks(n: int, rounds: int) -> Dictionary:
	var lists: Array[PackedVector3Array] = []
	for i in n * n:
		lists.append(PackedVector3Array())
	var soup := tile.surfaces.verts
	var half := Tile.SIZE * 0.5
	for i in range(0, soup.size(), 3):
		var c := (soup[i] + soup[i + 1] + soup[i + 2]) / 3.0
		var cx := clampi(int((c.x + half) / Tile.SIZE * n), 0, n - 1)
		var cz := clampi(int((c.z + half) / Tile.SIZE * n), 0, n - 1)
		var list := lists[cx + cz * n]
		list.append(soup[i])
		list.append(soup[i + 1])
		list.append(soup[i + 2])
	var attach_ms := PackedFloat64Array()
	var tris := 0
	for r in rounds:
		var made: Array[StaticBody3D] = []
		for list in lists:
			var job := {"kind": "k1", "faces": list, "server": false}
			var id := WorkerThreadPool.add_task(_build_job.bind(job))
			while not WorkerThreadPool.is_task_completed(id):
				await b.get_tree().process_frame
			WorkerThreadPool.wait_for_task_completion(id)
			var t0 := Time.get_ticks_usec()
			made.append(_attach(job))
			attach_ms.append(Time.get_ticks_usec() - t0)
			tris = maxi(tris, list.size() / 3)
			await b.get_tree().process_frame
		await b.ticks(2)
		if r == rounds - 1:
			var hit := _ray_down(1.0, 2.0)
			if hit.is_empty():
				ray_failures += 1
		for body in made:
			body.queue_free()
		await b.ticks(2)
	return {"chunks": n * n, "trianglesPerChunkMax": tris, "attachCallMs": Util.stats(attach_ms, 0.001, 3),
		"usPerTriangle": Util.r(float(Util.stats(attach_ms, 1.0, 1).mean) / maxf(1.0, soup.size() / 3.0 / (n * n)), 3)}


## Memory probe. "prepare" only builds the tile; "k1" or "k3" attaches `copies` colliders of that kind and keeps
## them; "free" frees the kept ones. The harness reads the process memory around the k1 and k3 calls, in a fresh
## process before any load loop (memory freed by earlier loads would hide the growth).
func _memory(kind: String, copies: int) -> Dictionary:
	if kind == "prepare":
		return {"kind": kind}
	if kind == "free":
		for body in _kept:
			body.queue_free()
		_kept.clear()
		await b.ticks(10)
		return {"kind": kind}
	var faces := all_faces if kind == "k1" else tile.surfaces.verts
	for i in copies:
		# each copy gets its own vertex array, as each tile would
		var mine := faces.duplicate()
		mine[0] = mine[0]
		_kept.append(_attach(_build_job({"kind": kind, "faces": mine, "server": false})))
		await b.ticks(2)
	await b.ticks(10)
	return {"kind": kind, "copies": copies, "triangles": faces.size() / 3, "faceDataMB": Util.r(faces.size() * 12.0 / 1048576.0, 2)}


## A ray down at the tile's 20 sample points against the collider, compared with the drawn surface under the point.
func _owner_rule() -> Dictionary:
	var worst := 0.0
	var sum := 0.0
	var misses := 0
	var rows: Array = []
	for p in tile.samples:
		var drawn := Geo.height_at(tile.surfaces.verts, p.x, p.y)
		var hit := _ray_down(p.x, p.y)
		if hit.is_empty() or is_nan(drawn):
			misses += 1
			continue
		var err := absf((hit.position as Vector3).y - b.origin.y - drawn)
		worst = maxf(worst, err)
		sum += err
		rows.append([Util.r(p.x, 2), Util.r(p.y, 2), Util.r(drawn, 4), Util.r(err, 5)])
	var n := tile.samples.size() - misses
	return {"points": tile.samples.size(), "misses": misses, "maxErrorM": Util.r(worst, 5), "meanErrorM": Util.r(sum / maxf(1.0, n), 5),
		"targetM": 0.05, "pass": misses == 0 and worst <= 0.05, "rows": rows, "rowsAre": "[x, z, drawn height, error] in metres, tile coordinates"}
