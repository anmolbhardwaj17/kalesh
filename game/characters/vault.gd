## Vaulting (GAME.md "Player verbs": jump, and vault a low wall up to 1.2 m when facing one): finds a wall or a railing
## just ahead of the feet, measures its top and depth with rays and picks a landing past it (or on top of a deep ledge),
## then gives the body's path over it in VAULT_S. Used by on_foot.gd on a jump press; the path is checked clear before
## it starts, so the body moves along it without collision.
extends RefCounted

const VAULT_S := 0.6
## Tops from MIN_TOP to MAX_TOP over the feet (lower ones are steps, higher ones are a jump into the wall).
const MIN_TOP := 0.3
const MAX_TOP := 1.2
const TOP_SLACK := 0.03
## How far the wall face may be from the body's surface, and how much the facing may differ from the wall's normal.
const REACH := 0.6
const FACING_COS := 0.75
## Deeper than this is a ledge: the vault lands on top.
const MAX_DEPTH := 0.9
## Gap kept over the top and past the far face.
const CLEAR_TOP := 0.08
const CLEAR_SIDE := 0.05


## The vault ahead of a body at `feet` facing `fwd` (unit, flat), or {} when there is none. `radius` and `height` are
## the capsule's. Mask: what the body collides with. Answers {face, top, landing, ledge}.
static func find(space: PhysicsDirectSpaceState3D, feet: Vector3, fwd: Vector3, radius: float, height: float, mask: int, exclude: Array[RID]) -> Dictionary:
	var ray := PhysicsRayQueryParameters3D.new()
	ray.collision_mask = mask
	ray.exclude = exclude
	# 1. a face ahead at knee, waist or chest height
	var face_d := INF
	var normal := Vector3.ZERO
	for h in [0.4, 0.75, 1.1]:
		ray.from = feet + Vector3.UP * float(h)
		ray.to = ray.from + fwd * (radius + REACH)
		var hit := space.intersect_ray(ray)
		if hit.is_empty():
			continue
		var n: Vector3 = hit.normal
		if absf(n.y) > 0.4:
			continue
		var d := (Vector3(hit.position) - ray.from).dot(fwd)
		if d < face_d:
			face_d = d
			normal = n
	if face_d == INF or -normal.dot(fwd) < FACING_COS:
		return {}
	# 2. its top, just past the face
	var over := feet + fwd * (face_d + 0.04)
	ray.from = Vector3(over.x, feet.y + MAX_TOP + 1.0, over.z)
	ray.to = Vector3(over.x, feet.y + 0.05, over.z)
	var top_hit := space.intersect_ray(ray)
	if top_hit.is_empty():
		return {}
	var top: float = float(top_hit.position.y) - feet.y
	if top < MIN_TOP or top > MAX_TOP + TOP_SLACK:
		return {}
	# 3. its depth: march down rays until the top falls away
	var depth := -1.0
	var k := 0.1
	while k <= MAX_DEPTH + 0.001:
		var p := feet + fwd * (face_d + k)
		ray.from = Vector3(p.x, feet.y + top + 0.3, p.z)
		ray.to = Vector3(p.x, feet.y + top - 0.25, p.z)
		if space.intersect_ray(ray).is_empty():
			depth = k
			break
		k += 0.05
	var ledge := depth < 0.0
	var top_y := feet.y + top
	var landing: Vector3
	if ledge:
		landing = feet + fwd * (face_d + radius + 0.15)
		landing.y = top_y
	else:
		landing = feet + fwd * (face_d + depth + radius + 0.2)
		ray.from = Vector3(landing.x, top_y + 0.2, landing.z)
		ray.to = Vector3(landing.x, top_y - 3.0, landing.z)
		var g := space.intersect_ray(ray)
		if g.is_empty() or float((g.normal as Vector3).y) < 0.7:
			return {}
		landing.y = float(g.position.y)
	# 4. the capsule fits at the peak over the top and at the landing
	var shape := CapsuleShape3D.new()
	shape.radius = radius
	shape.height = height
	var q := PhysicsShapeQueryParameters3D.new()
	q.shape = shape
	q.collision_mask = mask
	q.exclude = exclude
	q.margin = 0.01
	var mid := feet + fwd * (face_d + maxf(0.05, depth * 0.5 if not ledge else 0.2))
	for base in [Vector3(mid.x, top_y + CLEAR_TOP, mid.z), landing + Vector3.UP * 0.03]:
		q.transform = Transform3D(Basis.IDENTITY, Vector3(base) + Vector3.UP * (height * 0.5))
		if not space.intersect_shape(q, 1).is_empty():
			return {}
	return {"face": face_d, "top": top, "landing": landing, "ledge": ledge, "depth": depth, "from": feet}


## Where the feet are at share u (0..1) of a vault from `from` (feet at the start) over a face `face` m ahead with its
## top `top` over the start, landing at `landing`. Up first, then across at the peak, then down onto the landing; the
## round foot stays over the top while it is over the wall. Up eases in and out, the drop speeds up like a fall.
static func path(v: Dictionary, fwd: Vector3, radius: float, u: float) -> Vector3:
	var from: Vector3 = v.from
	var landing: Vector3 = v.landing
	var face: float = v.face
	var peak: float = from.y + float(v.top) + CLEAR_TOP
	var total := (landing - from).dot(fwd)
	var near := maxf(0.0, face - radius - CLEAR_SIDE)
	var far_d: float = face + (float(v.depth) if not v.ledge else 0.0) + radius + CLEAR_SIDE
	far_d = minf(far_d, total)
	var d := 0.0
	var y := from.y
	if u < 0.3:
		var e := u / 0.3
		d = near * e
		y = lerpf(from.y, peak, smoothstep(0.0, 1.0, e))
	elif u < 0.6:
		var e := (u - 0.3) / 0.3
		d = lerpf(near, far_d, e)
		y = peak
	else:
		var e := (u - 0.6) / 0.4
		d = lerpf(far_d, total, e)
		y = lerpf(peak, landing.y, e * e)
	var flat := from + fwd * d
	return Vector3(flat.x, y, flat.z)
