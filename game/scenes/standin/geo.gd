## Mesh helpers for the procedural stand-in scenes (street, landmarks, areas). Extends prims.gd, so Geo.SEG_ROUND,
## Geo.extrude() and the other primitives are reachable from here too.
## A Sink merges many transformed primitives into one surface per material, so a whole block is a handful of draw
## calls. Tested in game/tests/test_standin.gd.
extends "res://scenes/standin/prims.gd"


## Collects geometry per material key under a stack of local frames (push a building's frame, build in local
## coordinates, pop). Only rotations about Y, translations and positive scales go on the stack: never a mirror.
class Sink:
	const P := preload("res://scenes/standin/prims.gd")

	var batches := {}
	var stack: Array[Transform3D] = [Transform3D.IDENTITY]

	func push(xf: Transform3D) -> void:
		stack.append(stack[-1] * xf)

	func pop() -> void:
		stack.pop_back()

	func put(mat: String, arrays: Array, xf: Transform3D, col: Color) -> void:
		if not batches.has(mat):
			batches[mat] = Batch.new()
		batches[mat].add(arrays, stack[-1] * xf, col)

	## Box centred at c with full size sz, turned rot_y radians about Y.
	func box(mat: String, col: Color, c: Vector3, sz: Vector3, rot_y := 0.0) -> void:
		put(mat, P.unit_box(), Transform3D(Basis(Vector3.UP, rot_y) * Basis.from_scale(sz), c), col)

	## Upright cylinder centred at c (axis Y), radius r, height h; taper = top radius / bottom radius.
	func cyl(mat: String, col: Color, c: Vector3, r: float, h: float, seg := P.SEG_ROUND, taper := 1.0) -> void:
		put(mat, P.unit_cyl(seg, taper), Transform3D(Basis.from_scale(Vector3(r, h, r)), c), col)

	## Ellipsoid centred at c with radii rad.
	func ball(mat: String, col: Color, c: Vector3, rad: Vector3, seg := P.SEG_ROUND) -> void:
		put(mat, P.unit_sphere(seg), Transform3D(Basis.from_scale(rad), c), col)

	## Dome (upper half ellipsoid) standing on base, radius r, height h.
	func dome(mat: String, col: Color, base: Vector3, r: float, h: float, seg := P.SEG_ROUND) -> void:
		put(mat, P.unit_dome(seg), Transform3D(Basis.from_scale(Vector3(r, h, r)), base), col)

	## Round rod from a to b with radius r (poles, limbs, wires, rails).
	func rod(mat: String, col: Color, a: Vector3, b: Vector3, r: float, seg := P.SEG_SMALL, taper := 1.0) -> void:
		put(mat, P.unit_cyl(seg, taper), P.rod_xf(a, b, r), col)

	## Wire from a to b sagging by sag metres in the middle (8 straight pieces).
	func wire(mat: String, col: Color, a: Vector3, b: Vector3, sag: float, r := 0.012) -> void:
		var prev := a
		for i in range(1, 9):
			var t := i / 8.0
			var p := a.lerp(b, t) - Vector3(0, sag * 4.0 * t * (1.0 - t), 0)
			rod(mat, col, prev, p, r, P.SEG_THIN)
			prev = p

	## A 2D outline (x right, y up) extruded along +Z by depth, placed by xf.
	func ext(mat: String, col: Color, poly: PackedVector2Array, depth: float, xf := Transform3D.IDENTITY) -> void:
		put(mat, P.extrude(poly, depth), xf, col)

	func vertex_count() -> int:
		var n := 0
		for k in batches:
			n += batches[k].verts.size()
		return n

	## One ArrayMesh with a surface per material key (mats: key -> Material).
	func to_mesh(mats: Dictionary) -> ArrayMesh:
		var mesh := ArrayMesh.new()
		var keys := batches.keys()
		keys.sort()
		for k in keys:
			var b: Batch = batches[k]
			if b.verts.is_empty():
				continue
			mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, b.arrays())
			mesh.surface_set_material(mesh.get_surface_count() - 1, mats.get(k))
		return mesh


