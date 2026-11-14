## The road structure kits (P2-034, flyovers.md and bridges.md of harness/design/reference/infrastructure/): the side
## of a deck or a ramp (barrier, fascia or retaining wall, lamps), the underside (T beams or a box girder), the piers
## and portal beams, and the end walls. Variants:
##   FLY-T1, BRI-ROB  older T beam flyover: black and white painted kerb wall with an orange tubular rail, stepped cap
##                    on twin square columns, T beams under a thin slab, sooty fascia (ROB adds a mesh screen)
##   FLY-B1           newer box girder: New Jersey concrete barrier, smooth box soffit with wings, hammerhead pier
##   FLY-R1           ramps and loops: the T1 kerb and rail on panelled retaining walls; loops on round columns
##   BRI-Y1, BRI-MIN  river and small bridges: solid parapet with a steel hand rail, wall piers with cutwaters
##   FOB-*            a foot bridge on the road graph: steel mesh railing, steel girders
## Kit inputs are world metres (the sink's frame takes the tile origin off). Pure.
extends RefCounted

const KitMesh := preload("res://world/landmarks/kit_mesh.gd")
const K := preload("res://world/infra/infra_kit.gd")

const CONC := Color("#8c8a85")
const CONC_NEW := Color("#a3a19b")
const CONC_SOOT := Color("#6f6d68")
const CONC_UNDER := Color("#7a7873")
const BLACK := Color("#1c1c1e")
const WHITE := Color("#f2f0ea")
const ORANGE := Color("#d9622a")
const GALV := Color("#7d8288")
const LAMP := Color("#c9c6bd")
const STEEL_BLUE := Color("#4f6d8a")
const MESH := Color("#3a3f44")
const YELLOW := Color("#f2c230")

## Height of the T style kerb wall as a share of the barrier height (0.5 of 0.9 m).
const KERB_SHARE := 0.55
const LAMP_EVERY_M := 36.0
const POST_EVERY_M := 2.0


static func style(v: String) -> String:
	if v == "FLY-B1" or v == "BRI-Y2":
		return "box"
	if v == "BRI-Y1" or v == "BRI-MIN":
		return "parapet"
	if v.begins_with("FOB"):
		return "steel"
	return "tbeam"


## One side of a deck (k "d") or a fill (k "f"): its face, its barrier, its lamps.
static func edge(base: KitMesh, near: KitMesh, e: Dictionary) -> void:
	var v := str(e.v)
	var st := style(v)
	var fill := str(e.k) == "f"
	var pts := K.points(e.p, 7)
	var n := pts.size()
	if n < 2:
		return
	var P := []
	var O := []
	var H := PackedFloat32Array()
	var F := PackedFloat32Array()
	for q: Array in pts:
		P.append(Vector3(float(q[0]), float(q[1]), float(q[2])))
		O.append(Vector3(float(q[5]), 0.0, float(q[6])))
		H.append(maxf(0.05, float(q[3]) - float(q[1])))
		F.append(float(q[4]))
	# the face: from the barrier top (the kerb top for the T style, the wing edge for the box) down to the foot
	var faces := []
	for i in n:
		var p: Vector3 = P[i]
		var top := p.y + (H[i] * KERB_SHARE if st == "tbeam" or st == "steel" else H[i])
		var foot := F[i]
		if st == "box" and not fill:
			foot = maxf(foot, p.y - 0.5)
		if st == "steel" and not fill:
			foot = maxf(foot, p.y - 0.6)
		faces.append([p, top, minf(foot, top - 0.05)])
	var soot_y := 0.0
	for i in n - 1:
		var a: Array = faces[i]
		var b: Array = faces[i + 1]
		var oa: Vector3 = O[i]
		var want := (oa + (O[i + 1] as Vector3)).normalized()
		var pa: Vector3 = a[0]
		var pb: Vector3 = b[0]
		var ta := float(a[1])
		var tb := float(b[1])
		var fa := float(a[2])
		var fb := float(b[2])
		if fill:
			# a retaining wall (flyovers.md FLY-R1): grey panels, a coping, a painted kerb band at the ground
			K.oquad(base, Vector3(pa.x, ta, pa.z), Vector3(pb.x, tb, pb.z), Vector3(pb.x, fb, pb.z), Vector3(pa.x, fa, pa.z), want, CONC)
		else:
			var col := CONC_NEW if st == "box" else (STEEL_BLUE if st == "steel" else CONC)
			# the upper band of the fascia (the edge beam's face) and, under it, the soot the rain carries down
			var ma := maxf(fa, ta - 0.55)
			var mb := maxf(fb, tb - 0.55)
			K.oquad(base, Vector3(pa.x, ta, pa.z), Vector3(pb.x, tb, pb.z), Vector3(pb.x, mb, pb.z), Vector3(pa.x, ma, pa.z), want, col)
			if ma - fa > 0.02 or mb - fb > 0.02:
				K.oquad(base, Vector3(pa.x, ma, pa.z), Vector3(pb.x, mb, pb.z), Vector3(pb.x, fb, pb.z), Vector3(pa.x, fa, pa.z), want, CONC_SOOT if st != "steel" else STEEL_BLUE.darkened(0.2))
	if fill:
		_retaining_dressing(base, near, P, O, faces, F)
	match st:
		"tbeam":
			_t_rail(base, near, P, O, H, v == "BRI-ROB")
		"box":
			_jersey(base, P, O, H)
		"parapet":
			_parapet(base, near, P, O, H, WHITE if v == "BRI-MIN" else GALV)
		"steel":
			_steel_rail(base, near, P, O, H)
	if st != "steel" and v != "BRI-MIN":
		_lamps(base, P, O, H)


## Frames for a sweep along the run: [the road edge, outward, up scaled by the barrier height].
static func _frames(P: Array, O: Array, H: PackedFloat32Array, scale_up := true) -> Array:
	var out := []
	for i in P.size():
		out.append([P[i], O[i], Vector3.UP * (H[i] if scale_up else 1.0)])
	return out


## T style (FLY-T1, R1, ROB): a kerb wall painted in black and white blocks, posts and two orange tubes over it.
static func _t_rail(base: KitMesh, near: KitMesh, P: Array, O: Array, H: PackedFloat32Array, screen: bool) -> void:
	var fr := _frames(P, O, H)
	K.sweep(base, fr, PackedVector2Array([Vector2(0, 0), Vector2(-0.25, 0), Vector2(-0.25, KERB_SHARE), Vector2(0, KERB_SHARE)]), Vector2(-0.12, KERB_SHARE * 0.5 - 0.5), CONC)
	# the paint: alternate 0.5 m blocks on the road face, a hair proud of it
	var s := 0.0
	for i in P.size() - 1:
		var a: Vector3 = P[i]
		var b: Vector3 = P[i + 1]
		var len := Vector2(b.x - a.x, b.z - a.z).length()
		var oa: Vector3 = O[i]
		var k := 0
		var t0 := 0.0
		while t0 < len - 1e-3:
			var t1 := minf(len, t0 + 0.5 - fmod(s + t0, 0.5))
			var c := WHITE if int(floor((s + t0 + 1e-3) / 0.5)) % 2 == 0 else BLACK
			var pa := a.lerp(b, t0 / len) - oa * 0.255
			var pb := a.lerp(b, t1 / len) - oa * 0.255
			var ha := lerpf(H[i], H[i + 1], t0 / len) * KERB_SHARE
			var hb := lerpf(H[i], H[i + 1], t1 / len) * KERB_SHARE
			K.oquad(near, pa, pb, pb + Vector3.UP * hb, pa + Vector3.UP * ha, -oa, c)
			t0 = t1
			k += 1
			if k > 400:
				break
		s += len
	# the rail: posts every 2 m and two orange tubes, where the barrier is up to its full height
	var tube := PackedVector2Array([Vector2(-0.16, 0), Vector2(-0.09, 0), Vector2(-0.09, 0.07), Vector2(-0.16, 0.07)])
	for h: float in [0.78, 1.06]:
		var frames := []
		for i in P.size():
			frames.append([(P[i] as Vector3) + Vector3.UP * (h * clampf(H[i] / 0.9, 0.0, 1.0)), O[i], Vector3.UP])
		K.sweep(base, frames, tube, Vector2(-0.125, 0.035), ORANGE, true)
	var walk := 0.0
	for i in P.size() - 1:
		var a: Vector3 = P[i]
		var b: Vector3 = P[i + 1]
		var len := Vector2(b.x - a.x, b.z - a.z).length()
		var d := Vector2(b.x - a.x, b.z - a.z) / maxf(len, 1e-4)
		var t := POST_EVERY_M - fmod(walk, POST_EVERY_M)
		while t < len:
			var f := t / len
			var h := lerpf(H[i], H[i + 1], f)
			if h > 0.6:
				var p := a.lerp(b, f) - (O[i] as Vector3) * 0.125 + Vector3.UP * (h * KERB_SHARE)
				K.post(near, p, Vector3(0.07, 1.13 * h / 0.9 - h * KERB_SHARE, 0.07), d, ORANGE)
				if screen:
					K.post(near, p + Vector3.UP * (1.13 * h / 0.9 - h * KERB_SHARE), Vector3(0.05, 1.3, 0.05), d, GALV)
			t += POST_EVERY_M
		walk += len
	if screen:
		# BRI-ROB: a mesh screen against things thrown on the line (bridges.md)
		for i in P.size() - 1:
			var a: Vector3 = (P[i] as Vector3) - (O[i] as Vector3) * 0.125 + Vector3.UP * 1.15
			var b: Vector3 = (P[i + 1] as Vector3) - (O[i + 1] as Vector3) * 0.125 + Vector3.UP * 1.15
			K.oquad(near, a, b, b + Vector3.UP * 1.3, a + Vector3.UP * 1.3, O[i], MESH)
			K.oquad(near, a, b, b + Vector3.UP * 1.3, a + Vector3.UP * 1.3, -(O[i] as Vector3), MESH)


## Box style (FLY-B1): a New Jersey concrete barrier, its sloped foot on the road side.
static func _jersey(base: KitMesh, P: Array, O: Array, H: PackedFloat32Array) -> void:
	var prof := PackedVector2Array([Vector2(0, 1.0), Vector2(-0.15, 1.0), Vector2(-0.2, 0.38), Vector2(-0.33, 0.09), Vector2(-0.33, 0.0)])
	K.sweep(base, _frames(P, O, H), prof, Vector2(0.0, 0.0), CONC_NEW)


## Parapet style (BRI-Y1, BRI-MIN): a solid concrete parapet and a hand rail on posts over it.
static func _parapet(base: KitMesh, near: KitMesh, P: Array, O: Array, H: PackedFloat32Array, rail: Color) -> void:
	K.sweep(base, _frames(P, O, H), PackedVector2Array([Vector2(0, 0), Vector2(-0.25, 0), Vector2(-0.25, 1.0), Vector2(0, 1.0)]), Vector2(-0.12, -0.5), CONC)
	var frames := []
	for i in P.size():
		frames.append([(P[i] as Vector3) + Vector3.UP * (H[i] + 0.2), O[i], Vector3.UP])
	K.sweep(base, frames, PackedVector2Array([Vector2(-0.16, 0), Vector2(-0.09, 0), Vector2(-0.09, 0.06), Vector2(-0.16, 0.06)]), Vector2(-0.125, 0.03), rail, true)
	var walk := 0.0
	for i in P.size() - 1:
		var a: Vector3 = P[i]
		var b: Vector3 = P[i + 1]
		var len := Vector2(b.x - a.x, b.z - a.z).length()
		var d := Vector2(b.x - a.x, b.z - a.z) / maxf(len, 1e-4)
		var t := 3.0 - fmod(walk, 3.0)
		while t < len:
			var f := t / len
			var p := a.lerp(b, f) - (O[i] as Vector3) * 0.125 + Vector3.UP * lerpf(H[i], H[i + 1], f)
			K.post(near, p, Vector3(0.05, 0.22, 0.05), d, rail)
			t += 3.0
		walk += len


## Steel style (a foot bridge of the road graph, FOB-*): posts, top and mid rails, mesh panels.
static func _steel_rail(base: KitMesh, near: KitMesh, P: Array, O: Array, H: PackedFloat32Array) -> void:
	for h: float in [1.15, 0.6]:
		var frames := []
		for i in P.size():
			frames.append([(P[i] as Vector3) + Vector3.UP * h, O[i], Vector3.UP])
		K.sweep(base, frames, PackedVector2Array([Vector2(-0.1, 0), Vector2(-0.04, 0), Vector2(-0.04, 0.06), Vector2(-0.1, 0.06)]), Vector2(-0.07, 0.03), STEEL_BLUE, true)
	for i in P.size() - 1:
		var a: Vector3 = (P[i] as Vector3) - (O[i] as Vector3) * 0.07 + Vector3.UP * 0.1
		var b: Vector3 = (P[i + 1] as Vector3) - (O[i + 1] as Vector3) * 0.07 + Vector3.UP * 0.1
		K.oquad(near, a, b, b + Vector3.UP * 1.0, a + Vector3.UP * 1.0, O[i], MESH)
		K.oquad(near, a, b, b + Vector3.UP * 1.0, a + Vector3.UP * 1.0, -(O[i] as Vector3), MESH)
	var walk := 0.0
	for i in P.size() - 1:
		var a: Vector3 = P[i]
		var b: Vector3 = P[i + 1]
		var len := Vector2(b.x - a.x, b.z - a.z).length()
		var d := Vector2(b.x - a.x, b.z - a.z) / maxf(len, 1e-4)
		var t := 1.5 - fmod(walk, 1.5)
		while t < len:
			K.post(near, a.lerp(b, t / len) - (O[i] as Vector3) * 0.07, Vector3(0.06, 1.2, 0.06), d, STEEL_BLUE)
			t += 1.5
		walk += len


## Lamp poles on the barrier every LAMP_EVERY_M, the arm and head over the carriageway.
static func _lamps(base: KitMesh, P: Array, O: Array, H: PackedFloat32Array) -> void:
	var walk := 0.0
	var next := LAMP_EVERY_M * 0.4
	for i in P.size() - 1:
		var a: Vector3 = P[i]
		var b: Vector3 = P[i + 1]
		var len := Vector2(b.x - a.x, b.z - a.z).length()
		while next < walk + len:
			var f := (next - walk) / maxf(len, 1e-4)
			var h := lerpf(H[i], H[i + 1], f)
			if h > 0.6:
				var o: Vector3 = O[i]
				var foot := a.lerp(b, f) - o * 0.12 + Vector3.UP * h
				base.cyl(foot, 0.1, 9.5, 6, GALV, 0.6)
				var top := foot + Vector3.UP * 9.5
				var tip := top - o * 2.2 + Vector3.UP * 0.35
				K.beam_box(base, top - Vector3.UP * 0.06, tip - Vector3.UP * 0.06, 0.08, 0.08, GALV)
				base.box(tip + Vector3(0, -0.05, 0) - o * 0.3, Vector3(0.3, 0.16, 0.3), LAMP, atan2(o.x, o.z))
			next += LAMP_EVERY_M
		walk += len


## A ramp's retaining wall: the coping, panel joints every 2 m and the black and white kerb paint at its foot.
static func _retaining_dressing(base: KitMesh, near: KitMesh, P: Array, O: Array, faces: Array, F: PackedFloat32Array) -> void:
	var frames := []
	for i in P.size():
		var top := float((faces[i] as Array)[1])
		frames.append([Vector3((P[i] as Vector3).x, top - 0.18, (P[i] as Vector3).z), O[i], Vector3.UP])
	K.sweep(base, frames, PackedVector2Array([Vector2(0, 0), Vector2(0.06, 0), Vector2(0.06, 0.18), Vector2(-0.02, 0.18)]), Vector2(-0.3, 0.09), CONC_NEW)
	var walk := 0.0
	for i in P.size() - 1:
		var a: Vector3 = P[i]
		var b: Vector3 = P[i + 1]
		var oa: Vector3 = O[i]
		var len := Vector2(b.x - a.x, b.z - a.z).length()
		var t := 2.0 - fmod(walk, 2.0)
		while t < len:
			var f := t / len
			var p := a.lerp(b, f) + oa * 0.008
			var top := lerpf(float((faces[i] as Array)[1]), float((faces[i + 1] as Array)[1]), f) - 0.2
			var g := lerpf(F[i], F[i + 1], f) + 0.6
			if top - g > 0.2:
				var d := Vector3(b.x - a.x, 0, b.z - a.z) / len * 0.02
				K.oquad(near, Vector3(p.x, g, p.z) - d, Vector3(p.x, g, p.z) + d, Vector3(p.x, top, p.z) + d, Vector3(p.x, top, p.z) - d, oa, CONC_SOOT)
			t += 2.0
		# the kerb paint: 1 m blocks, 0.45 m high, at the ground
		var t0 := 0.0
		while t0 < len - 1e-3:
			var t1 := minf(len, t0 + 1.0 - fmod(walk + t0, 1.0))
			var c := WHITE if int(floor((walk + t0 + 1e-3) / 1.0)) % 2 == 0 else BLACK
			var pa := a.lerp(b, t0 / len) + oa * 0.006
			var pb := a.lerp(b, t1 / len) + oa * 0.006
			var ga := lerpf(F[i], F[i + 1], t0 / len) + 0.6
			var gb := lerpf(F[i], F[i + 1], t1 / len) + 0.6
			K.oquad(near, Vector3(pa.x, ga - 0.05, pa.z), Vector3(pb.x, gb - 0.05, pb.z), Vector3(pb.x, gb + 0.45, pb.z), Vector3(pa.x, ga + 0.45, pa.z), oa, c)
			t0 = t1
		walk += len


## A deck's underside between its left and right edges (6 numbers a point): T beams under a slab, or a box girder.
static func soffit(base: KitMesh, near: KitMesh, s: Dictionary) -> void:
	var v := str(s.v)
	var st := style(v)
	var pts := K.points(s.p, 6)
	if pts.size() < 2:
		return
	var frames := []
	var width := 0.0
	for q: Array in pts:
		var l := Vector3(float(q[0]), float(q[1]), float(q[2]))
		var r := Vector3(float(q[3]), float(q[4]), float(q[5]))
		frames.append([l, r - l, Vector3.UP])
		width = maxf(width, Vector2(r.x - l.x, r.z - l.z).length())
	if width < 0.5:
		return
	if st == "box":
		var prof := PackedVector2Array([Vector2(0.0, 0.7), Vector2(0.2, 0.55), Vector2(0.27, 0.0), Vector2(0.73, 0.0), Vector2(0.8, 0.55), Vector2(1.0, 0.7)])
		K.sweep(base, frames, prof, Vector2(0.5, 2.0), CONC_NEW.darkened(0.08))
		return
	var slab := 0.85
	var col := CONC_UNDER if st != "steel" else STEEL_BLUE.darkened(0.25)
	K.sweep(base, frames, PackedVector2Array([Vector2(0.0, slab), Vector2(1.0, slab)]), Vector2(0.5, slab + 1.0), col)
	var beams := clampi(int(round(width / 2.4)) + 1, 2, 9) if st != "steel" else 2
	var hw := 0.25 / width
	for k in beams:
		var f := lerpf(0.03 + hw, 0.97 - hw, float(k) / float(beams - 1))
		K.sweep(base, frames, PackedVector2Array([Vector2(f - hw, slab), Vector2(f - hw, 0.0), Vector2(f + hw, 0.0), Vector2(f + hw, slab)]), Vector2(f, slab + 1.0), col)


## A pier: twin columns under a stepped cap (T style), one column under a hammerhead (box), a round column (loops),
## a wall with cutwaters (river), or a portal leg. The column at the ground matches the bake's collider.
static func pier(base: KitMesh, near: KitMesh, p: Dictionary) -> void:
	var v := str(p.v)
	var c := Vector2(float(p.x), float(p.z))
	var d := Vector2(float(p.dx), float(p.dz)).normalized()
	var nn := Vector2(-d.y, d.x)
	var y0 := float(p.y0)
	var y1 := float(p.y1)
	var w := float(p.w)
	var deck := maxf(float(p.d), w)
	var shape := str(p.s)
	var ground := y0 + 1.0
	match shape:
		"portal":
			var ring := PackedVector2Array()
			var flat: Array = p.get("ring", [])
			for k in flat.size() / 2:
				ring.append(Vector2(float(flat[k * 2]), float(flat[k * 2 + 1])))
			if ring.size() >= 3:
				K.prism(base, ring, y0, y1, CONC)
				_bands(near, ring, ground, 3)
		"twin":
			var off := w * 0.5 - 0.6
			for sgn: float in [-1.0, 1.0]:
				var cc := c + nn * off * sgn
				var ring := K.rect(cc, d, 0.5, 0.6)
				K.prism(base, ring, y0, y1 - 1.4, CONC)
				_bands(near, ring, ground, 3)
			# the stepped cap: a narrower step over the columns, the full cap under the beams, bearings on it
			K.prism(base, K.rect(c, d, 0.75, off + 0.75), y1 - 1.4, y1 - 0.85, CONC)
			K.prism(base, K.rect(c, d, 0.9, deck * 0.5 - 0.25), y1 - 0.85, y1 - 0.25, CONC)
			_bearings(near, c, d, nn, deck, y1)
			near.rod(_v3(c + nn * (off + 0.65), y1 - 1.4), _v3(c + nn * (off + 0.65), ground), 0.07, 6, BLACK.lightened(0.15))
		"single":
			var half := minf(w * 0.5, 1.1)
			K.prism(base, K.rect(c, d, 0.5, half), y0, y1 - 1.8, CONC_NEW)
			_frustum(base, c, d, 0.8, half, deck * 0.5 - 0.6, y1 - 1.8, y1 - 0.25, CONC_NEW)
			_bearings(near, c, d, nn, deck * 0.7, y1)
			_bands(near, K.rect(c, d, 0.5, half), ground, 2)
		"round":
			base.cyl(_v3(c, y0), 0.5, y1 - 0.8 - y0, 12, CONC)
			_frustum(base, c, d, 0.6, 0.5, minf(deck * 0.5 - 0.3, 2.6), y1 - 0.8, y1 - 0.25, CONC)
			_bearings(near, c, d, nn, minf(deck, 5.0), y1)
		_:
			# a wall pier with rounded cutwaters (river and small bridges)
			var half := maxf(0.6, w * 0.5)
			var ring := PackedVector2Array()
			var straight := maxf(0.0, half - 0.5)
			for k in 7:
				var a := -PI * 0.5 + PI * k / 6.0
				ring.append(c + nn * (straight + cos(a) * 0.5) + d * sin(a) * 0.5)
			for k in 7:
				var a := PI * 0.5 + PI * k / 6.0
				ring.append(c + nn * (-straight + cos(a) * 0.5) + d * sin(a) * 0.5)
			var flood := minf(y1 - 0.4, ground + 2.4)
			K.prism(base, ring, y0, flood, CONC_SOOT)
			K.prism(base, ring, flood, y1 - 0.3, CONC)
			K.prism(base, K.rect(c, d, 0.7, half + 0.15), y1 - 0.3, y1 - 0.05, CONC_NEW)


## Black and white bands round a column at the ground (flyovers.md "Pier base"), a hair outside it.
static func _bands(near: KitMesh, ring: PackedVector2Array, ground: float, count: int) -> void:
	var c := Vector2.ZERO
	for q in ring:
		c += q / ring.size()
	var grown := PackedVector2Array()
	for q in ring:
		grown.append(c + (q - c) * 1.02 + (q - c).normalized() * 0.01)
	for k in count:
		var y := ground + 0.0 + k * 0.5
		var col := BLACK if k % 2 == 0 else WHITE
		var n := grown.size()
		for i in n:
			var a := grown[i]
			var b := grown[(i + 1) % n]
			var mid := (a + b) * 0.5 - c
			K.oquad(near, Vector3(a.x, y, a.y), Vector3(b.x, y, b.y), Vector3(b.x, y + 0.5, b.y), Vector3(a.x, y + 0.5, a.y), Vector3(mid.x, 0, mid.y), col)


## Bearing pads on a cap: one under each beam line across the deck width.
static func _bearings(near: KitMesh, c: Vector2, d: Vector2, nn: Vector2, deck: float, y1: float) -> void:
	var n := clampi(int(round(deck / 2.4)) + 1, 2, 9)
	for k in n:
		var f := lerpf(-0.42, 0.42, float(k) / float(n - 1))
		K.post(near, _v3(c + nn * deck * f, y1 - 0.25), Vector3(0.5, 0.25, 0.4), d, Color("#4a4846"))


## A cap that widens upward: across half width wb at yb to wt at yt, half length `along` on the deck direction d.
static func _frustum(m: KitMesh, c: Vector2, d: Vector2, along: float, wb: float, wt: float, yb: float, yt: float, col: Color) -> void:
	var nn := Vector2(-d.y, d.x)
	var b := [c + d * along + nn * wb, c - d * along + nn * wb, c - d * along - nn * wb, c + d * along - nn * wb]
	var t := [c + d * along + nn * wt, c - d * along + nn * wt, c - d * along - nn * wt, c + d * along - nn * wt]
	for k in 4:
		var a0: Vector2 = b[k]
		var a1: Vector2 = b[(k + 1) % 4]
		var u0: Vector2 = t[k]
		var u1: Vector2 = t[(k + 1) % 4]
		var mid := (a0 + a1 + u0 + u1) * 0.25 - c
		K.oquad(m, _v3(a0, yb), _v3(a1, yb), _v3(u1, yt), _v3(u0, yt), Vector3(mid.x, 0, mid.y), col)
	K.oquad(m, _v3(t[0], yt), _v3(t[1], yt), _v3(t[2], yt), _v3(t[3], yt), Vector3.UP, col)
	K.oquad(m, _v3(b[0], yb), _v3(b[1], yb), _v3(b[2], yb), _v3(b[3], yb), Vector3.DOWN, col)


## A portal's cross beam (its plan corners, bottom and top).
static func beam(base: KitMesh, b: Dictionary) -> void:
	var flat: Array = b.r
	var ring := PackedVector2Array()
	for k in flat.size() / 2:
		ring.append(Vector2(float(flat[k * 2]), float(flat[k * 2 + 1])))
	K.prism(base, ring, float(b.y0), float(b.y1) - 0.2, CONC)
	base.cap(ring, float(b.y0), CONC_UNDER, false)


## The end wall where a ramp on fill meets a deck: concrete both ways, a yellow and black hazard band at the ground.
static func end_wall(base: KitMesh, f: Dictionary) -> void:
	var q: Array = f.p
	var a := Vector3(float(q[0]), float(q[1]), float(q[2]))
	var b := Vector3(float(q[3]), float(q[4]), float(q[5]))
	var c := Vector3(float(q[6]), float(q[7]), float(q[8]))
	var e := Vector3(float(q[9]), float(q[10]), float(q[11]))
	var nrm := (b - a).cross(e - a).normalized()
	K.oquad(base, a, b, c, e, nrm, CONC)
	K.oquad(base, a, b, c, e, -nrm, CONC)
	var g := e.y + 0.6
	var len := Vector2(b.x - a.x, b.z - a.z).length()
	var steps := int(len / 0.6)
	for k in steps:
		var p0 := e.lerp(c, float(k) / steps)
		var p1 := e.lerp(c, float(k + 1) / steps)
		var col := YELLOW if k % 2 == 0 else BLACK
		for s: float in [1.0, -1.0]:
			var off := nrm * 0.01 * s
			K.oquad(base, Vector3(p0.x, g, p0.z) + off, Vector3(p1.x, g, p1.z) + off, Vector3(p1.x, g + 0.9, p1.z) + off, Vector3(p0.x, g + 0.9, p0.z) + off, nrm * s, col)


static func _v3(p: Vector2, y: float) -> Vector3:
	return Vector3(p.x, y, p.y)
