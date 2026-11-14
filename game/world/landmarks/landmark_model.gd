## A delivered hero model replaces the parts kit stand-in by id (P2-007; TECH.md "Assets"). The owner's file goes
## through harness/bin/ingest.mjs, whose hero rule (HM2: up to 8 parts of up to 25,000 triangles, up to 6 materials,
## 3 levels per part, one far silhouette under 2,000 triangles) has already checked it, into
## public/assets/models/model_lm_<id>.glb with an entry models["model_lm_<id>"] in public/assets/manifest.json.
## The model's frame: origin at the landmark's foot, 1 unit = 1 m, its front facing -Z (the game turns it to the
## registry bearing). Mesh nodes are named <part>_LOD0, <part>_LOD1, <part>_LOD2 and one far silhouette `far`; each
## gets the visibility range of its level, like the stand-in's.
extends RefCounted

const MANIFEST := "public/assets/manifest.json"


## The repo root (the Godot project is game/).
static func repo_root() -> String:
	return ProjectSettings.globalize_path("res://").trim_suffix("/").get_base_dir()


## The model file of a landmark id, or "" when the manifest has none (or the file is missing). `root` is the folder
## that holds public/ (the repo root when empty; tests pass their own).
static func find(id: String, root := "") -> String:
	var base := repo_root() if root == "" else root
	var path := base.path_join(MANIFEST)
	if not FileAccess.file_exists(path):
		return ""
	var j: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not (j is Dictionary) or not (j.get("models") is Dictionary):
		return ""
	var entry: Variant = j.models.get("model_lm_%s" % id)
	if not (entry is Dictionary) or not (entry.get("path") is String):
		return ""
	var file := base.path_join("public").path_join(str(entry.path))
	return file if FileAccess.file_exists(file) else ""


## The level a mesh node stands for from its name: 0 to 2, 3 for the far silhouette, -1 for anything else.
static func level_of_name(n: String) -> int:
	var s := n.to_lower()
	if s == "far" or s.ends_with("_far"):
		return 3
	for k in 3:
		if s.ends_with("_lod%d" % k):
			return k
	return -1


## Loads the model and sets the visibility range of every level node. Null when the file does not load.
static func load_model(file: String, ranges: Array, fade: float) -> Node3D:
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	if doc.append_from_file(file, state) != OK:
		return null
	var scene := doc.generate_scene(state) as Node3D
	if scene == null:
		return null
	for mi: Node in scene.find_children("*", "GeometryInstance3D", true, false):
		var lv := level_of_name(String(mi.name))
		if lv < 0:
			continue
		var rg: Array = ranges[mini(lv, ranges.size() - 1)]
		var g := mi as GeometryInstance3D
		g.visibility_range_begin = float(rg[0])
		g.visibility_range_begin_margin = float(rg[0]) * fade
		g.visibility_range_end = float(rg[1])
		g.visibility_range_end_margin = float(rg[1]) * fade
		g.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF
	return scene


## The mesh nodes per level (0 to 3).
static func levels_of(node: Node) -> Array:
	var out := [[], [], [], []]
	for mi: Node in node.find_children("*", "GeometryInstance3D", true, false):
		var lv := level_of_name(String(mi.name))
		if lv >= 0:
			out[lv].append(mi)
	return out


## The top of the model's level 0 above its origin (m).
static func height_of(node: Node3D) -> float:
	var top := 0.0
	for mi: Node in node.find_children("*", "MeshInstance3D", true, false):
		if level_of_name(String(mi.name)) != 0:
			continue
		var m := mi as MeshInstance3D
		var box := m.get_aabb()
		top = maxf(top, (m.transform * box).end.y)
	return top
