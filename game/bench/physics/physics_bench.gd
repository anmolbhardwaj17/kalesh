## Physics architecture bench scene (P0-017, ARCH_OPTIONS.md "Bench tasks", rows P, C, V, F, K, LANG, CB, TR, FP).
## Started with the game arg --arch=physics:<tokens>, tokens joined by "+":
##   far        everything is built 7000 m from the world origin on both axes (float precision option FP1)
## The other tokens only name the setup in the report; what runs is chosen by the harness through the debug hook
## bench(cmd, opts) -> bench_call here:
##   info                     the setup, the physics engine in use, whether a test is running
##   run {test, ...opts}      starts a test (engines, clock, vehicle, colliders, onfoot, combat, agents, traffic);
##                            it runs over many frames, so the answer is only {started}
##   poll {test}              {running, done, result} of a started test
##   pose {name} | {pos, target}   moves the camera (course coordinates)
## The physics engine is a project setting read at start (physics/3d/physics_engine); the harness sets it per run
## with a short-lived override.cfg (harness/bench/arch.mjs). The clock is the C1 clock of bench_clock.gd.
## Run by node harness/bench/arch.mjs physics. Never loaded by the default game.
extends Node3D

const BenchClock := preload("res://bench/physics/bench_clock.gd")
const Course := preload("res://bench/physics/course.gd")
const Tune := preload("res://bench/physics/tune.gd")
const VehicleV1 := preload("res://bench/physics/vehicle_v1.gd")
const VehicleV2 := preload("res://bench/physics/vehicle_v2.gd")
const FAR := Vector3(7000.0, 0.0, 7000.0)
## Test scripts, loaded on demand: each has run(bench, opts) -> Dictionary (a coroutine).
const TESTS := {
	"engines": "res://bench/physics/t_engines.gd",
	"clock": "res://bench/physics/t_clock.gd",
	"vehicle": "res://bench/physics/t_vehicle.gd",
	"colliders": "res://bench/physics/t_colliders.gd",
	"onfoot": "res://bench/physics/t_onfoot.gd",
	"combat": "res://bench/physics/t_combat.gd",
	"agents": "res://bench/physics/t_agents.gd",
	"traffic": "res://bench/physics/t_traffic.gd",
}
## Camera poses in course coordinates: [position, target].
const POSES := {
	"overview": [Vector3(60, 45, 40), Vector3(60, 0, -120)],
	"kerbs": [Vector3(52, 3.0, -52), Vector3(58, 0.4, -72)],
	"flyover": [Vector3(80, 9, -120), Vector3(100, 5, -190)],
	"foot": [Vector3(-160, 6, -20), Vector3(-185, 1, -38)],
}

var tokens: PackedStringArray = []
var info := {"ready": false}
var clock: Node
var origin := Vector3.ZERO
var world: Node3D
var course: Course
var cam: Camera3D
var results := {}
var running := ""
var _query := PhysicsRayQueryParameters3D.new()
var _runners := {}
var _engine := ""


func _ready() -> void:
	var t0 := Time.get_ticks_msec()
	tokens = get_node("/root/GameArgs").arch_setup().split("+", false)
	if has("far"):
		origin = FAR
	clock = BenchClock.new()
	clock.name = "BenchClock"
	add_child(clock)
	world = Node3D.new()
	world.name = "World"
	world.position = origin
	add_child(world)
	_look()
	course = Course.new()
	course.build(world)
	_query.collision_mask = 1
	look_at_pose("overview")
	if bool(ProjectSettings.get_setting("physics/3d/run_on_separate_thread")):
		# the space state (used to name the engine) can only be read inside a physics frame then
		await get_tree().physics_frame
	info = {
		"setup": "+".join(tokens), "engine": engine_name(), "engineSetting": str(ProjectSettings.get_setting("physics/3d/physics_engine")),
		"origin": [origin.x, origin.y, origin.z], "course": course.stats, "physicsTicksPerSecond": Engine.physics_ticks_per_second,
		"doublePrecision": OS.has_feature("double"), "buildMs": Time.get_ticks_msec() - t0, "ready": true,
	}
	print("bench physics: %s on %s built in %d ms" % [info.setup, info.engine, info.buildMs])


func has(token: String) -> bool:
	return token in tokens


## The physics engine that is really running, named by its space state class.
func engine_name() -> String:
	if _engine != "":
		return _engine
	# with physics on its own thread the space state can only be reached inside a physics frame
	var state := get_world_3d().direct_space_state
	if state == null:
		return "unknown"
	var c := state.get_class()
	_engine = "Jolt Physics" if c.begins_with("Jolt") else ("GodotPhysics3D" if c.begins_with("Godot") else c)
	return _engine


# ------------------------------------------------------------------ hooks


func bench_call(cmd: String, opts: Dictionary) -> Variant:
	match cmd:
		"info":
			var live := info.duplicate()
			live["running"] = running
			live["done"] = results.keys()
			live["ticks"] = clock.ticks
			live["nodes"] = get_tree().get_node_count()
			return live
		"run":
			var test := str(opts.get("test", ""))
			if not TESTS.has(test):
				return {"error": "unknown test '%s' (tests: %s)" % [test, ", ".join(TESTS.keys())]}
			if running != "":
				return {"error": "test '%s' is still running" % running}
			results.erase(test)
			_run(test, opts)
			return {"started": test}
		"poll":
			var test := str(opts.get("test", ""))
			return {"running": running, "done": results.has(test), "result": results.get(test)}
		"pose", "path":
			if opts.has("pos") and opts.has("target"):
				var p: Array = opts.pos
				var q: Array = opts.target
				look_from(Vector3(p[0], p[1], p[2]), Vector3(q[0], q[1], q[2]))
			else:
				var name := str(opts.get("name", "overview"))
				if not POSES.has(name):
					return {"error": "unknown pose '%s' (poses: %s)" % [name, ", ".join(POSES.keys())]}
				look_at_pose(name)
			var at := cam.global_position - origin
			return {"pos": [at.x, at.y, at.z], "moving": false}
	return {"error": "unknown bench command '%s' (info, run, poll, pose)" % cmd}


func _run(test: String, opts: Dictionary) -> void:
	running = test
	var t0 := Time.get_ticks_msec()
	# one runner per test, kept between runs: a second run of a test (the collider memory probe) reuses its world
	if not _runners.has(test):
		var script: GDScript = load(TESTS[test])
		_runners[test] = script.new()
	var runner: RefCounted = _runners[test]
	var res: Dictionary = await runner.run(self, opts)
	res["wallMs"] = Time.get_ticks_msec() - t0
	res["engine"] = engine_name()
	res["origin"] = [origin.x, origin.y, origin.z]
	results[test] = res
	running = ""
	print("bench physics: test %s done in %d ms" % [test, res.wallMs])


# ------------------------------------------------------------------ helpers for the tests


## Waits n sim ticks (resumes after every system stepped, before the physics server steps).
func ticks(n: int) -> void:
	for i in n:
		await clock.post_tick


func local(p: Vector3) -> Vector3:
	return p - origin


## A vehicle of kind v1, v2 (the car on the KEEP tune) or auto (three wheels, on V2), at rest at a course position.
func spawn_vehicle(kind: String, at: Vector3, heading: float = 0.0) -> Node:
	var tune: Tune = Tune.auto() if kind == "auto" else Tune.car()
	var v: Node
	if kind == "v1":
		v = VehicleV1.new()
		v.setup(tune)
	else:
		v = VehicleV2.new()
		if kind == "auto":
			v.setup(tune, Color(0.16, 0.5, 0.22))
		else:
			v.setup(tune)
	v.name = "Vehicle_%s_%d" % [kind, world.get_child_count()]
	world.add_child(v)
	v.place(origin + Vector3(at.x, at.y + tune.ride_height() + 0.03, at.z), heading)
	clock.sim_tick.connect(v.sim_step)
	return v


func remove_vehicle(v: Node) -> void:
	clock.sim_tick.disconnect(v.sim_step)
	v.queue_free()


## Height of the collider under a world position (course coordinates), NAN when there is none.
func ground_y(world_pos: Vector3) -> float:
	_query.from = world_pos + Vector3(0, 2.5, 0)
	_query.to = world_pos - Vector3(0, 40.0, 0)
	var hit := get_world_3d().direct_space_state.intersect_ray(_query)
	if hit.is_empty():
		return NAN
	return (hit.position as Vector3).y - origin.y


func look_at_pose(name: String) -> void:
	var p: Array = POSES[name]
	look_from(p[0], p[1])


func look_from(pos: Vector3, target: Vector3) -> void:
	cam.global_position = origin + pos
	cam.look_at(origin + target, Vector3.UP)


# ------------------------------------------------------------------ a plain readable look


func _look() -> void:
	var env := Environment.new()
	var sky := Sky.new()
	var sm := ProceduralSkyMaterial.new()
	sm.sky_top_color = Color(0.3, 0.48, 0.78)
	sm.sky_horizon_color = Color(0.72, 0.78, 0.84)
	sm.ground_bottom_color = Color(0.3, 0.3, 0.3)
	sm.ground_horizon_color = Color(0.66, 0.68, 0.7)
	sky.sky_material = sm
	env.sky = sky
	env.background_mode = Environment.BG_SKY
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.6
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-52, -35, 0)
	sun.light_energy = 1.1
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 160.0
	add_child(sun)
	cam = Camera3D.new()
	cam.fov = 60.0
	cam.near = 0.1
	cam.far = 4000.0
	add_child(cam)
	cam.make_current()
