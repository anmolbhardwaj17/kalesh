## The debug server: docs/GAME_HOOKS.md inside the Godot game, for the harness. Added under /root as "DebugServer"
## by GameArgs only when the game starts with the user arg --debug. Without it this script is never loaded.
##
## Transport (docs/GAME_HOOKS.md "Godot transport"): TCP on 127.0.0.1:<--debug-port>, newline-delimited JSON, UTF-8.
##   client -> game  {"id": 7, "method": "state", "args": []}
##   game -> client  {"type": "response", "id": 7, "ok": true, "result": ...}  or  {"type": "response", "id": 7,
##                   "ok": false, "error": "..."}
##   game -> client  {"type": "hello", ...} once on connect, then {"type": "snapshot", ...} after every drawn frame
##                   (state, clock, hold and the events since the last snapshot).
## Expected problems (unknown method, bad args, unknown scene) are error responses, never push_error.
extends Node

const Stats := preload("res://debug/perf_stats.gd")
const DebugLogger := preload("res://debug/debug_logger.gd")
const FrameProbe := preload("res://debug/frame_probe.gd")
const GpuBallast := preload("res://debug/gpu_ballast.gd")
const PROTOCOL := 1
const MAX_LINE_BYTES := 1 << 20
## Composite actions the harness scripts use (the browser scaffold's names) mapped onto InputMap actions:
## [negative action, positive action]. Any InputMap action name also works directly.
const COMPOSITE := {
	"throttle": ["brake", "throttle"],
	"steer": ["steer_left", "steer_right"],
}
const METHODS := [
	"ping", "state", "clock", "frames", "input", "perf", "load", "teleport", "setCamera", "timeScale", "hold",
	"events", "hud", "shot", "quality", "timeOfDay", "bench", "stream", "quit",
]
const QUALITY_PRESETS := ["low", "medium", "high"]

var port := 0
var listening := false
var _server := TCPServer.new()
var _clients: Array[Dictionary] = []
var _pressed := {}
var _camera: Camera3D = null
var _prev_camera: Camera3D = null
var _hud_on := true
var _overlay: CanvasLayer = null
var _overlay_label: Label = null
var _logger: DebugLogger = null
var _quitting := false
var _ballast: Node = null
var _probe_start: Node = null
## Headless runs (DisplayServer "headless") draw nothing, so frame_post_draw never fires: frames end on process_frame.
var _headless := false


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_headless = DisplayServer.get_name() == "headless"
	var args := _args()
	port = args.debug_port if args != null else 47181
	var err := _server.listen(port, "127.0.0.1")
	listening = err == OK
	if listening:
		print("debug server: listening on 127.0.0.1:%d" % port)
	else:
		# Not push_error: a busy port is a setup problem the harness reports from this line.
		print("debug server: could not listen on 127.0.0.1:%d (error %d)" % [port, err])
	_logger = DebugLogger.new()
	OS.add_logger(_logger)
	_make_overlay(args != null and args.verify)
	_probe_start = FrameProbe.new()
	var probe_end := FrameProbe.new()
	_probe_start.setup(true, null)
	probe_end.setup(false, _probe_start)
	add_child(_probe_start)
	add_child(probe_end)
	_frame_signal().connect(_after_draw)


func _exit_tree() -> void:
	if _logger != null:
		OS.remove_logger(_logger)
	if _frame_signal().is_connected(_after_draw):
		_frame_signal().disconnect(_after_draw)
	for c in _clients:
		c.peer.disconnect_from_host()
	_server.stop()


func _process(_delta: float) -> void:
	for e in _logger.drain():
		_events().emit_event("error", e)
	while listening and _server.is_connection_available():
		var peer := _server.take_connection()
		peer.set_no_delay(true)
		var c := {"peer": peer, "buf": PackedByteArray(), "last_seq": _events().seq}
		_clients.append(c)
		_send(c, {"type": "hello", "protocol": PROTOCOL, "version": _version(), "port": port, "methods": METHODS,
			"args": _args().as_dict(), "ready": _ready_now(), "frame": _frame_no(), "headless": _headless,
			"renderer": _renderer()})
	for c in _clients.duplicate():
		_read(c)
	if _overlay_label != null and _overlay.visible:
		_overlay_label.text = "DEBUG 127.0.0.1:%d  %d fps  sim %.2f s%s" % [
			port, Engine.get_frames_per_second(), _clock().t, "  HELD" if _clock().paused else ""]


# ---------------------------------------------------------------- transport


func _read(c: Dictionary) -> void:
	var peer: StreamPeerTCP = c.peer
	peer.poll()
	var st := peer.get_status()
	if st != StreamPeerTCP.STATUS_CONNECTED:
		if st != StreamPeerTCP.STATUS_CONNECTING:
			_clients.erase(c)
		return
	var n := peer.get_available_bytes()
	if n > 0:
		var got: Array = peer.get_data(n)
		if got[0] == OK:
			c.buf.append_array(got[1])
	var i: int = c.buf.find(10)
	while i >= 0:
		var line: String = c.buf.slice(0, i).get_string_from_utf8()
		c.buf = c.buf.slice(i + 1)
		if line.strip_edges() != "":
			_dispatch(c, line)
		i = c.buf.find(10)
	if c.buf.size() > MAX_LINE_BYTES:
		c.buf = PackedByteArray()
		_send(c, {"type": "response", "id": null, "ok": false, "error": "line over %d bytes dropped" % MAX_LINE_BYTES})


func _send(c: Dictionary, msg: Dictionary) -> void:
	var peer: StreamPeerTCP = c.peer
	if peer.get_status() != StreamPeerTCP.STATUS_CONNECTED:
		return
	peer.put_data((JSON.stringify(msg) + "\n").to_utf8_buffer())


func _dispatch(c: Dictionary, line: String) -> void:
	var msg = JSON.parse_string(line)
	if not (msg is Dictionary):
		_send(c, {"type": "response", "id": null, "ok": false, "error": "not a JSON object: %s" % line.left(120)})
		return
	_handle(c, msg)


## A coroutine per request: async hooks (frames, perf, load, shot) answer when they finish, others at once.
func _handle(c: Dictionary, msg: Dictionary) -> void:
	var id = msg.get("id")
	var method := str(msg.get("method", ""))
	var args: Array = msg.args if msg.get("args") is Array else []
	var out: Dictionary = await _call(method, args)
	var reply := {"type": "response", "id": id, "ok": out.ok}
	if out.ok:
		reply["result"] = out.get("result")
	else:
		reply["error"] = out.error
	_send(c, reply)
	if method == "quit" and out.ok and not _quitting:
		_quitting = true
		await _frame_signal()
		get_tree().quit(0)


static func _ok(result: Variant = null) -> Dictionary:
	return {"ok": true, "result": result}


static func _fail(error: String) -> Dictionary:
	return {"ok": false, "error": error}


func _call(method: String, a: Array) -> Dictionary:
	match method:
		"ping":
			return _ok({"frame": _frame_no()})
		"state":
			return _ok(state())
		"clock":
			return _ok(_clock().state())
		"hold":
			var o = a[0] if a.size() > 0 else {}
			if o == null:
				o = {}
			if not (o is Dictionary):
				return _fail("hold(opts): opts must be an object")
			return _ok(_clock().hold(o))
		"events":
			return _ok(_events().ring.duplicate())
		"timeScale":
			if a.is_empty() or not (a[0] is float or a[0] is int) or float(a[0]) < 0.0:
				return _fail("timeScale(n): n must be a number >= 0")
			_clock().set_scale(float(a[0]))
			return _ok(_clock().state())
		"input":
			if a.size() < 2 or not (a[0] is String):
				return _fail("input(action, value): needs an action name and a value")
			var why := _drive_input(a[0], a[1])
			return _ok(true) if why == "" else _fail(why)
		"frames":
			var n := int(a[0]) if a.size() > 0 and (a[0] is float or a[0] is int) else 1
			for k in maxi(1, n):
				await _frame_signal()
			return _ok({"frame": _frame_no()})
		"perf":
			if _headless:
				return _fail("perf: a headless run renders nothing, so it has no frame times (run the scenario windowed)")
			var ms := float(a[0]) if a.size() > 0 and (a[0] is float or a[0] is int) else 1000.0
			return _ok(await _perf(clampf(ms, 50.0, 60000.0)))
		"load":
			if a.is_empty() or not (a[0] is String):
				return _fail("load(id): id must be a string")
			return await _load(a[0])
		"teleport":
			return _ok(await _teleport(a[0] if a.size() > 0 else null))
		"stream":
			return await _stream_probe().hook(a)
		"setCamera":
			return _set_camera(a[0] if a.size() > 0 else null)
		"hud":
			_hud_on = bool(a[0]) if a.size() > 0 else true
			var count := 0
			for node in get_tree().get_nodes_in_group("hud"):
				if "visible" in node:
					node.visible = _hud_on
					count += 1
			return _ok({"hud": _hud_on, "nodes": count})
		"shot":
			if a.is_empty() or not (a[0] is String) or not String(a[0]).is_absolute_path():
				return _fail("shot(path): path must be an absolute file path")
			return await _shot(a[0])
		"quality":
			if a.size() > 0 and a[0] != null:
				if not (a[0] in QUALITY_PRESETS):
					return _fail("quality(name): unknown preset %s (presets %s)" % [a[0], QUALITY_PRESETS])
				_args().quality = a[0]
				_events().emit_event("quality", {"preset": a[0]})
			return _ok({"preset": _args().quality, "presets": QUALITY_PRESETS})
		"timeOfDay":
			var t = a[0] if a.size() > 0 and a[0] != null else {}
			if not (t is Dictionary):
				return _fail("timeOfDay(opts): opts must be an object {hour, rate, pin, reload}")
			for k in ["hour", "rate"]:
				if t.has(k) and t[k] != null and not (t[k] is float or t[k] is int):
					return _fail("timeOfDay(opts): %s must be a number" % k)
			if t.has("rate") and t.rate != null and float(t.rate) < 0.0:
				return _fail("timeOfDay(opts): rate must be >= 0 (game hours per sim second)")
			var before: Dictionary = _day().state()
			_day().set_time(t)
			if before.hour != _day().hour or before.rate != _day().rate or before.pinned != _day().pinned:
				_events().emit_event("time:set", _day().state())
			if t.get("reload", false) and _args().current_scene_id() != "":
				# the look follows the clock when a scene loads: reload the current one to see the new hour
				var r: Dictionary = await _load(_args().current_scene_id())
				if not r.ok:
					return r
			return _ok(time_state())
		"bench":
			# bench('ballast', {n}) and bench('blank', {on}) work in any scene (honest GPU readings under this Mac's 120 fps
			# cap, harness/bin/ballast.mjs). Every other command goes to the bench scene's bench_call(cmd, opts) (--arch=<name>).
			if a.size() > 0 and (a[0] == "ballast" or a[0] == "blank"):
				var o = a[1] if a.size() > 1 and a[1] is Dictionary else {}
				if a[0] == "blank":
					# on: the root viewport draws no 3D, so a perf window measures the ballast alone
					get_viewport().disable_3d = bool(o.get("on", false))
					return _ok({"blank": get_viewport().disable_3d})
				if _headless:
					return _fail("bench(ballast): a headless run renders nothing")
				if _ballast == null:
					_ballast = GpuBallast.new()
					_ballast.name = "GpuBallast"
					add_child(_ballast)
				return _ok({"n": _ballast.set_load(int(o.get("n", 0)))})
			var scene := get_tree().current_scene
			if scene == null or not scene.has_method("bench_call"):
				return _fail("bench(cmd, opts): the current scene is not a bench scene (start the game with --arch=<name>)")
			if a.is_empty() or not (a[0] is String):
				return _fail("bench(cmd, opts): cmd must be a string")
			var bopts = a[1] if a.size() > 1 and a[1] is Dictionary else {}
			var res = await scene.bench_call(a[0], bopts)
			if res is Dictionary and res.has("error"):
				return _fail("bench(%s): %s" % [a[0], res.error])
			return _ok(res)
		"quit":
			return _ok(true)
	return _fail("unknown method '%s' (methods: %s)" % [method, ", ".join(METHODS)])


# ---------------------------------------------------------------- snapshot


func _after_draw() -> void:
	if _clients.is_empty():
		return
	var st := state()
	var clock: Dictionary = _clock().state()
	var hold: Dictionary = _clock().hold_state()
	var ev := _events()
	for c in _clients:
		var snap := {
			"type": "snapshot", "frame": _frame_no(), "w": Time.get_ticks_msec(), "ready": _ready_now(),
			"state": st, "clock": clock, "hold": hold, "events": ev.since(c.last_seq),
		}
		c.last_seq = ev.seq
		_send(c, snap)


func state() -> Dictionary:
	var gargs := _args()
	var id: String = gargs.current_scene_id()
	var player = null
	var p := get_tree().get_first_node_in_group("player") as Node3D
	if p != null:
		var pos := p.global_position
		player = {"pos": [pos.x, pos.y, pos.z], "grounded": true}
		if "model" in p:
			player["heading"] = p.model.heading
			player["speed"] = p.model.speed
	var cam := get_viewport().get_camera_3d()
	var camera = null
	if cam != null:
		var cp := cam.global_position
		var look := -cam.global_transform.basis.z
		camera = {"pos": [cp.x, cp.y, cp.z], "dir": [look.x, look.y, look.z], "fov": cam.fov,
			"override": _camera != null and cam == _camera}
	var block := get_tree().get_first_node_in_group("world_stream")
	return {
		"scene": id, "level": id, "milestone": null, "player": player, "camera": camera, "hud": _hud_on,
		"world": block.info() if block != null else null,
		"debugOverlay": _overlay != null and _overlay.visible, "quality": gargs.quality, "style": gargs.style, "light": gargs.light,
		"arch": gargs.arch, "lockstep": gargs.lockstep, "time": time_state(), "frame": _frame_no(),
	}


## The time of day: the day clock (game/core/day_clock.gd) {hour, clock, rate, pinned} plus the look's own hour
## (`lookHour`, the hour the current scene's light was built for; null with --style=none) and its light id.
func time_state() -> Dictionary:
	var out: Dictionary = _day().state()
	var look: Dictionary = _args().look()
	out["lookHour"] = look.hour
	out["light"] = look.light
	return out


# ---------------------------------------------------------------- hooks


## Drives the game's action layer like a player: Input.action_press with a strength, release at 0.
func _drive_input(action: String, value: Variant) -> String:
	var v := 0.0
	if value is bool:
		v = 1.0 if value else 0.0
	elif value is float or value is int:
		v = float(value)
	else:
		return "input(%s, value): value must be a number or a boolean" % action
	if COMPOSITE.has(action):
		_press(COMPOSITE[action][0], maxf(0.0, -v))
		_press(COMPOSITE[action][1], maxf(0.0, v))
		return ""
	if not InputMap.has_action(action):
		return "unknown action '%s' (InputMap actions or %s)" % [action, ", ".join(COMPOSITE.keys())]
	_press(action, absf(v))
	return ""


func _press(action: String, strength: float) -> void:
	if strength > 0.0:
		Input.action_press(action, clampf(strength, 0.0, 1.0))
		_pressed[action] = true
	else:
		Input.action_release(action)
		_pressed.erase(action)


func _release_all() -> void:
	for action in _pressed.keys():
		Input.action_release(action)
	_pressed.clear()


func _perf(ms: float) -> Dictionary:
	var vp := get_viewport().get_viewport_rid()
	RenderingServer.viewport_set_measure_render_time(vp, true)
	await _frame_signal()
	var cpu: Array[float] = []
	var gpu: Array[float] = []
	var frame: Array[float] = []
	var calls: Array[float] = []
	var tris: Array[float] = []
	var start := Time.get_ticks_usec()
	var last := start
	while float(Time.get_ticks_usec() - start) < ms * 1000.0:
		await _frame_signal()
		var now := Time.get_ticks_usec()
		frame.append((now - last) / 1000.0)
		last = now
		var render_cpu := RenderingServer.viewport_get_measured_render_time_cpu(vp) + RenderingServer.get_frame_setup_time_cpu()
		cpu.append(render_cpu + float(_probe_start.logic_ms))
		gpu.append(RenderingServer.viewport_get_measured_render_time_gpu(vp))
		calls.append(RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME))
		tris.append(RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME))
	var avg_frame := Stats.mean(frame)
	var mb := 1024.0 * 1024.0
	var out := {
		"windowMs": ms, "frames": frame.size(),
		"cpuMs": Stats.stats(cpu),
		"p95FrameMs": Stats.stats(frame).p95,
		"frameMs": Stats.stats(frame),
		"avgFps": 1000.0 / avg_frame if avg_frame > 0.0 else 0.0,
		"drawCalls": Stats.stats(calls).max, "drawCallsAvg": Stats.mean(calls),
		"triangles": Stats.stats(tris).max, "trianglesAvg": Stats.mean(tris),
		"gpuMB": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_VIDEO_MEM_USED) / mb,
		"textureMB": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TEXTURE_MEM_USED) / mb,
		"bufferMB": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_BUFFER_MEM_USED) / mb,
		"renderer": RenderingServer.get_video_adapter_name(),
	}
	if Stats.stats(gpu).max > 0.0:
		out["gpuMs"] = Stats.stats(gpu)
	else:
		out["gpuNote"] = "the renderer reported no GPU time: the Metal driver gives no timestamp queries in Godot 4.7 (run with the engine arg --rendering-driver vulkan for gpuMs), or the game runs headless"
	return out


func _load(id: String) -> Dictionary:
	var path: String = _args().scene_path(id)
	if path == "":
		return _fail("load('%s'): unknown scene id (ids: %s)" % [id, ", ".join(_args().scene_ids())])
	_release_all()
	_clear_camera()
	var err := get_tree().change_scene_to_file(path)
	if err != OK:
		return _fail("load('%s'): change_scene_to_file returned %d" % [id, err])
	# The swap happens at the end of this frame; two drawn frames later the new scene is on screen.
	await get_tree().process_frame
	await get_tree().process_frame
	await _frame_signal()
	await _frame_signal()
	if _args().tiles != "" and get_tree().current_scene != null and get_tree().current_scene.get_node_or_null("World/Car") != null:
		_args().attach_tiles() # the scaffold's car streams the --tiles folder again; the answer waits for its first ring
		while not _args().world_ready:
			await get_tree().process_frame
	_events().emit_event("scene:load", {"id": id})
	return _ok({"scene": _args().current_scene_id()})


## Staging only (never in a milestone play script): puts the player at [x, y, z] and stops it. On the scaffold y is
## ignored (the car is on the flat ground). In the streamed city it answers only when the ring round the target is
## attached with its colliders and the player stands on the ground there (game/world/world_stream.gd teleport).
## Names are anchors in the group "anchor"; there are none yet, so a name returns false.
func _teleport(where: Variant) -> bool:
	var p := get_tree().get_first_node_in_group("player") as Node3D
	if p == null:
		return false
	if where is Array and where.size() == 3:
		var city := get_tree().get_first_node_in_group("world_stream")
		if city != null:
			if not await city.teleport(p, Vector3(float(where[0]), float(where[1]), float(where[2]))):
				return false
		elif p.has_method("place"):
			p.place(float(where[0]), float(where[2]))
		else:
			p.global_position = Vector3(float(where[0]), float(where[1]), float(where[2]))
		_events().emit_event("teleport", {"pos": where})
		return true
	if where is String:
		for a in get_tree().get_nodes_in_group("anchor"):
			if a is Node3D and a.name == where:
				var ap: Vector3 = a.global_position
				return await _teleport([ap.x, ap.y, ap.z])
	return false


## {pos, target} puts a debug camera there until null hands back to the game camera.
func _set_camera(pose: Variant) -> Dictionary:
	if pose == null:
		_clear_camera()
		return _ok(true)
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
	return _ok(true)


func _clear_camera() -> void:
	if _camera != null and is_instance_valid(_camera):
		_camera.queue_free()
	_camera = null
	if _prev_camera != null and is_instance_valid(_prev_camera):
		_prev_camera.make_current()
	_prev_camera = null


func _shot(path: String) -> Dictionary:
	if _headless:
		return _fail("shot: a headless run renders nothing (run the scenario windowed)")
	var dir := path.get_base_dir()
	if not DirAccess.dir_exists_absolute(dir):
		DirAccess.make_dir_recursive_absolute(dir)
	await _frame_signal()
	var img := get_viewport().get_texture().get_image()
	if img == null or img.is_empty():
		return _fail("shot: the viewport gave no image (headless?)")
	var err := img.save_png(path)
	if err != OK:
		return _fail("shot: could not save %s (error %d)" % [path, err])
	return _ok({"path": path, "width": img.get_width(), "height": img.get_height(), "frame": _frame_no()})


# ---------------------------------------------------------------- helpers


func _make_overlay(verify: bool) -> void:
	_overlay = CanvasLayer.new()
	_overlay.name = "DebugOverlay"
	_overlay.layer = 128
	_overlay.add_to_group("debug_overlay")
	_overlay_label = Label.new()
	_overlay_label.position = Vector2(8, 6)
	_overlay_label.add_theme_color_override("font_color", Color(1, 1, 1))
	_overlay_label.add_theme_color_override("font_outline_color", Color(0, 0, 0))
	_overlay_label.add_theme_constant_override("outline_size", 4)
	_overlay.add_child(_overlay_label)
	# --verify hides every debug overlay, so shots never show it.
	_overlay.visible = not verify
	add_child(_overlay)


## The signal that ends a frame: frame_post_draw when the game draws, process_frame when headless.
func _frame_signal() -> Signal:
	return get_tree().process_frame if _headless else RenderingServer.frame_post_draw


## Frames so far: drawn frames, or process frames when headless.
func _frame_no() -> int:
	return Engine.get_process_frames() if _headless else Engine.get_frames_drawn()


## What renders the game (in the hello, so a report names the GPU and driver).
func _renderer() -> Dictionary:
	return {
		"adapter": RenderingServer.get_video_adapter_name(), "vendor": RenderingServer.get_video_adapter_vendor(),
		"driver": RenderingServer.get_current_rendering_driver_name(),
		"method": RenderingServer.get_current_rendering_method(),
	}


func _ready_now() -> bool:
	return _frame_no() > 0 and get_tree().current_scene != null and _args().world_ready


## The streamed city's probes (stream_probe.gd: info, path, record, probe, mem), made on first use.
func _stream_probe() -> Node:
	var probe := get_node_or_null("StreamProbe")
	if probe == null:
		probe = load("res://debug/stream_probe.gd").new()
		probe.name = "StreamProbe"
		add_child(probe)
	return probe


func _version() -> String:
	return str(ProjectSettings.get_setting("application/config/version", "0.0.0"))


func _args() -> Node:
	return get_node("/root/GameArgs")


func _clock() -> Node:
	return get_node("/root/SimClock")


func _day() -> Node:
	return get_node("/root/DayClock")


func _events() -> Node:
	return get_node("/root/GameEvents")
