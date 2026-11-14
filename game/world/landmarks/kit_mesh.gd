## The mesh sink of the landmark parts kit (P2-007): geometry per part and material key under a local frame, with
## the collision shapes and the measured top, safe to fill on a worker thread (no shared caches, no nodes, no
## resources: only packed arrays). The material keys are the stand-in kit's (game/scenes/standin/kit.gd materials():
## "matte" is the shared stone and plaster surface the look restyles, "satin", "metal", "glow"), so a landmark takes the
## signed look like every other stand-in. Winding: points are given counter-clockwise seen from the outside and
## written clockwise, Godot's front face. Only rotations, translations and positive scales go in the frame: no mirror.
extends RefCounted


## The format flags of the custom channels (both RGBA float), for add_surface_from_arrays.
const CUSTOM_FLAGS := (Mesh.ARRAY_CUSTOM_RGBA_FLOAT << Mesh.ARRAY_FORMAT_CUSTOM0_SHIFT) | (Mesh.ARRAY_CUSTOM_RGBA_FLOAT << Mesh.ARRAY_FORMAT_CUSTOM1_SHIFT)


class Surf:
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	var c := PackedColorArray()
	var i := PackedInt32Array()
	## UVs, only on a surface that got a quad_uv (P2-032, the tunnel murals); kept as long as v once started.
	var uv := PackedVector2Array()
	## Two custom channels (4 floats a vertex), only on a surface a post pass filled whole (P2-032: the tunnel's strip
	## light vectors, game/world/infra/kit_tunnel_light.gd); written as ARRAY_CUSTOM0 and 1 in RGBA float.
	var cu0 := PackedFloat32Array()
	var cu1 := PackedFloat32Array()


## part name -> material key -> Surf
var parts := {}
var part := "main"
var mat := "matte"
## The local frame shapes are built in (the landmark's own frame is the identity).
var xf := Transform3D.IDENTITY
var _stack: Array[Transform3D] = []
## Collision shapes in the landmark frame: {kind: "box", xf, size} or {kind: "hull", points}. Recorded while `collide`.
var colliders: Array = []
var collide := false
## Highest point drawn (landmark frame) and the triangle count.
var top := -INF
var triangles := 0


func push(local: Transform3D) -> void:
	_stack.append(xf)
	xf = xf * local


func pop() -> void:
	xf = _stack.pop_back()


func use(part_name: String, material := "matte") -> void:
	part = part_name
	mat = material


func _surf() -> Surf:
	if not parts.has(part):
		parts[part] = {}
	var p: Dictionary = parts[part]
	if not p.has(mat):
		p[mat] = Surf.new()
	return p[mat]


## One flat triangle, a b c counter-clockwise seen from the side it faces.
func tri(a: Vector3, b: Vector3, c: Vector3, col: Color) -> void:
	var wa := xf * a
	var wb := xf * b
	var wc := xf * c
	var nrm := (wb - wa).cross(wc - wa)
	if nrm.length_squared() < 1e-12:
		return
	nrm = nrm.normalized()
	var s := _surf()
	var base := s.v.size()
	s.v.append_array([wa, wb, wc])
	s.n.append_array([nrm, nrm, nrm])
	s.c.append_array([col, col, col])
	if not s.uv.is_empty():
		s.uv.append_array([Vector2.ZERO, Vector2.ZERO, Vector2.ZERO])
	s.i.append_array([base, base + 2, base + 1])
	top = maxf(top, maxf(wa.y, maxf(wb.y, wc.y)))
	triangles += 1


## A flat quad a b c d, counter-clockwise seen from the side it faces.
func quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, col: Color) -> void:
	var wa := xf * a
	var wb := xf * b
	var wc := xf * c
	var wd := xf * d
	var nrm := (wb - wa).cross(wc - wa) + (wc - wa).cross(wd - wa)
	if nrm.length_squared() < 1e-12:
		return
	nrm = nrm.normalized()
	var s := _surf()
	var base := s.v.size()
	s.v.append_array([wa, wb, wc, wd])
	s.n.append_array([nrm, nrm, nrm, nrm])
	s.c.append_array([col, col, col, col])
	if not s.uv.is_empty():
		s.uv.append_array([Vector2.ZERO, Vector2.ZERO, Vector2.ZERO, Vector2.ZERO])
	s.i.append_array([base, base + 2, base + 1, base, base + 3, base + 2])
	top = maxf(top, maxf(maxf(wa.y, wb.y), maxf(wc.y, wd.y)))
	triangles += 2


## A flat quad with a UV and a colour per corner (P2-032: the tunnel murals' shader reads the run's metres and the
## height in the UV, and a value in the colour). Counter-clockwise seen from the side it faces.
func quad_uv(a: Vector3, b: Vector3, c: Vector3, d: Vector3, ua: Vector2, ub: Vector2, uc: Vector2, ud: Vector2, ca: Color, cb: Color, cc: Color, cd: Color) -> void:
	var wa := xf * a
	var wb := xf * b
	var wc := xf * c
	var wd := xf * d
	var nrm := (wb - wa).cross(wc - wa) + (wc - wa).cross(wd - wa)
	if nrm.length_squared() < 1e-12:
		return
	nrm = nrm.normalized()
	var s := _surf()
	var base := s.v.size()
	if s.uv.size() < base:
		s.uv.resize(base)
	s.v.append_array([wa, wb, wc, wd])
	s.n.append_array([nrm, nrm, nrm, nrm])
	s.c.append_array([ca, cb, cc, cd])
	s.uv.append_array([ua, ub, uc, ud])
	s.i.append_array([base, base + 2, base + 1, base, base + 3, base + 2])
	top = maxf(top, maxf(maxf(wa.y, wb.y), maxf(wc.y, wd.y)))
	triangles += 2


## A box centred at c, full size sz, turned yaw radians about Y. `bottom` false leaves the underside out.
func box(c: Vector3, sz: Vector3, col: Color, yaw := 0.0, bottom := false, solid := true) -> void:
	push(Transform3D(Basis(Vector3.UP, yaw), c))
	var h := sz * 0.5
	var p := [Vector3(-h.x, -h.y, -h.z), Vector3(h.x, -h.y, -h.z), Vector3(h.x, -h.y, h.z), Vector3(-h.x, -h.y, h.z),
		Vector3(-h.x, h.y, -h.z), Vector3(h.x, h.y, -h.z), Vector3(h.x, h.y, h.z), Vector3(-h.x, h.y, h.z)]
	quad(p[4], p[7], p[6], p[5], col) # top
	quad(p[0], p[4], p[5], p[1], col) # -z
	quad(p[2], p[6], p[7], p[3], col) # +z
	quad(p[3], p[7], p[4], p[0], col) # -x
	quad(p[1], p[5], p[6], p[2], col) # +x
	if bottom:
		quad(p[0], p[1], p[2], p[3], col)
	if collide and solid:
		colliders.append({"kind": "box", "xf": xf, "size": sz})
	pop()


## A collision box only (nothing drawn): centre c, full size sz, turned yaw about Y, in the current frame.
func solid(c: Vector3, sz: Vector3, yaw := 0.0) -> void:
	if collide:
		colliders.append({"kind": "box", "xf": xf * Transform3D(Basis(Vector3.UP, yaw), c), "size": sz})


## A solid over a footprint (x, z points, either winding) from y0 to y1, with its roof. The collider is its hull.
func prism(poly: PackedVector2Array, y0: float, y1: float, col: Color, roof := Color(0, 0, 0, 0), solid := true) -> void:
	if poly.size() < 3 or y1 - y0 < 0.01:
		return
	var ccw := _area(poly) < 0.0 # in x, z with z south, a negative shoelace area runs counter-clockwise seen from above
	var n := poly.size()
	for k in n:
		var a := poly[k]
		var b := poly[(k + 1) % n]
		if ccw:
			quad(Vector3(a.x, y0, a.y), Vector3(b.x, y0, b.y), Vector3(b.x, y1, b.y), Vector3(a.x, y1, a.y), col)
		else:
			quad(Vector3(b.x, y0, b.y), Vector3(a.x, y0, a.y), Vector3(a.x, y1, a.y), Vector3(b.x, y1, b.y), col)
	cap(poly, y1, roof if roof.a > 0.0 else col, true)
	if collide and solid:
		var pts := PackedVector3Array()
		for q in poly:
			pts.append(xf * Vector3(q.x, y0, q.y))
			pts.append(xf * Vector3(q.x, y1, q.y))
		colliders.append({"kind": "hull", "points": pts})


## A flat polygon (x, z) at height y facing up (or down).
func cap(poly: PackedVector2Array, y: float, col: Color, up := true) -> void:
	var idx := Geometry2D.triangulate_polygon(poly)
	for k in range(0, idx.size(), 3):
		var a := Vector3(poly[idx[k]].x, y, poly[idx[k]].y)
		var b := Vector3(poly[idx[k + 1]].x, y, poly[idx[k + 1]].y)
		var c := Vector3(poly[idx[k + 2]].x, y, poly[idx[k + 2]].y)
		# counter-clockwise from above: (b - a) x (c - a) points up
		var up_n := (b - a).cross(c - a).y > 0.0
		if up_n == up:
			tri(a, b, c, col)
		else:
			tri(a, c, b, col)


## A 2D outline (x right, y up, either winding) extruded from z = 0 to z = depth in the current frame (+z is the back).
func extrude(poly: PackedVector2Array, depth: float, col: Color, caps := true) -> void:
	if poly.size() < 3:
		return
	var n := poly.size()
	var ccw := _area(poly) > 0.0 # x right, y up: positive area is counter-clockwise
	for k in n:
		var a := poly[k]
		var b := poly[(k + 1) % n]
		var pa0 := Vector3(a.x, a.y, 0.0)
		var pb0 := Vector3(b.x, b.y, 0.0)
		var pa1 := Vector3(a.x, a.y, depth)
		var pb1 := Vector3(b.x, b.y, depth)
		# an edge of a counter-clockwise outline faces out on its right: seen from outside a, b run right to left
		if ccw:
			quad(pb0, pb1, pa1, pa0, col)
		else:
			quad(pa0, pa1, pb1, pb0, col)
	if not caps:
		return
	var idx := Geometry2D.triangulate_polygon(poly)
	for k in range(0, idx.size(), 3):
		var a := poly[idx[k]]
		var b := poly[idx[k + 1]]
		var c := poly[idx[k + 2]]
		var tccw := (b - a).cross(c - a) > 0.0
		# front cap at z = 0 faces -z, back cap at z = depth faces +z
		if tccw:
			tri(Vector3(a.x, a.y, 0), Vector3(c.x, c.y, 0), Vector3(b.x, b.y, 0), col)
			tri(Vector3(a.x, a.y, depth), Vector3(b.x, b.y, depth), Vector3(c.x, c.y, depth), col)
		else:
			tri(Vector3(a.x, a.y, 0), Vector3(b.x, b.y, 0), Vector3(c.x, c.y, 0), col)
			tri(Vector3(a.x, a.y, depth), Vector3(c.x, c.y, depth), Vector3(b.x, b.y, depth), col)


## Only the front face of a 2D outline (x right, y up) at z = 0, facing -z: a flat inlay on a wall (blind arches,
## panels), cheap where a plate's edges would never be seen.
func face(poly: PackedVector2Array, col: Color) -> void:
	var idx := Geometry2D.triangulate_polygon(poly)
	for k in range(0, idx.size(), 3):
		var a := poly[idx[k]]
		var b := poly[idx[k + 1]]
		var c := poly[idx[k + 2]]
		if (b - a).cross(c - a) > 0.0:
			tri(Vector3(a.x, a.y, 0), Vector3(c.x, c.y, 0), Vector3(b.x, b.y, 0), col)
		else:
			tri(Vector3(a.x, a.y, 0), Vector3(b.x, b.y, 0), Vector3(c.x, c.y, 0), col)


## A solid of revolution about the local Y axis at c: profile points (radius, height) from the bottom up, smooth
## normals, `seg` sides. A profile point of radius 0 closes it to a tip. `cols` (one per profile point) bands it.
func lathe(prof: PackedVector2Array, seg: int, c: Vector3, col: Color, cols: PackedColorArray = PackedColorArray(), phase := 0.0) -> void:
	var m := prof.size()
	if m < 2:
		return
	# slope normals per profile point (average of the segments that meet there)
	var pn: Array[Vector2] = []
	for k in m:
		# a point given twice is a crease: each copy takes the normal of its own side only
		var d := Vector2.ZERO
		if k > 0 and prof[k] != prof[k - 1]:
			d += (prof[k] - prof[k - 1]).normalized()
		if k < m - 1 and prof[k + 1] != prof[k]:
			d += (prof[k + 1] - prof[k]).normalized()
		d = d.normalized()
		pn.append(Vector2(d.y, -d.x)) # outward: (dy, -dr) in (r, y)
	var s := _surf()
	var nb := xf.basis.inverse().transposed()
	var base := s.v.size()
	for k in m:
		var r := prof[k].x
		var y := prof[k].y
		var kc := cols[k] if k < cols.size() else col
		for j in seg + 1:
			var a := phase + TAU * j / seg
			var dir := Vector3(cos(a), 0.0, sin(a))
			var p := xf * (c + dir * r + Vector3(0, y, 0))
			s.v.append(p)
			s.n.append((nb * (dir * pn[k].x + Vector3(0, pn[k].y, 0))).normalized())
			s.c.append(kc)
			top = maxf(top, p.y)
	for k in m - 1:
		if prof[k + 1] == prof[k]:
			continue
		for j in seg:
			var a0 := base + k * (seg + 1) + j
			var a1 := a0 + 1
			var b0 := a0 + seg + 1
			var b1 := b0 + 1
			# counter-clockwise from outside: (a0, b0, a1) and (a1, b0, b1); written clockwise
			if prof[k].x > 1e-5:
				s.i.append_array([a0, a1, b0])
				triangles += 1
			if prof[k + 1].x > 1e-5:
				s.i.append_array([a1, b1, b0])
				triangles += 1


## A lathe in vertical stripes: segments alternate `col` and `stripe` every `every` sides (Jama Masjid's black and
## white domes). Each stripe has its own vertices, so the colours do not blend.
func striped_lathe(prof: PackedVector2Array, seg: int, c: Vector3, col: Color, stripe: Color, every := 2, wide := 1) -> void:
	# `every` sides of `col`, then `wide` sides of `stripe`, round the whole turn
	var k := 0
	var dark := false
	while k < seg:
		var n := mini(wide if dark else every, seg - k)
		lathe_arc(prof, n, TAU * k / seg, TAU * n / seg, c, stripe if dark else col)
		k += n
		dark = not dark


## Part of a lathe: `n` sides from angle a0 over `span` radians.
func lathe_arc(prof: PackedVector2Array, n: int, a0: float, span: float, c: Vector3, col: Color) -> void:
	var m := prof.size()
	var pn: Array[Vector2] = []
	for k in m:
		var d := Vector2.ZERO
		if k > 0 and prof[k] != prof[k - 1]:
			d += (prof[k] - prof[k - 1]).normalized()
		if k < m - 1 and prof[k + 1] != prof[k]:
			d += (prof[k + 1] - prof[k]).normalized()
		d = d.normalized()
		pn.append(Vector2(d.y, -d.x))
	var s := _surf()
	var nb := xf.basis.inverse().transposed()
	var base := s.v.size()
	for k in m:
		for j in n + 1:
			var a := a0 + span * j / n
			var dir := Vector3(cos(a), 0.0, sin(a))
			var p := xf * (c + dir * prof[k].x + Vector3(0, prof[k].y, 0))
			s.v.append(p)
			s.n.append((nb * (dir * pn[k].x + Vector3(0, pn[k].y, 0))).normalized())
			s.c.append(col)
			top = maxf(top, p.y)
	for k in m - 1:
		if prof[k + 1] == prof[k]:
			continue
		for j in n:
			var i0 := base + k * (n + 1) + j
			var i1 := i0 + 1
			var j0 := i0 + n + 1
			var j1 := j0 + 1
			if prof[k].x > 1e-5:
				s.i.append_array([i0, i1, j0])
				triangles += 1
			if prof[k + 1].x > 1e-5:
				s.i.append_array([i1, j1, j0])
				triangles += 1


## An upright cylinder with its top cap: centre of the base c, radius r, height h; taper = top radius over r.
func cyl(c: Vector3, r: float, h: float, seg: int, col: Color, taper := 1.0, cap_top := true) -> void:
	var prof := PackedVector2Array([Vector2(r, 0), Vector2(r * taper, h)])
	if cap_top:
		prof.append_array([Vector2(r * taper, h), Vector2(0.0, h)])
	lathe(prof, seg, c, col)
	if collide:
		var pts := PackedVector3Array()
		for j in 8:
			var a := TAU * j / 8.0
			pts.append(xf * (c + Vector3(cos(a) * r, 0, sin(a) * r)))
			pts.append(xf * (c + Vector3(cos(a) * r * taper, h, sin(a) * r * taper)))
		colliders.append({"kind": "hull", "points": pts})


## A prism over a regular polygon (n sides) about c: the octagonal towers and chhatri bases.
func ngon(c: Vector3, r: float, n: int, y0: float, y1: float, col: Color, phase := 0.0) -> void:
	prism(ngon_poly(c, r, n, phase), c.y + y0, c.y + y1, col)


static func ngon_poly(c: Vector3, r: float, n: int, phase := 0.0) -> PackedVector2Array:
	var poly := PackedVector2Array()
	for k in n:
		var a := phase + TAU * k / n
		poly.append(Vector2(c.x + cos(a) * r, c.z + sin(a) * r))
	return poly


## A rod from a to b of radius r (flag poles, finial spikes, railings).
func rod(a: Vector3, b: Vector3, r: float, seg: int, col: Color) -> void:
	var d := b - a
	var len := d.length()
	if len < 1e-4:
		return
	var y := d / len
	var x := y.cross(Vector3.FORWARD if absf(y.dot(Vector3.FORWARD)) < 0.9 else Vector3.RIGHT).normalized()
	var z := x.cross(y)
	push(Transform3D(Basis(x, y, z), a))
	lathe(PackedVector2Array([Vector2(r, 0), Vector2(r, len)]), seg, Vector3.ZERO, col)
	pop()


## Shoelace area of a 2D outline (sign by winding).
static func _area(poly: PackedVector2Array) -> float:
	var a := 0.0
	for k in poly.size():
		var p := poly[k]
		var q := poly[(k + 1) % poly.size()]
		a += p.x * q.y - q.x * p.y
	return a * 0.5


## The arrays of one part: material key -> mesh arrays. A surface with the custom channels needs CUSTOM_FLAGS when it
## is added to a mesh.
func arrays_of(part_name: String) -> Dictionary:
	var out := {}
	if not parts.has(part_name):
		return out
	for k: String in parts[part_name]:
		var s: Surf = parts[part_name][k]
		if s.i.is_empty():
			continue
		var a := []
		a.resize(Mesh.ARRAY_MAX)
		a[Mesh.ARRAY_VERTEX] = s.v
		a[Mesh.ARRAY_NORMAL] = s.n
		a[Mesh.ARRAY_COLOR] = s.c
		if not s.uv.is_empty() and s.uv.size() == s.v.size():
			a[Mesh.ARRAY_TEX_UV] = s.uv
		if s.cu0.size() == s.v.size() * 4 and s.cu1.size() == s.v.size() * 4:
			a[Mesh.ARRAY_CUSTOM0] = s.cu0
			a[Mesh.ARRAY_CUSTOM1] = s.cu1
		a[Mesh.ARRAY_INDEX] = s.i
		out[k] = a
	return out


## Triangles drawn so far into a part.
func count(part_name: String) -> int:
	var n := 0
	for k: String in parts.get(part_name, {}):
		n += (parts[part_name][k] as Surf).i.size() / 3
	return n


func part_names() -> Array:
	var names := parts.keys()
	names.sort()
	return names
