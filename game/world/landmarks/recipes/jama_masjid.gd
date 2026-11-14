## Jama Masjid (signature until its hero model, P2-007). A place of worship: built with the same care as every
## landmark, placed only where the sources place it and never a combat arena (DELHI_WORLD.md section 3, the registry
## flag worship.combat_arena false; the landmark system reports it). From en.wikipedia 'Jama Masjid, Delhi' (registry
## edit lm_0004): red sandstone with white marble, the prayer hall on the west of a square courtyard with chhatris at
## its four corners, three marble domes with black stripes and golden finials, two 41 m minarets striped with white
## marble with a marble chhatri on top, three gates with broad flights of steps (the three storey east gate is the
## largest and faces the Red Fort). The plinth height (5 m) and the hall's size (61 by 27.5 m) are estimates read off
## the area photos; the minaret tips are held at the registry height above the foot of the steps.
extends RefCounted

const KitMesh := preload("res://world/landmarks/kit_mesh.gd")
const Parts := preload("res://world/landmarks/parts.gd")

const PLINTH_M := 5.0


static func build(m: KitMesh, kit: Dictionary, lm: Dictionary, lod: int) -> Dictionary:
	var H := float(lm.height) if lm.get("height") != null else 41.0
	var ax: Dictionary = kit.get("axis", {}) if kit.get("axis") is Dictionary else {}
	var c := Vector3(float(ax.get("c", [0, 0])[0]), 0.0, float(ax.get("c", [0, 0])[1]))
	var S := clampf(minf(float(ax.get("lengthM", 120.0)), float(ax.get("widthM", 120.0))) - 16.0, 60.0, 115.0)
	var yaw := deg_to_rad(float(lm.get("yaw")) if lm.get("yaw") != null else 90.0)
	m.use("masjid")
	m.push(Transform3D(Basis(Vector3.UP, -yaw), c))
	var P := PLINTH_M
	var red := Parts.RED
	var hs := S * 0.5
	# the plinth with a blind arcade round it
	m.box(Vector3(0, (P - 0.6) * 0.5, 0), Vector3(S, P + 0.6, S), red)
	if lod <= 1:
		for k in 4:
			m.push(Transform3D(Basis(Vector3.UP, k * PI * 0.5), Vector3.ZERO))
			var n := int(S / 4.2)
			for i in n:
				var x := -hs + 2.1 + i * 4.2
				if absf(x) < 16.0 and k != 2:
					continue
				m.push(Transform3D(Basis.IDENTITY, Vector3(x, 0.4, -hs)))
				Parts.blind_arch(m, 0.0, 0.0, 2.6, 2.0, 1.3, lod, Parts.RED_LIGHT, Parts.RED_DARK, 0.08)
				m.pop()
			m.pop()
	# the courtyard floor and the tank (hauz) in its middle
	if lod <= 2:
		m.box(Vector3(0, P + 0.02, 0), Vector3(S - 12.0, 0.04, S - 12.0), Parts.RED_LIGHT, 0.0, false, false)
		m.box(Vector3(0, P + 0.25, -4.0), Vector3(17.0, 0.5, 14.0), Parts.MARBLE, 0.0, false, false)
		m.box(Vector3(0, P + 0.4, -4.0), Vector3(15.0, 0.3, 12.0), Color("#4f7f8f"), 0.0, false, false)
	# the arcades (dalan) round the courtyard on the north, south and east
	var arc_h := 7.0
	var arc_d := 6.0
	for k in [0, 1, 3]:
		m.push(Transform3D(Basis(Vector3.UP, k * PI * 0.5), Vector3.ZERO))
		_arcade(m, hs, arc_d, P, arc_h, lod)
		m.pop()
	# the gates: east (the front, -z), north and south; flights of steps down to the street
	_gate(m, Vector3(0, P, -hs), 0.0, 30.0, 18.0, 17.0, lod, true)
	_steps(m, Vector3(0, 0, -hs - 9.0 - 5.0), 0.0, 32.0, 10.0, P, lod)
	for xs in [-1.0, 1.0]:
		_gate(m, Vector3(xs * hs, P, 2.0), -xs * PI * 0.5, 22.0, 14.0, 13.0, lod, false)
		_steps(m, Vector3(xs * (hs + 7.0 + 4.5), 0, 2.0), -xs * PI * 0.5, 24.0, 9.0, P, lod)
	# the prayer hall on the west (+z), its central iwan and arches, three domes, two minarets
	m.use("hall")
	var hw := 61.0
	var hd := 27.5
	var hz := hs - hd * 0.5 - 1.0
	var hh := 16.0
	m.box(Vector3(0, P + hh * 0.5, hz), Vector3(hw, hh, hd), red)
	if lod <= 2:
		m.box(Vector3(0, P + hh + 0.3, hz), Vector3(hw + 0.8, 0.6, hd + 0.8), Parts.MARBLE)
	var face := hz - hd * 0.5
	# the facade: the central pishtaq rising over the hall, five arches either side, white marble frames
	var pw := 18.0
	var ph := 23.0
	m.box(Vector3(0, P + ph * 0.5, face + 2.0), Vector3(pw, ph, 4.4), red)
	if lod <= 2:
		m.push(Transform3D(Basis.IDENTITY, Vector3(0, P, face - 0.2)))
		Parts.blind_arch(m, 0.0, 0.0, 11.0, 10.0, 6.0, mini(lod, 1), Parts.MARBLE, Color("#5a3428"), 0.25)
		m.pop()
		m.box(Vector3(0, P + ph - 2.0, face - 0.25), Vector3(pw - 1.6, 2.2, 0.1), Parts.MARBLE, 0.0, false, false)
		for xs in [-1.0, 1.0]:
			for i in 5:
				var x: float = xs * (pw * 0.5 + 2.2 + i * 4.9)
				m.push(Transform3D(Basis.IDENTITY, Vector3(x, P, face - 0.02)))
				Parts.blind_arch(m, 0.0, 0.0, 3.6, 5.5, 2.6, lod, Parts.MARBLE, Color("#5a3428"), 0.15)
				m.pop()
	if lod <= 1:
		Parts.merlons(m, Vector3(-hw * 0.5, P + hh + 0.6, face + 0.4), Vector3(-pw * 0.5, P + hh + 0.6, face + 0.4), Vector3(0, 0, -1), 0.9, 1.3, 0.5, lod, Parts.MARBLE)
		Parts.merlons(m, Vector3(pw * 0.5, P + hh + 0.6, face + 0.4), Vector3(hw * 0.5, P + hh + 0.6, face + 0.4), Vector3(0, 0, -1), 0.9, 1.3, 0.5, lod, Parts.MARBLE)
	for xs in [-1.0, 1.0]:
		if lod >= 3:
			break
		# small minarets at the corners of the pishtaq
		Parts.minaret(m, Vector3(xs * (pw * 0.5 + 0.6), P + ph - 6.0, face + 0.6), 0.9, 11.0, maxi(lod, 1), Parts.MARBLE_SHADE, Parts.MARBLE_SHADE, Parts.MARBLE, 8)
	# domes on drums: the central one and the two side ones, marble with black stripes
	var y0 := P + hh + 0.6
	_dome(m, Vector3(0, y0, hz + 1.0), 9.0, 3.2, 11.5, lod)
	for xs in [-1.0, 1.0]:
		_dome(m, Vector3(xs * 19.5, y0, hz + 1.5), 6.3, 2.2, 8.5, lod)
	# the two minarets at the front corners of the hall, tips at the registry height above the foot
	for xs in [-1.0, 1.0]:
		Parts.minaret(m, Vector3(xs * (hw * 0.5 + 2.6), P, face + 2.0), 3.0, H - P - 0.9, lod, red, Parts.MARBLE, Parts.MARBLE, 16)
		if m.collide:
			m.solid(Vector3(xs * (hw * 0.5 + 2.6), P + (H - P) * 0.5, face + 2.0), Vector3(5.0, H - P, 5.0))
	# chhatris on the four corners of the courtyard
	for cx in ([-1.0, 1.0] if lod <= 2 else []):
		for cz in [-1.0, 1.0]:
			var cc := Vector3(cx * (hs - arc_d * 0.5), P + arc_h, cz * (hs - arc_d * 0.5))
			if cz > 0.0:
				# the west corners are the ends of the prayer hall: their chhatris stand on its roof
				cc = Vector3(cx * (hw * 0.5 - 3.5), P + hh + 0.6, hz)
			Parts.chhatri(m, cc, 3.2, 8.0, lod, Parts.RED_LIGHT, Parts.MARBLE, 8, true)
	if m.collide:
		m.solid(Vector3(0, P + hh * 0.5, hz), Vector3(hw, hh, hd))
	var top := m.top
	m.pop()
	return {"heightM": top, "heightPart": "the tips of the two minarets above the foot of the steps"}


## A dome on its drum at c (the drum's foot): marble in black stripes at full detail, a golden finial.
static func _dome(m: KitMesh, c: Vector3, r: float, drum: float, h: float, lod: int) -> void:
	m.cyl(c, r * 0.86, drum, Parts.seg(lod, 32), Parts.MARBLE_SHADE, 1.0, false)
	m.cyl(c + Vector3(0, drum, 0), r * 0.92, 0.4, Parts.seg(lod, 32), Parts.MARBLE, 1.0, true)
	var y := drum + 0.4
	var prof := PackedVector2Array([Vector2(r * 0.84, 0.0), Vector2(r * 0.95, h * 0.1), Vector2(r, h * 0.27), Vector2(r * 0.96, h * 0.45),
		Vector2(r * 0.82, h * 0.62), Vector2(r * 0.58, h * 0.78), Vector2(r * 0.3, h * 0.9), Vector2(r * 0.1, h * 0.97), Vector2(0.0, h)])
	if lod <= 1:
		# white marble with thin black stripes (a quarter of the turn black at full detail, an eighth at level 1)
		m.striped_lathe(prof, 64 if lod == 0 else 32, c + Vector3(0, y, 0), Parts.MARBLE, Parts.BLACK_MARBLE.lerp(Parts.MARBLE, 0.25), 3 if lod == 0 else 7, 1)
		Parts.kalash(m, c + Vector3(0, y + h * 0.98, 0), r * 0.13, lod, Parts.BRASS)
	else:
		Parts.onion_dome(m, c + Vector3(0, y, 0), r, h, lod, Parts.MARBLE)


## One side of the arcade round the courtyard, built facing -z at distance hs: an outer wall with blind arches and
## merlons, the open arches facing the courtyard.
static func _arcade(m: KitMesh, hs: float, d: float, P: float, h: float, lod: int) -> void:
	var len := hs * 2.0
	m.box(Vector3(0, P + h * 0.5, -hs + d * 0.5), Vector3(len, h, d), Parts.RED)
	if lod >= 3:
		return
	if lod <= 1:
		Parts.merlons(m, Vector3(-hs, P + h, -hs + 0.4), Vector3(hs, P + h, -hs + 0.4), Vector3(0, 0, -1), 1.0, 1.4, 0.6, lod, Parts.RED)
	var n := int(len / 5.0)
	for i in n:
		var x := -hs + 2.5 + i * 5.0
		if absf(x) < 17.0:
			continue
		if lod <= 1:
			m.push(Transform3D(Basis.IDENTITY, Vector3(x, P + 1.0, -hs)))
			Parts.blind_arch(m, 0.0, 0.0, 2.4, 2.6, 1.5, lod, Parts.RED_LIGHT, Parts.RED_DARK, 0.08)
			m.pop()
		# the open arches on the courtyard side (dark recesses facing +z)
		m.push(Transform3D(Basis(Vector3.UP, PI), Vector3(x, P, -hs + d + 0.01)))
		Parts.blind_arch(m, 0.0, 0.0, 3.4, 3.6, 2.0, mini(lod, 1), Parts.RED_LIGHT, Color("#3a2620"), 0.1)
		m.pop()


## A gate on the courtyard edge at c (plinth top), turned yaw, facing -z: a block with a recessed pointed arch, a
## dark passage, merlons and two chhatris; the east gate is taller and carries a row of small domes.
static func _gate(m: KitMesh, c: Vector3, yaw: float, w: float, d: float, h: float, lod: int, main: bool) -> void:
	m.push(Transform3D(Basis(Vector3.UP, yaw), c))
	m.box(Vector3(0, h * 0.5, 0), Vector3(w, h, d), Parts.RED)
	if lod <= 2:
		m.push(Transform3D(Basis.IDENTITY, Vector3(0, 0, -d * 0.5)))
		Parts.blind_arch(m, 0.0, 0.0, w * 0.42, h * 0.48, w * 0.2, mini(lod, 1), Parts.MARBLE, Color("#2e211b"), 0.2)
		m.pop()
	if lod <= 1:
		Parts.merlons(m, Vector3(-w * 0.5, h, -d * 0.5 + 0.4), Vector3(w * 0.5, h, -d * 0.5 + 0.4), Vector3(0, 0, -1), 1.0, 1.4, 0.6, lod, Parts.RED)
	for xs in ([-1.0, 1.0] if lod <= 2 else []):
		Parts.chhatri(m, Vector3(xs * (w * 0.5 - 2.2), h, -d * 0.5 + 2.2), 2.0, 5.5, lod, Parts.RED_LIGHT, Parts.MARBLE, 6, true)
	if main and lod <= 2:
		for k in 5:
			var x := -6.0 + k * 3.0
			Parts.chhatri(m, Vector3(x, h, -d * 0.5 + 1.6), 0.9, 3.2, maxi(lod, 1), Parts.RED_LIGHT, Parts.MARBLE, 4, true)
	m.pop()


## A broad flight of steps centred at c on the street, turned yaw, climbing towards +z up to height P over `run` m.
static func _steps(m: KitMesh, c: Vector3, yaw: float, w: float, run: float, P: float, lod: int) -> void:
	m.push(Transform3D(Basis(Vector3.UP, yaw), c))
	var n := 14 if lod == 0 else (5 if lod == 1 else 1)
	for i in n:
		var t0 := float(i) / n
		var depth := run * (1.0 - t0)
		var y1 := P * (i + 1) / float(n)
		m.box(Vector3(0, (y1 - 0.6) * 0.5, run * t0 * 0.5), Vector3(w, y1 + 0.6, depth), Parts.RED_LIGHT if i % 2 == 0 else Parts.RED_LIGHT.darkened(0.05), 0.0, false, i == 0)
	m.pop()
