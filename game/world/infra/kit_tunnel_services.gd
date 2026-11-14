## The services of a roofed tunnel (P2-032 attempt 3, owner photos 02 and 03 of
## harness/design/reference/owner/pragati_maidan_tunnel/): what runs along the soffit and the upper wall and what is
## fixed to them. Cable trays hung under the soffit beside each LED strip line with conduits next to them, a trunking
## duct down the middle, a tray, a fire main and conduits on brackets along the top of each wall, bullet cameras on
## arms, lit exit signs, SOS points and lane signals. All in tunnel_lit (shaded by the strip lines), lit faces in
## tunnel_glow. Kit inputs are world metres. Pure.
extends RefCounted

const KitMesh := preload("res://world/landmarks/kit_mesh.gd")
const K := preload("res://world/infra/infra_kit.gd")

const GALV := Color("#8a8f93")
const GALV_DARK := Color("#5d6266")
const GALV_DUCT := Color("#767b7f")
const TRAY := Color("#4a4d50")
const MAIN_RED := Color("#7d2a25")
const CONDUIT := Color("#3b3d40")
const CLIP := Color("#9a9ea2")
const CAM_BODY := Color("#d9d9d4")
const CAM_DARK := Color("#1c1d20")
const EXIT_GREEN := Color("#1f9a50")
const EXIT_WHITE := Color("#f2f5ee")
const SOS_ORANGE := Color("#e2761b")
const SOS_BLUE := Color("#1f4f9e")
const SIGNAL_GREEN := Color("#3ee06a")

const HANGER_EVERY_M := 3.6
const EXIT_EVERY_M := 60.0
const SOS_EVERY_M := 120.0
const SIGNAL_EVERY_M := 180.0
const FLANGE_EVERY_M := 3.0

## Lit faces: the colour's alpha is the face's share of a strip's brightness (tunnel_glow.gdshader).
const LIT_SIGN := 0.1
const LIT_SIGNAL := 0.5


## A run of n-sided pipe of radius r through the points, `us` the unit vector across at each (the pipe's section lies
## in the plane of `us` and up).
static func pipe(m: KitMesh, pts: Array[Vector3], us: Array[Vector3], r: float, col: Color, sides := 6) -> void:
	var prof := PackedVector2Array()
	for k in sides:
		var a := TAU * (k + 0.5) / sides
		prof.append(Vector2(cos(a) * r, sin(a) * r))
	K.sweep(m, _frames(pts, us), prof, Vector2.ZERO, col, true)


## A cable tray through the points: a channel w wide and h deep, open on top, its bottom at the points.
static func tray(m: KitMesh, pts: Array[Vector3], us: Array[Vector3], w: float, h: float, col: Color) -> void:
	var hw := w * 0.5
	K.sweep(m, _frames(pts, us), PackedVector2Array([Vector2(-hw, h), Vector2(-hw, 0), Vector2(hw, 0), Vector2(hw, h)]), Vector2(0, h * 3.0), col)


## A closed rectangular duct through the points (its top at the points, h down), with its two end faces.
static func duct(m: KitMesh, pts: Array[Vector3], us: Array[Vector3], w: float, h: float, col: Color) -> void:
	var hw := w * 0.5
	K.sweep(m, _frames(pts, us), PackedVector2Array([Vector2(-hw, 0), Vector2(hw, 0), Vector2(hw, -h), Vector2(-hw, -h)]), Vector2(0, -h * 0.5), col, true)
	for e in [0, pts.size() - 1]:
		var p := pts[e]
		var u := us[e]
		var out := (pts[0] - pts[1]) if e == 0 else (pts[e] - pts[e - 1])
		K.oquad(m, p - u * hw, p + u * hw, p + u * hw - Vector3(0, h, 0), p - u * hw - Vector3(0, h, 0), out, col)


static func _frames(pts: Array[Vector3], us: Array[Vector3]) -> Array:
	var frames := []
	for i in pts.size():
		frames.append([pts[i], us[i], Vector3.UP])
	return frames


## The part of a run (points P with their metres S and across vectors U) between s0 and s1: [points, across vectors].
static func sub_run(P: Array[Vector3], U: Array[Vector3], S: PackedFloat32Array, s0: float, s1: float) -> Array:
	var pts: Array[Vector3] = []
	var us: Array[Vector3] = []
	var n := P.size()
	s0 = maxf(s0, S[0])
	s1 = minf(s1, S[n - 1])
	if s1 - s0 < 0.2:
		return [pts, us]
	for i in n - 1:
		if S[i + 1] <= s0 or S[i] >= s1:
			continue
		var len := maxf(S[i + 1] - S[i], 1e-3)
		if pts.is_empty():
			var t := clampf((s0 - S[i]) / len, 0.0, 1.0)
			pts.append(P[i].lerp(P[i + 1], t))
			us.append(U[i].lerp(U[i + 1], t).normalized())
		var t1 := clampf((s1 - S[i]) / len, 0.0, 1.0)
		pts.append(P[i].lerp(P[i + 1], t1))
		us.append(U[i].lerp(U[i + 1], t1).normalized())
	return [pts, us]


## Calls fn(point, across, along, metres) every `every` metres of a run from `phase`.
static func along(P: Array[Vector3], U: Array[Vector3], S: PackedFloat32Array, every: float, phase: float, fn: Callable) -> void:
	var n := P.size()
	var k0 := ceili((S[0] - phase) / every)
	var k1 := floori((S[n - 1] - phase) / every)
	var i := 0
	for k in range(k0, k1 + 1):
		var s := phase + k * every
		while i < n - 2 and S[i + 1] < s:
			i += 1
		var t := clampf((s - S[i]) / maxf(1e-3, S[i + 1] - S[i]), 0.0, 1.0)
		var d := P[i + 1] - P[i]
		var d2 := Vector3(d.x, 0, d.z)
		fn.call(P[i].lerp(P[i + 1], t), U[i].lerp(U[i + 1], t).normalized(), d2.normalized() if d2.length() > 1e-4 else Vector3(0, 0, 1), s)


## What runs along the top of a roofed wall under the curve to the soffit: a cable tray on brackets, under it (the
## road tunnels) a fire main and two conduits on clips. `P` the wall's top line, `U` into the road, `under` how far
## under the top the first run sits (the curve's radius and a gap), `main` true for the fire main, `conduits` for
## the two conduits.
static func wall_runs(m: KitMesh, P: Array[Vector3], U: Array[Vector3], S: PackedFloat32Array, under: float, main: bool, conduits: bool) -> void:
	if P.size() < 2:
		return
	m.use("main", "tunnel_lit")
	var tr: Array[Vector3] = []
	var pm: Array[Vector3] = []
	var c0: Array[Vector3] = []
	var c1: Array[Vector3] = []
	for i in P.size():
		tr.append(P[i] + U[i] * 0.2 - Vector3(0, under + 0.1, 0))
		pm.append(P[i] + U[i] * 0.13 - Vector3(0, under + 0.5, 0))
		c0.append(P[i] + U[i] * 0.045 - Vector3(0, under + 0.74, 0))
		c1.append(P[i] + U[i] * 0.045 - Vector3(0, under + 0.83, 0))
	tray(m, tr, U, 0.3, 0.07, TRAY)
	if main:
		pipe(m, pm, U, 0.075, MAIN_RED, 6)
	if conduits:
		pipe(m, c0, U, 0.024, CONDUIT, 3)
		pipe(m, c1, U, 0.024, CONDUIT, 3)
	# brackets under the tray and clips round the pipes
	along(P, U, S, HANGER_EVERY_M, 1.8, func(p: Vector3, u: Vector3, d: Vector3, _s: float) -> void:
		var d2 := Vector2(d.x, d.z)
		var q := p - Vector3(0, under + 0.1, 0)
		K.post(m, q + u * 0.18 - Vector3(0, 0.035, 0), Vector3(0.04, 0.035, 0.36), Vector2(u.x, u.z), GALV_DARK)
		K.post(m, q + u * 0.02 - Vector3(0, 0.2, 0), Vector3(0.04, 0.2, 0.04), d2, GALV_DARK)
		if main:
			K.post(m, p + u * 0.13 - Vector3(0, under + 0.5 + 0.09, 0), Vector3(0.19, 0.18, 0.035), d2, CLIP)
		if conduits:
			K.post(m, p + u * 0.04 - Vector3(0, under + 0.86, 0), Vector3(0.07, 0.15, 0.03), d2, CLIP))
	m.use("main", "matte")


## What hangs under the soffit along one side: a cable tray beside the strip line at `at` metres from the left wall
## (L to R across), hung `drop` under the soffit on rods, and two conduits on the soffit just past it.
static func ceiling_tray(m: KitMesh, L: Array[Vector3], R: Array[Vector3], S: PackedFloat32Array, at: float, from_right: bool, conduits: bool) -> void:
	var n := L.size()
	var P: Array[Vector3] = []
	var U: Array[Vector3] = []
	for i in n:
		var ac := R[i] - L[i]
		var w := ac.length()
		ac = Vector3(ac.x, 0, ac.z).normalized()
		var x := (w - at) if from_right else at
		P.append(L[i] + ac * x)
		U.append(ac if not from_right else -ac)
	m.use("main", "tunnel_lit")
	var tr: Array[Vector3] = []
	var c0: Array[Vector3] = []
	var c1: Array[Vector3] = []
	for i in n:
		tr.append(P[i] - Vector3(0, 0.26, 0))
		c0.append(P[i] + U[i] * 0.33 - Vector3(0, 0.03, 0))
		c1.append(P[i] + U[i] * 0.41 - Vector3(0, 0.03, 0))
	tray(m, tr, U, 0.3, 0.07, TRAY)
	# the cables in it show over its rim from the road
	var cb: Array[Vector3] = []
	for i in n:
		cb.append(P[i] - Vector3(0, 0.2, 0))
	K.sweep(m, _frames(cb, U), PackedVector2Array([Vector2(-0.11, 0.0), Vector2(-0.05, 0.05), Vector2(0.06, 0.04), Vector2(0.11, 0.0)]), Vector2(0, -1.0), CAM_DARK)
	if conduits:
		pipe(m, c0, U, 0.022, CONDUIT, 3)
		pipe(m, c1, U, 0.022, GALV, 3)
	along(P, U, S, HANGER_EVERY_M, 0.6, func(p: Vector3, u: Vector3, d: Vector3, _s: float) -> void:
		var d2 := Vector2(d.x, d.z)
		for sg in [-1.0, 1.0]:
			K.post(m, p + u * (0.17 * sg) - Vector3(0, 0.29, 0), Vector3(0.016, 0.29, 0.016), d2, GALV)
		K.post(m, p - Vector3(0, 0.295, 0), Vector3(0.04, 0.03, 0.4), Vector2(u.x, u.z), GALV_DARK)
		if conduits:
			K.post(m, p + u * 0.37 - Vector3(0, 0.06, 0), Vector3(0.03, 0.025, 0.16), Vector2(u.x, u.z), CLIP))
	m.use("main", "matte")


## The trunking duct down the middle of a soffit (the points M with their across vectors), 0.34 m wide and 0.2 deep
## on straps, with a flange every 3 m; left out for `gap` metres about every `gap_every` (from `gap_phase`), where a
## message sign hangs.
static func ceiling_duct(m: KitMesh, M: Array[Vector3], U: Array[Vector3], S: PackedFloat32Array, gap_every: float, gap_phase: float, gap: float) -> void:
	var n := M.size()
	if n < 2:
		return
	m.use("main", "tunnel_lit")
	var pieces := []
	if gap_every <= 0.0:
		pieces.append([S[0], S[n - 1]])
	else:
		var k0 := floori((S[0] - gap_phase) / gap_every)
		var k1 := ceili((S[n - 1] - gap_phase) / gap_every)
		for k in range(k0, k1 + 1):
			pieces.append([gap_phase + k * gap_every + gap * 0.5, gap_phase + (k + 1) * gap_every - gap * 0.5])
	for pc: Array in pieces:
		var run := sub_run(M, U, S, float(pc[0]), float(pc[1]))
		var pts: Array[Vector3] = run[0]
		var us: Array[Vector3] = run[1]
		if pts.size() < 2:
			continue
		var top: Array[Vector3] = []
		for p in pts:
			top.append(p - Vector3(0, 0.05, 0))
		duct(m, top, us, 0.34, 0.2, GALV_DUCT)
	along(M, U, S, FLANGE_EVERY_M, 1.5, func(p: Vector3, _u: Vector3, d: Vector3, s_here: float) -> void:
		# no flange in a gap
		if gap_every > 0.0 and absf(fposmod(s_here - gap_phase + gap_every * 0.5, gap_every) - gap_every * 0.5) < gap * 0.5 + 0.3:
			return
		K.post(m, p - Vector3(0, 0.27, 0), Vector3(0.4, 0.26, 0.05), Vector2(d.x, d.z), GALV_DARK))
	m.use("main", "matte")


## A bullet camera on an arm off the wall at `p` (on the wall face), `inw` into the road, looking along `d`: a wall
## plate, an arm, a white housing with a sun shield and a dark lens.
static func camera(m: KitMesh, p: Vector3, inw: Vector3, d: Vector3) -> void:
	var d2 := Vector2(d.x, d.z)
	m.use("main", "tunnel_lit")
	K.post(m, p + inw * 0.015 - Vector3(0, 0.09, 0), Vector3(0.03, 0.18, 0.14), d2, GALV_DARK)
	K.beam_box(m, p - Vector3(0, 0.02, 0), p + inw * 0.42 - Vector3(0, 0.02, 0), 0.035, 0.035, GALV_DARK, true)
	var c := p + inw * 0.42 - Vector3(0, 0.2, 0)
	K.post(m, p + inw * 0.42 - Vector3(0, 0.1, 0), Vector3(0.04, 0.1, 0.04), d2, GALV_DARK)
	# the housing along d, tipped down to the road
	var y := (d * 0.94 - Vector3(0, 0.34, 0)).normalized()
	var x := y.cross(Vector3.UP).normalized()
	var z := x.cross(y)
	m.push(Transform3D(Basis(x, y, z), c))
	m.lathe(PackedVector2Array([Vector2(0.0, -0.16), Vector2(0.055, -0.16), Vector2(0.06, -0.1), Vector2(0.06, 0.13), Vector2(0.06, 0.13), Vector2(0.048, 0.13), Vector2(0.048, 0.13), Vector2(0.04, 0.115), Vector2(0.0, 0.115)]), 8, Vector3.ZERO, CAM_BODY,
		PackedColorArray([CAM_BODY, CAM_BODY, CAM_BODY, CAM_BODY, CAM_DARK, CAM_DARK, CAM_DARK, CAM_DARK, CAM_DARK]))
	m.pop()
	# the sun shield over it
	var sa := c - y * 0.14 + z * 0.068
	var sb := c + y * 0.2 + z * 0.068
	K.oquad(m, sa - x * 0.07, sa + x * 0.07, sb + x * 0.07, sb - x * 0.07, z, CAM_BODY)
	K.oquad(m, sa - x * 0.07, sa + x * 0.07, sb + x * 0.07, sb - x * 0.07, -z, CAM_DARK)
	m.use("main", "matte")


## A lit exit sign flat on the wall at `p` (wall face, the sign's middle), facing `inw`: a green box with the white
## running figure, a door and an arrow along `d`.
static func exit_sign(m: KitMesh, p: Vector3, inw: Vector3, d: Vector3) -> void:
	var d2 := Vector2(d.x, d.z)
	m.use("main", "tunnel_lit")
	K.post(m, p + inw * 0.03 - Vector3(0, 0.17, 0), Vector3(0.06, 0.34, 0.78), d2, CAM_DARK)
	m.use("main", "tunnel_glow")
	var f := p + inw * 0.062
	var g := Color(EXIT_GREEN, LIT_SIGN)
	var wh := Color(EXIT_WHITE, LIT_SIGN * 1.6)
	K.oquad(m, f - d * 0.36 - Vector3(0, 0.14, 0), f + d * 0.36 - Vector3(0, 0.14, 0), f + d * 0.36 + Vector3(0, 0.14, 0), f - d * 0.36 + Vector3(0, 0.14, 0), inw, g)
	var o := inw * 0.004
	# the door, the figure (head, body, a leg forward and a leg back) and the arrow
	K.oquad(m, f + o - d * 0.31 - Vector3(0, 0.1, 0), f + o - d * 0.2 - Vector3(0, 0.1, 0), f + o - d * 0.2 + Vector3(0, 0.1, 0), f + o - d * 0.31 + Vector3(0, 0.1, 0), inw, wh)
	K.oquad(m, f + o - d * 0.11 + Vector3(0, 0.05, 0), f + o - d * 0.06 + Vector3(0, 0.05, 0), f + o - d * 0.06 + Vector3(0, 0.1, 0), f + o - d * 0.11 + Vector3(0, 0.1, 0), inw, wh)
	K.oquad(m, f + o - d * 0.13 - Vector3(0, 0.03, 0), f + o - d * 0.07 - Vector3(0, 0.03, 0), f + o - d * 0.05 + Vector3(0, 0.04, 0), f + o - d * 0.11 + Vector3(0, 0.04, 0), inw, wh)
	_tri(m, f + o - d * 0.13 - Vector3(0, 0.03, 0), f + o - d * 0.08 - Vector3(0, 0.03, 0), f + o - d * 0.17 - Vector3(0, 0.1, 0), inw, wh)
	_tri(m, f + o - d * 0.1 - Vector3(0, 0.03, 0), f + o - d * 0.06 - Vector3(0, 0.03, 0), f + o - d * 0.02 - Vector3(0, 0.1, 0), inw, wh)
	K.oquad(m, f + o + d * 0.06 - Vector3(0, 0.02, 0), f + o + d * 0.22 - Vector3(0, 0.02, 0), f + o + d * 0.22 + Vector3(0, 0.02, 0), f + o + d * 0.06 + Vector3(0, 0.02, 0), inw, wh)
	_tri(m, f + o + d * 0.2 - Vector3(0, 0.07, 0), f + o + d * 0.31, f + o + d * 0.2 + Vector3(0, 0.07, 0), inw, wh)
	m.use("main", "matte")


## An SOS point on the wall at `foot` (the wall's foot): an orange phone cabinet with a door and a hood, and over it
## a blue sign standing off the wall like a flag, with a white handset on both faces.
static func sos_point(m: KitMesh, foot: Vector3, inw: Vector3, d: Vector3) -> void:
	var d2 := Vector2(d.x, d.z)
	m.use("main", "tunnel_lit")
	var base := foot + Vector3(0, 1.0, 0)
	K.post(m, base + inw * 0.09, Vector3(0.18, 0.62, 0.42), d2, SOS_ORANGE)
	K.post(m, base + inw * 0.185 + Vector3(0, 0.05, 0), Vector3(0.012, 0.5, 0.32), d2, Color("#f08a2e"))
	K.post(m, base + inw * 0.195 + Vector3(0, 0.3, 0) + d * 0.12, Vector3(0.02, 0.09, 0.025), d2, CAM_DARK)
	# the hood: a sloped top
	var t0 := base + Vector3(0, 0.62, 0)
	K.oquad(m, t0 - d * 0.23, t0 + d * 0.23, t0 + d * 0.23 + inw * 0.26 - Vector3(0, 0.05, 0), t0 - d * 0.23 + inw * 0.26 - Vector3(0, 0.05, 0), Vector3.UP, SOS_ORANGE)
	K.oquad(m, t0 - d * 0.23, t0 + d * 0.23, t0 + d * 0.23 + inw * 0.26 - Vector3(0, 0.05, 0), t0 - d * 0.23 + inw * 0.26 - Vector3(0, 0.05, 0), Vector3.DOWN, CAM_DARK)
	# the flag sign over it
	var s0 := foot + Vector3(0, 2.35, 0)
	K.beam_box(m, s0 + Vector3(0, 0.16, 0), s0 + inw * 0.5 + Vector3(0, 0.16, 0), 0.03, 0.03, GALV_DARK, true)
	m.use("main", "tunnel_glow")
	var blue := Color(SOS_BLUE, LIT_SIGN * 1.5)
	var wh := Color(EXIT_WHITE, LIT_SIGN * 1.6)
	for sg in [-1.0, 1.0]:
		var face: Vector3 = d * sg
		var c := s0 + inw * 0.3 + face * 0.02
		K.oquad(m, c - inw * 0.18 - Vector3(0, 0.18, 0), c + inw * 0.18 - Vector3(0, 0.18, 0), c + inw * 0.18 + Vector3(0, 0.18, 0), c - inw * 0.18 + Vector3(0, 0.18, 0), face, blue)
		var o := face * 0.004
		# the handset: a slanted bar with an ear and a mouth piece
		K.oquad(m, c + o - inw * 0.09 - Vector3(0, 0.07, 0), c + o - inw * 0.05 - Vector3(0, 0.1, 0), c + o + inw * 0.1 + Vector3(0, 0.06, 0), c + o + inw * 0.06 + Vector3(0, 0.09, 0), face, wh)
		K.oquad(m, c + o - inw * 0.12 - Vector3(0, 0.1, 0), c + o - inw * 0.03 - Vector3(0, 0.12, 0), c + o - inw * 0.03 - Vector3(0, 0.05, 0), c + o - inw * 0.12 - Vector3(0, 0.03, 0), face, wh)
		K.oquad(m, c + o + inw * 0.03 + Vector3(0, 0.05, 0), c + o + inw * 0.12 + Vector3(0, 0.03, 0), c + o + inw * 0.12 + Vector3(0, 0.1, 0), c + o + inw * 0.03 + Vector3(0, 0.12, 0), face, wh)
	m.use("main", "tunnel_lit")
	K.post(m, s0 + inw * 0.3 - Vector3(0, 0.2, 0), Vector3(0.03, 0.4, 0.4), Vector2(inw.x, inw.z), CAM_DARK)
	m.use("main", "matte")


## A lane signal flush under the soffit at `top` (a point on the soffit), facing both ways along `d`: a black box
## with a hood on a short bracket, a green arrow down on each face.
static func lane_signal(m: KitMesh, top: Vector3, d: Vector3) -> void:
	var d2 := Vector2(d.x, d.z)
	var across := Vector3(-d.z, 0, d.x)
	m.use("main", "tunnel_lit")
	K.post(m, top - Vector3(0, 0.14, 0), Vector3(0.08, 0.14, 0.08), d2, GALV_DARK)
	var c := top - Vector3(0, 0.74, 0)
	K.post(m, c, Vector3(0.62, 0.6, 0.16), d2, CAM_DARK)
	for sg in [-1.0, 1.0]:
		var face: Vector3 = d * sg
		# the hood over the face
		var h0 := c + Vector3(0, 0.6, 0) + face * 0.08
		K.oquad(m, h0 - across * 0.31, h0 + across * 0.31, h0 + across * 0.31 + face * 0.14 - Vector3(0, 0.03, 0), h0 - across * 0.31 + face * 0.14 - Vector3(0, 0.03, 0), Vector3.UP, CAM_DARK)
		K.oquad(m, h0 - across * 0.31, h0 + across * 0.31, h0 + across * 0.31 + face * 0.14 - Vector3(0, 0.03, 0), h0 - across * 0.31 + face * 0.14 - Vector3(0, 0.03, 0), Vector3.DOWN, CAM_DARK)
	m.use("main", "tunnel_glow")
	var g := Color(SIGNAL_GREEN, LIT_SIGNAL)
	for sg in [-1.0, 1.0]:
		var face: Vector3 = d * sg
		var f := c + Vector3(0, 0.3, 0) + face * 0.084
		K.oquad(m, f - across * 0.05 + Vector3(0, 0.0, 0), f + across * 0.05 + Vector3(0, 0.0, 0), f + across * 0.05 + Vector3(0, 0.2, 0), f - across * 0.05 + Vector3(0, 0.2, 0), face, g)
		_tri(m, f - across * 0.17 + Vector3(0, 0.02, 0), f + across * 0.17 + Vector3(0, 0.02, 0), f - Vector3(0, 0.2, 0), face, g)
	m.use("main", "matte")


## A triangle turned to face `want`.
static func _tri(m: KitMesh, a: Vector3, b: Vector3, c: Vector3, want: Vector3, col: Color) -> void:
	if (b - a).cross(c - a).dot(want) >= 0.0:
		m.tri(a, b, c, col)
	else:
		m.tri(a, c, b, col)
