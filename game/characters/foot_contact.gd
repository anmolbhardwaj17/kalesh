## Foot contact and foot slide maths of the humanoid (P1-023, contact by height since P2-041). Pure functions on
## sampled points, used by the probe (debug/foot_anim_probe.gd: the slide of the feet in the running game) and by the
## library build (tools/build_humanoid.gd, a legacy stride figure).
## The contact point of a foot is its ball (the Toes bone of the humanoid profile): from foot flat to toe off the ball
## is the pivot the body rolls over. A ball is on the ground while it is within LIFT of the lowest a ball gets in the
## samples; with both down the stance foot is the lower one, with neither down (the flight of a run) there is none.
## Before P2-041 the stance foot was simply the lower ball, which read the flight of a jog as stance: the library jog
## measured 3 percent slide while its feet crossed the ground at 4.9 m/s under a 3.8 m/s body.
extends RefCounted

const LIFT := 0.008


## The stance foot at each sample: 0 left, 1 right, -1 neither.
static func stance(left: PackedVector3Array, right: PackedVector3Array, lift := LIFT) -> PackedInt32Array:
	var out := PackedInt32Array()
	out.resize(left.size())
	var floor_y := 1e9
	for i in left.size():
		floor_y = minf(floor_y, minf(left[i].y, right[i].y))
	for i in left.size():
		var l := left[i].y <= floor_y + lift
		var r := right[i].y <= floor_y + lift
		if l and r:
			out[i] = 0 if left[i].y <= right[i].y else 1
		else:
			out[i] = 0 if l else (1 if r else -1)
	return out


## Mean backward speed (m/s) of the stance foot in a body frame whose forward is `fwd`, over the sample pairs where the
## same foot stays the stance foot. Samples are `dt` apart. In model space of an in-place clip this is the stride speed:
## the ground speed at which the planted foot would stay still.
static func stance_speed(left: PackedVector3Array, right: PackedVector3Array, dt: float, fwd: Vector3) -> float:
	var st := stance(left, right)
	var dist := 0.0
	var n := 0
	for i in left.size() - 1:
		if st[i] != st[i + 1] or st[i] < 0:
			continue
		var a: Vector3 = left[i] if st[i] == 0 else right[i]
		var b: Vector3 = left[i + 1] if st[i] == 0 else right[i + 1]
		dist += -(b - a).dot(fwd)
		n += 1
	if n == 0 or dt <= 0.0:
		return 0.0
	return dist / (n * dt)


## Foot slide over the samples: the stance foot's mean backward speed relative to the body against the ground speed,
## |foot - ground| / ground (`slide`), and how far the planted ball moves over the ground for each metre the body
## covers while it is down (`abs`: 0 for a foot that holds, 1 for a foot dragged along). `rel_left`/`rel_right` are the balls in the body frame (body
## position subtracted, turned so `fwd` is the body's forward). Also the mean world speed of the stance foot over the
## ground speed (`abs`, how much the planted foot wanders within a step, for the report).
static func slide(rel_left: PackedVector3Array, rel_right: PackedVector3Array, body: PackedVector3Array, dt: float,
		fwd: Vector3, ground_speed: float) -> Dictionary:
	var foot := stance_speed(rel_left, rel_right, dt, fwd)
	var st := stance(rel_left, rel_right)
	var wander := 0.0
	var n := 0
	for i in rel_left.size() - 1:
		if st[i] != st[i + 1] or st[i] < 0:
			continue
		var a: Vector3 = (rel_left[i] if st[i] == 0 else rel_right[i]) + body[i]
		var b: Vector3 = (rel_left[i + 1] if st[i] == 0 else rel_right[i + 1]) + body[i + 1]
		var d := b - a
		d.y = 0.0
		wander += d.length()
		n += 1
	var g := maxf(ground_speed, 1e-6)
	return {
		"footSpeed": foot,
		"groundSpeed": ground_speed,
		"slide": absf(foot - ground_speed) / g,
		"abs": (wander / (n * dt)) / g if n > 0 else 0.0,
		"pairs": n,
		"share": float(n) / maxf(1.0, rel_left.size() - 1),
		"switches": _switches(st),
	}


static func _switches(st: PackedInt32Array) -> int:
	var k := 0
	for i in st.size() - 1:
		if st[i] != st[i + 1]:
			k += 1
	return k
