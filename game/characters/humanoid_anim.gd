## The humanoid body of a character (P1-023, TECH.md "Characters, crowds and navigation (N1, AN2, AL1)"): a mannequin
## of the Quaternius Universal Animation Library (CC0, retargeted to Godot's SkeletonProfileHumanoid, rig/), dressed as
## one of the three leads (leads.gd, rig/lead_look.gdshader), animated by an AnimationTree:
##   idle, walk, jog, sprint            by ground speed; the clip's rate is ground speed / (its stride x the body's
##                                      scale), so the planted foot stays put (foot_contact.gd, under 5 percent slide)
##   crouch_idle, crouch_walk           crouched, still or moving
##   air, land                          in the air (the library's jump loop), a short landing on touch down
##   vault                              the library's 1 m climb up, fitted to the vault's 0.6 s (stand-in: the free
##                                      library has no vault; art request model_anim_vault)
##   sit_enter, sit, sit_exit, drive    getting into and out of a vehicle seat, sitting, driving (stand-ins for the
##                                      auto seat and the scooter ride: art requests model_anim_auto_seat and
##                                      model_anim_scooter_ride)
## Every state is an input of one AnimationNodeTransition (cross fade XFADE) followed by a TimeScale. The tree is
## advanced by step() on the sim tick (the owner calls it), never by itself, so the time scale and the sim hold reach
## it; its cost (advance and bone update) is measured per tick. The capsule of on_foot.gd stays the collision shape;
## this node only draws. The model faces +Z, so it is turned half a turn to face the character's -Z.
extends Node3D

const Leads := preload("res://characters/leads.gd")
const CLIPS_PATH := "res://characters/rig/ual_clips.res"
const SHADER_PATH := "res://characters/rig/lead_look.gdshader"
const MESH_PATH := {"m": "res://characters/rig/mannequin_m.scn", "f": "res://characters/rig/mannequin_f.scn"}
## State -> clip of the library.
const STATES := {
	"idle": "Idle", "walk": "Walk", "jog": "Jog_Fwd", "sprint": "Sprint",
	"crouch_idle": "Crouch_Idle", "crouch_walk": "Crouch_Fwd",
	"air": "Jump", "land": "Jump_Land", "vault": "ClimbUp_1m",
	"sit_enter": "Sitting_Enter", "sit": "Sitting_Idle", "sit_exit": "Sitting_Exit", "drive": "Driving",
}
## Moving states and the clip whose stride sets their rate.
const STRIDE_OF := {"walk": "Walk", "jog": "Jog_Fwd", "sprint": "Sprint", "crouch_walk": "Crouch_Fwd"}
## Ground speeds (m/s) between walk and jog and between jog and sprint: halfway between GAME.md's gait speeds.
const WALK_JOG := 2.7
const JOG_SPRINT := 5.15
const STILL := 0.15
const XFADE := 0.15
## Rate limits of a moving clip while the speed ramps (outside them the feet may slide for a moment).
const RATE_MIN := 0.5
const RATE_MAX := 2.4
## The landing plays this long at LAND_RATE, then the body goes back to its gait.
const LAND_S := 0.25
const LAND_RATE := 1.6
## One-shots fitted to a length: seconds of the clip used (from its start).
const SHOT_PART := {"vault": 0.6, "sit_enter": 1.0, "sit_exit": 0.9}

static var _clips: AnimationLibrary
static var _meshes := {}
static var _shader: Shader

var look_id := "bittu"
var body_scale := 1.0
var tree: AnimationTree
var skeleton: Skeleton3D
var state := "idle"
var rate := 1.0
## Cost of the last ticks (advance plus bone update), microseconds.
var us_ring := PackedInt32Array()
var ticks := 0

var _model: Node3D
var _shot := ""
var _shot_left := 0.0
var _was_air := false
var _lt := -1
var _rt := -1


## True when the rig files are in the repo (tools/characters/ual_build.mjs wrote them); else the capsule stays.
static func available() -> bool:
	return ResourceLoader.exists(CLIPS_PATH) and ResourceLoader.exists(MESH_PATH.m) and ResourceLoader.exists(MESH_PATH.f)


static func clips() -> AnimationLibrary:
	if _clips == null:
		_clips = load(CLIPS_PATH)
	return _clips


## Builds the body for a look; false when the rig files are missing.
func setup(id: String) -> bool:
	if not available():
		return false
	look_id = id if Leads.LOOKS.has(id) else "bittu"
	var look := Leads.look(look_id)
	var kind: String = look["mesh"]
	if not _meshes.has(kind):
		_meshes[kind] = load(MESH_PATH[kind])
	if _shader == null:
		_shader = load(SHADER_PATH)
	_model = (_meshes[kind] as PackedScene).instantiate()
	_model.name = "Model"
	body_scale = Leads.scale_of(look_id)
	_model.scale = Vector3.ONE * body_scale
	_model.rotation.y = PI
	add_child(_model)
	skeleton = _model.get_node("GeneralSkeleton")
	var body := skeleton.get_node("Body") as MeshInstance3D
	body.material_override = Leads.material(look_id, _shader)
	if float(look.get("bun", 0.0)) > 0.5:
		_add_bun(look)
	_lt = skeleton.find_bone("LeftToes")
	_rt = skeleton.find_bone("RightToes")
	_build_tree()
	return true


## Meera's hair bun: a sphere on the head bone behind the crown (rest pose model point), the hair colour.
func _add_bun(look: Dictionary) -> void:
	var head := skeleton.find_bone("Head")
	var att := BoneAttachment3D.new()
	att.name = "Bun"
	skeleton.add_child(att)
	att.bone_idx = head
	var mi := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 0.052
	sm.height = 0.104
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color.html(look["hair"])
	mat.roughness = 0.7
	sm.material = mat
	mi.mesh = sm
	att.add_child(mi)
	var rest := skeleton.get_bone_global_rest(head)
	mi.transform = Transform3D(rest.basis.inverse(), rest.basis.inverse() * (Vector3(0.0, 1.715, -0.128) - rest.origin))


func _build_tree() -> void:
	var bt := AnimationNodeBlendTree.new()
	var tr := AnimationNodeTransition.new()
	tr.xfade_time = XFADE
	var i := 0
	for s in STATES:
		tr.add_input(s)
		var an := AnimationNodeAnimation.new()
		an.animation = STATES[s]
		bt.add_node("a_" + s, an, Vector2(0, i * 120))
		i += 1
	bt.add_node("state", tr, Vector2(300, 0))
	i = 0
	for s in STATES:
		bt.connect_node("state", i, "a_" + s)
		i += 1
	bt.add_node("rate", AnimationNodeTimeScale.new(), Vector2(500, 0))
	bt.connect_node("rate", 0, "state")
	bt.connect_node("output", 0, "rate")
	tree = AnimationTree.new()
	tree.name = "AnimTree"
	tree.add_animation_library("", clips())
	tree.tree_root = bt
	tree.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
	add_child(tree)
	tree.root_node = tree.get_path_to(_model)
	tree.active = true
	# a transition request is only taken once the tree has processed: before that the Transition plays no input and
	# the body stands in the rest pose (a T)
	tree.advance(0.0)
	_set_state("idle", 1.0, true)
	tree.advance(0.0)


## Plays a one-shot ("sit_enter", "sit_exit", "vault") over `seconds`, then the body goes back to its gait.
func play(shot: String, seconds: float) -> void:
	if not STATES.has(shot) or seconds <= 0.0:
		return
	_shot = shot
	_shot_left = seconds
	_set_state(shot, float(SHOT_PART.get(shot, clips().get_animation(STATES[shot]).length)) / seconds, true)


## One sim tick: picks the state from the character's movement (`info`: state, speed, crouched) and advances the tree.
func step(dt: float, c_state: String, speed: float, crouched: bool) -> void:
	var t0 := Time.get_ticks_usec()
	if c_state == "vault" and _shot != "vault":
		play("vault", 0.6)
	if _shot != "":
		_shot_left -= dt
		if _shot_left <= 0.0 or (_shot == "vault" and c_state != "vault"):
			_shot = ""
		# moving cuts a stand-up or a landing short (a fixed clip under a moving body slides its feet)
		elif (_shot == "sit_exit" and speed > STILL) or (_shot == "land" and speed > WALK_JOG):
			_shot = ""
	if _shot == "":
		_pick(c_state, speed, crouched)
	_was_air = c_state == "air"
	tree.advance(dt)
	skeleton.force_update_all_bone_transforms()
	var us := Time.get_ticks_usec() - t0
	if us_ring.size() < 120:
		us_ring.append(us)
	else:
		us_ring[ticks % 120] = us
	ticks += 1


func _pick(c_state: String, speed: float, crouched: bool) -> void:
	if c_state == "air":
		_set_state("air", 1.0)
		return
	if _was_air and c_state == "ground":
		_shot = "land"
		_shot_left = LAND_S
		_set_state("land", LAND_RATE, true)
		return
	if crouched:
		if speed < STILL:
			_set_state("crouch_idle", 1.0)
		else:
			_set_state("crouch_walk", _stride_rate("crouch_walk", speed))
		return
	if speed < STILL:
		_set_state("idle", 1.0)
	elif speed < WALK_JOG:
		_set_state("walk", _stride_rate("walk", speed))
	elif speed < JOG_SPRINT:
		_set_state("jog", _stride_rate("jog", speed))
	else:
		_set_state("sprint", _stride_rate("sprint", speed))


## The rate at which a moving clip's planted foot keeps still at this ground speed.
func _stride_rate(s: String, speed: float) -> float:
	var stride: Dictionary = clips().get_meta("stride", {})
	var model_speed := float(stride.get(STRIDE_OF[s], 1.0)) * body_scale
	return clampf(speed / maxf(model_speed, 0.01), RATE_MIN, RATE_MAX)


func _set_state(s: String, r: float, restart := false) -> void:
	rate = r
	tree.set("parameters/rate/scale", r)
	if s != state or restart:
		state = s
		tree.set("parameters/state/transition_request", s)


## World positions of the balls of the feet (the contact points of foot_contact.gd): [left, right].
func balls() -> Array:
	var g := skeleton.global_transform
	return [g * skeleton.get_bone_global_pose(_lt).origin, g * skeleton.get_bone_global_pose(_rt).origin]


## Median cost per tick of the last ticks (ms).
func cost_ms() -> float:
	if us_ring.is_empty():
		return 0.0
	var a := Array(us_ring)
	a.sort()
	return float(a[a.size() / 2]) / 1000.0


func info() -> Dictionary:
	return {"look": look_id, "state": state, "clip": STATES.get(state, ""), "rate": snappedf(rate, 0.001),
		"scale": snappedf(body_scale, 0.0001), "msPerTick": snappedf(cost_ms(), 0.0001), "ticks": ticks}

