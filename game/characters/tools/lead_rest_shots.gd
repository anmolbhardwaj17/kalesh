## Rest pose proof of the lead models (P2-068), run by harness/bin/leadsheet.mjs --rest (a window parked off screen,
## never headless: it renders):
##   godot --path game --position 30000,30000 -s res://characters/tools/lead_rest_shots.gd -- <out dir> bittu meera danny
## Per lead, front and back: the owner's model as delivered (public/assets/models/model_lead_<id>.glb, the mesh's own
## vertices, which is the bind pose Mixamo shows) beside the built rig/lead_<id>.scn with its skeleton at rest. The two
## must match: the build keeps the model's bind and rest pose (the clips play relative to that rest). Writes
## <out dir>/rest_<id>_<src|built>_<front|back>.png, each body scaled to the same height and lit the same.
extends SceneTree

const HEIGHT := 1.8
var _jobs: Array = []
var _out := ""
var _frame := 0
var _cur: Node3D = null
var _cam: Camera3D


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() < 2:
		printerr("lead_rest_shots: <out dir> <ids...>")
		quit(1)
		return
	_out = args[0]
	root.size = Vector2i(700, 900)
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0.8, 0.8, 0.82)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(1, 1, 1)
	e.ambient_light_energy = 0.55
	env.environment = e
	root.add_child(env)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-35, 20, 0)
	sun.light_energy = 1.1
	root.add_child(sun)
	var fill := DirectionalLight3D.new()
	fill.rotation_degrees = Vector3(-20, 200, 0)
	fill.light_energy = 0.6
	root.add_child(fill)
	_cam = Camera3D.new()
	_cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	_cam.size = 2.0
	root.add_child(_cam)
	_cam.current = true
	for id in args.slice(1):
		for kind in ["src", "built"]:
			for view in ["front", "back"]:
				_jobs.append([id, kind, view])


func _body(id: String, kind: String) -> Node3D:
	var holder := Node3D.new()
	if kind == "src":
		var doc := GLTFDocument.new()
		var st := GLTFState.new()
		var path := ProjectSettings.globalize_path("res://").path_join("../public/assets/models/model_lead_%s.glb" % id)
		if doc.append_from_file(path, st) != OK:
			return null
		var sc := doc.generate_scene(st) as Node
		# the mesh's own vertices: the bind pose as the file stores it (no skeleton applied)
		for mi in sc.find_children("*", "MeshInstance3D", true, false):
			var m := MeshInstance3D.new()
			m.mesh = (mi as MeshInstance3D).mesh
			holder.add_child(m)
		sc.free()
	else:
		var ps := load("res://characters/rig/lead_%s.scn" % id) as PackedScene
		if ps == null:
			return null
		var n := ps.instantiate() as Node3D
		var sk := n.find_child("GeneralSkeleton", true, false) as Skeleton3D
		sk.reset_bone_poses()
		for mi in n.find_children("Body_LOD*", "MeshInstance3D", true, false):
			(mi as MeshInstance3D).visible = mi.name == "Body_LOD0"
			(mi as MeshInstance3D).visibility_range_end = 0.0
		holder.add_child(n)
	return holder


func _aabb(n: Node3D) -> AABB:
	var box := AABB()
	var first := true
	for mi in n.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		if not m.visible:
			continue
		var b := m.global_transform * m.get_aabb()
		box = b if first else box.merge(b)
		first = false
	return box


func _process(_d: float) -> bool:
	_frame += 1
	if _jobs.is_empty():
		quit(0)
		return true
	var job: Array = _jobs[0]
	if _cur == null:
		_cur = _body(job[0], job[1])
		if _cur == null:
			printerr("lead_rest_shots: cannot load %s %s" % [job[0], job[1]])
			quit(1)
			return true
		root.add_child(_cur)
		_frame = 0
		return false
	if _frame == 2:
		var box := _aabb(_cur)
		var f := HEIGHT / maxf(box.size.y, 1e-3)
		_cur.scale = Vector3.ONE * f
		var c := (box.get_center() - _cur.position) * f
		_cur.position = -Vector3(c.x, box.position.y * f, c.z)
		var z := 1.5 if job[2] == "front" else -1.5
		_cam.size = 2.0
		_cam.look_at_from_position(Vector3(0, HEIGHT * 0.5, z), Vector3(0, HEIGHT * 0.5, 0))
		return false
	if _frame == 6:
		var img := root.get_texture().get_image()
		var file := _out.path_join("rest_%s_%s_%s.png" % job)
		img.save_png(file)
		print("lead_rest_shots: ", file)
		_cur.queue_free()
		_cur = null
		_jobs.pop_front()
	return false
