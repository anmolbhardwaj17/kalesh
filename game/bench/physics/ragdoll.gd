## A stand-in ragdoll for the combat test of the physics bench (P0-017, option CB1): a ten bone skeleton with one
## PhysicalBone3D per bone under a PhysicalBoneSimulator3D (capsules, cone joints at the neck, shoulders and hips,
## hinges at elbows and knees), 75 kg. Built in code the way the editor's "create physical skeleton" does it.
extends RefCounted

## name, parent, rest origin in the parent bone, tail (the bone's direction and length), capsule radius, joint, mass,
## and the up axis used to orient the bone's body (it sets the hinge axis).
const BONES := [
	["torso", -1, Vector3(0, 0.95, 0), Vector3(0, 0.55, 0), 0.14, "none", 35.0, Vector3(0, 0, 1)],
	["head", 0, Vector3(0, 0.57, 0), Vector3(0, 0.22, 0), 0.1, "cone", 5.0, Vector3(0, 0, 1)],
	["upper_arm_l", 0, Vector3(-0.2, 0.5, 0), Vector3(-0.28, 0, 0), 0.05, "cone", 2.5, Vector3(0, 1, 0)],
	["lower_arm_l", 2, Vector3(-0.28, 0, 0), Vector3(-0.26, 0, 0), 0.045, "hinge", 2.0, Vector3(0, 1, 0)],
	["upper_arm_r", 0, Vector3(0.2, 0.5, 0), Vector3(0.28, 0, 0), 0.05, "cone", 2.5, Vector3(0, 1, 0)],
	["lower_arm_r", 4, Vector3(0.28, 0, 0), Vector3(0.26, 0, 0), 0.045, "hinge", 2.0, Vector3(0, 1, 0)],
	["upper_leg_l", 0, Vector3(-0.1, 0, 0), Vector3(0, -0.42, 0), 0.07, "cone", 8.0, Vector3(1, 0, 0)],
	["lower_leg_l", 6, Vector3(0, -0.42, 0), Vector3(0, -0.45, 0), 0.06, "hinge", 5.0, Vector3(1, 0, 0)],
	["upper_leg_r", 0, Vector3(0.1, 0, 0), Vector3(0, -0.42, 0), 0.07, "cone", 8.0, Vector3(1, 0, 0)],
	["lower_leg_r", 8, Vector3(0, -0.42, 0), Vector3(0, -0.45, 0), 0.06, "hinge", 5.0, Vector3(1, 0, 0)],
]

var skeleton: Skeleton3D
var sim: PhysicalBoneSimulator3D
var bones: Array[PhysicalBone3D] = []


func build(color: Color, layer: int = 8, mask: int = 1) -> Skeleton3D:
	skeleton = Skeleton3D.new()
	for bone in BONES:
		var i := skeleton.add_bone(bone[0])
		if int(bone[1]) >= 0:
			skeleton.set_bone_parent(i, bone[1])
		skeleton.set_bone_rest(i, Transform3D(Basis(), bone[2]))
	skeleton.reset_bone_poses()
	sim = PhysicalBoneSimulator3D.new()
	sim.name = "Sim"
	skeleton.add_child(sim)
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	for bone in BONES:
		var tail: Vector3 = bone[3]
		var half := tail.length() * 0.5
		var radius: float = bone[4]
		var pb := PhysicalBone3D.new()
		pb.name = "PB_%s" % bone[0]
		pb.bone_name = bone[0]
		var body_xf := Transform3D(Basis.looking_at(tail, bone[7]), Vector3.ZERO)
		body_xf.origin = body_xf.basis * Vector3(0, 0, -half)
		pb.body_offset = body_xf
		pb.mass = bone[6]
		pb.collision_layer = layer
		pb.collision_mask = mask
		pb.can_sleep = true
		match str(bone[5]):
			"cone":
				pb.joint_type = PhysicalBone3D.JOINT_TYPE_CONE
				pb.joint_offset = Transform3D(Basis(), Vector3(0, 0, half))
				pb.set("joint_constraints/swing_span", 45.0)
				pb.set("joint_constraints/twist_span", 25.0)
			"hinge":
				pb.joint_type = PhysicalBone3D.JOINT_TYPE_HINGE
				# the hinge turns about the joint's Z: a quarter turn about X puts it across the bone
				pb.joint_offset = Transform3D(Basis(Vector3.RIGHT, PI * 0.5), Vector3(0, 0, half))
				pb.set("joint_constraints/angular_limit_enabled", true)
				pb.set("joint_constraints/angular_limit_upper", 70.0)
				pb.set("joint_constraints/angular_limit_lower", -70.0)
		var cs := CollisionShape3D.new()
		var cap := CapsuleShape3D.new()
		cap.radius = radius
		cap.height = maxf(half * 2.0, radius * 2.0 + 0.02)
		cs.shape = cap
		cs.transform = Transform3D(Basis(Vector3(1, 0, 0), Vector3(0, 0, 1), Vector3(0, -1, 0)), Vector3.ZERO)
		pb.add_child(cs)
		var mi := MeshInstance3D.new()
		var cm := CapsuleMesh.new()
		cm.radius = radius
		cm.height = cap.height
		cm.material = mat
		mi.mesh = cm
		mi.transform = cs.transform
		pb.add_child(mi)
		sim.add_child(pb)
		bones.append(pb)
	return skeleton


func start(push: Vector3) -> void:
	sim.physical_bones_start_simulation()
	for pb in bones:
		pb.linear_velocity = push


## The largest gap at any joint: how far a bone's joint point is from where its parent bone says it should be.
func joint_stretch() -> float:
	var worst := 0.0
	for i in BONES.size():
		var parent := int(BONES[i][1])
		if parent < 0:
			continue
		var pb := bones[i]
		var pp := bones[parent]
		var half := (BONES[i][3] as Vector3).length() * 0.5
		var mine := pb.global_transform * Vector3(0, 0, half)
		var parent_bone := pp.global_transform * pp.body_offset.affine_inverse()
		var theirs := parent_bone * (BONES[i][2] as Vector3)
		worst = maxf(worst, mine.distance_to(theirs))
	return worst
