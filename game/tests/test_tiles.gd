## The GDScript reader of our binary tile (game/bench/tiles/tile_t1.gd, P0-018) against the fixture written by the
## production tile writer (harness/data/fixtures/tile_t1_sample.json, tools/fixtures/gen_tile_fixture.mjs): the same
## counts, the same values, lane UVs, lanes and pins, and collider faces that match the drawn triangles. Then a real
## production tile of the pilot bake (data/pilot_centre/tiles/, gitignored: skipped with a note when it is missing),
## and the magnitude rule.
extends RefCounted

const TileT1 := preload("res://bench/tiles/tile_t1.gd")
const FIXTURE := "res://../harness/data/fixtures/tile_t1_sample.json"
const PILOT_TILES := "res://../data/pilot_centre/tiles/"

var t
var tree: SceneTree


func _fixture() -> Dictionary:
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(ProjectSettings.globalize_path(FIXTURE)))
	return parsed if typeof(parsed) == TYPE_DICTIONARY else {}


func test_reader_finds_what_the_bake_wrote() -> void:
	var fx := _fixture()
	t.ok(fx.has("base64"), "the tile fixture loads")
	if not fx.has("base64"):
		return
	var bytes := Marshalls.base64_to_raw(str(fx.base64))
	t.ok(bytes.size() == int(fx.bytes), "the fixture has %d bytes (%d)" % [int(fx.bytes), bytes.size()])
	var tile := TileT1.build_tile(bytes)
	t.ok(tile.ok, "the reader accepts the tile")
	if not tile.ok:
		return
	var want: Dictionary = fx.expect
	t.ok(int(tile.triangles) == int(want.triangles), "%d triangles (%d)" % [int(want.triangles), int(tile.triangles)])
	t.ok(int(tile.collider_triangles) == int(want.colliderTriangles), "%d collider triangles (%d)" % [int(want.colliderTriangles), int(tile.collider_triangles)])
	t.ok((tile.bodies as Array).size() == int(want.colliderChunks), "%d collider chunks" % int(want.colliderChunks))
	t.ok(int(tile.placements) == int(want.placements), "%d placements (%d)" % [int(want.placements), int(tile.placements)])
	var root: Node3D = tile.root
	for m: Dictionary in want.meshes:
		var mi := root.get_node_or_null(str(m.name)) as MeshInstance3D
		t.ok(mi != null and mi.mesh.surface_get_array_len(0) == int(m.vertices) and mi.mesh.surface_get_array_index_len(0) == int(m.indices), "mesh %s has %d vertices and %d indices" % [m.name, int(m.vertices), int(m.indices)])
	var shells := (root.get_node("building") as MeshInstance3D).mesh
	var verts: PackedVector3Array = shells.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	var first: Array = want.buildingFirstVertex
	t.ok(verts[0].distance_to(Vector3(first[0], first[1], first[2])) < 1e-6, "the first building vertex is where the bake put it (%s)" % verts[0])
	var top := -INF
	for v in verts:
		top = maxf(top, v.y)
	t.near(top, float(want.buildingMaxY), 1e-6, "the roof height")
	# the lane UV and border codes of the road mesh
	var road := (root.get_node("road") as MeshInstance3D).mesh.surface_get_arrays(0)
	var uv: PackedVector2Array = road[Mesh.ARRAY_TEX_UV]
	var uv2: PackedVector2Array = road[Mesh.ARRAY_TEX_UV2]
	var fu: Array = want.roadFirstUv
	var fu2: Array = want.roadFirstUv2
	t.ok(uv.size() == road[Mesh.ARRAY_VERTEX].size() and uv[0].distance_to(Vector2(fu[0], fu[1])) < 1e-6 and uv2[0].distance_to(Vector2(fu2[0], fu2[1])) < 1e-6, "the road mesh carries its lane UV and border codes")
	# lanes and pins
	var lanes: Array = tile.lanes
	var fl: Dictionary = want.firstLane
	var lp: Array = fl.first
	t.ok(lanes.size() == int(want.lanes) and str(lanes[0].id) == str(fl.id) and (lanes[0].pts as PackedVector3Array).size() == int(fl.points), "%d lane pieces, the first %s with %d points" % [int(want.lanes), fl.id, int(fl.points)])
	t.ok((lanes[0].pts as PackedVector3Array)[0].distance_to(Vector3(lp[0], lp[1], lp[2])) < 1e-6 and (lanes[0].next as Array) == (fl.next as Array), "the first lane point and what follows the lane")
	var pins: Array = tile.pins
	var wp: Dictionary = want.firstPin
	var pp: Array = wp.pos
	t.ok(pins.size() == int(want.pins) and str(pins[0].id) == str(wp.id) and (pins[0].pos as Vector3).distance_to(Vector3(pp[0], pp[1], pp[2])) < 1e-6, "the pin %s where the bake put it" % wp.id)
	# placements are reserved for P2 in production tiles; a bench tile with placements is read by the same code
	if int(want.placements) > 0:
		var mm := (root.get_node("facade_bay") as MultiMeshInstance3D).multimesh
		t.ok(mm.instance_count == int(want.placements) and mm.transform_format == MultiMesh.TRANSFORM_3D, "the MultiMesh has %d 3D instances" % int(want.placements))
	for body: StaticBody3D in tile.bodies:
		body.free()
	root.free()


func test_front_faces_follow_the_normals_and_colliders_match_the_drawn_triangles() -> void:
	var fx := _fixture()
	if not fx.has("base64"):
		t.ok(false, "the tile fixture loads")
		return
	_faces_and_colliders(TileT1.build_tile(Marshalls.base64_to_raw(str(fx.base64))), "the fixture")


## Every drawn triangle wound clockwise from its normal; every collider triangle one of the drawn triangles.
func _faces_and_colliders(tile: Dictionary, what: String) -> void:
	var root: Node3D = tile.root
	var drawn := {}
	var wrong := 0
	for child in root.get_children():
		if not child is MeshInstance3D:
			continue
		var arrays := (child as MeshInstance3D).mesh.surface_get_arrays(0)
		var v: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var n: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
		var idx: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
		for k in range(0, idx.size(), 3):
			var a := v[idx[k]]
			var b := v[idx[k + 1]]
			var c := v[idx[k + 2]]
			# Godot front faces are clockwise: (b - a) x (c - a) points against the normal (a triangle with no area
			# has no side and is not counted)
			var cr := (b - a).cross(c - a)
			if cr.length_squared() > 1e-12 and cr.dot(n[idx[k]]) >= 0.0:
				wrong += 1
			drawn[(a + b + c).snappedf(0.001)] = true
	t.ok(wrong == 0, "%s: every triangle is wound clockwise seen from its normal (%d wrong)" % [what, wrong])
	var missing := 0
	for body: StaticBody3D in tile.bodies:
		var faces := ((body.get_child(0) as CollisionShape3D).shape as ConcavePolygonShape3D).get_faces()
		for k in range(0, faces.size(), 3):
			if not drawn.has((faces[k] + faces[k + 1] + faces[k + 2]).snappedf(0.001)):
				missing += 1
		body.free()
	t.ok(missing == 0, "%s: every collider triangle is a drawn triangle (%d are not)" % [what, missing])
	root.free()


func test_bad_files_are_refused() -> void:
	t.ok(not TileT1.build_tile(PackedByteArray()).ok, "an empty file is refused")
	var junk := "JUNKJUNKJUNKJUNK".to_ascii_buffer()
	t.ok(not TileT1.build_tile(junk).ok, "a file without the KTL1 mark is refused")
	var wrong_version := "KTL1".to_ascii_buffer()
	wrong_version.resize(16)
	wrong_version.encode_u32(4, 99)
	t.ok(not TileT1.build_tile(wrong_version).ok, "an unknown version is refused")


func test_a_production_tile_of_the_pilot_bake() -> void:
	var index_file := ProjectSettings.globalize_path(PILOT_TILES + "index.json")
	if not FileAccess.file_exists(index_file):
		t.ok(true, "no pilot tiles here (run npm run bake -- pilot --offline): skipped")
		return
	var index: Variant = JSON.parse_string(FileAccess.get_file_as_string(index_file))
	t.ok(typeof(index) == TYPE_DICTIONARY and (index.tiles as Array).size() > 0, "the pilot tile index loads")
	if typeof(index) != TYPE_DICTIONARY or (index.tiles as Array).is_empty():
		return
	# the largest tile: the most of everything in one file
	var best: Dictionary = index.tiles[0]
	for r: Dictionary in index.tiles:
		if int(r.bytes) > int(best.bytes):
			best = r
	var tile := TileT1.load_tile(ProjectSettings.globalize_path(PILOT_TILES + str(best.file)))
	t.ok(tile.ok, "the reader accepts the production tile %s (%d bytes)%s" % [best.id, int(best.bytes), "" if tile.ok else ": " + str(tile.get("error", ""))])
	if not tile.ok:
		return
	t.ok(int(tile.triangles) == int(best.triangles) and int(tile.collider_triangles) == int(best.colliderTriangles) and (tile.bodies as Array).size() == int(best.chunks), "%d triangles, %d collider triangles in %d chunks, as the index says" % [int(best.triangles), int(best.colliderTriangles), int(best.chunks)])
	t.ok((tile.lanes as Array).size() == int(best.lanes), "%d lane pieces" % int(best.lanes))
	var largest := 0
	for body: StaticBody3D in tile.bodies:
		largest = maxi(largest, ((body.get_child(0) as CollisionShape3D).shape as ConcavePolygonShape3D).get_faces().size() / 3)
	t.ok(largest <= 600, "no collider chunk over 600 triangles (largest %d)" % largest)
	t.ok(float(tile.header.margin) > 0.0 and int(tile.header.tile.x) == int(best.x) and int(tile.header.tile.z) == int(best.z), "the tile names its world tile and its margin")
	_faces_and_colliders(tile, "production tile %s" % best.id)


func test_the_magnitude_rule_refuses_a_tile_with_a_vertex_far_outside() -> void:
	var fx := _fixture()
	if not fx.has("base64"):
		t.ok(false, "the tile fixture loads")
		return
	var bytes := Marshalls.base64_to_raw(str(fx.base64))
	var head := TileT1.read_header(bytes)
	# move the first ground vertex 10 km east, as a vertex in the wrong frame would be
	var at := int(head.base) + int(head.header.meshes[0].pos)
	bytes.encode_float(at, 10000.0)
	var tile := TileT1.build_tile(bytes)
	t.ok(not tile.ok and str(tile.get("error", "")).contains("margin"), "a vertex outside the tile plus its margin refuses the tile (%s)" % str(tile.get("error", "")))
