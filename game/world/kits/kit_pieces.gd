## The pieces the area kits add to some bays (P2-010, kit_modules.gd PIECES): sign boards, outside stairs with their
## railings, roof tanks and roof railings, AC units, market awnings, lodge signs, and the Lutyens boundary wall and gate
## pier (not placed yet). Same module frame and paint codes as kit_modules.gd.
extends RefCounted

const M := preload("res://world/kits/module_mesh.gd")
const A_AC := Rect2(0.0, 0.75, 0.25, 0.25)
const WHITE := Color(1, 1, 1)


static func _board(m: M, kit: String) -> void:
	var y0 := 2.72
	var y1 := 3.14
	var z := 0.36
	if kit == "colonnade":
		y0 = 2.45
		y1 = 2.68
		z = 0.12
	m.paint(M.IRON, M.OWN, Color(0.2, 0.2, 0.2))
	m.box(Vector3(-1.38, y0 - 0.03, z - 0.08), Vector3(1.38, y1 + 0.03, z), true, true)
	m.paint(M.BOARD, M.OWN, WHITE)
	m.face = true
	m.front(-1.34, y0, 1.34, y1, z + 0.004, Rect2(0, 0, 1, 1))
	m.face = false


static func _stair(m: M, _o: Dictionary) -> void:
	# an outside stair from the floor below up to this floor, a landing across the bay, railings on the open side
	var n := 11
	var x0 := -1.35
	var x1 := 1.0
	var y0 := -M.MODULE_H
	var z0 := 0.1
	var z1 := 1.0
	m.paint(M.CONCRETE, M.WALL, Color(0.8, 0.8, 0.8))
	for i in n:
		var xa := x0 + (x1 - x0) * float(i) / n
		var xb := x0 + (x1 - x0) * float(i + 1) / n
		var ya := y0 + (0.0 - y0) * float(i) / n
		var yb := y0 + (0.0 - y0) * float(i + 1) / n
		m.quad(Vector3(xa, ya, z0), Vector3(xa, ya, z1), Vector3(xa, yb, z1), Vector3(xa, yb, z0)) # riser faces -x
		m.quad(Vector3(xa, yb, z0), Vector3(xa, yb, z1), Vector3(xb, yb, z1), Vector3(xb, yb, z0)) # tread faces +y
	# the flight's underside and its outer stringer
	m.quad(Vector3(x0, y0 - 0.15, z1), Vector3(x0, y0 - 0.15, z0), Vector3(x1, -0.15, z0), Vector3(x1, -0.15, z1))
	m.quad(Vector3(x0, y0 - 0.15, z1), Vector3(x1, -0.15, z1), Vector3(x1, 0.0, z1), Vector3(x0, y0 + 0.28, z1))
	# the landing
	m.box(Vector3(-1.5, -0.14, 0.05), Vector3(1.5, 0.0, z1 + 0.1), false, true)
	m.paint(M.IRON, M.ACCENT, WHITE)
	# the handrail along the flight: a slanted strip (a box from bar() would fill the flight's whole bounding box)
	var zr := z1 + 0.05
	m.quad(Vector3(x0, y0 + 0.92, zr), Vector3(x1, 0.92, zr), Vector3(x1, 0.97, zr), Vector3(x0, y0 + 0.97, zr))
	m.quad(Vector3(x0, y0 + 0.97, zr), Vector3(x1, 0.97, zr), Vector3(x1, 0.97, zr - 0.04), Vector3(x0, y0 + 0.97, zr - 0.04))
	m.quad(Vector3(x0, y0 + 0.5, zr), Vector3(x1, 0.5, zr), Vector3(x1, 0.53, zr), Vector3(x0, y0 + 0.53, zr))
	for f in [0.0, 0.5, 1.0]:
		var x := lerpf(x0, x1, f)
		var y := lerpf(y0, 0.0, f)
		m.bar(Vector3(x, y, z1 + 0.02), Vector3(x, y + 0.95, z1 + 0.02), 0.035)
	m.railing(-1.5, 1.5, 0.0, 0.95, z1 + 0.09, 0.16)


static func _tank(m: M, _o: Dictionary) -> void:
	# a black plastic water tank on a steel stand, behind the parapet
	var c := Vector3(0.55, M.PARAPET_H, -1.5)
	m.paint(M.IRON, M.OWN, Color(0.3, 0.3, 0.3))
	m.box(Vector3(c.x - 0.6, c.y, c.z - 0.6), Vector3(c.x + 0.6, c.y + 0.35, c.z + 0.6), false, false)
	m.paint(M.CONCRETE, M.OWN, Color(0.12, 0.12, 0.13))
	var n := 10
	var r := 0.55
	var y0 := c.y + 0.35
	var y1 := y0 + 1.15
	for i in n:
		var a0 := TAU * float(i) / n
		var a1 := TAU * float(i + 1) / n
		var p0 := Vector3(c.x + cos(a0) * r, 0, c.z + sin(a0) * r)
		var p1 := Vector3(c.x + cos(a1) * r, 0, c.z + sin(a1) * r)
		m.quad(Vector3(p1.x, y0, p1.z), Vector3(p0.x, y0, p0.z), Vector3(p0.x, y1, p0.z), Vector3(p1.x, y1, p1.z))
		m.quad(Vector3(c.x, y1 + 0.12, c.z), Vector3(c.x, y1 + 0.12, c.z), Vector3(p1.x, y1, p1.z), Vector3(p0.x, y1, p0.z))


static func _rail(m: M, _o: Dictionary) -> void:
	# a railing on the parapet (roof terraces are used: laundry, sleeping out in summer)
	m.paint(M.IRON, M.ACCENT, WHITE)
	for x in [-1.45, 0.0, 1.45]:
		m.bar(Vector3(x, M.PARAPET_H, 0.1), Vector3(x, M.PARAPET_H + 0.95, 0.1), 0.04)
	m.bar(Vector3(-1.5, M.PARAPET_H + 0.95, 0.1), Vector3(1.5, M.PARAPET_H + 0.95, 0.1), 0.035)
	m.bar(Vector3(-1.5, M.PARAPET_H + 0.5, 0.1), Vector3(1.5, M.PARAPET_H + 0.5, 0.1), 0.025)
	var x := -1.35
	m.fine = true
	while x < 1.4:
		m.front(x - 0.008, M.PARAPET_H, x + 0.008, M.PARAPET_H + 0.95, 0.12)
		x += 0.15
	m.fine = false


static func _ac(m: M, _o: Dictionary) -> void:
	m.paint(M.CONCRETE, M.OWN, Color(0.8, 0.79, 0.75))
	m.box(Vector3(0.65, 0.1, 0.05), Vector3(1.35, 0.65, 0.5), false, true)
	m.paint(M.ATLAS, M.OWN, WHITE)
	m.front(0.66, 0.11, 1.34, 0.64, 0.505, A_AC)
	m.paint(M.IRON, M.OWN, Color(0.35, 0.35, 0.35))
	m.box(Vector3(0.7, 0.04, 0.05), Vector3(1.3, 0.1, 0.5), false, true)


static func _awning(m: M, _o: Dictionary) -> void:
	# a deep tarp on two poles over the goods spread in front of the stall (Janpath)
	m.paint(M.CLOTH, M.ACCENT2, WHITE)
	m.both(Vector3(-1.5, 2.75, 0.45), Vector3(1.5, 2.75, 0.45), Vector3(1.5, 2.25, 2.2), Vector3(-1.5, 2.25, 2.2))
	m.paint(M.IRON, M.OWN, Color(0.35, 0.35, 0.35))
	m.bar(Vector3(-1.4, 0.0, 2.15), Vector3(-1.4, 2.27, 2.15), 0.045)
	m.bar(Vector3(1.4, 0.0, 2.15), Vector3(1.4, 2.27, 2.15), 0.045)
	# the low table of goods under it
	m.paint(M.WOOD, M.OWN, WHITE)
	m.box(Vector3(-1.2, 0.0, 0.7), Vector3(1.2, 0.72, 1.6), false, false)
	m.paint(M.CLOTH, M.ACCENT, WHITE)
	m.box(Vector3(-1.15, 0.72, 0.75), Vector3(1.15, 0.8, 1.55), false, false)


static func _vsign(m: M, _o: Dictionary) -> void:
	# a lodge's sign standing out from the wall above its door
	m.paint(M.ATLAS, M.OWN, WHITE)
	m.box(Vector3(1.22, 3.6, 0.15), Vector3(1.38, 6.2, 1.05), false, true)


static func _wall(m: M, _o: Dictionary) -> void:
	m.paint(M.RENDER, M.WALL, WHITE)
	m.box(Vector3(-1.5, 0.0, 0.0), Vector3(1.5, 1.8, 0.35), true, false)
	m.paint(M.STONE, M.OWN, Color(0.8, 0.66, 0.46))
	m.box(Vector3(-1.55, 1.8, -0.05), Vector3(1.55, 1.92, 0.4), true, true)


static func _gate_pier(m: M, _o: Dictionary) -> void:
	m.paint(M.STONE, M.OWN, Color(0.8, 0.66, 0.46))
	m.box(Vector3(-0.35, 0.0, -0.35), Vector3(0.35, 2.4, 0.35), true, false)
	m.box(Vector3(-0.45, 2.4, -0.45), Vector3(0.45, 2.6, 0.45), true, true)
