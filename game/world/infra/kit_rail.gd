## The railway kit (P2-034, rail.md RAIL-BG, bridges.md RBR-U1 and RBR-Y1): broad gauge track (ballast bed with
## its slopes, concrete sleepers every 0.65 m, two rails 1,676 mm apart), level crossings flush with the road, the
## overhead line (galvanised masts with cantilever arms, the catenary and contact wire at 5.6 m), steel girder
## underbridges and the Loha Pul truss, masonry abutments and piers. Kit inputs are world metres. Pure.
extends RefCounted

const KitMesh := preload("res://world/landmarks/kit_mesh.gd")
const K := preload("res://world/infra/infra_kit.gd")

const BALLAST := Color("#7a7268")
const SLEEPER := Color("#a8a49c")
const RUST := Color("#6b4a36")
const RAIL_TOP := Color("#b9b5ad")
const GALV := Color("#8e9296")
const GIRDER := Color("#2b2a2a")
const TRUSS := Color("#7a4a2e")
const BRICK := Color("#8f5e45")
const STONE := Color("#a39a8a")
const WIRE := Color("#3b3a38")
const INSULATOR := Color("#e7e3da")

## Half the gauge (1,676 mm) plus half a rail head: the rail centre lines.
const RAIL_X := 0.8755
const SLEEPER_EVERY_M := 0.65
const F_CROSSING := 1
const F_BRIDGE := 2


## One stretch of track: [x, y (sleeper base), z, ground, flag] per point.
static func track(base: KitMesh, near: KitMesh, t: Dictionary) -> void:
	var v := str(t.v)
	var raw := K.points(t.p, 5)
	var n := raw.size()
	if n < 2:
		return
	var P := []
	var U := []
	var G := PackedFloat32Array()
	var Fl := PackedInt32Array()
	for k in n:
		var q: Array = raw[k]
		P.append(Vector3(float(q[0]), float(q[1]), float(q[2])))
		G.append(float(q[3]))
		Fl.append(int(q[4]))
	for k in n:
		var a: Vector3 = P[maxi(0, k - 1)]
		var b: Vector3 = P[mini(n - 1, k + 1)]
		var d := Vector2(b.x - a.x, b.z - a.z).normalized()
		U.append(Vector3(-d.y, 0, d.x))
	var bridge := int(t.get("b", 0)) == 1
	# the ballast bed: a flat top 3.4 m wide and 1:1 slopes down to the ground (not across a road, not on a bridge)
	base.use("main", "road")
	for i in n - 1:
		if Fl[i] != 0 or Fl[i + 1] != 0:
			continue
		var pa: Vector3 = P[i]
		var pb: Vector3 = P[i + 1]
		var ua: Vector3 = U[i]
		var ub: Vector3 = U[i + 1]
		K.oquad(base, pa - ua * 1.7, pb - ub * 1.7, pb + ub * 1.7, pa + ua * 1.7, Vector3.UP, BALLAST)
		for s: float in [-1.0, 1.0]:
			var da := maxf(0.3, pa.y - G[i] + 0.05)
			var db := maxf(0.3, pb.y - G[i + 1] + 0.05)
			var oa := Vector3(pa.x, pa.y - da, pa.z) + ua * s * (1.7 + da)
			var ob := Vector3(pb.x, pb.y - db, pb.z) + ub * s * (1.7 + db)
			K.oquad(base, pa + ua * s * 1.7, pb + ub * s * 1.7, ob, oa, ua * s + Vector3.UP * 0.6, BALLAST.darkened(0.06))
	base.use("main", "matte")
	# the rails: on a level crossing their tops lie in the road surface
	var Y := PackedFloat32Array()
	for k in n:
		Y.append(G[k] - 0.32 if Fl[k] == F_CROSSING else (P[k] as Vector3).y)
	base.use("main", "metal")
	for s: float in [-1.0, 1.0]:
		var frames := []
		for k in n:
			var p: Vector3 = P[k]
			frames.append([Vector3(p.x, Y[k], p.z) + (U[k] as Vector3) * RAIL_X * s, U[k], Vector3.UP])
		K.sweep(base, frames, PackedVector2Array([Vector2(-0.036, 0.17), Vector2(-0.036, 0.33), Vector2(0.036, 0.33), Vector2(0.036, 0.17)]), Vector2(0.0, 0.25), RUST)
		var tops := []
		for k in n:
			var p: Vector3 = P[k]
			tops.append([Vector3(p.x, Y[k] + 0.332, p.z) + (U[k] as Vector3) * RAIL_X * s, U[k], Vector3.UP])
		K.sweep(near, tops, PackedVector2Array([Vector2(-0.03, 0.0), Vector2(0.03, 0.0)]), Vector2(0.0, -1.0), RAIL_TOP)
	base.use("main", "matte")
	# sleepers (not across a road)
	var walk := 0.0
	for i in n - 1:
		var pa: Vector3 = P[i]
		var pb: Vector3 = P[i + 1]
		var len := Vector2(pb.x - pa.x, pb.z - pa.z).length()
		if len < 1e-3:
			continue
		var d := Vector2(pb.x - pa.x, pb.z - pa.z) / len
		if Fl[i] != F_CROSSING and Fl[i + 1] != F_CROSSING:
			var t0 := SLEEPER_EVERY_M - fmod(walk, SLEEPER_EVERY_M)
			while t0 < len:
				var p := pa.lerp(pb, t0 / len)
				K.post(near, p - Vector3.UP * 0.02, Vector3(2.75, 0.19, 0.25), d, SLEEPER)
				t0 += SLEEPER_EVERY_M
		walk += len
	# the overhead line: catenary and contact wire over the track (not on a disused line)
	if v != "RAIL-DIS" and v != "MET-RAMP":
		for h: float in [5.93, 7.1]:
			var frames := []
			for k in n:
				var p: Vector3 = P[k]
				frames.append([Vector3(p.x, Y[k] + h, p.z), U[k], Vector3.UP])
			K.sweep(near, frames, PackedVector2Array([Vector2(-0.015, 0), Vector2(0.015, 0), Vector2(0.015, 0.03), Vector2(-0.015, 0.03)]), Vector2(0, 0.015), WIRE, true)
	if bridge:
		_bridge(base, near, v, P, U, G)


## A rail bridge under the track: steel plate girders on masonry abutments (RBR-U1), or the Loha Pul's through truss.
static func _bridge(base: KitMesh, near: KitMesh, v: String, P: Array, U: Array, G: PackedFloat32Array) -> void:
	var n := P.size()
	var frames := []
	for k in n:
		frames.append([P[k], U[k], Vector3.UP])
	base.use("main", "metal")
	# the deck plate and two main girders under the rails
	K.sweep(base, frames, PackedVector2Array([Vector2(-2.6, 0), Vector2(2.6, 0), Vector2(2.6, -0.12), Vector2(-2.6, -0.12)]), Vector2(0, -0.06), GIRDER, true)
	for s: float in [-1.0, 1.0]:
		K.sweep(base, frames, PackedVector2Array([Vector2(1.0 * s - 0.2, -0.12), Vector2(1.0 * s - 0.2, -1.15), Vector2(1.0 * s + 0.2, -1.15), Vector2(1.0 * s + 0.2, -0.12)]), Vector2(1.0 * s, -0.6), GIRDER)
		# the walkway rail on each side
		var rails := []
		for k in n:
			rails.append([(P[k] as Vector3) + Vector3.UP * 1.05 + (U[k] as Vector3) * 2.5 * s, U[k], Vector3.UP])
		K.sweep(base, rails, PackedVector2Array([Vector2(-0.03, 0), Vector2(0.03, 0), Vector2(0.03, 0.05), Vector2(-0.03, 0.05)]), Vector2(0, 0.025), GALV, true)
	var walk := 0.0
	for i in n - 1:
		var pa: Vector3 = P[i]
		var pb: Vector3 = P[i + 1]
		var len := Vector2(pb.x - pa.x, pb.z - pa.z).length()
		if len < 1e-3:
			continue
		var d := Vector2(pb.x - pa.x, pb.z - pa.z) / len
		var t0 := 1.5 - fmod(walk, 1.5)
		while t0 < len:
			var p := pa.lerp(pb, t0 / len)
			for s: float in [-1.0, 1.0]:
				K.post(near, p + (U[i] as Vector3) * 2.5 * s, Vector3(0.05, 1.05, 0.05), d, GALV)
				K.post(near, p + (U[i] as Vector3) * 1.0 * s - Vector3.UP * 1.15, Vector3(0.44, 1.0, 0.03), d, GIRDER.lightened(0.08))
			t0 += 1.5
		walk += len
	if v == "RBR-Y1":
		_truss(base, P, U)
	base.use("main", "matte")
	# masonry abutments at both ends (the bake's collider quads), brick with a stone coping
	for e: int in [0, n - 1]:
		var p: Vector3 = P[e]
		var o: Vector3 = P[1 if e == 0 else n - 2]
		var u: Vector3 = U[e]
		var out := Vector3(p.x - o.x, 0, p.z - o.z).normalized()
		var g := G[e]
		K.oquad(base, p + u * 3.2 - Vector3.UP * 0.12, p - u * 3.2 - Vector3.UP * 0.12, Vector3(p.x, g - 0.5, p.z) - u * 3.2, Vector3(p.x, g - 0.5, p.z) + u * 3.2, -out, BRICK)
		K.oquad(base, p + u * 3.2 - Vector3.UP * 0.12, p - u * 3.2 - Vector3.UP * 0.12, Vector3(p.x, g - 0.5, p.z) - u * 3.2, Vector3(p.x, g - 0.5, p.z) + u * 3.2, out, BRICK)
		K.beam_box(base, p - u * 3.4 - out * 0.3 - Vector3.UP * 0.3, p + u * 3.4 - out * 0.3 - Vector3.UP * 0.3, 0.9, 0.18, STONE)


## The Loha Pul (bridges.md RBR-Y1): two riveted trusses 8.5 m deep, posts and X bracing every 6 m, bracing on top.
static func _truss(base: KitMesh, P: Array, U: Array) -> void:
	var n := P.size()
	for s: float in [-1.0, 1.0]:
		for h: float in [-0.5, 8.0]:
			var frames := []
			for k in n:
				frames.append([(P[k] as Vector3) + Vector3.UP * h + (U[k] as Vector3) * 3.3 * s, U[k], Vector3.UP])
			K.sweep(base, frames, PackedVector2Array([Vector2(-0.25, 0), Vector2(0.25, 0), Vector2(0.25, 0.6), Vector2(-0.25, 0.6)]), Vector2(0, 0.3), TRUSS, true)
	var walk := 0.0
	var marks := []
	for i in n - 1:
		var pa: Vector3 = P[i]
		var pb: Vector3 = P[i + 1]
		var len := Vector2(pb.x - pa.x, pb.z - pa.z).length()
		var t0 := 6.0 - fmod(walk, 6.0)
		while t0 < len:
			marks.append([pa.lerp(pb, t0 / len), U[i]])
			t0 += 6.0
		walk += len
	for k in marks.size():
		var p: Vector3 = marks[k][0]
		var u: Vector3 = marks[k][1]
		for s: float in [-1.0, 1.0]:
			var foot := p + u * 3.3 * s + Vector3.UP * 0.1
			base.rod(foot, foot + Vector3.UP * 7.9, 0.16, 4, TRUSS)
			if k + 1 < marks.size():
				var q: Vector3 = marks[k + 1][0]
				var qf := q + u * 3.3 * s + Vector3.UP * 0.1
				base.rod(foot, qf + Vector3.UP * 7.9, 0.1, 4, TRUSS)
				base.rod(foot + Vector3.UP * 7.9, qf, 0.1, 4, TRUSS)
		base.rod(p - u * 3.3 + Vector3.UP * 8.3, p + u * 3.3 + Vector3.UP * 8.3, 0.14, 4, TRUSS)


## An overhead line mast: a galvanised column on a concrete block, the cantilever over the track, insulators.
static func mast(base: KitMesh, near: KitMesh, m: Dictionary) -> void:
	var p := Vector3(float(m.x), float(m.y), float(m.z))
	var d := Vector2(float(m.dx), float(m.dz))
	var side := Vector3(d.y, 0, -d.x)
	var reach := float(m.reach)
	var wire := float(m.wire)
	var track := p - side * reach
	base.use("main", "matte")
	K.post(base, p - Vector3.UP * 0.3, Vector3(0.7, 0.6, 0.7), d, Color("#9b978f"))
	base.use("main", "metal")
	K.post(base, p + Vector3.UP * 0.3, Vector3(0.32, wire + 1.9 - p.y - 0.3, 0.26), d, GALV)
	var arm_y := wire + 1.3
	var tip := Vector3(track.x, arm_y, track.z) - side * signf(reach) * 0.6
	K.beam_box(base, Vector3(p.x, arm_y - 0.04, p.z), tip - Vector3.UP * 0.04, 0.07, 0.08, GALV)
	near.use("main", "metal")
	near.rod(Vector3(p.x, wire + 0.2, p.z), Vector3(track.x, wire + 0.05, track.z), 0.035, 4, GALV)
	near.use("main", "satin")
	near.rod(Vector3(p.x, arm_y, p.z) - side * signf(reach) * 0.25, Vector3(p.x, arm_y, p.z) - side * signf(reach) * 0.7, 0.07, 6, INSULATOR)
	near.use("main", "matte")
	base.use("main", "matte")


## A pier under a rail bridge: a brick wall pier with a stone cap.
static func bridge_pier(base: KitMesh, p: Dictionary) -> void:
	var c := Vector2(float(p.x), float(p.z))
	var d := Vector2(float(p.dx), float(p.dz)).normalized()
	var half := maxf(1.0, float(p.w) * 0.5)
	K.prism(base, K.rect(c, d, 0.5, half), float(p.y0), float(p.y1) - 0.25, BRICK)
	K.prism(base, K.rect(c, d, 0.65, half + 0.15), float(p.y1) - 0.25, float(p.y1), STONE)


## A platform (rail.md RAIL-PLAT): a raised slab with a stone coping, a yellow safety line 1 m in from the edge and,
## on a long one, a blue sheet roof on steel columns along its middle.
static func platform(base: KitMesh, near: KitMesh, p: Dictionary) -> void:
	var flat: Array = p.r
	var ring := PackedVector2Array()
	for k in flat.size() / 2:
		ring.append(Vector2(float(flat[k * 2]), float(flat[k * 2 + 1])))
	if ring.size() < 3:
		return
	var top := float(p.h)
	var foot := float(p.g)
	K.prism(base, ring, foot, top - 0.006, Color("#9b978f"), Color("#8a7a68"))
	K.prism(base, _inset(ring, 0.35), top - 0.1, top, Color("#9a8d80"))
	var line := _inset(ring, 1.0)
	for i in line.size():
		var a := line[i]
		var b := line[(i + 1) % line.size()]
		if a.distance_to(b) < 12.0:
			continue
		var d := (b - a).normalized()
		var n := Vector2(-d.y, d.x) * 0.06
		K.oquad(near, Vector3(a.x + n.x, top + 0.006, a.y + n.y), Vector3(b.x + n.x, top + 0.006, b.y + n.y), Vector3(b.x - n.x, top + 0.006, b.y - n.y), Vector3(a.x - n.x, top + 0.006, a.y - n.y), Vector3.UP, Color("#f2c230"))
	if int(p.get("roof", 0)) != 1:
		return
	var ax: Array = p.a
	var a0 := Vector2(float(ax[0]), float(ax[1]))
	var a1 := Vector2(float(ax[2]), float(ax[3]))
	var len := a0.distance_to(a1)
	var steps := maxi(1, int(len / 7.5))
	base.use("main", "metal")
	for k in steps + 1:
		var c := a0.lerp(a1, float(k) / steps)
		base.cyl(Vector3(c.x, top, c.y), 0.14, 4.6, 6, Color("#5b5f62"))
	base.use("main", "matte")
	var roof := _inset(ring, -0.6)
	base.prism(roof, top + 4.6, top + 4.75, ROOF_BLUE_PLAT, ROOF_BLUE_PLAT.lightened(0.1), false)
	base.cap(roof, top + 4.6, ROOF_BLUE_PLAT.darkened(0.25), false)


const ROOF_BLUE_PLAT := Color("#4c5f70")


## A ring moved inward by d (outward when negative): each point along the bisector of its two edges.
static func _inset(ring: PackedVector2Array, d: float) -> PackedVector2Array:
	var n := ring.size()
	var area := 0.0
	for k in n:
		area += ring[k].x * ring[(k + 1) % n].y - ring[(k + 1) % n].x * ring[k].y
	var s := 1.0 if area > 0.0 else -1.0
	var out := PackedVector2Array()
	for k in n:
		var p := ring[k]
		var e0 := (p - ring[(k - 1 + n) % n]).normalized()
		var e1 := (ring[(k + 1) % n] - p).normalized()
		var n0 := Vector2(-e0.y, e0.x) * s
		var n1 := Vector2(-e1.y, e1.x) * s
		var bis := (n0 + n1)
		if bis.length() < 1e-4:
			bis = n0
		bis = bis.normalized()
		var cosh := maxf(0.35, bis.dot(n0))
		out.append(p + bis * d / cosh)
	return out
