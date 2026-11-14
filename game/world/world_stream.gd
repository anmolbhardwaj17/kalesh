## The streamed city of a scene: one tile folder (--tiles=test, the committed test block; --tiles=full, the baked
## pilot; or a res:// folder), the streaming core and the streamed systems of this stage (ground and roads, building
## shells, colliders, lanes). It only puts the pieces together and starts the game on them:
## - `attach(scene, dir)` adds it to a scene that has the scaffold's World node and car, and hides the stand-in ground;
## - the first ring loads in a burst around the spawn pin (game/data/spawn_pins.json, the game arg --spawn, P1-024) and
##   the vehicle stands on the nearest lane there; when the pin's tile is not in the folder (the 9-tile test block) the
##   ring loads round the tile nearest to India Gate (the pivot of the map) and the car stands on the longest lane of
##   that tile. GameArgs.world_ready turns true (the debug `ready`) once the ring around the car is attached with its
##   colliders;
## - the streaming focus follows whichever node the player controls (the group "player": the vehicle or the
##   character on foot, game/characters/player_mode.gd);
## - `teleport()` moves the player and returns when the ring there is attached and the player stands on the ground.
## Loading, timing and building live in game/world/streaming/ and game/world/systems/, one job per file.
extends Node3D

const TileIndex := preload("res://world/streaming/tile_index.gd")
const StreamCore := preload("res://world/streaming/stream_core.gd")
const WorldFrame := preload("res://geo/world_frame.gd")
const TileMesh := preload("res://world/systems/tile_mesh.gd")
const GroundRoads := preload("res://world/systems/ground_roads.gd")
const Buildings := preload("res://world/systems/buildings.gd")
const Colliders := preload("res://world/systems/colliders.gd")
const Lanes := preload("res://world/systems/lanes.gd")
const SpawnPins := preload("res://world/spawn_pins.gd")
const LandmarkSlots := preload("res://world/landmark_slots.gd")
const Landmarks := preload("res://world/systems/landmarks.gd")
const Infra := preload("res://world/systems/infra.gd")
const AccessWatch := preload("res://world/access_watch.gd")
const Traffic := preload("res://ai/traffic.gd")
const Gps := preload("res://ui/gps.gd")
## The kit landmarks within this distance of the start are built before the game says ready (no hero pops in).
const LANDMARK_READY_M := 1800.0
const TileReader := preload("res://world/streaming/tile_reader.gd")
## Stand-in nodes of the scaffold scene that the tiles replace.
const STAND_INS := ["Ground", "Road", "NorthPost", "GroundCollider"]
## A ring that is not attached after this much wall time is reported and the game goes on.
const RING_WAIT_S := 30.0
## A ground ray starts this far above the highest thing a tile can hold and ends this far below its lowest ground.
const RAY_UP := 400.0
const RAY_DOWN := 100.0
## A spawn pin stands the vehicle on a lane at most this far from the pin.
const SPAWN_REACH := 60.0

var index: RefCounted = null
var frame: RefCounted = null
var core: Node = null
var lanes: RefCounted = null
var colliders: RefCounted = null
var ground_roads: RefCounted = null
## The infrastructure kits (game/world/systems/infra.gd, P2-034); null when the folder has no infra.json.
var infra: RefCounted = null
var buildings: RefCounted = null
## The parts kit landmarks and the far silhouettes (game/world/systems/landmarks.gd, P2-007).
var landmarks: Node3D = null
## Road access for the player's vehicle (game/world/access_watch.gd, P2-045): the access_violation events.
var access: Node = null
## The traffic stand-in (game/ai/traffic.gd, P2-045), off until the debug hook traffic('start').
var traffic: Node3D = null
## The route line (game/ui/gps.gd, P2-045), drawn while a target is set.
var gps: Node3D = null
var booted := false
var load_ms := 0
## The start: {pin, name, lane, pos: [x, y, z], heading, offM} (pin "" when the old start near India Gate was used).
var spawn := {}
var _t0 := 0
## Counts teleports: one that is overtaken by a later one while it waits for its ring gives up.
var _teleports := 0


## Opens the folder and builds the core with its systems. False (with the reason printed) when the index is missing.
func setup(dir: String, build_landmarks := true) -> bool:
	_t0 = Time.get_ticks_msec()
	index = TileIndex.open(dir)
	if index.error != "":
		print("tiles: %s" % index.error)
		return false
	frame = WorldFrame.from_index(index.raw)
	core = StreamCore.new()
	core.name = "Stream"
	core.setup(index)
	var stand_ins := TileMesh.stand_ins()
	ground_roads = GroundRoads.new(self, stand_ins)
	buildings = Buildings.new(self, stand_ins)
	colliders = Colliders.new(self)
	lanes = Lanes.new()
	var systems: Array = [ground_roads, buildings, colliders, lanes]
	# the infrastructure kits (P2-034): drawn from infra.json, the tiles' plain shapes stay colliders only
	if not index.infra.is_empty():
		infra = Infra.new(self, index.infra)
		ground_roads.skip.append_array(GroundRoads.KIT_ENVELOPES)
		systems.append(infra)
	for sys: Object in systems:
		core.register(sys)
	# The core is this node's first child, before any tile node: children leave the tree last child first, so when
	# the scene goes the tile nodes have left before the core unloads (tile_mesh.gd dispose relies on it).
	add_child(core)
	landmarks = Landmarks.new()
	landmarks.setup(index, build_landmarks)
	add_child(landmarks)
	if infra != null and build_landmarks:
		Infra.skyline(self, index.infra_skyline, landmarks.haze)
	# P2-045: the systems that read the lane graph and its access modes
	access = AccessWatch.new()
	access.name = "Access"
	access.setup(lanes, dir)
	add_child(access)
	traffic = Traffic.new()
	traffic.name = "Traffic"
	traffic.setup(lanes)
	add_child(traffic)
	gps = Gps.new()
	gps.name = "Gps"
	gps.setup(lanes)
	add_child(gps)
	return true


## Puts the streamed city into a scene that has the scaffold's World node and car. Returns the node, or null when
## the folder has no index (the stand-in ground stays).
static func attach(scene: Node, dir: String) -> Node3D:
	var world := scene.get_node_or_null("World") as Node3D
	if world == null:
		print("tiles: scene %s has no World node, no tiles loaded" % scene.name)
		return null
	var city: Node3D = load("res://world/world_stream.gd").new()
	city.name = "City"
	city.add_to_group("world_stream")
	if not city.setup(dir):
		city.free()
		return null
	for n: String in STAND_INS:
		var stand_in := world.get_node_or_null(n) as Node3D
		if stand_in != null:
			stand_in.visible = false
			if stand_in is CollisionObject3D:
				# the stand-in ground's collider leaves the physics space: the tiles bring their own
				stand_in.process_mode = Node.PROCESS_MODE_DISABLED
	world.add_child(city)
	city.boot(world.get_node_or_null("Car") as Node3D)
	return city


## The first load: the ring round the spawn pin (or the start tile near India Gate), the car on a lane there, then
## the ring round the car.
func boot(car: Node3D) -> void:
	var args := get_node_or_null("/root/GameArgs")
	var sp := await _spawn_on_pin(SpawnPins.pick(str(args.spawn) if args != null and "spawn" in args else ""))
	if sp.is_empty():
		var pivot: Dictionary = frame.block_to_world("centre", 0.0, 0.0)
		var start: Vector2i = index.nearest(pivot.x, pivot.z)
		var corner: Vector3 = index.tiles[start].origin
		core.warp(corner + Vector3(index.size * 0.5, 0.0, index.size * 0.5))
		await _ring()
		sp = lanes.spawn(start)
		if sp.is_empty():
			sp = lanes.spawn()
		if not sp.is_empty():
			sp["pin"] = ""
	if car != null and not sp.is_empty() and car.has_method("place"):
		car.ground_y = sp.pos.y
		car.place(sp.pos.x, sp.pos.z, sp.heading)
		core.warp(car.global_position)
		await _ring()
		# the play camera jumps behind the vehicle at its start instead of lerping in from where the scene put it
		var cam := get_viewport().get_camera_3d()
		if cam != null and cam.has_method("snap"):
			cam.snap()
	if not sp.is_empty():
		spawn = {"pin": sp.pin, "name": sp.get("name", ""), "lane": sp.lane, "pos": [sp.pos.x, sp.pos.y, sp.pos.z], "heading": sp.heading, "offM": sp.get("off_m", 0.0)}
	core.target = car
	if car != null:
		await landmarks.settle(car.global_position, LANDMARK_READY_M)
	booted = true
	load_ms = Time.get_ticks_msec() - _t0
	if args != null:
		args.world_ready = true
	print("tiles: %s streaming, %d of %d tiles in the first ring, hash %s, %d ms%s, start %s" % [
		index.folder, core.live_ids().size(), index.count(), index.bake_hash, load_ms, "" if core.errors.is_empty() else " (%d refused)" % core.errors.size(),
		spawn.get("pin", "") if spawn.get("pin", "") != "" else "near India Gate"])


## Loads the ring round a spawn pin and finds its lane: the snap of lanes.gd plus {pin, name}, or {} when the pin is
## empty, its tile is not in the folder or no lane is near it.
func _spawn_on_pin(pin: Dictionary) -> Dictionary:
	if pin.is_empty():
		return {}
	var at: Dictionary = frame.geo_to_world(pin.lat, pin.lon)
	var key: Vector2i = WorldFrame.tile_of(at.x, at.z)
	if not index.has(key):
		print("tiles: spawn pin %s lies in tile %s, which %s does not hold" % [pin.id, WorldFrame.tile_id(key), index.folder])
		return {}
	core.warp(Vector3(at.x, index.tiles[key].origin.y, at.z))
	await _ring()
	var sp: Dictionary = lanes.snap(at.x, at.z, pin.heading, SPAWN_REACH)
	if sp.is_empty():
		print("tiles: no lane within %d m of spawn pin %s" % [int(SPAWN_REACH), pin.id])
		return {}
	sp["pin"] = pin.id
	sp["name"] = pin.name
	return sp


## The streaming focus follows the node the player controls (the vehicle or the character on foot).
func _process(_delta: float) -> void:
	if not booted:
		return
	var p := get_tree().get_first_node_in_group("player") as Node3D
	if p != null and p != core.target:
		core.target = p


## Pins of the tiles that are live now: [{id, name, kind, x, y, z, tile}] in world metres. A landmark pin (kind
## `landmark`, id `lm:<registry id>`) also has tier, mode, yaw (the compass bearing its front faces) and height.
func live_pins() -> Array:
	var out := []
	for key: Vector2i in core.tiles:
		if not core.is_live(key):
			continue
		var e: Dictionary = core.tiles[key]
		var view: Dictionary = e.get("view", {})
		for p: Dictionary in view.get("pins", []):
			var w: Vector3 = (view.origin as Vector3) + (p.pos as Vector3)
			var pin := {"id": p.id, "name": p.name, "kind": p.kind, "x": w.x, "y": w.y, "z": w.z, "tile": WorldFrame.tile_id(key)}
			for k: String in TileReader.PIN_EXTRA:
				if p.has(k):
					pin[k] = p[k]
			out.append(pin)
	return out


## Staging (debug teleport, later a respawn): puts the player at x, z, loads the ring there in a burst and stands the
## player on the ground. `y` picks the level when it is above the ground there (a flyover deck against the road
## under it): the ground is the first surface under y + 3 m, or under the sky when y is 0 or under every surface.
## False when a later teleport overtook this one before its ring was attached.
func teleport(player: Node3D, to: Vector3) -> bool:
	_teleports += 1
	var mine := _teleports
	if player.has_method("place"):
		player.place(to.x, to.z)
	else:
		player.global_position = to
	core.warp(Vector3(to.x, player.global_position.y, to.z))
	await _ring()
	if mine != _teleports or not is_instance_valid(player):
		# a later teleport moved the player on while this one waited: that one finishes the job
		return false
	await landmarks.settle(to, LANDMARK_READY_M, 10.0)
	var hit := ground_at(to.x, to.z, to.y + 3.0 if to.y > 0.0 else NAN)
	if not hit.hit:
		hit = ground_at(to.x, to.z)
	if hit.hit and "ground_y" in player:
		player.ground_y = hit.y
		player.place(to.x, to.z)
	elif hit.hit:
		player.global_position = Vector3(to.x, hit.y, to.z)
	return true


## The collider surface under a point: a ray straight down from `from_y` (NAN: from above everything).
## {hit, y, tile}. `tiles_only` leaves the parts kit landmarks' colliders out (the tile files hold only the ground).
func ground_at(x: float, z: float, from_y := NAN, tiles_only := false) -> Dictionary:
	var key: Vector2i = WorldFrame.tile_of(x, z)
	var base: float = index.tiles[key].origin.y if index.has(key) else 0.0
	var top := base + RAY_UP if is_nan(from_y) else from_y
	# layer 1 only: the world's colliders, never a vehicle body (layer 2) standing there
	var query := PhysicsRayQueryParameters3D.create(Vector3(x, top, z), Vector3(x, base - RAY_DOWN, z), 1)
	if tiles_only:
		var skip: Array[RID] = []
		for b: Node in get_tree().get_nodes_in_group("landmark_kit"):
			skip.append((b as CollisionObject3D).get_rid())
		query.exclude = skip
	var res := get_world_3d().direct_space_state.intersect_ray(query)
	if res.is_empty():
		return {"hit": false, "y": 0.0, "tile": WorldFrame.tile_id(key)}
	return {"hit": true, "y": float(res.position.y), "tile": WorldFrame.tile_id(key)}


## Waits until the ring round the focus is attached (or RING_WAIT_S passed: reported, the game goes on).
func _ring() -> void:
	var t0 := Time.get_ticks_msec()
	while is_inside_tree() and not core.ring_ready():
		if Time.get_ticks_msec() - t0 > RING_WAIT_S * 1000.0:
			push_warning("tiles: the ring at %s was not attached after %d s (%s)" % [core.focus, int(RING_WAIT_S), core.info().queue])
			return
		await get_tree().process_frame


## What the debug state reports under `world`.
func info() -> Dictionary:
	var out: Dictionary = core.info()
	out["folder"] = index.folder
	out["bakeHash"] = index.bake_hash
	out["indexTiles"] = index.count()
	out["booted"] = booted
	out["loadMs"] = load_ms
	out["triangles"] = int(ground_roads.triangles) + int(buildings.triangles) + (int(infra.triangles) if infra != null else 0)
	out["infra"] = infra.info() if infra != null else {"tiles": 0, "triangles": 0, "nodes": 0}
	# the area kits (P2-010): live tiles, shell triangles, module instances and MultiMesh nodes
	out["buildings"] = buildings.info()
	out["colliderTriangles"] = int(colliders.triangles)
	out["colliderChunks"] = int(colliders.chunks)
	out["lanes"] = lanes.pieces.size()
	out["access"] = access.info() if access != null else null
	out["spawn"] = spawn
	out["landmarks"] = {"placed": index.landmarks.size(), "far": index.far_landmarks.size(), "fullDetailCap": LandmarkSlots.cap(index.landmark_limits)}
	out["landmarks"].merge(landmarks.info())
	return out
