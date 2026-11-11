## A simple driver for bench vehicles: holds a speed with the throttle and steers at a point ahead on a path.
## Used for the junction turn and the traffic loop of the physics bench (P0-017).
extends RefCounted


## Throttle (0..1) and brake (0..1) that hold a speed in km/h.
static func hold_speed(v: Node, target_kmh: float) -> Vector2:
	var e: float = target_kmh - v.kmh()
	if e < -6.0:
		return Vector2(0.0, clampf(-e * 0.05, 0.0, 1.0))
	return Vector2(clampf(e * 0.25, 0.0, 1.0), 0.0)


## Steer input (-1 left .. 1 right) that turns the vehicle towards a world point.
static func steer_to(v: Node, target: Vector3, gain: float = 2.5) -> float:
	var f: Vector3 = v.fwd()
	var to: Vector3 = target - (v as Node3D).global_position
	to.y = 0.0
	f.y = 0.0
	if to.length_squared() < 0.0001 or f.length_squared() < 0.0001:
		return 0.0
	return clampf(-f.normalized().cross(to.normalized()).y * gain, -1.0, 1.0)


## Points every `step` metres: a straight north from a to the start of a left turn of radius r, the quarter turn,
## then a straight west of length `out`. All on y = 0, course coordinates.
static func left_turn_path(start: Vector3, straight: float, r: float, out: float, step: float = 0.5) -> PackedVector3Array:
	var pts := PackedVector3Array()
	var n := int(straight / step)
	for i in n:
		pts.append(start + Vector3(0, 0, -step * i))
	var arc_start := start + Vector3(0, 0, -straight)
	var c := arc_start + Vector3(-r, 0, 0)
	var arc_n := int(PI * 0.5 * r / step)
	for i in arc_n:
		var a := PI * 0.5 * float(i) / arc_n
		pts.append(c + Vector3(r * cos(a), 0, -r * sin(a)))
	var arc_end := c + Vector3(0, 0, -r)
	for i in int(out / step) + 1:
		pts.append(arc_end + Vector3(-step * i, 0, 0))
	return pts


## A closed oval loop (two straights of `straight` metres joined by half circles of radius r) around a centre,
## counter-clockwise seen from above, sampled every `step` metres.
static func oval(centre: Vector3, straight: float, r: float, step: float = 1.0) -> PackedVector3Array:
	var pts := PackedVector3Array()
	var h := straight * 0.5
	var n := int(straight / step)
	for i in n:
		pts.append(centre + Vector3(r, 0, h - step * i))
	var arc_n := int(PI * r / step)
	for i in arc_n:
		var a := PI * float(i) / arc_n
		pts.append(centre + Vector3(r * cos(a), 0, -h - r * sin(a)))
	for i in n:
		pts.append(centre + Vector3(-r, 0, -h + step * i))
	for i in arc_n:
		var a := PI + PI * float(i) / arc_n
		pts.append(centre + Vector3(r * cos(a), 0, h - r * sin(a)))
	return pts
