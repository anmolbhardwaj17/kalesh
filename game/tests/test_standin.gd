## The procedural stand-in scenes (P0-009): mesh helpers wind faces like Godot's own primitives, extrusions are
## closed solids, every layout is seeded (same mesh every build) and has the counts the task asks for, and no node
## is mirrored.
extends RefCounted

const Geo := preload("res://scenes/standin/geo.gd")
const Builder := preload("res://scenes/standin/builder.gd")

var t
var tree: SceneTree


## Share of triangles whose (b - a) x (c - a) points against the vertex normal (Godot's front face rule).
func _front_share(arrays: Array) -> float:
	var v: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var n: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
	var ind: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
	var front := 0
	for i in range(0, ind.size(), 3):
		var a := v[ind[i]]
		var face := (v[ind[i + 1]] - a).cross(v[ind[i + 2]] - a)
		if face.length() < 1e-9:
			front += 1
			continue
		if face.dot(n[ind[i]] + n[ind[i + 1]] + n[ind[i + 2]]) < 0.0:
			front += 1
	return float(front) / maxf(1.0, ind.size() / 3.0)


func test_winding_matches_godot_primitives() -> void:
	t.near(_front_share(Geo.unit_box()), 1.0, 1e-9, "BoxMesh triangles follow the front face rule tri() uses")
	t.near(_front_share(Geo.unit_cyl(Geo.SEG_ROUND)), 1.0, 1e-9, "CylinderMesh too")
	t.near(_front_share(Geo.unit_dome(Geo.SEG_ROUND)), 1.0, 1e-9, "own dome")
	t.near(_front_share(Geo.extrude(Geo.arch(24, 26, 10, 13), 9)), 1.0, 1e-9, "extruded arch")


func test_extrude_is_closed_either_winding() -> void:
	var sq := PackedVector2Array([Vector2(0, 0), Vector2(2, 0), Vector2(2, 1), Vector2(0, 1)])
	var rev := sq.duplicate()
	rev.reverse()
	for poly in [sq, rev, Geo.arch(24, 26, 10, 13), Geo.arch_opening(3, 2)]:
		var a := Geo.extrude(poly, 3.0)
		var v: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
		var ind: PackedInt32Array = a[Mesh.ARRAY_INDEX]
		var sum := Vector3.ZERO
		var vol := 0.0
		for i in range(0, ind.size(), 3):
			var p0 := v[ind[i]]
			var p1 := v[ind[i + 1]]
			var p2 := v[ind[i + 2]]
			sum += (p1 - p0).cross(p2 - p0)
			vol += p0.dot(p1.cross(p2)) / 6.0
		t.less(sum.length(), 1e-3, "closed solid: face area vectors sum to zero (%d points)" % poly.size())
		var area := absf(Geo.signed_area(poly))
		# Godot front faces are clockwise, so the signed volume of an outward solid is negative
		t.near(-vol, area * 3.0, area * 3.0 * 1e-4, "volume = outline area x depth (%d points)" % poly.size())


func test_rod_transform_is_not_mirrored() -> void:
	var xf := Geo.rod_xf(Vector3(1, 2, 3), Vector3(4, -1, 7), 0.2)
	t.ok(xf.basis.determinant() > 0.0, "rod basis keeps handedness")
	t.near((xf * Vector3(0, 0.5, 0)).distance_to(Vector3(4, -1, 7)), 0.0, 1e-4, "top of the unit cylinder lands on b")


func _build(layout: String) -> Node3D:
	var root := Node3D.new()
	Builder.new().build(root, layout)
	return root


func _walk(n: Node, out: Array) -> void:
	out.append(n)
	for c in n.get_children():
		_walk(c, out)


func test_street_counts() -> void:
	var root := _build("street")
	var s: Dictionary = root.get_meta("standin")
	t.ok(s.buildings >= 40 and s.buildings <= 80, "street has 40 to 80 buildings (%d)" % s.buildings)
	t.ok(s.vehicles >= 15 and s.vehicles <= 25, "street has 15 to 25 static vehicles (%d)" % s.vehicles)
	t.ok(s.people >= 20 and s.people <= 40, "street has 20 to 40 people (%d)" % s.people)
	t.ok(s.trees > 10 and s.lights > 10 and s.signs > 20, "trees, lights and sign labels (%s)" % s)
	t.ok(root.get_node_or_null("Car") != null and root.get_node_or_null("ChaseCamera") != null, "player car and camera")
	t.ok(root.get_node_or_null("Flyover") != null, "flyover ramp built")
	root.free()


func test_landmarks_and_areas() -> void:
	var lm := _build("landmarks")
	t.ok(lm.get_meta("standin").landmarks == ["hero", "signature", "marker"], "one landmark per tier")
	lm.free()
	var ar := _build("areas")
	var s: Dictionary = ar.get_meta("standin")
	t.ok(s.areas == ["bazaar", "lutyens"], "both area kit blocks")
	t.ok(s.characters == 1 and ar.get_node_or_null("Character") != null, "one third person character stand-in")
	ar.free()


func test_seeded_and_not_mirrored() -> void:
	for layout in ["street", "landmarks", "areas"]:
		var a := _build(layout)
		var b := _build(layout)
		t.ok(a.get_meta("standin").vertices == b.get_meta("standin").vertices and a.get_meta("standin").vertices > 10000,
			"%s builds the same mesh every time (%d vertices)" % [layout, a.get_meta("standin").vertices])
		var nodes := []
		_walk(a, nodes)
		for n in nodes:
			if n is Node3D:
				t.ok(n.transform.basis.determinant() > 0.0, "%s: %s is not mirrored" % [layout, n.name])
		a.free()
		b.free()
