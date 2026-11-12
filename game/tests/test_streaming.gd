## The streaming core and the first streamed systems (P1-019; game/world/streaming/, game/world/systems/,
## game/geo/world_frame.gd, game/world/world_stream.gd): the world frame, ring choice by distance and heading, the
## hysteresis ring, the memory cap, the attach cap (1 ms a frame, 3 collider chunks, never with a mesh step), build
## and dispose on the committed test block, a tile with a wrong version or a vertex outside its margin is reported
## and skipped while its neighbours load, the far ring hooks and the threaded read.
extends RefCounted

const GameArgs := preload("res://core/game_args.gd")
const TileIndex := preload("res://world/streaming/tile_index.gd")
const TileReader := preload("res://world/streaming/tile_reader.gd")
const RingPlan := preload("res://world/streaming/ring_plan.gd")
const AttachQueue := preload("res://world/streaming/attach_queue.gd")
const StreamCore := preload("res://world/streaming/stream_core.gd")
const WorldFrame := preload("res://geo/world_frame.gd")
const WorldStream := preload("res://world/world_stream.gd")
const TileMesh := preload("res://world/systems/tile_mesh.gd")
const GroundRoads := preload("res://world/systems/ground_roads.gd")
const Buildings := preload("res://world/systems/buildings.gd")
const Colliders := preload("res://world/systems/colliders.gd")
const Lanes := preload("res://world/systems/lanes.gd")
const TEST_TILES := "res://world/test_tiles/"
const FIXTURE := "res://../harness/data/fixtures/tile_t1_sample.json"
const TMP := "user://stream_test/"
## The corner the four ITO tiles of the test block share, and the one four Connaught Place tiles share.
const ITO := Vector3(2250.0, 206.0, -1250.0)
const CP := Vector3(-750.0, 214.0, -1750.0)

var t
var tree: SceneTree


## A fake streamed system: every step costs `cost_usec` on a fake clock and a job takes `steps` steps.
class FakeSystem:
	extends RefCounted
	var id := "fake"
	var lane := "mesh"
	var exclusive := true
	var per_frame := 0
	var budget_ms := 0.3
	var cost_usec := 200
	var clock: Array = [0]
	var attached := 0
	var disposed := 0
	var log: Array[String] = []

	func prepare(_tile: Dictionary) -> Variant:
		return {"left": 1}

	func attach(_tile: Dictionary, part: Variant) -> bool:
		clock[0] += cost_usec
		attached += 1
		part.left -= 1
		return part.left <= 0

	func dispose(_tile: Dictionary, _part: Variant) -> bool:
		clock[0] += cost_usec
		disposed += 1
		return true

	func ring_enter(ring: int, key: Vector2i) -> void:
		log.append("enter %d %d_%d" % [ring, key.x, key.y])

	func ring_exit(ring: int, key: Vector2i) -> void:
		log.append("exit %d %d_%d" % [ring, key.x, key.y])


func _all(_key: Vector2i) -> bool:
	return true


## The city on the test block, in the tree, stepped by hand (no thread, no _process).
func _city(dir := TEST_TILES) -> Node3D:
	var city: Node3D = WorldStream.new()
	if not city.setup(dir):
		city.free()
		return null
	city.core.threaded = false
	city.core.set_process(false)
	tree.root.add_child(city)
	return city


func _until_ready(core: Node, limit := 4000) -> int:
	var steps := 0
	while steps < limit:
		core.step()
		steps += 1
		if core.ring_ready() and core.queue.pending() == 0 and core.info().queue.reading == 0 and core.info().queue.waiting == 0:
			break
	return steps


func test_the_tiles_arg_parses_and_names_a_folder() -> void:
	t.ok(GameArgs.parse(PackedStringArray()).tiles == "", "no --tiles by default")
	t.ok(GameArgs.parse(PackedStringArray(["--tiles=test"])).tiles == "test", "--tiles=test")
	t.ok(GameArgs.parse(PackedStringArray(["--tiles", "full"])).tiles == "full", "--tiles full")
	t.ok(GameArgs.parse(PackedStringArray(["--tiles"])).unknown == ["--tiles"], "--tiles with no value is unknown, never an error")
	t.ok(TileIndex.folder_of("test") == TEST_TILES and TileIndex.folder_of("full") == "res://world/tiles/", "test and full name their folders")
	t.ok(TileIndex.folder_of("res://x") == "res://x/" and TileIndex.folder_of("nope") == "", "a res:// folder is taken as it is, an unknown name has none")
	var missing: RefCounted = TileIndex.open("res://world/not_a_folder/")
	t.ok(missing.error != "" and missing.count() == 0, "a missing folder is an error value, not a crash")


func test_the_index_and_the_world_frame() -> void:
	var index: RefCounted = TileIndex.open(TEST_TILES)
	t.ok(index.error == "" and index.count() == 9 and index.total_bytes < 12 * 1048576, "the committed test block has 9 tiles under 12 MB")
	t.ok(index.has(Vector2i(8, -6)) and not index.has(Vector2i(0, 0)) and index.path(Vector2i(8, -6)) == TEST_TILES + "8_-6.ktl", "tiles are found by their grid key")
	t.ok(index.tiles[Vector2i(8, -6)].origin.is_equal_approx(Vector3(2000.0, index.tiles[Vector2i(8, -6)].origin.y, -1500.0)), "a tile's origin is the world position of its north-west corner")
	var frame: RefCounted = WorldFrame.from_index(index.raw)
	t.ok(frame.has_block("centre") and not frame.has_block("airport"), "the frame knows the blocks of the index")
	var pivot: Dictionary = frame.geo_to_world(28.612894, 77.229446)
	t.near(pivot.x, 621.6, 0.01, "India Gate lands on the centre block's offset, x")
	t.near(pivot.z, 467.2, 0.01, "India Gate lands on the centre block's offset, z")
	var back: Dictionary = frame.world_to_block("centre", pivot.x, pivot.z)
	t.ok(absf(back.x) < 0.01 and absf(back.z) < 0.01, "world to block undoes the offset")
	# Connaught Place lies north-west of India Gate, the ITO crossing north-east: north is -Z, east is +X, no mirror
	var cp: Dictionary = frame.geo_to_world(28.6328, 77.2197)
	var ito: Dictionary = frame.geo_to_world(28.6282, 77.2411)
	t.ok(cp.x < pivot.x and cp.z < pivot.z and ito.x > pivot.x and ito.z < pivot.z, "Connaught Place is north-west and ITO north-east of India Gate")
	var cp_tile := WorldFrame.tile_of(cp.x, cp.z)
	t.ok(WorldFrame.tile_id(cp_tile) == "-2_-7" and index.has(cp_tile + Vector2i(-1, 0)), "the Connaught Place park is in tile -2_-7, next to the test block's -3_-7 (%s)" % WorldFrame.tile_id(cp_tile))
	t.ok(WorldFrame.tile_of(-0.5, 249.9) == Vector2i(-1, 0) and WorldFrame.tile_of(250.0, -250.0) == Vector2i(1, -1) and WorldFrame.tile_id(Vector2i(-3, -7)) == "-3_-7", "tile ids come from world metres, floor on both axes")
	t.near(WorldFrame.tile_distance(Vector2i(0, 0), 125.0, 125.0), 0.0, 1e-6, "inside a tile the distance is 0")
	t.near(WorldFrame.tile_distance(Vector2i(2, 0), 125.0, 125.0), 375.0, 1e-6, "distance to the near edge")
	t.near(WorldFrame.tile_distance(Vector2i(2, 2), 125.0, 125.0), 375.0 * sqrt(2.0), 1e-4, "distance to the near corner")
	t.ok(WorldFrame.within_reach(8000.0, 0.0) and not WorldFrame.within_reach(6000.0, 6000.0), "the reach limit is 8,192 m from the origin")
	for key: Vector2i in index.tiles:
		var c: Array = WorldFrame.tile_corner(key)
		t.ok(WorldFrame.within_reach(c[0], c[1]), "tile %s is inside the reach limit" % WorldFrame.tile_id(key))


func test_ring_choice_by_distance() -> void:
	var plan := RingPlan.new()
	var got: Array[Vector2i] = plan.wanted(125.0, 125.0, Vector2.ZERO, 0.0, _all)
	var want := {}
	for tz in range(-6, 7):
		for tx in range(-6, 7):
			var dx := maxf(maxf(tx * 250.0 - 125.0, 125.0 - (tx + 1) * 250.0), 0.0)
			var dz := maxf(maxf(tz * 250.0 - 125.0, 125.0 - (tz + 1) * 250.0), 0.0)
			if sqrt(dx * dx + dz * dz) <= 375.0:
				want[Vector2i(tx, tz)] = true
	t.ok(got.size() == want.size() and got.size() == 13, "the full ring round a tile centre is the 13 tiles within 375 m (%d)" % got.size())
	for key in got:
		t.ok(want.has(key), "tile %s is within 375 m" % key)
	t.ok(got[0] == Vector2i(0, 0), "the tile under the focus loads first")
	t.ok(Vector2i(2, 0) in got and not Vector2i(3, 0) in got and not Vector2i(2, 1) in got, "a tile 375 m away is in, 395 m and 625 m are out")
	var holes := func(key: Vector2i) -> bool: return key != Vector2i(1, 0)
	t.ok(not Vector2i(1, 0) in plan.wanted(125.0, 125.0, Vector2.ZERO, 0.0, holes), "a tile the map does not have is never wanted")
	# the far rings: block shells to 900 m, the skyline is every 1 km cell of the map
	var shells: Array[Vector2i] = plan.wanted(125.0, 125.0, Vector2.ZERO, 0.0, _all, RingPlan.RING_SHELLS)
	t.ok(Vector2i(4, 0) in shells and not Vector2i(5, 0) in shells and shells.size() > 50, "the shell ring reaches 900 m (%d tiles)" % shells.size())
	var sky: Array[Vector2i] = plan.wanted(125.0, 125.0, Vector2.ZERO, 0.0, _all, RingPlan.RING_SKYLINE, [Vector2i(0, 0), Vector2i(7, -7)])
	t.ok(sky.size() == 2 and plan.keep(Vector2i(7, -7), 125.0, 125.0, Vector2.ZERO, 0.0, RingPlan.RING_SKYLINE), "the skyline ring holds every cell of the map, always")
	t.ok(RingPlan.RINGS.size() == 3 and float(RingPlan.RINGS[0].radius) == 375.0 and float(RingPlan.RINGS[1].radius) == 900.0 and float(RingPlan.RINGS[2].cell) == 1000.0, "three rings: 375 m, 900 m, 1 km skyline cells")


func test_ring_choice_by_heading() -> void:
	var plan := RingPlan.new()
	var east := Vector2(1.0, 0.0)
	var kmh200 := 200.0 / 3.6
	var lead := plan.lead_point(125.0, 125.0, east, kmh200)
	t.near(lead[0], 125.0 + kmh200 * 2.0, 1e-3, "the lead point is 2 s ahead at 200 km/h (111 m)")
	t.near(plan.lead_point(125.0, 125.0, east, 500.0)[0], 125.0 + 150.0, 1e-3, "and never more than 150 m ahead")
	var still: Array[Vector2i] = plan.wanted(125.0, 125.0, Vector2.ZERO, 0.0, _all)
	var moving: Array[Vector2i] = plan.wanted(125.0, 125.0, east, kmh200, _all)
	t.ok(not Vector2i(2, 1) in still and Vector2i(2, 1) in moving, "a tile ahead that is out of the ring at rest is wanted at speed")
	t.ok(not Vector2i(-2, 1) in moving, "the same tile behind is not")
	for key in still:
		t.ok(key in moving, "heading never drops a tile of the ring round the focus (%s)" % key)
	t.ok(moving.find(Vector2i(1, 0)) < moving.find(Vector2i(-1, 0)), "the tile ahead loads before the tile behind")
	t.ok(plan.rank(Vector2i(2, 0), 125.0, 125.0, east, kmh200) < plan.rank(Vector2i(-2, 0), 125.0, 125.0, east, kmh200), "rank follows the heading")


func test_hysteresis_ring() -> void:
	var plan := RingPlan.new()
	var key := Vector2i(0, 0)
	# the focus walks west away from the tile: x = -d is d metres from its edge
	t.ok(key in plan.wanted(-370.0, 125.0, Vector2.ZERO, 0.0, _all) and not key in plan.wanted(-380.0, 125.0, Vector2.ZERO, 0.0, _all), "a tile is wanted up to 375 m")
	t.ok(plan.keep(key, -380.0, 125.0, Vector2.ZERO, 0.0) and plan.keep(key, -499.0, 125.0, Vector2.ZERO, 0.0), "a loaded tile is kept between 375 and 500 m")
	t.ok(not plan.keep(key, -501.0, 125.0, Vector2.ZERO, 0.0), "and dropped past 500 m")
	# a focus that turns round at 380 to 490 m never reloads the tile
	var loaded := true
	var reloads := 0
	for step in 40:
		var d := 380.0 + 110.0 * absf(sin(step * 0.7))
		if loaded and not plan.keep(key, -d, 125.0, Vector2.ZERO, 0.0):
			loaded = false
		elif not loaded and key in plan.wanted(-d, 125.0, Vector2.ZERO, 0.0, _all):
			loaded = true
			reloads += 1
	t.ok(loaded and reloads == 0, "moving back and forth inside the hysteresis band never unloads or reloads")


func test_memory_cap() -> void:
	var plan := RingPlan.new()
	plan.cap_tiles = 4
	var loaded := {}
	for x in 6:
		loaded[Vector2i(x, 0)] = 1000
	var wanted := {Vector2i(0, 0): true, Vector2i(1, 0): true, Vector2i(5, 0): true}
	var drop: Array[Vector2i] = plan.over_cap(loaded, wanted, 125.0, 125.0)
	t.ok(drop == [Vector2i(4, 0), Vector2i(3, 0)], "over the cap the farthest tiles outside the wanted set go first (%s)" % [drop])
	plan.cap_tiles = 2
	drop = plan.over_cap(loaded, wanted, 125.0, 125.0)
	t.ok(drop == [Vector2i(4, 0), Vector2i(3, 0), Vector2i(2, 0), Vector2i(5, 0)], "then the farthest wanted ones, until the count fits (%s)" % [drop])
	plan.cap_tiles = 6
	t.ok(plan.over_cap(loaded, wanted, 125.0, 125.0).is_empty(), "at the cap nothing goes")
	drop = plan.over_cap(loaded, wanted, 125.0, 125.0, 2)
	t.ok(drop == [Vector2i(4, 0), Vector2i(3, 0)], "two wanted tiles waiting push out two tiles of the hysteresis band (%s)" % [drop])
	wanted = {}
	for key: Vector2i in loaded:
		wanted[key] = true
	t.ok(plan.over_cap(loaded, wanted, 125.0, 125.0, 3).is_empty(), "a wanted tile is never dropped for another wanted tile")
	plan.cap_bytes = 2500
	t.ok(plan.over_cap(loaded, {}, 125.0, 125.0).size() == 4, "the byte cap drops tiles too")


func test_attach_cap() -> void:
	var clock := [0]
	var queue := AttachQueue.new()
	queue.now_usec = func() -> int: return clock[0]
	var mesh := FakeSystem.new()
	mesh.clock = clock
	var chunks := FakeSystem.new()
	chunks.id = "chunks"
	chunks.lane = "collider"
	chunks.per_frame = 3
	chunks.cost_usec = 100
	chunks.clock = clock
	var data := FakeSystem.new()
	data.id = "data"
	data.lane = "data"
	data.exclusive = false
	data.cost_usec = 50
	data.clock = clock
	var tile := {"key": Vector2i(0, 0), "id": "0_0"}
	queue.push(mesh, tile, {"left": 1}, "attach", 10.0, 0)
	queue.push(chunks, tile, {"left": 10}, "attach", 10.0, 1)
	queue.push(data, tile, {"left": 1}, "attach", 10.0, 2)
	var done: Array[Dictionary] = queue.run()
	t.ok(mesh.attached == 1 and chunks.attached == 0 and data.attached == 1, "a frame that attaches a mesh attaches no collider chunk; a data step may share it")
	t.ok(done.size() == 2 and not queue.frame.mixed and int(queue.frame.attach.mesh) == 1, "the mesh and data jobs finished in the mesh frame")
	var frames := 0
	var worst := 0
	while queue.pending() > 0 and frames < 20:
		clock[0] += 16000
		queue.run()
		frames += 1
		worst = maxi(worst, int(queue.frame.attach.get("collider", 0)))
		t.ok(queue.frame.ms <= 1.0, "a frame's attach work stays inside 1 ms (%.2f)" % queue.frame.ms)
	t.ok(chunks.attached == 10 and worst == 3 and frames == 4, "10 chunks attach 3 a frame at most (%d frames, worst %d)" % [frames, worst])
	# slow chunks: the time cap stops a frame before the chunk cap does
	chunks.cost_usec = 400
	queue.push(chunks, tile, {"left": 6}, "attach", 10.0, 1)
	queue.run()
	t.ok(int(queue.frame.attach.collider) == 2 and queue.frame.ms <= 1.0, "0.4 ms chunks: 2 a frame, the third would pass 1 ms (%d, %.2f ms)" % [int(queue.frame.attach.collider), queue.frame.ms])
	chunks.cost_usec = 5000
	queue.run()
	queue.run()
	t.ok(int(queue.frame.attach.collider) == 1 and int(queue.over.get("chunks:attach", 0)) >= 2, "a step over the cap still runs, alone, and is counted over its budget")
	# burst (a load screen): the per frame cap is lifted
	chunks.cost_usec = 100
	queue.jobs.clear()
	queue.push(chunks, tile, {"left": 20}, "attach", 10.0, 1)
	queue.run(true)
	t.ok(int(queue.frame.attach.collider) == 20 and queue.frame.burst, "a burst attaches every chunk it has time for (%d)" % int(queue.frame.attach.collider))
	# order: the nearest tile first; dispose after attach, unless over the memory cap
	var far := {"key": Vector2i(5, 0), "id": "5_0"}
	queue.push(data, far, {"left": 1}, "dispose", 0.0, 2)
	queue.push(data, far, {"left": 1}, "attach", 500.0, 2)
	queue.push(data, tile, {"left": 1}, "attach", 10.0, 2)
	done = queue.run()
	t.ok(done.size() == 3 and done[0].key == Vector2i(0, 0) and done[0].op == "attach" and done[2].op == "dispose", "attach by rank, then dispose")
	queue.dispose_first = true
	queue.push(data, tile, {"left": 1}, "attach", 10.0, 2)
	queue.push(data, far, {"left": 1}, "dispose", 0.0, 2)
	done = queue.run()
	t.ok(done[0].op == "dispose", "over the memory cap dispose runs first")
	queue.push(data, far, {"left": 1}, "attach", 1.0, 2)
	t.ok(queue.drop(Vector2i(5, 0), "attach") == 1 and queue.pending() == 0, "a tile's jobs can be taken out")


func test_reader_and_systems_on_the_bake_fixture() -> void:
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(ProjectSettings.globalize_path(FIXTURE)))
	t.ok(typeof(parsed) == TYPE_DICTIONARY and (parsed as Dictionary).has("base64"), "the tile fixture loads")
	if typeof(parsed) != TYPE_DICTIONARY:
		return
	var want: Dictionary = parsed.expect
	var tile: Dictionary = TileReader.parse(Marshalls.base64_to_raw(str(parsed.base64)))
	t.ok(tile.ok, "the reader accepts the bake's tile (%s)" % str(tile.get("error", "")))
	if not tile.ok:
		return
	var o: Array = want.origin
	t.ok(tile.origin.is_equal_approx(Vector3(o[0], o[1], o[2])) and is_equal_approx(tile.size, float(want.size)) and is_equal_approx(tile.margin, float(want.margin)), "origin, size and margin")
	t.ok((tile.pins as Array).size() == int(want.pins) and str(tile.pins[0].id) == str(want.firstPin.id), "the pins")
	var mats := TileMesh.stand_ins()
	var holder := Node3D.new()
	var ground: Dictionary = GroundRoads.new(holder, mats).prepare(tile)
	var shells: Dictionary = Buildings.new(holder, mats).prepare(tile)
	t.ok(not ground.has("error") and not shells.has("error"), "both mesh systems accept it")
	t.ok(int(ground.triangles) + int(shells.triangles) == int(want.triangles), "ground, roads and shells hold every drawn triangle (%d)" % int(want.triangles))
	var names := 0
	for m: Dictionary in want.meshes:
		names += 1 if str(m.material) == "building" else 0
	t.ok((shells.mesh as ArrayMesh).get_surface_count() == names and (ground.mesh as ArrayMesh).get_surface_count() == (want.meshes as Array).size() - names, "one surface per material, the shells apart")
	t.ok((ground.mesh as ArrayMesh).surface_get_material(0) is StandardMaterial3D, "every surface carries its stand-in material")
	var col: Dictionary = Colliders.new(holder).prepare(tile)
	var tris := 0
	for n in col.counts:
		tris += n
	t.ok((col.shapes as Array).size() == int(want.colliderChunks) and tris == int(want.colliderTriangles), "%d collider chunks, %d triangles" % [int(want.colliderChunks), int(want.colliderTriangles)])
	var lanes: Dictionary = Lanes.new().prepare(tile)
	var first: Dictionary = lanes.pieces[0]
	var fp: Array = want.firstLane.first
	t.ok((lanes.pieces as Array).size() == int(want.lanes) and str(first.id) == str(want.firstLane.id) and first.next == want.firstLane.next, "the lane pieces with their next ids")
	t.ok((first.pts as PackedVector3Array)[0].distance_to(tile.origin + Vector3(fp[0], fp[1], fp[2])) < 1e-3, "lane points are in world metres")
	holder.free()


func test_build_and_dispose_on_the_test_block() -> void:
	var city := _city()
	t.ok(city != null, "the test block opens")
	if city == null:
		return
	var core: Node = city.core
	var objects0 := Performance.get_monitor(Performance.OBJECT_COUNT)
	core.warp(ITO)
	_until_ready(core)
	t.ok(core.ring_ready() and core.live_ids() == ["8_-5", "8_-6", "9_-5", "9_-6"], "the ring at ITO is its four tiles (%s)" % [core.live_ids()])
	t.ok(not core.burst, "the burst ends when the ring is live")
	var info: Dictionary = city.info()
	t.ok(int(info.tiles) == 4 and int(info.colliderChunks) > 40 and int(info.colliderTriangles) > 20000 and int(info.lanes) > 300 and int(info.triangles) > 20000, "ground, shells, colliders and lanes are in (%s chunks, %s lanes)" % [info.colliderChunks, info.lanes])
	t.ok((info.errors as Array).is_empty() and int(info.queue.attach) == 0 and int(info.queue.reading) == 0, "no errors, the queues are empty")
	var node := city.get_node_or_null("ground_roads_8_-6") as MeshInstance3D
	t.ok(node != null and node.position.is_equal_approx(core.index.tiles[Vector2i(8, -6)].origin) and node.scale == Vector3.ONE, "a tile's mesh sits at its origin in world metres, unscaled")
	t.ok(city.get_node_or_null("buildings_8_-6") != null, "the building shells are their own node")
	# the colliders are where the lanes are: a ray down on a lane at grade lands on the road within 5 cm
	await tree.physics_frame
	await tree.physics_frame
	var sp: Dictionary = city.lanes.spawn(Vector2i(8, -6))
	t.ok(not sp.is_empty() and sp.pos.y > 150.0 and sp.pos.y < 300.0, "a spawn lane at the Delhi ground height")
	var mid: Vector3 = (city.lanes.piece(str(sp.lane)).pts as PackedVector3Array)[1]
	var hit: Dictionary = city.ground_at(mid.x, mid.z)
	t.ok(hit.hit and absf(float(hit.y) - mid.y) < 0.05, "a ray down hits a collider at the lane's height (%.3f against %.3f)" % [float(hit.y), mid.y])
	# move to Connaught Place: the ITO tiles are past the hysteresis ring and are disposed, the CP tiles load
	core.warp(CP)
	_until_ready(core)
	t.ok(core.live_ids() == ["-3_-6", "-3_-7", "-3_-8", "-4_-7", "-4_-8"], "the ring at Connaught Place is its five tiles (%s)" % [core.live_ids()])
	t.ok(city.get_node_or_null("ground_roads_8_-6") == null and core.tiles.size() == 5 and int(core.totals.gone) == 4, "the ITO tiles are gone, nodes and all")
	await tree.physics_frame
	t.ok(not city.ground_at(mid.x, mid.z).hit, "and so are their colliders")
	# everything out: only the core is left under the city, no chunk, no lane, and the engine's objects are back
	core.unload_all()
	t.ok(city.get_child_count() == 1 and int(city.colliders.chunks) == 0 and (city.lanes.pieces as Dictionary).is_empty() and int(city.ground_roads.live) == 0 and int(city.buildings.live) == 0, "dispose frees every node, body and lane")
	var objects1 := Performance.get_monitor(Performance.OBJECT_COUNT)
	t.ok(absf(objects1 - objects0) <= 0.02 * objects0, "the engine object count is back within 2 percent (%d before, %d after)" % [int(objects0), int(objects1)])
	city.free()


func test_the_core_keeps_the_cap_while_playing() -> void:
	var city := _city()
	if city == null:
		t.ok(false, "the test block opens")
		return
	var core: Node = city.core
	core.set_focus(ITO)
	var worst_chunks := 0
	var mixed := 0
	var chunk_frames := 0
	for i in 400:
		core.step()
		var q: Dictionary = core.queue.frame
		var chunks := int(q.attach.get("collider", 0))
		worst_chunks = maxi(worst_chunks, chunks)
		chunk_frames += 1 if chunks > 0 else 0
		mixed += 1 if q.mixed or (chunks > 0 and int(q.attach.get("mesh", 0)) > 0) else 0
		if core.ring_ready() and core.queue.pending() == 0:
			break
	t.ok(core.ring_ready() and not core.burst, "the ring loads without a burst")
	t.ok(worst_chunks <= 3 and worst_chunks >= 1 and chunk_frames >= int(city.colliders.chunks) / 3, "never more than 3 collider chunks in a frame (%d chunks in %d frames, worst %d)" % [int(city.colliders.chunks), chunk_frames, worst_chunks])
	t.ok(mixed == 0, "no frame attaches a mesh and a collider chunk")
	# the memory cap: with room for 2 tiles only the two best load, and nothing is loaded and dropped in a loop
	core.unload_all()
	core.plan.cap_tiles = 2
	core.set_focus(ITO + Vector3(-60.0, 0.0, -60.0))
	for i in 600:
		core.step()
	t.ok(core.tiles.size() == 2 and core.live_ids().size() == 2, "the cap holds: 2 tiles loaded (%s)" % [core.live_ids()])
	t.ok(core.live_ids().has("8_-6") and int(core.totals.gone) == 0, "the tile under the focus is one of them, and none was loaded to be dropped")
	t.ok(not core.ring_ready(), "a ring cut by the cap is not reported ready")
	core.unload_all()
	city.free()


func test_a_bad_tile_is_reported_and_skipped() -> void:
	# a copy of the four ITO tiles: one with a wrong version, one with a vertex 5 km outside its tile
	DirAccess.make_dir_recursive_absolute(TMP)
	var src: RefCounted = TileIndex.open(TEST_TILES)
	var recs := []
	for rec: Dictionary in src.raw.tiles:
		if not str(rec.id) in ["8_-6", "9_-6", "8_-5", "9_-5"]:
			continue
		recs.append(rec)
		var bytes := FileAccess.get_file_as_bytes(TEST_TILES + str(rec.file))
		if str(rec.id) == "9_-6":
			bytes.encode_u32(4, 2)
		elif str(rec.id) == "8_-5":
			var head: Dictionary = JSON.parse_string(bytes.slice(12, 12 + bytes.decode_u32(8)).get_string_from_ascii())
			bytes.encode_float(12 + bytes.decode_u32(8) + int(head.meshes[0].pos), 5000.0)
		var f := FileAccess.open(TMP + str(rec.file), FileAccess.WRITE)
		f.store_buffer(bytes)
		f.close()
	var index := (src.raw as Dictionary).duplicate()
	index["tiles"] = recs
	var fi := FileAccess.open(TMP + "index.json", FileAccess.WRITE)
	fi.store_string(JSON.stringify(index))
	fi.close()
	var wrong: Dictionary = TileReader.read(TMP + "9_-6.ktl")
	t.ok(not wrong.ok and str(wrong.error).contains("version 2 is not supported"), "a wrong version fails loudly (%s)" % str(wrong.get("error", "")))
	t.ok(not TileReader.parse("KTL1".to_ascii_buffer()).ok and not TileReader.parse(PackedByteArray()).ok and not TileReader.read(TMP + "none.ktl").ok, "a short, empty or missing file is refused")
	var cut := FileAccess.get_file_as_bytes(TEST_TILES + "8_-6.ktl")
	t.ok(not TileReader.parse(cut.slice(0, cut.size() / 2)).ok, "a file cut in half is refused before any array is read")
	var city := _city(TMP)
	t.ok(city != null, "the copied block opens")
	if city == null:
		return
	var core: Node = city.core
	var seen: Array[String] = []
	core.tile_bad.connect(func(key: Vector2i, _error: String) -> void: seen.append(WorldFrame.tile_id(key)))
	core.warp(ITO)
	_until_ready(core)
	t.ok(core.errors.size() == 2 and core.bad.has(Vector2i(9, -6)) and core.bad.has(Vector2i(8, -5)), "both bad tiles are reported (%s)" % [core.errors])
	seen.sort()
	t.ok(seen == ["8_-5", "9_-6"], "each one is signalled once")
	var all := " ".join(core.errors)
	t.ok(all.contains("version 2") and all.contains("outside the tile plus its 250 m margin"), "with the reason: the version, the margin")
	t.ok(core.live_ids() == ["8_-6", "9_-5"], "the tiles around them still load (%s)" % [core.live_ids()])
	t.ok(core.ring_ready() and int(city.colliders.chunks) > 10, "the ring is ready with what loaded: the world is never emptied")
	for i in 50:
		core.set_focus(ITO + Vector3(float(i), 0.0, 0.0))
		core.step()
	t.ok(core.errors.size() == 2 and int(core.totals.read) == 4, "a bad tile is not read again")
	core.unload_all()
	city.free()
	for f in DirAccess.get_files_at(TMP):
		DirAccess.remove_absolute(TMP + f)
	DirAccess.remove_absolute(TMP)


## Regression (P1-019): the game aborted while quitting ("pointer being freed was not allocated"). The core unloads
## its tiles when it leaves the tree; the mesh systems freed their nodes while the parent was removing its children,
## so the engine deleted each node twice. Leaving the tree in every way, with tiles loaded and mid load, must raise
## no engine error (the test run fails on any ERROR line) and leave nothing behind.
func test_leaving_the_scene_with_tiles_loaded() -> void:
	# 1. the city is taken out of the tree, then freed
	var city := _city()
	if city == null:
		t.ok(false, "the test block opens")
		return
	city.core.warp(ITO)
	_until_ready(city.core)
	t.ok(city.core.live_ids().size() == 4, "four tiles are loaded before the scene goes")
	tree.root.remove_child(city)
	t.ok(int(city.colliders.chunks) == 0 and (city.lanes.pieces as Dictionary).is_empty() and city.core.tiles.is_empty(), "leaving the tree unloads every tile: no body, no lane")
	city.free()
	await tree.process_frame
	# 2. the city is freed while it is in the tree (a scene change, quitting)
	city = _city()
	city.core.warp(CP)
	_until_ready(city.core)
	var colliders: RefCounted = city.colliders
	city.free()
	await tree.process_frame
	t.ok(int(colliders.chunks) == 0, "freeing the scene with tiles loaded frees their bodies")
	# 3. many teleports in a row, most of them cut short while tiles are still attaching, then the scene goes mid load
	city = _city()
	var core: Node = city.core
	for i in 24:
		core.warp(ITO if i % 2 == 0 else CP)
		for k in (i * 7) % 5:
			core.step()
	t.ok(core.errors.is_empty(), "teleports in a row raise no tile error")
	core.warp(ITO)
	_until_ready(core)
	t.ok(core.live_ids() == ["8_-5", "8_-6", "9_-5", "9_-6"] and core.tiles.size() == 4, "and end on the ring of the last one (%s)" % [core.live_ids()])
	var chunks := int(city.colliders.chunks)
	core.warp(CP)
	core.step()
	core.step()
	colliders = city.colliders
	city.free()
	await tree.process_frame
	t.ok(chunks > 40 and int(colliders.chunks) == 0, "a scene freed in the middle of a load leaves no body behind")


func test_far_ring_hooks() -> void:
	var city := _city()
	if city == null:
		t.ok(false, "the test block opens")
		return
	var core: Node = city.core
	var shells := FakeSystem.new()
	var sky := FakeSystem.new()
	core.register_ring(RingPlan.RING_SHELLS, shells)
	core.register_ring(RingPlan.RING_SKYLINE, sky)
	core.warp(ITO)
	_until_ready(core)
	t.ok(shells.log.size() == 4 and "enter 1 8_-6" in shells.log, "the shell ring tells its system the cells inside 900 m (%s)" % [shells.log])
	t.ok(sky.log.size() == 2 and "enter 2 2_-2" in sky.log and "enter 2 -1_-2" in sky.log, "the skyline ring enters every 1 km cell of the map once (%s)" % [sky.log])
	core.warp(CP)
	_until_ready(core)
	t.ok("exit 1 8_-6" in shells.log and "enter 1 -3_-7" in shells.log and sky.log.size() == 2, "moving on, shell cells leave and enter; the skyline stays")
	core.unload_all()
	city.free()


func test_threaded_reads() -> void:
	# The headless renderer cannot make meshes on worker threads (stream_core.gd `threaded`), so this core has the
	# systems that make none: colliders and lanes. The reads and the prepare step run on WorkerThreadPool tasks.
	var holder := Node3D.new()
	tree.root.add_child(holder)
	var core: Node = StreamCore.new()
	core.setup(TileIndex.open(TEST_TILES))
	t.ok(not core.threaded, "a headless run reads on the main thread by default")
	core.threaded = true
	core.set_process(false)
	var colliders: RefCounted = Colliders.new(holder)
	var lanes: RefCounted = Lanes.new()
	core.register(colliders)
	core.register(lanes)
	holder.add_child(core)
	core.warp(CP)
	var frames := 0
	while frames < 600 and not (core.ring_ready() and core.queue.pending() == 0):
		core.step()
		frames += 1
		await tree.process_frame
	t.ok(core.ring_ready() and core.live_ids().size() == 5 and core.errors.is_empty(), "tiles read on WorkerThreadPool tasks attach the same (%d frames)" % frames)
	t.ok(float(core.totals.readMsMax) > 0.0 and float(core.totals.readMsMax) < 200.0, "a tile reads and prepares off the main thread (worst %.1f ms)" % float(core.totals.readMsMax))
	var chunks := int(colliders.chunks)
	t.ok(chunks > 40 and (lanes.pieces as Dictionary).size() > 300, "with its colliders and lanes (%d chunks)" % chunks)
	# a read that is cancelled before it finishes leaves nothing behind
	core.warp(ITO)
	core.step()
	core.warp(CP)
	for i in 120:
		core.step()
		await tree.process_frame
	t.ok(core.live_ids().size() == 5 and core.tiles.size() == 5 and int(colliders.chunks) == chunks, "a cancelled read is dropped (%d chunks)" % int(colliders.chunks))
	core.unload_all()
	t.ok(int(colliders.chunks) == 0 and (lanes.pieces as Dictionary).is_empty(), "and everything unloads")
	holder.free()
