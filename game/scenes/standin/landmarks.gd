## Landmark stand-ins, one per tier (harness/design/DELHI_WORLD.md "Tiers"), each with its surroundings.
## Every builder works in a local frame facing -Z (the front), origin on the ground at the centre.
##   hero:      an India Gate like memorial arch from a small parts kit (plinth steps, piers with side arches,
##              archivolt, cornice, stepped attic, bowl), on a lawn with a paved plaza, chain fence and lamps.
##   signature: a domed garden tomb on a plinth (arched niches, chamfered block with iwans, drum, dome, chhatris),
##              in a walled char bagh with a gate.
##   marker:    an extruded footprint with the area material (an office block), window bands, a parking lot,
##              a boundary wall and gate.
## The tiers are meant to differ in detail: hero most, marker least.
extends RefCounted

const Geo := preload("res://scenes/standin/geo.gd")
const Kit := preload("res://scenes/standin/kit.gd")

const MARBLE := Color("#ece6d8")
const BRASS := Color("#b8913a")
const PLAZA := Color("#c2a482")


static func hero(s: Geo.Sink, rng: RandomNumberGenerator) -> void:
	var stone := Kit.SAND_BUFF
	var light := Kit.shade(stone, 1.08)
	var dark := Kit.shade(stone, 0.82)
	# surroundings: lawn, plaza, avenue to the road, chain fence, lamps, trees
	s.box("leaf", Kit.GRASS, Vector3(0, 0.03, 0), Vector3(70, 0.06, 70))
	s.box("matte", PLAZA, Vector3(0, 0.07, 0), Vector3(56, 0.06, 56))
	s.box("matte", PLAZA, Vector3(0, 0.07, -55), Vector3(16, 0.06, 55))
	for side in [-1.0, 1.0]:
		for t in 11:
			var u := -27.0 + t * 5.4
			s.cyl("metal", Kit.BLACK, Vector3(side * 28, 0.45, u), 0.05, 0.9, Geo.SEG_SMALL)
			s.cyl("metal", Kit.BLACK, Vector3(u, 0.45, side * 28), 0.05, 0.9, Geo.SEG_SMALL)
		s.rod("metal", Kit.BLACK, Vector3(side * 28, 0.75, -27), Vector3(side * 28, 0.75, 27), 0.015, Geo.SEG_THIN)
		s.rod("metal", Kit.BLACK, Vector3(-27, 0.75, side * 28), Vector3(27, 0.75, side * 28), 0.015, Geo.SEG_THIN)
	for c in [Vector3(-24, 0, -24), Vector3(24, 0, -24), Vector3(-24, 0, 24), Vector3(24, 0, 24)]:
		s.cyl("metal", Kit.BLACK, c + Vector3(0, 2.2, 0), 0.08, 4.4, Geo.SEG_SMALL, 0.7)
		s.ball("glow", Color("#fff3d6"), c + Vector3(0, 4.6, 0), Vector3.ONE * 0.32, Geo.SEG_MID)
	for i in range(2, 8):
		for side in [-1.0, 1.0]:
			s.push(Kit.at(Vector3(side * 40, 0, -66 + i * 18)))
			Kit.tree(s, rng, 1.2)
			s.pop()
	# plinth steps
	var W := 24.0
	var D := 9.0
	var H := 26.0
	for i in 3:
		s.box("matte", Kit.shade(stone, 0.95 - i * 0.03), Vector3(0, 0.25 + i * 0.5, 0), Vector3(W + 8 - i * 3, 0.5, D + 8 - i * 3))
	var y0 := 1.5
	# piers: each an extrusion of the side face (z, y) with a side arch through it, spanning x from 5 to 12
	for xs in [-1.0, 1.0]:
		var pier := Geo.arch(D, H, 4.2, 7.5)
		var xf := Transform3D(Geo.side(), Vector3(xs * 5.0 + (7.0 if xs > 0 else 0.0), y0, 0))
		s.ext("matte", stone, pier, 7.0, xf)
		# pilasters and recessed panels on the front and back faces
		for zf in [-1.0, 1.0]:
			for px in [5.6, 11.4]:
				s.box("matte", light, Vector3(xs * px, y0 + H * 0.5, zf * (D * 0.5 + 0.12)), Vector3(0.9, H - 0.4, 0.24))
			s.box("matte", dark, Vector3(xs * 8.5, y0 + 18.5, zf * (D * 0.5 + 0.03)), Vector3(4.2, 8.0, 0.06))
			s.box("matte", light, Vector3(xs * 8.5, y0 + 10.0, zf * (D * 0.5 + 0.06)), Vector3(4.6, 0.5, 0.12))
		# side arch ring and impost
		s.ext("matte", light, Geo.arc_shell(Vector2(0, 7.5), 2.6, 0.5, 0.0, PI), 0.3,
			Transform3D(Geo.side(), Vector3(W * 0.5 + 0.3 if xs > 0 else -W * 0.5, y0, 0)))
	# lintel block over the main opening: the main arch outline between the piers
	var lintel := PackedVector2Array()
	for i in Geo.SEG_ROUND + 1:
		var a := PI - PI * i / Geo.SEG_ROUND
		lintel.append(Vector2(cos(a) * 5.0, 13.0 + sin(a) * 5.0))
	lintel.append_array([Vector2(5, H), Vector2(-5, H)])
	s.ext("matte", stone, lintel, D,
		Transform3D(Basis.IDENTITY, Vector3(0, y0, -D * 0.5)))
	# archivolt rings front and back, keystone, impost bands
	for zf in [-1.0, 1.0]:
		var z: float = zf * D * 0.5 - (0.3 if zf < 0 else 0.0)
		s.ext("matte", light, Geo.arc_shell(Vector2(0, 13.0), 5.8, 0.8, 0.0, PI, Geo.SEG_ROUND), 0.3,
			Transform3D(Basis.IDENTITY, Vector3(0, y0, z)))
		s.box("matte", light, Vector3(0, y0 + 18.4, zf * (D * 0.5 + 0.2)), Vector3(1.2, 1.6, 0.4))
	for xs in [-1.0, 1.0]:
		s.box("matte", light, Vector3(xs * 5.0, y0 + 12.8, 0), Vector3(0.8, 0.5, D + 0.3))
	# frieze (inscription band), cornice, stepped attic, drum and bowl
	var y := y0 + H
	s.box("matte", dark, Vector3(0, y - 1.6, 0), Vector3(W + 0.3, 2.0, D + 0.3))
	s.box("matte", light, Vector3(0, y + 0.4, 0), Vector3(W + 1.4, 0.8, D + 1.4))
	y += 0.8
	var steps := [[W - 2.0, 3.2, D - 0.6], [W - 6.0, 2.6, D - 2.0], [W - 10.0, 2.2, D - 3.4]]
	for st in steps:
		s.box("matte", stone, Vector3(0, y + st[1] * 0.5, 0), Vector3(st[0], st[1], st[2]))
		s.box("matte", light, Vector3(0, y + st[1] - 0.15, 0), Vector3(st[0] + 0.5, 0.3, st[2] + 0.5))
		y += st[1]
	s.cyl("matte", stone, Vector3(0, y + 0.6, 0), 2.6, 1.2, Geo.SEG_ROUND)
	s.cyl("matte", light, Vector3(0, y + 1.35, 0), 3.2, 0.3, Geo.SEG_ROUND)
	s.dome("matte", dark, Vector3(0, y + 1.5, 0), 3.0, 1.2, Geo.SEG_ROUND)


static func signature(s: Geo.Sink, rng: RandomNumberGenerator) -> void:
	var red := Kit.SAND_RED
	var dark := Kit.shade(red, 0.5)
	# walled char bagh: lawn, cross paths with water channels, wall, gate on the front
	var G := 100.0
	s.box("leaf", Kit.GRASS, Vector3(0, 0.03, 0), Vector3(G, 0.06, G))
	for rot in [0.0, PI * 0.5]:
		s.box("matte", Kit.PAVER, Vector3(0, 0.08, 0), Vector3(6, 0.06, G), rot)
		s.box("satin", Color("#4f7f8f"), Vector3(0, 0.1, 0), Vector3(1.2, 0.06, G), rot)
	for i in 4:
		var yaw := i * PI * 0.5
		var b := Basis(Vector3.UP, yaw)
		for k in 10:
			var x := -G * 0.5 + 5 + k * 10.0
			if absf(x) < 8.0 and i == 0:
				continue
			s.put("matte", Geo.unit_box(), Transform3D(b * Basis.from_scale(Vector3(10.2, 3.0, 0.8)), b * Vector3(x, 1.5, -G * 0.5)), Kit.shade(red, 0.9))
			s.put("matte", Geo.unit_box(), Transform3D(b * Basis.from_scale(Vector3(10.4, 0.3, 1.1)), b * Vector3(x, 3.1, -G * 0.5)), Kit.shade(red, 1.05))
	# gate building on the front wall
	s.box("matte", red, Vector3(0, 5, -G * 0.5), Vector3(16, 10, 8))
	s.ext("matte", dark, Geo.arch_opening(5, 4.5), 8.2, Transform3D(Basis.IDENTITY, Vector3(0, 0, -G * 0.5 - 4.1)))
	for x in [-6.5, 6.5]:
		s.cyl("matte", MARBLE, Vector3(x, 11.0, -G * 0.5 - 3), 0.15, 2, Geo.SEG_SMALL)
		s.dome("matte", MARBLE, Vector3(x, 12.0, -G * 0.5 - 3), 1.0, 1.0, Geo.SEG_MID)
	for t in 6:
		s.push(Kit.at(Vector3(-G * 0.5 + 8 + t * 4, 0, -G * 0.5 + 10)))
		Kit.tree(s, rng, 0.9)
		s.pop()
	# plinth with arched niches on every face
	var P := 48.0
	var ph := 6.0
	s.box("matte", red, Vector3(0, ph * 0.5, 0), Vector3(P, ph, P))
	s.box("matte", Kit.shade(red, 1.1), Vector3(0, ph + 0.15, 0), Vector3(P + 0.6, 0.3, P + 0.6))
	for i in 4:
		var b := Basis(Vector3.UP, i * PI * 0.5)
		for k in 9:
			var x := -P * 0.5 + 2.67 + k * 5.33
			s.put("matte", Geo.extrude(Geo.arch_opening(2.8, 2.6), 0.08), Transform3D(b, b * Vector3(x, 0.6, -P * 0.5 - 0.08)), dark)
			s.put("matte", Geo.extrude(Geo.arc_shell(Vector2(0, 2.6), 1.65, 0.25, 0.0, PI), 0.1), Transform3D(b, b * Vector3(x, 0.6, -P * 0.5 - 0.1)), MARBLE)
	# main block: a square with chamfered corners, iwans on each face, marble bands
	var B := 30.0
	var ch := 6.5
	var bh := 18.0
	var oct := PackedVector2Array([Vector2(-B * 0.5 + ch, -B * 0.5), Vector2(B * 0.5 - ch, -B * 0.5), Vector2(B * 0.5, -B * 0.5 + ch),
		Vector2(B * 0.5, B * 0.5 - ch), Vector2(B * 0.5 - ch, B * 0.5), Vector2(-B * 0.5 + ch, B * 0.5), Vector2(-B * 0.5, B * 0.5 - ch),
		Vector2(-B * 0.5, -B * 0.5 + ch)])
	s.ext("matte", red, oct, bh, Transform3D(Geo.upright(), Vector3(0, ph + 0.3, 0)))
	s.ext("matte", MARBLE, oct, 0.5, Transform3D(Geo.upright() * Basis.from_scale(Vector3(1.02, 1.02, 1.0)), Vector3(0, ph + 0.3 + bh, 0)))
	s.ext("matte", MARBLE, oct, 0.35, Transform3D(Geo.upright() * Basis.from_scale(Vector3(1.012, 1.012, 1.0)), Vector3(0, ph + 0.3 + bh * 0.5, 0)))
	for i in 4:
		var b := Basis(Vector3.UP, i * PI * 0.5)
		s.put("matte", Geo.extrude(Geo.arch_opening(8.5, 10.5), 0.1), Transform3D(b, b * Vector3(0, ph + 0.3, -B * 0.5 - 0.1)), Kit.shade(red, 0.42))
		s.put("matte", Geo.extrude(Geo.arc_shell(Vector2(0, 10.5), 4.95, 0.7, 0.0, PI, Geo.SEG_ROUND), 0.15), Transform3D(b, b * Vector3(0, ph + 0.3, -B * 0.5 - 0.15)), MARBLE)
		for xs in [-1.0, 1.0]:
			s.put("matte", Geo.unit_box(), Transform3D(b * Basis.from_scale(Vector3(0.6, bh, 0.2)), b * Vector3(xs * 5.4, ph + 0.3 + bh * 0.5, -B * 0.5 - 0.1)), MARBLE)
	# drum, double dome, finial
	var y := ph + 0.3 + bh + 0.5
	s.cyl("matte", MARBLE, Vector3(0, y + 3.0, 0), 8.6, 6.0, Geo.SEG_ROUND)
	s.cyl("matte", Kit.shade(MARBLE, 0.9), Vector3(0, y + 6.1, 0), 8.9, 0.3, Geo.SEG_ROUND)
	s.ball("matte", MARBLE, Vector3(0, y + 6.2, 0), Vector3(9.2, 3.0, 9.2), Geo.SEG_ROUND)
	s.dome("matte", MARBLE, Vector3(0, y + 6.2, 0), 9.2, 11.5, Geo.SEG_ROUND)
	s.cyl("metal", BRASS, Vector3(0, y + 18.4, 0), 0.5, 1.6, Geo.SEG_MID, 0.4)
	s.ball("metal", BRASS, Vector3(0, y + 19.4, 0), Vector3.ONE * 0.55, Geo.SEG_MID)
	s.rod("metal", BRASS, Vector3(0, y + 19.8, 0), Vector3(0, y + 22.0, 0), 0.12, Geo.SEG_SMALL, 0.3)
	# chhatris on the roof corners
	for cx in [-1.0, 1.0]:
		for cz in [-1.0, 1.0]:
			var c := Vector3(cx * 10.0, y, cz * 10.0)
			for k in 8:
				var a := TAU * k / 8.0
				s.cyl("matte", red, c + Vector3(cos(a) * 1.6, 1.6, sin(a) * 1.6), 0.16, 3.2, Geo.SEG_SMALL)
			s.cyl("matte", Kit.shade(red, 1.1), c + Vector3(0, 3.35, 0), 2.2, 0.3, Geo.SEG_ROUND)
			s.dome("matte", MARBLE, c + Vector3(0, 3.5, 0), 1.9, 2.2, Geo.SEG_ROUND)
			s.ball("metal", BRASS, c + Vector3(0, 5.8, 0), Vector3.ONE * 0.22, Geo.SEG_SMALL)


## Marker tier: an extruded L footprint with the area material. Returns the parking bay frames for cars.
static func marker(s: Geo.Sink, rng: RandomNumberGenerator) -> Array:
	var wall := Color("#d8cdb4")
	var band := Color("#a4533b")
	var foot := PackedVector2Array([Vector2(-20, -15), Vector2(20, -15), Vector2(20, -1), Vector2(-4, -1), Vector2(-4, 15),
		Vector2(-20, 15)])
	var h := 13.0
	s.ext("matte", wall, foot, h, Transform3D(Geo.upright(), Vector3.ZERO))
	s.ext("matte", Kit.shade(wall, 0.9), foot, 0.9, Transform3D(Geo.upright() * Basis.from_scale(Vector3(1.006, 1.006, 1.0)), Vector3(0, h, 0)))
	s.ext("matte", band, foot, 0.5, Transform3D(Geo.upright() * Basis.from_scale(Vector3(1.008, 1.008, 1.0)), Vector3(0, 3.6, 0)))
	# window bands on every edge, per floor (edges of the footprint, outward)
	for i in foot.size():
		var a := foot[i]
		var b := foot[(i + 1) % foot.size()]
		var e := b - a
		var len := e.length()
		var mid := (a + b) * 0.5
		var out := Vector2(e.y, -e.x).normalized()
		var yaw := atan2(e.y, e.x)
		for f in 3:
			var p := Vector3(mid.x + out.x * 0.04, 1.6 + f * 3.8, -(mid.y + out.y * 0.04))
			s.box("glass", Kit.GLASS, p, Vector3(len - 1.6, 1.5, 0.06), yaw)
	# parking lot in front with bays, boundary wall and gate
	s.box("road", Kit.ASPHALT, Vector3(0, 0.02, -26), Vector3(44, 0.04, 20))
	var bays := []
	for k in 9:
		var x := -18.0 + k * 4.5
		s.box("satin", Kit.MARK, Vector3(x - 2.25, 0.05, -21), Vector3(0.12, 0.02, 5.0))
		bays.append(Vector3(x, 0, -21))
	for side in [-1.0, 1.0]:
		s.box("matte", Kit.PLASTER, Vector3(side * 24, 1.1, -10), Vector3(0.3, 2.2, 52))
	s.box("matte", Kit.PLASTER, Vector3(-15, 1.1, -36), Vector3(18, 2.2, 0.3))
	s.box("matte", Kit.PLASTER, Vector3(15, 1.1, -36), Vector3(18, 2.2, 0.3))
	for x in [-6.0, 6.0]:
		s.box("matte", Kit.shade(Kit.PLASTER, 0.9), Vector3(x, 1.4, -36), Vector3(0.8, 2.8, 0.8))
	for t in 4:
		s.push(Kit.at(Vector3(-22 + t * 3.0, 0, 20)))
		Kit.tree(s, rng, 0.9)
		s.pop()
	return bays
