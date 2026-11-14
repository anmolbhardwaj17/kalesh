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
const Services := preload("res://world/infra/kit_tunnel_services.gd")

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
const T1_SOFFIT := Color("#cfc5a0")
const MARIGOLD := Color("#f39a1e")

## Heights over the lane top (m): the dado, the top of the mural band (TUN-T1, read from the 2025 photo).
const DADO_M := 1.2
const MURAL_TOP_M := 4.0
## Where the two LED strip lines run across the soffit (share of its width from each wall), and at least this far
## past the curve between the wall and the soffit.
const STRIP_SIDE := 0.1
const STRIP_PAST_CURVE_M := 0.25
## The curve between the wall and the soffit of the Pragati Maidan tunnel and its box underpasses (owner photo 02),
## radius in metres, and its facets (shaded smooth).
const CURVE_M := 0.9
const CURVE_FACETS := 6
const FAN_EVERY_M := 96.0
const VMS_EVERY_M := 90.0
const HYDRANT_EVERY_M := 60.0
const CCTV_EVERY_M := 50.0
const SIGNAL_MIN_WIDTH_M := 8.5
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
		# the Pragati Maidan tunnel's two walls (owner photo 02): yellow on the left of the run, green on the right
		var scheme := 1.0 if (b.x - a.x) * inw.z - (b.z - a.z) * inw.x > 0.0 else 0.0
		# the plain face from the road edge to the top, in the wall colour (a TUN-T1 ramp: its cream)
		# (painted concrete: satin, except the old underpass's weathered matte)
		base.use("main", "tunnel_wall" if roofed else ("matte" if str(w.v) == "UND-U1" else "satin"))
		if roofed:
			var hp := heights_pair(a.y, ta, b.y, tb)
			var ya: PackedFloat32Array = hp[0]
			var yb: PackedFloat32Array = hp[1]
			for k in ya.size() - 1:
				_wall_quad(base, a, b, ya[k], yb[k], ya[k + 1], yb[k + 1], S[i], S[i + 1], a.y, b.y, ta, tb, inw, f.wall)
			var cr := curve_of(str(w.v))
			# no curve behind the wide section's pillars: they run up to the soffit (owner photo 03)
			if cr > 0.0 and not (mural and med.size() == n and med[i] and med[i + 1]):
				base.use("main", "tunnel_soffit")
				_curve(base, a, b, ta, tb, inw, cr, f.soffit, S[i], S[i + 1])
		else:
			K.oquad(base, a, b, Vector3(b.x, tb, b.z), Vector3(a.x, ta, a.z), inw, T1_CREAM if mural else f.wall)
		base.use("main", "matte")
		# the dado (with a striped kerb band at its foot), offset a little into the road
		var off := inw * 0.02
		var da := minf(a.y + (0.7 if mural and not roofed else (1.0 if mural else DADO_M)), ta)
		var db := minf(b.y + (0.7 if mural and not roofed else (1.0 if mural else DADO_M)), tb)
		if roofed:
			# (its height left to the top given as far: the drips of the wall top stay off the dado)
			base.use("main", "tunnel_wall")
			_wall_quad(base, a + off, b + off, a.y, b.y, da, db, S[i], S[i + 1], a.y, b.y, a.y + 9.0, b.y + 9.0, inw, (Paint.WALL_GREEN if scheme > 0.5 else Paint.WALL_YELLOW) if mural else f.dado)
		else:
			K.oquad(base, a + off, b + off, Vector3(b.x, db, b.z) + off, Vector3(a.x, da, a.z) + off, inw, f.dado)
		base.use("main", "matte")
		_stripes(near, a + off * 2.0, b + off * 2.0, S[i], S[i + 1], 0.3, f.kerb, BLACK, inw, "tunnel_wall" if roofed else "paint")
		if mural and roofed and med.size() == n and med[i] and med[i + 1]:
			Paint.gap(near, a + off * 2.0, b + off * 2.0, ta, tb, S[i], S[i + 1], inw)
		elif mural:
			Paint.band(near, a + off * 2.0, b + off * 2.0, ta, tb, S[i], S[i + 1], inw, roofed, scheme)
		elif str(w.v) == "TUN-T3":
			# a yellow and black band at bumper height
			_stripes(near, a + off * 2.0 + Vector3(0, 0.9, 0), b + off * 2.0 + Vector3(0, 0.9, 0), S[i], S[i + 1], 0.3, YELLOW, BLACK, inw, "tunnel_wall" if roofed else "paint")
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
	# fittings along a roofed wall, each turned to its own segment (none along the wide section's line of pillars,
	# owner photo 03): fire point cabinets (T1), bullet cameras on arms and SOS points (T1, T2), lit exit signs
	var v := str(w.v)
	var cr0 := curve_of(v)
	var road_tunnel := v == "TUN-T1" or v == "TUN-T2"
	var clear := func(i: int) -> bool:
		return not (med.size() == n and med[i] and med[mini(i + 1, n - 1)])
	if mural:
		_along(P, S, HYDRANT_EVERY_M, 30.0, func(p: Vector3, i: int, _t: float) -> void:
			if not clear.call(i):
				return
			var d2 := _d2(P, i)
			Fit.fire_point(near, p, -O[i], Vector3(d2.x, 0, d2.y)))
	if road_tunnel:
		_along(P, S, CCTV_EVERY_M, 12.0, func(p: Vector3, i: int, t: float) -> void:
			var top := lerpf(T[i], T[mini(i + 1, n - 1)], t)
			if not clear.call(i) or top - p.y < 4.2:
				return
			var d2 := _d2(P, i)
			var sg := 1.0 if roundi((S[i] - 12.0) / CCTV_EVERY_M) % 2 == 0 else -1.0
			Services.camera(near, Vector3(p.x, top - cr0 - 1.45, p.z), -O[i], Vector3(d2.x, 0, d2.y) * sg))
		_along(P, S, Services.SOS_EVERY_M, 75.0, func(p: Vector3, i: int, t: float) -> void:
			if not clear.call(i) or lerpf(T[i], T[mini(i + 1, n - 1)], t) - p.y < 3.4:
				return
			var d2 := _d2(P, i)
			Services.sos_point(near, p, -O[i], Vector3(d2.x, 0, d2.y)))
	if f.get("strips", false) and v != "SUB-S4":
		_along(P, S, Services.EXIT_EVERY_M, 20.0, func(p: Vector3, i: int, t: float) -> void:
			if not clear.call(i) or lerpf(T[i], T[mini(i + 1, n - 1)], t) - p.y < 3.4:
				return
			var d2 := _d2(P, i)
			Services.exit_sign(near, p + Vector3(0, 2.55, 0) - O[i] * 0.04, -O[i], Vector3(d2.x, 0, d2.y)))
	# the runs along the top of the wall under the curve: a cable tray, and in the road tunnels a fire main and conduits
	if f.get("strips", false):
		var i0 := 0
		while i0 < n - 1:
			if not clear.call(i0):
				i0 += 1
				continue
			var i1 := i0
			var low := false
			while i1 < n - 1 and clear.call(i1):
				i1 += 1
			var RP: Array[Vector3] = []
			var RU: Array[Vector3] = []
			var RS := PackedFloat32Array()
			for k in range(i0, i1 + 1):
				RP.append(Vector3(P[k].x, T[k], P[k].z))
				RU.append(-O[k].normalized())
				RS.append(S[k])
				if T[k] - P[k].y < 4.2:
					low = true
			Services.wall_runs(near, RP, RU, RS, cr0 + 0.25, road_tunnel and not low, v != "SUB-S4" and not low)
			i0 = i1
		near.use("main", "matte")


## A band of a roofed wall between the heights a0 to a1 at a and b0 to b1 at b, for the wall shader (tunnel_wall of
## tunnel_lit.gdshader): UV (metres along the run, metres over the wall's foot fa and fb), the colour's alpha the
## height left to the wall's top over 8 m.
static func _wall_quad(m: KitMesh, a: Vector3, b: Vector3, a0: float, b0: float, a1: float, b1: float, sa: float, sb: float, fa: float, fb: float, ta: float, tb: float, want: Vector3, col: Color) -> void:
	Paint._oquad_uv(m, Vector3(a.x, a0, a.z), Vector3(b.x, b0, b.z), Vector3(b.x, b1, b.z), Vector3(a.x, a1, a.z),
		Vector2(sa, a0 - fa), Vector2(sb, b0 - fb), Vector2(sb, b1 - fb), Vector2(sa, a1 - fa),
		_shade(col, (ta - a0) / 8.0), _shade(col, (tb - b0) / 8.0), _shade(col, (tb - b1) / 8.0), _shade(col, (ta - a1) / 8.0), want)


## A colour with a value for the tunnel shaders in its alpha (0 to 1).
static func _shade(col: Color, x: float) -> Color:
	return Color(col.r, col.g, col.b, clampf(x, 0.0, 1.0))


## The curve between a roofed wall and its soffit (owner photo 02): a quarter round of radius r in front of the
## corner, from r under the wall top on the wall to r out on the soffit, facing the road and down, shaded smooth
## (a normal per corner). For the soffit shader: UV (metres along, metres round the curve), the alpha the metres
## from the wall over 4 m.
static func _curve(m: KitMesh, a: Vector3, b: Vector3, ta: float, tb: float, inw: Vector3, r: float, col: Color, sa: float, sb: float) -> void:
	if ta - a.y < r + 1.0 or tb - b.y < r + 1.0:
		return
	var top_a := Vector3(a.x, ta, a.z)
	var top_b := Vector3(b.x, tb, b.z)
	for k in CURVE_FACETS:
		var f0 := float(k) / CURVE_FACETS
		var f1 := float(k + 1) / CURVE_FACETS
		var t0 := f0 * PI * 0.5
		var t1 := f1 * PI * 0.5
		var o0 := inw * (r - r * cos(t0)) + Vector3(0, -r + r * sin(t0), 0)
		var o1 := inw * (r - r * cos(t1)) + Vector3(0, -r + r * sin(t1), 0)
		var n0 := inw * cos(t0) - Vector3(0, sin(t0), 0)
		var n1 := inw * cos(t1) - Vector3(0, sin(t1), 0)
		var c0 := _shade(col, r * f0 / 4.0)
		var c1 := _shade(col, r * f1 / 4.0)
		var u0 := r * f0
		var u1 := r * f1
		var mid := (t0 + t1) * 0.5
		var want := inw * cos(mid) - Vector3(0, sin(mid), 0)
		if ((top_b + o0) - (top_a + o0)).cross((top_b + o1) - (top_a + o0)).dot(want) >= 0.0:
			m.quad_n(top_a + o0, top_b + o0, top_b + o1, top_a + o1, n0, n0, n1, n1, Vector2(sa, u0), Vector2(sb, u0), Vector2(sb, u1), Vector2(sa, u1), c0, c0, c1, c1)
		else:
			m.quad_n(top_a + o0, top_a + o1, top_b + o1, top_b + o0, n0, n1, n1, n0, Vector2(sa, u0), Vector2(sa, u1), Vector2(sb, u1), Vector2(sb, u0), c0, c1, c1, c0)


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


## Alternating stripes of length STRIPE_M (by the run's metres) on a band h high from a b upwards. In the wall
## material of a roofed stretch (tunnel_wall) the quads carry the wall shader's kerb barrier UV (metres along, -1 less
## the metres over the band's foot).
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
		var col := c0 if k % 2 == 0 else c1
		if mat == "tunnel_wall":
			var s0 := lerpf(sa, sb, u0)
			var s1 := lerpf(sa, sb, u1)
			Paint._oquad_uv(m, p, q, q + Vector3(0, h, 0), p + Vector3(0, h, 0), Vector2(s0, -1.0), Vector2(s1, -1.0), Vector2(s1, -1.0 - h), Vector2(s0, -1.0 - h), col, col, col, col, want)
		else:
			K.oquad(m, p, q, q + Vector3(0, h, 0), p + Vector3(0, h, 0), want, col)
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
	# (tunnel_soffit: UV metres along and across, the alpha the metres to the nearest wall over 4 m)
	base.use("main", "tunnel_soffit")
	for i in n - 1:
		var w0 := (L[i] - R[i]).length()
		var w1 := (L[i + 1] - R[i + 1]).length()
		var u := _soffit_cuts((w0 + w1) * 0.5, v)
		for k in u.size() - 1:
			var e0 := minf(u[k], 1.0 - u[k])
			var e1 := minf(u[k + 1], 1.0 - u[k + 1])
			Paint._oquad_uv(base, L[i].lerp(R[i], u[k]), L[i + 1].lerp(R[i + 1], u[k]), L[i + 1].lerp(R[i + 1], u[k + 1]), L[i].lerp(R[i], u[k + 1]),
				Vector2(S[i], w0 * u[k]), Vector2(S[i + 1], w1 * u[k]), Vector2(S[i + 1], w1 * u[k + 1]), Vector2(S[i], w0 * u[k + 1]),
				_shade(f.soffit, w0 * e0 / 4.0), _shade(f.soffit, w1 * e0 / 4.0), _shade(f.soffit, w1 * e1 / 4.0), _shade(f.soffit, w0 * e1 / 4.0), Vector3.DOWN)
	base.use("main", "matte")
	# the light grey concrete road under it (owner photos 02 and 03)
	Paint.road(base, c, lines)
	# two continuous LED strip lines along the soffit near each upper wall edge (every tunnel and underpass), mounted on
	# it just past the curve (owner photos 02 and 03): 25 cm wide, 4 cm deep, in the tunnel's glow material (bright
	# enough to bloom at any hour, fading into the tunnel's haze)
	base.use("main", "tunnel_glow")
	for side in 2:
		for i in n - 1:
			var s0 := strip_offset((L[i] - R[i]).length(), v) / maxf((L[i] - R[i]).length(), 0.01)
			var s1 := strip_offset((L[i + 1] - R[i + 1]).length(), v) / maxf((L[i + 1] - R[i + 1]).length(), 0.01)
			var a: Vector3 = L[i].lerp(R[i], s0 if side == 0 else 1.0 - s0) + Vector3(0, -0.04, 0)
			var b: Vector3 = L[i + 1].lerp(R[i + 1], s1 if side == 0 else 1.0 - s1) + Vector3(0, -0.04, 0)
			K.beam_box(base, a, b, 0.25, 0.04, f.lamp, true)
	base.use("main", "matte")
	# what hangs under the soffit along the tunnel (kit_tunnel_services.gd): a cable tray beside each strip line with
	# two conduits past it, where the jet fans leave room; a trunking duct down the middle of a wide road tunnel (left
	# out where a message sign hangs); lane signals
	var U: Array[Vector3] = []
	for i in n:
		var ac := R[i] - L[i]
		U.append(Vector3(ac.x, 0, ac.z).normalized())
	var has_fans: bool = f.fans and width > 6.0
	var at := strip_offset(width, v) + 0.3
	var room := (0.28 * width - 0.5 if has_fans else width * 0.5 - 0.2) - 0.05
	if f.get("strips", false) and v != "SUB-S4" and at + 0.15 <= room:
		for side in 2:
			Services.ceiling_tray(near, L, R, S, at, side == 1, at + 0.43 <= room)
	if has_fans and width >= SIGNAL_MIN_WIDTH_M:
		Services.ceiling_duct(near, M, U, S, VMS_EVERY_M if f.vms else 0.0, 45.0, 3.0)
		_along(M, S, Services.SIGNAL_EVERY_M, 100.0, func(p: Vector3, i: int, t: float) -> void:
			var across := (R[i].lerp(R[i + 1], t) - L[i].lerp(L[i + 1], t))
			var dir0 := _d2(M, i)
			for side in [-0.14, 0.14]:
				Services.lane_signal(near, p + across * side, Vector3(dir0.x, 0, dir0.y)))
	if f.get("marigold", false):
		# orange marigold garlands hung across the soffit in loops (owner photo 02): flower heads on a string
		var bud := PackedVector2Array([Vector2(0.0, -0.05), Vector2(0.062, 0.0), Vector2(0.0, 0.05)])
		_along(M, S, MARIGOLD_EVERY_M, 1.5, func(_p: Vector3, i: int, t: float) -> void:
			var l: Vector3 = L[i].lerp(L[i + 1], t)
			var r: Vector3 = R[i].lerp(R[i + 1], t)
			var span := (r - l).length()
			var k := int(maxf(10.0, span / 0.3))
			# an odd number of loops, so the lowest point of the middle one hangs under the duct
			var loops := 1 if span < 6.5 else (3 if span < 15.0 else 5)
			near.use("main", "tunnel_lit")
			var last := Vector3.ZERO
			for j in k + 1:
				var u := float(j) / k
				var ul := fposmod(u * loops, 1.0) if j < k else 1.0
				var sag := (0.5 if loops > 1 else 0.55) * 4.0 * ul * (1.0 - ul)
				var q: Vector3 = l.lerp(r, u) + Vector3(0, -0.12 - sag, 0)
				near.lathe(bud, 5, q, MARIGOLD if j % 3 != 1 else T1_SAFFRON, PackedColorArray(), float(j) * 0.7)
				# the string between the flowers
				if j > 0:
					K.beam_box(near, last, q, 0.03, 0.03, MARIGOLD, true)
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


## A lane line along a lowered stretch (tlines; m 1 dashed 3 m on, 4.5 m off; 2 centre and 3 edge solid), 12 cm wide,
## 2 cm over the road. The game has no road shader for the lane UV's codes yet, so the tunnels carry their own paint.
## `under` (a point -> bool) says where a roof is over the line: there it is lit by the tunnel's strips like the road
## (over the tunnel's road finish, 8 mm), on an open ramp it is road paint under the sky.
static func line(base: KitMesh, l: Dictionary, under := Callable()) -> void:
	var pts := K.points(l.p, 3)
	var n := pts.size()
	if n < 2:
		return
	var dashed := int(l.get("m", 3)) == 1
	var s := float(l.get("s0", 0.0))
	for i in n - 1:
		var a := Vector3(float(pts[i][0]), float(pts[i][1]) + 0.02, float(pts[i][2]))
		var b := Vector3(float(pts[i + 1][0]), float(pts[i + 1][1]) + 0.02, float(pts[i + 1][2]))
		base.use("main", "tunnel_lit" if under.is_valid() and under.call((a + b) * 0.5) else "paint")
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
