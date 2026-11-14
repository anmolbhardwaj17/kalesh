## The debug server: docs/GAME_HOOKS.md inside the Godot game, for the harness. Added under /root as "DebugServer"
## by GameArgs only when the game starts with the user arg --debug. Without it this script is never loaded.
##
## Transport (docs/GAME_HOOKS.md "Godot transport"): TCP on 127.0.0.1:<--debug-port>, newline-delimited JSON, UTF-8.
##   client -> game  {"id": 7, "method": "state", "args": []}
##   game -> client  {"type": "response", "id": 7, "ok": true, "result": ...}  or  {"type": "response", "id": 7,
##                   "ok": false, "error": "..."}
##   game -> client  {"type": "hello", ...} once on connect, then {"type": "snapshot", ...} after every drawn frame
##                   (state, clock, hold and the events since the last snapshot).
## Writes never block a frame: each client has an out queue (debug_peer.gd); a snapshot is skipped for a client that is
## behind. The perf hooks live in debug_perf.gd, setCamera and shot in debug_camera.gd, stream in stream_probe.gd, vehicle in vehicle_probe.gd, foot in foot_probe.gd.
## Expected problems (unknown method, bad args, unknown scene) are error responses, never push_error.
extends Node

const DebugLogger := preload("res://debug/debug_logger.gd")
const DebugPeer := preload("res://debug/debug_peer.gd")
const DebugPerf := preload("res://debug/debug_perf.gd")
const DebugCamera := preload("res://debug/debug_camera.gd")
const DebugInput := preload("res://debug/debug_input.gd")
const PROTOCOL := 1
const METHODS := [
	"ping", "state", "clock", "frames", "input", "perf", "load", "teleport", "setCamera", "timeScale", "hold",
	"events", "hud", "shot", "quality", "timeOfDay", "bench", "stream", "vehicle", "foot", "traffic", "gps", "quit",
]
const QUALITY_PRESETS := ["low", "medium", "high"]

var port := 0
var listening := false
var _server := TCPServer.new()
var _clients: Array[DebugPeer] = []
var _hud_on := true
var _overlay: CanvasLayer = null
var _overlay_label: Label = null
var _logger: DebugLogger = null
var _quitting := false
var _perf: DebugPerf = null
var _cam: DebugCamera = null
var _input := DebugInput.new()
## Headless runs (DisplayServer "headless") draw nothing, so frame_post_draw never fires: frames end on process_frame.
var _headless := false


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_headless = DisplayServer.get_name() == "headless"
	# The harness parks its windows far outside every display (HARNESS_PARK_WINDOW=1, harness/bin/godot.mjs). A borderless
	# window is not clamped back onto a screen by macOS, a titled one is.
	if not _headless and OS.get_environment("HARNESS_PARK_WINDOW") != "":
		DisplayServer.window_set_flag(DisplayServer.WINDOW_FLAG_BORDERLESS, true)
		DisplayServer.window_set_position(Vector2i(30000, 30000))
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
	_perf = DebugPerf.new()
	_perf.name = "DebugPerf"
	_perf.headless = _headless
	add_child(_perf)
	_cam = DebugCamera.new()
	_cam.name = "DebugCameraHook"
	_cam.headless = _headless
	add_child(_cam)
	_frame_signal().connect(_after_draw)


func _exit_tree() -> void:
	if _logger != null:
		OS.remove_logger(_logger)
	if _frame_signal().is_connected(_after_draw):
		_frame_signal().disconnect(_after_draw)
	for c in _clients:
		c.flush()
		c.close()
	_server.stop()


func _process(delta: float) -> void:
	_keep_drawing(delta)
	for e in _logger.drain():
		_events().emit_event("error", e)
	while listening and _server.is_connection_available():
		var peer := _server.take_connection()
		peer.set_no_delay(true)
		var c := DebugPeer.new(peer, _events().seq)
		_clients.append(c)
		_send(c, {"type": "hello", "protocol": PROTOCOL, "version": _version(), "port": port, "methods": METHODS,
			"args": _args().as_dict(), "ready": _ready_now(), "frame": _frame_no(), "headless": _headless,
			"renderer": _renderer()})
	for c in _clients.duplicate():
		_read(c)
	for c in _clients:
		c.flush()
	if _overlay_label != null and _overlay.visible:
		_overlay_label.text = "DEBUG 127.0.0.1:%d  %d fps  sim %.2f s%s" % [
			port, Engine.get_frames_per_second(), _clock().t, "  HELD" if _clock().paused else ""]


# ---------------------------------------------------------------- transport


func _read(c: DebugPeer) -> void:
	c.peer.poll()
	if not c.alive():
		if not c.connecting():
			_clients.erase(c)
		return
	for line in c.read_lines():
		_dispatch(c, line)


## Queues the message and hands what the socket takes now to it; never waits for the client.
func _send(c: DebugPeer, msg: Dictionary) -> void:
	if c.alive():
		c.enqueue(msg)
		c.flush()


func _dispatch(c: DebugPeer, line: String) -> void:
	var msg = JSON.parse_string(line)
	if not (msg is Dictionary):
		_send(c, {"type": "response", "id": null, "ok": false, "error": "not a JSON object: %s" % line.left(120)})
		return
	_handle(c, msg)


## A coroutine per request: async hooks (frames, perf, load, shot) answer when they finish, others at once.
func _handle(c: DebugPeer, msg: Dictionary) -> void:
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
			var why := _input.drive(a[0], a[1])
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
			var forced0 := forced_draws
			var pr: Dictionary = await _perf.perf(clampf(ms, 50.0, 60000.0))
			pr["forcedDraws"] = forced_draws - forced0 # frames drawn by hand because the window was covered
			return _ok(pr)
		"load":
			if a.is_empty() or not (a[0] is String):
				return _fail("load(id): id must be a string")
			return await _load(a[0])
		"teleport":
			return _ok(await _teleport(a[0] if a.size() > 0 else null))
		"stream":
			return await _stream_probe().hook(a)
		"vehicle":
			return await _vehicle_probe().hook(a)
		"foot":
			return await _foot_probe().hook(a)
		"city":
			return await _city_probe().hook(a)
		"traffic", "gps":
			return _route_probe().hook(method, a)
		"setCamera":
			return _cam.set_camera(a[0] if a.size() > 0 else null)
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
			return await _cam.shot(a[0])
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
				return _perf.bench(a[0], a[1] if a.size() > 1 and a[1] is Dictionary else {})
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
		if not c.alive():
			continue
		var snap := {
			"type": "snapshot", "frame": _frame_no(), "w": Time.get_ticks_msec(), "ready": _ready_now(),
			"state": st, "clock": clock, "hold": hold, "events": ev.since(c.last_seq),
		}
		# skipped while the client is behind: last_seq stays, so the next snapshot carries these events
		if c.enqueue(snap, true):
			c.last_seq = ev.seq
		c.flush()


func state() -> Dictionary:
	var gargs := _args()
	var id: String = gargs.current_scene_id()
	var player = null
	var p := get_tree().get_first_node_in_group("player") as Node3D
	if p != null:
		var pos := p.global_position
		var grounded := true
		if p.has_method("foot_position"):
			# the V2 vehicle: where it meets the ground at rest, its heading and its speed along it
			pos = p.foot_position()
			grounded = p.contact_count() > 0 or p.freeze
		elif p.has_method("is_grounded"):
			grounded = p.is_grounded()
		player = {"pos": [pos.x, pos.y, pos.z], "grounded": grounded}
		# P1-022: on foot or driving (game/characters/player_mode.gd); a scene with no PlayerMode reports its player
		var pm := get_tree().get_first_node_in_group("player_mode")
		player["mode"] = pm.get("mode") if pm != null else ("vehicle" if p.has_method("foot_position") else "foot")
		if "heading" in p:
			player["heading"] = p.heading
			player["speed"] = p.speed
	var cam := get_viewport().get_camera_3d()
	var camera = null
	if cam != null:
		var cp := cam.global_position
		var look := -cam.global_transform.basis.z
		camera = {"pos": [cp.x, cp.y, cp.z], "dir": [look.x, look.y, look.z], "fov": cam.fov,
			"override": _cam.is_override(cam)}
	var block := get_tree().get_first_node_in_group("world_stream")
	return {
		"scene": id, "level": id, "milestone": null, "player": player, "camera": camera, "hud": _hud_on,
		"world": block.info() if block != null else null,
		"debugOverlay": _overlay != null and _overlay.visible, "quality": gargs.quality, "style": gargs.style, "light": gargs.light,
		"arch": gargs.arch, "lockstep": gargs.lockstep, "time": time_state(), "frame": _frame_no(),
	}


## The time of day: the day clock (game/core/day_clock.gd) {hour, clock, rate, pinned} plus the look's own hour
## (`lookHour`, the hour the current scene's light was built for or last relit to; null with --style=none), its light
## id and `live` (P1-028: builds, relights, relightMsMax, night, windowShare, nightLights, nightLightsOn, ...).
func time_state() -> Dictionary:
	var out: Dictionary = _day().state()
	var look: Dictionary = _args().look()
	out["lookHour"] = look.hour
	out["light"] = look.light
	out["live"] = look.get("live")
	return out


# ---------------------------------------------------------------- hooks


func _load(id: String) -> Dictionary:
	var path: String = _args().scene_path(id)
	if path == "":
		return _fail("load('%s'): unknown scene id (ids: %s)" % [id, ", ".join(_args().scene_ids())])
	_input.release_all()
	_cam.clear()
	var err := get_tree().change_scene_to_file(path)
	if err != OK:
		return _fail("load('%s'): change_scene_to_file returned %d" % [id, err])
	# The swap happens at the end of this frame; two drawn frames later the new scene is on screen.
	await get_tree().process_frame
	await get_tree().process_frame
	await _frame_signal()
	await _frame_signal()
	if _args().tiles_for(id) != "" and get_tree().current_scene != null and get_tree().current_scene.get_node_or_null("World/Car") != null:
		_args().attach_tiles() # the city (or the scaffold with --tiles) streams its tiles again; the answer waits for its first ring
		while not _args().world_ready:
			await get_tree().process_frame
	_events().emit_event("scene:load", {"id": id})
	return _ok({"scene": _args().current_scene_id()})


## Staging only (never in a milestone play script): puts the player at [x, y, z] (or [x, y, z, heading], a vehicle's
## compass heading in radians, P2-032) and stops it. On the scaffold y is
## ignored (the car is on the flat ground). In the streamed city it answers only when the ring round the target is
## attached with its colliders and the player stands on the ground there (game/world/world_stream.gd teleport).
## Names are anchors in the group "anchor"; there are none yet, so a name returns false.
func _teleport(where: Variant) -> bool:
	var p := get_tree().get_first_node_in_group("player") as Node3D
	if p == null:
		return false
	if where is Array and (where.size() == 3 or where.size() == 4):
		var city := get_tree().get_first_node_in_group("world_stream")
		# P2-032: a fourth number is the vehicle's compass heading (radians), so a staged drive starts along its lane
		var h := float(where[3]) if where.size() == 4 else NAN
		if city != null:
			if not await city.teleport(p, Vector3(float(where[0]), float(where[1]), float(where[2])), h):
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


## macOS skips the draw of a window that is fully covered by other windows (Godot's can_any_window_draw checks the
## occlusion state), so frame_post_draw, frames_drawn, shots and perf windows stop while the game logic keeps running
## (P1-047). A harness run must not depend on whether the owner's terminal is in front: when no frame was drawn for
## OCCLUDED_AFTER process frames, draw one by hand (RenderingServer.force_draw, no buffer swap) every process frame.
const OCCLUDED_AFTER := 3
var _seen_drawn := -1
var _idle_frames := 0
var forced_draws := 0


func _keep_drawing(delta: float) -> void:
	if _headless:
		return
	var drawn := Engine.get_frames_drawn()
	if drawn != _seen_drawn:
		_seen_drawn = drawn
		_idle_frames = 0
		return
	_idle_frames += 1
	if _idle_frames >= OCCLUDED_AFTER:
		forced_draws += 1
		# (with the frame's step: a forced draw with no step freezes shader TIME, so nothing a shader animates moves in
		# the shots of a covered or parked window: the running sign borders of P2-048 stood still)
		RenderingServer.force_draw(false, delta)
		_seen_drawn = Engine.get_frames_drawn()


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


## The on-foot probes (foot_probe.gd: info, stage, run, camrec, cost), made on first use (P1-022).
func _foot_probe() -> Node:
	var probe := get_node_or_null("FootProbe")
	if probe == null:
		probe = load("res://debug/foot_probe.gd").new()
		probe.name = "FootProbe"
		add_child(probe)
	return probe


## The city checks (city_probe.gd: pins, geo, screen, mirror, surface, watch), made on first use (P1-024).
func _city_probe() -> Node:
	var probe := get_node_or_null("CityProbe")
	if probe == null:
		probe = load("res://debug/city_probe.gd").new()
		probe.name = "CityProbe"
		add_child(probe)
	return probe


## The traffic stand-in and the route line (route_probe.gd: traffic and gps), made on first use (P2-045).
func _route_probe() -> Node:
	var probe := get_node_or_null("RouteProbe")
	if probe == null:
		probe = load("res://debug/route_probe.gd").new()
		probe.name = "RouteProbe"
		add_child(probe)
	return probe


## The V2 vehicle's probes (vehicle_probe.gd: info, run, cost, camrec), made on first use.
func _vehicle_probe() -> Node:
	var probe := get_node_or_null("VehicleProbe")
	if probe == null:
		probe = load("res://debug/vehicle_probe.gd").new()
		probe.name = "VehicleProbe"
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
