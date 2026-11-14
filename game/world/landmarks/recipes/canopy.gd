## The canopy east of India Gate (P2-007): a 73 ft (22.3 m) sandstone cupola at the junction of six roads, four Delhi
## Order columns carrying its chhajja and dome (en.wikipedia 'India Gate', section Canopy), with the statue of Subhas
## Chandra Bose in dark granite under it since 2022 (28 ft, the same article). A figure of respect: plain, dark,
## standing; no likeness is attempted.
extends RefCounted

const KitMesh := preload("res://world/landmarks/kit_mesh.gd")
const Parts := preload("res://world/landmarks/parts.gd")

## en.wikipedia 'India Gate' (read 2026-11-13): "a 73 ft cupola".
const HEIGHT_M := 22.3


static func build(m: KitMesh, kit: Dictionary, lm: Dictionary, lod: int) -> Dictionary:
	var ax: Dictionary = kit.get("axis", {}) if kit.get("axis") is Dictionary else {}
	var c := Vector3(float(ax.get("c", [0, 0])[0]), 0.0, float(ax.get("c", [0, 0])[1]))
	var S := clampf(minf(float(ax.get("lengthM", 10.0)), float(ax.get("widthM", 10.0))) - 1.0, 7.0, 13.0)
	var H := HEIGHT_M
	var yaw := deg_to_rad(float(lm.get("yaw")) if lm.get("yaw") != null else 270.0)
	m.use("canopy")
	m.push(Transform3D(Basis(Vector3.UP, -yaw), c))
	var stone := Parts.BUFF
	var light := Parts.BUFF_LIGHT
	var red := Color("#9c5a45")
	# platform in three steps
	var y := 0.0
	for i in (3 if lod <= 1 else 1):
		var s := S + 4.0 - i * 1.4
		m.box(Vector3(0, y + 0.3 - (0.3 if i == 0 else 0.0), 0), Vector3(s, 0.6 + (0.6 if i == 0 else 0.0), s), red.lightened(i * 0.05))
		y += 0.6 if lod <= 1 else 1.6
	if lod > 1:
		y = 1.6
	var post_h := H * 0.43
	var half := S * 0.5 - 0.7
	# the four corner supports: a Delhi Order column with its bell capital, two lesser shafts beside it
	for cx in [-1.0, 1.0]:
		for cz in [-1.0, 1.0]:
			var pc := Vector3(cx * half, y, cz * half)
			m.solid(pc + Vector3(0, post_h * 0.5, 0), Vector3(1.4, post_h, 1.4))
			if lod >= 3:
				m.box(pc + Vector3(0, post_h * 0.5, 0), Vector3(1.2, post_h, 1.2), stone)
				continue
			m.box(pc + Vector3(0, 0.4, 0), Vector3(1.4, 0.8, 1.4), stone)
			if lod <= 1:
				m.cyl(pc + Vector3(0, 0.8, 0), 0.42, post_h - 2.0, Parts.seg(lod, 16), stone, 0.92, false)
				# the bell capital with its hanging bells (Delhi Order)
				m.lathe(PackedVector2Array([Vector2(0.4, 0), Vector2(0.5, 0.4), Vector2(0.75, 0.9), Vector2(0.75, 0.9), Vector2(0.75, 1.2), Vector2(0.75, 1.2), Vector2(0.0, 1.2)]), Parts.seg(lod, 16), pc + Vector3(0, post_h - 1.2, 0), light)
				for side in [Vector3(-cx, 0, 0), Vector3(0, 0, -cz)]:
					m.cyl(pc + side * 0.9 + Vector3(0, 0.8, 0), 0.22, post_h - 1.6, Parts.seg(lod, 10), stone, 1.0, true)
			else:
				m.cyl(pc + Vector3(0, 0.8, 0), 0.45, post_h - 0.8, 8, stone)
	y += post_h
	# the architrave, the wide chhajja, a square attic
	m.box(Vector3(0, y + 0.5, 0), Vector3(S, 1.0, S), stone)
	y += 1.0
	var eave := S + 2.8
	if lod <= 2:
		var hs := S * 0.5
		var he := eave * 0.5
		# the sloping chhajja: four trapezoids from the attic out and down, and its edge
		for k in 4:
			m.push(Transform3D(Basis(Vector3.UP, k * PI * 0.5), Vector3.ZERO))
			m.quad(Vector3(-hs, y + 0.6, -hs), Vector3(hs, y + 0.6, -hs), Vector3(he, y - 0.2, -he), Vector3(-he, y - 0.2, -he), light)
			m.quad(Vector3(-he, y - 0.45, -he), Vector3(-he, y - 0.2, -he), Vector3(he, y - 0.2, -he), Vector3(he, y - 0.45, -he), light)
			m.quad(Vector3(-he, y - 0.45, -he), Vector3(he, y - 0.45, -he), Vector3(hs, y - 0.1, -hs), Vector3(-hs, y - 0.1, -hs), stone.darkened(0.15))
			m.pop()
	else:
		m.box(Vector3(0, y, 0), Vector3(eave, 0.6, eave), light)
	y += 0.6
	m.box(Vector3(0, y + 1.0, 0), Vector3(S - 1.0, 2.0, S - 1.0), stone)
	y += 2.0
	# the cupola and its finial
	m.cyl(Vector3(0, y, 0), S * 0.36, 0.8, Parts.seg(lod, 24), stone, 1.0, false)
	y += 0.8
	var dome_h := (H - y) * 0.72
	Parts.shallow_dome(m, Vector3(0, y, 0), S * 0.4, dome_h, lod, stone)
	if lod <= 2:
		Parts.kalash(m, Vector3(0, y + dome_h * 0.96, 0), (H - y - dome_h * 0.96) / 2.6, lod, light)
	# the statue on its pedestal (dark granite)
	if lod <= 1:
		var py := 1.8
		m.box(Vector3(0, py + 1.0, 0), Vector3(2.6, 2.0, 2.6), Parts.GRANITE.lightened(0.1))
		var f := py + 2.0
		m.lathe(PackedVector2Array([Vector2(0.9, 0), Vector2(1.0, 3.6), Vector2(1.15, 5.4), Vector2(0.95, 6.6), Vector2(0.45, 7.0), Vector2(0.45, 7.0), Vector2(0.0, 7.0)]), Parts.seg(lod, 16), Vector3(0, f, 0), Parts.GRANITE)
		m.lathe(PackedVector2Array([Vector2(0.3, 0), Vector2(0.52, 0.5), Vector2(0.48, 1.0), Vector2(0.0, 1.25)]), Parts.seg(lod, 12), Vector3(0, f + 7.0, 0), Parts.GRANITE)
		m.solid(Vector3(0, py + 4.5, 0), Vector3(2.6, 9.0, 2.6))
	m.pop()
	return {"heightM": H, "heightPart": "the finial of the cupola"}
