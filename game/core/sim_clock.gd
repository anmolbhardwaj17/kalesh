## Autoload SimClock: the sim time every stepping game system reads (the car now; later physics, AI and missions).
## Systems connect to `sim_tick(dt)` and step only there, never in their own _physics_process, so the time scale and
## the sim hold reach every system the same way.
##
## The sim tick is fixed (1 / physics_ticks_per_second, 60 Hz). Each engine physics frame adds delta * scale to an
## accumulator and runs whole ticks from it: scale 2 runs two ticks per physics frame, scale 0.5 one tick every other
## frame. t is ticks * tick, so it never drifts.
## Hold: hold_at pauses the sim on the last tick boundary at or before hold_at (so t is within one tick of the asked
## time, never past it). A held sim runs no ticks until release.
## Lockstep (--lockstep): at most one engine physics frame per rendered frame, so a loaded machine runs the sim slower
## instead of catching up in bursts.
extends Node

signal sim_tick(dt: float)
## Emitted once per engine physics frame after its ticks ran (0 ticks when held).
signal ticked(steps: int)

const EPS := 1e-9

var tick := 1.0 / 60.0
var ticks := 0
var t := 0.0
var scale := 1.0
var paused := false
## Sim time to pause at, or null.
var hold_at: Variant = null
var _acc := 0.0


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	process_physics_priority = -100 # before every game node, so they see this frame's state
	tick = 1.0 / float(Engine.physics_ticks_per_second)
	var args := get_node_or_null("/root/GameArgs")
	if args != null and args.lockstep:
		Engine.max_physics_steps_per_frame = 1


func _physics_process(delta: float) -> void:
	ticked.emit(advance(delta))


## Adds real_dt (seconds) of engine time and runs the whole sim ticks it buys. Returns the number of ticks run.
func advance(real_dt: float) -> int:
	if paused:
		_acc = 0.0
		return 0
	_acc += maxf(0.0, real_dt) * scale
	var steps := 0
	while _acc >= tick - EPS:
		if hold_at != null and (ticks + 1) * tick > float(hold_at) + EPS:
			_pause_now()
			break
		_acc -= tick
		ticks += 1
		t = ticks * tick
		steps += 1
		sim_tick.emit(tick)
	# A hold that lands exactly on this tick boundary pauses now, not one frame later.
	if not paused and hold_at != null and (ticks + 1) * tick > float(hold_at) + EPS:
		_pause_now()
	return steps


## {at} pauses at sim time `at` (now, if t is already there), {release} resumes, {cancel} clears a pending hold.
## No args only reads. Returns {paused, t, at}.
func hold(opts: Dictionary = {}) -> Dictionary:
	if opts.get("cancel", false):
		hold_at = null
	if opts.get("release", false):
		paused = false
		_acc = 0.0
	if opts.has("at") and opts.at != null:
		hold_at = float(opts.at)
		if (ticks + 1) * tick > hold_at + EPS:
			_pause_now()
	return hold_state()


func hold_state() -> Dictionary:
	return {"paused": paused, "t": t, "at": hold_at}


func set_scale(n: float) -> void:
	scale = maxf(0.0, n)


func state() -> Dictionary:
	return {"t": t, "scale": scale, "paused": paused}


func _pause_now() -> void:
	paused = true
	var at = hold_at
	hold_at = null
	_acc = 0.0
	var ev := get_node_or_null("/root/GameEvents") if is_inside_tree() else null
	if ev != null:
		ev.emit_event("sim:hold", {"at": at, "t": t})
