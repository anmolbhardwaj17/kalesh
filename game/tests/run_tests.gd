## Headless GDScript test runner (no addon). Run by `node harness/bin/godot.mjs test`, which `npm test` calls:
##   godot --headless --path game -s res://tests/run_tests.gd
## Each suite is a script in SUITES that extends RefCounted, has `var t` (the assert helper, tests/check.gd) and
## `var tree` (this SceneTree), and methods named test_* (a test may await engine frames). Prints PASS or FAIL per test and exits 1 on any failure.
extends SceneTree

const Check := preload("res://tests/check.gd")
const SUITES := [
	"res://tests/test_projection.gd",
	"res://tests/test_vehicle.gd",
	"res://tests/test_on_foot.gd",
	"res://tests/test_humanoid.gd",
	"res://tests/test_locomotion.gd",
	"res://tests/test_scene.gd",
	"res://tests/test_debug.gd",
	"res://tests/test_standin.gd",
	"res://tests/test_style.gd",
	"res://tests/test_bench.gd",
	"res://tests/test_physics_bench.gd",
	"res://tests/test_tiles.gd",
	"res://tests/test_streaming.gd",
	"res://tests/test_landmarks.gd",
	"res://tests/test_landmark_kit.gd",
	"res://tests/test_infra_kit.gd",
	"res://tests/test_area_kits.gd",
	"res://tests/test_module_size.gd",
	"res://tests/test_sim_clock.gd",
	"res://tests/test_data_packs.gd",
	"res://tests/test_fps_counter.gd",
]


var _ran := false


# Tests run on the first frame, not in _initialize: the root viewport is only inside the tree once the loop starts.
func _process(_delta: float) -> bool:
	if not _ran:
		_ran = true
		_run_all()
	return false


func _run_all() -> void:
	# The GameArgs autoload starts the default look (stylised B) at boot; test nodes keep their stand-in materials.
	var gargs := root.get_node_or_null("GameArgs")
	if gargs != null:
		gargs.stop_style_runner()
	var passed := 0
	var failed := 0
	for path in SUITES:
		var script: GDScript = load(path)
		if script == null or not script.can_instantiate():
			failed += 1
			print("FAIL ", path, " does not load (see the SCRIPT ERROR lines above)")
			continue
		var suite: RefCounted = script.new()
		for m in suite.get_method_list():
			var name: String = m.name
			if not name.begins_with("test_"):
				continue
			var t := Check.new()
			suite.set("t", t)
			suite.set("tree", self)
			# a test may be a coroutine (it waits for engine frames); await returns at once for a plain one
			await suite.call(name)
			var label := "%s %s" % [path.get_file().get_basename(), name]
			if t.failures.is_empty():
				passed += 1
				print("PASS ", label, " (", t.checks, " checks)")
			else:
				failed += 1
				print("FAIL ", label)
				for f in t.failures:
					print("    ", f)
	print("godot tests: %d passed, %d failed" % [passed, failed])
	quit(1 if failed > 0 or passed == 0 else 0)
