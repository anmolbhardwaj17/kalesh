## The tunnel and underpass kits (P2-032, tunnels.md and underpasses_subways.md of harness/design/reference/infrastructure/,
## STYLE_BIBLE.md "Infrastructure"): the side walls of every cut, ramp and tunnel, the ceiling of a roofed stretch with
## its lights, jet fans, trays and message signs, the headwall across every mouth with its name band and lights, and
## the drain gratings. The tiles keep the plain shapes as colliders (`wall`, `ceiling`); this draws them in the look.
## Variants (tools/bake/infra/tunnels.ts gives them):
##   TUN-T1  Pragati Maidan main tunnel (2022), from the owner's photos (harness/design/reference/owner/
##           pragati_maidan_tunnel/): inside, a green base, a yellow wall and a wave band of yellow, ochre and green
##           with white and red birds, a cream soffit with two continuous white LED strip lines near the wall tops (real
##           even light from them over walls, soffit and road side) and orange marigold strings across, cable trays, jet fan pairs, message signs flush under
##           the soffit, fire point cabinets set into the wall, CCTV domes, a black and white kerb; where two carriageways run side by side the wall
##           between them is the wide section's line of painted pillars (saffron, purple, teal, yellow, mandala discs,
##           striped plinths, uplights); the ramp
##           walls painted end to end: a green base, a blue river band, cream with flower discs, pink lotus and green
##           trees, a saffron band with a wavy edge on top, an orange rail on the coping
##   TUN-T2  its box underpasses: black dado, light grey paint, the two LED strip lines, cable trays, jet fans
##   TUN-T3  basement and service tunnels: grey concrete, yellow and black bands, the two LED strip lines
##   UND-U1  flyover-era underpass and cut (ITO, Ring Road): cream paint over a grey plinth, black and yellow kerb
##           band, two warm white LED strip lines (the same fittings as every tunnel, owner 2026-11-14)
##   SUB-S4  a pedestrian underpass in plain white tile (its own kit is P2-031)
## Lane lines (tlines) are painted here too: the game has no road shader for the lane UV's codes yet.
## Kit inputs are world metres (the sink's frame takes the tile origin off). Pure.
extends RefCounted

const KitMesh := preload("res://world/landmarks/kit_mesh.gd")
const K := preload("res://world/infra/infra_kit.gd")
const Paint := preload("res://world/infra/kit_tunnel_paint.gd")
const Fit := preload("res://world/infra/kit_tunnel_fit.gd")

const BLACK := Color("#1d1d20")
const WHITE := Color("#f1efe9")
const CORAL := Color("#d9503f")
const NAVY := Color("#22325e")
const TEAL := Color("#2f8f8a")
const LEAF := Color("#5f9e4a")
const PINK := Color("#e7a3a8")
const CONDUIT := Color("#c8566e")
const GREY := Color("#9a9893")
const GREY_DARK := Color("#6e6d6a")
const SOFFIT := Color("#b9c0c7")
const PALE := Color("#c9c6bd")
const CREAM := Color("#d8cdb0")
const YELLOW := Color("#f2c230")
const ORANGE := Color("#d9622a")
const RED := Color("#b8242a")
const LED := Color("#f4f7ff")
const WARM_LED := Color("#fff0d2")
const AMBER := Color("#ffb000")
const TILE := Color("#e6e6e0")
const GALV := Color("#7d8288")
# TUN-T1 paint (owner photos, 2026-11-14)
const T1_GREEN := Color("#2f8a3c")
const T1_YELLOW := Color("#ecc62a")
const T1_OCHRE := Color("#d39a17")
const T1_WAVE := Color("#3d9a3a")
const T1_CREAM := Color("#efe6c8")
const T1_DISC := Color("#b4c9d8")
const T1_BLUE := Color("#2d63ad")
const T1_SKY := Color("#8fc0e2")
const T1_SAFFRON := Color("#f07a2a")
const T1_LOTUS := Color("#e25d9c")
const T1_TREE := Color("#3f7d3a")
const T1_TRUNK := Color("#6b4a2f")
const T1_SOFFIT := Color("#e2d8b2")
const MARIGOLD := Color("#f39a1e")

## Heights over the lane top (m): the dado, the top of the mural band (TUN-T1, read from the 2025 photo).
const DADO_M := 1.2
const MURAL_TOP_M := 4.0
## Where the two LED strip lines run across the soffit (share of its width from each wall), and at least this far
## past the curve between the wall and the soffit.
const STRIP_SIDE := 0.1
const STRIP_PAST_CURVE_M := 0.25
## The curve between the wall and the soffit of the Pragati Maidan tunnel and its box underpasses (owner photo 02),
## radius in metres, and its facets.
const CURVE_M := 0.6
const CURVE_FACETS := 4
const FAN_EVERY_M := 96.0
const VMS_EVERY_M := 90.0
const HYDRANT_EVERY_M := 60.0
const CCTV_EVERY_M := 50.0
const KNOT_EVERY_M := 64.0
const STRIPE_M := 0.5
const MARIGOLD_EVERY_M := 6.0


## The finish of a variant: wall colours, dado, lamp colour and spacing, what hangs from the ceiling.
static func finish(v: String) -> Dictionary:
	match v:
		"TUN-T1":
			return {"wall": T1_YELLOW, "dado": T1_GREEN, "mural": true, "lamp": LED, "fans": true, "vms": true, "kerb": WHITE, "rail": ORANGE, "soffit": T1_SOFFIT, "strips": true, "marigold": true}
		"TUN-T2":
			return {"wall": PALE, "dado": BLACK, "mural": false, "lamp": LED, "fans": true, "vms": false, "kerb": WHITE, "rail": GALV, "soffit": SOFFIT, "strips": true}
		"TUN-T3":
			return {"wall": Color("#9a9893"), "dado": YELLOW, "mural": false, "lamp": LED, "fans": false, "vms": false, "kerb": YELLOW, "rail": YELLOW, "soffit": GREY_DARK, "strips": true}
		"SUB-S4":
			return {"wall": TILE, "dado": GREY_DARK, "mural": false, "lamp": LED, "fans": false, "vms": false, "kerb": GREY, "rail": GALV, "soffit": PALE, "strips": true}
	return {"wall": CREAM, "dado": GREY_DARK, "mural": false, "lamp": WARM_LED, "fans": false, "vms": false, "kerb": YELLOW, "rail": GALV, "soffit": SOFFIT, "strips": true}


## The radius of the curve between wall and soffit of a variant (0: a square corner).
static func curve_of(v: String) -> float:
	return CURVE_M if v == "TUN-T1" or v == "TUN-T2" else 0.0


## Metres from each wall to a strip line on a soffit `width` wide (kit_tunnel_light.gd uses the same).
static func strip_offset(width: float, v: String) -> float:
	var c := curve_of(v)
	return minf(maxf(STRIP_SIDE * width, c + STRIP_PAST_CURVE_M if c > 0.0 else 0.0), width * 0.3)


## Heights up a wall from y0 to top where it is cut into bands, so the strip light (per vertex) falls off down it:
## at 1.0 and 2.2 m from the foot, 1.6 and 0.7 m under the top.
static func heights(y0: float, top: float) -> PackedFloat32Array:
	var out := PackedFloat32Array([y0])
	for y in [y0 + 1.0, y0 + 2.2, top - 1.6, top - 0.7]:
		if y > out[out.size() - 1] + 0.05 and y < top - 0.05:
			out.append(y)
	out.append(maxf(top, y0))
	return out


## The same bands for both ends of a wall segment (equal counts): shares of the mean height, laid on each end.
static func heights_pair(a0: float, at: float, b0: float, bt: float) -> Array:
	var h := maxf(((at - a0) + (bt - b0)) * 0.5, 0.01)
	var rel := heights(0.0, h)
	var ya := PackedFloat32Array()
	var yb := PackedFloat32Array()
	for y in rel:
		ya.append(a0 + (at - a0) * y / h)
		yb.append(b0 + (bt - b0) * y / h)
	return [ya, yb]


## A side wall run (twalls): the face from the road edge to its top, the variant's bands and fittings.
static func wall(base: KitMesh, near: KitMesh, w: Dictionary, med: Array = []) -> void:
	var pts := K.points(w.p, 7)
	var n := pts.size()
	if n < 2:
		return
	var f := finish(str(w.v))
	var roofed := int(w.get("r", 0)) == 1
	var parapet := int(w.get("pp", 0)) == 1
	var P: Array[Vector3] = []
	var T := PackedFloat32Array()
	var G := PackedFloat32Array()
	var O: Array[Vector3] = []
	var S := PackedFloat32Array()
	var s := float(w.get("s0", 0.0))
	for i in n:
		var q: Array = pts[i]
		P.append(Vector3(float(q[0]), float(q[1]), float(q[2])))
		T.append(float(q[3]))
		G.append(float(q[4]))
		O.append(Vector3(float(q[5]), 0.0, float(q[6])))
		if i > 0:
			s += Vector2(P[i].x - P[i - 1].x, P[i].z - P[i - 1].z).length()
		S.append(s)
	var mural: bool = f.mural
	for i in n - 1:
		var a := P[i]
		var b := P[i + 1]
		var o := (O[i] + O[i + 1]).normalized()
		var inw := -o
		var ta := T[i]
		var tb := T[i + 1]
		# the plain face from the road edge to the top, in the wall colour (a TUN-T1 ramp: its cream)
		# (painted concrete: satin, except the old underpass's weathered matte)
		base.use("main", "tunnel_lit" if roofed else ("matte" if str(w.v) == "UND-U1" else "satin"))
		if roofed:
			var hp := heights_pair(a.y, ta, b.y, tb)
			var ya: PackedFloat32Array = hp[0]
			var yb: PackedFloat32Array = hp[1]
			for k in ya.size() - 1:
				K.oquad(base, Vector3(a.x, ya[k], a.z), Vector3(b.x, yb[k], b.z), Vector3(b.x, yb[k + 1], b.z), Vector3(a.x, ya[k + 1], a.z), inw, f.wall)
			var cr := curve_of(str(w.v))
			# no curve behind the wide section's pillars: they run up to the soffit (owner photo 03)
			if cr > 0.0 and not (mural and med.size() == n and med[i] and med[i + 1]):
				_curve(base, a, b, ta, tb, inw, cr, f.soffit)
		else:
			K.oquad(base, a, b, Vector3(b.x, tb, b.z), Vector3(a.x, ta, a.z), inw, T1_CREAM if mural else f.wall)
		base.use("main", "matte")
		# the dado (with a striped kerb band at its foot), offset a little into the road
		if roofed:
			base.use("main", "tunnel_lit")
		var off := inw * 0.02
		var da := minf(a.y + (0.7 if mural and not roofed else (1.0 if mural else DADO_M)), ta)
		var db := minf(b.y + (0.7 if mural and not roofed else (1.0 if mural else DADO_M)), tb)
		K.oquad(base, a + off, b + off, Vector3(b.x, db, b.z) + off, Vector3(a.x, da, a.z) + off, inw, f.dado)
		base.use("main", "matte")
		_stripes(near, a + off * 2.0, b + off * 2.0, S[i], S[i + 1], 0.3, f.kerb, BLACK, inw, "tunnel_lit" if roofed else "paint")
		if mural and roofed and med.size() == n and med[i] and med[i + 1]:
			Paint.gap(near, a + off * 2.0, b + off * 2.0, ta, tb, inw)
		elif mural:
			Paint.band(near, a + off * 2.0, b + off * 2.0, ta, tb, S[i], S[i + 1], inw, roofed)
		elif str(w.v) == "TUN-T3":
			# a yellow and black band at bumper height
			_stripes(near, a + off * 2.0 + Vector3(0, 0.9, 0), b + off * 2.0 + Vector3(0, 0.9, 0), S[i], S[i + 1], 0.3, YELLOW, BLACK, inw, "tunnel_lit" if roofed else "paint")
		if not roofed:
			# the coping, the outer face down to the ground, and a rail over a parapet
			var ca := Vector3(a.x, ta, a.z)
			var cb := Vector3(b.x, tb, b.z)
			K.oquad(base, ca, cb, cb + o * 0.3, ca + o * 0.3, Vector3.UP, PALE)
			var ga := minf(G[i], ta)
			var gb := minf(G[i + 1], tb)
			K.oquad(base, ca + o * 0.3, cb + o * 0.3, Vector3(b.x, gb, b.z) + o * 0.3, Vector3(a.x, ga, a.z) + o * 0.3, o, f.wall)
			if parapet and (ta - G[i] > 0.4 or tb - G[i + 1] > 0.4):
				near.use("main", "metal")
				var ra := ca + o * 0.15 + Vector3(0, 0.95, 0)
				var rb := cb + o * 0.15 + Vector3(0, 0.95, 0)
				K.beam_box(near, ra, rb, 0.06, 0.06, f.rail)
				K.beam_box(near, ra - Vector3(0, 0.5, 0), rb - Vector3(0, 0.5, 0), 0.04, 0.04, f.rail)
				var k0 := ceili(S[i] / 2.0)
				var k1 := floori(S[i + 1] / 2.0)
				for k in range(k0, k1 + 1):
					var t := (k * 2.0 - S[i]) / maxf(1e-3, S[i + 1] - S[i])
					var p := ca.lerp(cb, t) + o * 0.15
					K.post(near, p, Vector3(0.06, 1.0, 0.06), Vector2(b.x - a.x, b.z - a.z).normalized(), f.rail)
				near.use("main", "matte")
	if not roofed:
		return
	# the wide section's line of pillars on the kerb in front of a median wall (owner photo 03), each turned to its segment
	if mural and med.size() == n:
		_along(P, S, Paint.PILLAR_EVERY_M, Paint.PILLAR_EVERY_M * 0.5, func(p: Vector3, i: int, t: float) -> void:
			if med[i] and med[mini(i + 1, n - 1)]:
				Paint.pillar(near, p, lerpf(T[i], T[mini(i + 1, n - 1)], t), -O[i], _d2(P, i), roundi((S[i] + t * (S[mini(i + 1, n - 1)] - S[i])) / Paint.PILLAR_EVERY_M)))
	# fittings along a roofed wall, each turned to its own segment: fire point boxes, CCTV domes (T1), and the cable tray
	# along the top of the wall, just under the soffit (T1, T2), with the conduit under it (T1)
	if mural:
		_along(P, S, HYDRANT_EVERY_M, 30.0, func(p: Vector3, i: int, _t: float) -> void:
			var d2 := _d2(P, i)
			Fit.fire_point(near, p, -O[i], Vector3(d2.x, 0, d2.y)))
		_along(P, S, CCTV_EVERY_M, 12.0, func(p: Vector3, i: int, _t: float) -> void:
			var top := lerpf(T[i], T[mini(i + 1, n - 1)], _t)
			var inw2: Vector3 = -O[i]
			near.use("main", "tunnel_lit")
			K.post(near, Vector3(p.x, top - 0.9, p.z) + inw2 * 0.25, Vector3(0.28, 0.3, 0.28), _d2(P, i), BLACK)
			near.use("main", "matte"))
	if f.get("strips", false):
		for i in n - 1:
			# no tray or conduit along the wide section's line of pillars (owner photo 03)
			if mural and med.size() == n and med[i] and med[i + 1]:
				continue
			var inw3: Vector3 = -(O[i] + O[i + 1]).normalized()
			near.use("main", "tunnel_lit")
			K.beam_box(near, Vector3(P[i].x, T[i] - 0.32, P[i].z) + inw3 * 0.32, Vector3(P[i + 1].x, T[i + 1] - 0.32, P[i + 1].z) + inw3 * 0.32, 0.5, 0.1, GALV, true)
			if mural:
				K.beam_box(near, Vector3(P[i].x, T[i] - 0.6, P[i].z) + inw3 * 0.08, Vector3(P[i + 1].x, T[i + 1] - 0.6, P[i + 1].z) + inw3 * 0.08, 0.12, 0.12, CONDUIT, true)
		near.use("main", "matte")


## The curve between a roofed wall and its soffit (owner photo 02): a quarter round of radius r in front of the
## corner, from r under the wall top on the wall to r out on the soffit, facing the road and down.
static func _curve(m: KitMesh, a: Vector3, b: Vector3, ta: float, tb: float, inw: Vector3, r: float, col: Color) -> void:
	if ta - a.y < r + 1.0 or tb - b.y < r + 1.0:
		return
	for k in CURVE_FACETS:
		var t0 := float(k) / CURVE_FACETS * PI * 0.5
		var t1 := float(k + 1) / CURVE_FACETS * PI * 0.5
		var o0 := inw * (r - r * cos(t0)) + Vector3(0, -r + r * sin(t0), 0)
		var o1 := inw * (r - r * cos(t1)) + Vector3(0, -r + r * sin(t1), 0)
		var mid := (t0 + t1) * 0.5
		var want := inw * cos(mid) - Vector3(0, sin(mid), 0)
		K.oquad(m, Vector3(a.x, ta, a.z) + o0, Vector3(b.x, tb, b.z) + o0, Vector3(b.x, tb, b.z) + o1, Vector3(a.x, ta, a.z) + o1, want, col)


## Shares of a soffit's width where it is cut across: the curves, round each strip line, and the middle.
static func _soffit_cuts(width: float, v: String) -> PackedFloat32Array:
	var off := strip_offset(width, v)
	var raw := [0.0, curve_of(v), off - 0.6, off - 0.2, off, off + 0.2, off + 0.6, width * 0.5]
	var out := PackedFloat32Array()
	for m: float in raw:
		var u := clampf(m / maxf(width, 0.01), 0.0, 0.5)
		if out.is_empty() or u > out[out.size() - 1] + 0.005:
			out.append(u)
	for k in range(out.size() - 2, -1, -1):
		out.append(1.0 - out[k])
	return out


## The direction in plan of segment i of a run (unit), for fittings that line up with the wall or the road.
static func _d2(P: Array[Vector3], i: int) -> Vector2:
	var j := mini(i + 1, P.size() - 1)
	var a := P[mini(i, j - 1)]
	var b := P[j]
	var d := Vector2(b.x - a.x, b.z - a.z)
	return d.normalized() if d.length() > 1e-4 else Vector2(0, 1)


## Calls fn(point, segment, t) at every `every` metres of the run (from `phase`), with the point on the road edge.
static func _along(P: Array[Vector3], S: PackedFloat32Array, every: float, phase: float, fn: Callable) -> void:
	var n := P.size()
	var k0 := ceili((S[0] - phase) / every)
	var k1 := floori((S[n - 1] - phase) / every)
	var i := 0
	for k in range(k0, k1 + 1):
		var s := phase + k * every
		while i < n - 2 and S[i + 1] < s:
			i += 1
		var t := clampf((s - S[i]) / maxf(1e-3, S[i + 1] - S[i]), 0.0, 1.0)
		fn.call(P[i].lerp(P[i + 1], t), i, t)


## Alternating stripes of length STRIPE_M (by the run's metres) on a band h high from a b upwards.
static func _stripes(m: KitMesh, a: Vector3, b: Vector3, sa: float, sb: float, h: float, c0: Color, c1: Color, want: Vector3, mat := "paint") -> void:
	m.use("main", mat)
	var k0 := floori(sa / STRIPE_M)
	var k1 := floori(sb / STRIPE_M)
	for k in range(k0, k1 + 1):
		var u0 := clampf((k * STRIPE_M - sa) / maxf(1e-3, sb - sa), 0.0, 1.0)
		var u1 := clampf(((k + 1) * STRIPE_M - sa) / maxf(1e-3, sb - sa), 0.0, 1.0)
		if u1 - u0 < 1e-3:
			continue
		var p := a.lerp(b, u0)
		var q := a.lerp(b, u1)
		K.oquad(m, p, q, q + Vector3(0, h, 0), p + Vector3(0, h, 0), want, c0 if k % 2 == 0 else c1)
	m.use("main", "matte")


## A ceiling run (tceils): the soffit, a light row down the middle, and the variant's jet fans and message signs.
static func ceiling(base: KitMesh, near: KitMesh, c: Dictionary, lines: Array = []) -> void:
	var pts := K.points(c.p, 6)
	var n := pts.size()
	if n < 2:
		return
	var f := finish(str(c.v))
	var L: Array[Vector3] = []
	var R: Array[Vector3] = []
	var M: Array[Vector3] = []
	var S := PackedFloat32Array()
	var s := float(c.get("s0", 0.0))
	for i in n:
		var q: Array = pts[i]
		L.append(Vector3(float(q[0]), float(q[1]), float(q[2])))
		R.append(Vector3(float(q[3]), float(q[4]), float(q[5])))
		M.append((L[i] + R[i]) * 0.5)
		if i > 0:
			s += Vector2(M[i].x - M[i - 1].x, M[i].z - M[i - 1].z).length()
		S.append(s)
	var width := (L[0] - R[0]).length()
	var v := str(c.v)
	# the soffit: painted concrete lit by the strip lines (tunnel_lit), cut across at the strips so the glow round each
	# strip and the shade between them fall on vertices
	base.use("main", "tunnel_lit")
	for i in n - 1:
		var u := _soffit_cuts(((L[i] - R[i]).length() + (L[i + 1] - R[i + 1]).length()) * 0.5, v)
		for k in u.size() - 1:
			K.oquad(base, L[i].lerp(R[i], u[k]), L[i + 1].lerp(R[i + 1], u[k]), L[i + 1].lerp(R[i + 1], u[k + 1]), L[i].lerp(R[i], u[k + 1]), Vector3.DOWN, f.soffit)
	base.use("main", "matte")
	# the light grey concrete road under it (owner photos 02 and 03)
	Paint.road(base, c, lines)
	# two continuous LED strip lines along the soffit near each upper wall edge (every tunnel and underpass), mounted on
	# it just past the curve (owner photos 02 and 03): 25 cm wide, 4 cm deep, in the glow material
	base.use("main", "glow")
	for side in 2:
		for i in n - 1:
			var s0 := strip_offset((L[i] - R[i]).length(), v) / maxf((L[i] - R[i]).length(), 0.01)
			var s1 := strip_offset((L[i + 1] - R[i + 1]).length(), v) / maxf((L[i + 1] - R[i + 1]).length(), 0.01)
			var a: Vector3 = L[i].lerp(R[i], s0 if side == 0 else 1.0 - s0) + Vector3(0, -0.04, 0)
			var b: Vector3 = L[i + 1].lerp(R[i + 1], s1 if side == 0 else 1.0 - s1) + Vector3(0, -0.04, 0)
			K.beam_box(base, a, b, 0.25, 0.04, f.lamp, true)
	base.use("main", "matte")
	if f.get("marigold", false):
		# orange marigold strings hung across the soffit
		_along(M, S, MARIGOLD_EVERY_M, 1.5, func(_p: Vector3, i: int, t: float) -> void:
			var l: Vector3 = L[i].lerp(L[i + 1], t)
			var r: Vector3 = R[i].lerp(R[i + 1], t)
			var k := int(maxf(10.0, (r - l).length() / 0.3))
			near.use("main", "tunnel_lit")
			var last := Vector3.ZERO
			for j in k + 1:
				var u := float(j) / k
				var sag := 0.55 * 4.0 * u * (1.0 - u)
				var q: Vector3 = l.lerp(r, u) + Vector3(0, -0.12 - sag, 0)
				near.box(q, Vector3(0.11, 0.11, 0.11), MARIGOLD if j % 3 != 1 else T1_SAFFRON, float(j) * 0.7, true, false)
				# the string between the flowers
				if j > 0:
					K.beam_box(near, last, q, 0.035, 0.035, MARIGOLD, true)
				last = q
			near.use("main", "matte"))
	if f.fans and width > 6.0:
		# jet fan pairs flush under the soffit every FAN_EVERY_M (kit_tunnel_fit.gd: 1 m across, 1.9 m long)
		_along(M, S, FAN_EVERY_M, 40.0, func(p: Vector3, i: int, t: float) -> void:
			var across := (R[i].lerp(R[i + 1], t) - L[i].lerp(L[i + 1], t))
			var dir0 := _d2(M, i)
			for side in [-0.22, 0.22]:
				Fit.jet_fan(near, p + across * side, Vector3(dir0.x, 0, dir0.y)))
	if f.vms and width > 6.0:
		_along(M, S, VMS_EVERY_M, 45.0, func(p: Vector3, i: int, _t: float) -> void:
			var dir0 := _d2(M, i)
			Fit.message_sign(near, p, Vector3(dir0.x, 0, dir0.y), minf(2.6, width * 0.4)))


## A headwall (theads): the face across the mouth from the ceiling up, a protruding lip, the name band, lights at the
## mouth, and the cap and back over the ground. The name itself is a label the system adds (infra.gd).
static func head(base: KitMesh, near: KitMesh, h: Dictionary) -> void:
	var f := finish(str(h.v))
	var a := Vector3(float(h.a[0]), float(h.y0), float(h.a[1]))
	var b := Vector3(float(h.b[0]), float(h.y0), float(h.b[1]))
	var nrm := Vector3(float(h.n[0]), 0.0, float(h.n[1]))
	var y1 := float(h.y1)
	var top := Vector3(0, y1 - float(h.y0), 0)
	var d := (b - a)
	var along := Vector3(d.x, 0, d.z).normalized()
	base.use("main", "matte")
	K.oquad(base, a, b, b + top, a + top, nrm, f.wall)
	var road := int(h.get("road", 0)) == 1
	if not road:
		K.oquad(base, a + top, b + top, b + top - nrm * 0.25, a + top - nrm * 0.25, Vector3.UP, PALE)
	# the lip: a frame band over the opening, 0.35 m proud of the face, and the name band on it
	var lip := minf(1.4, y1 - float(h.y0) - 0.05)
	if lip > 0.2:
		var o := nrm * 0.35
		var ext := along * 0.3
		K.oquad(base, a - ext + o, b + ext + o, b + ext + o + Vector3(0, lip, 0), a - ext + o + Vector3(0, lip, 0), nrm, PALE)
		K.oquad(base, a - ext, b + ext, b + ext + o, a - ext + o, Vector3.DOWN, PALE)
		K.oquad(base, a - ext + Vector3(0, lip, 0), b + ext + Vector3(0, lip, 0), b + ext + o + Vector3(0, lip, 0), a - ext + o + Vector3(0, lip, 0), Vector3.UP, PALE)
		var band: Color = TEAL if str(h.v) == "TUN-T1" else (NAVY if str(h.v) == "TUN-T2" else (YELLOW if str(h.v) == "TUN-T3" else GREY_DARK))
		base.use("main", "paint")
		var bo := o + nrm * 0.02
		K.oquad(base, a + bo + Vector3(0, lip * 0.18, 0), b + bo + Vector3(0, lip * 0.18, 0), b + bo + Vector3(0, lip * 0.82, 0), a + bo + Vector3(0, lip * 0.82, 0), nrm, band)
		if str(h.v) == "TUN-T1":
			# the knot panel colours at the mouth: a pink and green border over the teal band
			K.oquad(base, a + bo + Vector3(0, lip * 0.82, 0), b + bo + Vector3(0, lip * 0.82, 0), b + bo + Vector3(0, lip * 0.92, 0), a + bo + Vector3(0, lip * 0.92, 0), nrm, PINK)
			K.oquad(base, a + bo + Vector3(0, lip * 0.08, 0), b + bo + Vector3(0, lip * 0.08, 0), b + bo + Vector3(0, lip * 0.18, 0), a + bo + Vector3(0, lip * 0.18, 0), nrm, LEAF)
		# floodlights under the lip, facing down the ramp, every 3 m
		base.use("main", "glow")
		var w := d.length()
		var k := maxi(2, int(w / 3.0))
		for i in k:
			var p := a.lerp(b, (i + 0.5) / k) + o * 0.6 - Vector3(0, 0.12, 0)
			K.post(base, p, Vector3(0.6, 0.1, 0.3), Vector2(along.x, along.z), f.lamp)
		base.use("main", "matte")
	# the back of the headwall over the slab, under the ground
	if not road:
		K.oquad(base, a + top - nrm * 0.25, b + top - nrm * 0.25, b - nrm * 0.25 + Vector3(0, 0.4, 0), a - nrm * 0.25 + Vector3(0, 0.4, 0), -nrm, f.wall)


## Where a headwall's name label goes: {text, xf} (a Label3D on the lip, facing out of the mouth), or {} when none.
static func head_label(h: Dictionary) -> Dictionary:
	var name := str(h.get("name", ""))
	if name == "":
		return {}
	var a := Vector3(float(h.a[0]), float(h.y0), float(h.a[1]))
	var b := Vector3(float(h.b[0]), float(h.y0), float(h.b[1]))
	var nrm := Vector3(float(h.n[0]), 0.0, float(h.n[1]))
	var lip := minf(1.4, float(h.y1) - float(h.y0) - 0.05)
	if lip < 0.5:
		return {}
	var c := (a + b) * 0.5 + nrm * 0.4 + Vector3(0, lip * 0.5, 0)
	# the label reads from its +Z side: turn +Z onto the mouth's outward normal (the side a driver comes from)
	var basis := Basis(Vector3.UP, atan2(nrm.x, nrm.z) + PI)
	return {"text": name.to_upper(), "xf": Transform3D(basis, c), "size": lip * 0.6}


## A drain grating across the carriageway (tdrains): a dark frame and bars, flush with the road.
static func drain(base: KitMesh, d: Dictionary) -> void:
	var a := Vector3(float(d.a[0]), float(d.a[1]), float(d.a[2]))
	var b := Vector3(float(d.b[0]), float(d.b[1]), float(d.b[2]))
	var across := Vector3(b.x - a.x, 0, b.z - a.z)
	var w := across.length()
	if w < 0.5:
		return
	across /= w
	var t := Vector3(-across.z, 0, across.x) * 0.3
	base.use("main", "metal")
	K.oquad(base, a - t, b - t, b + t, a + t, Vector3.UP, Color("#2a2a2c"))
	var k := int(w / 0.25)
	for i in k:
		var p := a.lerp(b, (i + 0.5) / k) + Vector3(0, 0.004, 0)
		K.oquad(base, p - t * 0.9 - across * 0.03, p + t * 0.9 - across * 0.03, p + t * 0.9 + across * 0.03, p - t * 0.9 + across * 0.03, Vector3.UP, GALV)
	base.use("main", "matte")


## A lane line along a lowered stretch (tlines; m 1 dashed 3 m on, 4.5 m off; 2 centre and 3 edge solid), 12 cm wide,
## 1.5 cm over the road. The game has no road shader for the lane UV's codes yet, so the tunnels carry their own paint.
static func line(base: KitMesh, l: Dictionary) -> void:
	var pts := K.points(l.p, 3)
	var n := pts.size()
	if n < 2:
		return
	var dashed := int(l.get("m", 3)) == 1
	var s := float(l.get("s0", 0.0))
	# 2 cm over the road: over the tunnel's concrete finish (8 mm), under the strip light like the road
	base.use("main", "tunnel_lit")
	for i in n - 1:
		var a := Vector3(float(pts[i][0]), float(pts[i][1]) + 0.02, float(pts[i][2]))
		var b := Vector3(float(pts[i + 1][0]), float(pts[i + 1][1]) + 0.02, float(pts[i + 1][2]))
		var d := Vector3(b.x - a.x, 0, b.z - a.z)
		var len := d.length()
		if len < 1e-3:
			continue
		var u := Vector3(-d.z, 0, d.x) / len * 0.06
		if not dashed:
			K.oquad(base, a - u, b - u, b + u, a + u, Vector3.UP, WHITE)
		else:
			# dashes by the run's metres: 3 m on in every 7.5 m
			var k0 := floori(s / 7.5)
			var k1 := floori((s + len) / 7.5)
			for k in range(k0, k1 + 1):
				var u0 := clampf((k * 7.5 - s) / len, 0.0, 1.0)
				var u1 := clampf((k * 7.5 + 3.0 - s) / len, 0.0, 1.0)
				if u1 - u0 < 1e-3:
					continue
				var p := a.lerp(b, u0)
				var q := a.lerp(b, u1)
				K.oquad(base, p - u, q - u, q + u, p + u, Vector3.UP, WHITE)
		s += len
	base.use("main", "matte")
