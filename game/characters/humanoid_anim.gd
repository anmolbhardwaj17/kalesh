## The humanoid body of a character (P1-023, TECH.md "Characters, crowds and navigation (N1, AN2, AL1)"): a mannequin
## of the Quaternius Universal Animation Library (CC0, retargeted to Godot's SkeletonProfileHumanoid, rig/), dressed as
## one of the three leads (leads.gd, rig/lead_look.gdshader), animated by an AnimationTree. Since P2-041 the body moves
## on the built locomotion clips (rig/loco_clips.res, tools/build_locomotion.gd: feet planted at the game's speeds):
##   move        idle blended with a speed blend space of walk, jog and sprint. The three cycles are stretched to one
##               shared timeline, so they stay in step while they blend; the timeline's rate is the cadence that keeps
##               the planted foot still: ground speed / (stride of the blend x the body's scale). At a gait's own
##               speed that is the clip at rate 1 (0.97 to 1.04 by the lead's height)
##   crouch      crouch idle blended with the crouch walk the same way
##   start, stop_l/r, turn_l/r   the built moves: push off from standing, plant and stop (the foot that is forward
##               brakes), plant and turn back; played once over the blend and faded back into it
##   air, land   in the air (the library's jump loop), a short landing on touch down
##   vault       the library's 1 m climb up, fitted to the vault's 0.6 s (stand-in: the free library has no vault)
##   sit_enter, sit, sit_exit, drive    getting into and out of a vehicle seat, sitting, driving (stand-ins)
## Every state is an input of one AnimationNodeTransition (cross fade) followed by a TimeScale. The tree is advanced
## by step() on the sim tick (the owner calls it), never by itself, so the time scale and the sim hold reach it; then
## body_feel.gd lays the lean, the head look and the foot placement over the pose. The cost of both is measured per
## tick. The capsule of on_foot.gd stays the collision shape; this node only draws. The model faces +Z, so it is
## turned half a turn to face the character's -Z, and lowered by the library's ground height (its clips stand 8 cm
## over the origin).
extends Node3D

const Leads := preload("res://characters/leads.gd")
const BodyFeel := preload("res://characters/body_feel.gd")
const Layers := preload("res://characters/anim_layers.gd")
const CLIPS_PATH := "res://characters/rig/ual_clips.res"
const LOCO_PATH := "res://characters/rig/loco_clips.res"
const LEAD_LOCO_PATH := "res://characters/rig/loco_%s.res"
## A lead's Mixamo set (P2-072, characters/tools/mixamo_lead.gd), played in place of loco_<id>.res when it exists.
const LEAD_MX_PATH := "res://characters/rig/mx_%s.res"
const LEAD_CLIPS_PATH := "res://characters/rig/clips_%s.res"
const SHADER_PATH := "res://characters/rig/lead_look.gdshader"
const MESH_PATH := {"m": "res://characters/rig/mannequin_m.scn", "f": "res://characters/rig/mannequin_f.scn"}
## State -> clip ("k/" is the built library). The first two are the blends; the rest play one clip.
const STATES := {
	"move": "Idle", "crouch": "k/Crouch_Idle_K",
	"air": "Jump", "land": "Jump_Land", "vault": "ClimbUp_1m",
	"sit_enter": "Sitting_Enter", "sit": "Sitting_Idle", "sit_exit": "Sitting_Exit", "drive": "Driving",
	"start": "k/Start", "stop_l": "k/Stop_L", "stop_r": "k/Stop_R", "turn_l": "k/Turn_L", "turn_r": "k/Turn_R",
}
## The gait clips of the speed blend, slowest first, and the crouch walk.
const GAITS := ["k/Walk_K", "k/Jog_K", "k/Sprint_K"]
const CROUCH_GAIT := "k/Crouch_K"
## Ground speeds (m/s) between walk and jog and between jog and sprint, for the state's name (info, probes).
const WALK_JOG := 2.7
const JOG_SPRINT := 5.15
const STILL := 0.15
const XFADE := 0.15
## The landing plays this long at LAND_RATE, then the body goes back to its gait.
const LAND_S := 0.25
const LAND_RATE := 1.6
## One-shots fitted to a length: seconds of the clip used (from its start).
const SHOT_PART := {"vault": 0.6, "sit_enter": 1.0, "sit_exit": 0.9}
## A stop plays its clip from this speed up (a walk just eases into the idle); a start from standing when the body
## is asked to run; a turn back from this speed up.
const STOP_MIN := 2.6
const TURN_MIN := 2.6
## Gait phase the blend starts from out of the idle (left foot just down in front, right behind: the idle's stance).
const START_PHASE := 0.04
const P_MOVE := &"parameters/move/blend_amount"
const P_GAITS := &"parameters/gaits/blend_position"
const P_GAIT_RATE := &"parameters/gait_rate/scale"
const P_CROUCH := &"parameters/crouch/blend_amount"
const P_CROUCH_RATE := &"parameters/crouch_rate/scale"
const P_RATE := &"parameters/rate/scale"

static var _clips: AnimationLibrary
static var _loco: AnimationLibrary
static var _lead_loco := {}
static var _lead_clips := {}
static var _meshes := {}
static var _shader: Shader

var look_id := "bittu"
var body_scale := 1.0
## The built lead model's metadata (rig/lead_<id>.scn "lead"), empty on the stand-in mannequin.
var lead_model := {}
var _lib: AnimationLibrary
## Cross fade into a stop or a turn: 0.09 s on the mannequin; a lead model's own moves meet its jog a little further
## off (P2-063: the ankles stepped 0.19 m at 0.09 s), so they fade in over 0.14 s.
var _move_fade := 0.09
var tree: AnimationTree
var skeleton: Skeleton3D
var feel := BodyFeel.new()
## The upper body, flinch and aim layers (P2-072), null when the set has no layer clips.
var layers: Layers
## "idle", "walk", "jog", "sprint", "crouch_idle", "crouch_walk", "start", "stop", "turn" or a state of STATES.
var state := "idle"
## Play rate of the gait clips now: the cadence over the blend's natural cadence (1 at a gait's own speed).
var rate := 1.0
## Cycles a second of the gait timeline, and where in the cycle the body is (0 left foot down, 0.5 right).
var cadence := 0.0
var phase := 0.0
## Cost of the last ticks (advance, bone update, body feel), microseconds.
var us_ring := PackedInt32Array()
var ticks := 0

var _model: Node3D
var _tr: AnimationNodeTransition
var _input := ""
var _fade_left := 0.0
var _shot := ""
var _shot_left := 0.0
var _was_air := false
var _was_speed := 0.0
var _was_intent := ""
var _lt := -1
var _rt := -1
var _lf := -1
var _rf := -1
## Per gait: [game speed, model metres a cycle, cycle seconds], slowest first; the same for the crouch walk.
var _gaits := []
var _crouch := []
var _moves := {}
var _params := {}
var _blend_speed := -1.0
var _blend_crouched := false


## True when the rig files are in the repo (tools/characters/ual_build.mjs wrote them); else the capsule stays.
static func available() -> bool:
	return ResourceLoader.exists(CLIPS_PATH) and ResourceLoader.exists(LOCO_PATH) and ResourceLoader.exists(MESH_PATH.m) and ResourceLoader.exists(MESH_PATH.f)


static func clips() -> AnimationLibrary:
	if _clips == null:
		_clips = load(CLIPS_PATH)
	return _clips


## The built locomotion clips (tools/characters/loco_build.mjs) of the stand-in mannequin.
static func loco() -> AnimationLibrary:
	if _loco == null:
		_loco = load(LOCO_PATH)
	return _loco


## A lead model's library clips retargeted onto its own rest (rig/clips_<id>.res, P2-068: the model keeps Mixamo's
## rest, the limbs aimed at the mannequin's), or the shared library when that file is missing.
static func lead_clips(id: String) -> AnimationLibrary:
	if not _lead_clips.has(id):
		var p := LEAD_CLIPS_PATH % id
		_lead_clips[id] = load(p) if ResourceLoader.exists(p) else clips()
	return _lead_clips[id]


## A lead model's own locomotion clips: its Mixamo set (rig/mx_<id>.res, P2-072) when there is one, else its built
## set (rig/loco_<id>.res, built on its skeleton by tools/characters/lead_build.mjs), else the mannequin's.
static func lead_loco(id: String) -> AnimationLibrary:
	if not _lead_loco.has(id):
		var p := LEAD_MX_PATH % id
		if not ResourceLoader.exists(p):
			p = LEAD_LOCO_PATH % id
		_lead_loco[id] = load(p) if ResourceLoader.exists(p) else loco()
	return _lead_loco[id]


## The locomotion clips this body plays.
func locomotion() -> AnimationLibrary:
	return _lib if _lib != null else loco()


## Builds the body for a look; false when the rig files are missing. A lead with a built model (P2-063,
## Leads.model_path) is drawn on its own retargeted skeleton, else on the stand-in mannequin with the painted look.
func setup(id: String, stand_in := false) -> bool:
	if not available():
		return false
	look_id = id if Leads.LOOKS.has(id) else "bittu"
	var look := Leads.look(look_id)
	var mpath := "" if stand_in else Leads.model_path(look_id)
	if mpath != "":
		if not _meshes.has(mpath):
			_meshes[mpath] = load(mpath)
		_model = (_meshes[mpath] as PackedScene).instantiate()
		lead_model = _model.get_meta("lead", {})
		body_scale = Leads.model_scale(look_id, lead_model)
		_lib = lead_loco(look_id)
		_move_fade = 0.14
	else:
		var kind: String = look["mesh"]
		if not _meshes.has(kind):
			_meshes[kind] = load(MESH_PATH[kind])
		if _shader == null:
			_shader = load(SHADER_PATH)
		_model = (_meshes[kind] as PackedScene).instantiate()
		body_scale = Leads.scale_of(look_id)
		_lib = loco()
	var ground := float(_lib.get_meta("ground", 0.0))
	var sole: Dictionary = _lib.get_meta("sole", {})
	_model.name = "Model"
	_model.scale = Vector3.ONE * body_scale
	_model.rotation.y = PI
	_model.position.y = -ground * body_scale
	add_child(_model)
	skeleton = _model.get_node("GeneralSkeleton")
	if lead_model.is_empty():
		var body := skeleton.get_node("Body") as MeshInstance3D
		body.material_override = Leads.material(look_id, _shader)
		if float(look.get("bun", 0.0)) > 0.5:
			_add_bun(look)
	_lt = skeleton.find_bone("LeftToes")
	_rt = skeleton.find_bone("RightToes")
	_lf = skeleton.find_bone("LeftFoot")
	_rf = skeleton.find_bone("RightFoot")
	var meta: Dictionary = _lib.get_meta("gaits", {})
	for g in GAITS:
		var m: Dictionary = meta[g.trim_prefix("k/")]
		_gaits.append([float(m.speed), float(m.model_speed) * float(m.cycle_s), float(m.cycle_s)])
	var cm: Dictionary = meta[CROUCH_GAIT.trim_prefix("k/")]
	_crouch = [float(cm.speed), float(cm.model_speed) * float(cm.cycle_s), float(cm.cycle_s)]
	_moves = _lib.get_meta("moves", {})
	feel.setup(skeleton, body_scale, {"ground": ground, "sole": sole})
	feel.jog_speed = _gaits[1][0]
	feel.sprint_speed = _gaits[2][0]
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


## A clip on the shared one second timeline of the gait blend (stretched, looped).
func _cycle_node(clip: String) -> AnimationNodeAnimation:
	var an := AnimationNodeAnimation.new()
	an.animation = clip
	an.use_custom_timeline = true
	an.timeline_length = 1.0
	an.stretch_time_scale = true
	an.loop_mode = Animation.LOOP_LINEAR
	return an


func _build_tree() -> void:
	var bt := AnimationNodeBlendTree.new()
	# move: idle blended with the speed blend space of the gaits
	var bs := AnimationNodeBlendSpace1D.new()
	bs.min_space = _gaits[0][0]
	bs.max_space = _gaits[2][0]
	bs.sync = true
	for i in GAITS.size():
		bs.add_blend_point(_cycle_node(GAITS[i]), _gaits[i][0], -1, StringName(GAITS[i].trim_prefix("k/")))
	bt.add_node("gaits", bs, Vector2(-600, 0))
	bt.add_node("gait_seek", AnimationNodeTimeSeek.new(), Vector2(-450, 0))
	bt.connect_node("gait_seek", 0, "gaits")
	bt.add_node("gait_rate", AnimationNodeTimeScale.new(), Vector2(-300, 0))
	bt.connect_node("gait_rate", 0, "gait_seek")
	var idle := AnimationNodeAnimation.new()
	idle.animation = _clip("move")
	bt.add_node("a_idle", idle, Vector2(-300, -120))
	var mv := AnimationNodeBlend2.new()
	mv.sync = true
	bt.add_node("move", mv, Vector2(-100, 0))
	bt.connect_node("move", 0, "a_idle")
	bt.connect_node("move", 1, "gait_rate")
	# crouch: crouch idle blended with the crouch walk
	bt.add_node("c_walk", _cycle_node(CROUCH_GAIT), Vector2(-450, 240))
	bt.add_node("crouch_rate", AnimationNodeTimeScale.new(), Vector2(-300, 240))
	bt.connect_node("crouch_rate", 0, "c_walk")
	var cidle := AnimationNodeAnimation.new()
	cidle.animation = _clip("crouch")
	bt.add_node("c_idle", cidle, Vector2(-300, 120))
	var cr := AnimationNodeBlend2.new()
	cr.sync = true
	bt.add_node("crouch", cr, Vector2(-100, 240))
	bt.connect_node("crouch", 0, "c_idle")
	bt.connect_node("crouch", 1, "crouch_rate")
	_tr = AnimationNodeTransition.new()
	_tr.xfade_time = XFADE
	var i := 0
	for s in STATES:
		_tr.add_input(s)
		if s in ["move", "crouch"]:
			# the blends keep their place in the cycle when the body comes back to them
			_tr.set_input_reset(i, false)
		else:
			var an := AnimationNodeAnimation.new()
			an.animation = _clip(s)
			bt.add_node("a_" + s, an, Vector2(0, 360 + i * 120))
		i += 1
	bt.add_node("state", _tr, Vector2(300, 0))
	i = 0
	for s in STATES:
		bt.connect_node("state", i, s if s in ["move", "crouch"] else "a_" + s)
		i += 1
	bt.add_node("rate", AnimationNodeTimeScale.new(), Vector2(500, 0))
	bt.connect_node("rate", 0, "state")
	tree = AnimationTree.new()
	if not lead_model.is_empty() and Layers.supported(_lib):
		layers = Layers.new()
		layers.tree = tree
		layers.build(bt, "rate", "k", skeleton)
	else:
		bt.connect_node("output", 0, "rate")
	tree.name = "AnimTree"
	tree.add_animation_library("", clips() if lead_model.is_empty() else lead_clips(look_id))
	tree.add_animation_library("k", _lib)
	tree.tree_root = bt
	tree.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
	add_child(tree)
	tree.root_node = tree.get_path_to(_model)
	tree.active = true
	# a transition request is only taken once the tree has processed: before that the Transition plays no input and
	# the body stands in the rest pose (a T)
	tree.advance(0.0)
	_set_input("move", 1.0, XFADE, true)
	_blend(0.0, false)
	tree.advance(0.0)


## Plays a one-shot ("sit_enter", "sit_exit", "vault") over `seconds`, then the body goes back to its gait.
func play(shot: String, seconds: float) -> void:
	if not STATES.has(shot) or seconds <= 0.0:
		return
	_shot = shot
	_shot_left = seconds
	state = shot
	_set_input(shot, float(SHOT_PART.get(shot, _length(_clip(shot)))) / seconds, XFADE, true, true)


func _length(clip: String) -> float:
	return tree.get_animation(clip).length


## The clip a state plays: STATES's, or the same name in this body's own set when it has one (a lead's Mixamo set has
## its own Idle).
func _clip(s: String) -> String:
	var c: String = STATES[s]
	return "k/" + c if not c.begins_with("k/") and _lib != null and _lib.has_animation(c) else c


## What the body is told about its motion before step(): the world velocity, the compass heading it faces and the
## compass yaw of the camera (the head looks there), for body_feel.gd.
func sense(vel: Vector3, heading: float, look_yaw: float) -> void:
	feel.vel = vel
	feel.heading = heading
	feel.look_yaw = look_yaw


## One sim tick: picks the state from the character's movement (state, ground speed, crouched) and what its motor is
## doing (`intent`: "go" moving on, "stop" no input, "turn" turning back; "" for a body without a motor), advances the
## tree and lays the body feel over the pose.
func step(dt: float, c_state: String, speed: float, crouched: bool, intent := "") -> void:
	var t0 := Time.get_ticks_usec()
	_fade_left = maxf(0.0, _fade_left - dt)
	if c_state == "vault" and _shot != "vault":
		play("vault", 0.6)
	if _shot != "":
		_shot_left -= dt
		if _shot_left <= 0.0 or (_shot == "vault" and c_state != "vault"):
			_end_shot()
		# moving cuts a stand-up or a landing short (a fixed clip under a moving body slides its feet)
		elif (_shot == "sit_exit" and speed > STILL) or (_shot == "land" and speed > WALK_JOG):
			_shot = ""
		# a move is cut by anything but the ground under it, and by the player changing their mind
		elif _is_move(_shot) and (c_state != "ground" or crouched or _cut_move(intent, speed)):
			_shot = ""
	if _shot == "":
		_pick(c_state, speed, crouched, intent)
	_was_air = c_state == "air"
	_was_speed = speed
	_was_intent = intent
	if _input == "move":
		phase = fposmod(phase + cadence * dt, 1.0)
	if layers != null:
		layers.pre(dt)
	tree.advance(dt)
	if layers != null:
		layers.post(dt)
	# no forced bone update here: body_feel.gd reads the bones it needs (that updates them), and a body it does not
	# touch is updated by the skeleton itself before it is drawn
	feel.update(dt, c_state == "ground" and not _shot in ["sit_enter", "sit", "sit_exit", "drive", "vault"])
	var us := Time.get_ticks_usec() - t0
	if us_ring.size() < 120:
		us_ring.append(us)
	else:
		us_ring[ticks % 120] = us
	ticks += 1


static func _is_move(shot: String) -> bool:
	return shot == "start" or shot.begins_with("stop_") or shot.begins_with("turn_")


## A move ends early when the player asks for something else: a stop when they move again, a start when they let go.
func _cut_move(intent: String, speed: float) -> bool:
	if _shot.begins_with("stop_"):
		return intent == "go" or intent == "turn"
	if _shot == "start":
		return intent == "stop" and speed < 1.0
	return false


## A one-shot ran out: a start or a turn hands over to the gait blend at the phase its last pose has.
func _end_shot() -> void:
	var done := _shot
	_shot = ""
	if done == "start" or done.begins_with("turn_"):
		var m: Dictionary = _moves.get(_clip(done).trim_prefix("k/"), {})
		_seek(float(m.get("out_phase", 0.5)))


func _seek(p: float) -> void:
	phase = fposmod(p, 1.0)
	tree.set("parameters/gait_seek/seek_request", phase)


## The foot that lands next in the gait cycle: "r" in the first half (the left is down or just left), "l" in the second.
func _next_foot() -> String:
	return "r" if phase < 0.5 else "l"


func _move_shot(shot: String, fade: float) -> bool:
	if not _set_input(shot, 1.0, fade, true):
		return false
	_shot = shot
	_shot_left = _length(_clip(shot))
	state = shot.get_slice("_", 0)
	return true


func _pick(c_state: String, speed: float, crouched: bool, intent: String) -> void:
	if c_state == "air":
		if _set_input("air", 1.0, XFADE):
			state = "air"
		return
	# a landing clip only for a body that lands slow: a runner goes straight back into the run
	if _input == "air" and c_state == "ground" and speed <= WALK_JOG and _set_input("land", LAND_RATE, 0.1, true):
		_shot = "land"
		_shot_left = LAND_S
		state = "land"
		return
	if crouched:
		if _set_input("crouch", 1.0, XFADE):
			state = "crouch_idle" if speed < STILL else "crouch_walk"
		_blend(speed, true)
		return
	if not _moves.is_empty() and c_state == "ground" and _input == "move":
		if intent == "stop" and _was_intent in ["go", "turn"] and speed >= STOP_MIN and _move_shot("stop_" + _next_foot(), _move_fade):
			return
		if intent == "turn" and _was_intent == "go" and speed >= TURN_MIN and _move_shot("turn_" + _next_foot(), _move_fade):
			return
		if intent == "go" and _was_intent == "stop" and _was_speed < STILL and _move_shot("start", 0.08):
			return
	if speed < STILL:
		if state != "idle" and _input == "move":
			_seek(START_PHASE)
		state = "idle"
	elif speed < WALK_JOG:
		state = "walk"
	elif speed < JOG_SPRINT:
		state = "jog"
	else:
		state = "sprint"
	if _input != "move":
		# back from a one-shot: the blend is put where the body thinks it is in the cycle (a start or a turn set it)
		if _fade_left <= 0.0:
			_seek(START_PHASE if speed < STILL else phase)
		_set_input("move", 1.0, 0.22 if speed < STILL else 0.12)
	elif _was_speed < STILL and speed >= STILL:
		_seek(START_PHASE)
	_blend(speed, false)


## Sets the blend for a ground speed: how much of the gaits over the idle, which gaits, and the cadence that keeps
## the planted foot still (cycles a second = speed / metres a cycle of the blend).
func _blend(speed: float, crouched: bool) -> void:
	# a body at a steady speed keeps its blend
	if speed == _blend_speed and crouched == _blend_crouched:
		return
	_blend_speed = speed
	_blend_crouched = crouched
	var moving := speed >= STILL
	if crouched:
		var c_speed: float = _crouch[0]
		var c_stride: float = _crouch[1]
		var c_cycle: float = _crouch[2]
		var cyc := maxf(speed, c_speed) / (c_stride * body_scale) if moving else 0.0
		rate = cyc * c_cycle if moving else 1.0
		_param(P_CROUCH, clampf(speed / c_speed, 0.0, 1.0))
		_param(P_CROUCH_RATE, cyc)
		return
	var walk_speed: float = _gaits[0][0]
	var s := clampf(speed, walk_speed, float(_gaits[2][0]))
	var k := 0 if s <= float(_gaits[1][0]) else 1
	var lo: Array = _gaits[k]
	var hi: Array = _gaits[k + 1]
	# between two gaits the blend crosses over in the middle half of the speed range, so most speeds show one gait
	# (half a walk and half a jog is a crouched shuffle); the stride follows the same weight, so the feet still hold
	var w := smoothstep(0.25, 0.75, (s - float(lo[0])) / (float(hi[0]) - float(lo[0])))
	s = lerpf(float(lo[0]), float(hi[0]), w)
	var stride := lerpf(float(lo[1]), float(hi[1]), w) * body_scale
	var natural := lerpf(float(lo[2]), float(hi[2]), w)
	# under the walk's speed the stride shrinks with the idle's share, so the cadence stays the walk's
	cadence = maxf(speed, walk_speed) / stride if moving else 0.0
	rate = cadence * natural if moving else 1.0
	_param(P_MOVE, clampf(speed / walk_speed, 0.0, 1.0))
	_param(P_GAITS, s)
	_param(P_GAIT_RATE, cadence)


## Sets a tree parameter when its value changed (a body at a steady speed sets nothing).
func _param(path: StringName, v: float) -> void:
	if _params.get(path) != v:
		_params[path] = v
		tree.set(path, v)


## Makes `input` the current input of the state transition (cross faded over `fade`), played at rate `r`. A
## transition asked for while the last cross fade is still running would cut that fade short (the pose jumps: the
## Transition node fades between two inputs only), so it is refused unless `now` (a vault, a seat: they cannot wait);
## the caller asks again on a later tick. Answers whether `input` is the current input.
func _set_input(input: String, r: float, fade: float, restart := false, now := false) -> bool:
	if input != _input or restart:
		if _fade_left > 0.0 and not now:
			return false
		_input = input
		_tr.xfade_time = fade
		_fade_left = fade
		tree.set("parameters/state/transition_request", input)
	_param(P_RATE, r)
	return true


## World positions of the balls of the feet (the contact points of foot_contact.gd): [left, right]. The mannequin's
## Toes joint sits on its sole; a lead model's toe joint is the Mixamo rig's (higher, at the ankle after the retarget),
## so its ball is the sole point under the toe joint (the locomotion build's own contact point).
func balls() -> Array:
	var g := skeleton.global_transform
	if not lead_model.is_empty():
		var sole: Dictionary = _lib.get_meta("sole", {})
		return [g * (skeleton.get_bone_global_pose(_lf) * (sole["LeftBall"] as Vector3)),
			g * (skeleton.get_bone_global_pose(_rf) * (sole["RightBall"] as Vector3))]
	return [g * skeleton.get_bone_global_pose(_lt).origin, g * skeleton.get_bone_global_pose(_rt).origin]


## Median cost per tick of the last ticks (ms).
func cost_ms() -> float:
	if us_ring.is_empty():
		return 0.0
	var a := Array(us_ring)
	a.sort()
	return float(a[a.size() / 2]) / 1000.0


## The clip that leads the pose now (the nearest gait of the blend while moving).
func clip() -> String:
	if _input == "crouch":
		return CROUCH_GAIT if state == "crouch_walk" else _clip("crouch")
	if _input != "move":
		return _clip(_input) if STATES.has(_input) else ""
	match state:
		"walk":
			return GAITS[0]
		"jog":
			return GAITS[1]
		"sprint":
			return GAITS[2]
	return _clip("move")


func info() -> Dictionary:
	return {"look": look_id, "state": state, "clip": clip(), "rate": snappedf(rate, 0.001),
		"cadenceSpm": snappedf(cadence * 120.0, 0.1), "phase": snappedf(phase, 0.001),
		"lean": [snappedf(feel.lean.x, 0.001), snappedf(feel.lean.y, 0.001)], "headYaw": snappedf(feel.head_yaw, 0.001),
		"scale": snappedf(body_scale, 0.0001), "model": "lead" if not lead_model.is_empty() else "mannequin", "msPerTick": snappedf(cost_ms(), 0.0001), "ticks": ticks,
		"layers": layers.info() if layers != null else {}, "set": str(_lib.get_meta("source", "")).get_slice(" ", 0) if _lib != null else ""}


## The layers (anim_layers.gd): an upper body action ("" clears), an additive flinch, the spine aim. False without them.
func upper(action: String) -> bool:
	return layers != null and layers.set_upper(action)


func flinch(kind: String, strength := 1.0) -> bool:
	return layers != null and layers.flinch(kind, strength)


func aim(on: bool, yaw := 0.0, pitch := 0.0) -> bool:
	if layers == null:
		return false
	layers.aim(on, yaw, pitch)
	return true
