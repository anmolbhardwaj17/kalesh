## Sim clock of the physics bench (P0-017), option C1 of ARCH_OPTIONS.md: one engine physics frame is one sim tick.
## The time scale sets Engine.time_scale and Engine.physics_ticks_per_second together, so the engine runs more or
## fewer physics frames per real second and every one of them still steps 1/60 s. The hold stops the ticks and calls
## PhysicsServer3D.set_active(false), so bodies stop with the game systems (the engine has no manual space step).
## Mode "c2" is the contrast: the SimClock accumulator of the scaffold (ticks from delta times scale) with the
## physics server running free, so sim ticks and physics steps drift apart at other time scales.
## The bench only: the game's SimClock (game/core/sim_clock.gd) is not changed before the architecture sign-off.
##
## It also times the physics server: a probe node with the last physics priority marks the end of all script
## callbacks; the next physics frame of the same rendered frame starts right after the server step, so the gap
## between the two is the step (plus the body state sync). Only frames with two or more physics steps give a
## sample, so timing windows run at time scale 4.
extends Node

signal sim_tick(dt: float)
## After every system stepped on this tick and before the physics server steps: tests read and steer here.
signal post_tick()

const TICK := 1.0 / 60.0
const EPS := 1e-9

var ticks := 0
var paused := false
var scale := 1.0
var mode := "c1"
var timing := false
var step_us := PackedFloat64Array()
var script_us := PackedFloat64Array()
## The server step alone, without the body state sync that follows it: the gap from the end of the script callbacks
## of the frame's last physics step to the first _process of the same frame. One sample per rendered frame that had
## a physics step, so it also works at time scale 1 (one step per frame or less).
var step_only_us := PackedFloat64Array()
var _acc := 0.0
var _mark := 0
var _mark_frame := -1
var _start := 0
var _probe: Node
var _hold_pending := false


class EndProbe extends Node:
	var clock: Node

	func _physics_process(_delta: float) -> void:
		clock.end_of_scripts()


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	process_physics_priority = -1000
	process_priority = -1000
	var p := EndProbe.new()
	p.name = "EndProbe"
	p.clock = self
	p.process_mode = Node.PROCESS_MODE_ALWAYS
	p.process_physics_priority = 1000
	_probe = p
	add_child(p)


func _exit_tree() -> void:
	Engine.time_scale = 1.0
	Engine.physics_ticks_per_second = 60
	PhysicsServer3D.set_active(true)


## The engine settings of a C1 time scale: whole physics frames per second, and the engine time scale that keeps the
## step at exactly 1/60 s. Pure, unit tested.
static func c1_rates(s: float) -> Dictionary:
	var tps := maxi(1, roundi(60.0 * s))
	return {"ticksPerSecond": tps, "timeScale": tps / 60.0, "step": (1.0 / tps) * (tps / 60.0)}


func set_scale(s: float) -> void:
	scale = maxf(0.0, s)
	if mode == "c1":
		var rates := c1_rates(scale)
		Engine.physics_ticks_per_second = int(rates.ticksPerSecond)
		Engine.time_scale = float(rates.timeScale)
	else:
		Engine.physics_ticks_per_second = 60
		Engine.time_scale = 1.0


func set_mode(m: String) -> void:
	mode = m
	_acc = 0.0
	set_scale(scale)


## Stops the sim on a tick boundary: at the start of the next engine physics frame, right after the engine synced
## the body states to the nodes. A tick that is running still gets its physics step (called from inside a tick: one
## more step; called between frames: none). Stopping the server at any other moment is wrong in two ways, both
## measured in the clock test: in the middle of a tick it loses that tick's step, and between frames it also stops
## the state sync, so nodes show the state of one step earlier until the release.
func hold() -> void:
	_hold_pending = true


## Stops the ticks and the physics server at once, even in the middle of a tick (the clock test's contrast).
func hold_now() -> void:
	_hold_pending = false
	paused = true
	_mark = 0
	if mode == "c1":
		PhysicsServer3D.set_active(false)


func release() -> void:
	_hold_pending = false
	paused = false
	_acc = 0.0
	PhysicsServer3D.set_active(true)


func timing_begin() -> void:
	step_us.clear()
	script_us.clear()
	step_only_us.clear()
	_mark = 0
	timing = true


func timing_end() -> void:
	timing = false


func _process(_delta: float) -> void:
	if timing and _mark > 0 and _mark_frame == Engine.get_process_frames():
		step_only_us.append(Time.get_ticks_usec() - _mark)
		_mark = 0


func _physics_process(delta: float) -> void:
	var now := Time.get_ticks_usec()
	if timing and _mark > 0 and _mark_frame == Engine.get_process_frames():
		step_us.append(now - _mark)
	_start = now
	if _hold_pending and not paused:
		hold_now()
	_hold_pending = false
	if paused:
		return
	if mode == "c1":
		_one_tick()
		return
	_acc += delta * scale
	while _acc >= TICK - EPS:
		_acc -= TICK
		_one_tick()


func _one_tick() -> void:
	ticks += 1
	sim_tick.emit(TICK)
	post_tick.emit()


func end_of_scripts() -> void:
	var now := Time.get_ticks_usec()
	if paused:
		_mark = 0
		return
	if timing:
		script_us.append(now - _start)
	_mark = now
	_mark_frame = Engine.get_process_frames()
