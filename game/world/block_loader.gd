## Loads a whole folder of baked tiles at once (--tiles=<name>): the small committed test block (game/world/test_tiles/,
## --tiles=test, about 9 tiles of the ITO flyover and Connaught Place) or the full pilot set (game/world/tiles/, gitignored,
## --tiles=full). It is the verify harness's city until the streamer exists (docs/ARCHITECTURE.md "world/streaming/");
## the streamer replaces it and reads the same index.json and the same KTL1 tiles.
## Every tile becomes a node at its origin in world metres (no mirroring, no recentre: the tiles are written in the one
## world frame), with its drawn meshes under flat stand-in materials and its collider chunks as StaticBody3D. The lane
## pieces stay as data: the car starts on the longest one at grade (`spawn()`).
## A scene opts in through attach(): it hides the stand-in ground and road and moves the car onto the block.
extends Node3D

const TileT1 := preload("res://bench/tiles/tile_t1.gd")

## --tiles values -> tile folders. A value that starts with res:// is a folder as it is.
const FOLDERS := {
	"test": "res://world/test_tiles/",
	"full": "res://world/tiles/",
}
## Flat stand-in colours by the mesh name the bake gives (the style pass restyles them later).
const COLORS := {
	"ground": Color(0.62, 0.58, 0.46), "plot": Color(0.56, 0.52, 0.42), "road": Color(0.22, 0.22, 0.24), "gore": Color(0.5, 0.5, 0.48),
	"marking": Color(0.92, 0.92, 0.86), "joint": Color(0.3, 0.3, 0.32), "median": Color(0.45, 0.5, 0.38), "footpath": Color(0.66, 0.64, 0.6),
	"kerb": Color(0.55, 0.54, 0.52), "wall": Color(0.72, 0.66, 0.56), "pier": Color(0.6, 0.6, 0.58), "underside": Color(0.4, 0.4, 0.4),
	"building": Color(0.78, 0.7, 0.58),
}
## Stand-in nodes of the scaffold scene that the block replaces.
const STAND_INS := ["Ground", "Road", "NorthPost"]

var folder := ""
var bake_hash := ""
var tile_count := 0
var triangles := 0
var collider_triangles := 0
var load_ms := 0
var errors: Array[String] = []
## Lane pieces of every loaded tile with their points in world metres: {id, cls, layer, pts: PackedVector3Array}.
var lanes: Array[Dictionary] = []
var _materials := {}


## The tile folder of a --tiles value ("" for an unknown name).
static func folder_of(value: String) -> String:
	if value.begins_with("res://"):
		return value if value.ends_with("/") else value + "/"
	return FOLDERS.get(value, "")


## index.json of a folder: {ok, index} or {ok = false, error}.
static func read_index(dir: String) -> Dictionary:
	var f := dir + "index.json"
	if not FileAccess.file_exists(f):
		return {"ok": false, "error": "no %s (the full set is baked by `npm run bake -- pilot`, the test block is committed)" % f}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(f))
	if typeof(parsed) != TYPE_DICTIONARY or not (parsed as Dictionary).has("tiles"):
		return {"ok": false, "error": "%s is not a tile index" % f}
	return {"ok": true, "index": parsed}


## Reads every tile of the folder and adds it below this node. Returns true when all tiles loaded.
func load_folder(dir: String) -> bool:
	var t0 := Time.get_ticks_msec()
	folder = dir
	var res := read_index(dir)
	if not res.ok:
		errors.append(str(res.error))
		return false
	var index: Dictionary = res.index
	bake_hash = str(index.get("bakeHash", ""))
	for rec: Dictionary in index.tiles:
		var tile := TileT1.load_tile(dir + str(rec.file))
		if not tile.ok:
			errors.append(str(tile.error))
			continue
		var o: Array = tile.header.origin
		var origin := Vector3(float(o[0]), float(o[1]), float(o[2]))
		var root: Node3D = tile.root
		root.position = origin
		for child in root.get_children():
			if child is MeshInstance3D:
				(child as MeshInstance3D).material_override = _material(str(child.get_meta("material", child.name)))
		add_child(root)
		for body: StaticBody3D in tile.bodies:
			body.position = origin
			add_child(body)
		for piece: Dictionary in tile.lanes:
			var pts: PackedVector3Array = piece.pts
			for i in pts.size():
				pts[i] += origin
			lanes.append({"id": str(piece.id), "cls": str(piece.get("cls", "")), "layer": int(piece.get("layer", 0)), "pts": pts})
		tile_count += 1
		triangles += int(tile.triangles)
		collider_triangles += int(tile.collider_triangles)
	load_ms = Time.get_ticks_msec() - t0
	return errors.is_empty() and tile_count > 0


func _material(name: String) -> StandardMaterial3D:
	if not _materials.has(name):
		var m := StandardMaterial3D.new()
		m.albedo_color = COLORS.get(name, Color(0.7, 0.7, 0.7))
		m.roughness = 1.0
		_materials[name] = m
	return _materials[name]


## Where the car starts: the first point of the longest lane piece at grade (layer 0, at least 6 points), heading along
## it. {pos: Vector3, heading: float (compass radians, 0 north)}, or {} when the block has no such lane.
func spawn() -> Dictionary:
	var best := {}
	var best_len := 0.0
	for l in lanes:
		var pts: PackedVector3Array = l.pts
		if int(l.layer) != 0 or pts.size() < 6:
			continue
		var length := 0.0
		for i in range(1, pts.size()):
			length += pts[i - 1].distance_to(pts[i])
		if length > best_len or (is_equal_approx(length, best_len) and str(l.id) < str(best.get("id", ""))):
			best_len = length
			best = l
	if best.is_empty():
		return {}
	var pts: PackedVector3Array = best.pts
	var d := pts[mini(pts.size() - 1, 3)] - pts[0]
	return {"pos": pts[0], "heading": atan2(d.x, -d.z), "lane": str(best.id), "length_m": best_len}


## What the debug state reports under `world`.
func info() -> Dictionary:
	return {
		"folder": folder, "bakeHash": bake_hash, "tiles": tile_count, "triangles": triangles, "colliderTriangles": collider_triangles,
		"loadMs": load_ms, "lanes": lanes.size(), "errors": errors,
	}


## Puts the block into a scene that has the scaffold's World node and car: hides the stand-in ground, adds the tiles and
## stands the car on the spawn lane at its height. Returns the block node, or null when the folder did not load.
static func attach(scene: Node, dir: String) -> Node3D:
	var world := scene.get_node_or_null("World") as Node3D
	if world == null:
		print("tiles: scene %s has no World node, no block loaded" % scene.name)
		return null
	var block: Node3D = load("res://world/block_loader.gd").new()
	block.name = "TileBlock"
	block.add_to_group("tile_block")
	var ok: bool = block.load_folder(dir)
	for e in block.errors:
		push_warning("tiles: %s" % e)
	print("tiles: %s %d tiles, %d triangles, %d collider triangles, hash %s, %d ms%s" % [dir, block.tile_count, block.triangles, block.collider_triangles, block.bake_hash, block.load_ms, "" if ok else " (FAILED)"])
	if not ok:
		block.free()
		return null
	for n in STAND_INS:
		var stand_in := world.get_node_or_null(n) as Node3D
		if stand_in != null:
			stand_in.visible = false
	world.add_child(block)
	var car := world.get_node_or_null("Car")
	var sp: Dictionary = block.spawn()
	if car != null and not sp.is_empty() and car.has_method("place"):
		car.ground_y = sp.pos.y
		car.place(sp.pos.x, sp.pos.z, sp.heading)
	return block
