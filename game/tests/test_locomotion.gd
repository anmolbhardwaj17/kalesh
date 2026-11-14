## On-foot movement that has weight (P2-041): the built locomotion clips (rig/loco_clips.res: cadence, stride, feet
## that hold, play rates of the three leads), the start, stop and turn clips (they begin and end in the poses they
## hand over to), the leg IK, the motor's speed ramps, the body's lean spring, foot contact with a flight phase, the
## moves the animation picks, and the camera's follow lag.
extends RefCounted

const Humanoid := preload("res://characters/humanoid_anim.gd")
const BodyFeel := preload("res://characters/body_feel.gd")
const LegIK := preload("res://characters/leg_ik.gd")
const Contact := preload("res://characters/foot_contact.gd")
const Leads := preload("res://characters/leads.gd")
const Motor := preload("res://characters/foot_motor.gd")
const OnFoot := preload("res://characters/on_foot.gd")
const FootCamera := preload("res://camera/on_foot_camera.gd")
const DT := 1.0 / 60.0
## Steps a minute a person takes at each gait's speed (lowest, highest).
const TRUNK := ["Hips", "Chest", "UpperChest", "Neck", "Head", "LeftUpperArm", "RightUpperArm", "LeftLowerArm", "RightLowerArm"]
const LEGS := ["LeftUpperLeg", "RightUpperLeg", "LeftLowerLeg", "RightLowerLeg"]
const CADENCE := {"Walk_K": [110.0, 135.0], "Jog_K": [155.0, 180.0], "Sprint_K": [190.0, 230.0], "Crouch_K": [80.0, 115.0]}

var t
var tree: SceneTree


func test_gait_clips_fit_the_game_speeds() -> void:
	var lib := Humanoid.loco()
	t.ok(lib != null, "rig/loco_clips.res loads (tools/characters/loco_build.mjs)")
	if lib == null:
		return
	var gaits: Dictionary = lib.get_meta("gaits", {})
	var speeds := {"Walk_K": Motor.WALK, "Jog_K": Motor.JOG, "Sprint_K": Motor.SPRINT, "Crouch_K": Motor.CROUCH}
	for name in speeds:
		t.ok(gaits.has(name) and lib.has_animation(name), "gait clip %s and its numbers" % name)
		if not gaits.has(name):
			continue
		var g: Dictionary = gaits[name]
		var a := lib.get_animation(name)
		t.ok(a.loop_mode == Animation.LOOP_LINEAR, "%s loops" % name)
		t.near(a.length, float(g.cycle_s), 1e-3, "%s lasts its cycle" % name)
		t.near(float(g.speed), float(speeds[name]), 1e-6, "%s is built for the motor's speed" % name)
		t.near(float(g.model_speed) * float(lib.get_meta("ref_scale")), float(g.speed), 1e-3, "%s: skeleton speed x reference scale is the game speed" % name)
		t.ok(float(g.spm) >= CADENCE[name][0] and float(g.spm) <= CADENCE[name][1], "%s cadence %.0f steps a minute is a person's at %.1f m/s" % [name, g.spm, g.speed])
		t.less(float(g.slide), 0.05, "%s: planted feet slide (share of the ground covered)" % name)
		t.less(float(g.miss_m), 0.005, "%s: every ankle target is within the leg's reach (m)" % name)
		t.less(float(g.deepest_m), 0.01, "%s: no sole goes under the ground (m)" % name)
		if name != "Crouch_K":
			t.less(float(g.hip_travel_m), 0.09, "%s: the hips travel under 9 cm (the library's jog bounds 26 cm)" % name)
			for id in ["bittu", "meera", "danny"]:
				var rate := float(g.speed) / (float(g.model_speed) * Leads.scale_of(id))
				t.ok(rate >= 0.9 and rate <= 1.15, "%s plays at %.3f for %s (0.9 to 1.15)" % [name, rate, id])


func test_moves_begin_and_end_in_the_poses_they_join() -> void:
	var lib := Humanoid.loco()
	var moves: Dictionary = lib.get_meta("moves", {})
	for name in ["Start", "Stop_L", "Stop_R", "Turn_L", "Turn_R"]:
		t.ok(lib.has_animation(name) and moves.has(name), "move clip %s" % name)
	var idle := Humanoid.clips().get_animation("Idle")
	for name in ["Stop_L", "Stop_R"]:
		var a := lib.get_animation(name)
		t.less(_pose_gap(a, a.length, idle, 0.0, TRUNK), 1.0, "%s ends in the idle's pose (trunk, arms and head, degrees)" % name)
		# a nearly straight leg turns several degrees for a centimetre of ankle height (the feet stand on the ground)
		t.less(_pose_gap(a, a.length, idle, 0.0, LEGS), 8.0, "%s ends on the idle's legs (degrees)" % name)
		t.ok(float(moves[name].travel_m) > 0.5 and float(moves[name].travel_m) < 0.9, "%s covers the motor's stop from a jog (%.2f skeleton m)" % [name, moves[name].travel_m])
	var start := lib.get_animation("Start")
	t.less(_pose_gap(start, 0.0, idle, 0.0, TRUNK), 1.0, "Start begins in the idle's pose (trunk, arms and head, degrees)")
	t.less(_pose_gap(start, 0.0, idle, 0.0, LEGS), 8.0, "Start begins on the idle's legs (degrees)")
	var jog := lib.get_animation("Jog_K")
	var ph := float(moves["Start"].out_phase)
	t.less(_pose_gap(start, start.length, jog, ph * jog.length, ["Hips", "Chest", "UpperChest", "LeftUpperArm", "RightUpperArm"]), 12.0,
		"Start ends near the jog's pose at its hand over phase %.2f (trunk and arms, degrees)" % ph)
	for name in ["Turn_L", "Turn_R"]:
		var a := lib.get_animation(name)
		var to := float(moves[name].out_phase)
		t.less(_pose_gap(a, a.length, jog, to * jog.length, ["Hips", "Chest", "UpperChest", "LeftUpperArm", "RightUpperArm"]), 12.0,
			"%s ends near the jog's pose at phase %.2f (degrees)" % [name, to])


## Largest angle (degrees) between two clips' rotations of the same bones at two times.
func _pose_gap(a: Animation, ta: float, b: Animation, tb: float, bones: Array) -> float:
	var worst := 0.0
	for bone in bones:
		var path := NodePath("%GeneralSkeleton:" + bone)
		var ia := a.find_track(path, Animation.TYPE_ROTATION_3D)
		var ib := b.find_track(path, Animation.TYPE_ROTATION_3D)
		if ia < 0 or ib < 0:
			continue
		worst = maxf(worst, rad_to_deg(a.rotation_track_interpolate(ia, ta).angle_to(b.rotation_track_interpolate(ib, tb))))
	return worst


func test_leg_ik_puts_the_ankle_on_its_target() -> void:
	var h := Humanoid.new()
	tree.root.add_child(h)
	t.ok(h.setup("bittu"), "setup builds the body")
	h.step(DT, "ground", 0.0, false)
	var sk: Skeleton3D = h.skeleton
	var leg := LegIK.leg(sk, "Left")
	var ankle := sk.get_bone_global_pose(leg[2]).origin
	var foot_was := sk.get_bone_global_pose(leg[2]).basis.orthonormalized()
	var knee_was := sk.get_bone_global_pose(leg[1]).origin
	for off in [Vector3(0, 0.15, 0), Vector3(0, 0.08, 0.12), Vector3(0.04, 0.2, -0.1)]:
		var miss := LegIK.solve(sk, leg, ankle + off)
		t.near(miss, 0.0, 1e-6, "a target within reach is reached")
		t.less(sk.get_bone_global_pose(leg[2]).origin.distance_to(ankle + off), 0.001, "the ankle is on the target %s (m)" % str(off))
		t.less(rad_to_deg(sk.get_bone_global_pose(leg[2]).basis.get_rotation_quaternion().angle_to(foot_was.get_rotation_quaternion())), 0.1, "the foot keeps its own direction (degrees)")
		t.ok(sk.get_bone_global_pose(leg[1]).origin.z > knee_was.z - 0.02, "the knee bends forward, not back")
	var far := LegIK.solve(sk, leg, ankle + Vector3(0, -0.5, 0))
	t.ok(far > 0.3, "a target out of reach answers how far it is (%.2f m)" % far)
	t.less(LegIK.reach(sk, leg) - sk.get_bone_global_pose(leg[0]).origin.distance_to(sk.get_bone_global_pose(leg[2]).origin), 0.01, "and the leg stretches to its length less a hair")
	h.free()


func test_the_motor_ramps_its_speed() -> void:
	var m := Motor.new()
	var fwd := Motor.forward(0.0)
	var worst := 0.0
	var first := 0.0
	var ticks_jog := 0
	for i in 60:
		var was := m.speed
		m.step(DT, fwd, false, false)
		worst = maxf(worst, m.speed - was)
		if i == 0:
			first = m.speed
		if ticks_jog == 0 and m.speed >= Motor.JOG - 1e-9:
			ticks_jog = i + 1
	t.less(worst, Motor.ACCEL * DT + 1e-6, "the speed never gains more than the push allows in a tick (m/s)")
	t.less(first, Motor.JERK * DT * DT + 1e-6, "the push builds up: the first tick gains %.4f m/s" % first)
	t.ok(ticks_jog >= 20 and ticks_jog <= 33, "rest to a jog in 0.33 to 0.55 s (%d ticks)" % ticks_jog)
	var s := Motor.new()
	var ticks_sprint := 0
	for i in 60:
		s.step(DT, fwd, false, true)
		if ticks_sprint == 0 and s.speed >= Motor.SPRINT - 1e-9:
			ticks_sprint = i + 1
	t.ok(ticks_sprint >= 40 and ticks_sprint <= 57, "rest to a sprint in 0.67 to 0.95 s (%d ticks)" % ticks_sprint)
	var dist := 0.0
	var ticks_stop := 0
	var drop := 0.0
	while m.speed > 0.0 and ticks_stop < 200:
		var was := m.speed
		m.step(DT, Vector3.ZERO, false, false)
		drop = maxf(drop, was - m.speed)
		dist += m.speed * DT
		ticks_stop += 1
	t.less(drop, Motor.DECEL * DT + 1e-6, "the speed never loses more than the brake allows in a tick (m/s)")
	t.ok(ticks_stop >= 18 and ticks_stop <= 30, "a jog stops in 0.3 to 0.5 s (%d ticks)" % ticks_stop)
	t.ok(dist > 0.45 and dist < 0.8, "over 0.45 to 0.8 m (%.3f m)" % dist)
	m.step(DT, -fwd, false, false)
	t.ok(m.turning, "the stick pulled back is a turn back")


func test_the_body_leans_with_its_acceleration() -> void:
	var f := BodyFeel.new()
	var m := Motor.new()
	var peak := 0.0
	for i in 40:
		m.step(DT, Motor.forward(0.0), false, false)
		f.vel = Motor.forward(m.heading) * m.speed
		f.heading = m.heading
		f._lean_step(DT, true)
		peak = maxf(peak, f.lean.x)
	t.ok(peak > 0.05 and peak <= BodyFeel.LEAN_MAX + 0.02, "speeding up leans the body forward (%.3f rad at most)" % peak)
	for i in 60:
		m.step(DT, Motor.forward(0.0), false, false)
		f.vel = Motor.forward(m.heading) * m.speed
		f._lean_step(DT, true)
	t.near(f.lean.x, 0.0, 0.003, "at a steady jog it stands straight again")
	var back := 0.0
	for i in 30:
		m.step(DT, Vector3.ZERO, false, false)
		f.vel = Motor.forward(m.heading) * m.speed
		f._lean_step(DT, true)
		back = minf(back, f.lean.x)
	t.ok(back < -0.05, "braking leans it back (%.3f rad)" % back)
	# a turn to the right (east) leans to the right
	var g := BodyFeel.new()
	g.vel = Motor.forward(0.0) * 3.8
	g._lean_step(DT, true)
	var side := 0.0
	for i in 10:
		g.heading = 0.1 * (i + 1)
		g.vel = Motor.forward(g.heading) * 3.8
		g._lean_step(DT, true)
		side = maxf(side, g.lean.y)
	t.ok(side > 0.03, "a turn to the right leans into it (%.3f rad to the right)" % side)


func test_foot_contact_knows_the_flight_of_a_run() -> void:
	# left foot down for 6 samples going back at 3 m/s, then both feet up for 4, then the right foot down
	var l := PackedVector3Array()
	var r := PackedVector3Array()
	for i in 16:
		var u := float(i) * DT
		if i < 6:
			l.append(Vector3(0.1, 0.0, 0.3 - 3.0 * u))
			r.append(Vector3(-0.1, 0.3, -0.2 + 5.0 * u))
		elif i < 10:
			l.append(Vector3(0.1, 0.1 + 0.02 * i, -5.0 * u))
			r.append(Vector3(-0.1, 0.1, 0.2))
		else:
			l.append(Vector3(0.1, 0.4, 0.0))
			r.append(Vector3(-0.1, 0.0, 0.3 - 3.0 * (u - 10 * DT)))
	var st := Contact.stance(l, r)
	t.ok(st[0] == 0 and st[5] == 0 and st[7] == -1 and st[12] == 1, "left, then neither, then right (%s)" % str(st))
	t.near(Contact.stance_speed(l, r, DT, Vector3(0, 0, 1)), 3.0, 1e-4, "the planted foot's speed leaves the flight out")


func test_the_animation_picks_start_stop_and_turn() -> void:
	var h := Humanoid.new()
	tree.root.add_child(h)
	h.setup("bittu")
	var m := Motor.new()
	var seen := {}
	var intent := func() -> String: return "stop" if m.gait == "idle" else ("turn" if m.turning else "go")
	for i in 30:
		m.step(DT, Vector3.ZERO, false, false)
		h.step(DT, "ground", m.speed, false, intent.call())
	t.ok(h.state == "idle", "standing is idle (%s)" % h.state)
	for i in 70:
		m.step(DT, Motor.forward(0.0), false, false)
		h.step(DT, "ground", m.speed, false, intent.call())
		seen[h.state] = true
	t.ok(seen.has("start") and h.state == "jog", "from standing into a jog plays the start, then jogs (%s, now %s)" % [str(seen.keys()), h.state])
	t.ok(h.rate >= 0.9 and h.rate <= 1.15, "the jog plays at rate %.3f" % h.rate)
	seen.clear()
	for i in 50:
		m.step(DT, Motor.forward(PI), false, false)
		h.step(DT, "ground", m.speed, false, intent.call())
		seen[h.state] = true
	t.ok(seen.has("turn"), "the stick pulled back plays the turn (%s)" % str(seen.keys()))
	for i in 40:
		m.step(DT, Motor.forward(PI), false, false)
		h.step(DT, "ground", m.speed, false, intent.call())
	seen.clear()
	for i in 60:
		m.step(DT, Vector3.ZERO, false, false)
		h.step(DT, "ground", m.speed, false, intent.call())
		seen[h.state] = true
	t.ok(seen.has("stop") and h.state == "idle", "letting go plays the stop and ends idle (%s, now %s)" % [str(seen.keys()), h.state])
	# a walk has no moves
	seen.clear()
	for i in 60:
		m.step(DT, Motor.forward(0.0), true, false)
		h.step(DT, "ground", m.speed, false, "walk")
		seen[h.state] = true
	t.ok(not seen.has("start") and h.state == "walk", "a walk eases in without a move (%s)" % str(seen.keys()))
	h.free()


func test_the_camera_lag_stays_inside_the_capsule() -> void:
	var cam := FootCamera.new()
	t.less(FootCamera.LAG_MAX, OnFoot.RADIUS - cam.sphere_r + 1e-6, "the trailing pivot never leaves the capsule by more than the sweep sphere allows (m)")
	t.ok(FootCamera.SWAY_BOB <= 0.015 and FootCamera.SWAY_ROLL <= 0.006, "the sprint sway is small (%.3f m, %.4f rad)" % [FootCamera.SWAY_BOB, FootCamera.SWAY_ROLL])
	cam.free()
