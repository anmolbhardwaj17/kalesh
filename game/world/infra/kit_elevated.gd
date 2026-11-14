## The elevated metro and the foot over bridges (P2-034, metro.md MET-VB1 and MET-RAMP, foot_over_bridges.md):
##   MET-VB1  Phase I viaduct: one box girder for both tracks (9.5 m wide), a bold parapet, track on plinths, OHE
##            masts on the deck; round tapered piers flaring into a Y cap; a U trough between walls where the line is
##            near the ground (the ramp to the tunnel portal, MET-RAMP)
##   FOB-B1   New Delhi station: silver steel arch ribs over a 5 m deck
##   FOB-B2   railway platform bridge: steel truss sides under a blue sheet roof
##   FOB-B3   ITO skywalk: white steel, red granite floor, a white tensile membrane roof
##   FOB-B4   PWD steel road FOB: blue-grey girders, mesh side panels, a sheet roof, stairs at the ends
##   FOB-B5   the plain old one: a narrow walkway with a pipe railing, no roof
## Kit inputs are world metres. Pure.
extends RefCounted

const KitMesh := preload("res://world/landmarks/kit_mesh.gd")
const K := preload("res://world/infra/infra_kit.gd")

const METRO := Color("#9b9994")
const METRO_DARK := Color("#7f7d78")
const PLINTH := Color("#b0aca4")
const RUST := Color("#6b4a36")
const GALV := Color("#8e9296")
const FLOOR := Color("#9a8d80")
const GRANITE := Color("#8f4a3e")
const ROOF_BLUE := Color("#4c5f70")
const MEMBRANE := Color("#ecebe6")
const STEEL := {"FOB-B1": Color("#b7bcc0"), "FOB-B2": Color("#6f7a82"), "FOB-B3": Color("#e6e3dc"), "FOB-B4": Color("#4f6d8a"), "FOB-B5": Color("#6b6f72")}
## Where the rail is less than this over the ground the line runs in a trough (tools/bake/infra/elevated.ts).
const TROUGH_M := 4.5


static func _frames_of(pts: Array, xi: int, yi: int, zi: int, dy := 0.0) -> Array:
	var n := pts.size()
	var P := []
	for q: Array in pts:
		P.append(Vector3(float(q[xi]), float(q[yi]) + dy, float(q[zi])))
	var out := []
	for k in n:
		var a: Vector3 = P[maxi(0, k - 1)]
		var b: Vector3 = P[mini(n - 1, k + 1)]
		var d := Vector2(b.x - a.x, b.z - a.z).normalized()
		out.append([P[k], Vector3(-d.y, 0, d.x), Vector3.UP])
	return out


## A metro deck: [x, rail level, z, ground] per point.
static func metro_deck(base: KitMesh, near: KitMesh, d: Dictionary) -> void:
	var pts := K.points(d.p, 4)
	var n := pts.size()
	if n < 2:
		return
	var twin := int(d.get("twin", 0)) == 1
	var W := 9.5 if twin else 5.5
	var hw := W * 0.5
	var frames := _frames_of(pts, 0, 1, 2)
	var G := PackedFloat32Array()
	for q: Array in pts:
		G.append(float(q[3]))
	# runs of segments on the box and in the trough
	var k := 0
	while k < n - 1:
		var trough := float((pts[k] as Array)[1]) - G[k] < TROUGH_M or float((pts[k + 1] as Array)[1]) - G[k + 1] < TROUGH_M
		var j := k
		while j < n - 1 and (float((pts[j] as Array)[1]) - G[j] < TROUGH_M or float((pts[j + 1] as Array)[1]) - G[j + 1] < TROUGH_M) == trough:
			j += 1
		var run := frames.slice(k, j + 1)
		if trough:
			_trough(base, run, G.slice(k, j + 1), hw)
		else:
			_box(base, run, W)
		k = j
	# the track: a plinth under each rail and the rails (near), OHE masts on the deck every 30 m
	var tracks := [-1.9, 1.9] if twin else [0.0]
	for tx: float in tracks:
		for s: float in [-0.8, 0.8]:
			K.sweep(near, frames, PackedVector2Array([Vector2(tx + s - 0.25, -0.45), Vector2(tx + s - 0.25, -0.17), Vector2(tx + s + 0.25, -0.17), Vector2(tx + s + 0.25, -0.45)]), Vector2(tx + s, -0.6), PLINTH)
			near.use("main", "metal")
			K.sweep(near, frames, PackedVector2Array([Vector2(tx + s - 0.035, -0.17), Vector2(tx + s - 0.035, 0.0), Vector2(tx + s + 0.035, 0.0), Vector2(tx + s + 0.035, -0.17)]), Vector2(tx + s, -0.3), RUST)
			near.use("main", "matte")
	base.use("main", "metal")
	var walk := 0.0
	for i in n - 1:
		var a: Vector3 = frames[i][0]
		var b: Vector3 = frames[i + 1][0]
		var len := Vector2(b.x - a.x, b.z - a.z).length()
		var t0 := 30.0 - fmod(walk, 30.0)
		while t0 < len:
			var p := a.lerp(b, t0 / len)
			var u: Vector3 = frames[i][1]
			var g := lerpf(G[i], G[i + 1], t0 / len)
			if p.y - g > 1.0:
				var mx := p + (Vector3.ZERO if twin else u * (hw - 0.6))
				base.cyl(mx - Vector3.UP * 0.45, 0.13, 6.4, 6, GALV)
				for tx: float in tracks:
					K.beam_box(base, mx + Vector3.UP * 5.6, p + u * tx + Vector3.UP * 5.6, 0.08, 0.1, GALV)
			t0 += 30.0
		walk += len
	base.use("main", "matte")
	for tx: float in tracks:
		var wires := []
		for f: Array in frames:
			wires.append([(f[0] as Vector3) + (f[1] as Vector3) * tx + Vector3.UP * 5.15, f[1], Vector3.UP])
		K.sweep(near, wires, PackedVector2Array([Vector2(-0.015, 0), Vector2(0.015, 0), Vector2(0.015, 0.03), Vector2(-0.015, 0.03)]), Vector2(0, 0.015), Color("#3b3a38"), true)


## The box girder: the deck slab with its wings, the box under it, a bold parapet each side.
static func _box(base: KitMesh, frames: Array, W: float) -> void:
	var hw := W * 0.5
	K.sweep(base, frames, PackedVector2Array([Vector2(-hw, -0.45), Vector2(hw, -0.45), Vector2(hw, -0.85), Vector2(0.27 * W, -1.25), Vector2(-0.27 * W, -1.25), Vector2(-hw, -0.85)]), Vector2(0, -0.8), METRO, true)
	K.sweep(base, frames, PackedVector2Array([Vector2(0.27 * W, -1.25), Vector2(0.2 * W, -2.55), Vector2(-0.2 * W, -2.55), Vector2(-0.27 * W, -1.25)]), Vector2(0, -1.6), METRO_DARK)
	for s: float in [-1.0, 1.0]:
		var x0 := hw * s
		var x1 := (hw - 0.3) * s
		# the outer face leans out as it rises (metro.md: "a bold sloped face")
		K.sweep(base, frames, PackedVector2Array([Vector2(x0, -0.85), Vector2(x0 + 0.18 * s, 0.75), Vector2(x1, 0.75), Vector2(x1, -0.45)]), Vector2((hw - 0.15) * s, -0.2), METRO)


## The U trough near the ground: two walls from the ground to above the rail, and the floor.
static func _trough(base: KitMesh, frames: Array, G: PackedFloat32Array, hw: float) -> void:
	var n := frames.size()
	for s: float in [-1.0, 1.0]:
		for i in n - 1:
			var a: Vector3 = frames[i][0]
			var b: Vector3 = frames[i + 1][0]
			var ua: Vector3 = frames[i][1]
			var ub: Vector3 = frames[i + 1][1]
			var top_a := a.y + 0.9
			var top_b := b.y + 0.9
			var foot_a := minf(G[i], a.y - 0.45) - 0.3
			var foot_b := minf(G[i + 1], b.y - 0.45) - 0.3
			if top_a < G[i] and top_b < G[i + 1]:
				continue
			for face: float in [0.0, 0.35]:
				var oa := ua * s * (hw + face)
				var ob := ub * s * (hw + face)
				var want := ua * s * (1.0 if face > 0.0 else -1.0)
				K.oquad(base, Vector3(a.x, foot_a, a.z) + oa, Vector3(b.x, foot_b, b.z) + ob, Vector3(b.x, top_b, b.z) + ob, Vector3(a.x, top_a, a.z) + oa, want, METRO)
			K.oquad(base, Vector3(a.x, top_a, a.z) + ua * s * hw, Vector3(b.x, top_b, b.z) + ub * s * hw, Vector3(b.x, top_b, b.z) + ub * s * (hw + 0.35), Vector3(a.x, top_a, a.z) + ua * s * (hw + 0.35), Vector3.UP, METRO)
	K.sweep(base, frames, PackedVector2Array([Vector2(-hw, -0.45), Vector2(hw, -0.45)]), Vector2(0, -1.0), METRO_DARK)


## A metro pier: a round tapered column flaring into a Y cap under the box, bearings on top.
static func metro_pier(base: KitMesh, near: KitMesh, p: Dictionary) -> void:
	var c := Vector2(float(p.x), float(p.z))
	var d := Vector2(float(p.dx), float(p.dz)).normalized()
	var y0 := float(p.y0)
	var y1 := float(p.y1)
	var r := float(p.get("r", 0.8))
	var deck := float(p.d)
	var cap := 1.8
	base.cyl(Vector3(c.x, y0, c.y), r, y1 - cap - y0, 14, METRO, 0.96)
	# the Y: two arms rising out from the column to under the box's webs
	var nn := Vector2(-d.y, d.x)
	for s: float in [-1.0, 1.0]:
		var foot := c + nn * s * r * 0.3
		var head := c + nn * s * deck * 0.24
		var a := Vector3(foot.x, y1 - cap, foot.y)
		var b := Vector3(head.x, y1 - 0.2, head.y)
		_slab_between(base, a, b, d, 0.9, 0.7, METRO)
	K.prism(base, K.rect(c, d, 0.8, deck * 0.29), y1 - 0.45, y1 - 0.2, METRO)
	for s: float in [-1.0, 1.0]:
		K.post(near, Vector3(c.x, y1 - 0.2, c.y) + Vector3(nn.x, 0, nn.y) * s * deck * 0.2, Vector3(0.6, 0.2, 0.6), d, Color("#4a4846"))
	# a crash barrier ring at the foot where it stands on a median (metro.md)
	near.cyl(Vector3(c.x, y0 + 1.0, c.y), r + 0.35, 0.6, 12, Color("#f2c230"))


## A sloping block from a to b (a centre line), `along` thick on the deck direction and `w` wide across.
static func _slab_between(m: KitMesh, a: Vector3, b: Vector3, d: Vector2, along: float, w: float, col: Color) -> void:
	var dd := Vector3(d.x, 0, d.y) * along * 0.5
	var across := (Vector3(b.x - a.x, 0, b.z - a.z)).normalized()
	if across.length() < 0.5:
		across = Vector3(-d.y, 0, d.x)
	var side := across * w * 0.5
	var corners := [a - dd - side, a + dd - side, a + dd + side, a - dd + side]
	var tops := [b - dd - side, b + dd - side, b + dd + side, b - dd + side]
	var mid := (a + b) * 0.5
	for k in 4:
		var p0: Vector3 = corners[k]
		var p1: Vector3 = corners[(k + 1) % 4]
		var q1: Vector3 = tops[(k + 1) % 4]
		var q0: Vector3 = tops[k]
		var want := (p0 + p1 + q0 + q1) * 0.25 - mid
		want.y = 0.0
		K.oquad(m, p0, p1, q1, q0, want, col)
	K.oquad(m, tops[0], tops[1], tops[2], tops[3], Vector3.UP, col)


## A foot bridge column: a round steel column in the variant's paint with a head plate.
static func fob_column(base: KitMesh, p: Dictionary) -> void:
	var col: Color = STEEL.get(str(p.v), STEEL["FOB-B4"])
	var c := Vector3(float(p.x), float(p.y0), float(p.z))
	var r := float(p.get("r", 0.35))
	base.use("main", "metal")
	base.cyl(c, r, float(p.y1) - c.y, 10, col)
	K.post(base, Vector3(c.x, float(p.y1) - 0.05, c.z), Vector3(1.0, 0.1, 1.0), Vector2(float(p.dx), float(p.dz)), col)
	base.use("main", "matte")


## A foot bridge off the road graph: the walking deck, its sides and roof by variant, and its stairs.
static func fob(base: KitMesh, near: KitMesh, f: Dictionary) -> void:
	var v := str(f.v)
	var w := float(f.w)
	var h := float(f.h)
	var flat: Array = f.p
	var pts := []
	for k in flat.size() / 2:
		pts.append([float(flat[k * 2]), h, float(flat[k * 2 + 1])])
	if pts.size() < 2:
		return
	var frames := _frames_of(pts, 0, 1, 2)
	var steel: Color = STEEL.get(v, STEEL["FOB-B4"])
	var hw := w * 0.5
	# the floor and its edge girders
	# the slab in grey steel and concrete, the walking surface on it in the floor's own colour (granite, tiles)
	K.sweep(base, frames, PackedVector2Array([Vector2(-hw, 0.0), Vector2(-hw, -0.25), Vector2(hw, -0.25), Vector2(hw, 0.0)]), Vector2(0, 0.5), steel.darkened(0.15) if v != "FOB-B3" else steel)
	K.sweep(base, frames, PackedVector2Array([Vector2(-hw, 0.0), Vector2(hw, 0.0)]), Vector2(0, -1.0), GRANITE if v == "FOB-B3" else FLOOR)
	base.use("main", "metal")
	if v != "FOB-B5":
		for s: float in [-1.0, 1.0]:
			var x := (hw - 0.15) * s
			K.sweep(base, frames, PackedVector2Array([Vector2(x - 0.15, -0.25), Vector2(x - 0.15, -1.0), Vector2(x + 0.15, -1.0), Vector2(x + 0.15, -0.25)]), Vector2(x, -0.6), steel)
	# hand rails both sides
	for s: float in [-1.0, 1.0]:
		for y: float in ([1.1, 0.55] if v != "FOB-B5" else [1.0, 0.5]):
			var x := (hw - 0.05) * s
			K.sweep(base, frames, PackedVector2Array([Vector2(x - 0.03, y), Vector2(x + 0.03, y), Vector2(x + 0.03, y + 0.05), Vector2(x - 0.03, y + 0.05)]), Vector2(x, y + 0.025), steel, true)
	base.use("main", "matte")
	# posts, panels, frames and the roof every few metres
	var every := 6.0 if v == "FOB-B1" or v == "FOB-B3" else 3.0
	var marks := []
	var walk := 0.0
	for i in frames.size() - 1:
		var a: Vector3 = frames[i][0]
		var b: Vector3 = frames[i + 1][0]
		var len := Vector2(b.x - a.x, b.z - a.z).length()
		var t0 := fmod(every - fmod(walk, every), every)
		while t0 <= len:
			marks.append([a.lerp(b, t0 / maxf(len, 1e-4)), frames[i][1], Vector2(b.x - a.x, b.z - a.z) / maxf(len, 1e-4)])
			t0 += every
		walk += len
	near.use("main", "metal")
	base.use("main", "metal")
	for mk: Array in marks:
		var p: Vector3 = mk[0]
		var u: Vector3 = mk[1]
		var d: Vector2 = mk[2]
		match v:
			"FOB-B1":
				# an arch rib over the deck: a half ellipse 3.4 m high
				var prev := p - u * hw
				for k in range(1, 9):
					var a := PI * k / 8.0
					var q := p - u * hw * cos(a) + Vector3.UP * 3.4 * sin(a)
					base.rod(prev, q, 0.09, 6, steel)
					prev = q
			"FOB-B2", "FOB-B4":
				for s: float in [-1.0, 1.0]:
					K.post(base, p + u * (hw - 0.05) * s, Vector3(0.1, 2.7, 0.1), d, steel)
				K.post(base, p + Vector3.UP * 2.7, Vector3(w + 0.3, 0.12, 0.12), d, steel)
			"FOB-B3":
				for s: float in [-1.0, 1.0]:
					K.post(base, p + u * (hw - 0.1) * s, Vector3(0.18, 3.0, 0.18), d, steel)
			_:
				for s: float in [-1.0, 1.0]:
					K.post(near, p + u * (hw - 0.05) * s, Vector3(0.05, 1.05, 0.05), d, steel)
	base.use("main", "matte")
	near.use("main", "matte")
	match v:
		"FOB-B1":
			# the silver skin over the ribs (foot_over_bridges.md: a closed tube of repeated oval arches); one sided, so
			# from inside the walk it reads as the open oval windows of the real one
			base.use("main", "metal")
			var arc := PackedVector2Array()
			for k in 13:
				var a := PI * k / 12.0
				arc.append(Vector2(-hw * cos(a) * 1.04, 0.9 + 2.6 * sin(a)))
			K.sweep(base, frames, arc, Vector2(0, 1.5), steel.darkened(0.05))
			base.use("main", "matte")
		"FOB-B2", "FOB-B4":
			# a sheet roof, blue on a platform bridge, grey on a road one; mesh panels in the sides
			K.sweep(base, frames, PackedVector2Array([Vector2(-hw - 0.35, 2.75), Vector2(hw + 0.35, 2.95), Vector2(hw + 0.35, 3.0), Vector2(-hw - 0.35, 2.8)]), Vector2(0, 2.87), ROOF_BLUE if v == "FOB-B2" else Color("#8b9196"), true)
			for s: float in [-1.0, 1.0]:
				K.sweep(near, frames, PackedVector2Array([Vector2((hw - 0.06) * s, 0.1), Vector2((hw - 0.06) * s, 1.1)]), Vector2((hw - 0.5) * s, 0.6), Color("#3a3f44"))
				K.sweep(near, frames, PackedVector2Array([Vector2((hw - 0.04) * s, 0.1), Vector2((hw - 0.04) * s, 1.1)]), Vector2((hw + 0.5) * s, 0.6), Color("#3a3f44"))
		"FOB-B3":
			# the white tensile membrane: a tent ridge over the walk
			for s: float in [-1.0, 1.0]:
				K.sweep(base, frames, PackedVector2Array([Vector2(0.0, 4.2), Vector2((hw + 0.4) * s, 3.0)]), Vector2((hw * 0.3) * s, 2.0), MEMBRANE)
				K.sweep(base, frames, PackedVector2Array([Vector2(0.0, 4.2), Vector2((hw + 0.4) * s, 3.0)]), Vector2((hw * 0.3) * s, 6.0), MEMBRANE.darkened(0.1))
	# the stairs: a sloping flight from the deck end down to the ground, treads near, rails both sides
	for st: Array in f.get("stairs", []):
		_stair(base, near, Vector3(float(st[0]), h, float(st[1])), Vector2(float(st[2]), float(st[3])), float(st[4]), minf(2.5, w), steel)


static func _stair(base: KitMesh, near: KitMesh, top: Vector3, d: Vector2, rise: float, w: float, steel: Color) -> void:
	if rise < 0.5:
		return
	var run := rise / 0.62
	var dir := Vector3(d.x, 0, d.y).normalized()
	var u := Vector3(-dir.z, 0, dir.x)
	var bottom := top + dir * run - Vector3.UP * rise
	var hw := w * 0.5
	var frames := [[top, u, Vector3.UP], [bottom, u, Vector3.UP]]
	K.sweep(base, frames, PackedVector2Array([Vector2(-hw, -0.3), Vector2(hw, -0.3), Vector2(hw, 0.0), Vector2(-hw, 0.0)]), Vector2(0, -0.15), FLOOR.darkened(0.1), true)
	base.use("main", "metal")
	for s: float in [-1.0, 1.0]:
		K.sweep(base, [[top + Vector3.UP * 0.95, u, Vector3.UP], [bottom + Vector3.UP * 0.95, u, Vector3.UP]], PackedVector2Array([Vector2(hw * s - 0.03, 0), Vector2(hw * s + 0.03, 0), Vector2(hw * s + 0.03, 0.05), Vector2(hw * s - 0.03, 0.05)]), Vector2(hw * s, 0.025), steel, true)
	base.use("main", "matte")
	var steps := int(ceil(rise / 0.17))
	for k in steps:
		var f := (float(k) + 0.5) / steps
		var p := top.lerp(bottom, f)
		K.post(near, p - Vector3.UP * 0.02, Vector3(w, 0.1, run / steps + 0.02), d, Color("#b5b1a8") if k % 2 == 0 else Color("#aaa69e"))


## The Signature Bridge (bridges.md BRI-Y2) as a far skyline piece: a 675 m deck over the river, the bent white steel
## pylon (154 m, its two legs joining into one tilted spire with the viewing box) and the cable fans. Local frame: the
## deck along +X, the pylon's foot at x = -80, the deck top at y = 14.
static func signature_bridge(m: KitMesh) -> void:
	var white := Color("#e8e8e4")
	var grey := Color("#a9a8a3")
	K.beam_box(m, Vector3(-337, 11, 0), Vector3(337, 11, 0), 35.0, 3.0, grey)
	for x in range(-300, 320, 60):
		m.box(Vector3(x, 5.5, 0), Vector3(5, 11, 14), grey)
	var foot := [Vector3(-80, 14, -15), Vector3(-80, 14, 15)]
	var join := Vector3(-118, 108, 0)
	var spire := Vector3(-136, 154, 0)
	for f: Vector3 in foot:
		m.rod(f, join, 2.6, 6, white)
	m.rod(join, spire, 2.2, 6, white)
	m.box(Vector3(-131, 140, 0), Vector3(16, 9, 11), Color("#c9d3d8"))
	# cables: the main span's fan from the upper pylon, the back stays to the short side
	for side: float in [-1.0, 1.0]:
		for k in 14:
			var top := join.lerp(spire, 0.15 + 0.06 * k)
			var deck := Vector3(-55 + k * 16.0, 14, 16.5 * side)
			_ribbon(m, top, deck, 0.8, white)
		for k in 8:
			var top := join.lerp(spire, 0.2 + 0.08 * k)
			var deck := Vector3(-160 - k * 18.0, 14, 16.5 * side)
			_ribbon(m, top, deck, 0.8, white)


## A thin flat strip from a to b, w wide, facing both ways (a cable seen from far).
static func _ribbon(m: KitMesh, a: Vector3, b: Vector3, w: float, col: Color) -> void:
	var d := (b - a).normalized()
	var side := d.cross(Vector3.UP).normalized() * (w * 0.5)
	if side.length() < 1e-4:
		side = Vector3(w * 0.5, 0, 0)
	var n := side.cross(d).normalized()
	K.oquad(m, a - side, b - side, b + side, a + side, n, col)
	K.oquad(m, a - side, b - side, b + side, a + side, -n, col)
