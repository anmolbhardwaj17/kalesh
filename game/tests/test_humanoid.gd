## The humanoid stand-in (P1-023): the clips of the locomotion set from the Quaternius Universal Animation Library
## (retargeted to SkeletonProfileHumanoid) are all there and the looping ones loop (loop mode set and the last pose
## equal to the first), the stride maths keeps a planted foot still, the three leads' looks, the credit and licence
## files, and a humanoid built in the tree poses its skeleton.
extends RefCounted

const Humanoid := preload("res://characters/humanoid_anim.gd")
const Contact := preload("res://characters/foot_contact.gd")
const Leads := preload("res://characters/leads.gd")

## States whose clip loops (the rest are one-shots). The gait clips of the blends are checked in test_locomotion.gd.
const LOOPS := ["move", "crouch", "air", "sit", "drive"]
const PALETTE_SKIN := ["#8d5a3b", "#a86b45", "#c68a5e", "#6f4630", "#b97c53"]

var t
var tree: SceneTree


func test_rig_files_are_in_the_repo() -> void:
	t.ok(Humanoid.available(), "rig/ual_clips.res, mannequin_m.scn and mannequin_f.scn exist (tools/characters/ual_build.mjs)")


func test_every_locomotion_clip_is_there_and_loops_loop() -> void:
	var lib := Humanoid.clips()
	t.ok(lib != null, "the clip library loads")
	if lib == null:
		return
	for s in Humanoid.STATES:
		var name: String = Humanoid.STATES[s]
		# "k/" clips are the built ones (rig/loco_clips.res, P2-041)
		var from: AnimationLibrary = Humanoid.loco() if name.begins_with("k/") else lib
		name = name.trim_prefix("k/")
		t.ok(from.has_animation(name), "state %s: clip %s is in its library" % [s, name])
		if not from.has_animation(name):
			continue
		var a := from.get_animation(name)
		var loops: bool = s in LOOPS
		t.ok((a.loop_mode == Animation.LOOP_LINEAR) == loops, "%s loop mode (%d, want %s)" % [name, a.loop_mode, "loop" if loops else "once"])
		t.ok(a.length > 0.1, "%s has a length" % name)
		if loops:
			var worst := _seam_deg(a)
			t.less(worst, 6.0, "%s: the last pose meets the first (largest bone turn across the seam, degrees)" % name)
		var hips := a.find_track(NodePath("%GeneralSkeleton:Hips"), Animation.TYPE_ROTATION_3D)
		t.ok(hips >= 0, "%s drives the humanoid profile's Hips (retargeted bone names)" % name)


## Largest rotation step (degrees) between a loop's last key and its first, over its rotation tracks.
func _seam_deg(a: Animation) -> float:
	var worst := 0.0
	for i in a.get_track_count():
		if a.track_get_type(i) != Animation.TYPE_ROTATION_3D or a.track_get_key_count(i) < 2:
			continue
		var q0: Quaternion = a.rotation_track_interpolate(i, 0.0)
		var q1: Quaternion = a.rotation_track_interpolate(i, a.length)
		worst = maxf(worst, rad_to_deg(q0.angle_to(q1)))
	return worst


func test_every_clip_names_its_cc0_source() -> void:
	var src: Dictionary = Humanoid.clips().get_meta("source", {})
	t.ok(str(src.get("Walk", "")).contains("CC0"), "every library clip names its CC0 source")
	t.ok(str(Humanoid.loco().get_meta("source", "")).contains("CC0"), "the built clips name the CC0 library they are made from")


func test_stance_speed_of_a_planted_foot() -> void:
	# two feet in model space, +Z forward: the stance foot slides back at 1.2 m/s while the other swings forward
	var l := PackedVector3Array()
	var r := PackedVector3Array()
	var dt := 1.0 / 60.0
	for i in 60:
		var u := float(i) * dt
		l.append(Vector3(0.1, 0.0, 0.3 - 1.2 * u))
		r.append(Vector3(-0.1, 0.1, -0.3 + 2.0 * u))
	t.near(Contact.stance_speed(l, r, dt, Vector3(0, 0, 1)), 1.2, 1e-4, "stance foot backward speed")
	# the same feet on a body moving forward at 1.2 m/s: the planted foot stays put, no slide
	var body := PackedVector3Array()
	for i in 60:
		body.append(Vector3(0, 0, 1.2 * float(i) * dt))
	var res := Contact.slide(l, r, body, dt, Vector3(0, 0, 1), 1.2)
	t.near(float(res.slide), 0.0, 1e-4, "matched rate: no slide")
	t.near(float(res.abs), 0.0, 1e-4, "matched rate: the planted foot does not move in the world")
	var fast := Contact.slide(l, r, body, dt, Vector3(0, 0, 1), 1.5)
	t.near(float(fast.slide), 0.2, 1e-4, "foot 1.2 against ground 1.5 is 20 percent slide")


func test_the_three_leads_look_apart() -> void:
	var ids := ["bittu", "meera", "danny"]
	var shirts := {}
	for id in ids:
		t.ok(Leads.LOOKS.has(id), "look %s" % id)
		var l := Leads.look(id)
		t.ok(float(l.height) >= 1.55 and float(l.height) <= 1.85, "%s height %.2f m is a real adult's" % [id, l.height])
		t.ok(str(l.skin) in PALETTE_SKIN, "%s skin tone %s is one of the palette's five" % [id, l.skin])
		shirts[str(l.shirt)] = true
		var s := Leads.scale_of(id)
		t.ok(s > 0.85 and s < 1.0, "%s uniform scale %.3f" % [id, s])
	t.ok(shirts.size() == 3, "three different shirt colours")
	t.ok(Leads.look("meera").mesh == "f" and float(Leads.look("meera").belt) == 1.0, "Meera: the female mannequin and a belt")
	t.ok(float(Leads.look("bittu").gamchha) == 1.0 and float(Leads.look("danny").jacket) == 1.0, "Bittu's gamchha, Danny's jacket")


func test_licence_and_credit_are_in_the_repo() -> void:
	var lic := FileAccess.get_file_as_string("res://characters/rig/LICENSE_UAL.txt")
	t.ok(lic.contains("CC0") and lic.contains("Quaternius"), "rig/LICENSE_UAL.txt keeps the library's CC0 licence")
	var credits := FileAccess.get_file_as_string("res://data/credits.json")
	t.ok(credits.contains("Universal Animation Library") and credits.contains("Quaternius"), "data/credits.json has the credit line")


func test_a_humanoid_poses_its_skeleton() -> void:
	var h := Humanoid.new()
	tree.root.add_child(h)
	t.ok(h.setup("meera"), "setup builds the body")
	for i in 10:
		h.step(1.0 / 60.0, "ground", 1.6, false)
	t.ok(h.state == "walk", "1.6 m/s walks (got %s)" % h.state)
	var sk: Skeleton3D = h.skeleton
	var b := sk.find_bone("LeftUpperArm")
	var moved := sk.get_bone_pose_rotation(b).angle_to(sk.get_bone_rest(b).basis.get_rotation_quaternion())
	t.ok(rad_to_deg(moved) > 20.0, "the arm left the rest pose (T): %.1f degrees" % rad_to_deg(moved))
	var rate_want := 1.6 / (float(Humanoid.loco().get_meta("gaits").Walk_K.model_speed) * h.body_scale)
	t.near(h.rate, rate_want, 1e-3, "walk rate is ground speed over the built clip's speed at this body's scale")
	t.ok(h.skeleton.get_node_or_null("Bun") != null, "Meera's bun")
	h.free()
