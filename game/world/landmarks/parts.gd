## The landmark parts kit (P2-007, DELHI_WORLD.md section 10 step 6, HM3): domes, chhatris, arches, colonnades,
## minarets, shikharas and slabs, built into a KitMesh (kit_mesh.gd) in its current frame. Every part takes `lod`
## (0 full detail, 1 and 2 the lower levels, 3 the far silhouette) and keeps the same outline at every level, so a
## level change shows no jump in shape: only the small detail goes. Colours are the palette of STYLE_BIBLE.md.
## Pure geometry, safe on a worker thread.
extends RefCounted

const KitMesh := preload("res://world/landmarks/kit_mesh.gd")

const RED := Color("#a4533b") # red sandstone
const RED_DARK := Color("#7e3c2a")
const RED_LIGHT := Color("#b8654a")
const BUFF := Color("#c9a77c") # buff stone (India Gate)
const BUFF_LIGHT := Color("#d8bb92")
const BUFF_DARK := Color("#a98a62")
const MARBLE := Color("#ece6d8")
const MARBLE_SHADE := Color("#d6cfbf")
const BLACK_MARBLE := Color("#2c2a28")
const PLASTER := Color("#e8e3d5")
const WHITE := Color("#f2f0ea")
const GLASS := Color("#3d4f5a")
const SHADOW := Color("#4a3a32") # the dark of an opening or a deep recess
const BRASS := Color("#b8913a")
const GRANITE := Color("#3a3836")


## Sides of a round part at a level: full, half, a third, and the far silhouette's least.
static func seg(lod: int, full: int) -> int:
	match lod:
		0:
			return full
		1:
			return maxi(8, full / 2)
		2:
			return maxi(6, full / 3)
	return 6


## A Mughal bulbous dome standing on c: radius r at its widest, height h to the base of the finial, a neck at the
## bottom. `finial` adds the kalash and spike (brass or the dome colour).
static func onion_dome(m: KitMesh, c: Vector3, r: float, h: float, lod: int, col: Color, finial := BRASS) -> void:
	var prof := PackedVector2Array([Vector2(r * 0.84, 0.0), Vector2(r * 0.95, h * 0.1), Vector2(r, h * 0.27), Vector2(r * 0.96, h * 0.45),
		Vector2(r * 0.82, h * 0.62), Vector2(r * 0.58, h * 0.78), Vector2(r * 0.3, h * 0.9), Vector2(r * 0.1, h * 0.97), Vector2(0.0, h)])
	if lod >= 2:
		prof = PackedVector2Array([Vector2(r * 0.84, 0.0), Vector2(r, h * 0.27), Vector2(r * 0.82, h * 0.62), Vector2(r * 0.3, h * 0.9), Vector2(0.0, h)])
	m.lathe(prof, seg(lod, 24), c, col)
	if lod <= 2:
		kalash(m, c + Vector3(0, h - 0.02 * h, 0), maxf(0.6, r * 0.32), lod, finial)


## A shallow dome (a bowl or a low saucer dome) on c: radius r, rise h.
static func shallow_dome(m: KitMesh, c: Vector3, r: float, h: float, lod: int, col: Color) -> void:
	var prof := PackedVector2Array()
	var n := 6 if lod <= 1 else 3
	for k in n + 1:
		var a := PI * 0.5 * k / n
		prof.append(Vector2(r * cos(a), h * sin(a)))
	m.lathe(prof, seg(lod, 28), c, col)


## The finial on a dome: a stack of bulbs and a spike, height about 2.6 times `size`.
static func kalash(m: KitMesh, c: Vector3, size: float, lod: int, col: Color) -> void:
	var s := size
	if lod >= 2:
		m.lathe(PackedVector2Array([Vector2(s * 0.35, 0), Vector2(s * 0.3, s * 1.2), Vector2(0, s * 2.6)]), 6, c, col)
		return
	m.lathe(PackedVector2Array([Vector2(s * 0.3, 0), Vector2(s * 0.42, s * 0.25), Vector2(s * 0.2, s * 0.5), Vector2(s * 0.36, s * 0.8),
		Vector2(s * 0.38, s * 1.0), Vector2(s * 0.16, s * 1.25), Vector2(s * 0.12, s * 1.6), Vector2(s * 0.04, s * 2.2), Vector2(0, s * 2.6)]), seg(lod, 12), c, col)


## A chhatri (domed kiosk) standing on c: radius r (of its eave), total height h. `pillars` round its base (4, 6 or 8),
## a chhajja eave, a drum and an onion dome (or a hemispherical one when `onion` is false).
static func chhatri(m: KitMesh, c: Vector3, r: float, h: float, lod: int, body: Color, dome: Color, pillars := 8, onion := true) -> void:
	var plat := h * 0.08
	var post := h * 0.42
	var eave := h * 0.08
	var phase := PI / pillars
	m.ngon(c, r * 0.95, pillars, 0.0, plat, body, phase)
	if lod >= 3:
		m.ngon(c, r * 0.8, pillars, plat, plat + post, body, phase)
	elif lod == 2:
		m.ngon(c, r * 0.72, pillars, plat, plat + post, SHADOW.lerp(body, 0.35), phase)
	else:
		# the pillars round an open middle
		for k in pillars:
			var a := phase + TAU * k / pillars
			var pc := c + Vector3(cos(a) * r * 0.74, plat, sin(a) * r * 0.74)
			if lod == 0:
				m.cyl(pc, r * 0.075, post, 8, body)
			else:
				m.box(pc + Vector3(0, post * 0.5, 0), Vector3(r * 0.15, post, r * 0.15), body)
		m.ngon(c, r * 0.5, pillars, plat, plat + post * 0.15, body, phase)
	# the chhajja: a sloped eave wider than the kiosk
	var y := plat + post
	m.lathe(PackedVector2Array([Vector2(r * 0.8, y), Vector2(r * 1.12, y - eave * 0.6), Vector2(r * 1.12, y - eave * 0.6), Vector2(r * 0.95, y + eave * 0.5), Vector2(r * 0.95, y + eave * 0.5), Vector2(r * 0.6, y + eave * 0.5)]),
		pillars if lod >= 2 else pillars * 2, c, body, PackedColorArray(), phase)
	y += eave * 0.5
	var drum := h * 0.08
	m.cyl(c + Vector3(0, y, 0), r * 0.62, drum, seg(lod, 16), body, 1.0, false)
	y += drum
	if onion:
		onion_dome(m, c + Vector3(0, y, 0), r * 0.72, h - y - h * 0.12, lod, dome)
	else:
		shallow_dome(m, c + Vector3(0, y, 0), r * 0.68, (h - y) * 0.75, lod, dome)
		if lod <= 2:
			kalash(m, c + Vector3(0, y + (h - y) * 0.72, 0), r * 0.18, lod, BRASS)


## The outline (x right, y up) of a Mughal pointed arch opening `w` wide whose sides rise straight to `spring`, then
## two arcs meet at the apex; `rise` is the apex above the springing line.
static func pointed_arch(w: float, spring: float, rise: float, n := 8) -> PackedVector2Array:
	var hw := w * 0.5
	# a circle through (-hw, spring) with its centre on the springing line that passes x = 0 at height spring + rise
	var cx := (rise * rise - hw * hw) / (2.0 * hw) # centre to the right of the left side by hw + cx
	var R := hw + cx
	var out := PackedVector2Array([Vector2(-hw, 0.0)])
	var a_top := acos(clampf(cx / R, -1.0, 1.0))
	for k in n + 1:
		var a := PI - (PI - a_top) * k / n
		out.append(Vector2(cx + R * cos(a), spring + R * sin(a)))
	for k in range(n - 1, -1, -1):
		var a := PI - (PI - a_top) * k / n
		out.append(Vector2(-(cx + R * cos(a)), spring + R * sin(a)))
	out.append(Vector2(hw, 0.0))
	# the apex point appears twice (end of the left arc, start of the right one): drop the copy
	var clean := PackedVector2Array()
	for p in out:
		if clean.is_empty() or clean[clean.size() - 1].distance_to(p) > 1e-4:
			clean.append(p)
	return clean


## A round headed opening outline: straight sides to `spring`, a half circle over.
static func round_arch(w: float, spring: float, n := 12) -> PackedVector2Array:
	var hw := w * 0.5
	var out := PackedVector2Array([Vector2(-hw, 0.0)])
	for k in n + 1:
		var a := PI - PI * k / n
		out.append(Vector2(cos(a) * hw, spring + sin(a) * hw))
	out.append(Vector2(hw, 0.0))
	return out


## A wall panel w wide and h tall (x from -w/2, y from 0) with an opening outline cut from its bottom edge: one
## simple outline (the opening must touch y = 0 at both its ends).
static func wall_with_opening(w: float, h: float, opening: PackedVector2Array) -> PackedVector2Array:
	var out := PackedVector2Array([Vector2(-w * 0.5, 0.0)])
	out.append_array(opening)
	out.append_array([Vector2(w * 0.5, 0.0), Vector2(w * 0.5, h), Vector2(-w * 0.5, h)])
	return out


## A blind arch on a wall face: the frame band and the recessed field, drawn just in front of the face (the frame
## proud by `proud`). Local frame: x along the face, y up, the face at z = 0 and its outside towards -z.
static func blind_arch(m: KitMesh, x: float, y: float, w: float, spring: float, rise: float, lod: int, frame: Color, field: Color, proud := 0.08) -> void:
	if lod >= 2:
		return
	var n := 4 if lod == 0 else 3
	var inner := pointed_arch(w, spring, rise, n)
	m.push(Transform3D(Basis.IDENTITY, Vector3(x, y, -0.02)))
	m.face(inner, field)
	m.pop()
	if lod == 0:
		var band := 0.16 * w
		var outer := pointed_arch(w + band * 2.0, spring, rise + band * 1.2, n)
		var ring := PackedVector2Array(outer)
		for k in range(inner.size() - 1, -1, -1):
			ring.append(inner[k])
		# the frame: the outer arch outline back along the inner one (a horseshoe band), proud of the face
		m.push(Transform3D(Basis.IDENTITY, Vector3(x, y, -proud)))
		m.face(ring, frame)
		m.pop()


## Merlons (kanguras) along the top of a wall from a to b (wall-top points, local frame), each `w` wide, `h` tall,
## `t` thick, with a pointed top at full detail. `out` is the unit outward normal of the wall face.
static func merlons(m: KitMesh, a: Vector3, b: Vector3, out: Vector3, w: float, h: float, t: float, lod: int, col: Color) -> void:
	var d := b - a
	var len := Vector2(d.x, d.z).length()
	if len < w:
		return
	var along := Vector3(d.x, 0, d.z) / len
	var yaw := atan2(-along.z, along.x)
	var pitch := w * 1.6
	if lod >= 2:
		# a band with the merlon line's mean height: same outline from afar
		m.box((a + b) * 0.5 + Vector3(0, h * 0.35, 0) + out * 0.0, Vector3(len, h * 0.7, t), col, yaw, false, false)
		return
	var n := int(floor(len / pitch))
	var shape := PackedVector2Array([Vector2(-w * 0.5, 0), Vector2(w * 0.5, 0), Vector2(w * 0.5, h * 0.62), Vector2(0, h), Vector2(-w * 0.5, h * 0.62)])
	for k in n:
		var t0 := (k + 0.5) / float(n)
		var p := a.lerp(b, t0)
		if lod == 0:
			m.push(Transform3D(Basis(Vector3.UP, yaw), p - along * 0.0 - out * 0.0))
			m.push(Transform3D(Basis.IDENTITY, Vector3(0, 0, -t * 0.5)))
			m.extrude(shape, t, col, true)
			m.pop()
			m.pop()
		else:
			m.box(p + Vector3(0, h * 0.4, 0), Vector3(w, h * 0.8, t), col, yaw, false, false)


## A Tuscan column (CP colonnade): base block, torus, a slightly tapered shaft, echinus and abacus. Foot at c.
static func tuscan_column(m: KitMesh, c: Vector3, h: float, r: float, lod: int, col: Color) -> void:
	if lod >= 2:
		m.box(c + Vector3(0, h * 0.5, 0), Vector3(r * 2.0, h, r * 2.0), col)
		return
	var plinth := r * 0.55
	m.box(c + Vector3(0, plinth * 0.5, 0), Vector3(r * 2.5, plinth, r * 2.5), col)
	var abacus := r * 0.45
	var shaft_h := h - plinth - abacus
	if lod == 0:
		m.lathe(PackedVector2Array([Vector2(r * 1.15, 0), Vector2(r * 1.0, r * 0.4), Vector2(r, shaft_h * 0.33),
			Vector2(r * 0.86, shaft_h * 0.9), Vector2(r * 1.12, shaft_h)]), 6, c + Vector3(0, plinth, 0), col)
	else:
		m.cyl(c + Vector3(0, plinth, 0), r, shaft_h, 6, col, 0.88, false)
	m.box(c + Vector3(0, h - abacus * 0.5, 0), Vector3(r * 2.4, abacus, r * 2.4), col)


## A minaret standing on c: base radius r, height h to its tip. Tapered shaft in three stages with a gallery after
## each, a chhatri at the top. `stripes` alternates the faces of the fluted shaft (Jama Masjid's red and white).
static func minaret(m: KitMesh, c: Vector3, r: float, h: float, lod: int, col: Color, stripe: Color, top_col: Color, sides := 16) -> void:
	var cap := h * 0.17
	var shaft_top := h - cap
	var stages := [0.0, 0.42, 0.72, 1.0]
	var s := sides if lod <= 1 else 8
	for k in 3:
		var y0: float = shaft_top * stages[k]
		var y1: float = shaft_top * stages[k + 1]
		var r0: float = r * (1.0 - 0.28 * float(stages[k]))
		var r1: float = r * (1.0 - 0.28 * float(stages[k + 1]))
		fluted(m, c, r0, r1, y0, y1 - (0.9 if lod <= 1 else 0.0), s, col, stripe if lod <= 2 else col)
		if lod <= 1:
			# the gallery: a ring of brackets under a balcony slab and a low railing
			var gy := y1 - 0.9
			m.lathe(PackedVector2Array([Vector2(r1 * 0.98, gy - 0.9), Vector2(r1 + 0.9, gy), Vector2(r1 + 0.9, gy), Vector2(r1 + 0.9, gy + 0.35), Vector2(r1 + 0.9, gy + 0.35), Vector2(r1 * 0.9, gy + 0.35)]), seg(lod, 16), c, top_col)
			m.cyl(c + Vector3(0, gy + 0.35, 0), r1 + 0.85, 0.9, seg(lod, 16), top_col, 1.0, false)
		elif lod == 2:
			m.cyl(c + Vector3(0, y1 - 0.6, 0), r1 + 0.6, 0.6, 8, top_col)
	var rt := r * 0.72
	chhatri(m, c + Vector3(0, shaft_top, 0), rt * 1.05, cap, lod, top_col, top_col, 8, true)


## A fluted (many sided) tapered shaft from y0 to y1 about c; faces alternate `a` and `b`.
static func fluted(m: KitMesh, c: Vector3, r0: float, r1: float, y0: float, y1: float, sides: int, a: Color, b: Color) -> void:
	for k in sides:
		var a0 := TAU * k / sides
		var a1 := TAU * (k + 1) / sides
		var p00 := c + Vector3(cos(a0) * r0, y0, sin(a0) * r0)
		var p01 := c + Vector3(cos(a1) * r0, y0, sin(a1) * r0)
		var p10 := c + Vector3(cos(a0) * r1, y1, sin(a0) * r1)
		var p11 := c + Vector3(cos(a1) * r1, y1, sin(a1) * r1)
		# counter-clockwise from outside: the angle grows clockwise seen from above here
		m.quad(p00, p10, p11, p01, a if k % 2 == 0 else b)
	m.lathe(PackedVector2Array([Vector2(r1, y1), Vector2(0, y1)]), sides, c, a)


## A curvilinear temple tower (shikhara) on c: base width w, height h, a ribbed body in tiers, the amalaka disc and a
## kalash. (No pilot landmark uses it; it is in the kit for the temples of the signature tier.)
static func shikhara(m: KitMesh, c: Vector3, w: float, h: float, lod: int, col: Color) -> void:
	var tiers := 7 if lod == 0 else (4 if lod == 1 else 2)
	var body := h * 0.82
	for k in tiers:
		var t0 := float(k) / tiers
		var t1 := float(k + 1) / tiers
		var hw0 := w * 0.5 * (1.0 - 0.62 * pow(t0, 1.6))
		var hw1 := w * 0.5 * (1.0 - 0.62 * pow(t1, 1.6))
		var poly := PackedVector2Array()
		# a square with stepped (rathas) corners
		for q in [Vector2(-1, -1), Vector2(1, -1), Vector2(1, 1), Vector2(-1, 1)]:
			poly.append(Vector2(c.x + q.x * hw0 * 0.75, c.z + q.y * hw0))
			poly.append(Vector2(c.x + q.x * hw0, c.z + q.y * hw0 * 0.75))
		m.prism(poly, c.y + body * t0, c.y + body * t1 - (0.15 if lod == 0 else 0.0), col)
		if lod == 0:
			m.box(c + Vector3(0, body * t1 - 0.08, 0), Vector3(hw1 * 2.1, 0.16, hw1 * 2.1), col.lightened(0.08))
	m.lathe(PackedVector2Array([Vector2(w * 0.12, body), Vector2(w * 0.2, body + h * 0.04), Vector2(w * 0.12, body + h * 0.08)]), seg(lod, 16), c, col)
	kalash(m, c + Vector3(0, body + h * 0.08, 0), h * 0.04, lod, BRASS)


## A slab: a footprint (x, z) raised from y0 to y1, with a cornice band at the top at full detail.
static func slab(m: KitMesh, poly: PackedVector2Array, y0: float, y1: float, lod: int, col: Color, roof := Color("#8c8a84")) -> void:
	m.prism(poly, y0, y1, col, roof)
	if lod == 0 and y1 - y0 > 3.0:
		var band := Geometry2D.offset_polygon(poly, 0.35)
		if band.size() == 1:
			m.prism(band[0], y1 - 0.6, y1 - 0.25, col.lightened(0.06), Color(0, 0, 0, 0), false)


## A flag on a pole at c: pole height h, flag w by w * 2 / 3 flying towards +x (the national flag: saffron, white,
## green with a navy wheel).
static func flag(m: KitMesh, c: Vector3, h: float, w: float, lod: int, yaw := 0.0) -> void:
	m.cyl(c, maxf(0.08, h * 0.006), h, seg(lod, 8), Color("#d9d6cf"), 0.6)
	if lod >= 3:
		return
	var fh := w * 2.0 / 3.0
	var cols := [Color("#ff9933"), Color("#f2f0ea"), Color("#138808")]
	m.push(Transform3D(Basis(Vector3.UP, yaw), c + Vector3(0, h - fh, 0)))
	for k in 3:
		var y0 := fh * (2 - k) / 3.0
		var y1 := fh * (3 - k) / 3.0
		# both sides of the cloth, a slight ripple in the middle
		var a := Vector3(0.1, y0, 0)
		var b := Vector3(w, y0, 0)
		var cc := Vector3(w, y1, 0)
		var d := Vector3(0.1, y1, 0)
		m.quad(a, b, cc, d, cols[k])
		m.quad(b, a, d, cc, cols[k])
	if lod == 0:
		var wc := Vector3(w * 0.5, fh * 0.5, 0)
		var navy := Color("#1f3a8a")
		for side in [-0.03, 0.03]:
			var ring := PackedVector2Array()
			for k in 16:
				var an := TAU * k / 16.0
				ring.append(Vector2(wc.x + cos(an) * fh * 0.13, wc.y + sin(an) * fh * 0.13))
			m.push(Transform3D(Basis.IDENTITY, Vector3(0, 0, side)))
			m.extrude(ring, 0.005, navy, true)
			m.pop()
	m.pop()
