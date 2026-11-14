## The Mixamo clips of the leads (P2-072): all 161 clips the owner downloaded are in the game's libraries by name
## (data/mixamo_clips.json lists them, rig/mixamo/<category>.res holds them), loop flags fit the clips, the picks name
## real clips, each lead's set (rig/mx_<id>.res) has its Mixamo idle and gaits, the layer clips and the gait numbers,
## and a lead built in the tree plays them with its layers (upper body, flinch, aim) working.
extends RefCounted

const Mixamo := preload("res://characters/mixamo.gd")
const Humanoid := preload("res://characters/humanoid_anim.gd")
const Layers := preload("res://characters/anim_layers.gd")
const MixLead := preload("res://characters/tools/mixamo_lead.gd")
const COUNT := 161
const LEADS := ["bittu", "meera", "danny"]

var t
var tree: SceneTree


func test_every_clip_is_listed_by_name_and_loads() -> void:
	var idx := Mixamo.index()
	var names := Mixamo.names()
	t.ok(int(idx.get("count", 0)) == COUNT and names.size() == COUNT, "%d clips listed (want %d)" % [names.size(), COUNT])
	var seen := {}
	var missing := []
	for n in names:
		seen[n] = true
		var a := Mixamo.clip(n)
		if a == null or a.length <= 0.0 or a.get_track_count() < 20:
			missing.append(n)
	t.ok(seen.size() == names.size(), "clip names are unique")
	t.ok(missing.is_empty(), "every listed clip loads from its category library with its tracks (missing: %s)" % [missing])
	print("mixamo clips: ", ", ".join(names))


func test_loop_flags_and_root_motion() -> void:
	var bad := []
	for c in Mixamo.index().clips:
		var a := Mixamo.clip(c.name)
		if a == null:
			continue
		if (a.loop_mode == Animation.LOOP_LINEAR) != bool(c.loop):
			bad.append(c.name)
		var has_root := a.find_track(NodePath("%GeneralSkeleton:Root"), Animation.TYPE_POSITION_3D) >= 0
		if has_root != (float(c.root_m) > 0.12):
			bad.append(c.name + " (root)")
	t.ok(bad.is_empty(), "loop flags and root tracks match the index (%s)" % [bad])
	for n in ["walking", "female_walk", "breathing_idle", "slow_run", "sprint"]:
		t.ok(bool(Mixamo.info(n).get("loop", false)), "%s loops" % n)
	for n in ["start_walking", "stop_walking", "left_turn", "climbing_to_top", "vault_over_box"]:
		t.ok(not bool(Mixamo.info(n).get("loop", true)), "%s plays once" % n)
	t.ok(Mixamo.clip("sprint").find_track(NodePath("%GeneralSkeleton:Root"), Animation.TYPE_POSITION_3D) >= 0, "the sprint's travel is on Root")


func test_only_converted_resources_are_in_the_rig() -> void:
	var files := DirAccess.get_files_at("res://characters/rig/mixamo")
	t.ok(files.size() == Mixamo.categories().size(), "one library per category (%d files)" % files.size())
	for f in files:
		t.ok(f.ends_with(".res"), "rig/mixamo holds converted resources only (%s)" % f)


func test_picks_name_real_clips() -> void:
	var picks: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(MixLead.PICKS))
	for id in LEADS:
		t.ok(picks.leads.has(id), "picks for " + id)
		for role in ["idle", "walk", "jog", "run", "start", "stop", "turn_l"]:
			t.ok(picks.leads[id].has(role), "%s has a %s pick" % [id, role])
		for role in picks.leads[id]:
			var v: Variant = picks.leads[id][role]
			var parts: Array = v.values().filter(func(x): return x is String) if v is Dictionary else [v]
			for p in parts:
				t.ok(not Mixamo.info(str(p)).is_empty(), "%s %s: clip %s exists" % [id, role, p])


func test_each_lead_set_has_its_mixamo_gaits_and_layer_clips() -> void:
	for id in LEADS:
		var lib := Humanoid.lead_loco(id)
		t.ok(lib != null and ResourceLoader.exists(Humanoid.LEAD_MX_PATH % id), "%s plays rig/mx_%s.res" % [id, id])
		if lib == null:
			continue
		var gaits: Dictionary = lib.get_meta("gaits", {})
		for g in ["Walk_K", "Jog_K", "Sprint_K"]:
			var m: Dictionary = gaits.get(g, {})
			t.ok(str(m.get("source", "")).begins_with("mixamo:"), "%s %s is a Mixamo gait (%s)" % [id, g, m.get("source", "")])
			t.ok(lib.has_animation(g) and lib.get_animation(g).loop_mode == Animation.LOOP_LINEAR, "%s %s loops" % [id, g])
			t.near(lib.get_animation(g).length, float(m.get("cycle_s", 0.0)), 0.02, "%s %s lasts one cycle" % [id, g])
			var rate := float(m.get("rate_at_speed", 0.0))
			t.ok(rate >= 0.9 and rate <= 1.2, "%s %s plays at %.3f at the game's speed (0.9 to 1.2)" % [id, g, rate])
		t.ok(lib.has_animation("Idle") and lib.get_animation("Idle").loop_mode == Animation.LOOP_LINEAR, "%s has its own looping Idle" % id)
		t.ok(Layers.supported(lib), "%s has the layer clips" % id)
		for c in ["Up_Pistol", "Up_Phone", "Up_Text", "Up_Carry", "Up_Wave", "Add_Head", "Add_Body", "Mx_Start", "Mx_Stop", "Mx_Turn_L", "Mx_Turn_R"]:
			t.ok(lib.has_animation(c), "%s has %s" % [id, c])
		# the moves the motor plays stay the built ones (fitted to its speed ramps)
		for c in ["Start", "Stop_L", "Stop_R", "Turn_L", "Turn_R", "Crouch_K"]:
			t.ok(lib.has_animation(c), "%s keeps the built %s" % [id, c])


func test_mirror_turns_a_left_turn_right() -> void:
	var lib := Humanoid.lead_loco("bittu")
	if lib == null or not lib.has_animation("Mx_Turn_L"):
		t.ok(false, "Mx_Turn_L in mx_bittu.res")
		return
	var l := lib.get_animation("Mx_Turn_L")
	var r := lib.get_animation("Mx_Turn_R")
	var yaw := func(a: Animation) -> float:
		var tr := a.find_track(NodePath("%GeneralSkeleton:Hips"), Animation.TYPE_ROTATION_3D)
		var f := Basis(a.rotation_track_interpolate(tr, a.length)) * Vector3.BACK
		return rad_to_deg(atan2(f.x, f.z))
	t.ok(yaw.call(l) > 60.0 and yaw.call(r) < -60.0, "the left turn ends turned left (%.0f), the mirror right (%.0f)" % [yaw.call(l), yaw.call(r)])


func test_a_lead_body_plays_mixamo_with_layers() -> void:
	var h := Humanoid.new()
	tree.root.add_child(h)
	t.ok(h.setup("meera"), "Meera's body builds")
	t.ok(h.layers != null, "her body has the layers")
	if h.layers == null:
		tree.root.remove_child(h)
		h.free()
		return
	t.ok(h.clip() == "k/Idle", "standing still plays her Mixamo idle (%s)" % h.clip())
	var sk := h.skeleton
	var arm := sk.find_bone("RightUpperArm")
	var leg := sk.find_bone("LeftUpperLeg")
	for i in 30:
		h.step(1.0 / 60.0, "ground", 0.0, false, "")
	var arm0 := sk.get_bone_pose_rotation(arm)
	var leg0 := sk.get_bone_pose_rotation(leg)
	t.ok(h.upper("pistol"), "pistol aim starts")
	for i in 30:
		h.step(1.0 / 60.0, "ground", 0.0, false, "")
	t.ok(rad_to_deg(arm0.angle_to(sk.get_bone_pose_rotation(arm))) > 20.0, "the upper layer moves the arm (%.1f deg)" % rad_to_deg(arm0.angle_to(sk.get_bone_pose_rotation(arm))))
	t.less(rad_to_deg(leg0.angle_to(sk.get_bone_pose_rotation(leg))), 8.0, "and leaves the legs to the locomotion")
	var chest := sk.find_bone("UpperChest")
	h.aim(true, deg_to_rad(40.0), 0.0)
	var before := sk.get_bone_global_pose(chest).basis * Vector3.BACK
	for i in 60:
		h.step(1.0 / 60.0, "ground", 0.0, false, "")
	var after := sk.get_bone_global_pose(chest).basis * Vector3.BACK
	var turned := rad_to_deg(atan2(after.x, after.z) - atan2(before.x, before.z))
	t.ok(turned > 25.0 and turned < 55.0, "the aim turns the chest 40 degrees left (%.1f)" % turned)
	t.ok(h.flinch("head", 1.0), "a head flinch starts")
	for i in 4:
		h.step(1.0 / 60.0, "ground", 0.0, false, "")
	t.ok(h.layers.flinch_amount > 0.3, "the flinch is laid over (%.2f)" % h.layers.flinch_amount)
	for i in 80:
		h.step(1.0 / 60.0, "ground", 0.0, false, "")
	t.ok(h.layers.flinch_amount == 0.0, "and fades out")
	h.upper("")
	for i in 30:
		h.step(1.0 / 60.0, "ground", 0.0, false, "")
	t.ok(h.layers.upper_w == 0.0 and h.layers.upper_action == "", "the upper layer clears")
	# freed now, not at the end of the frame: a later suite counts the engine's objects
	tree.root.remove_child(h)
	h.free()
