## The start, stop and plant-and-turn clips (P2-041), built offline by build_locomotion.gd from the idle and the built
## jog: the free library has none. Each is a short step sequence under a body whose speed follows the game's own motor
## (foot_motor.gd is run here, so the distance a planted foot goes back is the distance the character really covers):
##   Stop_R, Stop_L   a jog to a stand. The foot in the air lands as the brake, the other closes; both end in the
##                    idle's stance (left ahead), so the clip ends in the idle's own pose. R: the right foot lands next
##                    (gait phase under 0.5), L: the left
##   Start            from the idle into a jog: a quick dip, the left foot pushes, the right swings through; ends in
##                    the jog's pose at `out_phase`
##   Turn_R, Turn_L   plant and turn back while jogging: the next foot lands under the body, the hips drop, the other
##                    leg comes round; ends in the jog's pose at `out_phase` (the lean comes from body_feel.gd)
## A foot is a list of plants (on the ground from one time to another, at a ball coordinate) with swings between them;
## a free pose at either end is a foot in the air as the jog has it. Also writes Crouch_Idle_K (the library's crouch
## idle lifted onto the ground the other clips stand on).
extends RefCounted

const Kit := preload("res://characters/tools/loco_kit.gd")
const Motor := preload("res://characters/foot_motor.gd")
const REF_SCALE := 0.94
const TICK := 1.0 / 60.0
const JOG := "k/Jog_K"


static func build(k: Kit, out: AnimationLibrary, gaits: Dictionary) -> Dictionary:
	var meta := {}
	var jog: Dictionary = gaits["Jog_K"]
	var cyc := float(jog.cycle_s)
	var stride := float(jog.model_speed) * cyc
	# the idle: body, flat feet and where they stand
	k.pose("Idle", 0.0)
	var idle := k.body_sample()
	var flat := {}
	var g_idle := {}
	var x_idle := {}
	for side in Kit.SIDES:
		var f := k.sk.get_bone_global_pose(k.legs[side][2])
		flat[side] = f.basis.orthonormalized()
		g_idle[side] = k.sole_points(side, f)[1].z
		x_idle[side] = f.origin.x
	var stop := _travel(_sim("stop"))
	var start := _travel(_sim("start"))
	var turn := _travel(_sim("turn"))
	var total: float = stop[stop.size() - 1]
	var jog_body := func(ph: float) -> Dictionary:
		k.pose(JOG, ph * cyc)
		return k.body_sample()
	var jog_leg := func(side: String, ph: float) -> Dictionary:
		k.pose(JOG, ph * cyc)
		return k.leg_sample(side)
	# stops: 0.52 s. `near` lands under the body and brakes, `far` was planted, lifts and takes the idle's place
	for v in [["Stop_R", "Right", "Left", 0.12], ["Stop_L", "Left", "Right", 0.62]]:
		var brake: String = v[1]
		var other: String = v[2]
		var p0: float = v[3]
		var len := 0.52
		var land := 0.15
		var feet := {}
		feet[brake] = [{"free": jog_leg.call(brake, p0)}, {"plant": [land, len], "g": g_idle[brake], "anchor": len, "x": x_idle[brake], "strike": 0.22}]
		feet[other] = [{"plant": [0.0, 0.16], "g": 0.12, "anchor": 0.0, "x": x_idle[other], "push": 0.45},
			{"plant": [0.4, len], "g": g_idle[other], "anchor": len, "x": x_idle[other], "strike": 0.1}]
		# the trunk comes upright early (and a little past it: the brake), the legs settle after
		var spec := {"len": len, "travel": stop, "feet": feet, "flat": flat, "arc": 0.09,
			"body": func(t: float) -> Dictionary:
				var ph: float = p0 + _at(stop, t) / stride
				var b := k.mix(jog_body.call(ph), idle, smoothstep(0.0, 0.26, t))
				b.pos = (b.pos as Vector3) + Vector3(0.0, 0.0, -0.05 * sin(PI * clampf(t / 0.4, 0.0, 1.0)))
				return b,
			"dip": func(t: float) -> float: return -0.035 * sin(PI * clampf(t / 0.36, 0.0, 1.0))}
		out.add_animation(v[0], _move(k, spec))
		meta[v[0]] = {"len": len, "travel_m": snappedf(total, 0.001), "from_phase": p0}
	# start: 0.3 s into the jog pose whose left foot is as far back as the push leaves it
	var s_len := 0.3
	var s_end := _at(start, s_len)
	var out_ph := _phase_of(k, cyc, "Left", float(g_idle["Left"]) - s_end, 0.0, float(jog.duty))
	var s_feet := {"Left": [{"plant": [0.0, s_len], "g": g_idle["Left"], "anchor": 0.0, "x": x_idle["Left"], "push": 0.3}],
		"Right": [{"plant": [0.0, 0.1], "g": g_idle["Right"], "anchor": 0.0, "x": x_idle["Right"], "push": 0.5}, {"free": jog_leg.call("Right", out_ph)}]}
	var s_to: Dictionary = jog_body.call(out_ph)
	out.add_animation("Start", _move(k, {"len": s_len, "travel": start, "feet": s_feet, "flat": flat, "arc": 0.05,
		"body": func(t: float) -> Dictionary: return k.mix(idle, s_to, smoothstep(0.0, 0.27, t)),
		"dip": func(t: float) -> float: return -0.025 * sin(PI * clampf(t / 0.22, 0.0, 1.0))}))
	meta["Start"] = {"len": s_len, "out_phase": snappedf(out_ph, 0.001), "travel_m": snappedf(s_end, 0.001)}
	# turns: 0.36 s. `pivot` lands under the body and carries the turn, `other` comes round into the jog's swing
	for v in [["Turn_R", "Right", "Left", 0.12, 0.7], ["Turn_L", "Left", "Right", 0.62, 0.2]]:
		var pivot: String = v[1]
		var other: String = v[2]
		var p0: float = v[3]
		var to_ph: float = v[4]
		var len := 0.36
		var end_leg: Dictionary = jog_leg.call(pivot, to_ph)
		var g_end: float = k.sole_points(pivot, Transform3D(end_leg.basis, end_leg.ankle))[1].z
		var feet := {}
		feet[pivot] = [{"free": jog_leg.call(pivot, p0)}, {"plant": [0.09, len], "g": 0.1, "g_to": g_end, "x": float(x_idle[pivot]) * 0.45, "x_to": x_idle[pivot],
			"strike": 0.12, "push": 0.35}]
		feet[other] = [{"plant": [0.0, 0.08], "g": 0.12, "anchor": 0.0, "x": x_idle[other], "push": 0.4}, {"free": jog_leg.call(other, to_ph)}]
		var from_b: Dictionary = jog_body.call(p0)
		var to_b: Dictionary = jog_body.call(to_ph)
		out.add_animation(v[0], _move(k, {"len": len, "travel": turn, "feet": feet, "flat": flat, "arc": 0.1,
			"body": func(t: float) -> Dictionary:
				# through the idle's upright body in the middle of the turn
				var mid := k.mix(from_b, idle, smoothstep(0.0, 0.16, t))
				return k.mix(mid, to_b, smoothstep(0.14, 0.34, t)),
			"dip": func(t: float) -> float: return -0.075 * sin(PI * clampf(t / len, 0.0, 1.0))}))
		meta[v[0]] = {"len": len, "out_phase": to_ph, "from_phase": p0}
	out.add_animation("Crouch_Idle_K", _reground(k, "Crouch_Idle"))
	for name in meta:
		print("move %s: %s" % [name, JSON.stringify(meta[name])])
	return meta


## The motor's ground speed per tick (m/s) in one of three cases: "stop" (jogging, the stick let go), "start" (from
## rest into a jog), "turn" (jogging, the stick pulled straight back).
static func _sim(kind: String) -> PackedFloat32Array:
	var m := Motor.new()
	var fwd := Motor.forward(0.0)
	if kind != "start":
		for i in 90:
			m.step(TICK, fwd, false, false)
	var out := PackedFloat32Array()
	for i in 60:
		var move := Vector3.ZERO if kind == "stop" else (fwd if kind == "start" else -fwd)
		m.step(TICK, move, false, false)
		out.append(m.speed)
	return out


## Skeleton metres covered by the end of each tick (index 0 is time 0).
static func _travel(speeds: PackedFloat32Array) -> PackedFloat32Array:
	var out := PackedFloat32Array([0.0])
	var s := 0.0
	for v in speeds:
		s += v * TICK / REF_SCALE
		out.append(s)
	return out


static func _at(travel: PackedFloat32Array, t: float) -> float:
	var f := clampf(t / TICK, 0.0, float(travel.size() - 1))
	var i := mini(int(f), travel.size() - 2)
	return lerpf(travel[i], travel[i + 1], f - i)


## The phase of the jog (between two phases of a foot's stance) at which the sole's ball is nearest to z = `g`.
static func _phase_of(k: Kit, cyc: float, side: String, g: float, from: float, to: float) -> float:
	var best := from
	var err := 1e9
	for i in 61:
		var ph := lerpf(from, to, i / 60.0)
		k.pose(JOG, ph * cyc)
		var z: float = k.sole_points(side, k.sk.get_bone_global_pose(k.legs[side][2]))[1].z
		if absf(z - g) < err:
			err = absf(z - g)
			best = ph
	return best


## A foot of a move at time t: [ankle, basis].
static func _foot(k: Kit, spec: Dictionary, side: String, t: float) -> Array:
	var list: Array = spec.feet[side]
	var before := {}
	var after := {}
	for seg in list:
		if seg.has("plant"):
			if t >= seg.plant[0] and t <= seg.plant[1]:
				return _planted(k, spec, side, seg, t)
			if t < seg.plant[0] and after.is_empty():
				after = seg
			if t > seg.plant[1]:
				before = seg
		elif seg == list[0]:
			before = seg
		elif after.is_empty():
			after = seg
	# a swing from the pose that ends `before` to the pose that starts `after`
	var ta: float = before.plant[1] if before.has("plant") else 0.0
	var tb: float = after.plant[0] if after.has("plant") else float(spec.len)
	var a: Array = _planted(k, spec, side, before, ta) if before.has("plant") else [before.free.ankle, before.free.basis]
	var b: Array = _planted(k, spec, side, after, tb) if after.has("plant") else [after.free.ankle, after.free.basis]
	var u := clampf((t - ta) / maxf(tb - ta, 1e-4), 0.0, 1.0)
	var e := smoothstep(0.0, 1.0, u)
	var basis: Basis = (a[1] as Basis).slerp(b[1], e)
	var p: Vector3 = (a[0] as Vector3).lerp(b[0], e) + Vector3(0.0, float(spec.arc) * sin(PI * u), 0.0)
	p.y = maxf(p.y, k.ankle_floor(side, basis))
	return [p, basis]


## A planted foot: its ball coordinate goes back with the ground the body covers (or from `g` to `g_to` over the
## plant), toes up as it lands (`strike`, rad), heel up before it lifts (`push`, rad).
static func _planted(k: Kit, spec: Dictionary, side: String, seg: Dictionary, t: float) -> Array:
	var t0: float = seg.plant[0]
	var t1: float = seg.plant[1]
	var g: float
	var x := float(seg.x)
	if seg.has("g_to"):
		var e := smoothstep(t0, t1, t)
		g = lerpf(float(seg.g), float(seg.g_to), e)
		x = lerpf(x, float(seg.get("x_to", x)), e)
	else:
		g = float(seg.g) - (_at(spec.travel, t) - _at(spec.travel, float(seg.anchor)))
	var pitch := 0.0
	if seg.has("strike"):
		pitch -= float(seg.strike) * (1.0 - smoothstep(t0, t0 + 0.07, t))
	if seg.has("push"):
		pitch += float(seg.push) * smoothstep(t1 - 0.1, t1, t)
	var basis: Basis = Basis(Vector3.RIGHT, pitch) * (spec.flat[side] as Basis)
	return [k.planted_ankle(side, basis, x, g), basis]


## Bakes a move: the body of `spec.body` at each frame with the hips dipped, both feet solved onto their sequence.
static func _move(k: Kit, spec: Dictionary) -> Animation:
	var n := roundi(float(spec.len) * Kit.FPS) + 1
	var bodies := []
	var targets := []
	var need := PackedFloat32Array()
	var max_r := k.reach * 0.992
	for i in n:
		var t := float(i) / Kit.FPS
		var b: Dictionary = spec.body.call(t)
		b.pos = (b.pos as Vector3) + Vector3(0.0, float(spec.dip.call(t)), 0.0)
		var tg := {}
		var over := 0.0
		for side in Kit.SIDES:
			tg[side] = _foot(k, spec, side, t)
			var j := k.hip_joint(side, b.pos, b.hips_basis)
			var p: Vector3 = tg[side][0]
			var room := sqrt(maxf(0.0, max_r * max_r - Vector2(p.x - j.x, p.z - j.z).length_squared()))
			over = maxf(over, (j.y - p.y) - room)
		bodies.append(b)
		targets.append(tg)
		need.append(maxf(0.0, over))
	# the hips drop where a leg could not reach, smoothly (three passes of a 5 frame mean, never under the need)
	var drop := need
	for pass_i in 3:
		var next := PackedFloat32Array()
		next.resize(n)
		for i in n:
			var sum := 0.0
			for d in range(-2, 3):
				sum += drop[clampi(i + d, 0, n - 1)]
			next[i] = maxf(sum / 5.0, need[i])
		drop = next
	var frames := []
	for i in n:
		var b: Dictionary = bodies[i]
		b.pos = (b.pos as Vector3) - Vector3(0.0, drop[i], 0.0)
		k.apply_body(b)
		k.plant({"Left": targets[i]["Left"][0], "Right": targets[i]["Right"][0]}, {"Left": targets[i]["Left"][1], "Right": targets[i]["Right"][1]})
		frames.append(k.snap())
	return k.bake(frames, float(spec.len), false)


## A copy of a library clip lifted onto the ground the other clips stand on.
static func _reground(k: Kit, clip: String) -> Animation:
	var a := k.lib.get_animation(clip).duplicate(true) as Animation
	var raise := k.ground - k.clip_ground(clip)
	var tr := a.find_track(NodePath("%GeneralSkeleton:Hips"), Animation.TYPE_POSITION_3D)
	for i in a.track_get_key_count(tr):
		a.track_set_key_value(tr, i, (a.track_get_key_value(tr, i) as Vector3) + Vector3(0.0, raise, 0.0))
	return a
