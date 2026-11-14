## The mesh sink of the area kit modules (P2-010): one surface of flat quads and boxes in the module frame (x along
## the wall to the right seen from outside, y up, z out of the wall; a bay is authored MODULE_W wide and MODULE_H high
## and the instance scales it, tools/bake/areas/facade.ts). Every vertex carries its part: COLOR (an sRGB colour, or a
## shade when the colour comes from elsewhere), UV2 = (part code, colour mode) and UV (atlas coordinates for the atlas
## and board codes), read by the kit shader (game/render/shaders/kit_b.gdshader). Pure arrays: safe on any thread.
## Winding as the landmark kit: points counter-clockwise seen from the side they face, written clockwise.
extends RefCounted

const MODULE_W := 3.0
const MODULE_H := 3.2
const PARAPET_H := 1.0
## the wall skin sits this far in front of the shell wall, so the two never fight for depth
const SKIN := 0.05

## part codes (kit_b.gdshader): tiling layers 0 to 7, then painted iron, atlas, sign board, dark interior
const RENDER := 0
const BRICK := 1
const STONE := 2
const CONCRETE := 3
const SHUTTER := 4
const WOOD := 5
const GLASS := 6
const CLOTH := 7
const IRON := 8
const ATLAS := 9
const BOARD := 10
const INTERIOR := 11
## colour modes: the vertex colour, the wall colour of the building times it, a kit accent per bay, a second accent
const OWN := 0
const WALL := 1
const ACCENT := 2
const ACCENT2 := 3
## detail levels of a quad (P2-010 perf, mesh LOD index buffers): FINE quads (balusters, grille, cage and gate bars,
## rails, reveals) draw in LOD 0 only; RELIEF (slabs, sills, ledges, awnings, boxes) in LODs 0 and 1; FACE (the wall
## skin, openings, boards) in every LOD. A MultiMesh picks its LOD by the distance of its cell (Godot mesh LOD).
const FACE := 0
const RELIEF := 1
const FINE := 2
## LOD switch distances in metres at a 1280 px wide view (FOV 70): LOD 1 past LOD1_M, LOD 2 past LOD2_M
const LOD1_M := 80.0
const LOD2_M := 150.0

var v := PackedVector3Array()
var n := PackedVector3Array()
var c := PackedColorArray()
var uv := PackedVector2Array()
var uv2 := PackedVector2Array()
var idx := PackedInt32Array()
var triangles := 0
## current paint
var code := RENDER
var mode := WALL
var col := Color(1, 1, 1)
## true while fine detail is drawn (FINE); `face` true while flat wall faces are drawn (FACE); otherwise RELIEF
var fine := false
var face := false
## the detail level of each quad, in order
var levels := PackedByteArray()


func paint(part_code: int, colour_mode: int, colour := Color(1, 1, 1)) -> void:
	code = part_code
	mode = colour_mode
	col = colour


## A flat quad a b c d, counter-clockwise seen from the side it faces; atlas UVs for its corners (optional).
func quad(a: Vector3, b: Vector3, cc: Vector3, d: Vector3, uvs: PackedVector2Array = PackedVector2Array()) -> void:
	var nrm := (b - a).cross(cc - a) + (cc - a).cross(d - a)
	if nrm.length_squared() < 1e-12:
		return
	nrm = nrm.normalized()
	var base := v.size()
	v.append_array([a, b, cc, d])
	n.append_array([nrm, nrm, nrm, nrm])
	c.append_array([col, col, col, col])
	if uvs.size() == 4:
		uv.append_array(uvs)
	else:
		uv.append_array([Vector2.ZERO, Vector2.ZERO, Vector2.ZERO, Vector2.ZERO])
	var p := Vector2(code, mode)
	levels.append(FINE if fine else (FACE if face else RELIEF))
	uv2.append_array([p, p, p, p])
	idx.append_array([base, base + 2, base + 1, base, base + 3, base + 2])
	triangles += 2


## A rectangle facing +z at depth z, x0..x1 by y0..y1; `atlas` (x, y, w, h in 0..1) maps it onto the atlas, or a
## board (0..1 across the whole board).
func front(x0: float, y0: float, x1: float, y1: float, z: float, atlas := Rect2()) -> void:
	var uvs := PackedVector2Array()
	if atlas.size != Vector2.ZERO:
		var p := atlas.position
		var s := atlas.size
		uvs = PackedVector2Array([Vector2(p.x, p.y + s.y), Vector2(p.x + s.x, p.y + s.y), Vector2(p.x + s.x, p.y), Vector2(p.x, p.y)])
	quad(Vector3(x0, y0, z), Vector3(x1, y0, z), Vector3(x1, y1, z), Vector3(x0, y1, z), uvs)


## A box from lo to hi. `back` false leaves out the face against the wall (-z), `bottom` false the underside.
func box(lo: Vector3, hi: Vector3, back := false, bottom := true) -> void:
	var p := [Vector3(lo.x, lo.y, lo.z), Vector3(hi.x, lo.y, lo.z), Vector3(hi.x, lo.y, hi.z), Vector3(lo.x, lo.y, hi.z),
		Vector3(lo.x, hi.y, lo.z), Vector3(hi.x, hi.y, lo.z), Vector3(hi.x, hi.y, hi.z), Vector3(lo.x, hi.y, hi.z)]
	quad(p[4], p[7], p[6], p[5]) # top
	quad(p[2], p[6], p[7], p[3]) # +z
	quad(p[3], p[7], p[4], p[0]) # -x
	quad(p[1], p[5], p[6], p[2]) # +x
	if back:
		quad(p[0], p[4], p[5], p[1])
	if bottom:
		quad(p[0], p[1], p[2], p[3])


## A thin bar from a to b (points in the frame), square section `t`; for railings, grilles and posts.
func bar(a: Vector3, b: Vector3, t: float) -> void:
	var h := t * 0.5
	var was := fine
	fine = true
	box(Vector3(minf(a.x, b.x) - h, minf(a.y, b.y) - h, minf(a.z, b.z) - h), Vector3(maxf(a.x, b.x) + h, maxf(a.y, b.y) + h, maxf(a.z, b.z) + h), false, true)
	fine = was


## A sloped flat strip (stair flight, awning): four corners, both sides drawn.
func both(a: Vector3, b: Vector3, cc: Vector3, d: Vector3, uvs := PackedVector2Array()) -> void:
	quad(a, b, cc, d, uvs)
	var r := PackedVector2Array()
	if uvs.size() == 4:
		r = PackedVector2Array([uvs[0], uvs[3], uvs[2], uvs[1]])
	quad(a, d, cc, b, r)


## The wall skin of a bay from y0 to y1 with rectangular openings (x0, y0, x1, y1 each), at z SKIN.
func skin(y0: float, y1: float, holes: Array, x0 := -MODULE_W * 0.5, x1 := MODULE_W * 0.5) -> void:
	# split into horizontal bands at every hole edge, then fill each band between the holes it crosses
	var was := face
	face = true
	var ys := [y0, y1]
	for h: Rect2 in holes:
		ys.append(clampf(h.position.y, y0, y1))
		ys.append(clampf(h.end.y, y0, y1))
	ys.sort()
	for k in ys.size() - 1:
		var a: float = ys[k]
		var b: float = ys[k + 1]
		if b - a < 1e-4:
			continue
		var mid := (a + b) * 0.5
		var xs := []
		for h: Rect2 in holes:
			if mid > h.position.y and mid < h.end.y:
				xs.append([h.position.x, h.end.x])
		xs.sort_custom(func(p, q): return p[0] < q[0])
		var x := x0
		for s: Array in xs:
			if s[0] > x + 1e-4:
				front(x, a, s[0], b, SKIN)
			x = maxf(x, s[1])
		if x < x1 - 1e-4:
			front(x, a, x1, b, SKIN)
	face = was


## Front-only bars of a painted iron railing from x0 to x1 at depth z, height h above y; posts every `step`.
func railing(x0: float, x1: float, y: float, h: float, z: float, step := 0.16) -> void:
	paint(IRON, ACCENT)
	bar(Vector3(x0, y + h, z), Vector3(x1, y + h, z), 0.04)
	front(x0, y + 0.1, x1, y + 0.13, z)
	var x := x0 + step * 0.5
	fine = true
	while x < x1:
		front(x - 0.01, y, x + 0.01, y + h, z)
		x += step
	fine = false


## The four reveal sides of an opening (depth d into the wall is not possible: the reveal stands out from the skin).
func reveal(r: Rect2, d: float, z := SKIN) -> void:
	var was := fine
	fine = true
	var x0 := r.position.x
	var x1 := r.end.x
	var y0 := r.position.y
	var y1 := r.end.y
	quad(Vector3(x0, y0, z), Vector3(x0, y1, z), Vector3(x0, y1, z + d), Vector3(x0, y0, z + d)) # left side faces +x
	quad(Vector3(x1, y0, z + d), Vector3(x1, y1, z + d), Vector3(x1, y1, z), Vector3(x1, y0, z)) # right side faces -x
	quad(Vector3(x0, y1, z), Vector3(x1, y1, z), Vector3(x1, y1, z + d), Vector3(x0, y1, z + d)) # head faces -y
	quad(Vector3(x0, y0, z + d), Vector3(x1, y0, z + d), Vector3(x1, y0, z), Vector3(x0, y0, z)) # sill faces +y
	fine = was


## The arrays of one surface (ARRAY_MAX long), or an empty array when nothing was drawn.
func arrays() -> Array:
	if idx.is_empty():
		return []
	var a := []
	a.resize(Mesh.ARRAY_MAX)
	a[Mesh.ARRAY_VERTEX] = v
	a[Mesh.ARRAY_NORMAL] = n
	a[Mesh.ARRAY_COLOR] = c
	a[Mesh.ARRAY_TEX_UV] = uv
	a[Mesh.ARRAY_TEX_UV2] = uv2
	a[Mesh.ARRAY_INDEX] = idx
	return a


func mesh() -> ArrayMesh:
	var m := ArrayMesh.new()
	var a := arrays()
	if not a.is_empty():
		m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, a, [], lods())
	return m


## The LOD index buffers {edge length: indices}: LOD 1 leaves out the FINE quads, LOD 2 keeps the FACE quads only; a
## level that drops nothing is left out. Godot draws LOD i once edge * view width / (distance * 2 tan(hfov / 2)) is
## under the mesh LOD threshold (1 px), so the key for a switch at d metres is d * 2 tan(hfov / 2) / 1280.
func lods() -> Dictionary:
	var out := {}
	var k := 2.0 * tan(deg_to_rad(35.0)) * (16.0 / 9.0) / 1280.0
	var last := idx.size()
	for lv: Array in [[LOD1_M, RELIEF], [LOD2_M, FACE]]:
		var keep := PackedInt32Array()
		for q in levels.size():
			if levels[q] <= int(lv[1]):
				keep.append_array(idx.slice(q * 6, q * 6 + 6))
		if keep.is_empty():
			# nothing left (a rail is bars only): one triangle with no area
			keep = PackedInt32Array([0, 0, 0])
		if keep.size() < last:
			out[float(lv[0]) * k] = keep
			last = keep.size()
	return out
