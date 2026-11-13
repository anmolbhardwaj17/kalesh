## Offline build of the humanoid stand-in (P1-023), run by tools/characters/ual_build.mjs (never by the game):
##   godot --headless --path game -s res://characters/tools/build_humanoid.gd
## Reads the Quaternius Universal Animation Library 1 and 2 (CC0), which the driver copies into the gitignored
## res://characters/ual_src/ with the import setting that retargets them to Godot's SkeletonProfileHumanoid
## (rig/ual_bone_map.tres: bones renamed to the profile, rests fixed, the skeleton named %GeneralSkeleton). Writes:
##   rig/ual_clips.res      AnimationLibrary of the clips the game uses, with metadata: "stride" (model metres a
##                          second of each moving loop, foot_contact.gd), "source" (library of each clip), "loops"
##   rig/mannequin_m.scn    the library's mannequin (UAL1) and the female mannequin (UAL2), each a Node3D with the
##   rig/mannequin_f.scn    %GeneralSkeleton and one skinned mesh whose vertices carry the look data of lead_look.gdshader:
##                          COLOR.r the body region (REGIONS / 8), CUSTOM0 the rest position (xyz) and the arm share (w)
extends SceneTree

const Contact := preload("res://characters/foot_contact.gd")

const SRC := "res://characters/ual_src/"
const OUT := "res://characters/rig/"
## Clip name in the library -> [source file, loops].
const CLIPS := {
	"Idle": ["ual1", true], "Walk": ["ual1", true], "Jog_Fwd": ["ual1", true], "Sprint": ["ual1", true],
	"Crouch_Idle": ["ual1", true], "Crouch_Fwd": ["ual1", true],
	"Jump_Start": ["ual1", false], "Jump": ["ual1", true], "Jump_Land": ["ual1", false],
	"Sitting_Enter": ["ual1", false], "Sitting_Idle": ["ual1", true], "Sitting_Exit": ["ual1", false],
	"Driving": ["ual1", true], "ClimbUp_1m": ["ual2", false],
}
## Moving loops whose stride speed is measured.
const STRIDE := ["Walk", "Jog_Fwd", "Sprint", "Crouch_Fwd"]
## Body regions by the bone a vertex follows most (lead_look.gdshader reads COLOR.r * 8).
const REGIONS := {"head": 0, "torso": 1, "hips": 2, "arm": 3, "hand": 4, "leg": 5, "foot": 6}

var _ran := false


func _process(_d: float) -> bool:
	if _ran:
		return false
	_ran = true
	var err := _build()
	if err != "":
		printerr("build_humanoid: ", err)
		quit(1)
	else:
		print("build_humanoid: ok")
		quit(0)
	return false


func _build() -> String:
	var sources := {}
	for s in ["ual1", "ual2", "mannequin_f"]:
		var ps := load(SRC + s + ".glb") as PackedScene
		if ps == null:
			return "missing %s%s.glb (run tools/characters/ual_build.mjs)" % [SRC, s]
		sources[s] = ps.instantiate()
	var lib := AnimationLibrary.new()
	var loops := {}
	var source := {}
	for name in CLIPS:
		var from: String = CLIPS[name][0]
		var ap := (sources[from] as Node).find_child("AnimationPlayer", true, false) as AnimationPlayer
		if not ap.has_animation(name):
			return "clip %s not in %s" % [name, from]
		var a := ap.get_animation(name).duplicate(true) as Animation
		a.loop_mode = Animation.LOOP_LINEAR if CLIPS[name][1] else Animation.LOOP_NONE
		lib.add_animation(name, a)
		loops[name] = CLIPS[name][1]
		source[name] = "Universal Animation Library %s (Quaternius, CC0)" % ("2" if from == "ual2" else "1")
	lib.set_meta("loops", loops)
	lib.set_meta("source", source)
	var m := _mannequin(sources["ual1"], "MannequinM")
	var f := _mannequin(sources["mannequin_f"], "MannequinF")
	lib.set_meta("stride", _strides(m, lib))
	var e := ResourceSaver.save(lib, OUT + "ual_clips.res", ResourceSaver.FLAG_COMPRESS)
	if e != OK:
		return "save clips: %d" % e
	for pair in [[m, "mannequin_m.scn"], [f, "mannequin_f.scn"]]:
		var ps := PackedScene.new()
		ps.pack(pair[0])
		e = ResourceSaver.save(ps, OUT + pair[1], ResourceSaver.FLAG_COMPRESS)
		if e != OK:
			return "save %s: %d" % [pair[1], e]
	print("stride ", lib.get_meta("stride"))
	for n in sources.values():
		n.free()
	m.free()
	f.free()
	return ""


## A clean scene of the mannequin: Node3D root, the %GeneralSkeleton (rest pose, profile bone names) and one skinned
## mesh with the look data. Nothing in it points back at the source .glb.
func _mannequin(src: Node, root_name: String) -> Node3D:
	var sk_src := src.find_child("GeneralSkeleton", true, false) as Skeleton3D
	var mi_src := sk_src.get_child(0) as MeshInstance3D
	var root := Node3D.new()
	root.name = root_name
	var sk := Skeleton3D.new()
	sk.name = "GeneralSkeleton"
	for i in sk_src.get_bone_count():
		sk.add_bone(sk_src.get_bone_name(i))
	for i in sk_src.get_bone_count():
		sk.set_bone_parent(i, sk_src.get_bone_parent(i))
		sk.set_bone_rest(i, sk_src.get_bone_rest(i))
	sk.reset_bone_poses()
	root.add_child(sk)
	sk.owner = root
	sk.unique_name_in_owner = true
	var mi := MeshInstance3D.new()
	mi.name = "Body"
	var skin := mi_src.skin.duplicate(true) as Skin
	mi.skin = skin
	mi.mesh = _look_mesh(mi_src.mesh, skin, sk)
	sk.add_child(mi)
	mi.owner = root
	mi.skeleton = NodePath("..")
	return root


func _region(bone: String) -> int:
	if bone in ["Head", "Neck", "Jaw", "LeftEye", "RightEye"]:
		return REGIONS.head
	if bone == "Hips":
		return REGIONS.hips
	if bone.ends_with("UpperArm") or bone.ends_with("LowerArm"):
		return REGIONS.arm
	if bone.ends_with("UpperLeg") or bone.ends_with("LowerLeg"):
		return REGIONS.leg
	if bone.ends_with("Foot") or bone.ends_with("Toes") or bone.begins_with("ball"):
		return REGIONS.foot
	for k in ["Hand", "Thumb", "Index", "Middle", "Ring", "Little", "thumb", "index", "middle", "ring", "pinky"]:
		if bone.contains(k):
			return REGIONS.hand
	return REGIONS.torso


## Both surfaces (body and joint rings) as one look mesh: same skinning, plus COLOR (region) and CUSTOM0 (rest
## position, arm share 0 at the shoulder joint to 1 at the wrist).
func _look_mesh(src: Mesh, skin: Skin, sk: Skeleton3D) -> ArrayMesh:
	var sh := absf(sk.get_bone_global_rest(sk.find_bone("LeftUpperArm")).origin.x)
	var wr := absf(sk.get_bone_global_rest(sk.find_bone("LeftHand")).origin.x)
	var out := ArrayMesh.new()
	for s in src.get_surface_count():
		var arr := src.surface_get_arrays(s)
		var pos: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
		var bones: PackedInt32Array = arr[Mesh.ARRAY_BONES]
		var weights: PackedFloat32Array = arr[Mesh.ARRAY_WEIGHTS]
		var per := bones.size() / pos.size()
		var col := PackedColorArray()
		col.resize(pos.size())
		var cust := PackedFloat32Array()
		cust.resize(pos.size() * 4)
		for v in pos.size():
			var best := 0
			for k in per:
				if weights[v * per + k] > weights[v * per + best]:
					best = k
			var bi := bones[v * per + best]
			var bname := skin.get_bind_name(bi)
			if bname == &"":
				bname = sk.get_bone_name(skin.get_bind_bone(bi))
			var r := _region(String(bname))
			col[v] = Color(float(r) / 8.0, 0.0, 0.0, 1.0)
			var p := pos[v]
			cust[v * 4] = p.x
			cust[v * 4 + 1] = p.y
			cust[v * 4 + 2] = p.z
			cust[v * 4 + 3] = clampf((absf(p.x) - sh) / (wr - sh), 0.0, 1.5) if r in [REGIONS.arm, REGIONS.hand] else 0.0
		arr[Mesh.ARRAY_COLOR] = col
		arr[Mesh.ARRAY_CUSTOM0] = cust
		var flags := Mesh.ARRAY_CUSTOM_RGBA_FLOAT << Mesh.ARRAY_FORMAT_CUSTOM0_SHIFT
		if per == 8:
			flags |= Mesh.ARRAY_FLAG_USE_8_BONE_WEIGHTS
		out.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr, [], {}, flags)
	return out


## Stride speed of each moving loop in model metres a second: the clip is played on the male mannequin and its balls
## sampled 240 times over one cycle (foot_contact.gd). The model faces +Z.
func _strides(m: Node3D, lib: AnimationLibrary) -> Dictionary:
	root.add_child(m)
	var ap := AnimationPlayer.new()
	m.add_child(ap)
	ap.root_node = NodePath("..")
	ap.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
	ap.add_animation_library("", lib)
	var sk := m.get_node("GeneralSkeleton") as Skeleton3D
	var lt := sk.find_bone("LeftToes")
	var rt := sk.find_bone("RightToes")
	var out := {}
	for name in STRIDE:
		var a := lib.get_animation(name)
		var n := 240
		var dt := a.length / n
		var l := PackedVector3Array()
		var r := PackedVector3Array()
		ap.play(name)
		for i in n + 1:
			ap.seek(i * dt, true)
			l.append(sk.get_bone_global_pose(lt).origin)
			r.append(sk.get_bone_global_pose(rt).origin)
		out[name] = snappedf(Contact.stance_speed(l, r, dt, Vector3(0, 0, 1)), 0.0001)
	ap.stop()
	m.remove_child(ap)
	ap.free()
	root.remove_child(m)
	return out
