## The layers over a lead's locomotion (P2-072), built into humanoid_anim.gd's AnimationTree when the lead's set
## (rig/mx_<id>.res, characters/tools/mixamo_lead.gd) has the clips:
##   upper    an AnimationNodeBlend2 whose filter passes only the upper body (chest up: shoulders, arms, hands,
##            fingers, neck, head; the spine and legs stay the gait's), fed by one Up_* clip at a time: pistol aim,
##            phone talk, texting, carrying (held until cleared) and gestures (wave, point, shrug: played once). The
##            weight eases in and out over FADE_S.
##   flinch   an AnimationNodeAdd2 laying an additive Add_* clip (each key relative to its first pose) over everything,
##            its amount a quick rise and a decay over the clip.
##   aim      spine aim IK after the tree: the turn to an aim yaw and pitch (relative to where the body faces) shared
##            by the spine, chest and upper chest (SHARE), eased by AIM_RATE; the head look of body_feel.gd follows.
## The legs and the planted feet are never touched by any layer. All three are driven on the sim tick (step()).
extends RefCounted

const P := "%GeneralSkeleton:"
## Upper body actions: clip, held (true: until cleared) or once.
const UPPER := {
	"pistol": ["Up_Pistol", true], "phone": ["Up_Phone", true], "text": ["Up_Text", true], "carry": ["Up_Carry", true],
	"wave": ["Up_Wave", false], "point": ["Up_Point", false], "shrug": ["Up_Shrug", false],
}
const FLINCH := {"head": "Add_Head", "body": "Add_Body"}
const FADE_S := 0.2
const FLINCH_SCALE := 0.45
const SHARE := {"Spine": 0.25, "Chest": 0.35, "UpperChest": 0.4}
const AIM_YAW_MAX := deg_to_rad(75.0)
const AIM_PITCH_MAX := deg_to_rad(45.0)
## How fast the aim turn eases to its target (share of the gap closed a second).
const AIM_RATE := 10.0
const P_UPPER := &"parameters/upper/blend_amount"
const P_UP_SEEK := &"parameters/up_seek/seek_request"
const P_FLINCH := &"parameters/flinch/add_amount"
const P_FL_SEEK := &"parameters/fl_seek/seek_request"

var tree: AnimationTree
var skeleton: Skeleton3D
var upper_action := ""
var upper_w := 0.0
var flinch_kind := ""
var flinch_amount := 0.0
## Aim (rad, relative to the body's facing; + yaw to the left, + pitch up) and whether it is on, and the turn now.
var aim_on := false
var aim_target := Vector2.ZERO
var aim_now := Vector2.ZERO
var _up_node: AnimationNodeAnimation
var _fl_node: AnimationNodeAnimation
var _up_left := 0.0
var _up_held := false
var _fl_t := 0.0
var _fl_len := 0.0
var _fl_strength := 1.0
var _spine := []


## True when a lead's set has the layer clips.
static func supported(lib: AnimationLibrary) -> bool:
	return lib != null and lib.has_animation("Up_Pistol") and lib.has_animation("Add_Head")


## Adds the layers between `from` (the node that was the tree's output) and the output of `bt`. `lib_prefix` is the
## library name the Up_* and Add_* clips are in ("k").
func build(bt: AnimationNodeBlendTree, from: String, lib_prefix: String, sk: Skeleton3D) -> void:
	skeleton = sk
	var up := AnimationNodeBlend2.new()
	up.filter_enabled = true
	for i in sk.get_bone_count():
		if _is_upper(String(sk.get_bone_name(i))):
			up.set_filter_path(NodePath(P + String(sk.get_bone_name(i))), true)
	_up_node = AnimationNodeAnimation.new()
	_up_node.animation = lib_prefix + "/Up_Pistol"
	bt.add_node("up_anim", _up_node, Vector2(500, 200))
	bt.add_node("up_seek", AnimationNodeTimeSeek.new(), Vector2(650, 200))
	bt.connect_node("up_seek", 0, "up_anim")
	bt.add_node("upper", up, Vector2(800, 0))
	bt.connect_node("upper", 0, from)
	bt.connect_node("upper", 1, "up_seek")
	_fl_node = AnimationNodeAnimation.new()
	_fl_node.animation = lib_prefix + "/Add_Head"
	_fl_node.loop_mode = Animation.LOOP_NONE
	bt.add_node("fl_anim", _fl_node, Vector2(800, 200))
	bt.add_node("fl_seek", AnimationNodeTimeSeek.new(), Vector2(950, 200))
	bt.connect_node("fl_seek", 0, "fl_anim")
	var add := AnimationNodeAdd2.new()
	bt.add_node("flinch", add, Vector2(1100, 0))
	bt.connect_node("flinch", 0, "upper")
	bt.connect_node("flinch", 1, "fl_seek")
	bt.connect_node("output", 0, "flinch")
	for n in SHARE:
		_spine.append([sk.find_bone(n), float(SHARE[n])])


## Upper body bones: from the chest up, the arms, hands and fingers (never the spine, hips or legs).
static func _is_upper(n: String) -> bool:
	if n in ["Chest", "UpperChest", "Neck", "Head"]:
		return true
	for part in ["Shoulder", "Arm", "Hand", "Thumb", "Index", "Middle", "Ring", "Little"]:
		if n.contains(part):
			return true
	return false


## Starts an upper body action (a key of UPPER), or clears it with "".
func set_upper(action: String) -> bool:
	if action == "":
		_up_held = false
		_up_left = 0.0
		return true
	if not UPPER.has(action):
		return false
	var spec: Array = UPPER[action]
	upper_action = action
	_up_node.animation = "k/" + str(spec[0])
	_up_held = bool(spec[1])
	_up_left = tree.get_animation(_up_node.animation).length
	tree.set(P_UP_SEEK, 0.0)
	return true


## A flinch of `kind` (head or body) at `strength` (0 to 1.5; 1 is a hard hit). The Mixamo hit clips are a boxer's full
## reaction, so a strength of 1 lays FLINCH_SCALE of their turn over the body.
func flinch(kind: String, strength := 1.0) -> bool:
	if not FLINCH.has(kind):
		return false
	flinch_kind = kind
	_fl_node.animation = "k/" + str(FLINCH[kind])
	_fl_len = minf(tree.get_animation(_fl_node.animation).length, 0.9)
	_fl_t = 0.0
	_fl_strength = clampf(strength, 0.0, 1.5) * FLINCH_SCALE
	tree.set(P_FL_SEEK, 0.0)
	return true


## Aims the chest `yaw` (rad, + left) and `pitch` (rad, + up) off the body's facing; `on` false eases back.
func aim(on: bool, yaw := 0.0, pitch := 0.0) -> void:
	aim_on = on
	aim_target = Vector2(clampf(yaw, -AIM_YAW_MAX, AIM_YAW_MAX), clampf(pitch, -AIM_PITCH_MAX, AIM_PITCH_MAX)) if on else Vector2.ZERO


## Before the tree advances: the weights of this tick.
func pre(dt: float) -> void:
	var want := 1.0 if (_up_held or _up_left > FADE_S) and upper_action != "" else 0.0
	_up_left -= dt
	upper_w = move_toward(upper_w, want, dt / FADE_S)
	if upper_w <= 0.0 and want <= 0.0:
		upper_action = ""
	tree.set(P_UPPER, upper_w)
	if flinch_kind != "":
		_fl_t += dt
		var rise := clampf(_fl_t / 0.06, 0.0, 1.0)
		var fall := clampf(1.0 - (_fl_t - 0.06) / maxf(_fl_len - 0.06, 0.01), 0.0, 1.0)
		flinch_amount = rise * fall * fall * _fl_strength
		if _fl_t >= _fl_len:
			flinch_kind = ""
			flinch_amount = 0.0
	tree.set(P_FLINCH, flinch_amount)


## After the tree advanced: the spine aim, shared over the spine bones about the skeleton's up and right axes.
func post(dt: float) -> void:
	aim_now = aim_now.lerp(aim_target, minf(1.0, dt * AIM_RATE))
	if aim_now.length() < 1e-4:
		return
	# each bone turns by its share about axes in skeleton space; the parent globals are read before any change, so
	# the turns add up down the chain (rotations about one axis commute)
	var g := []
	for s in _spine:
		var p := skeleton.get_bone_parent(int(s[0]))
		g.append(skeleton.get_bone_global_pose(p).basis.get_rotation_quaternion())
	for i in _spine.size():
		var b: int = _spine[i][0]
		var w: float = _spine[i][1]
		var turn := Quaternion(Vector3.UP, aim_now.x * w) * Quaternion(Vector3.RIGHT, -aim_now.y * w)
		var gp: Quaternion = g[i]
		skeleton.set_bone_pose_rotation(b, (gp.inverse() * turn * gp * skeleton.get_bone_pose_rotation(b)).normalized())


func info() -> Dictionary:
	return {"upper": upper_action, "upperW": snappedf(upper_w, 0.001), "flinch": flinch_kind, "flinchAmount": snappedf(flinch_amount, 0.001),
		"aim": [snappedf(aim_now.x, 0.001), snappedf(aim_now.y, 0.001)], "aimOn": aim_on}
