## Library clips retargeted onto a lead model whose rest stays as Mixamo delivered it (P2-068, offline: run by
## build_locomotion.gd -- lead <id>, which writes rig/clips_<id>.res; humanoid_anim.gd plays that file for the lead).
## Both skeletons share the profile's bone frames, so a clip played as it is turns each bone from the model's own rest
## by the clip's turn (rotation relative to rest in global space): the model keeps its own shoulders, spine and neck.
## Only the limbs are aimed: an image to 3D model stands with its legs apart and its knees a little in (Danny's thighs
## 7.6 degrees and shins 8.5 degrees off the mannequin's), and the clips' idle then straddles. For each limb bone b the
## turn Q(b) takes the model's bone direction (to its child, in b's rest frame) onto the mannequin's, and every key
## becomes T_local(b) = Q(parent)^-1 * S_local(b) * Q(b): the limb points where the mannequin's does and every bone
## frame below it is the mannequin's again (the foot lands flat, the hand turns as authored). Clavicles, spine and
## neck are never aimed: aiming the clavicles 38 to 47 degrees onto the mannequin's bulged the shoulders (P2-063).
extends RefCounted

## Limb bones aimed at the mannequin's direction, each with the child it points at.
const AIMED := [["LeftUpperLeg", "LeftLowerLeg"], ["LeftLowerLeg", "LeftFoot"], ["RightUpperLeg", "RightLowerLeg"],
	["RightLowerLeg", "RightFoot"], ["LeftUpperArm", "LeftLowerArm"], ["LeftLowerArm", "LeftHand"],
	["RightUpperArm", "RightLowerArm"], ["RightLowerArm", "RightHand"]]
const PREFIX := "%GeneralSkeleton:"


## The turn of each aimed bone (bone name -> Quaternion in its rest frame) and the degrees, from the model's
## skeleton `sk` and the mannequin's `man`.
static func aims(sk: Skeleton3D, man: Skeleton3D) -> Dictionary:
	var q := {}
	var deg := {}
	for pair in AIMED:
		var b := sk.find_bone(pair[0])
		var c := sk.find_bone(pair[1])
		var mc := man.find_bone(pair[1])
		if b < 0 or c < 0 or mc < 0:
			continue
		var d_lead := sk.get_bone_rest(c).origin.normalized()
		var d_man := man.get_bone_rest(mc).origin.normalized()
		if d_lead.angle_to(d_man) < 1e-4:
			continue
		q[pair[0]] = Quaternion(d_lead, d_man)
		deg[pair[0]] = snappedf(rad_to_deg(d_lead.angle_to(d_man)), 0.1)
	return {"q": q, "deg": deg}


## A copy of `lib` with every key of the aimed bones and their children turned (see above). Bones the clip leaves at
## rest but whose parent or self is aimed get a one key track, so they follow too.
static func retarget(lib: AnimationLibrary, sk: Skeleton3D, q: Dictionary) -> AnimationLibrary:
	var touched := {}
	for n in q:
		touched[n] = true
	for i in sk.get_bone_count():
		var p := sk.get_bone_parent(i)
		if p >= 0 and q.has(String(sk.get_bone_name(p))):
			touched[String(sk.get_bone_name(i))] = true
	var out := AnimationLibrary.new()
	for name in lib.get_animation_list():
		var a := lib.get_animation(name).duplicate(true) as Animation
		var has := {}
		for t in a.get_track_count():
			if a.track_get_type(t) != Animation.TYPE_ROTATION_3D:
				continue
			var bone := String(a.track_get_path(t)).trim_prefix(PREFIX)
			if not touched.has(bone):
				continue
			has[bone] = true
			var qb: Quaternion = q.get(bone, Quaternion.IDENTITY)
			var qp: Quaternion = q.get(_parent(sk, bone), Quaternion.IDENTITY)
			for k in a.track_get_key_count(t):
				var v: Quaternion = a.track_get_key_value(t, k)
				a.track_set_key_value(t, k, (qp.inverse() * v * qb).normalized())
		for bone in touched:
			if has.has(bone) or sk.find_bone(bone) < 0:
				continue
			var t := a.add_track(Animation.TYPE_ROTATION_3D)
			a.track_set_path(t, NodePath(PREFIX + bone))
			var rest := sk.get_bone_rest(sk.find_bone(bone)).basis.get_rotation_quaternion()
			var qb: Quaternion = q.get(bone, Quaternion.IDENTITY)
			var qp: Quaternion = q.get(_parent(sk, bone), Quaternion.IDENTITY)
			a.rotation_track_insert_key(t, 0.0, (qp.inverse() * rest * qb).normalized())
		out.add_animation(name, a)
	return out


static func _parent(sk: Skeleton3D, bone: String) -> String:
	var p := sk.get_bone_parent(sk.find_bone(bone))
	return String(sk.get_bone_name(p)) if p >= 0 else ""
