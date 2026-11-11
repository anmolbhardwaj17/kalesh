## Autoload SimClock: the sim time of every stepping game system (the car now; later vehicles, characters, AI,
## missions, cutscenes and dialogue). Systems connect to `sim_tick(dt)` and step only there, never in their own
## _physics_process, so the time scale and the sim hold reach every system and the physics server the same way.
##
## C1 (TECH.md "Main loop and time (C1)", measured in P0-017 with game/bench/physics/bench_clock.gd):
## - One engine physics frame is one sim tick of exactly 1/60 s. `t` is ticks / 60, so it never drifts.
## - The time scale sets Engine.time_scale and Engine.physics_ticks_per_second together: scale 4 runs 240 physics
##   frames per real second and each still steps 1/60 s of sim (and of physics). Scale 0 runs no ticks and stops the
##   physics server like a hold, at the engine rates of scale 1.
## - The hold stops the ticks at once and stops the physics server with PhysicsServer3D.set_active(false), but only
##   at the start of an engine physics frame, right after the engine synced the bodies to their nodes. Stopped in the
##   middle of a tick, that tick's step is lost (269 mm at speed); stopped between frames, the nodes show the step
##   before until the release. So a tick that is running when the hold comes still gets its physics step. Frames keep
##   drawing while held. A release resumes exactly where the hold stopped.
## - hold({at}) pauses on the last tick boundary at or before `at` (within one tick, never past it).
## - --lockstep sets Engine.max_physics_steps_per_frame to 1: a loaded machine runs the sim slower instead of
##   catching up in bursts.
## Cameras follow in their own _physics_process with a higher process_physics_priority, after every system stepped.
extends Node

signal sim_tick(dt: float)
## Emitted once per engine physics frame after its tick ran (1) or did not (0: held, or time scale 0).
signal ticked(steps: int)

const TICK := 1.0 / 60.0
const EPS := 1e-9
## Before every game node in the physics frame (the frame probe of the debug server uses the tree's physics_frame
## signal, which comes earlier still).
const PRIORITY := -1000

## The fixed sim tick (kept as a var for readers that ask the clock).
var tick := TICK
var ticks := 0
var t := 0.0
var scale := 1.0
var paused := false
## Sim time to pause at, or null.
var hold_at: Variant = null
## True while this clock has the physics server stopped.
var server_stopped := false


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	process_physics_priority = PRIORITY
	var args := get_node_or_null("/root/GameArgs")
	if args != null and args.lockstep:
		Engine.max_physics_steps_per_frame = 1
	_apply_rates()


func _exit_tree() -> void:
	if _owns_engine():
		Engine.time_scale = 1.0
		Engine.physics_ticks_per_second = 60
		if server_stopped:
			PhysicsServer3D.set_active(true)
			server_stopped = false


func _physics_process(_delta: float) -> void:
	ticked.emit(physics_frame())


## One engine physics frame: runs at most one sim tick. Called at the start of the frame (lowest priority), so this is
## the one place the physics server is stopped. Returns the number of ticks run (0 or 1). Unit tests call it directly
## on a clock outside the tree, which never touches the engine.
func physics_frame() -> int:
	if paused or scale <= 0.0:
		_server(false)
		return 0
	_server(true)
	if _hold_reached():
		_pause_now()
		_server(false)
		return 0
	ticks += 1
	t = ticks * TICK
	sim_tick.emit(TICK)
	# A hold that lands on this tick boundary pauses now; this tick's physics step still runs after the scripts, and
	# the server stops at the start of the next physics frame.
	if not paused and _hold_reached():
		_pause_now()
	return 1


## Runs n physics frames by hand (unit tests on a clock outside the tree). Returns the ticks run.
func run_frames(n: int) -> int:
	var steps := 0
	for i in maxi(0, n):
		steps += physics_frame()
	return steps


## {at} pauses at sim time `at` (now, if t is already there), {release} resumes, {cancel} clears a pending hold.
## No args only reads. Returns {paused, t, at}.
func hold(opts: Dictionary = {}) -> Dictionary:
	if opts.get("cancel", false):
		hold_at = null
	if opts.get("release", false):
		paused = false
		if scale > 0.0:
			_server(true)
	if opts.has("at") and opts.at != null:
		hold_at = float(opts.at)
		if _hold_reached():
			_pause_now()
	return hold_state()


func hold_state() -> Dictionary:
	return {"paused": paused, "t": t, "at": hold_at}


func set_scale(n: float) -> void:
	scale = maxf(0.0, n)
	_apply_rates()


func state() -> Dictionary:
	return {"t": t, "scale": scale, "paused": paused}


## The engine settings of a C1 time scale: whole physics frames per second, and the engine time scale that keeps the
## step at exactly 1/60 s. Pure, unit tested (same numbers as the bench clock).
static func c1_rates(s: float) -> Dictionary:
	var tps := maxi(1, roundi(60.0 * s))
	return {"ticksPerSecond": tps, "timeScale": tps / 60.0, "step": (1.0 / tps) * (tps / 60.0)}


func _apply_rates() -> void:
	if not _owns_engine():
		return
	# Scale 0 is a freeze (no ticks, server stopped) at the rates of scale 1, so frames and cameras keep their pace.
	var rates := c1_rates(scale if scale > 0.0 else 1.0)
	Engine.physics_ticks_per_second = int(rates.ticksPerSecond)
	Engine.time_scale = float(rates.timeScale)


func _hold_reached() -> bool:
	return hold_at != null and (ticks + 1) * TICK > float(hold_at) + EPS


func _pause_now() -> void:
	paused = true
	var at = hold_at
	hold_at = null
	var ev := get_node_or_null("/root/GameEvents") if is_inside_tree() else null
	if ev != null:
		ev.emit_event("sim:hold", {"at": at, "t": t})


func _server(active: bool) -> void:
	if not _owns_engine() or active != server_stopped:
		return
	PhysicsServer3D.set_active(active)
	server_stopped = not active


## Only the clock in the tree (the autoload) drives the engine rates and the physics server.
func _owns_engine() -> bool:
	return is_inside_tree()
