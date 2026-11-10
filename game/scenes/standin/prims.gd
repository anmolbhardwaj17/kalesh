## Geometry primitives for the procedural stand-in scenes (geo.gd builds on them).
## A Sink (geo.gd) merges many transformed primitives into one surface per material, so a whole block is a handful of draw
## calls. Unit primitives are cached with enough segments for smooth silhouettes (the owner rejects a low poly look:
## columns, domes, tanks and wheels use SEG_ROUND). extrude() turns a 2D outline into a solid (arches, vehicle side
## profiles, building footprints). Pure geometry, no nodes: tested in game/tests/test_standin.gd.
## Winding: Godot front faces are clockwise seen from the front, so for a front face (b - a).cross(c - a) points
## away from the outward normal. tri() enforces that from the normal it is given.
extends RefCounted

const SEG_ROUND := 32
const SEG_MID := 20
const SEG_SMALL := 12
const SEG_THIN := 6

static var _cache := {}


## One surface: positions, normals, vertex colours (albedo) and indices.
class Batch:
	var verts := PackedVector3Array()
	var norms := PackedVector3Array()
	var cols := PackedColorArray()
	var idx := PackedInt32Array()

	func add(arrays: Array, xf: Transform3D, col: Color) -> void:
		var base := verts.size()
		var v: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var n: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
		var nb := xf.basis.inverse().transposed()
		var count := v.size()
		verts.resize(base + count)
		norms.resize(base + count)
		cols.resize(base + count)
		for i in count:
			verts[base + i] = xf * v[i]
			norms[base + i] = (nb * n[i]).normalized()
			cols[base + i] = col
		var ind: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
		var ib := idx.size()
		idx.resize(ib + ind.size())
		for k in ind.size():
			idx[ib + k] = ind[k] + base

	func arrays() -> Array:
		var a := []
		a.resize(Mesh.ARRAY_MAX)
		a[Mesh.ARRAY_VERTEX] = verts
		a[Mesh.ARRAY_NORMAL] = norms
		a[Mesh.ARRAY_COLOR] = cols
		a[Mesh.ARRAY_INDEX] = idx
		return a


static func unit_box() -> Array:
	if not _cache.has("box"):
		var m := BoxMesh.new()
		m.size = Vector3.ONE
		_cache["box"] = m.get_mesh_arrays()
	return _cache["box"]


## Cylinder of radius 1 (bottom) and height 1, centred on the origin.
static func unit_cyl(seg: int, taper := 1.0) -> Array:
	var key := "cyl%d_%.3f" % [seg, taper]
	if not _cache.has(key):
		var m := CylinderMesh.new()
		m.bottom_radius = 1.0
		m.top_radius = taper
		m.height = 1.0
		m.radial_segments = seg
		m.rings = 0
		_cache[key] = m.get_mesh_arrays()
	return _cache[key]


static func unit_sphere(seg: int) -> Array:
	var key := "sph%d" % seg
	if not _cache.has(key):
		var m := SphereMesh.new()
		m.radius = 1.0
		m.height = 2.0
		m.radial_segments = seg
		m.rings = maxi(4, seg / 2)
		_cache[key] = m.get_mesh_arrays()
	return _cache[key]


## Upper half of the unit sphere (y from 0 to 1), with a flat base cap.
static func unit_dome(seg: int) -> Array:
	var key := "dome%d" % seg
	if not _cache.has(key):
		var rings := maxi(4, seg / 4)
		var v := PackedVector3Array()
		var n := PackedVector3Array()
		var ind := PackedInt32Array()
		for j in rings + 1:
			var phi := PI * 0.5 * j / rings
			for i in seg + 1:
				var th := TAU * i / seg
				var p := Vector3(cos(phi) * cos(th), sin(phi), cos(phi) * sin(th))
				v.append(p)
				n.append(p.normalized())
		for j in rings:
			for i in seg:
				var a := j * (seg + 1) + i
				var b := a + 1
				var c := a + seg + 1
				var d := c + 1
				_tri_idx(v, n, ind, a, b, d)
				_tri_idx(v, n, ind, a, d, c)
		# base cap
		var centre := v.size()
		v.append(Vector3.ZERO)
		n.append(Vector3.DOWN)
		var rim := v.size()
		for i in seg + 1:
			var th := TAU * i / seg
			v.append(Vector3(cos(th), 0, sin(th)))
			n.append(Vector3.DOWN)
		for i in seg:
			_tri_idx(v, n, ind, centre, rim + i, rim + i + 1, Vector3.DOWN)
		var a := []
		a.resize(Mesh.ARRAY_MAX)
		a[Mesh.ARRAY_VERTEX] = v
		a[Mesh.ARRAY_NORMAL] = n
		a[Mesh.ARRAY_INDEX] = ind
		_cache[key] = a
	return _cache[key]


## Appends triangle (i, j, k) wound as a front face for normal nrm (default: the first vertex normal).
static func _tri_idx(v: PackedVector3Array, n: PackedVector3Array, ind: PackedInt32Array, i: int, j: int, k: int,
		nrm := Vector3.ZERO) -> void:
	var want := nrm if nrm != Vector3.ZERO else (n[i] + n[j] + n[k])
	if (v[j] - v[i]).cross(v[k] - v[i]).dot(want) > 0.0:
		ind.append_array([i, k, j])
	else:
		ind.append_array([i, j, k])


## Appends a flat triangle with its own three vertices facing nrm.
static func tri(v: PackedVector3Array, n: PackedVector3Array, ind: PackedInt32Array, a: Vector3, b: Vector3,
		c: Vector3, nrm: Vector3) -> void:
	var base := v.size()
	v.append_array([a, b, c])
	n.append_array([nrm, nrm, nrm])
	_tri_idx(v, n, ind, base, base + 1, base + 2, nrm)


static func signed_area(poly: PackedVector2Array) -> float:
	var s := 0.0
	for i in poly.size():
		var a := poly[i]
		var b := poly[(i + 1) % poly.size()]
		s += a.x * b.y - b.x * a.y
	return s * 0.5


## A simple polygon (x right, y up, either winding) extruded from z = 0 to z = depth: two caps plus one flat quad
## per edge. Arcs need enough points in the outline (arch() gives SEG_ROUND per half circle).
static func extrude(poly: PackedVector2Array, depth: float) -> Array:
	var p := poly.duplicate()
	if signed_area(p) < 0.0:
		p.reverse()
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	var ind := PackedInt32Array()
	var t := Geometry2D.triangulate_polygon(p)
	for i in range(0, t.size(), 3):
		var a := p[t[i]]
		var b := p[t[i + 1]]
		var c := p[t[i + 2]]
		tri(v, n, ind, Vector3(a.x, a.y, 0), Vector3(b.x, b.y, 0), Vector3(c.x, c.y, 0), Vector3.FORWARD)
		tri(v, n, ind, Vector3(a.x, a.y, depth), Vector3(b.x, b.y, depth), Vector3(c.x, c.y, depth), Vector3.BACK)
	for i in p.size():
		var a := p[i]
		var b := p[(i + 1) % p.size()]
		var e := b - a
		if e.length() < 1e-6:
			continue
		var out := Vector3(e.y, -e.x, 0).normalized()
		var a0 := Vector3(a.x, a.y, 0)
		var b0 := Vector3(b.x, b.y, 0)
		var a1 := Vector3(a.x, a.y, depth)
		var b1 := Vector3(b.x, b.y, depth)
		tri(v, n, ind, a0, b0, b1, out)
		tri(v, n, ind, a0, b1, a1, out)
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = v
	arr[Mesh.ARRAY_NORMAL] = n
	arr[Mesh.ARRAY_INDEX] = ind
	return arr


## Transform that maps the unit cylinder (axis Y, centred) onto a rod from a to b with radius r.
static func rod_xf(a: Vector3, b: Vector3, r: float) -> Transform3D:
	var d := b - a
	var len := d.length()
	var y := d / len if len > 1e-6 else Vector3.UP
	var ref := Vector3.UP if absf(y.y) < 0.9 else Vector3.RIGHT
	var x := ref.cross(y).normalized()
	var z := x.cross(y)
	return Transform3D(Basis(x * r, y * maxf(len, 1e-4), z * r), (a + b) * 0.5)


## Outline of a block w wide and h tall (x from -w/2, y from 0) with a round headed arch opening of width ow whose
## springing line is at spring. The opening runs down to y = 0.
static func arch(w: float, h: float, ow: float, spring: float, seg := SEG_ROUND) -> PackedVector2Array:
	var p := PackedVector2Array()
	var r := ow * 0.5
	p.append(Vector2(-w * 0.5, 0))
	p.append(Vector2(-r, 0))
	for i in seg + 1:
		var a := PI - PI * i / seg
		p.append(Vector2(cos(a) * r, spring + sin(a) * r))
	p.append(Vector2(r, 0))
	p.append(Vector2(w * 0.5, 0))
	p.append(Vector2(w * 0.5, h))
	p.append(Vector2(-w * 0.5, h))
	return p


## A curved shell outline: an arc from angle a0 to a1 (radians, 0 = +x) of radius r around c, thickness th.
static func arc_shell(c: Vector2, r: float, th: float, a0: float, a1: float, seg := SEG_MID) -> PackedVector2Array:
	var p := PackedVector2Array()
	for i in seg + 1:
		var a := lerpf(a0, a1, float(i) / seg)
		p.append(c + Vector2(cos(a), sin(a)) * r)
	for i in seg + 1:
		var a := lerpf(a1, a0, float(i) / seg)
		p.append(c + Vector2(cos(a), sin(a)) * (r - th))
	return p


## A polyline (x right, y up) given a thickness th on its right hand side: the outline of a bent plate (canopies).
static func strip(pts: PackedVector2Array, th: float) -> PackedVector2Array:
	var out := pts.duplicate()
	var inner := PackedVector2Array()
	for i in pts.size():
		var a := pts[maxi(0, i - 1)]
		var b := pts[mini(pts.size() - 1, i + 1)]
		var t := (b - a).normalized()
		inner.append(pts[i] + Vector2(t.y, -t.x) * th)
	inner.reverse()
	out.append_array(inner)
	return out


## Outline of a round headed opening ow wide whose springing line is at spring (a panel shape for niches).
static func arch_opening(ow: float, spring: float, seg := SEG_MID) -> PackedVector2Array:
	var p := PackedVector2Array()
	var r := ow * 0.5
	p.append(Vector2(-r, 0))
	p.append(Vector2(r, 0))
	for i in seg + 1:
		var a := PI * i / seg
		p.append(Vector2(cos(a) * r, spring + sin(a) * r))
	return p


## Basis that stands a footprint outline up: outline x -> +X, outline y -> -Z (north), extrusion -> +Y.
static func upright() -> Basis:
	return Basis(Vector3(1, 0, 0), Vector3(0, 0, -1), Vector3(0, 1, 0))


## Basis for side profiles of things facing -Z: outline x -> +Z (back), outline y -> +Y, extrusion -> -X.
## Place it at x = +width/2 so the solid spans the full width.
static func side() -> Basis:
	return Basis(Vector3(0, 0, 1), Vector3(0, 1, 0), Vector3(-1, 0, 0))


## A rectangle (x from x0 to x1, y from y0 to y1) with its corners rounded by rad (seg points per corner).
static func rounded_rect(x0: float, y0: float, x1: float, y1: float, rad: float, seg := 6) -> PackedVector2Array:
	var p := PackedVector2Array()
	var corners := [[Vector2(x1 - rad, y0 + rad), -PI * 0.5], [Vector2(x1 - rad, y1 - rad), 0.0],
		[Vector2(x0 + rad, y1 - rad), PI * 0.5], [Vector2(x0 + rad, y0 + rad), PI]]
	for c in corners:
		for i in seg + 1:
			var a: float = c[1] + PI * 0.5 * i / seg
			p.append(c[0] + Vector2(cos(a), sin(a)) * rad)
	return p
