## Two-bone leg IK on a Skeleton3D pose (P2-041): moves the ankle of a leg (upper leg, lower leg, foot) to a target
## and keeps the knee bending in the plane the animated pose already bends in, so a small change stays a small change.
## Used offline by the locomotion build (characters/tools/, feet planted on the ground of a clip) and at run time by
## the foot placement of body_feel.gd (feet on kerbs, stairs and slopes). All points and bases are in skeleton space.
extends RefCounted

## The leg never locks dead straight (a locked knee pops when the target moves away).
const MAX_EXT := 0.996


## Bone indices [upper leg, lower leg, foot, toes] of the "Left" or "Right" leg of the humanoid profile.
static func leg(sk: Skeleton3D, side: String) -> PackedInt32Array:
	return PackedInt32Array([sk.find_bone(side + "UpperLeg"), sk.find_bone(side + "LowerLeg"), sk.find_bone(side + "Foot"),
		sk.find_bone(side + "Toes")])


## Length of the leg from the hip joint to the ankle at full stretch (rest pose).
static func reach(sk: Skeleton3D, l: PackedInt32Array) -> float:
	var a := sk.get_bone_global_rest(l[0]).origin
	var b := sk.get_bone_global_rest(l[1]).origin
	var c := sk.get_bone_global_rest(l[2]).origin
	return a.distance_to(b) + b.distance_to(c)


## Puts the ankle at `target`. The foot keeps the global basis it has (`keep_foot`), or takes `foot_basis`. Answers how
## far the target was out of reach (0 when reached).
static func solve(sk: Skeleton3D, l: PackedInt32Array, target: Vector3, foot_basis := Basis.IDENTITY, keep_foot := true) -> float:
	var gu := sk.get_bone_global_pose(l[0])
	var gl := sk.get_bone_global_pose(l[1])
	var gf := sk.get_bone_global_pose(l[2])
	var a := gu.origin
	var b := gl.origin
	var c := gf.origin
	var l1 := a.distance_to(b)
	var l2 := b.distance_to(c)
	var to := target - a
	var want := to.length()
	var d := clampf(want, absf(l1 - l2) + 0.001, (l1 + l2) * MAX_EXT)
	var ab := (a - b) / l1
	var cb := (c - b) / l2
	var axis := ab.cross(cb)
	if axis.length_squared() < 1e-8:
		axis = gu.basis.x
	axis = axis.normalized()
	var th0 := acos(clampf(ab.dot(cb), -1.0, 1.0))
	var th1 := acos(clampf((l1 * l1 + l2 * l2 - d * d) / (2.0 * l1 * l2), -1.0, 1.0))
	var rk := Basis(axis, th1 - th0)
	var c1 := b + rk * (c - b)
	var from := (c1 - a).normalized()
	var dir := to / maxf(want, 1e-6)
	var rh := Basis.IDENTITY
	if from.dot(dir) < 0.999999:
		rh = Basis(Quaternion(from, dir))
	var nu := (rh * gu.basis).orthonormalized()
	var nl := (rh * rk * gl.basis).orthonormalized()
	var nf := gf.basis.orthonormalized() if keep_foot else foot_basis
	var pb := sk.get_bone_global_pose(sk.get_bone_parent(l[0])).basis.orthonormalized()
	sk.set_bone_pose_rotation(l[0], (pb.inverse() * nu).get_rotation_quaternion())
	sk.set_bone_pose_rotation(l[1], (nu.inverse() * nl).get_rotation_quaternion())
	sk.set_bone_pose_rotation(l[2], (nl.inverse() * nf).get_rotation_quaternion())
	return maxf(0.0, want - d)
