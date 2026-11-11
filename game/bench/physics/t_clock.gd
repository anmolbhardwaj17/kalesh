## Sim clock test of the physics bench (P0-017), decision C of ARCH_OPTIONS.md. It proves or disproves C1 with
## numbers:
##   hold     a falling body, a V2 car, a V1 car and a walking character stop within one tick of a hold and come
##            back without a jump (their positions per tick are compared with a run that was never held)
##   scale    the same input script gives the same final positions at time scale 0.25, 1 and 4, three replays each
##   c2       the contrast: the scaffold's accumulator clock with the physics server running free
## Actors are made again for every run, so a replay starts from the same state.
extends RefCounted

const Util := preload("res://bench/physics/util.gd")
const Walker := preload("res://bench/physics/walker.gd")
const Course := preload("res://bench/physics/course.gd")

const SCRIPT_TICKS := 360
const NAMES := ["fallingBody", "v2Car", "v1Car", "character"]

var b: Node
var clock: Node
var box: RigidBody3D
var v2: Node
var v1: Node
var walker: Walker
var _stopped := {}


func run(bench: Node, opts: Dictionary) -> Dictionary:
	b = bench
	clock = b.clock
	# quick: one scale and one replay (for working on the test itself; the bench never passes it)
	var quick := bool(opts.get("quick", false))
	var out := {}
	# ---- hold
	clock.set_mode("c1")
	clock.set_scale(1.0)
	var ref: Array = await _play(180)
	var held: Dictionary = await _play_held(180, 60, "tick")
	var between: Dictionary = await _play_held(180, 60, "between")
	var mid: Dictionary = await _play_held(180, 60, "mid")
	var hold := {
		"ticksToStop": maxi(int(held.stepsAfterHold), int(between.stepsAfterHold)),
		"heldFromInsideATick": _hold_row(held, ref), "heldBetweenFrames": _hold_row(between, ref),
		"midTickHoldContrast": _hold_row(mid, ref),
		"note": "stepsAfterHold: physics steps that still ran after hold() was called (positions read from the physics server). movedWhileHeldMm: the largest move of any actor after that, over 40 held physics frames. resumeMaxDiffMm: the largest difference per tick, over all actors and all 180 ticks, against the run that was never held. midTickHoldContrast stops the server in the middle of a tick (hold_now), which loses that tick's step",
	}
	hold["ok"] = int(hold.ticksToStop) <= 1 and float(held.movedWhileHeldMm) == 0.0 and float(between.movedWhileHeldMm) == 0.0 \
		and float(hold.heldFromInsideATick.resumeMaxDiffMm) < 1.0 and float(hold.heldBetweenFrames.resumeMaxDiffMm) < 1.0
	# ---- time scale and replays
	var scale := await _scales("c1", [1.0] if quick else [0.25, 1.0, 4.0], 1 if quick else 3)
	out["c1"] = {"hold": hold, "scale": scale, "holds": bool(hold.ok) and float(scale.maxSpreadMm) < 1.0}
	# ---- C2 contrast
	out["c2"] = await _scales("c2", [1.0] if quick else [0.25, 1.0, 4.0], 1)
	out.c2["note"] = "C2: sim ticks come from an accumulator (delta times scale) while the physics server steps once per engine physics frame"
	clock.set_mode("c1")
	clock.set_scale(1.0)
	if bool(out.c1.holds):
		out["verdict"] = "C1 holds: bodies stop within %d tick of a hold, resume within %.4f mm of an unheld run, and the input script ends within %.4f mm at time scales %s over %d replays each" % [hold.ticksToStop, maxf(hold.heldFromInsideATick.resumeMaxDiffMm, hold.heldBetweenFrames.resumeMaxDiffMm), scale.maxSpreadMm, scale.scales, scale.replaysPerScale]
	else:
		out["verdict"] = "C1 does not hold as measured: hold ok %s, final position spread %.4f mm (limit 1 mm). See hold and scale for which part failed" % [hold.ok, scale.maxSpreadMm]
	# leave the actors in view for the shot
	await _spawn()
	await b.ticks(90)
	b.look_from(Vector3(-22, 7, 22), Vector3(6, 0.5, -8))
	return out


func _hold_row(h: Dictionary, ref: Array) -> Dictionary:
	var worst := 0.0
	var worst_name := ""
	var rec: Array = h.positions
	for t in mini(rec.size(), ref.size()):
		for a in NAMES.size():
			var d: float = ((rec[t] as Array)[a] as Vector3).distance_to((ref[t] as Array)[a]) * 1000.0
			if d > worst:
				worst = d
				worst_name = NAMES[a]
	# evidence: the falling body's height per tick around the hold (tick 60), unheld run against held run
	var around := {"ticks": [], "unheldY": [], "heldY": [], "unheldCarZ": [], "heldCarZ": []}
	for t in range(56, 66):
		around.ticks.append(t + 1)
		around.unheldY.append(Util.r(((ref[t] as Array)[0] as Vector3).y, 5))
		around.heldY.append(Util.r(((rec[t] as Array)[0] as Vector3).y, 5))
		around.unheldCarZ.append(Util.r(((ref[t] as Array)[1] as Vector3).z, 5))
		around.heldCarZ.append(Util.r(((rec[t] as Array)[1] as Vector3).z, 5))
	return {"stepsAfterHold": h.stepsAfterHold, "movedWhileHeldMm": h.movedWhileHeldMm, "heldPhysicsFrames": h.heldFrames,
		"resumeMaxDiffMm": Util.r(worst, 4), "worstActor": worst_name, "aroundHold": around}


func _scales(mode: String, scales: Array, replays: int) -> Dictionary:
	clock.set_mode(mode)
	var finals: Array = []
	var runs: Array = []
	for s in scales:
		for k in replays:
			clock.set_scale(float(s))
			var t0 := Time.get_ticks_msec()
			var rec: Array = await _play(SCRIPT_TICKS)
			var wall := Time.get_ticks_msec() - t0
			var last: Array = rec[rec.size() - 1]
			finals.append(last)
			var row := {"timeScale": s, "replay": k + 1, "wallMs": wall, "simS": SCRIPT_TICKS / 60.0, "simPerWall": Util.r(SCRIPT_TICKS / 60.0 * 1000.0 / maxf(1.0, wall), 2)}
			for a in NAMES.size():
				row[NAMES[a]] = Util.v3(last[a], 5)
			runs.append(row)
	clock.set_scale(1.0)
	var spread := {}
	var worst := 0.0
	for a in NAMES.size():
		var m := 0.0
		for i in finals.size():
			for j in range(i + 1, finals.size()):
				m = maxf(m, ((finals[i] as Array)[a] as Vector3).distance_to((finals[j] as Array)[a]) * 1000.0)
		spread[NAMES[a]] = Util.r(m, 4)
		worst = maxf(worst, m)
	return {"mode": mode, "scales": scales, "replaysPerScale": replays, "scriptTicks": SCRIPT_TICKS, "finalPositionSpreadMm": spread,
		"maxSpreadMm": Util.r(worst, 4), "runs": runs}


func _clear() -> void:
	if v2 != null:
		b.remove_vehicle(v2)
		b.remove_vehicle(v1)
		clock.sim_tick.disconnect(walker.sim_step)
		walker.queue_free()
		box.queue_free()
		v2 = null
		# two physics frames so the frees reach the physics server before the next run starts
		await b.get_tree().physics_frame
		await b.get_tree().physics_frame


func _spawn() -> void:
	# staged under a hold, so no body moves before the first tick of the run
	clock.hold_now()
	await _clear()
	_stopped = {}
	box = RigidBody3D.new()
	box.mass = 20.0
	box.can_sleep = false
	box.collision_layer = 2
	box.collision_mask = 1
	var cs := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(0.5, 0.5, 0.5)
	cs.shape = shape
	box.add_child(cs)
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = shape.size
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.85, 0.75, 0.2)
	bm.material = mat
	mi.mesh = bm
	box.add_child(mi)
	b.world.add_child(box)
	box.global_position = b.origin + Vector3(-8.0, 9.0, -6.0)
	box.linear_velocity = Vector3(1.5, 0.0, -1.0)
	box.angular_velocity = Vector3(2.0, 1.0, 0.5)
	v2 = b.spawn_vehicle("v2", Vector3(0, 0, 0))
	v1 = b.spawn_vehicle("v1", Vector3(12, 0, 0))
	walker = Walker.new()
	walker.setup()
	b.world.add_child(walker)
	# walks north across the square kerb slab
	walker.global_position = b.origin + Vector3(36.0, 0.0, -56.0)
	walker.dir = Vector3(0, 0, -1)
	walker.speed = 3.8
	clock.sim_tick.connect(walker.sim_step)
	# let the engine take the new bodies in, then start the ticks
	await b.get_tree().physics_frame
	clock.release()


## The input script, by tick: full throttle, then a right turn on half throttle, then the brake, then the handbrake.
func _drive(v: Node, t: int) -> void:
	if _stopped.has(v):
		v.controls(0.0, 0.0, 0.0, true)
	elif t < 150:
		v.controls(1.0, 0.0, 0.0)
	elif t < 240:
		v.controls(0.5, 0.0, 0.6)
	elif float(v.kmh()) > 1.0:
		v.controls(0.0, 1.0, 0.0)
	else:
		_stopped[v] = true
		v.controls(0.0, 0.0, 0.0, true)


## Positions as the physics server holds them (the nodes get them one sync later).
func _server_positions() -> Array:
	var out: Array = []
	for body in [box, v2, v1]:
		var xf: Transform3D = PhysicsServer3D.body_get_state((body as CollisionObject3D).get_rid(), PhysicsServer3D.BODY_STATE_TRANSFORM)
		out.append(xf.origin)
	out.append(walker.global_position)
	return out


func _positions() -> Array:
	return [b.local(box.global_position), b.local((v2 as Node3D).global_position), b.local((v1 as Node3D).global_position), b.local(walker.global_position)]


## Runs the script for n ticks and returns the positions after every tick.
func _play(n: int) -> Array:
	await _spawn()
	var rec: Array = []
	for t in n:
		_drive(v2, t)
		_drive(v1, t)
		await clock.post_tick
		rec.append(_positions())
	return rec


## The same run with a hold at tick `at`. how: "tick" (hold() from inside the tick), "between" (hold() between
## physics frames), "mid" (the physics server stopped in the middle of the tick, the wrong way).
func _play_held(n: int, at: int, how: String) -> Dictionary:
	await _spawn()
	var rec: Array = []
	var steps_after := 0
	var moved := 0.0
	var held_frames := 0
	var t := 0
	while t < n:
		_drive(v2, t)
		_drive(v1, t)
		await clock.post_tick
		rec.append(_positions())
		t += 1
		if t == at:
			if how == "between":
				await b.get_tree().process_frame
			var at_call: Array = _server_positions()
			if how == "mid":
				clock.hold_now()
			else:
				clock.hold()
			# the server's positions over 40 engine physics frames of the hold
			var frozen: Array = []
			var prev: Array = at_call
			for f in 40:
				await b.get_tree().physics_frame
				var now: Array = _server_positions()
				var d := 0.0
				for a in NAMES.size():
					d = maxf(d, (now[a] as Vector3).distance_to(prev[a]) * 1000.0)
				if d > 0.0 and frozen.is_empty():
					steps_after += 1 # the step of the tick that was running when hold() was called
				elif d > 0.0:
					moved = maxf(moved, d)
				else:
					frozen.append(f)
				prev = now
			held_frames = 40
			clock.release()
	return {"positions": rec, "stepsAfterHold": steps_after, "movedWhileHeldMm": Util.r(moved, 4), "heldFrames": held_frames}
