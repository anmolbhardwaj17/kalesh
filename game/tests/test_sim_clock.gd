## The core runtime (P1-006): Jolt by name, the C1 sim clock in the running engine, and who may step.
## - The physics engine setting reads "Jolt Physics" and the running server is Jolt (named by its space state class,
##   the way the physics bench did; DEFAULT resolves to GodotPhysics3D on 4.7.2).
## - Replay: one input script (the V2 car's actions plus a force on a falling rigid body) ends at the same place at time
##   scale 0.25, 1 and 4, and a run held and resumed (from inside a tick and between frames) equals a run never held.
##   These runs use the autoload SimClock and real engine physics frames, so they take about 10 s of wall time.
## - Only the clock and the camera files have a _physics_process (every other system steps on SimClock.sim_tick).
extends RefCounted

const Car := preload("res://vehicles/vehicle.gd")

## Ticks of the input script and the tick the held runs stop at.
const N := 96
const HOLD_TICK := 40
## Physics frames a held run stays held.
const HELD_FRAMES := 20
## Safety limit on any wait, in physics frames.
const WAIT_LIMIT := 3000
const TOL_M := 0.001
## The only files that may define _physics_process outside game/bench/: the clock, and cameras (*camera.gd).
const PHYSICS_PROCESS_ALLOWED := ["res://core/sim_clock.gd"]

var t
var tree: SceneTree

var _clock: Node
var _world: Node3D
var _car: RigidBody3D
var _box: RigidBody3D
var _start := 0


func test_physics_engine_is_jolt_by_name_and_running() -> void:
	t.ok(str(ProjectSettings.get_setting("physics/3d/physics_engine")) == "Jolt Physics",
		"project setting physics/3d/physics_engine is \"Jolt Physics\" (got %s)" % ProjectSettings.get_setting("physics/3d/physics_engine"))
	var state := tree.root.get_world_3d().direct_space_state
	var cls := state.get_class() if state != null else "none"
	t.ok(cls.begins_with("Jolt"), "the running physics server is Jolt (space state class %s)" % cls)


func test_only_the_clock_and_cameras_have_physics_process() -> void:
	var files: Array[String] = []
	_gd_files("res://", files)
	var re := RegEx.create_from_string("(?m)^\\s*func\\s+_physics_process\\b")
	var found: Array[String] = []
	for f in files:
		if f.begins_with("res://bench/"):
			continue
		if re.search(FileAccess.get_file_as_string(f)) != null:
			found.append(f)
	t.ok(files.size() > 20, "the scan sees the game's scripts (%d files)" % files.size())
	t.ok(found.has("res://core/sim_clock.gd"), "the sim clock steps on _physics_process")
	t.ok(found.any(func(f: String) -> bool: return f.ends_with("camera.gd")), "a camera follows on _physics_process")
	for f in found:
		t.ok(PHYSICS_PROCESS_ALLOWED.has(f) or f.get_file().ends_with("camera.gd"),
			"%s has a _physics_process: step on SimClock.sim_tick instead (only the clock and cameras may)" % f)


func test_replay_same_end_at_any_time_scale_and_after_a_hold() -> void:
	_clock = tree.root.get_node("SimClock")
	var ref: Dictionary = await _run(1.0, "")
	var slow: Dictionary = await _run(0.25, "")
	var fast: Dictionary = await _run(4.0, "")
	var held_tick: Dictionary = await _run(1.0, "tick")
	var held_between: Dictionary = await _run(4.0, "between")
	_clock.set_scale(1.0)
	t.ok(ref.ok and slow.ok and fast.ok and held_tick.ok and held_between.ok, "every run reached tick %d (%s %s %s %s %s)" % [N, ref.ok, slow.ok, fast.ok, held_tick.ok, held_between.ok])
	t.ok(Vector2((ref.car as Vector3).x, (ref.car as Vector3).z).length() > 1.0, "the car drove (%s)" % ref.car)
	t.ok(absf((ref.box as Vector3).y - 2.5) > 1.0 and absf((ref.box as Vector3).z) > 0.5, "the box fell and was pushed (%s)" % ref.box)
	for pair in [["scale 0.25", slow], ["scale 4", fast], ["held inside a tick at scale 1", held_tick], ["held between frames at scale 4", held_between]]:
		var r: Dictionary = pair[1]
		var dc := (r.car as Vector3).distance_to(ref.car)
		var db := (r.box as Vector3).distance_to(ref.box)
		t.less(maxf(dc, db), TOL_M, "%s ends where scale 1 ends (car %.6f m, box %.6f m)" % [pair[0], dc, db])
		print("    replay %s: car %.7f m, box %.7f m from the scale 1 run (wall %d ms)" % [pair[0], dc, db, r.wallMs])
	for pair in [["inside a tick", held_tick], ["between frames", held_between]]:
		var r: Dictionary = pair[1]
		t.ok(int(r.heldAt) >= HOLD_TICK and int(r.heldAt) < N, "%s: the hold stopped the run at tick %d" % [pair[0], r.heldAt])
		t.ok(float(r.movedWhileHeld) == 0.0, "%s: nothing moved over %d held physics frames (%.6f m)" % [pair[0], HELD_FRAMES, r.movedWhileHeld])
		t.ok(bool(r.serverStopped), "%s: the physics server was stopped while held" % pair[0])


# ------------------------------------------------------------------ replay helpers

## One run of the input script at time scale `s`. hold_mode "" runs straight through, "tick" holds with {at} (the
## pause comes from inside the tick), "between" holds from _process (between physics frames). Returns the final car
## and box positions.
func _run(s: float, hold_mode: String) -> Dictionary:
	_clock.set_scale(s)
	await _spawn()
	var wall0 := Time.get_ticks_msec()
	var out := {"wallMs": 0, "ok": false, "car": Vector3.ZERO, "box": Vector3.ZERO, "heldAt": -1, "movedWhileHeld": -1.0, "serverStopped": false}
	var start_t: float = _start * _tick()
	if hold_mode == "tick":
		_clock.hold({"release": true, "at": start_t + HOLD_TICK * _tick()})
		if not await _wait_stopped():
			return await _end(out)
	elif hold_mode == "between":
		_clock.hold({"release": true})
		var n := 0
		while _clock.ticks - _start < HOLD_TICK and n < WAIT_LIMIT:
			await tree.process_frame
			n += 1
		_clock.hold({"at": _clock.t})
		if not await _wait_stopped():
			return await _end(out)
	if hold_mode != "":
		out.heldAt = _clock.ticks - _start
		out.serverStopped = _clock.server_stopped
		var car0 := _car.global_position
		var box0 := _box.global_position
		for i in HELD_FRAMES:
			await tree.physics_frame
		out.movedWhileHeld = maxf(_car.global_position.distance_to(car0), _box.global_position.distance_to(box0))
	_clock.hold({"release": true, "at": start_t + N * _tick()})
	if not await _wait_stopped():
		return await _end(out)
	out.ok = _clock.ticks - _start == N
	out.car = _car.global_position
	out.box = _box.global_position
	out.wallMs = Time.get_ticks_msec() - wall0
	return await _end(out)


func _tick() -> float:
	return float(_clock.TICK)


## Waits until the clock is held and its physics server stopped (from the next frame start on, the bodies stand
## still and their nodes show the last step). False after WAIT_LIMIT physics frames.
func _wait_stopped() -> bool:
	for i in WAIT_LIMIT:
		if _clock.paused and _clock.server_stopped:
			return true
		await tree.physics_frame
	t.ok(false, "the clock did not stop within %d physics frames (paused %s, server stopped %s)" % [WAIT_LIMIT, _clock.paused, _clock.server_stopped])
	return false


## Stages the actors under a hold, so no body moves before the first tick of the run.
func _spawn() -> void:
	_clock.hold({"at": _clock.t})
	await _wait_stopped()
	_world = Node3D.new()
	_world.name = "ReplayWorld"
	var ground := StaticBody3D.new()
	var fs := CollisionShape3D.new()
	var fb := BoxShape3D.new()
	fb.size = Vector3(200, 1, 200)
	fs.shape = fb
	ground.add_child(fs)
	ground.position = Vector3(0, -0.5, 0)
	_world.add_child(ground)
	_box = RigidBody3D.new()
	_box.mass = 20.0
	_box.can_sleep = false
	var bs := CollisionShape3D.new()
	var bb := BoxShape3D.new()
	bb.size = Vector3(0.5, 0.5, 0.5)
	bs.shape = bb
	_box.add_child(bs)
	_box.position = Vector3(4.0, 2.5, -3.0)
	_box.linear_velocity = Vector3(1.5, 0.0, -1.0)
	_box.angular_velocity = Vector3(2.0, 1.0, 0.5)
	_world.add_child(_box)
	# the input script runs first on every tick (connected before the car connects in its _ready)
	_clock.sim_tick.connect(_input_script)
	_car = Car.new()
	_world.add_child(_car)
	tree.root.add_child(_world)
	# two held physics frames: the bodies are in the space before the first tick
	await tree.physics_frame
	await tree.physics_frame
	_start = _clock.ticks


## The input script by tick k (1..N): throttle to tick 60 with a right turn from tick 30, then the brake; the box is
## pushed north while the throttle is down.
func _input_script(_dt: float) -> void:
	var k: int = _clock.ticks - _start
	_press("throttle", 1.0 if k <= 60 else 0.0)
	_press("brake", 1.0 if k > 60 else 0.0)
	_press("steer_right", 0.7 if k > 30 and k <= 80 else 0.0)
	if k <= 60 and _box != null:
		_box.apply_central_force(Vector3(0.0, 0.0, -150.0))


func _press(action: String, v: float) -> void:
	if v > 0.0:
		Input.action_press(action, v)
	else:
		Input.action_release(action)


func _end(out: Dictionary) -> Dictionary:
	if _clock.sim_tick.is_connected(_input_script):
		_clock.sim_tick.disconnect(_input_script)
	for a in ["throttle", "brake", "steer_left", "steer_right"]:
		Input.action_release(a)
	if _world != null:
		tree.root.remove_child(_world)
		_world.free()
		_world = null
		_box = null
		_car = null
	# the frees reach the physics server while still held, then the clock runs again
	await tree.physics_frame
	await tree.physics_frame
	_clock.hold({"release": true, "cancel": true})
	return out


func _gd_files(dir: String, out: Array[String]) -> void:
	var d := DirAccess.open(dir)
	if d == null:
		return
	for f in d.get_files():
		if f.ends_with(".gd"):
			out.append(dir.path_join(f))
	for sub in d.get_directories():
		if sub.begins_with("."):
			continue
		_gd_files(dir.path_join(sub), out)
