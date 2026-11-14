## The landmark parts kit (P2-007, game/world/landmarks/): every recipe builds its four levels on synthetic inputs of
## the landmark file's shape, the built height is within 5 percent of the registry height, the hero rule holds (at
## most 8 parts, 25,000 triangles a part at level 0, the far silhouette under 2,000), every triangle is wound the way
## its normal faces (Godot front faces), level 0 has colliders, and a delivered model's node names map to levels.
extends RefCounted

const KitBuild := preload("res://world/landmarks/kit_build.gd")
const KitMesh := preload("res://world/landmarks/kit_mesh.gd")
const Parts := preload("res://world/landmarks/parts.gd")
const LandmarkModel := preload("res://world/landmarks/landmark_model.gd")

var t
var tree: SceneTree


static func _square_walls(half: float, h: float) -> Array:
	var pts := []
	var hs := []
	for c in [[-half, -half], [half, -half], [half, half], [-half, half], [-half, -half]]:
		pts.append([c[0], 0.0, c[1]])
		hs.append(h)
	return [{"pts": pts, "h": hs}]


static func cases() -> Array:
	return [
		{"id": "india_gate", "tier": "hero", "height": 42.0, "yaw": 272.3, "kit": {"recipe": "india_gate", "axis": {"deg": 2.3, "lengthM": 27.3, "widthM": 17.7, "c": [0, 0]}}},
		{"id": "canopy", "tier": "marker", "height": 22.3, "yaw": 270.0, "kit": {"recipe": "canopy", "axis": {"deg": 99.9, "lengthM": 12.0, "widthM": 11.1, "c": [0, 0]}}},
		{"id": "jama_masjid", "tier": "signature", "height": 41.0, "yaw": 86.3, "worship": true, "kit": {"recipe": "jama_masjid", "axis": {"deg": 86.3, "lengthM": 123.1, "widthM": 121.5, "c": [0, 0]}}},
		{"id": "red_fort", "tier": "hero", "height": 33.0, "yaw": 270.8, "kit": {"recipe": "red_fort", "walls": _square_walls(150.0, 33.0),
			"gates": [{"id": "g", "ring": [[-152, -10], [-146, -10], [-146, 10], [-152, 10]], "base": 0.0, "top": 0.0, "name": "Lahori Gate"}]}},
		{"id": "cp_circle", "tier": "hero", "height": 11.5, "yaw": 0.0, "kit": {"recipe": "cp_circle", "sectors": [
			{"r0": 140.0, "r1": 215.0, "a0": 10.0, "a1": 55.0, "base": 1.0, "band": "inner"},
			{"r0": 250.0, "r1": 300.0, "a0": 200.0, "a1": 240.0, "base": 2.0, "band": "outer"}]}},
	]


func test_every_recipe_builds_to_its_registry_height_within_the_hero_rule() -> void:
	for lm: Dictionary in cases():
		var r := KitBuild.build(lm)
		t.ok(r.levels.size() == 4, "%s: four levels" % lm.id)
		var err := absf(float(r.heightM) - float(lm.height)) / float(lm.height) * 100.0
		t.ok(err <= 5.0, "%s: built %.2f m against %.1f m in the registry (%.1f percent, %s)" % [lm.id, r.heightM, lm.height, err, r.heightPart])
		var l0: Dictionary = r.levels[0]
		t.ok((l0.parts as Dictionary).size() <= 8, "%s: %d parts, 8 at most" % [lm.id, (l0.parts as Dictionary).size()])
		for part: String in l0.partTriangles:
			t.ok(int(l0.partTriangles[part]) <= 25000, "%s part %s: %d triangles at level 0, 25,000 at most" % [lm.id, part, l0.partTriangles[part]])
		t.ok(int(r.levels[3].triangles) < 2000, "%s: far silhouette %d triangles, under 2,000" % [lm.id, r.levels[3].triangles])
		t.ok(int(r.levels[1].triangles) < int(l0.triangles) and int(r.levels[2].triangles) <= int(r.levels[1].triangles), "%s: each level has fewer triangles (%d, %d, %d, %d)" % [lm.id, l0.triangles, r.levels[1].triangles, r.levels[2].triangles, r.levels[3].triangles])
		t.ok((r.colliders as Array).size() > 0, "%s: level 0 has %d colliders" % [lm.id, (r.colliders as Array).size()])
		t.ok(_wound_right(l0.parts) >= 0.999, "%s: every triangle faces where its normal points (%.4f)" % [lm.id, _wound_right(l0.parts)])


## Share of triangles whose Godot front face (clockwise as written) agrees with the stored normal.
static func _wound_right(parts: Dictionary) -> float:
	var good := 0
	var all := 0
	for part: String in parts:
		for k: String in parts[part]:
			var a: Array = parts[part][k]
			var v: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
			var n: PackedVector3Array = a[Mesh.ARRAY_NORMAL]
			var idx: PackedInt32Array = a[Mesh.ARRAY_INDEX]
			for i in range(0, idx.size(), 3):
				var p0 := v[idx[i]]
				var p1 := v[idx[i + 1]]
				var p2 := v[idx[i + 2]]
				var geo := (p2 - p0).cross(p1 - p0)
				if geo.length_squared() < 1e-10:
					continue
				all += 1
				if geo.dot(n[idx[i]] + n[idx[i + 1]] + n[idx[i + 2]]) > 0.0:
					good += 1
	return float(good) / maxf(1.0, all)


func test_parts_keep_their_outline_and_wind_right() -> void:
	var m := KitMesh.new()
	m.box(Vector3(0, 1, 0), Vector3(2, 2, 2), Color.WHITE)
	Parts.onion_dome(m, Vector3(5, 0, 0), 3.0, 5.0, 0, Parts.MARBLE)
	Parts.chhatri(m, Vector3(-6, 0, 0), 2.0, 5.0, 0, Parts.RED, Parts.MARBLE)
	Parts.minaret(m, Vector3(0, 0, 10), 2.0, 30.0, 0, Parts.RED, Parts.MARBLE, Parts.MARBLE)
	Parts.shikhara(m, Vector3(10, 0, 10), 6.0, 18.0, 0, Parts.BUFF)
	m.prism(PackedVector2Array([Vector2(20, 0), Vector2(30, 0), Vector2(30, 8), Vector2(20, 8)]), 0.0, 6.0, Parts.PLASTER)
	m.extrude(Parts.wall_with_opening(8.0, 6.0, Parts.pointed_arch(3.0, 2.5, 1.6)), 1.0, Parts.RED)
	var parts := {"main": m.arrays_of("main")}
	t.ok(_wound_right(parts) >= 0.999, "boxes, domes, chhatris, minarets, shikharas, prisms and arched walls face out (%.4f)" % _wound_right(parts))
	t.ok(absf(m.top - 30.0) < 3.0, "the minaret reaches about its height (%.2f)" % m.top)
	var arch := Parts.pointed_arch(4.0, 3.0, 2.0)
	var apex := 0.0
	for p in arch:
		apex = maxf(apex, p.y)
	t.ok(absf(apex - 5.0) < 0.01 and arch[0] == Vector2(-2, 0) and arch[arch.size() - 1] == Vector2(2, 0), "a pointed arch springs at 3 m and peaks at 5 m (%.3f)" % apex)
	var tops := []
	for lod in 4:
		var a := KitMesh.new()
		Parts.onion_dome(a, Vector3.ZERO, 3.0, 5.0, lod, Parts.MARBLE)
		tops.append(a.top)
	t.ok(absf(tops[1] - tops[0]) < 0.3 and absf(tops[2] - tops[0]) < 0.6, "a dome keeps its outline height from level to level (%s)" % [tops])


func test_a_delivered_model_maps_node_names_to_levels() -> void:
	t.ok(LandmarkModel.level_of_name("arch_LOD0") == 0 and LandmarkModel.level_of_name("Attic_lod2") == 2, "<part>_LOD0 to _LOD2 are the levels")
	t.ok(LandmarkModel.level_of_name("far") == 3 and LandmarkModel.level_of_name("india_gate_far") == 3, "the far silhouette is level 3")
	t.ok(LandmarkModel.level_of_name("Camera") == -1, "other nodes have no level")
	t.ok(LandmarkModel.find("no_such_landmark") == "", "no manifest entry: the stand-in stays")


func test_the_kit_reads_the_landmark_file() -> void:
	t.ok(KitBuild.has_recipe({"kit": {"recipe": "india_gate"}}) and not KitBuild.has_recipe({"kit": null}) and not KitBuild.has_recipe({}), "a landmark has a recipe only when the file gives one")
	var r := KitBuild.build({"id": "x", "kit": {"recipe": "nope"}})
	t.ok(r.has("error") and (r.levels as Array).is_empty(), "an unknown recipe builds nothing")


func test_a_delivered_model_replaces_the_stand_in_by_id() -> void:
	# a model written the way the hero rule wants it: <part>_LOD0 to _LOD2 and a far silhouette
	var root := Node3D.new()
	for n in ["arch_LOD0", "arch_LOD1", "arch_LOD2", "far"]:
		var mi := MeshInstance3D.new()
		mi.name = n
		var box := BoxMesh.new()
		box.size = Vector3(20, 42 if n == "arch_LOD0" else 40, 10)
		mi.mesh = box
		mi.position = Vector3(0, 21, 0)
		root.add_child(mi)
		mi.owner = root
	var dir := OS.get_user_data_dir().path_join("landmark_model_test")
	DirAccess.make_dir_recursive_absolute(dir.path_join("public/assets/models"))
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	doc.append_from_scene(root, state)
	var file := dir.path_join("public/assets/models/model_lm_test_gate.glb")
	t.ok(doc.write_to_filesystem(state, file) == OK, "the test model is written")
	root.free()
	var man := FileAccess.open(dir.path_join("public/assets/manifest.json"), FileAccess.WRITE)
	man.store_string(JSON.stringify({"images": {}, "audio": {}, "models": {"model_lm_test_gate": {"path": "assets/models/model_lm_test_gate.glb", "kind": "model"}}}))
	man.close()
	var found := LandmarkModel.find("test_gate", dir)
	t.ok(found == file, "the manifest entry model_lm_<id> names the file (%s)" % found)
	t.ok(LandmarkModel.find("india_gate", dir) == "", "a landmark with no model keeps its stand-in")
	var ranges := [[0.0, 350.0], [350.0, 900.0], [900.0, 1800.0], [1800.0, 6000.0]]
	var node := LandmarkModel.load_model(found, ranges, 0.1)
	t.ok(node != null, "the model loads")
	if node == null:
		return
	var levels := LandmarkModel.levels_of(node)
	t.ok(levels[0].size() == 1 and levels[1].size() == 1 and levels[2].size() == 1 and levels[3].size() == 1, "each level and the far silhouette found by name")
	var far: GeometryInstance3D = levels[3][0]
	var l0: GeometryInstance3D = levels[0][0]
	t.ok(is_equal_approx(l0.visibility_range_end, 350.0) and is_equal_approx(far.visibility_range_begin, 1800.0) and far.visibility_range_fade_mode == GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF, "the levels get the stand-in's visibility ranges")
	t.ok(absf(LandmarkModel.height_of(node) - 42.0) < 0.5, "the built height is read off level 0 (%.2f)" % LandmarkModel.height_of(node))
	node.free()
