## The Connaught Place circle (hero, P2-007): the uniform two storey white Georgian colonnade ring (DELHI_WORLD.md
## "Area blueprints", the owner's rule: whatever OSM draws). The blocks are the ring sectors the bake read off the map
## (tools/bake/landmarks/kit.ts cpSectors): an upper storey over an open colonnade of Tuscan columns on every face, the
## shopfronts set back under it, tall windows above, a cornice and a parapet, 11.5 m in all (registry edit lm_0001,
## the hero road spec cp_inner_circle). In the middle of Central Park the national flag on its 63 m pole (en.wikipedia
## 'Connaught Place, New Delhi': a 90 by 60 ft flag on a 207 ft pole). Parts: seven wedges of the ring and the flag.
extends RefCounted

const KitMesh := preload("res://world/landmarks/kit_mesh.gd")
const Parts := preload("res://world/landmarks/parts.gd")

const WEDGES := 7
## The colonnade: its depth under the upper floor, the column height and spacing (area sheet cp_inner_circle: 6 m
## cream stone walk under the colonnade; board photos 3 to 5, 21 and 23).
const WALK_M := 4.5
const GROUND_M := 5.4
const BAY_M := 4.0
const FLAG_POLE_M := 63.0
const FLAG_W_M := 27.0
const CREAM := Color("#e8e3d5")
const RENDER := Color("#f2f0ea")
const SHOP := Color("#2f3a40")
const ROOF := Color("#a7a39a")


static func build(m: KitMesh, kit: Dictionary, lm: Dictionary, lod: int) -> Dictionary:
	var H := float(lm.height) if lm.get("height") != null else 11.5
	var tops := -INF
	# the blocks go into WEDGES parts of about the same size, in order round the ring (each under 25,000 triangles)
	var blocks: Array = kit.get("sectors", []).duplicate()
	blocks.sort_custom(func(p: Dictionary, q: Dictionary) -> bool: return fposmod(float(p.a0), 360.0) < fposmod(float(q.a0), 360.0))
	var total := 0.0
	for s: Dictionary in blocks:
		total += _weight(s)
	var acc := 0.0
	for s: Dictionary in blocks:
		var a0 := float(s.a0)
		var a1 := float(s.a1)
		m.use("wedge%d" % mini(WEDGES - 1, int(floor((acc + _weight(s) * 0.5) / maxf(1.0, total) * WEDGES))))
		acc += _weight(s)
		# each block stands on the lowest ground under it; its height is measured from there
		var before := m.top
		m.top = -INF
		m.push(Transform3D(Basis.IDENTITY, Vector3(0, float(s.base), 0)))
		_block(m, float(s.r0), float(s.r1), a0, a1, 0.0, H, lod)
		m.pop()
		tops = maxf(tops, m.top - float(s.base))
		m.top = maxf(before, m.top)
	m.use("flag")
	Parts.flag(m, Vector3.ZERO, FLAG_POLE_M, FLAG_W_M, lod)
	return {"heightM": tops, "heightPart": "the parapet of the colonnade blocks"}


## How much a block costs to draw: the length of its faces (columns and windows run along them).
static func _weight(s: Dictionary) -> float:
	var span := deg_to_rad(float(s.a1) - float(s.a0))
	return span * (float(s.r0) + float(s.r1)) + 2.0 * (float(s.r1) - float(s.r0))


## A point at radius r and compass bearing a (deg) at height y, in metres from the middle of the rings.
static func _p(r: float, a: float, y: float) -> Vector3:
	var t := deg_to_rad(a)
	return Vector3(r * sin(t), y, -r * cos(t))


## An annular sector as a footprint (x, z), the arcs in steps of at most `step` degrees.
static func _sector(r0: float, r1: float, a0: float, a1: float, step: float) -> PackedVector2Array:
	var n := maxi(1, int(ceil((a1 - a0) / step)))
	var out := PackedVector2Array()
	for k in n + 1:
		var p := _p(r1, a0 + (a1 - a0) * k / n, 0.0)
		out.append(Vector2(p.x, p.z))
	for k in range(n, -1, -1):
		var p := _p(r0, a0 + (a1 - a0) * k / n, 0.0)
		out.append(Vector2(p.x, p.z))
	return out


static func _block(m: KitMesh, r0: float, r1: float, a0: float, a1: float, base: float, H: float, lod: int) -> void:
	var step := 1.5 if lod == 0 else (3.0 if lod == 1 else (6.0 if lod == 2 else 12.0))
	var foot := base - 0.4
	var cornice := H - 1.2
	var outer := _sector(r0, r1, a0, a1, step)
	if lod >= 3:
		# the far silhouette: the block as one solid, the colonnade's shadow as its lower band
		m.prism(outer, foot, GROUND_M, SHOP.lerp(CREAM, 0.3), CREAM, false)
		m.prism(outer, GROUND_M, H, CREAM, ROOF, false)
		return
	# the upper storey over the whole block, its ceiling over the walk, the cornice and the parapet
	m.prism(outer, GROUND_M, cornice, CREAM, ROOF)
	m.cap(outer, GROUND_M, CREAM.darkened(0.12), false)
	if lod <= 2:
		var lip := _sector(r0 - 0.45, r1 + 0.45, a0 - 0.45 / r1 * 57.3, a1 + 0.45 / r1 * 57.3, step)
		m.prism(lip, cornice, cornice + 0.35, RENDER, RENDER, false)
	m.prism(_sector(r0, r1, a0, a1, step), cornice + 0.35, H, RENDER, ROOF, false)
	# the shops set back under the colonnade
	var da := rad_to_deg(WALK_M / ((r0 + r1) * 0.5))
	var inner_a0 := a0 + da
	var inner_a1 := a1 - da
	if inner_a1 - inner_a0 < 1.0 or r1 - r0 < WALK_M * 2.0 + 2.0:
		return
	var shops := _sector(r0 + WALK_M, r1 - WALK_M, inner_a0, inner_a1, step)
	m.prism(shops, foot, GROUND_M, CREAM.darkened(0.06), Color(0, 0, 0, 0), false)
	if m.collide:
		_hulls(m, r0, r1, a0, a1, GROUND_M, H)
		_hulls(m, r0 + WALK_M, r1 - WALK_M, inner_a0, inner_a1, foot, GROUND_M)
	# the walk under the colonnade (cream stone) at the foot
	if lod <= 1:
		m.prism(outer, foot, base + 0.05, Color("#d9cfbd"), Color("#d9cfbd"), false)
	# shopfront glass and sign band on the two curved faces under the colonnade
	if lod <= 1:
		for r in [r0 + WALK_M, r1 - WALK_M]:
			var face_out := 1.0 if r > (r0 + r1) * 0.5 else -1.0
			var n := maxi(1, int(ceil((inner_a1 - inner_a0) / step)))
			for k in n:
				var t0 := inner_a0 + (inner_a1 - inner_a0) * k / n
				var t1 := inner_a0 + (inner_a1 - inner_a0) * (k + 1) / n
				_arc_quad(m, r + face_out * 0.03, t0, t1, base + 0.3, base + 3.6, SHOP, face_out)
				_arc_quad(m, r + face_out * 0.03, t0, t1, base + 3.9, base + 4.7, Color("#1f2a33") if k % 3 else Color("#7a1e1e"), face_out)
	# the columns on every face and the windows above them
	for side in [0, 1]:
		var r: float = r0 + 0.55 if side == 0 else r1 - 0.55
		var out := -1.0 if side == 0 else 1.0
		var arc := deg_to_rad(a1 - a0) * r
		var n := maxi(2, int(round(arc / BAY_M)))
		for k in n + 1:
			var a := a0 + (a1 - a0) * k / n
			var at := _p(r, a, base - 0.05)
			if lod == 0:
				Parts.tuscan_column(m, at, GROUND_M - base + 0.05, 0.36, 0, RENDER)
			else:
				m.box(at + Vector3(0, (GROUND_M - base) * 0.5, 0), Vector3(0.7, GROUND_M - base, 0.7), RENDER, deg_to_rad(-a))
			if m.collide:
				m.solid(at + Vector3(0, (GROUND_M - base) * 0.5, 0), Vector3(0.7, GROUND_M - base, 0.7), deg_to_rad(-a))
			if k < n:
				var am := a0 + (a1 - a0) * (k + 0.5) / n
				_window(m, r1 + 0.02 if side == 1 else r0 - 0.02, am, out, lod)
	# the radial ends: columns across the end and a window over each bay
	for end in [0, 1]:
		var a := a0 if end == 0 else a1
		var n := maxi(2, int(round((r1 - r0) / BAY_M)))
		for k in range(1, n):
			var r := r0 + (r1 - r0) * k / n
			var at := _p(r, a + (0.55 / r * 57.3 if end == 0 else -0.55 / r * 57.3), base - 0.05)
			if lod == 0:
				Parts.tuscan_column(m, at, GROUND_M - base + 0.05, 0.36, 0, RENDER)
			else:
				m.box(at + Vector3(0, (GROUND_M - base) * 0.5, 0), Vector3(0.7, GROUND_M - base, 0.7), RENDER, deg_to_rad(-a))
			if m.collide:
				m.solid(at + Vector3(0, (GROUND_M - base) * 0.5, 0), Vector3(0.7, GROUND_M - base, 0.7), deg_to_rad(-a))


## A tall window on the upper storey at radius r, bearing a, on the face whose outward side is `out` (+1 away from
## the middle): the dark pane and its white surround.
static func _window(m: KitMesh, r: float, a: float, out: float, lod: int) -> void:
	var p := _p(r, a, 0.0)
	var t := deg_to_rad(a)
	var radial := Vector3(sin(t), 0, -cos(t)) * out
	# the box's x along the tangent of the ring
	var tangent := Vector3(cos(t), 0, sin(t))
	var yaw := atan2(-tangent.z, tangent.x)
	var y := GROUND_M + 1.1
	# the surround and the pane as flat inlays on the face (their edges are never seen at this depth)
	m.push(Transform3D(Basis(Vector3.UP, yaw + (PI if out < 0.0 else 0.0)) , p + Vector3(0, y, 0)))
	m.push(Transform3D(Basis.IDENTITY, Vector3(0, 0, 0.0)))
	m.face(PackedVector2Array([Vector2(-0.85, -0.1), Vector2(0.85, -0.1), Vector2(0.85, 2.8), Vector2(-0.85, 2.8)]), RENDER)
	m.pop()
	m.push(Transform3D(Basis.IDENTITY, Vector3(0, 0, -0.04)))
	m.face(PackedVector2Array([Vector2(-0.6, 0.15), Vector2(0.6, 0.15), Vector2(0.6, 2.55), Vector2(-0.6, 2.55)]), Color("#334049"))
	m.pop()
	m.pop()



## A curved strip of a face at radius r from bearing t0 to t1, from y0 to y1, facing out (+1) or in (-1).
static func _arc_quad(m: KitMesh, r: float, t0: float, t1: float, y0: float, y1: float, col: Color, out: float) -> void:
	var a := _p(r, t0, y0)
	var b := _p(r, t1, y0)
	var c := _p(r, t1, y1)
	var d := _p(r, t0, y1)
	# bearings grow clockwise seen from above: seen from outside the ring a to b runs right to left
	if out > 0.0:
		m.quad(b, a, d, c, col)
	else:
		m.quad(a, b, c, d, col)


## Convex hull colliders of a sector in pieces of at most 6 degrees.
static func _hulls(m: KitMesh, r0: float, r1: float, a0: float, a1: float, y0: float, y1: float) -> void:
	var n := maxi(1, int(ceil((a1 - a0) / 6.0)))
	for k in n:
		var t0 := a0 + (a1 - a0) * k / n
		var t1 := a0 + (a1 - a0) * (k + 1) / n
		var pts := PackedVector3Array()
		for r in [r0, r1]:
			for t in [t0, (t0 + t1) * 0.5, t1]:
				for y in [y0, y1]:
					pts.append(m.xf * _p(r, t, y))
		m.colliders.append({"kind": "hull", "points": pts})
