## Offline build of the Mixamo clips (P2-072), run by tools/characters/mixamo_build.mjs (never by the game):
##   godot --headless --path game -s res://characters/tools/build_mixamo.gd -- library
##       every imported clip of characters/mixamo_src (list.json) into rig/mixamo/<category>.res and data/mixamo_clips.json
##   godot --headless --path game -s res://characters/tools/build_mixamo.gd -- leads [ids]
##       the per-lead set rig/mx_<id>.res from data/mixamo_picks.json (mixamo_lead.gd)
## The clips arrive retargeted to SkeletonProfileHumanoid by the import (rig/mixamo_bone_map.tres, overwrite axis rest
## fix, no silhouette fix: the same frames as the lead models, so a clip turns each bone from its rest as Mixamo shows).
## The hips position is normalised to hip heights by the import (the source skeleton's hips stand 1.0 high at rest).
## This step: keeps the rotation tracks and the hips position only; moves root motion (a clip whose hips travel more
## than ROOT_MIN over the ground from its first key to its last) from the hips onto the profile's Root bone, so the hips keep the clip's first ground
## position and a consumer reads the travel from Root (AnimationTree.root_motion_track); sets the loop flag where the
## last pose is the first; records the source skeleton's bone offsets (the limb directions the leads are aimed at).
extends SceneTree

const MixLead := preload("res://characters/tools/mixamo_lead.gd")
const LIST := "res://characters/mixamo_src/list.json"
const SRC := "res://characters/mixamo_src/%s/%s.fbx"
const OUT := "res://characters/rig/mixamo/%s.res"
const INDEX := "res://data/mixamo_clips.json"
const P := "%GeneralSkeleton:"
## The last pose within this of the first (every body bone, degrees) and the hips back where they started: a loop.
const LOOP_DEG := 7.0
const LOOP_POS := 0.03
## Hip heights of travel over the ground that make a clip a root motion clip.
const ROOT_MIN := 0.12
const BODY_SKIP := ["Thumb", "Index", "Middle", "Ring", "Little"]

var _ran := false


func _process(_d: float) -> bool:
	if _ran:
		return false
	_ran = true
	var args := OS.get_cmdline_user_args()
	var err := ""
	if args.size() >= 1 and args[0] == "leads":
		err = MixLead.build_all(root, args.slice(1))
	else:
		err = _library()
	if err != "":
		printerr("build_mixamo: ", err)
		quit(1)
	else:
		print("build_mixamo: ok")
		quit(0)
	return false


func _library() -> String:
	var f := FileAccess.open(LIST, FileAccess.READ)
	if f == null:
		return "no %s (run tools/characters/mixamo_build.mjs)" % LIST
	var list: Array = JSON.parse_string(f.get_as_text())
	var libs := {}
	var clips := []
	var source := {}
	for c in list:
		var path := SRC % [c.category, c.name]
		var ps := load(path) as PackedScene
		if ps == null:
			return "cannot load " + path
		var scene := ps.instantiate()
		var ap := scene.find_child("AnimationPlayer", true, false) as AnimationPlayer
		var sk := scene.find_child("GeneralSkeleton", true, false) as Skeleton3D
		if ap == null or sk == null:
			scene.free()
			return "%s: no AnimationPlayer or GeneralSkeleton (bone map not applied?)" % path
		if source.is_empty():
			source = _source(sk)
		elif absf(float(source.motion_scale) - sk.motion_scale) > 0.002:
			print("build_mixamo: %s has another source skeleton (hips %.4f, first %.4f)" % [c.name, sk.motion_scale, source.motion_scale])
		var src: Animation = null
		for ln in ap.get_animation_library_list():
			var l := ap.get_animation_library(ln)
			for an in l.get_animation_list():
				if src == null and an != "RESET":
					src = l.get_animation(an)
		if src == null:
			scene.free()
			return "%s: no animation" % path
		var r := clean(src)
		scene.free()
		var a: Animation = r.anim
		if not libs.has(c.category):
			libs[c.category] = AnimationLibrary.new()
		(libs[c.category] as AnimationLibrary).add_animation(StringName(c.name), a)
		clips.append({"name": c.name, "category": c.category, "file": c.file, "length": snappedf(a.length, 0.001),
			"loop": a.loop_mode == Animation.LOOP_LINEAR, "root_m": r.root_m, "turn_deg": r.turn_deg, "loop_deg": r.loop_deg,
			"tracks": a.get_track_count()})
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://characters/rig/mixamo"))
	var total := 0
	for cat in libs:
		var lib: AnimationLibrary = libs[cat]
		lib.set_meta("source", "Mixamo (Adobe), downloaded with the owner's account; converted by characters/tools/build_mixamo.gd")
		var e := ResourceSaver.save(lib, OUT % cat, ResourceSaver.FLAG_COMPRESS)
		if e != OK:
			return "save %s: %d" % [OUT % cat, e]
		var size := FileAccess.get_file_as_bytes(OUT % cat).size()
		total += size
		print("lib %s: %d clips, %.2f MB" % [cat, lib.get_animation_list().size(), size / 1e6])
	var idx := {"source": source, "count": clips.size(), "clips": clips,
		"note": "Mixamo clips converted by tools/characters/mixamo_build.mjs (P2-072). Raw FBX stay in assets_inbox/mixamo (gitignored)."}
	var o := FileAccess.open(INDEX, FileAccess.WRITE)
	o.store_string(JSON.stringify(idx, " ", false) + "\n")
	o.close()
	print("build_mixamo: %d clips in %d libraries, %.2f MB" % [clips.size(), libs.size(), total / 1e6])
	return ""


## The source skeleton: its hip height (motion scale) and every bone's rest offset from its parent (local, in the
## shared profile frames), for aiming a lead's limbs at the source's directions.
static func _source(sk: Skeleton3D) -> Dictionary:
	var off := {}
	for i in sk.get_bone_count():
		var o := sk.get_bone_rest(i).origin
		off[String(sk.get_bone_name(i))] = [snappedf(o.x, 1e-6), snappedf(o.y, 1e-6), snappedf(o.z, 1e-6)]
	return {"motion_scale": snappedf(sk.motion_scale, 1e-6), "offsets": off}


## A clean copy of an imported clip: rotation tracks and the hips position only, root motion on Root, loop flag.
## Answers {anim, root_m, turn_deg, loop_deg}.
static func clean(src: Animation) -> Dictionary:
	var a := Animation.new()
	a.length = src.length
	var hp := -1
	for t in src.get_track_count():
		var path := String(src.track_get_path(t))
		if not path.begins_with(P):
			continue
		var bone := path.trim_prefix(P)
		var ty := src.track_get_type(t)
		if ty == Animation.TYPE_ROTATION_3D:
			var n := a.add_track(Animation.TYPE_ROTATION_3D)
			a.track_set_path(n, NodePath(path))
			for k in src.track_get_key_count(t):
				a.rotation_track_insert_key(n, src.track_get_key_time(t, k), src.track_get_key_value(t, k))
		elif ty == Animation.TYPE_POSITION_3D and bone == "Hips":
			hp = a.add_track(Animation.TYPE_POSITION_3D)
			a.track_set_path(hp, NodePath(path))
			for k in src.track_get_key_count(t):
				a.position_track_insert_key(hp, src.track_get_key_time(t, k), src.track_get_key_value(t, k))
	var root_m := 0.0
	if hp >= 0 and a.track_get_key_count(hp) > 1:
		var p0: Vector3 = a.track_get_key_value(hp, 0)
		var n := a.track_get_key_count(hp)
		# the travel from the first key to the last (an idle's sway of up to 18 cm comes back: no root motion)
		var pl: Vector3 = a.track_get_key_value(hp, n - 1)
		root_m = Vector2(pl.x - p0.x, pl.z - p0.z).length()
		if root_m > ROOT_MIN:
			var rt := a.add_track(Animation.TYPE_POSITION_3D)
			a.track_set_path(rt, NodePath(P + "Root"))
			# a cycle that travels (Mixamo's sprint has no in place version) moves its Root at a steady speed and
			# its hips keep their sway about it, so dropping Root leaves an in-place cycle; a one-shot hands Root all
			# of the hips' travel
			var cyclic := _rot_gap(a) < LOOP_DEG
			var tl := a.track_get_key_time(hp, n - 1)
			for k in n:
				var p: Vector3 = a.track_get_key_value(hp, k)
				var tm := a.track_get_key_time(hp, k)
				var r := Vector3(p.x - p0.x, 0.0, p.z - p0.z)
				if cyclic:
					r = Vector3(pl.x - p0.x, 0.0, pl.z - p0.z) * (tm / maxf(tl, 1e-3))
				a.position_track_insert_key(rt, tm, r)
				a.track_set_key_value(hp, k, Vector3(p.x - r.x, p.y, p.z - r.z))
	# the turn of the hips about up from the first key to the last (degrees, + to the left)
	var turn := 0.0
	var hr := a.find_track(NodePath(P + "Hips"), Animation.TYPE_ROTATION_3D)
	if hr >= 0 and a.track_get_key_count(hr) > 1:
		var q0: Quaternion = a.track_get_key_value(hr, 0)
		var q1: Quaternion = a.track_get_key_value(hr, a.track_get_key_count(hr) - 1)
		var f0 := Basis(q0) * Vector3.BACK
		var f1 := Basis(q1) * Vector3.BACK
		turn = wrapf(rad_to_deg(atan2(f1.x, f1.z) - atan2(f0.x, f0.z)), -180.0, 180.0)
	# a loop: every body bone's last rotation within LOOP_DEG of its first, the hips at the same height and place
	var worst := 0.0
	for t in a.get_track_count():
		var path := String(a.track_get_path(t))
		if BODY_SKIP.any(func(s): return path.contains(s)) or a.track_get_key_count(t) < 2:
			continue
		var last := a.track_get_key_count(t) - 1
		if a.track_get_type(t) == Animation.TYPE_ROTATION_3D:
			var q0: Quaternion = a.track_get_key_value(t, 0)
			var q1: Quaternion = a.track_get_key_value(t, last)
			worst = maxf(worst, rad_to_deg(q0.angle_to(q1)))
		elif path.ends_with(":Hips"):
			var d: Vector3 = (a.track_get_key_value(t, last) as Vector3) - (a.track_get_key_value(t, 0) as Vector3)
			if d.length() > LOOP_POS:
				worst = maxf(worst, 999.0)
	if worst < LOOP_DEG and a.length > 0.4 and absf(turn) < 20.0:
		a.loop_mode = Animation.LOOP_LINEAR
	return {"anim": a, "root_m": snappedf(root_m, 0.001), "turn_deg": snappedf(turn, 0.1), "loop_deg": snappedf(worst, 0.1)}


## The largest turn of a body bone (fingers left out) between a clip's first key and its last (degrees).
static func _rot_gap(a: Animation) -> float:
	var worst := 0.0
	for t in a.get_track_count():
		var path := String(a.track_get_path(t))
		if a.track_get_type(t) != Animation.TYPE_ROTATION_3D or a.track_get_key_count(t) < 2 or BODY_SKIP.any(func(s): return path.contains(s)):
			continue
		var q0: Quaternion = a.track_get_key_value(t, 0)
		var q1: Quaternion = a.track_get_key_value(t, a.track_get_key_count(t) - 1)
		worst = maxf(worst, rad_to_deg(q0.angle_to(q1)))
	return worst
