## GDScript parse check (P0-026): loads every .gd file under res:// (not res://.godot) and fails when one does not
## parse or compile. Run by `node harness/bin/godot.mjs parse`, which `npm run typecheck` calls:
##   godot --headless --path game -s res://tests/parse_all.gd
## A script that only loads with --debug (game/debug/) is checked here too, so a broken debug script shows without a
## debug run. Prints one line per failing file and a summary, exits 1 on any failure.
extends SceneTree

var _ran := false


func _process(_delta: float) -> bool:
	if not _ran:
		_ran = true
		_check()
	return false


func _check() -> void:
	var files: Array[String] = []
	_collect("res://", files)
	var bad := 0
	for path in files:
		var script = ResourceLoader.load(path, "GDScript", ResourceLoader.CACHE_MODE_REUSE)
		if script == null or not (script is GDScript) or not script.can_instantiate():
			bad += 1
			print("PARSE FAIL ", path)
	print("parse: %d of %d scripts load" % [files.size() - bad, files.size()])
	quit(1 if bad > 0 else 0)


func _collect(dir_path: String, out: Array[String]) -> void:
	var dir := DirAccess.open(dir_path)
	if dir == null:
		return
	for d in dir.get_directories():
		if d.begins_with("."):
			continue
		_collect(dir_path.path_join(d), out)
	for f in dir.get_files():
		if f.ends_with(".gd"):
			out.append(dir_path.path_join(f))
