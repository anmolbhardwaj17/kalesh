## Frame strips of Mixamo clips on a lead model (P2-072), run by harness/bin/mixamostrip.mjs (a window parked off
## screen, never headless: it renders):
##   godot --path game --position 30000,30000 -s res://characters/tools/mixamo_strips.gd -- <out dir> <lead> <clip>...
## Per clip FRAMES evenly spaced frames (a looping clip over one cycle, a one-shot from start to end), seen from behind
## and from the side (the lead's left), the clip played on the lead as the game plays it (mixamo.gd lead_library: the
## limbs aimed at the source skeleton's, the hips scaled to the lead's). A ground plane at the soles shows a foot that
## floats or sinks. Writes <out dir>/mxs_<lead>_<clip>_<frame>_<back|side>.png.
extends SceneTree

const Mixamo := preload("res://characters/mixamo.gd")
const FRAMES := 4
var _jobs: Array = []
var _out := ""
var _lead := ""
var _frame := 0
var _body: Node3D
var _sk: Skeleton3D
var _ap: AnimationPlayer
var _cam: Camera3D
var _libs := {}


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() < 3:
		printerr("mixamo_strips: <out dir> <lead> <clips...>")
		quit(1)
		return
	_out = args[0]
	_lead = args[1]
	root.size = Vector2i(420, 620)
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0.78, 0.79, 0.81)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(1, 1, 1)
	e.ambient_light_energy = 0.55
	env.environment = e
	root.add_child(env)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-40, 25, 0)
	sun.light_energy = 1.1
	sun.shadow_enabled = true
	root.add_child(sun)
	var fill := DirectionalLight3D.new()
	fill.rotation_degrees = Vector3(-20, 205, 0)
	fill.light_energy = 0.55
	root.add_child(fill)
	var ground := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(8, 8)
	var gm := StandardMaterial3D.new()
	gm.albedo_color = Color(0.55, 0.56, 0.58)
	pm.material = gm
	ground.mesh = pm
	root.add_child(ground)
	_cam = Camera3D.new()
	_cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	_cam.size = 2.3
	root.add_child(_cam)
	_cam.current = true
	var ps := load("res://characters/rig/lead_%s.scn" % _lead) as PackedScene
	if ps == null:
		printerr("mixamo_strips: no lead model ", _lead)
		quit(1)
		return
	_body = ps.instantiate() as Node3D
	root.add_child(_body)
	for mi in _body.find_children("Body_LOD*", "MeshInstance3D", true, false):
		(mi as MeshInstance3D).visible = mi.name == "Body_LOD0"
		(mi as MeshInstance3D).visibility_range_end = 0.0
	_sk = _body.find_child("GeneralSkeleton", true, false) as Skeleton3D
	_ap = AnimationPlayer.new()
	_body.add_child(_ap)
	_ap.root_node = NodePath("..")
	_ap.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
	for name in args.slice(2):
		var c := Mixamo.info(name)
		if c.is_empty():
			printerr("mixamo_strips: no clip ", name)
			continue
		var cat := str(c.category)
		if not _libs.has(cat):
			_libs[cat] = Mixamo.lead_library(_lead, cat, _sk)
			_ap.add_animation_library(cat, _libs[cat])
		for i in FRAMES:
			for view in ["back", "side"]:
				_jobs.append([cat + "/" + name, name, i, view, bool(c.loop), float(c.length)])


func _process(_d: float) -> bool:
	_frame += 1
	if _jobs.is_empty():
		quit(0)
		return true
	var job: Array = _jobs[0]
	if _frame == 1:
		var len: float = job[5]
		var t: float = len * float(job[2]) / (FRAMES if job[4] else FRAMES - 1)
		_ap.play(job[0])
		_ap.seek(minf(t, len), true)
		_ap.advance(0.0)
		var hips := _sk.global_transform * _sk.get_bone_global_pose(_sk.find_bone("Hips")).origin
		var at := Vector3(hips.x, 0.88, hips.z)
		var from := at + (Vector3(0, 0.15, -4.0) if job[3] == "back" else Vector3(4.0, 0.15, 0))
		_cam.look_at_from_position(from, at)
		return false
	if _frame == 4:
		var img := root.get_texture().get_image()
		var file := _out.path_join("mxs_%s_%s_%d_%s.png" % [_lead, job[1], job[2], job[3]])
		img.save_png(file)
		_jobs.pop_front()
		_frame = 0
	return false
