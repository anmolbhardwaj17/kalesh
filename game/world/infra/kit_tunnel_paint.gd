## The Pragati Maidan tunnel's paint (P2-032, TUN-T1 of game/world/infra/kit_tunnel.gd, from the owner's photos in
## harness/design/reference/owner/pragati_maidan_tunnel/): the inside wave band, the ramps' river scene and the wide
## section's painted pillars. The art itself is drawn by tunnel_mural.gdshader (materials "mural_wave", "mural_ramp",
## "mural_pillar" of game/world/systems/infra.gd), so it stays sharp at driving distance; this file lays the quads with
## UV = (metres along the run, metres over the road). Pure.
extends RefCounted

const KitMesh := preload("res://world/landmarks/kit_mesh.gd")
const K := preload("res://world/infra/infra_kit.gd")
const T := preload("res://world/infra/kit_tunnel.gd")

const PILLAR_EVERY_M := 2.4
const PILLAR_W_M := 1.1
## A pillar's shaft and plinth stand on the kerb in front of the wall (the kerb is 0.3 m deep): never over the road.
const SHAFT_D_M := 0.27
const PLINTH_D_M := 0.29
const PLINTH_W_M := 1.5
const PLINTH_H_M := 0.9
const PILLAR_GAP := Color("#8a877e")
const PILLAR_BAND := Color("#5b2f86")
const PILLAR_COLS := [Color("#f07a2a"), Color("#7b3f9e"), Color("#1f8f8f"), Color("#f2b51c")]
## The road finish inside a roofed stretch: light grey concrete (its wear is drawn by tunnel_lit.gdshader).
const ROAD := Color("#b5b3ac")
const ROAD_STRIPS := 4
## The bake's kerb and footpath top over the road, and the kerb's width (m).
const KERB_H_M := 0.15
const KERB_W_M := 0.3
## The ramp shader reads the height left to the wall top from the colour's red channel, over this many metres.
const LEFT_SCALE_M := 16.0


## The mural of one wall segment from the dado to its top: inside (roofed) the wave band from 1.0 m, on a ramp the
## river scene from 0.7 m. a and b are the road edge at the lane top (offset off the wall), ta and tb the wall top.
## Cut into bands up the wall (`T.heights`) so the strip light, worked out per vertex, falls off down the wall.
static func band(m: KitMesh, a: Vector3, b: Vector3, ta: float, tb: float, sa: float, sb: float, want: Vector3, roofed: bool) -> void:
	var y0 := 1.0 if roofed else 0.7
	if ta - a.y <= y0 + 0.02 and tb - b.y <= y0 + 0.02:
		return
	m.use("main", "mural_wave" if roofed else "mural_ramp")
	var hp := T.heights_pair(a.y + y0, maxf(ta, a.y + y0), b.y + y0, maxf(tb, b.y + y0))
	var ya: PackedFloat32Array = hp[0]
	var yb: PackedFloat32Array = hp[1]
	var la := maxf(ta, a.y + y0) - a.y - y0
	var lb := maxf(tb, b.y + y0) - b.y - y0
	for k in ya.size() - 1:
		# the ramp shader reads the height left to the wall top from the red channel
		var c0 := Color((la - (ya[k] - a.y - y0)) / LEFT_SCALE_M, 0, 0)
		var c1 := Color((lb - (yb[k] - b.y - y0)) / LEFT_SCALE_M, 0, 0)
		var c2 := Color((lb - (yb[k + 1] - b.y - y0)) / LEFT_SCALE_M, 0, 0)
		var c3 := Color((la - (ya[k + 1] - a.y - y0)) / LEFT_SCALE_M, 0, 0)
		_oquad_uv(m, _at(a, ya[k]), _at(b, yb[k]), _at(b, yb[k + 1]), _at(a, ya[k + 1]), Vector2(sa, ya[k] - a.y), Vector2(sb, yb[k] - b.y), Vector2(sb, yb[k + 1] - b.y), Vector2(sa, ya[k + 1] - a.y), c0, c1, c2, c3, want)
	m.use("main", "matte")


## The wall behind the wide section's pillars (owner photo 03): the other carriageway shows between them, so the wall
## there is painted as that lit space, a soft grey over a dark foot, from the plinths up.
static func gap(m: KitMesh, a: Vector3, b: Vector3, ta: float, tb: float, want: Vector3) -> void:
	m.use("main", "tunnel_lit")
	var hp := T.heights_pair(a.y + 0.3, ta, b.y + 0.3, tb)
	var ya: PackedFloat32Array = hp[0]
	var yb: PackedFloat32Array = hp[1]
	for k in ya.size() - 1:
		K.oquad(m, _at(a, ya[k]), _at(b, yb[k]), _at(b, yb[k + 1]), _at(a, ya[k + 1]), want, PILLAR_GAP)
	m.use("main", "matte")


## One pillar of the wide section's central line (owner photo 03), standing on the kerb in front of the wall between
## the two carriageways: a white plinth with orange flame panels and an uplight, a square shaft painted on its front
## and sides (the mandala of tunnel_mural.gdshaderinc, colour by k) up into the soffit's curve, a purple and saffron
## band under the top. `foot` is the wall's foot at the kerb top, `inw` into the road, `d` along the wall (plan).
static func pillar(m: KitMesh, foot: Vector3, top: float, inw: Vector3, d: Vector2, k: int) -> void:
	var along := Vector3(d.x, 0, d.y)
	var hw := PILLAR_W_M * 0.5
	var col: Color = PILLAR_COLS[posmod(k, 4)]
	var h := top - foot.y
	if h < 2.5:
		return
	m.use("main", "tunnel_lit")
	# the plinth and its flame panels
	K.post(m, foot + inw * (PLINTH_D_M * 0.5), Vector3(PLINTH_D_M, PLINTH_H_M, PLINTH_W_M), d, T.WHITE)
	var fr := foot + inw * (PLINTH_D_M + 0.006)
	for j in 3:
		var x := (float(j) - 1.0) * PLINTH_W_M / 3.0
		var w := PLINTH_W_M / 3.0 * 0.48
		_otri(m, fr + along * (x - w), fr + along * (x + w), fr + along * (x + w * 0.35) + Vector3(0, PLINTH_H_M * 0.92, 0), inw, T.ORANGE if j != 1 else T.T1_YELLOW)
		_otri(m, fr + along * (x - w), fr + along * (x - w * 0.2) + Vector3(0, PLINTH_H_M * 0.7, 0), fr + along * (x + w * 0.35) + Vector3(0, PLINTH_H_M * 0.92, 0), inw, T.ORANGE)
	# the uplight on the plinth, black with a lens
	var lamp := foot + inw * (PLINTH_D_M - 0.1) + Vector3(0, PLINTH_H_M, 0)
	K.post(m, lamp, Vector3(0.16, 0.14, 0.2), d, T.BLACK)
	m.use("main", "glow")
	K.post(m, lamp + Vector3(0, 0.14, 0), Vector3(0.12, 0.012, 0.15), d, T.LED)
	# the shaft: front and both sides painted, from the plinth up
	var y0 := foot.y + PLINTH_H_M
	var ys := T.heights(y0, top)
	var f0 := foot + inw * SHAFT_D_M
	m.use("main", "mural_pillar")
	for q in ys.size() - 1:
		var lo := ys[q]
		var hi := ys[q + 1]
		var ul := lo - foot.y
		var uh := hi - foot.y
		_oquad_uv(m, _at(f0 - along * hw, lo), _at(f0 + along * hw, lo), _at(f0 + along * hw, hi), _at(f0 - along * hw, hi), Vector2(0, ul), Vector2(PILLAR_W_M, ul), Vector2(PILLAR_W_M, uh), Vector2(0, uh), col, col, col, col, inw)
		for sg in [-1.0, 1.0]:
			var e: Vector3 = along * (hw * sg)
			_oquad_uv(m, _at(foot + e, lo), _at(f0 + e, lo), _at(f0 + e, hi), _at(foot + e, hi), Vector2(3.0, ul), Vector2(3.0 + SHAFT_D_M, ul), Vector2(3.0 + SHAFT_D_M, uh), Vector2(3.0, uh), col, col, col, col, along * sg)
	# the band under the top: purple, a saffron line over it
	m.use("main", "tunnel_lit")
	var bt := minf(top - 0.75, y0 + h * 0.85)
	var fb := f0 + inw * 0.006
	K.oquad(m, _at(fb - along * hw, bt - 0.45), _at(fb + along * hw, bt - 0.45), _at(fb + along * hw, bt), _at(fb - along * hw, bt), inw, PILLAR_BAND)
	K.oquad(m, _at(fb - along * hw, bt), _at(fb + along * hw, bt), _at(fb + along * hw, bt + 0.14), _at(fb - along * hw, bt + 0.14), inw, T.T1_SAFFRON)
	m.use("main", "matte")


## The road inside a roofed stretch (owner photos 02 and 03): light grey concrete instead of the city's dark asphalt,
## a finish laid 8 mm over the drawn road between the walls under one ceiling run, its height at each corner read from
## the lane lines of the tile (tlines: the road at its stations, level across). Where an edge line runs over 0.5 m off
## a wall there is a raised walkway (the bake's footpath and kerb, 0.15 m): it gets the same finish on its top and a
## black and white striped kerb. Lit by the strips like the walls.
static func road(m: KitMesh, c: Dictionary, lines: Array) -> void:
	var pts := K.points(c.p, 6)
	var n := pts.size()
	if n < 2 or lines.is_empty():
		return
	var segs := []
	var edges := []
	for l: Dictionary in lines:
		var q := K.points(l.p, 3)
		for i in q.size() - 1:
			var sg := [Vector3(float(q[i][0]), float(q[i][1]), float(q[i][2])), Vector3(float(q[i + 1][0]), float(q[i + 1][1]), float(q[i + 1][2]))]
			segs.append(sg)
			if int(l.get("m", 0)) == 3:
				edges.append(sg)
	var L: Array[Vector3] = []
	var R: Array[Vector3] = []
	var WL := PackedFloat32Array()
	var WR := PackedFloat32Array()
	var S := PackedFloat32Array()
	var s := float(c.get("s0", 0.0))
	for i in n:
		var q: Array = pts[i]
		var l := Vector3(float(q[0]), float(q[1]), float(q[2]))
		var r := Vector3(float(q[3]), float(q[4]), float(q[5]))
		var inset := (r - l).normalized() * 0.02
		L.append(Vector3(l.x + inset.x, _road_y(segs, l.x, l.z, l.y), l.z + inset.z))
		R.append(Vector3(r.x - inset.x, _road_y(segs, r.x, r.z, r.y), r.z - inset.z))
		WL.append(_walkway(edges, l, l.y))
		WR.append(_walkway(edges, r, r.y))
		if i > 0:
			s += Vector2((L[i] + R[i]).x - (L[i - 1] + R[i - 1]).x, (L[i] + R[i]).z - (L[i - 1] + R[i - 1]).z).length() * 0.5
		S.append(s)
	m.use("main", "tunnel_lit")
	for i in n - 1:
		if is_nan(L[i].y) or is_nan(R[i].y) or is_nan(L[i + 1].y) or is_nan(R[i + 1].y):
			continue
		var up := Vector3(0, 0.008, 0)
		# the concrete (tunnel_road: UV metres along the run and across from the left wall)
		m.use("main", "tunnel_road")
		var rw0 := Vector2(R[i].x - L[i].x, R[i].z - L[i].z).length()
		var rw1 := Vector2(R[i + 1].x - L[i + 1].x, R[i + 1].z - L[i + 1].z).length()
		for k in ROAD_STRIPS:
			var u0 := float(k) / ROAD_STRIPS
			var u1 := float(k + 1) / ROAD_STRIPS
			_oquad_uv(m, L[i].lerp(R[i], u0) + up, L[i + 1].lerp(R[i + 1], u0) + up, L[i + 1].lerp(R[i + 1], u1) + up, L[i].lerp(R[i], u1) + up,
				Vector2(S[i], rw0 * u0), Vector2(S[i + 1], rw1 * u0), Vector2(S[i + 1], rw1 * u1), Vector2(S[i], rw0 * u1), ROAD, ROAD, ROAD, ROAD, Vector3.UP)
		m.use("main", "tunnel_lit")
		# the walkways: their top in the finish, the kerb at the road side striped black and white
		for side in 2:
			var w0 := WL[i] if side == 0 else WR[i]
			var w1 := WL[i + 1] if side == 0 else WR[i + 1]
			if is_nan(w0) or is_nan(w1):
				continue
			var a0 := L[i] if side == 0 else R[i]
			var a1 := L[i + 1] if side == 0 else R[i + 1]
			var d0 := ((R[i] - L[i]) if side == 0 else (L[i] - R[i]))
			var d1 := ((R[i + 1] - L[i + 1]) if side == 0 else (L[i + 1] - R[i + 1]))
			d0 = Vector3(d0.x, 0, d0.z).normalized()
			d1 = Vector3(d1.x, 0, d1.z).normalized()
			var top := Vector3(0, KERB_H_M + 0.008, 0)
			var k0 := a0 + d0 * (w0 - KERB_W_M) + top
			var k1 := a1 + d1 * (w1 - KERB_W_M) + top
			K.oquad(m, a0 + top, a1 + top, k1, k0, Vector3.UP, ROAD)
			var e0 := a0 + d0 * w0
			var e1 := a1 + d1 * w1
			_kerb(m, k0, k1, e0 + top, e1 + top, e0 + Vector3(0, 0.008, 0), e1 + Vector3(0, 0.008, 0), S[i], S[i + 1], -d0)
	m.use("main", "matte")


## A kerb's top (from k to e, both at its top) and its face (from e's top down to the road), in 0.5 m black and white
## stripes by the run's metres sa to sb; `want` points from the road into the walkway (the face looks the other way).
static func _kerb(m: KitMesh, k0: Vector3, k1: Vector3, e0: Vector3, e1: Vector3, f0: Vector3, f1: Vector3, sa: float, sb: float, want: Vector3) -> void:
	var j0 := floori(sa / 0.5)
	var j1 := floori(sb / 0.5)
	for j in range(j0, j1 + 1):
		var u0 := clampf((j * 0.5 - sa) / maxf(1e-3, sb - sa), 0.0, 1.0)
		var u1 := clampf(((j + 1) * 0.5 - sa) / maxf(1e-3, sb - sa), 0.0, 1.0)
		if u1 - u0 < 1e-3:
			continue
		var col := T.WHITE if j % 2 == 0 else T.BLACK
		K.oquad(m, k0.lerp(k1, u0), k0.lerp(k1, u1), e0.lerp(e1, u1), e0.lerp(e1, u0), Vector3.UP, col)
		K.oquad(m, f0.lerp(f1, u0), f0.lerp(f1, u1), e0.lerp(e1, u1), e0.lerp(e1, u0), -want, col)


## The width of a walkway beside a wall corner p (plan metres to the nearest edge line, the kerb's road side), or NAN
## when the edge line runs within 0.5 m of the wall (no walkway) or none is within 4 m at the road's level.
static func _walkway(edges: Array, p: Vector3, ceil_y: float) -> float:
	var best := INF
	for sg: Array in edges:
		var a: Vector3 = sg[0]
		var b: Vector3 = sg[1]
		var dx := b.x - a.x
		var dz := b.z - a.z
		var l2 := dx * dx + dz * dz
		var t := 0.0 if l2 < 1e-8 else clampf(((p.x - a.x) * dx + (p.z - a.z) * dz) / l2, 0.0, 1.0)
		var py := lerpf(a.y, b.y, t)
		if py > ceil_y - 3.5 or py < ceil_y - 9.0:
			continue
		best = minf(best, Vector2(p.x - a.x - dx * t, p.z - a.z - dz * t).length())
	return best if best >= 0.5 and best <= 4.0 else NAN


## The road under a ceiling corner: the nearest lane line in plan between 3.5 and 9 m under the ceiling, read where
## the corner projects on it; NAN when there is none within 12 m.
static func _road_y(segs: Array, x: float, z: float, ceil_y: float) -> float:
	var best := INF
	var y := NAN
	for sg: Array in segs:
		var a: Vector3 = sg[0]
		var b: Vector3 = sg[1]
		var dx := b.x - a.x
		var dz := b.z - a.z
		var l2 := dx * dx + dz * dz
		var t := 0.0 if l2 < 1e-8 else clampf(((x - a.x) * dx + (z - a.z) * dz) / l2, 0.0, 1.0)
		var py := lerpf(a.y, b.y, t)
		if py > ceil_y - 3.5 or py < ceil_y - 9.0:
			continue
		var d := Vector2(x - a.x - dx * t, z - a.z - dz * t).length()
		if d < best:
			best = d
			y = py
	return y if best < 12.0 else NAN


static func _at(p: Vector3, y: float) -> Vector3:
	return Vector3(p.x, y, p.z)


## A triangle turned to face `want`.
static func _otri(m: KitMesh, a: Vector3, b: Vector3, c: Vector3, want: Vector3, col: Color) -> void:
	if (b - a).cross(c - a).dot(want) >= 0.0:
		m.tri(a, b, c, col)
	else:
		m.tri(a, c, b, col)


static func _up(p: Vector3, y: float) -> Vector3:
	return Vector3(p.x, p.y + y, p.z)


## A UV quad turned to face `want` (whatever the order of its corners), the UVs and colours following their corners.
static func _oquad_uv(m: KitMesh, a: Vector3, b: Vector3, c: Vector3, d: Vector3, ua: Vector2, ub: Vector2, uc: Vector2, ud: Vector2, ca: Color, cb: Color, cc: Color, cd: Color, want: Vector3) -> void:
	var nrm := (b - a).cross(c - a) + (c - a).cross(d - a)
	if nrm.dot(want) >= 0.0:
		m.quad_uv(a, b, c, d, ua, ub, uc, ud, ca, cb, cc, cd)
	else:
		m.quad_uv(a, d, c, b, ua, ud, uc, ub, ca, cd, cc, cb)


## Per wall run of a tile (twalls), per point: true where a roofed TUN-T1 wall faces another roofed wall across a gap
## under 3.5 m (the two carriageways side by side: the wide section's central line of pillars, owner photo 03).
static func median_flags(walls: Array) -> Array:
	var pts := []
	var grid := {}
	for wi in walls.size():
		var w: Dictionary = walls[wi]
		if int(w.get("r", 0)) != 1:
			continue
		var q := K.points(w.p, 7)
		for k in q.size():
			var e := {"x": float(q[k][0]), "z": float(q[k][2]), "ox": float(q[k][5]), "oz": float(q[k][6]), "w": wi}
			pts.append(e)
			var cell := Vector2i(floori(e.x / 4.0), floori(e.z / 4.0))
			if not grid.has(cell):
				grid[cell] = []
			grid[cell].append(e)
	var out := []
	for wi in walls.size():
		var w: Dictionary = walls[wi]
		var q := K.points(w.p, 7)
		var flags := []
		for k in q.size():
			var hit := false
			if str(w.v) == "TUN-T1" and int(w.get("r", 0)) == 1:
				var x := float(q[k][0])
				var z := float(q[k][2])
				var ox := float(q[k][5])
				var oz := float(q[k][6])
				var c := Vector2i(floori(x / 4.0), floori(z / 4.0))
				for dz in range(-1, 2):
					for dx in range(-1, 2):
						for e: Dictionary in grid.get(c + Vector2i(dx, dz), []):
							if int(e.w) == wi:
								continue
							var ddx: float = e.x - x
							var ddz: float = e.z - z
							var along := ddx * ox + ddz * oz
							var side := absf(ddx * oz - ddz * ox)
							if along > 0.05 and along < 3.5 and side < 3.0 and ox * float(e.ox) + oz * float(e.oz) < -0.5:
								hit = true
								break
						if hit:
							break
					if hit:
						break
			flags.append(hit)
		out.append(flags)
	return out
