## Offline helpers of the locomotion build (P2-041, build_locomotion.gd and build_moves.gd; never loaded by the game):
## poses the male mannequin from a library clip, reads a leg or the whole body off the skeleton, puts them back, plants a
## foot on the clip's ground plane and bakes a list of posed frames into an Animation of the humanoid profile.
## Skeleton space: +Z is the model's forward, the ground of the library's clips is the plane y = `ground` (the library
## stands 8 cm over y 0; humanoid_anim.gd lowers the model by it).
extends RefCounted

const LegIK := preload("res://characters/leg_ik.gd")
## Keys a second: a sprinting leg turns 8 degrees in 1/60 s, and a straight line between such keys strays 7 mm.
const FPS := 120.0
## Keys a second of this build: FPS, or 240 for a lead model (P2-063: Danny's toe-off turns his foot so fast that a
## straight line between 120 keys a second dips the ball 2.3 cm under the ground)
var fps := FPS
## Lead model builds bend a straight or backward knee forwards (leg_ik.gd `forward_knee`).
var forward_knee := false
const SIDES := ["Left", "Right"]

var sk: Skeleton3D
var ap: AnimationPlayer
var lib: AnimationLibrary
## side -> [upper, lower, foot, toes]
var legs := {}
## side -> the sole point under the heel and under the ball joint, in the foot bone's frame
var heel := {}
var ball := {}
## Flat distance from the heel point to the ball point.
var foot_len := 0.0
var ground := 0.0
var reach := 0.0
var hips := -1
## Bones that get a rotation track (every bone but the root and the leaf bones).
var bones := PackedInt32Array()
## Height of the ankle over the ground with the foot flat.
var ankle_flat := 0.0
## The body scale the built speeds are exact for (game m/s = skeleton m/s x ref_scale): the stand-in Bittu's 0.94, or
## a lead model's own scale (build_locomotion.gd -- lead <id>).
var ref_scale := 0.94
var _clip := ""


func setup(root: Node, mannequin: Node3D, library: AnimationLibrary) -> void:
	lib = library
	root.add_child(mannequin)
	sk = mannequin.get_node("GeneralSkeleton")
	ap = AnimationPlayer.new()
	mannequin.add_child(ap)
	ap.root_node = NodePath("..")
	ap.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
	ap.add_animation_library("", lib)
	hips = sk.find_bone("Hips")
	for i in sk.get_bone_count():
		var n := sk.get_bone_name(i)
		if n != "Root" and not n.contains("_leaf"):
			bones.append(i)
	for side in SIDES:
		legs[side] = LegIK.leg(sk, side)
	if mannequin.has_meta("lead"):
		# a lead model (build_leads.gd) carries its own sole points, found the same way from its mesh
		var sole: Dictionary = (mannequin.get_meta("lead") as Dictionary).sole
		for side in SIDES:
			heel[side] = sole[side + "Heel"]
			ball[side] = sole[side + "Ball"]
		foot_len = float(sole.len)
		ankle_flat = float(sole.ankle)
	else:
		# the sole under the heel and the ball, from the mesh in the rest pose (foot region of the look mesh)
		var mi := sk.get_node("Body") as MeshInstance3D
		var min_y := 1e9
		var min_z := 1e9
		for s in mi.mesh.get_surface_count():
			var arr := mi.mesh.surface_get_arrays(s)
			var pos: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
			var col: PackedColorArray = arr[Mesh.ARRAY_COLOR]
			for v in pos.size():
				if absf(col[v].r * 8.0 - 6.0) < 0.3:
					min_y = minf(min_y, pos[v].y)
					min_z = minf(min_z, pos[v].z)
		for side in SIDES:
			var l: PackedInt32Array = legs[side]
			var foot := sk.get_bone_global_rest(l[2])
			var toes := sk.get_bone_global_rest(l[3]).origin
			heel[side] = foot.affine_inverse() * Vector3(foot.origin.x, min_y, min_z + 0.03)
			ball[side] = foot.affine_inverse() * Vector3(toes.x, min_y, toes.z)
			foot_len = toes.z - (min_z + 0.03)
			ankle_flat = foot.origin.y - min_y
	reach = LegIK.reach(sk, legs["Left"])
	# the ground of the library's clips: the sole under the balls in the idle pose
	ground = clip_ground("Idle")


## The ground a clip stands on: the mean sole height under the balls at its start (a clip that stands still).
func clip_ground(clip: String) -> float:
	pose(clip, 0.0)
	var g := 0.0
	for side in SIDES:
		g += sole_points(side, sk.get_bone_global_pose(legs[side][2]))[1].y
	return g * 0.5


## Poses the skeleton from a clip at time t (bones the clip does not drive stand in the rest pose).
func pose(clip: String, t: float) -> void:
	if clip != _clip:
		_clip = clip
		sk.reset_bone_poses()
		ap.play(clip)
	var a := lib.get_animation(clip) if lib.has_animation(clip) else ap.get_animation(clip)
	ap.seek(fposmod(t, a.length) if a.loop_mode != Animation.LOOP_NONE else clampf(t, 0.0, a.length), true)


## The heel and ball sole points of a foot whose global transform is `foot`: [heel, ball].
func sole_points(side: String, foot: Transform3D) -> Array:
	return [foot * (heel[side] as Vector3), foot * (ball[side] as Vector3)]


## The leg as posed: the ankle, the foot's global basis and the local rotations of its four bones.
func leg_sample(side: String) -> Dictionary:
	var l: PackedInt32Array = legs[side]
	var f := sk.get_bone_global_pose(l[2])
	var rot := []
	for b in l:
		rot.append(sk.get_bone_pose_rotation(b))
	return {"ankle": f.origin, "basis": f.basis.orthonormalized(), "rot": rot}


func apply_leg(side: String, s: Dictionary) -> void:
	var l: PackedInt32Array = legs[side]
	for k in 4:
		sk.set_bone_pose_rotation(l[k], s.rot[k])


## Every tracked bone's local rotation and the hips' position and global basis.
func body_sample() -> Dictionary:
	var rot := []
	for b in bones:
		rot.append(sk.get_bone_pose_rotation(b))
	return {"rot": rot, "pos": sk.get_bone_pose_position(hips), "hips_basis": sk.get_bone_global_pose(hips).basis.orthonormalized()}


func apply_body(s: Dictionary) -> void:
	for k in bones.size():
		sk.set_bone_pose_rotation(bones[k], s.rot[k])
	sk.set_bone_pose_position(hips, s.pos)


## Scales the swing of the trunk bones (spine to head) about their mean rotation over the frames by `keep`.
func calm_trunk(frames: Array, keep: float) -> void:
	if keep >= 0.999:
		return
	for name in ["Spine", "Chest", "UpperChest", "Neck", "Head"]:
		var k := bones.find(sk.find_bone(name))
		if k < 0:
			continue
		var first: Quaternion = frames[0].rot[k]
		var sum := Vector4.ZERO
		for f in frames:
			var q: Quaternion = f.rot[k]
			if q.dot(first) < 0.0:
				q = -q
			sum += Vector4(q.x, q.y, q.z, q.w)
		var mean := Quaternion(sum.x, sum.y, sum.z, sum.w).normalized()
		for f in frames:
			f.rot[k] = mean.slerp(f.rot[k], keep)


## Body sample between two (the rotations slerped, the hips' position lerped).
func mix(a: Dictionary, b: Dictionary, w: float) -> Dictionary:
	var rot := []
	for k in bones.size():
		rot.append((a.rot[k] as Quaternion).slerp(b.rot[k], w))
	return {"rot": rot, "pos": (a.pos as Vector3).lerp(b.pos, w), "hips_basis": (a.hips_basis as Basis).slerp(b.hips_basis, w)}


## The ankle of a foot standing on the ground with the global basis `basis`, its ball over the ground coordinate `g`
## (the z of the ball joint when the foot is flat): the lower of the heel and the ball is the point on the ground, so
## a foot that lands on its heel rolls onto the ball and off its toes without sliding.
func planted_ankle(side: String, basis: Basis, x: float, g: float) -> Vector3:
	var rh: Vector3 = basis * (heel[side] as Vector3)
	var rb: Vector3 = basis * (ball[side] as Vector3)
	var on_ball := Vector3(x, ground - rb.y, g - rb.z)
	var on_heel := Vector3(x, ground - rh.y, g - foot_len - rh.z)
	# heel lower: on the heel; within a centimetre of level: a mix, so the hand over is smooth
	var w := smoothstep(-0.01, 0.01, rh.y - rb.y)
	return on_heel.lerp(on_ball, w)


## The lowest the ankle may be for the sole of a foot with this basis to stay on or over the ground.
func ankle_floor(side: String, basis: Basis) -> float:
	var rh: Vector3 = basis * (heel[side] as Vector3)
	var rb: Vector3 = basis * (ball[side] as Vector3)
	return ground - minf(rh.y, rb.y)


## Where the hip joint of a leg is with the hips at `pos` turned by `basis`.
func hip_joint(side: String, pos: Vector3, basis: Basis) -> Vector3:
	return pos + basis * sk.get_bone_rest(legs[side][0]).origin


## Puts both ankles on their targets with the given foot bases (IK) and answers the larger miss.
func plant(targets: Dictionary, bases: Dictionary) -> float:
	var miss := 0.0
	for side in SIDES:
		miss = maxf(miss, LegIK.solve(sk, legs[side], targets[side], bases[side], false, forward_knee))
	return miss


## The posed skeleton as a frame of a clip.
func snap() -> Dictionary:
	var rot := []
	for b in bones:
		rot.append(sk.get_bone_pose_rotation(b))
	return {"rot": rot, "pos": sk.get_bone_pose_position(hips)}


## An Animation of the frames, evenly spaced over `length`. A loop gets its first frame again as the last key.
func bake(frames: Array, length: float, loop: bool) -> Animation:
	var a := Animation.new()
	a.length = length
	a.step = 1.0 / fps
	a.loop_mode = Animation.LOOP_LINEAR if loop else Animation.LOOP_NONE
	var n := frames.size()
	var keys := n + 1 if loop else n
	var dt := length / float(n if loop else maxi(1, n - 1))
	var tp := a.add_track(Animation.TYPE_POSITION_3D)
	a.track_set_path(tp, NodePath("%GeneralSkeleton:Hips"))
	for i in keys:
		a.position_track_insert_key(tp, minf(length, i * dt), frames[i % n].pos)
	for k in bones.size():
		var tr := a.add_track(Animation.TYPE_ROTATION_3D)
		a.track_set_path(tr, NodePath("%GeneralSkeleton:" + sk.get_bone_name(bones[k])))
		# a bone that holds one rotation through the clip (the fingers) gets one key
		var first: Quaternion = frames[0].rot[k]
		var still := true
		for f in frames:
			if absf((f.rot[k] as Quaternion).dot(first)) < 0.9999995:
				still = false
				break
		if still:
			a.rotation_track_insert_key(tr, 0.0, first)
			continue
		var last := Quaternion.IDENTITY
		for i in keys:
			var q: Quaternion = frames[i % n].rot[k]
			if i > 0 and q.dot(last) < 0.0:
				q = -q
			last = q
			a.rotation_track_insert_key(tr, minf(length, i * dt), q)
	return a
