## The pieces the area kits add to some bays (P2-010, kit_modules.gd PIECES): sign boards (P2-048: painted, tilted,
## lamp lit, flex, glow, vertical, band, stacked, enamel, small, paper notices, wall lettering), outside stairs with their
## railings, roof tanks and roof railings, AC units, market awnings, lodge signs, and the Lutyens boundary wall and gate
## pier (not placed yet), and the Lutyens plot boundary that the bungalow ground floor modules carry. Same module frame
## and paint codes as kit_modules.gd.
extends RefCounted

const M := preload("res://world/kits/module_mesh.gd")
const A_AC := Rect2(0.0, 0.75, 0.25, 0.25)
const WHITE := Color(1, 1, 1)


## Sign boards (P2-048, harness/design/areas/signboards.md): the sign groups of the kit's sign atlas
## (tools/kits/make_signs.mjs GROUPS) and the flags the kit shader reads from a board quad's vertex colour.
const G_FASCIA := 0
const G_FLEX := 1
const G_GLOW := 2
const G_WALL := 3
const G_VERT := 4
const G_ENAMEL := 5
const G_SMALL := 6
const G_NOTICE := 7
## flags: white is the wall (key), a backlit glow face, lit by a bracket lamp at night, the lamp head itself
const F_KEY := 1
const F_GLOW := 2
const F_LIT := 4
const F_LAMP := 8
## lettering painted on a rolled-down shutter: the key shows the shutter (its ribbed layer and the bay accent)
const F_SHUTTER := 16
## a tube light: off-white by day, a cool white light at night
const F_TUBE := 32
const UV1 := Rect2(0, 0, 1, 1)
const STEEL := Color(0.16, 0.16, 0.17)


static func _sign(m: M, grp: int, slot := 0, flags := 0) -> void:
	m.paint(M.BOARD, M.OWN, Color(grp / 255.0, slot / 255.0, flags / 255.0))


## A board face in the wall plane from (x0, y0) to (x1, y1) at depth z, turned by `tilt` degrees about its middle
## (boards hang a little crooked), its lower right corner bent out by `bend` metres (a dented tin corner). UV 0..1, v down.
static func _face(m: M, x0: float, y0: float, x1: float, y1: float, z: float, tilt := 0.0, bend := 0.0) -> void:
	var c := Vector2((x0 + x1) * 0.5, (y0 + y1) * 0.5)
	var rot := func(x: float, y: float, dz: float) -> Vector3:
		var p := (Vector2(x, y) - c).rotated(deg_to_rad(tilt)) + c
		return Vector3(p.x, p.y, z + dz)
	var was := m.face
	m.face = true
	if bend <= 0.0:
		m.quad(rot.call(x0, y0, 0.0), rot.call(x1, y0, 0.0), rot.call(x1, y1, 0.0), rot.call(x0, y1, 0.0), PackedVector2Array([Vector2(0, 1), Vector2(1, 1), Vector2(1, 0), Vector2(0, 0)]))
	else:
		# two panels: the right fifth folds out along a slanted crease
		var xc := lerpf(x0, x1, 0.8)
		var uc := 0.8
		m.quad(rot.call(x0, y0, 0.0), rot.call(xc, y0, 0.0), rot.call(xc + 0.12, y1, 0.0), rot.call(x0, y1, 0.0), PackedVector2Array([Vector2(0, 1), Vector2(uc, 1), Vector2(uc + 0.12 / (x1 - x0), 0), Vector2(0, 0)]))
		m.quad(rot.call(xc, y0, 0.0), rot.call(x1, y0, bend), rot.call(x1, y1, bend * 0.2), rot.call(xc + 0.12, y1, 0.0), PackedVector2Array([Vector2(uc, 1), Vector2(1, 1), Vector2(1, 0), Vector2(uc + 0.12 / (x1 - x0), 0)]))
	m.face = was


## The painted tin or wooden board over a shop (fascia): on an angle iron frame screwed to the wall, two flat straps
## from the frame to the wall above it. `o`: tilt (degrees), bend (m), lamp (two bracket lamps over it, it is lit at night).
static func _board(m: M, kit: String, o := {}) -> void:
	var x0 := -1.34
	var x1 := 1.34
	var y0 := 2.66
	var y1 := 3.3
	var z := 0.36
	if kit == "colonnade":
		# Connaught Place: a neat painted fascia across the bay over the glass, no straps
		x0 = -1.2
		x1 = 1.2
		y0 = 2.46
		y1 = 3.0
		z = 0.12
	var tilt: float = o.get("tilt", 0.0)
	m.paint(M.IRON, M.OWN, STEEL)
	m.box(Vector3(x0 - 0.03, y0 + 0.02, z - 0.07), Vector3(x1 + 0.03, y1 - 0.02, z - 0.005), true, true)
	if kit != "colonnade":
		# the straps: from the frame back to the wall, so the board visibly hangs from it
		for x in [x0 + 0.3, x1 - 0.3]:
			m.box(Vector3(x - 0.025, y1 - 0.12, 0.05), Vector3(x + 0.025, y1 - 0.06, z - 0.06), false, true)
	var flags := 0
	if o.get("lamp", false):
		flags = F_LIT
		for x in [x0 + 0.55, x1 - 0.55]:
			_lamp(m, x, y1 + 0.32, 0.62)
	_sign(m, G_FASCIA, 0, flags)
	_face(m, x0, y0, x1, y1, z, tilt, float(o.get("bend", 0.0)))


## A bracket lamp: a curved arm from a wall plate out to a conical shade over the board; the bulb face under the
## shade lights at night (flag F_LAMP).
static func _lamp(m: M, x: float, y: float, reach: float) -> void:
	m.paint(M.IRON, M.OWN, STEEL)
	m.box(Vector3(x - 0.06, y - 0.08, 0.05), Vector3(x + 0.06, y + 0.08, 0.08), false, true)
	m.bar(Vector3(x, y, 0.08), Vector3(x, y, reach), 0.03)
	m.bar(Vector3(x, y - 0.12, 0.08), Vector3(x, y, 0.3), 0.02)
	# the shade: a short square cone, open at the bottom
	var c := Vector3(x, y - 0.05, reach)
	var r0 := 0.05
	var r1 := 0.13
	var h := 0.14
	var top := [Vector3(c.x - r0, c.y, c.z - r0), Vector3(c.x + r0, c.y, c.z - r0), Vector3(c.x + r0, c.y, c.z + r0), Vector3(c.x - r0, c.y, c.z + r0)]
	var bot := [Vector3(c.x - r1, c.y - h, c.z - r1), Vector3(c.x + r1, c.y - h, c.z - r1), Vector3(c.x + r1, c.y - h, c.z + r1), Vector3(c.x - r1, c.y - h, c.z + r1)]
	for i in 4:
		var j := (i + 1) % 4
		m.quad(bot[j], bot[i], top[i], top[j])
	m.quad(top[0], top[3], top[2], top[1])
	_sign(m, 0, 0, F_LAMP)
	var b := c.y - h + 0.005
	m.quad(Vector3(c.x - r1 * 0.8, b, c.z - r1 * 0.8), Vector3(c.x + r1 * 0.8, b, c.z - r1 * 0.8), Vector3(c.x + r1 * 0.8, b, c.z + r1 * 0.8), Vector3(c.x - r1 * 0.8, b, c.z + r1 * 0.8))


## A printed flex banner stretched on a steel pipe frame over the shop, taller than a painted board (GB Road machine
## parts shops): the frame stands on two struts from the wall.
static func _flex(m: M, _kit: String, _o := {}) -> void:
	var x0 := -1.36
	var x1 := 1.36
	var y0 := 2.62
	var y1 := 3.64
	var z := 0.4
	m.paint(M.IRON, M.OWN, STEEL)
	m.bar(Vector3(x0, y0, z - 0.03), Vector3(x1, y0, z - 0.03), 0.04)
	m.bar(Vector3(x0, y1, z - 0.03), Vector3(x1, y1, z - 0.03), 0.04)
	m.bar(Vector3(x0, y0, z - 0.03), Vector3(x0, y1, z - 0.03), 0.04)
	m.bar(Vector3(x1, y0, z - 0.03), Vector3(x1, y1, z - 0.03), 0.04)
	for x in [x0 + 0.4, x1 - 0.4]:
		m.bar(Vector3(x, y0 + 0.1, 0.06), Vector3(x, y0 + 0.1, z - 0.04), 0.04)
		m.bar(Vector3(x, y1 - 0.15, 0.06), Vector3(x, y1 - 0.15, z - 0.04), 0.04)
	# two tube lights on short arms along the top light the banner at night (GB Road night photo O-gb_road/03)
	for x in [x0 + 0.65, x1 - 0.65]:
		m.paint(M.IRON, M.OWN, STEEL)
		m.bar(Vector3(x, y1 + 0.04, z - 0.03), Vector3(x, y1 + 0.04, z + 0.2), 0.025)
		_sign(m, 0, 0, F_LAMP)
		m.box(Vector3(x - 0.3, y1 + 0.01, z + 0.18), Vector3(x + 0.3, y1 + 0.05, z + 0.23), false, true)
	_sign(m, G_FLEX, 0, F_LIT)
	# (the lower right corner has come off its tie and curls out)
	_face(m, x0 + 0.02, y0 + 0.02, x1 - 0.02, y1 - 0.02, z, 0.0, 0.07)


## An acrylic glow box over the shop: an aluminium box with a printed face lit from inside at night.
static func _glow(m: M, kit: String, _o := {}) -> void:
	var x0 := -1.32
	var x1 := 1.32
	var y0 := 2.66
	var y1 := 3.28
	var z0 := 0.2
	var z1 := 0.4
	if kit == "colonnade":
		# Connaught Place showrooms: a big lit fascia box across the whole bay over the glass, under the walk's
		# ceiling (photos #15 2025-08-14, #16 2024-03-04)
		x0 = -1.24
		x1 = 1.24
		y0 = 2.44
		y1 = 3.02
		z0 = 0.06
		z1 = 0.24
	m.paint(M.IRON, M.OWN, Color(0.55, 0.56, 0.57))
	m.box(Vector3(x0, y0, z0), Vector3(x1, y1, z1 - 0.003), true, true)
	_sign(m, G_GLOW, 0, F_GLOW)
	_face(m, x0 + 0.02, y0 + 0.02, x1 - 0.02, y1 - 0.02, z1)


## A tall board standing out from the wall at the bay's right edge on two brackets, both faces painted (or lit: the
## even cells of the vertical group are glow boxes, make_signs.mjs), readable from both ways down the street.
static func _vboard(m: M, y0: float, y1: float, x: float, z0: float, z1: float) -> void:
	m.paint(M.IRON, M.OWN, STEEL)
	for y in [y0 + 0.15, y1 - 0.15]:
		m.bar(Vector3(x, y, 0.05), Vector3(x, y, z0 + 0.02), 0.04)
	m.box(Vector3(x - 0.025, y0, z0), Vector3(x + 0.025, y1, z1), false, true)
	_sign(m, G_VERT, 0, F_GLOW)
	var was := m.face
	m.face = true
	# the face towards +x reads with z running left to right seen from +x: left is z1 (out), right z0
	m.quad(Vector3(x + 0.027, y0, z1), Vector3(x + 0.027, y0, z0), Vector3(x + 0.027, y1, z0), Vector3(x + 0.027, y1, z1), PackedVector2Array([Vector2(0, 1), Vector2(1, 1), Vector2(1, 0), Vector2(0, 0)]))
	m.quad(Vector3(x - 0.027, y0, z0), Vector3(x - 0.027, y0, z1), Vector3(x - 0.027, y1, z1), Vector3(x - 0.027, y1, z0), PackedVector2Array([Vector2(0, 1), Vector2(1, 1), Vector2(1, 0), Vector2(0, 0)]))
	m.face = was


## A board in the band under an upper floor window (left of the AC unit's place).
static func _band(m: M, _o := {}) -> void:
	m.paint(M.IRON, M.OWN, STEEL)
	m.box(Vector3(-1.38, 0.13, 0.05), Vector3(0.56, 0.59, 0.2), false, true)
	_sign(m, G_FASCIA, 1)
	_face(m, -1.38, 0.12, 0.56, 0.6, 0.205, -1.1)


## Boards stacked up a blank upper wall (Paharganj, GB Road): a flex banner and a painted board above it.
static func _stack(m: M, _o := {}) -> void:
	m.paint(M.IRON, M.OWN, STEEL)
	m.box(Vector3(-1.4, 0.26, 0.05), Vector3(1.0, 1.24, 0.17), false, true)
	m.box(Vector3(-1.32, 1.46, 0.05), Vector3(0.92, 2.04, 0.15), false, true)
	_sign(m, G_FLEX, 2)
	_face(m, -1.4, 0.25, 1.0, 1.25, 0.175)
	_sign(m, G_FASCIA, 2)
	_face(m, -1.32, 1.45, 0.92, 2.05, 0.155, 1.6, 0.06)


## A round enamel board on the wall right of a door, on a thin rim, screwed through top and bottom.
static func _enamel(m: M, _o := {}) -> void:
	var c := Vector2(1.1, 2.05)
	var r := 0.27
	var z := 0.075
	var n := 20
	# the cell's disc reaches 0.469 of the cell from its middle
	var ur := 0.469
	m.paint(M.IRON, M.OWN, Color(0.25, 0.25, 0.27))
	for i in n:
		var a0 := TAU * float(i) / n
		var a1 := TAU * float(i + 1) / n
		var p0 := Vector3(c.x + cos(a0) * r, c.y + sin(a0) * r, 0.05)
		var p1 := Vector3(c.x + cos(a1) * r, c.y + sin(a1) * r, 0.05)
		m.quad(p0, p1, Vector3(p1.x, p1.y, z), Vector3(p0.x, p0.y, z))
	_sign(m, G_ENAMEL, 0, F_KEY)
	var was := m.face
	m.face = true
	for i in n:
		var a0 := TAU * float(i) / n
		var a1 := TAU * float(i + 1) / n
		var p0 := Vector3(c.x + cos(a0) * r, c.y + sin(a0) * r, z)
		var p1 := Vector3(c.x + cos(a1) * r, c.y + sin(a1) * r, z)
		var q0 := Vector2(0.5 + cos(a0) * ur, 0.5 - sin(a0) * ur)
		var q1 := Vector2(0.5 + cos(a1) * ur, 0.5 - sin(a1) * ur)
		m.quad(Vector3(c.x, c.y, z), p0, p1, Vector3(c.x, c.y, z), PackedVector2Array([Vector2(0.5, 0.5), q0, q1, Vector2(0.5, 0.5)]))
	m.face = was


## A small painted board left of a door (tailors, repairs, clinics), screwed flat to the wall.
static func _small(m: M, _o := {}) -> void:
	m.paint(M.IRON, M.OWN, STEEL)
	m.box(Vector3(-1.41, 1.76, 0.05), Vector3(-0.83, 2.04, 0.07), false, true)
	_sign(m, G_SMALL)
	_face(m, -1.42, 1.75, -0.82, 2.05, 0.072, -2.4, 0.03)


## Paper notices pasted on the wall at eye height (white is the wall).
static func _notice(m: M, _o := {}) -> void:
	_sign(m, G_NOTICE, 0, F_KEY)
	m.front(-1.42, 1.4, -0.78, 1.72, M.SKIN + 0.006, UV1)
	# a second cluster lower on the other side of the bay (notices gather in layers, photo #7)
	_sign(m, G_NOTICE, 1, F_KEY)
	m.front(0.8, 1.05, 1.44, 1.37, M.SKIN + 0.007, UV1)


## Lettering painted straight on a plain bay's wall below its window, at eye height (white is the wall).
static func _wallsign(m: M, _o := {}) -> void:
	_sign(m, G_WALL, 0, F_KEY)
	var was := m.face
	m.face = true
	m.front(-1.2, 0.7, 1.2, 1.3, M.SKIN + 0.004, UV1)
	m.face = was


## A small board standing out from the bay's right edge on a bracket, both faces painted, read from down the street
## (projecting shop signs, photos #1, #6): above head height, under the awning.
static func _blade(m: M, _o := {}) -> void:
	var x := 1.43
	var y0 := 2.0
	var y1 := 2.36
	var z0 := 0.14
	var z1 := 0.86
	m.paint(M.IRON, M.OWN, STEEL)
	m.bar(Vector3(x, y1 + 0.05, 0.05), Vector3(x, y1 + 0.05, z1 + 0.03), 0.03)
	m.bar(Vector3(x, y0 + 0.08, 0.05), Vector3(x, y0 + 0.08, z0 + 0.01), 0.03)
	for z in [z0 + 0.08, z1 - 0.08]:
		m.bar(Vector3(x, y1 + 0.03, z), Vector3(x, y1 + 0.005, z), 0.012)
	m.box(Vector3(x - 0.02, y0, z0), Vector3(x + 0.02, y1, z1), false, true)
	_sign(m, G_SMALL, 3)
	var was := m.face
	m.face = true
	m.quad(Vector3(x + 0.022, y0, z1), Vector3(x + 0.022, y0, z0), Vector3(x + 0.022, y1, z0), Vector3(x + 0.022, y1, z1), PackedVector2Array([Vector2(0, 1), Vector2(1, 1), Vector2(1, 0), Vector2(0, 0)]))
	m.quad(Vector3(x - 0.022, y0, z0), Vector3(x - 0.022, y0, z1), Vector3(x - 0.022, y1, z1), Vector3(x - 0.022, y1, z0), PackedVector2Array([Vector2(0, 1), Vector2(1, 1), Vector2(1, 0), Vector2(0, 0)]))
	m.face = was


## Boards up an upper floor (Paharganj, GB Road, old city stacks, photos #1, #6, O-gb_road/02): two small boards one
## over the other on the wall left of the window, and a board over the window under the floor above (a lit box in the
## hotel kit: guest houses light their name on every floor).
static func _upboards(m: M, kit: String, _o := {}) -> void:
	m.paint(M.IRON, M.OWN, STEEL)
	m.box(Vector3(-1.43, 1.53, 0.05), Vector3(-0.83, 1.83, 0.07), false, true)
	m.box(Vector3(-1.43, 1.98, 0.05), Vector3(-0.83, 2.28, 0.07), false, true)
	_sign(m, G_SMALL, 1)
	_face(m, -1.44, 1.52, -0.82, 1.84, 0.072, 2.6, 0.03)
	_sign(m, G_SMALL, 2)
	_face(m, -1.44, 1.97, -0.82, 2.29, 0.072, -1.5)
	if kit == "hotel":
		m.paint(M.IRON, M.OWN, Color(0.55, 0.56, 0.57))
		m.box(Vector3(-1.0, 2.66, 0.05), Vector3(1.0, 3.07, 0.2), false, true)
		_sign(m, G_GLOW, 1, F_GLOW)
		_face(m, -0.98, 2.68, 0.98, 3.05, 0.203)
	else:
		m.box(Vector3(-0.96, 2.68, 0.05), Vector3(0.96, 3.06, 0.08), false, true)
		_sign(m, G_FASCIA, 3)
		_face(m, -0.98, 2.66, 0.98, 3.08, 0.085, 1.3, 0.05)


## A printed flex sheet on a pipe frame over the lower part of an upper window, clear of the ground floor boards below (GB Road machine shops advertise on every
## floor, O-gb_road/02): the frame stands off the wall on struts in front of the grille.
static func _upflex(m: M, _o := {}) -> void:
	var x0 := -1.42
	var x1 := 1.3
	var y0 := 0.46
	var y1 := 1.4
	var z := 0.34
	m.paint(M.IRON, M.OWN, STEEL)
	m.bar(Vector3(x0, y0, z - 0.03), Vector3(x1, y0, z - 0.03), 0.035)
	m.bar(Vector3(x0, y1, z - 0.03), Vector3(x1, y1, z - 0.03), 0.035)
	m.bar(Vector3(x0, y0, z - 0.03), Vector3(x0, y1, z - 0.03), 0.035)
	m.bar(Vector3(x1, y0, z - 0.03), Vector3(x1, y1, z - 0.03), 0.035)
	for x in [x0 + 0.15, x1 - 0.15]:
		m.bar(Vector3(x, y0 + 0.1, 0.06), Vector3(x, y0 + 0.1, z - 0.04), 0.035)
		m.bar(Vector3(x, y1 - 0.1, 0.06), Vector3(x, y1 - 0.1, z - 0.04), 0.035)
	_sign(m, G_FLEX, 1)
	_face(m, x0 + 0.02, y0 + 0.02, x1 - 0.02, y1 - 0.02, z)


## Lettering painted on the part of the shutter left down (old city galis, O-signboards/03 "जोबट" shutter): a quad just
## in front of the shutter, keyed to the shutter itself in the kit shader (F_SHUTTER), so it reads as paint on the ribs.
## `w` and `down` come from the kit's shop recipe (kit_modules.gd), so it covers that shutter exactly.
static func shutpaint(m: M, w: float, down: float) -> void:
	var top := 2.55
	var y1 := top - 0.22
	# the lettering band keeps the cell's 4:1 shape at the foot of the part left down (the rest stays plain shutter)
	var y0 := y1 - minf(top * down, (w * 2.0 - 0.04) / 3.6)
	_sign(m, G_WALL, 1, F_SHUTTER)
	var was := m.face
	m.face = true
	m.front(-w + 0.02, y0, w - 0.02, y1, 0.304, UV1)
	m.face = was


## Cable bundles across the shop fronts (old city, GB Road, Paharganj: photos #6, #7, O-gb_road/02): four or five
## wires sagging between two wall brackets at the bay's edges, in front of the boards, each bracket on a junction box,
## so no wire ends in the air (WORLD_LOGIC 2). Neighbouring bays continue the run; GB Road and the galis carry ten.
static func _cables(m: M, kit := "", _o := {}) -> void:
	var xe := 1.47
	var yb := 3.52
	var zb := 0.8
	m.paint(M.IRON, M.OWN, Color(0.2, 0.2, 0.21))
	for x in [-xe, xe]:
		m.box(Vector3(x - 0.07, yb - 0.1, 0.05), Vector3(x + 0.07, yb + 0.08, 0.13), false, true)
		m.bar(Vector3(x, yb, 0.13), Vector3(x, yb, zb + 0.08), 0.022)
	m.paint(M.IRON, M.OWN, Color(0.05, 0.05, 0.055))
	var wires := [[0.0, 0.22, 0.0], [0.05, 0.34, 0.04], [-0.04, 0.27, 0.08], [0.02, 0.48, -0.04], [-0.02, 0.4, 0.11]]
	if kit == "hardware" or kit == "gali":
		# a thick band of cables across the first floor (GB Road street view Oct 2025, old city galis)
		wires.append_array([[0.03, 0.3, 0.02], [-0.03, 0.36, 0.06], [0.06, 0.25, -0.02]])
	# (fix round 3 perf: four spans a wire and one under face, seen from the street below; was six spans, two faces)
	var n := 4
	var was := m.fine
	m.fine = true
	for wd: Array in wires:
		var y0: float = yb + float(wd[0])
		var sag: float = wd[1]
		var z: float = zb + float(wd[2])
		var h := 0.016
		for i in n:
			var xa := lerpf(-xe, xe, float(i) / n)
			var xb := lerpf(-xe, xe, float(i + 1) / n)
			var ya := y0 - sag * (1.0 - pow(xa / xe, 2.0))
			var yb2 := y0 - sag * (1.0 - pow(xb / xe, 2.0))
			m.quad(Vector3(xa, ya - h, z), Vector3(xb, yb2 - h, z), Vector3(xb, yb2 + h, z), Vector3(xa, ya + h, z))
			m.quad(Vector3(xa, ya - h, z + h), Vector3(xb, yb2 - h, z + h), Vector3(xb, yb2 - h, z - h), Vector3(xa, ya - h, z - h))
	m.fine = was


## Boards on a plain ground floor bay (fix round 3: the galis and Paharganj are wall to wall boards, owner photos #6
## and #7): a painted board over the small window, a small board each side of it and a flex sheet low on the wall, all
## screwed to the wall on thin frames, hung a little crooked. The bay's wall lettering and notices sit between them.
static func _wallboards(m: M, _kit: String) -> void:
	m.paint(M.IRON, M.OWN, STEEL)
	m.box(Vector3(-1.3, 2.64, 0.05), Vector3(1.2, 3.08, 0.085), false, true)
	m.box(Vector3(-1.4, 1.93, 0.05), Vector3(-0.6, 2.33, 0.075), false, true)
	m.box(Vector3(0.58, 1.86, 0.05), Vector3(1.26, 2.2, 0.075), false, true)
	m.box(Vector3(-1.36, 1.36, 0.05), Vector3(-0.05, 1.84, 0.08), false, true)
	_sign(m, G_FASCIA, 4)
	_face(m, -1.31, 2.63, 1.21, 3.09, 0.09, -1.4, 0.05)
	_sign(m, G_SMALL, 4)
	_face(m, -1.41, 1.92, -0.59, 2.34, 0.08, 2.2)
	_sign(m, G_SMALL, 5)
	_face(m, 0.57, 1.85, 1.27, 2.21, 0.08, -3.0, 0.03)
	_sign(m, G_FLEX, 3)
	_face(m, -1.37, 1.35, -0.04, 1.85, 0.085, 0.8)


## A name board over a door or a gate (the clinic, lodge or workshop inside), on a frame over the lintel.
static func _overboard(m: M, _kit: String) -> void:
	m.paint(M.IRON, M.OWN, STEEL)
	m.box(Vector3(-0.66, 2.77, 0.05), Vector3(0.66, 3.09, 0.09), false, true)
	_sign(m, G_FASCIA, 5)
	_face(m, -0.67, 2.76, 0.67, 3.1, 0.095, 1.5, 0.03)


## A bulkhead lamp over a door, fixed under the lintel (its top at `y`, the soffit of the opening): a small hooded
## fitting whose bulb face lights at night (it lights the door under it: the kit shader lights door leaves at night).
static func bulkhead(m: M, y: float) -> void:
	m.paint(M.IRON, M.OWN, STEEL)
	m.box(Vector3(-0.09, y - 0.13, 0.03), Vector3(0.09, y, 0.2), false, true)
	_sign(m, 0, 0, F_LAMP)
	m.quad(Vector3(-0.08, y - 0.132, 0.04), Vector3(0.08, y - 0.132, 0.04), Vector3(0.08, y - 0.132, 0.2), Vector3(-0.08, y - 0.132, 0.2))
	m.front(-0.08, y - 0.11, 0.08, y - 0.03, 0.202)


## A shop's tube light, upright on a door jamb as Delhi shops fix them: a batten on the reveal's side face at x, the
## tube on it facing into the opening (`dir` +1 on the left jamb, -1 on the right). F_TUBE: cool white at night.
static func tube(m: M, x: float, y0: float, y1: float, z: float, dir: float) -> void:
	m.paint(M.IRON, M.OWN, Color(0.8, 0.8, 0.78))
	var xa := x
	var xb := x + dir * 0.03
	m.box(Vector3(minf(xa, xb), y0 - 0.04, z - 0.03), Vector3(maxf(xa, xb), y1 + 0.04, z + 0.03), false, true)
	_sign(m, 0, 0, F_TUBE)
	var xc := x + dir * 0.065
	m.box(Vector3(minf(xb, xc), y0, z - 0.018), Vector3(maxf(xb, xc), y1, z + 0.018), false, true)


## The light a lit board throws round it at night (WORLD_LOGIC.md: a shop sign glows on the pavement under it), drawn
## additive by sign_pool.gdshader: `ground` [half width, reach] a flat quad just over the street level in front of the
## bay (UV x across, y out), `wall` [x0, y0, x1, y1] a quad just off the wall round the board (the soft spill on the wall,
## the awning and the boards near it). Either may be empty.
static func pool(m: M, ground: Array, wall: Array) -> void:
	m.paint(M.BOARD, M.OWN, WHITE)
	if ground.size() == 2:
		var width: float = ground[0]
		var reach: float = ground[1]
		m.quad(Vector3(-width, 0.03, 0.45), Vector3(-width, 0.03, reach), Vector3(width, 0.03, reach), Vector3(width, 0.03, 0.45), PackedVector2Array([Vector2(0, 0), Vector2(0, 1), Vector2(1, 1), Vector2(1, 0)]))
	if wall.size() == 4:
		m.front(wall[0], wall[1], wall[2], wall[3], 0.065, Rect2(0, 0, 1, 1))


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
	# a lodge's tall sign standing out from the wall above its door (P2-048: the vertical sign group)
	_vboard(m, 3.5, 5.9, 1.32, 0.2, 0.8)


static func _wall(m: M, _o: Dictionary) -> void:
	m.paint(M.RENDER, M.WALL, WHITE)
	m.box(Vector3(-1.5, 0.0, 0.0), Vector3(1.5, 1.8, 0.35), true, false)
	m.paint(M.STONE, M.OWN, Color(0.8, 0.66, 0.46))
	m.box(Vector3(-1.55, 1.8, -0.05), Vector3(1.55, 1.92, 0.4), true, true)


static func _gate_pier(m: M, _o: Dictionary) -> void:
	m.paint(M.STONE, M.OWN, Color(0.8, 0.66, 0.46))
	m.box(Vector3(-0.35, 0.0, -0.35), Vector3(0.35, 2.4, 0.35), true, false)
	m.box(Vector3(-0.45, 2.4, -0.45), Vector3(0.45, 2.6, 0.45), true, true)


## The front boundary of a bungalow plot, FENCE_Z in front of the wall: a low rendered wall (the wall colour) with a
## stone coping and a dark green iron railing on top, a pier at the bay's left edge (the next bay's pier closes the
## right), and with `gate` a pair of iron gate leaves between two taller piers. Reaches below the floor so a sloping
## plot shows no gap.
const FENCE_Z := 2.4
const FENCE_GREEN := Color(0.16, 0.25, 0.19)


static func _fence(m: M, gate: bool) -> void:
	var z := FENCE_Z
	var spans := [[-1.2, 1.5]] if not gate else [[-1.2, -1.02], [1.02, 1.5]]
	m.paint(M.RENDER, M.WALL, Color(0.92, 0.92, 0.92))
	for sp: Array in spans:
		m.box(Vector3(sp[0], -0.4, z - 0.12), Vector3(sp[1], 0.6, z + 0.12), true, false)
	# piers: the bay's left edge, and the two gate piers
	var piers := [[-1.5, -1.2, 1.5]]
	if gate:
		piers.append([-1.02, -0.78, 1.75])
		piers.append([0.78, 1.02, 1.75])
	for pr: Array in piers:
		m.paint(M.RENDER, M.WALL, Color(0.92, 0.92, 0.92))
		m.box(Vector3(pr[0], -0.4, z - 0.17), Vector3(pr[1], pr[2], z + 0.17), true, false)
		m.paint(M.STONE, M.OWN, Color(0.74, 0.7, 0.62))
		m.box(Vector3(pr[0] - 0.03, pr[2], z - 0.2), Vector3(pr[1] + 0.03, pr[2] + 0.08, z + 0.2), true, true)
	m.paint(M.STONE, M.OWN, Color(0.74, 0.7, 0.62))
	for sp: Array in spans:
		m.box(Vector3(sp[0], 0.6, z - 0.15), Vector3(sp[1], 0.66, z + 0.15), true, true)
	# the railing on the wall: top and middle rails, bars every 12 cm, spear tips
	m.paint(M.IRON, M.OWN, FENCE_GREEN)
	for sp: Array in spans:
		m.bar(Vector3(sp[0], 1.38, z), Vector3(sp[1], 1.38, z), 0.035)
		m.bar(Vector3(sp[0], 0.74, z), Vector3(sp[1], 0.74, z), 0.03)
		m.fine = true
		var x: float = sp[0] + 0.06
		while x < sp[1] - 0.02:
			m.quad(Vector3(x - 0.011, 0.66, z), Vector3(x + 0.011, 0.66, z), Vector3(x + 0.011, 1.46, z), Vector3(x - 0.011, 1.46, z))
			m.quad(Vector3(x + 0.011, 0.66, z), Vector3(x - 0.011, 0.66, z), Vector3(x - 0.011, 1.46, z), Vector3(x + 0.011, 1.46, z))
			x += 0.12
		m.fine = false
	if gate:
		# two gate leaves: frame, rails and bars, standing on the drive
		m.bar(Vector3(-0.78, 1.5, z), Vector3(0.78, 1.5, z), 0.04)
		m.bar(Vector3(-0.78, 0.08, z), Vector3(0.78, 0.08, z), 0.04)
		m.bar(Vector3(-0.78, 0.8, z), Vector3(0.78, 0.8, z), 0.03)
		m.bar(Vector3(0.0, 0.05, z), Vector3(0.0, 1.55, z), 0.04)
		m.fine = true
		var gx := -0.7
		while gx < 0.75:
			m.quad(Vector3(gx - 0.012, 0.08, z), Vector3(gx + 0.012, 0.08, z), Vector3(gx + 0.012, 1.62, z), Vector3(gx - 0.012, 1.62, z))
			m.quad(Vector3(gx + 0.012, 0.08, z), Vector3(gx - 0.012, 0.08, z), Vector3(gx - 0.012, 1.62, z), Vector3(gx + 0.012, 1.62, z))
			gx += 0.11
		m.fine = false
