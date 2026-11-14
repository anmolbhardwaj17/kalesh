## The weight of a moving body, laid over the animated pose each sim tick (P2-041, called by humanoid_anim.gd after the
## AnimationTree): the body leans with its acceleration (forward into a start, back into a stop, into a turn; a damped
## spring, so it settles instead of snapping), the head looks where the camera looks, and the feet stand on the ground
## that is really under them (kerbs, stairs, slopes: leg_ik.gd).
##   lean       the hips turn about the ground point under them; with foot placement on, both ankles are solved back
##              to where the animation had them, so a planted foot stays planted; without it only the spine leans.
##              A sprint bends the spine forward a little more
##   head       neck and head turn toward `look_yaw` (compass), up to HEAD_MAX, eased; it lets go past LOOK_BACK
##   feet       three rays under each foot (heel, ball and toes, world layer). A ramp tilts the foot; at an edge the
##              foot rests on the point that meets its ground first. Heights are eased in world space, so the
##              capsule's 18 cm hop up a riser does not show: the hips ride on the ground of the lowest planted
##              foot, the other knee bends; a sole the animation holds under its ground is lifted onto it
## Skeleton space: +Z forward, +Y up, -X the character's right. Angles in radians.
extends RefCounted

const LegIK := preload("res://characters/leg_ik.gd")

## Lean per m/s2 of acceleration and its cap; the spring's frequency (rad/s).
const LEAN_K := 0.011
const LEAN_MAX := 0.16
const LEAN_W := 21.0
## Extra forward lean at a full sprint.
const SPRINT_LEAN := 0.035
## The spine's share of the lean on a body without foot placement.
const SPINE_SHARE := 0.6
const HEAD_MAX := 1.05
const HEAD_SHARE := 0.62
const HEAD_RATE := 7.0
const LOOK_BACK := 1.9
## Foot placement: how far a foot or the hips may move (m), the rays' reach, the easing rates (1/s).
const FOOT_MAX := 0.55
const RAY_UP := 0.55
const RAY_DOWN := 0.75
## The toes reach this far past the ball (m). The hips come down for a foot the leg cannot reach by this a tick (m).
const TOE := 0.075
const REACH_STEP := 0.02
const HIPS_RATE := 14.0
const HIPS_RATE_DOWN := 60.0
const FOOT_RATE_AIR := 16.0
const FOOT_RATE_DOWN := 70.0
const FOOT_RATE_PLANTED := 40.0
## The animation has a foot on the ground while its sole is within this of the clip's ground (m): the built clips
## hold a planted sole within a millimetre; a foot still a centimetre up is still travelling.
const DOWN := 0.005
const UP := 0.02
## The most the hips move in a tick to follow the ground (m): a body lowers itself, it does not drop.
const HIPS_STEP := 0.02
const HIPS_STEP_DOWN := 0.04
## A height step between heel and ball over this is an edge (a kerb, a riser), under it a ramp.
const EDGE := 0.06

var sk: Skeleton3D
var body: CollisionObject3D
var scale := 1.0
## Ground plane of the clips in skeleton space, the sole points and the foot length (loco_clips.res metadata).
var ground := 0.0
var heel := {}
var ball := {}
var foot_len := 0.18
var ik_on := false
var look_on := false
## Sensed each tick (humanoid_anim.gd sense()): world velocity, compass heading and look yaw, gait speeds.
var vel := Vector3.ZERO
var heading := 0.0
var look_yaw := 0.0
var jog_speed := 3.8
var sprint_speed := 6.5
## The lean now: forward and to the character's right (rad).
var lean := Vector2.ZERO
var head_yaw := 0.0
## What the probes read: which feet the animation has on the ground, the hips' offset (m, world).
var foot_down := {"Left": false, "Right": false}
var hips_off := 0.0
## How far each ankle's target was out of the leg's reach in the last tick (m, skeleton space).
var miss := {"Left": 0.0, "Right": 0.0}
## Per foot, for the probes: [heel and ball height in the animation, heel, ball and toe ground over the body's, offset].
var probe := {"Left": [], "Right": []}

var _legs := {}
var _reach := 0.83
var _hips := -1
var _spine := -1
var _neck := -1
var _head := -1
var _lean_v := Vector2.ZERO
var _bend := 0.0
var _rest := false
var _vy := 0.0
var _y_was := NAN
var _vel_was := Vector3.ZERO
var _acc := Vector3.ZERO
var _fresh := true
var _hips_y := NAN
var _foot_y := {"Left": NAN, "Right": NAN}
var _slope := {"Left": 0.0, "Right": 0.0}
var _hips_goal := NAN
var _ray := PhysicsRayQueryParameters3D.new()


func setup(skeleton: Skeleton3D, body_scale: float, meta: Dictionary) -> void:
	sk = skeleton
	scale = body_scale
	ground = float(meta.get("ground", 0.0))
	var sole: Dictionary = meta.get("sole", {})
	for side in ["Left", "Right"]:
		_legs[side] = LegIK.leg(sk, side)
		heel[side] = sole.get(side + "Heel", Vector3(0, 0.1, -0.06))
		ball[side] = sole.get(side + "Ball", Vector3(0, 0.1, 0.15))
	foot_len = float(sole.get("len", 0.18))
	_reach = LegIK.reach(sk, _legs["Left"])
	_hips = sk.find_bone("Hips")
	_spine = sk.find_bone("Spine")
	_neck = sk.find_bone("Neck")
	_head = sk.find_bone("Head")
	_ray.collision_mask = 1


## Forget the motion so far (a teleport, out of a seat): no lean from the jump in position or speed.
func reset() -> void:
	_fresh = true
	_rest = false
	lean = Vector2.ZERO
	_lean_v = Vector2.ZERO
	_acc = Vector3.ZERO
	head_yaw = 0.0
	_bend = 0.0
	_vy = 0.0
	_y_was = NAN
	_hips_goal = NAN
	_hips_y = NAN
	_foot_y = {"Left": NAN, "Right": NAN}


## One tick, after the AnimationTree posed the skeleton. `planted`: the body is on the ground in a pose whose feet
## belong on it (not in the air, a vault or a seat).
func update(dt: float, planted: bool) -> void:
	_lean_step(dt, planted)
	if body != null:
		# the capsule's own climb or fall, eased (stairs lift it in hops)
		var y := body.global_position.y
		_vy = lerpf(_vy, (y - (y if is_nan(_y_was) else _y_was)) / maxf(dt, 1e-4), 1.0 - exp(-dt * 6.0))
		_y_was = y
	var feet := ik_on and planted and body != null
	var keep := {}
	if feet:
		for side in _legs:
			var f := sk.get_bone_global_pose(_legs[side][2])
			keep[side] = [f.origin, f.basis.orthonormalized()]
	var rl := Basis(Vector3.RIGHT, lean.x) * Basis(Vector3.BACK, lean.y)
	if feet:
		_place(dt, keep, rl)
		if _bend > 1e-4 and _spine >= 0:
			_turn_bone(_spine, Basis(Vector3.RIGHT, _bend))
	else:
		_let_go(dt)
		if (lean.length_squared() > 1e-6 or _bend > 1e-4) and _spine >= 0:
			_turn_bone(_spine, Basis(Vector3.RIGHT, lean.x * SPINE_SHARE + _bend) * Basis(Vector3.BACK, lean.y * SPINE_SHARE))
	if look_on:
		_look(dt, planted)


## The lean follows the acceleration through a critically damped spring.
func _lean_step(dt: float, planted: bool) -> void:
	if _fresh:
		_fresh = false
		_vel_was = vel
	# a body at a steady velocity that stands straight has nothing to settle
	if vel == _vel_was and _rest:
		return
	var a := (vel - _vel_was) / maxf(dt, 1e-4)
	_vel_was = vel
	_acc = _acc.lerp(a, 1.0 - exp(-dt * 30.0))
	var f := Vector3(sin(heading), 0.0, -cos(heading))
	var r := Vector3(-f.z, 0.0, f.x)
	var want := Vector2(_acc.dot(f), _acc.dot(r)) * LEAN_K
	if want.length() > LEAN_MAX:
		want = want.normalized() * LEAN_MAX
	if not planted:
		want = Vector2.ZERO
	# the sprint's own forward lean bends the spine only (leaning the whole body costs the back leg its reach)
	_bend = lerpf(_bend, SPRINT_LEAN * clampf((vel.length() - jog_speed) / maxf(0.1, sprint_speed - jog_speed), 0.0, 1.0), 1.0 - exp(-dt * 8.0))
	var acc := (want - lean) * LEAN_W * LEAN_W - _lean_v * 2.0 * LEAN_W
	_lean_v += acc * dt
	lean += _lean_v * dt
	_rest = want.length_squared() < 1e-10 and lean.length_squared() < 1e-8 and _lean_v.length_squared() < 1e-8 and _acc.length_squared() < 1e-6 \
		and absf(_bend) < 1e-5
	if _rest:
		lean = Vector2.ZERO
		_lean_v = Vector2.ZERO
		_acc = Vector3.ZERO


## Turns a bone by `r` in skeleton space, about its own joint.
func _turn_bone(bone: int, r: Basis) -> void:
	var g := sk.get_bone_global_pose(bone).basis.orthonormalized()
	var p := sk.get_bone_global_pose(sk.get_bone_parent(bone)).basis.orthonormalized()
	sk.set_bone_pose_rotation(bone, (p.inverse() * r * g).get_rotation_quaternion())


func _look(dt: float, planted: bool) -> void:
	var rel := wrapf(look_yaw - heading, -PI, PI)
	var want := 0.0
	if planted and absf(rel) < LOOK_BACK:
		want = clampf(rel, -HEAD_MAX, HEAD_MAX) * 0.75
	head_yaw = lerpf(head_yaw, want, 1.0 - exp(-dt * HEAD_RATE))
	if absf(head_yaw) < 0.004 or _neck < 0 or _head < 0:
		return
	# a turn to the character's right (compass plus) is a turn about +Y by minus the angle
	_turn_bone(_neck, Basis(Vector3.UP, -head_yaw * (1.0 - HEAD_SHARE)))
	_turn_bone(_head, Basis(Vector3.UP, -head_yaw * HEAD_SHARE))


## Off the ground (a jump, a fall off a kerb, a vault): no rays and no leg solve; what the hips and feet were moved
## by eases out, so the body never jumps when the feet leave the ground and starts from near nothing when they land.
func _let_go(dt: float) -> void:
	foot_down["Left"] = false
	foot_down["Right"] = false
	if is_nan(_hips_y) or body == null:
		hips_off = 0.0
		return
	var y0 := body.global_position.y
	var k := exp(-dt * HIPS_RATE)
	# never over the capsule: a falling body takes its hips with it
	hips_off = minf((_hips_y - y0) * k, 0.02)
	_hips_y = y0 + hips_off
	for side in _foot_y:
		if not is_nan(_foot_y[side]):
			_foot_y[side] = y0 + (float(_foot_y[side]) - y0) * k
	if absf(hips_off) > 0.001:
		sk.set_bone_pose_position(_hips, sk.get_bone_pose_position(_hips) + Vector3(0.0, hips_off / scale, 0.0))


## Foot placement: each foot onto the ground under it, the hips onto the ground of the lowest planted foot, with the
## lean; then each ankle solved to its animated place moved by its foot's offset.
func _place(dt: float, keep: Dictionary, rl: Basis) -> void:
	var xf := sk.global_transform
	var y0 := body.global_position.y
	var space := body.get_world_3d().direct_space_state
	_ray.exclude = [body.get_rid()]
	var toe := (xf.basis * Vector3.BACK).normalized() * (TOE * scale)
	var gy := {}
	var clear := {}
	var slope := {}
	var landed := {}
	var low := INF
	for side in _legs:
		var basis: Basis = keep[side][1]
		var ank: Vector3 = keep[side][0]
		var ph: Vector3 = ank + basis * (heel[side] as Vector3)
		var pb: Vector3 = ank + basis * (ball[side] as Vector3)
		# how high the animation holds the heel and the ball over its own ground (under it: a blend that sinks)
		var hh := (ph.y - ground) * scale
		var hb := (pb.y - ground) * scale
		var h_min := minf(hh, hb)
		var wb := xf * pb
		# down once the sole is on the clip's ground, until it is clearly off it (a foot rolling from heel to ball
		# rises a few millimetres on the way)
		var down := h_min < (UP if foot_down[side] else DOWN)
		var gh := _ground_at(space, xf * ph, y0)
		var gb := _ground_at(space, wb, y0)
		# the toes count only for a foot well clear of the ground (it lifts over a kerb or a riser ahead): a foot
		# about to land with its toes over the next step stays on its own
		var gt := _ground_at(space, wb + toe, y0) if h_min > 0.03 else gb
		var off: float
		var s := 0.0
		if absf(gb - gh) < EDGE and gt - gb < EDGE:
			# level ground or a ramp: the ground under the ankle, the foot tilted with it
			off = lerpf(gh, gb, 0.33) - y0 - minf(h_min, 0.0)
			s = atan2(gb - gh, foot_len * scale)
		else:
			# an edge (a kerb, a riser): the foot comes to rest on the point that meets its ground first, so the heel
			# stays on a kerb while the toes roll off it, and toes over a riser lift the foot onto the step
			off = maxf(maxf(gh - y0 - hh, gb - y0 - hb), gt - y0 - maxf(hb, 0.0)) + maxf(h_min, 0.0)
		gy[side] = y0 + clampf(off, -FOOT_MAX, FOOT_MAX)
		slope[side] = s
		clear[side] = maxf(0.0, h_min)
		landed[side] = down and not foot_down[side]
		foot_down[side] = down
		if down:
			low = minf(low, gy[side])
		probe[side] = [hh, hb, gh - y0, gb - y0, gt - y0, off]
	# the hips go by the ground of the lowest planted foot (the last one, in the flight of a run), and never over
	# the capsule: when the body itself goes down, the hips go with it. A foot in the air over lower ground pulls
	# them down as it comes in to land (a step off a kerb lowers the body before the foot arrives)
	if low == INF:
		low = y0 if is_nan(_hips_goal) else _hips_goal
	_hips_goal = low
	low = minf(low, y0)
	var down_left := HIPS_STEP_DOWN
	for side in _legs:
		if not foot_down[side] and float(gy[side]) < low:
			low = lerpf(gy[side], low, smoothstep(0.02, 0.2, float(clear[side])))
	if is_nan(_hips_y):
		_hips_y = low
	else:
		var to := lerpf(_hips_y, low, 1.0 - exp(-dt * (HIPS_RATE_DOWN if low < _hips_y else HIPS_RATE)))
		# as fast as the capsule climbs or falls, plus a little: a body lowers itself, it does not drop
		var follow := 1.3 * _vy * dt
		var step := clampf(to - _hips_y, -HIPS_STEP_DOWN + minf(0.0, follow), HIPS_STEP + maxf(0.0, follow))
		_hips_y += step
		down_left = HIPS_STEP_DOWN - minf(0.0, follow) + minf(0.0, step)
		# a falling body takes its hips with it
		_hips_y = minf(_hips_y, y0 + 0.02)
	_hips_y = clampf(_hips_y, y0 - FOOT_MAX, y0 + FOOT_MAX)
	hips_off = _hips_y - y0
	# the hips: lean about the ground point under them, then down (or up) onto that ground
	var hg := sk.get_bone_global_pose(_hips)
	var pivot := Vector3(hg.origin.x, ground, hg.origin.z)
	var moved := Transform3D(rl * hg.basis, pivot + rl * (hg.origin - pivot) + Vector3(0.0, hips_off / scale, 0.0))
	# where each ankle goes: its animated place moved by its foot's eased offset
	var target := {}
	var need := 0.0
	var max_r := _reach * LegIK.MAX_EXT
	for side in _legs:
		var rate := FOOT_RATE_PLANTED if foot_down[side] else lerpf(FOOT_RATE_DOWN, FOOT_RATE_AIR, clampf(float(clear[side]) / 0.08, 0.0, 1.0))
		var fy: float = _foot_y[side]
		# a foot lands on its ground exactly; after that, and in the air, its height is eased
		fy = gy[side] if is_nan(fy) or landed[side] else lerpf(fy, gy[side], 1.0 - exp(-dt * rate))
		_foot_y[side] = fy
		_slope[side] = lerpf(_slope[side], slope[side], 1.0 - exp(-dt * rate))
		var t: Vector3 = keep[side][0] + Vector3(0.0, (fy - y0) / scale, 0.0)
		target[side] = t
		# a foot that must go lower than the leg is long (the first step off a kerb): the hips come down with it
		var j: Vector3 = moved * sk.get_bone_rest(_legs[side][0]).origin
		var flat := Vector2(t.x - j.x, t.z - j.z).length_squared()
		if flat < max_r * max_r:
			need = maxf(need, (j.y - t.y) - sqrt(max_r * max_r - flat))
	if need > 0.0:
		# within what is left of this tick's step, and gently on level ground: a foot hangs for a moment sooner
		# than the hips jump
		need = minf(need, clampf(down_left, 0.0, REACH_STEP - minf(0.0, 1.3 * _vy * dt)) / scale)
		moved.origin.y -= need
		_hips_y -= need * scale
		hips_off = _hips_y - y0
	var parent := sk.get_bone_global_pose(sk.get_bone_parent(_hips))
	var local := parent.affine_inverse() * moved
	sk.set_bone_pose_position(_hips, local.origin)
	sk.set_bone_pose_rotation(_hips, local.basis.orthonormalized().get_rotation_quaternion())
	for side in _legs:
		# toes up on a rise: a turn about +X by minus the slope
		var fb: Basis = Basis(Vector3.RIGHT, -_slope[side]) * (keep[side][1] as Basis)
		miss[side] = LegIK.solve(sk, _legs[side], target[side], fb, false)


## World height of the ground under a world point (y0 when nothing is there).
func _ground_at(space: PhysicsDirectSpaceState3D, p: Vector3, y0: float) -> float:
	_ray.from = Vector3(p.x, y0 + RAY_UP, p.z)
	_ray.to = Vector3(p.x, y0 - RAY_DOWN, p.z)
	var hit := space.intersect_ray(_ray)
	return y0 if hit.is_empty() else float(hit.position.y)
