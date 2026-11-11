## Module size rule (TECH.md "Source layout", docs/ARCHITECTURE.md "Target module map"): a GDScript file over 600
## lines fails. The old game's 4,065 line tile manager owned streaming, building, physics and cleanup at once; small
## files keep each system to one job. The TypeScript side is tools/module_size.test.ts (800 lines).
##
## Phase 0 bench and prototype files that are already over the limit sit on EXCEPTIONS, each with the backlog task
## that splits or retires it. An entry that is back under the limit, or whose file is gone, fails too: take it off.
extends RefCounted

const LIMIT := 600
const EXCEPTIONS := {
	"res://render/styles/stylised_b.gd": ["P2-001", "the signed look in one file; split when the old style switches fold into stylised B"],
	"res://scenes/standin/builder.gd": ["P2-001", "the stand-in scene layout of the look tests; split into one file per scene with the look test rework"],
	"res://bench/render/world.gd": ["P2-014", "render bench city (P0-016); retired when its MultiMesh cells and LOD move to the streamed city look"],
}

var t
var tree: SceneTree


static func line_count(text: String) -> int:
	if text.is_empty():
		return 0
	var n := text.count("\n")
	return n if text.ends_with("\n") else n + 1


func test_line_count() -> void:
	t.ok(line_count("") == 0 and line_count("a") == 1 and line_count("a\n") == 1 and line_count("a\nb") == 2 and line_count("a\n\nb\n") == 3,
		"lines are counted like wc -l, plus a last line without a newline")


func test_no_gdscript_file_over_600_lines() -> void:
	var files: Array[String] = []
	_gd_files("res://", files)
	t.ok(files.size() > 20, "the scan sees the game's scripts (%d files)" % files.size())
	for f in files:
		var n := line_count(FileAccess.get_file_as_string(f))
		if n > LIMIT:
			t.ok(EXCEPTIONS.has(f), "%s has %d lines, over the %d line limit: split it (one job per file)" % [f, n, LIMIT])
	for f in EXCEPTIONS:
		var e: Array = EXCEPTIONS[f]
		t.ok(FileAccess.file_exists(f), "exception %s: the file is gone, take it off the list" % f)
		if FileAccess.file_exists(f):
			t.ok(line_count(FileAccess.get_file_as_string(f)) > LIMIT, "exception %s is back under %d lines: take it off the list" % [f, LIMIT])
		t.ok(e.size() == 2 and RegEx.create_from_string("^P\\d+-\\d{3}$").search(str(e[0])) != null and str(e[1]).length() > 10,
			"exception %s names the task that splits or retires it (%s)" % [f, e])


func _gd_files(dir: String, out: Array[String]) -> void:
	var d := DirAccess.open(dir)
	if d == null:
		return
	for f in d.get_files():
		if f.ends_with(".gd"):
			out.append(dir.path_join(f))
	for sub in d.get_directories():
		if sub.begins_with("."):
			continue
		_gd_files(dir.path_join(sub), out)
