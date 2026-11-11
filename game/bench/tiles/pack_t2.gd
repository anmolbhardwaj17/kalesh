## Headless pack step of tile option T2 (ARCH_OPTIONS): turns T1 tiles into Godot resources (.res) that the game
## loads with ResourceLoader threaded loads. Run by harness/bench/pilot_data/tiles.mjs:
##   godot --headless --path game -s res://bench/tiles/pack_t2.gd -- <in.ktl> <out.res> [<in> <out> ...]
## Each .res is a PackedScene: MeshInstance3D nodes with their ArrayMesh, one StaticBody3D per collider chunk with a
## ConcavePolygonShape3D, MultiMeshInstance3D nodes for placements. Prints one "pack: <out> <ms> ms <bytes> bytes"
## line per tile.
extends SceneTree

const TileT1 := preload("res://bench/tiles/tile_t1.gd")

var _done := false


func _process(_delta: float) -> bool:
	if _done:
		return true
	_done = true
	var args := OS.get_cmdline_user_args()
	var failed := false
	for i in range(0, args.size() - 1, 2):
		var t0 := Time.get_ticks_usec()
		var tile := TileT1.load_tile(args[i])
		if not tile.ok:
			print("pack: FAILED %s" % tile.error)
			failed = true
			continue
		var tile_root: Node3D = tile.root
		for body: StaticBody3D in tile.bodies:
			tile_root.add_child(body)
		for n in tile_root.find_children("*", "", true, false):
			n.owner = tile_root
		var scene := PackedScene.new()
		var err := scene.pack(tile_root)
		if err == OK:
			err = ResourceSaver.save(scene, args[i + 1])
		tile_root.free()
		if err != OK:
			print("pack: FAILED %s (error %d)" % [args[i + 1], err])
			failed = true
			continue
		var size := FileAccess.get_file_as_bytes(args[i + 1]).size()
		print("pack: %s %.2f ms %d bytes" % [args[i + 1], (Time.get_ticks_usec() - t0) / 1000.0, size])
	quit(1 if failed else 0)
	return true
