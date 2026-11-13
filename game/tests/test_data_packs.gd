## Data packs of an exported build (game/core/data_packs.gd): which files count as stage packs, where they are looked for.
extends RefCounted

const DataPacks := preload("res://core/data_packs.gd")

var t
var tree: SceneTree


func test_pack_names_keeps_only_stage_packs_sorted() -> void:
	var got := DataPacks.pack_names(PackedStringArray(["Kalesh.pck", "stage_pilot.pck", "stage_b.pck", "stage_.pck", "stage_x.zip", "readme.txt"]))
	t.ok(got == PackedStringArray(["stage_b.pck", "stage_pilot.pck"]), "only stage_<name>.pck files, sorted (%s)" % [got])


func test_search_dirs_cover_the_exe_folder_and_the_mac_bundle_resources() -> void:
	var dirs := DataPacks.search_dirs("/x/Kalesh.app/Contents/MacOS/Kalesh")
	t.ok(dirs == PackedStringArray(["/x/Kalesh.app/Contents/MacOS", "/x/Kalesh.app/Contents/Resources"]), "exe folder and ../Resources (%s)" % [dirs])


func test_nothing_mounts_from_the_editor_or_a_project_run() -> void:
	t.ok(DataPacks.mount_all("/nonexistent/Godot").is_empty(), "no packs mounted without an exported build")
