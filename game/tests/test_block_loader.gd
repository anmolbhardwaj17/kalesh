## The test block loader (game/world/block_loader.gd, --tiles=test, P1-018): the arg parses, the committed test block
## loads in full on its own (no data/, no game/world/tiles/), every tile sits at its origin in world metres, and the
## car's spawn lies on a lane of the block.
extends RefCounted

const GameArgs := preload("res://core/game_args.gd")
const BlockLoader := preload("res://world/block_loader.gd")

var t
var tree: SceneTree


func test_the_tiles_arg_parses_and_names_a_folder() -> void:
	t.ok(GameArgs.parse(PackedStringArray()).tiles == "", "no --tiles by default")
	t.ok(GameArgs.parse(PackedStringArray(["--tiles=test"])).tiles == "test", "--tiles=test")
	t.ok(GameArgs.parse(PackedStringArray(["--tiles", "full"])).tiles == "full", "--tiles full")
	t.ok(GameArgs.parse(PackedStringArray(["--tiles"])).unknown == ["--tiles"], "--tiles with no value is unknown, never an error")
	t.ok(BlockLoader.folder_of("test") == "res://world/test_tiles/", "test is the committed block")
	t.ok(BlockLoader.folder_of("full") == "res://world/tiles/", "full is the pilot set")
	t.ok(BlockLoader.folder_of("res://x") == "res://x/", "a res:// folder is taken as it is")
	t.ok(BlockLoader.folder_of("nope") == "", "an unknown name has no folder")


func test_the_committed_test_block_loads_by_itself() -> void:
	var idx := BlockLoader.read_index(BlockLoader.folder_of("test"))
	t.ok(idx.ok, "the test block has an index.json")
	if not idx.ok:
		return
	var recs: Array = idx.index.tiles
	t.ok(recs.size() == 9, "the test block has 9 tiles (%d)" % recs.size())
	var total := 0
	for r: Dictionary in recs:
		total += int(r.bytes)
	t.ok(total < 12 * 1048576, "the block is under 12 MB (%d bytes)" % total)
	var block: Node3D = BlockLoader.new()
	var ok: bool = block.load_folder(BlockLoader.folder_of("test"))
	t.ok(ok and block.errors.is_empty(), "every tile loads (%s)" % ", ".join(block.errors))
	t.ok(block.tile_count == 9 and block.collider_triangles > 50000 and block.lanes.size() > 500, "9 tiles with colliders and lanes")
	t.ok(block.bake_hash == str(idx.index.bakeHash), "the block carries its index's bake hash")
	var first: Node3D = block.get_child(0)
	var rec: Dictionary = recs[0]
	var o: Array = rec.origin
	t.ok(first.position.distance_to(Vector3(o[0], o[1], o[2])) < 1e-3, "a tile sits at its origin in world metres")
	var sp: Dictionary = block.spawn()
	t.ok(not sp.is_empty() and sp.pos.y > 150.0 and sp.pos.y < 300.0, "the car's spawn is on a lane at the Delhi ground height")
	# the spawn is the start of a lane piece of the block, heading along it
	var on_lane := false
	for l in block.lanes:
		if str(l.id) == str(sp.get("lane", "")) and (l.pts as PackedVector3Array)[0].is_equal_approx(sp.pos):
			on_lane = true
	t.ok(on_lane, "the spawn is the first point of lane %s" % str(sp.get("lane", "")))
	block.free()


func test_a_missing_folder_is_an_error_value_not_a_crash() -> void:
	var block: Node3D = BlockLoader.new()
	t.ok(not block.load_folder("res://world/not_a_folder/") and block.errors.size() == 1, "a missing folder reports one error and loads nothing")
	t.ok(block.spawn().is_empty(), "no lanes, no spawn")
	block.free()
