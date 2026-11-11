## Triangle list builder of the physics bench (P0-017). One list of vertices feeds both the drawn mesh and the
## collider, which is the owner rule behind collider option K3: colliders come from the same vertices as what is
## drawn. Winding follows Godot (front faces are clockwise seen from the front); `want` flips a face that would
## look the other way, so callers only say which way a face points.
extends RefCounted

var verts := PackedVector3Array()
var colors := PackedColorArray()


func tri(a: Vector3, b: Vector3, c: Vector3, color: Color, want: Vector3 = Vector3.ZERO) -> void:
	if want != Vector3.ZERO and (c - a).cross(b - a).dot(want) < 0.0:
		var s := b
		b = c
		c = s
	verts.append(a)
	verts.append(b)
	verts.append(c)
	colors.append(color)
	colors.append(color)
	colors.append(color)


## A quad from four corners in ring order.
func quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, color: Color, want: Vector3 = Vector3.ZERO) -> void:
	tri(a, b, c, color, want)
	tri(a, c, d, color, want)


## An axis-aligned box from lo to hi. No bottom face unless asked (it sits on something).
func box(lo: Vector3, hi: Vector3, color: Color, bottom: bool = false) -> void:
	var side := color.darkened(0.18)
	quad(Vector3(lo.x, hi.y, lo.z), Vector3(hi.x, hi.y, lo.z), Vector3(hi.x, hi.y, hi.z), Vector3(lo.x, hi.y, hi.z), color, Vector3.UP)
	quad(Vector3(lo.x, lo.y, lo.z), Vector3(lo.x, hi.y, lo.z), Vector3(lo.x, hi.y, hi.z), Vector3(lo.x, lo.y, hi.z), side, Vector3.LEFT)
	quad(Vector3(hi.x, lo.y, lo.z), Vector3(hi.x, hi.y, lo.z), Vector3(hi.x, hi.y, hi.z), Vector3(hi.x, lo.y, hi.z), side, Vector3.RIGHT)
	quad(Vector3(lo.x, lo.y, lo.z), Vector3(hi.x, lo.y, lo.z), Vector3(hi.x, hi.y, lo.z), Vector3(lo.x, hi.y, lo.z), side, Vector3.FORWARD)
	quad(Vector3(lo.x, lo.y, hi.z), Vector3(hi.x, lo.y, hi.z), Vector3(hi.x, hi.y, hi.z), Vector3(lo.x, hi.y, hi.z), side, Vector3.BACK)
	if bottom:
		quad(Vector3(lo.x, lo.y, lo.z), Vector3(hi.x, lo.y, lo.z), Vector3(hi.x, lo.y, hi.z), Vector3(lo.x, lo.y, hi.z), side, Vector3.DOWN)


## A ramp along Z: full width from x0 to x1, from (z0, y0) to (z1, y1), with side walls down to `base`.
func ramp(x0: float, x1: float, z0: float, y0: float, z1: float, y1: float, base: float, color: Color) -> void:
	var side := color.darkened(0.18)
	quad(Vector3(x0, y0, z0), Vector3(x1, y0, z0), Vector3(x1, y1, z1), Vector3(x0, y1, z1), color, Vector3.UP)
	for x in [x0, x1]:
		var want := Vector3.LEFT if x == x0 else Vector3.RIGHT
		quad(Vector3(x, base, z0), Vector3(x, y0, z0), Vector3(x, y1, z1), Vector3(x, base, z1), side, want)
	if y0 > base + 0.0001:
		quad(Vector3(x0, base, z0), Vector3(x1, base, z0), Vector3(x1, y0, z0), Vector3(x0, y0, z0), side, Vector3(0, 0, signf(z0 - z1)))
	if y1 > base + 0.0001:
		quad(Vector3(x0, base, z1), Vector3(x1, base, z1), Vector3(x1, y1, z1), Vector3(x0, y1, z1), side, Vector3(0, 0, signf(z1 - z0)))


func append(other: RefCounted) -> void:
	verts.append_array(other.verts)
	colors.append_array(other.colors)


func triangles() -> int:
	return verts.size() / 3


## The drawn mesh: flat normals, vertex colours.
func mesh() -> ArrayMesh:
	var normals := PackedVector3Array()
	normals.resize(verts.size())
	for i in range(0, verts.size(), 3):
		var n := (verts[i + 2] - verts[i]).cross(verts[i + 1] - verts[i]).normalized()
		normals[i] = n
		normals[i + 1] = n
		normals[i + 2] = n
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_COLOR] = colors
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	return m


## The collider, from the same vertices as the mesh.
func shape() -> ConcavePolygonShape3D:
	var s := ConcavePolygonShape3D.new()
	s.set_faces(verts)
	return s


## Height of the top drawn triangle under (x, z), or NAN when nothing is drawn there. Interpolated from the
## triangle's own vertices in double precision (no ray), so it is the reference for the collider check. Slow (every
## triangle), for checks only.
static func height_at(soup: PackedVector3Array, x: float, z: float) -> float:
	var best := NAN
	for i in range(0, soup.size(), 3):
		var a := soup[i]
		var b := soup[i + 1]
		var c := soup[i + 2]
		if minf(a.x, minf(b.x, c.x)) > x or maxf(a.x, maxf(b.x, c.x)) < x or minf(a.z, minf(b.z, c.z)) > z or maxf(a.z, maxf(b.z, c.z)) < z:
			continue
		var d: float = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z)
		if absf(d) < 1e-12:
			continue # a vertical face
		var l1: float = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d
		var l2: float = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d
		var l3 := 1.0 - l1 - l2
		if l1 < -1e-9 or l2 < -1e-9 or l3 < -1e-9:
			continue
		var y: float = l1 * a.y + l2 * b.y + l3 * c.y
		if is_nan(best) or y > best:
			best = y
	return best


static func material() -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.vertex_color_use_as_albedo = true
	m.vertex_color_is_srgb = true
	m.roughness = 0.9
	return m
