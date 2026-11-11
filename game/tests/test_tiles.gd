## The GDScript reader of our binary tile (game/bench/tiles/tile_t1.gd, P0-018) against the fixture written by the
## TypeScript encoder (harness/data/fixtures/tile_t1_sample.json, tools/fixtures/gen_tile_fixture.mjs): the same
## counts, the same values, and collider faces that match the drawn triangles.
extends RefCounted

const TileT1 := preload("res://bench/tiles/tile_t1.gd")
const FIXTURE := "res://../harness/data/fixtures/tile_t1_sample.json"

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
	var names: Array[String] = []
	for m: Dictionary in want.meshes:
		names.append(str(m.name))
		var mi := root.get_node_or_null(str(m.name)) as MeshInstance3D
		t.ok(mi != null and mi.mesh.surface_get_array_len(0) == int(m.vertices) and mi.mesh.surface_get_array_index_len(0) == int(m.indices), "mesh %s has %d vertices and %d indices" % [m.name, int(m.vertices), int(m.indices)])
	var shells := (root.get_node("buildings") as MeshInstance3D).mesh
	var verts: PackedVector3Array = shells.surface_get_arrays(0)[Mesh.ARRAY_VERTEX]
	var first: Array = want.buildingFirstVertex
	t.ok(verts[0].distance_to(Vector3(first[0], first[1], first[2])) < 1e-4, "the first building vertex is where the bake put it (%s)" % verts[0])
	var top := -INF
	for v in verts:
		top = maxf(top, v.y)
	t.near(top, float(want.buildingMaxY), 1e-4, "the roof height")
	# placements: the headless renderer keeps no MultiMesh buffer, so the count comes from the node and the values
	# from the same bytes the reader hands to the MultiMesh
	var mm := (root.get_node("facade_bay") as MultiMeshInstance3D).multimesh
	t.ok(mm.instance_count == int(want.placements) and mm.transform_format == MultiMesh.TRANSFORM_3D, "the MultiMesh has %d 3D instances" % int(want.placements))
	var head := TileT1.read_header(bytes)
	var at := int(head.base) + int(head.header.placements[0].xforms)
	var first_xf := bytes.slice(at, at + 48).to_float32_array()
	var p: Array = want.firstPlacement
	var same := first_xf.size() == 12
	for k in 12:
		same = same and absf(first_xf[k] - float(p[k])) < 1e-5
	t.ok(same, "the first placement has the 12 numbers the bake wrote (MultiMesh buffer order)")
	for body: StaticBody3D in tile.bodies:
		body.free()
	root.free()


func test_front_faces_follow_the_normals_and_colliders_match_the_drawn_triangles() -> void:
	var fx := _fixture()
	if not fx.has("base64"):
		t.ok(false, "the tile fixture loads")
		return
	var tile := TileT1.build_tile(Marshalls.base64_to_raw(str(fx.base64)))
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
			# Godot front faces are clockwise: (b - a) x (c - a) points against the normal
			if (b - a).cross(c - a).dot(n[idx[k]]) >= 0.0:
				wrong += 1
			drawn[(a + b + c).snappedf(0.001)] = true
	t.ok(wrong == 0, "every triangle is wound clockwise seen from its normal (%d wrong)" % wrong)
	var missing := 0
	for body: StaticBody3D in tile.bodies:
		var faces := ((body.get_child(0) as CollisionShape3D).shape as ConcavePolygonShape3D).get_faces()
		for k in range(0, faces.size(), 3):
			if not drawn.has((faces[k] + faces[k + 1] + faces[k + 2]).snappedf(0.001)):
				missing += 1
		body.free()
	t.ok(missing == 0, "every collider triangle is a drawn triangle (%d are not)" % missing)
	root.free()


func test_bad_files_are_refused() -> void:
	t.ok(not TileT1.build_tile(PackedByteArray()).ok, "an empty file is refused")
	var junk := "JUNKJUNKJUNKJUNK".to_ascii_buffer()
	t.ok(not TileT1.build_tile(junk).ok, "a file without the KTL1 mark is refused")
	var wrong_version := "KTL1".to_ascii_buffer()
	wrong_version.resize(16)
	wrong_version.encode_u32(4, 99)
	t.ok(not TileT1.build_tile(wrong_version).ok, "an unknown version is refused")
