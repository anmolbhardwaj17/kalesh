## Debug probes of how the on-foot body moves (P2-041), commands of the hook foot('feel', {test, ...})
## (docs/GAME_HOOKS.md), called by foot_probe.gd. Input only: the keys are pressed through the InputMap like a player's.
##   pops {move}        start, stop or turn (the stop and the turn from a jog, at three points of the gait cycle so
##                      both clips of each play), or walk, jog, sprint as the steady base line. Every tick the
##                      skeleton's pose is read in skeleton space: the largest turn of a trunk bone and of a limb bone
##                      in one tick (degrees), and the largest change of the hips' and the ankles' step from one tick
##                      to the next (the second difference, metres): a pop is a jump in one tick
##   ik {gait, run}     walk or jog the kerb lane (kerbs_north) or the stairs and ramp (stairs_north, stairs_south):
##                      every tick, for each foot the animation has planted, the gap between the sole and the surface
##                      under it (the nearer of heel and ball; a point under its surface counts in full): the worst,
##                      the 95th percentile and the share within 3 cm, and the
##                      largest step of the hips' height in one tick beyond the body's own eased climb or fall (the
##                      18 cm hop of the capsule must not show).
##                      A foot counts while the animation has it down and the capsule stands on the ground
##   camera             a start, a jog, a sprint, a stop and a turn back: the camera's position every tick. jitterM is
##                      the largest distance of a position from the middle of its neighbours (half the second
##                      difference: smooth motion is millimetres, a jitter is the size of the jump), flips counts the
##                      ticks where that offset reverses against the tick before (a shake that is noise, not a sway)
extends RefCounted

const Motor := preload("res://characters/foot_motor.gd")
const Area := preload("res://scenes/course/foot_area.gd")

const PAD_X := -290.0
const PAD_Z := 40.0
const DT := 1.0 / 60.0
const CORE := ["Hips", "Spine", "Chest", "UpperChest", "Neck", "Head"]


static func run(p: Node, o: Dictionary) -> Dictionary:
	match str(o.get("test", "")):
		"pops":
			return await pops(p, str(o.get("move", "stop")))
		"ik":
			return await ik(p, str(o.get("gait", "walk")), str(o.get("run", "stairs_north")))
		"camera":
			return await camera(p)
	return {"error": "foot(feel): unknown test '%s' (pops, ik, camera)" % str(o.get("test", ""))}


static func _keys(p: Node, gait: String, on: bool) -> void:
	p.press("move_forward", 1.0 if on else 0.0)
	p.press("walk", 1.0 if on and gait == "walk" else 0.0)
	p.press("sprint", 1.0 if on and gait == "sprint" else 0.0)


## The skeleton's pose in skeleton space: [rotations, origins] of every bone.
static func _pose(sk: Skeleton3D) -> Array:
	var rot := []
	var pos := PackedVector3Array()
	for i in sk.get_bone_count():
		var g := sk.get_bone_global_pose(i)
		rot.append(g.basis.get_rotation_quaternion())
		pos.append(g.origin)
	return [rot, pos]


static func pops(p: Node, move: String) -> Dictionary:
	var out := {"move": move, "coreDeg": 0.0, "limbDeg": 0.0, "hipsJerkM": 0.0, "footJerkM": 0.0, "states": {}, "runs": 0, "worstBone": "", "worstCore": ""}
	var leads := [75, 81, 87] if move in ["stop", "turn"] else [75]
	for lead in leads:
		await p.stage(PAD_X, PAD_Z, 0.0)
		var c: CharacterBody3D = p.character()
		var h: Node3D = c.humanoid
		if h == null:
			return {"error": "foot(feel pops): the character has no humanoid"}
		var sk: Skeleton3D = h.skeleton
		var core := {}
		for n in CORE:
			core[sk.find_bone(n)] = true
		var hips := sk.find_bone("Hips")
		var feet := [sk.find_bone("LeftFoot"), sk.find_bone("RightFoot")]
		if move != "start":
			_keys(p, move if move in ["walk", "sprint"] else "jog", true)
			await p.ticks(lead)
		else:
			# a body fresh out of staging is still standing up
			await p.ticks(60)
		var poses := []
		poses.append(_pose(sk))
		match move:
			"start":
				_keys(p, "jog", true)
			"stop":
				_keys(p, "jog", false)
			"turn":
				p.press("move_forward", 0.0)
				p.press("move_back", 1.0)
		var phases := [h.phase]
		for i in 54:
			await p.tick()
			poses.append(_pose(sk))
			phases.append(h.phase)
			out.states[h.state] = true
		p.release()
		for i in range(1, poses.size()):
			var a: Array = poses[i - 1]
			var b: Array = poses[i]
			for bone in sk.get_bone_count():
				var deg := rad_to_deg((a[0][bone] as Quaternion).angle_to(b[0][bone]))
				if core.has(bone):
					if deg > out.coreDeg:
						out.coreDeg = deg
						out.worstCore = "%s at tick %d, phase %.3f" % [sk.get_bone_name(bone), i, phases[i]]
				elif deg > out.limbDeg:
					out.limbDeg = deg
					out.worstBone = "%s at tick %d, phase %.3f" % [sk.get_bone_name(bone), i, phases[i]]
			if i >= 2:
				var z: Array = poses[i - 2]
				out.hipsJerkM = maxf(out.hipsJerkM, ((b[1][hips] - a[1][hips]) - (a[1][hips] - z[1][hips])).length() * h.body_scale)
				for f in feet:
					out.footJerkM = maxf(out.footJerkM, ((b[1][f] - a[1][f]) - (a[1][f] - z[1][f])).length() * h.body_scale)
		out.runs += 1
		await p.ticks(20)
	out.states = out.states.keys()
	for k in ["coreDeg", "limbDeg"]:
		out[k] = snappedf(out[k], 0.01)
	for k in ["hipsJerkM", "footJerkM"]:
		out[k] = snappedf(out[k], 0.0001)
	return out


static func ik(p: Node, gait: String, which: String) -> Dictionary:
	var x := (Area.KX0 + Area.KX1) * 0.5
	var ramp_end := Area.ramp_end_s()
	var kerbs_end := Area.SLAB_S0 + (Area.SLAB_LEN + Area.SLAB_GAP) * Area.SLABS - Area.SLAB_GAP
	var runs := {"kerbs_north": [6.0, 8.0, kerbs_end + 2.0], "stairs_north": [Area.STAIRS_S - 4.0, Area.STAIRS_S - 2.0, ramp_end + 2.0],
		"stairs_south": [ramp_end + 5.0, ramp_end + 2.0, Area.STAIRS_S - 2.0]}
	if not runs.has(which):
		return {"error": "foot(feel ik): run %s (kerbs_north, stairs_north, stairs_south)" % which}
	var r: Array = runs[which]
	var s_in := float(r[1])
	var s_out := float(r[2])
	var north := s_out > s_in
	await p.stage(x, Area.z_at(float(r[0])), 0.0 if north else PI)
	var c: CharacterBody3D = p.character()
	var h: Node3D = c.humanoid
	if h == null or not h.feel.ik_on:
		return {"error": "foot(feel ik): the character has no humanoid with foot placement"}
	var sk: Skeleton3D = h.skeleton
	var legs := {"Left": sk.find_bone("LeftFoot"), "Right": sk.find_bone("RightFoot")}
	var hips := sk.find_bone("Hips")
	var space := c.get_world_3d().direct_space_state
	var ray := PhysicsRayQueryParameters3D.new()
	ray.collision_mask = 1
	ray.exclude = [c.get_rid()]
	_keys(p, gait, true)
	var errs := PackedFloat32Array()
	var worst := {}
	var hips_step := 0.0
	var hips_was := NAN
	var hips_at := ""
	var y0_was := 0.0
	var off_was := 0.0
	var finished := false
	var inside := 0
	var t := 0
	var on_steps := 0
	while t < 60 * 40:
		await p.tick()
		t += 1
		var s := -(c.global_position.z - Area.Z0)
		var in_win: bool = (s >= s_in and s <= s_out) if north else (s <= s_in and s >= s_out)
		if not in_win:
			if inside > 0:
				finished = true
				break
			continue
		inside += 1
		var xf := sk.global_transform
		var fwd := Motor.forward(c.heading)
		var hy := (xf * sk.get_bone_global_pose(hips).origin).y
		# the hips' step in this tick beyond the capsule's own eased climb or fall (stairs carry the whole body)
		var excess := absf(hy - hips_was) - absf(h.feel._vy) * DT if not is_nan(hips_was) else 0.0
		if excess > hips_step:
			hips_step = excess
			hips_at = "s %.2f %s/%s y0 %.3f (was %.3f) hips %.3f (was %.3f) off %.3f (was %.3f)" % [s, c.state, h.state, c.global_position.y, y0_was, hy, hips_was, h.feel.hips_off, off_was]
		hips_was = hy
		y0_was = c.global_position.y
		off_was = h.feel.hips_off
		for side in legs:
			# a planted foot: the animation has it down and the body itself stands on something
			if not h.feel.foot_down[side] or c.state != "ground" or not c.is_on_floor():
				continue
			var f := sk.get_bone_global_pose(legs[side])
			var gaps := []
			var pen := 0.0
			for local in [h.feel.heel[side], h.feel.ball[side]]:
				var w: Vector3 = xf * (f * (local as Vector3))
				# the surface under the point, or within 3 cm of it along the body (a sole point a millimetre past
				# an edge stands on the surface beside it); under the surface only when it is under all three
				var best := 1.0
				var under := 1.0
				for d in [0.0, -0.03, 0.03]:
					var at: Vector3 = w + fwd * float(d)
					ray.from = at + Vector3.UP * 0.45
					ray.to = at - Vector3.UP * 0.9
					var hit := space.intersect_ray(ray)
					var gap := 1.0 if hit.is_empty() else w.y - float(hit.position.y)
					if absf(gap) < absf(best):
						best = gap
					under = minf(under, maxf(0.0, -gap))
				gaps.append(best)
				pen = maxf(pen, under)
			var gh := float(gaps[0])
			var gb := float(gaps[1])
			var err := maxf(minf(absf(gh), absf(gb)), pen)
			errs.append(err)
			if c.global_position.y > 0.05:
				on_steps += 1
			if worst.is_empty() or err > float(worst.errM):
				worst = {"errM": snappedf(err, 0.0001), "side": side, "s": snappedf(s, 0.01), "heelGap": snappedf(gaps[0], 0.001), "ballGap": snappedf(gaps[1], 0.001),
					"y0": snappedf(c.global_position.y, 0.001), "hipsOff": snappedf(h.feel.hips_off, 0.001), "footY": snappedf(h.feel._foot_y[side], 0.001),
					"missM": snappedf(h.feel.miss[side], 0.001), "state": h.state, "tick": inside, "probe": str(h.feel.probe[side])}
	_keys(p, gait, false)
	if errs.is_empty():
		return {"error": "foot(feel ik): no planted foot was seen on %s" % which}
	var sorted := Array(errs)
	sorted.sort()
	var within := 0
	for e in errs:
		if e <= 0.03:
			within += 1
	return {"gait": gait, "run": which, "samples": errs.size(), "within3cmPct": snappedf(100.0 * within / errs.size(), 0.01), "onStepsSamples": on_steps, "maxErrM": snappedf(sorted[sorted.size() - 1], 0.0001),
		"p95ErrM": snappedf(sorted[int(sorted.size() * 0.95)], 0.0001), "worst": worst, "hipsStepMaxM": snappedf(hips_step, 0.0001), "hipsStepAt": hips_at,
		"finished": finished, "ticks": inside}


static func camera(p: Node) -> Dictionary:
	await p.stage(PAD_X, PAD_Z, 0.0)
	var c: CharacterBody3D = p.character()
	var cam: Camera3D = p.mode_node().foot_camera
	var pts := PackedVector3Array()
	var lag := 0.0
	var roll := 0.0
	# [ticks, forward, sprint, back]
	var plan := [[60, 1, 0, 0], [100, 1, 1, 0], [50, 1, 0, 0], [50, 0, 0, 0], [60, 1, 0, 0], [50, 0, 0, 1], [30, 0, 0, 0]]
	for step in plan:
		p.press("move_forward", float(step[1]))
		p.press("sprint", float(step[2]))
		p.press("move_back", float(step[3]))
		for i in int(step[0]):
			await p.tick()
			pts.append(cam.global_position)
			lag = maxf(lag, cam.lag_m)
			roll = maxf(roll, absf(rad_to_deg(asin(clampf(cam.global_transform.basis.x.y, -1.0, 1.0)))))
	p.release()
	var jitter := 0.0
	var flips := 0
	var was := Vector3.ZERO
	for i in range(1, pts.size() - 1):
		var off := pts[i] - (pts[i - 1] + pts[i + 1]) * 0.5
		jitter = maxf(jitter, off.length())
		if off.length() > 0.0005 and was.length() > 0.0005 and off.dot(was) < -0.5 * off.length() * was.length():
			flips += 1
		was = off
	return {"ticks": pts.size(), "jitterM": snappedf(jitter, 0.00001), "flips": flips, "lagMaxM": snappedf(lag, 0.0001), "rollMaxDeg": snappedf(roll, 0.001)}
