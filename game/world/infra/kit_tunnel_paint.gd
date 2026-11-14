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
const PILLAR_GAP := Color("#2b2b33")
const PILLAR_COLS := [Color("#f07a2a"), Color("#7b3f9e"), Color("#1f8f8f"), Color("#f2b51c")]
## The ramp shader reads the height left to the wall top from the colour's red channel, over this many metres.
const LEFT_SCALE_M := 16.0


## The mural of one wall segment from the dado to its top: inside (roofed) the wave band from 1.0 m, on a ramp the
## river scene from 0.7 m. a and b are the road edge at the lane top (offset off the wall), ta and tb the wall top.
static func band(m: KitMesh, a: Vector3, b: Vector3, ta: float, tb: float, sa: float, sb: float, want: Vector3, roofed: bool) -> void:
	var y0 := 1.0 if roofed else 0.7
	if ta - a.y <= y0 + 0.02 and tb - b.y <= y0 + 0.02:
		return
	m.use("main", "mural_wave" if roofed else "mural_ramp")
	var pa := Vector3(a.x, a.y + y0, a.z)
	var pb := Vector3(b.x, b.y + y0, b.z)
	var qa := Vector3(a.x, maxf(ta, a.y + y0), a.z)
	var qb := Vector3(b.x, maxf(tb, b.y + y0), b.z)
	var ha := qa.y - a.y
	var hb := qb.y - b.y
	var c0 := Color((ha - y0) / LEFT_SCALE_M, 0, 0)
	var c1 := Color((hb - y0) / LEFT_SCALE_M, 0, 0)
	_oquad_uv(m, pa, pb, qb, qa, Vector2(sa, y0), Vector2(sb, y0), Vector2(sb, hb), Vector2(sa, ha), c0, c1, Color(0, 0, 0), Color(0, 0, 0), want)
	m.use("main", "matte")


## The central line of pillars painted on a median wall (owner photo 03): pillars 1.1 m wide every 2.4 m in saffron,
## purple, teal and yellow with a mandala (the shader), on yellow and white striped plinths with an uplight; the dark
## gap between them reads as the space behind.
static func pillars(m: KitMesh, a: Vector3, b: Vector3, ta: float, tb: float, sa: float, sb: float, want: Vector3) -> void:
	var k0 := floori(sa / PILLAR_EVERY_M)
	var k1 := floori(sb / PILLAR_EVERY_M)
	var len := maxf(1e-3, sb - sa)
	for k in range(k0, k1 + 1):
		var g0 := k * PILLAR_EVERY_M
		var p0 := g0 + PILLAR_EVERY_M - PILLAR_W_M
		var p1 := g0 + PILLAR_EVERY_M
		# the gap
		var u0 := clampf((g0 - sa) / len, 0.0, 1.0)
		var u1 := clampf((p0 - sa) / len, 0.0, 1.0)
		if u1 - u0 > 1e-3:
			var p := a.lerp(b, u0)
			var q := a.lerp(b, u1)
			var h := minf(lerpf(ta, tb, u0) - p.y, lerpf(ta, tb, u1) - q.y)
			m.use("main", "tunnel_lit")
			K.oquad(m, _up(p, 0.3), _up(q, 0.3), _up(q, h - 0.35), _up(p, h - 0.35), want, PILLAR_GAP)
		# the pillar
		u0 = clampf((p0 - sa) / len, 0.0, 1.0)
		u1 = clampf((p1 - sa) / len, 0.0, 1.0)
		if u1 - u0 < 1e-3:
			continue
		var p := a.lerp(b, u0)
		var q := a.lerp(b, u1)
		var h := minf(lerpf(ta, tb, u0) - p.y, lerpf(ta, tb, u1) - q.y)
		var x0 := sa + u0 * len - p0
		var x1 := sa + u1 * len - p0
		m.use("main", "tunnel_lit")
		for band_i in 3:
			K.oquad(m, _up(p, 0.3 + band_i * 0.3), _up(q, 0.3 + band_i * 0.3), _up(q, 0.6 + band_i * 0.3), _up(p, 0.6 + band_i * 0.3), want, T.T1_YELLOW if band_i % 2 == 0 else T.WHITE)
		var col: Color = PILLAR_COLS[posmod(k, 4)]
		m.use("main", "mural_pillar")
		_oquad_uv(m, _up(p, 1.2), _up(q, 1.2), _up(q, h - 0.35), _up(p, h - 0.35), Vector2(x0, 1.2), Vector2(x1, 1.2), Vector2(x1, h - 0.35), Vector2(x0, h - 0.35), col, col, col, col, want)
		# the uplight at the plinth, when the whole pillar is in this segment
		if x0 < 0.05 and x1 > PILLAR_W_M - 0.05:
			m.use("main", "glow")
			m.box(_up(p.lerp(q, 0.5), 0.12) + want * 0.15, Vector3(0.25, 0.12, 0.2), T.LED, 0.0, false, false)
	m.use("main", "matte")


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
