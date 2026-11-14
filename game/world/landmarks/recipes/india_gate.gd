## India Gate (hero, P2-007): the 42 m buff stone memorial arch on its low base of red Bharatpur stone (en.wikipedia
## 'India Gate', registry edit lm_0002), built from the parts kit in the area sheet's proportions
## (harness/design/areas/india_gate_kartavya_path.md, board photos 14 and 17 to 24): two piers with a round headed main
## arch (crown at about half the height), side arches through the piers, pilasters and recessed panels, the cornice,
## the stepped attic that carries the inscription, and the shallow domed bowl on top. Kept clean (wear near zero).
## The width and depth come from the footprint's main axis, the front from the registry (west, towards Kartavya Path).
extends RefCounted

const KitMesh := preload("res://world/landmarks/kit_mesh.gd")
const Parts := preload("res://world/landmarks/parts.gd")


static func build(m: KitMesh, kit: Dictionary, lm: Dictionary, lod: int) -> Dictionary:
	var H := float(lm.get("height", 42.0)) if lm.get("height") != null else 42.0
	var ax: Dictionary = kit.get("axis", {}) if kit.get("axis") is Dictionary else {}
	var c := Vector3(float(ax.get("c", [0, 0])[0]), 0.0, float(ax.get("c", [0, 0])[1]))
	var W := clampf(float(ax.get("lengthM", 27.0)) - 2.5, 18.0, 32.0)
	var D := clampf(float(ax.get("widthM", 17.0)) - 4.0, 8.0, 18.0)
	var yaw := deg_to_rad(float(lm.get("yaw", 270.0)) if lm.get("yaw") != null else 270.0)
	m.use("gate")
	m.push(Transform3D(Basis(Vector3.UP, -yaw), c))
	var stone := Parts.BUFF
	var light := Parts.BUFF_LIGHT
	var dark := Parts.BUFF_DARK
	var base_red := Color("#9c5a45")
	# the low base of red Bharatpur stone: three steps
	var y := 0.0
	var steps := 3 if lod <= 1 else 1
	var step_h := 1.5 / steps
	for i in steps:
		var grow := 7.0 - i * 2.5 if steps == 3 else 5.0
		m.box(Vector3(0, y + step_h * 0.5 - (0.3 if i == 0 else 0.0), 0), Vector3(W + grow, step_h + (0.6 if i == 0 else 0.0), D + grow), base_red.lightened(i * 0.04))
		y += step_h
	var y0 := y
	var Hp := H * 0.595
	var ow := W * 0.38
	var spring := H * 0.38
	# piers and the lintel: the front outline with the main arch cut out, through the whole depth
	var front := Parts.wall_with_opening(W, Hp, Parts.round_arch(ow, spring, 16 if lod == 0 else (10 if lod <= 2 else 6)))
	var was := m.collide
	m.collide = false
	m.push(Transform3D(Basis.IDENTITY, Vector3(0, y0, -D * 0.5)))
	m.extrude(front, D, stone)
	m.pop()
	m.collide = was
	var pier_w := (W - ow) * 0.5
	for xs in [-1.0, 1.0]:
		m.solid(Vector3(xs * (ow * 0.5 + pier_w * 0.5), y0 + Hp * 0.5, 0), Vector3(pier_w, Hp, D))
	m.solid(Vector3(0, y0 + (spring + ow * 0.5 + Hp) * 0.5, 0), Vector3(ow, Hp - spring - ow * 0.5, D))
	if lod <= 2:
		_faces(m, W, D, H, Hp, ow, spring, y0, lod, light, dark)
	if lod <= 1:
		_surroundings(m, W, D, lod)
	# cornice (on a row of dentils at full detail), the attic in three steps, the drum and the shallow bowl
	y = y0 + Hp
	if lod == 0:
		for zf in [-1.0, 1.0]:
			var n := int(W / 0.7)
			for k in n:
				m.box(Vector3(-W * 0.5 + 0.35 + k * 0.7, y - 0.2, zf * (D * 0.5 + 0.18)), Vector3(0.32, 0.4, 0.36), light, 0.0, false, false)
		m.box(Vector3(0, y - 0.55, 0), Vector3(W + 0.6, 0.3, D + 0.6), light, 0.0, false, false)
	m.box(Vector3(0, y + 0.45, 0), Vector3(W + 1.4, 0.9, D + 1.4), light)
	y += 0.9
	var tiers := [[W - 1.0, H * 0.13, D - 0.8], [W - 6.0, H * 0.081, D - 3.0], [W - 11.0, H * 0.05, D - 5.0]]
	for k in tiers.size():
		var t: Array = tiers[k]
		m.box(Vector3(0, y + float(t[1]) * 0.5, 0), Vector3(t[0], t[1], t[2]), stone)
		if lod <= 1:
			m.box(Vector3(0, y + float(t[1]) - 0.15, 0), Vector3(float(t[0]) + 0.5, 0.3, float(t[2]) + 0.5), light, 0.0, false, false)
		if k == 0 and lod <= 2:
			# the inscription band of the attic (INDIA, the years either side) on the front and the back
			for zf in [-1.0, 1.0]:
				m.box(Vector3(0, y + float(t[1]) * 0.5, zf * (float(t[2]) * 0.5 + 0.03)), Vector3(float(t[0]) * 0.62, float(t[1]) * 0.42, 0.06), dark, 0.0, false, false)
				if lod == 0:
					for xs in [-1.0, 1.0]:
						# the sun medallions beside the years
						var mz: float = -(float(t[2]) * 0.5 + 0.1) if zf < 0 else float(t[2]) * 0.5 + 0.02
						m.push(Transform3D(Basis.IDENTITY, Vector3(xs * float(t[0]) * 0.4, y + float(t[1]) * 0.5, mz)))
						m.extrude(_disc(0.9, 12), 0.08, light)
						m.pop()
		y += float(t[1])
	m.solid(Vector3(0, (y0 + Hp + y) * 0.5, 0), Vector3(W - 1.0, y - y0 - Hp, D - 0.8))
	var dr := W * 0.13
	m.cyl(Vector3(0, y, 0), dr, H * 0.031, Parts.seg(lod, 32), stone, 1.0, false)
	y += H * 0.031
	m.cyl(Vector3(0, y, 0), dr * 1.22, 0.3, Parts.seg(lod, 32), light)
	y += 0.3
	Parts.shallow_dome(m, Vector3(0, y, 0), dr * 1.15, maxf(0.5, H - y), lod, dark)
	m.pop()
	return {"heightM": H, "heightPart": "the bowl on top of the attic"}


## What stands round the arch on its paved ground (area sheet india_gate_kartavya_path: white stone posts with chains,
## black cast lantern posts 6 to 8 m): a ring of chain posts and four lanterns at its corners.
static func _surroundings(m: KitMesh, W: float, D: float, lod: int) -> void:
	var hx := W * 0.5 + 16.0
	var hz := D * 0.5 + 16.0
	var white := Color("#ece8de")
	var chain := Color("#2a2a2c")
	var corners := [Vector2(-hx, -hz), Vector2(hx, -hz), Vector2(hx, hz), Vector2(-hx, hz)]
	for k in 4:
		var a: Vector2 = corners[k]
		var b: Vector2 = corners[(k + 1) % 4]
		var n := maxi(2, int(a.distance_to(b) / 3.6))
		var prev := Vector3.ZERO
		for i in n + 1:
			var p := a.lerp(b, float(i) / n)
			var c := Vector3(p.x, 0.0, p.y)
			if absf(p.y + hz) < 0.1 and absf(p.x) < 6.0:
				prev = Vector3.ZERO
				continue
			m.box(c + Vector3(0, 0.25, 0), Vector3(0.28, 1.3, 0.28), white)
			if lod == 0:
				m.lathe(PackedVector2Array([Vector2(0.17, 0), Vector2(0.17, 0.08), Vector2(0.1, 0.2), Vector2(0, 0.24)]), 6, c + Vector3(0, 0.9, 0), white)
			if prev != Vector3.ZERO and lod == 0:
				var mid := (prev + c) * 0.5 + Vector3(0, 0.62, 0)
				m.rod(prev + Vector3(0, 0.78, 0), mid, 0.025, 4, chain)
				m.rod(mid, c + Vector3(0, 0.78, 0), 0.025, 4, chain)
			prev = c
	for k in 4:
		var p: Vector2 = corners[k] * 1.08
		var c := Vector3(p.x, 0.0, p.y)
		m.cyl(c, 0.32, 0.8, 8, Color("#262628"))
		m.cyl(c + Vector3(0, 0.8, 0), 0.11, 5.2, 8, Color("#262628"), 0.8)
		m.box(c + Vector3(0, 6.35, 0), Vector3(0.55, 0.75, 0.55), Color("#3a3a3c"))
		m.lathe(PackedVector2Array([Vector2(0.42, 0), Vector2(0.0, 0.45)]), 8, c + Vector3(0, 6.72, 0), Color("#262628"))
		m.solid(c + Vector3(0, 3.4, 0), Vector3(0.4, 6.8, 0.4))


## The face detail of the piers and the arch: archivolt rings, the keystone, impost bands, pilasters, recessed
## panels and the side arches through the piers (dark recesses on the side faces).
static func _faces(m: KitMesh, W: float, D: float, H: float, Hp: float, ow: float, spring: float, y0: float, lod: int, light: Color, dark: Color) -> void:
	var n := 16 if lod == 0 else 8
	for zf in [-1.0, 1.0]:
		var z: float = zf * D * 0.5
		# the archivolt: a band round the opening, proud of the face
		var inner := Parts.round_arch(ow, spring, n)
		var outer := Parts.round_arch(ow + 1.8, spring, n)
		var ring := PackedVector2Array(outer)
		for k in range(inner.size() - 1, -1, -1):
			ring.append(inner[k])
		m.push(Transform3D(Basis.IDENTITY, Vector3(0, y0, z - (0.3 if zf < 0 else 0.0))))
		m.extrude(ring, 0.3, light, true)
		m.pop()
		m.box(Vector3(0, y0 + spring + ow * 0.5 + 0.9, z + zf * 0.2), Vector3(1.3, 1.9, 0.4), light, 0.0, false, false)
		# impost band at the springing line, the frieze under the cornice
		for xs in [-1.0, 1.0]:
			var pc: float = xs * (ow * 0.5 + (W - ow) * 0.25)
			m.box(Vector3(pc, y0 + spring - 0.25, z + zf * 0.08), Vector3((W - ow) * 0.5, 0.5, 0.16), light, 0.0, false, false)
			if lod == 0:
				for px in [ow * 0.5 + 0.7, W * 0.5 - 0.7]:
					m.box(Vector3(xs * px, y0 + Hp * 0.5, z + zf * 0.12), Vector3(1.1, Hp - 0.6, 0.24), light, 0.0, false, false)
				# recessed panels: the long one above the impost and a lower one
				m.box(Vector3(pc, y0 + spring + (Hp - spring) * 0.45, z + zf * 0.02), Vector3((W - ow) * 0.26, (Hp - spring) * 0.6, 0.05), dark, 0.0, false, false)
				m.box(Vector3(pc, y0 + spring * 0.55, z + zf * 0.02), Vector3((W - ow) * 0.26, spring * 0.5, 0.05), dark, 0.0, false, false)
		m.box(Vector3(0, y0 + Hp - 1.3, z + zf * 0.1), Vector3(W + 0.2, 2.0, 0.2), dark.lerp(light, 0.4), 0.0, false, false)
	# the side arches through the piers: deep dark recesses on the north and south faces
	var sw := D * 0.42
	for xs in [-1.0, 1.0]:
		m.push(Transform3D(Basis(Vector3.UP, -xs * PI * 0.5), Vector3(xs * W * 0.5, y0, 0)))
		var opening := Parts.round_arch(sw, H * 0.21, 10 if lod == 0 else 6)
		m.push(Transform3D(Basis.IDENTITY, Vector3(0, 0, -0.02)))
		m.extrude(opening, 0.01, Color("#3b2e26"), true)
		m.pop()
		if lod == 0:
			var outer := Parts.round_arch(sw + 1.2, H * 0.21, 10)
			var band := PackedVector2Array(outer)
			for k in range(opening.size() - 1, -1, -1):
				band.append(opening[k])
			m.push(Transform3D(Basis.IDENTITY, Vector3(0, 0, -0.2)))
			m.extrude(band, 0.18, light, true)
			m.pop()
		m.pop()


static func _disc(r: float, n: int) -> PackedVector2Array:
	var out := PackedVector2Array()
	for k in n:
		var a := TAU * k / n
		out.append(Vector2(cos(a) * r, sin(a) * r))
	return out
