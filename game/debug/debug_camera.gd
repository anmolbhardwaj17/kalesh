## The camera hooks of the debug server (docs/GAME_HOOKS.md): setCamera({pos, target}) puts a DebugCamera into the
## scene until setCamera(null) hands back to the game camera, and shot(path) saves the next drawn frame as a PNG.
## A child of the debug server.
extends Node

var headless := false
var _camera: Camera3D = null
var _prev_camera: Camera3D = null


## True when cam is the debug camera (state().camera.override).
func is_override(cam: Camera3D) -> bool:
	return _camera != null and cam == _camera


## {pos, target} puts a debug camera there until null hands back to the game camera. {ok, result} or {ok: false, error}.
func set_camera(pose: Variant) -> Dictionary:
	if pose == null:
		clear()
		return {"ok": true, "result": true}
	if not (pose is Dictionary) or not (pose.get("pos") is Array) or not (pose.get("target") is Array) \
			or pose.pos.size() != 3 or pose.target.size() != 3:
		return _fail("setCamera(pose): pose must be {pos: [x, y, z], target: [x, y, z]} or null (named poses: none yet)")
	var from := Vector3(float(pose.pos[0]), float(pose.pos[1]), float(pose.pos[2]))
	var to := Vector3(float(pose.target[0]), float(pose.target[1]), float(pose.target[2]))
	if from.distance_to(to) < 1e-4:
		return _fail("setCamera(pose): pos and target are the same point")
	var scene := get_tree().current_scene
	if scene == null:
		return _fail("setCamera(pose): no scene is loaded")
	if _camera == null or not is_instance_valid(_camera):
		var game_cam := get_viewport().get_camera_3d()
		_prev_camera = game_cam
		_camera = Camera3D.new()
		_camera.name = "DebugCamera"
		if game_cam != null:
			_camera.fov = game_cam.fov
			_camera.near = game_cam.near
			_camera.far = game_cam.far
		scene.add_child(_camera)
	_camera.global_position = from
	var dir := (to - from).normalized()
	var up := Vector3.UP if absf(dir.dot(Vector3.UP)) < 0.999 else Vector3.FORWARD
	_camera.look_at(to, up)
	_camera.make_current()
	return {"ok": true, "result": true}


func clear() -> void:
	if _camera != null and is_instance_valid(_camera):
		_camera.queue_free()
	_camera = null
	if _prev_camera != null and is_instance_valid(_prev_camera):
		_prev_camera.make_current()
	_prev_camera = null


func shot(path: String) -> Dictionary:
	if headless:
		return _fail("shot: a headless run renders nothing (run the scenario windowed)")
	var dir := path.get_base_dir()
	if not DirAccess.dir_exists_absolute(dir):
		DirAccess.make_dir_recursive_absolute(dir)
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	if img == null or img.is_empty():
		return _fail("shot: the viewport gave no image (headless?)")
	var err := img.save_png(path)
	if err != OK:
		return _fail("shot: could not save %s (error %d)" % [path, err])
	return {"ok": true, "result": {"path": path, "width": img.get_width(), "height": img.get_height(), "frame": Engine.get_frames_drawn()}}


static func _fail(error: String) -> Dictionary:
	return {"ok": false, "error": error}
