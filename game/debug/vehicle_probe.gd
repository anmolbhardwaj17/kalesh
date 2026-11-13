## Debug probes of the V2 vehicle for the harness: the hook vehicle(cmd, opts) of docs/GAME_HOOKS.md (P1-020). A child
## of the debug server, made on its first call. The feel probes drive the player's vehicle with the InputMap actions
## (Input.action_press, the way a player's keys do) and measure in sim ticks; they stage the vehicle with place() the
## way teleport does. Run in the course scene (scene id `course`, game/scenes/course/).
##   info                    the player vehicle: tune, speed, heading, gear, contacts, health, script cost, camera view
##   run {test}              one feel probe, answers its numbers: straight (latency, 0 to 100, top speed, 100 to 0;
##                           opts.until "100" stops the throttle at 101 km/h),
##                           lock (full right lock radius at a held speed, opts.kmh, default 38), kerb (a one-sided
##                           0.15 m kerb at 40 km/h), flyover (the deck joints at 100 km/h)
##   cost {n}                n more vehicles (not the player) drive on the straight: cost per vehicle per tick (the
##                           median physics iteration with them less without, over n; run it windowed at time scale 4)
##   camrec {on}             records every drawn frame: camera height over the vehicle, camera inside geometry, a wall
##                           between the vehicle and the camera; {on: false} stops and answers the numbers
extends Node

const Course := preload("res://bench/physics/course.gd")
const Vehicle := preload("res://vehicles/vehicle.gd")
const ACTIONS := ["throttle", "brake", "steer_left", "steer_right", "handbrake"]

var _rec := false
var _rec_out := {}
var _sphere := PhysicsShapeQueryParameters3D.new()
var _ray := PhysicsRayQueryParameters3D.new()


func _ready() -> void:
	var s := SphereShape3D.new()
	s.radius = 0.1
	_sphere.shape = s
	_sphere.collision_mask = 1
	_ray.collision_mask = 1


func hook(a: Array) -> Dictionary:
	var cmd: String = a[0] if a.size() > 0 and a[0] is String else "info"
	var o: Dictionary = a[1] if a.size() > 1 and a[1] is Dictionary else {}
	var v := _vehicle()
	if v == null:
		return {"ok": false, "error": "vehicle(%s): no V2 vehicle in the group player" % cmd}
	match cmd:
		"info":
			return {"ok": true, "result": info(v)}
		"run":
			if get_tree().current_scene == null or not get_tree().current_scene.has_method("ground_y"):
				return {"ok": false, "error": "vehicle(run): the feel probes run in the course scene (load('course'))"}
			var res: Dictionary = await _run(v, str(o.get("test", "")), o)
			_release()
			if res.has("error"):
				return {"ok": false, "error": "vehicle(run): %s" % res.error}
			return {"ok": true, "result": res}
		"cost":
			return {"ok": true, "result": await _cost(v, int(o.get("n", 16)))}
		"camrec":
			if bool(o.get("on", false)):
				_rec = true
				_rec_out = {"frames": 0, "minAboveM": 1e9, "insideFrames": 0, "blockedFrames": 0, "worst": [], "minDistM": 1e9}
				return {"ok": true, "result": {"recording": true}}
			_rec = false
			return {"ok": true, "result": _rec_out}
	return {"ok": false, "error": "vehicle(cmd): unknown cmd %s (info, run, cost, camrec)" % cmd}


func info(v: Node) -> Dictionary:
	var cam := get_viewport().get_camera_3d()
	return {
		"tune": v.tune.to_dict(), "kmh": snappedf(v.kmh(), 0.01), "heading": v.heading, "gear": v.input.gear,
		"contacts": v.contact_count(), "health": v.health, "settled": v.is_settled(),
		"scriptUsPerTick": snappedf(float(v.cpu_us) / maxf(1.0, v.cpu_ticks), 0.01),
		"camera": {"view": cam.view, "lookingBack": cam.looking_back, "fov": cam.fov} if cam != null and "view" in cam else null,
	}


func _vehicle() -> Node:
	for p in get_tree().get_nodes_in_group("player"):
		if p.has_method("foot_position"):
			return p
	return null


func _clock() -> Node:
	return get_node("/root/SimClock")


func _tick() -> void:
	await _clock().sim_tick


func _ticks(n: int) -> void:
	for i in n:
		await _clock().sim_tick


## Pedals and steer through the InputMap actions, the way a player's keys do.
func _drive(th: float, br: float, st: float, hb := false) -> void:
	_press("throttle", th)
	_press("brake", br)
	_press("steer_left", maxf(0.0, -st))
	_press("steer_right", maxf(0.0, st))
	_press("handbrake", 1.0 if hb else 0.0)


func _press(action: String, s: float) -> void:
	if s > 0.0:
		Input.action_press(action, clampf(s, 0.0, 1.0))
	else:
		Input.action_release(action)


func _release() -> void:
	for a: String in ACTIONS:
		Input.action_release(a)


## Throttle and brake that hold a speed (a driver's foot).
static func _hold(v: Node, target: float) -> Vector2:
	var e: float = target - v.kmh()
	if e < -6.0:
		return Vector2(0.0, clampf(-e * 0.05, 0.0, 1.0))
	return Vector2(clampf(e * 1.0, 0.0, 1.0), 0.0)


## Steer toward a world point with a light hand.
static func _steer_to(v: Node, aim: Vector3, gain: float) -> float:
	var f: Vector3 = v.fwd()
	var to: Vector3 = aim - (v as Node3D).global_position
	to.y = 0.0
	f.y = 0.0
	if to.length_squared() < 0.0001 or f.length_squared() < 0.0001:
		return 0.0
	return clampf(-f.normalized().cross(to.normalized()).y * gain, -1.0, 1.0)


func _stage(v: Node, x: float, z: float, h := 0.0) -> void:
	_release()
	var y: float = get_tree().current_scene.ground_y(x, z)
	v.place(x, z, h, 0.0 if is_nan(y) else y)
	for i in 240:
		await _tick()
		if v.is_settled() and i > 60:
			break


func _roll_deg(v: Node3D) -> float:
	return rad_to_deg(asin(clampf(v.global_transform.basis.x.y, -1.0, 1.0)))


func _run(v: Node, test: String, o: Dictionary) -> Dictionary:
	match test:
		"straight":
			return await _straight(v, str(o.get("until", "top")))
		"lock":
			return await _lock(v, float(o.get("kmh", 38.0)))
		"kerb":
			var x: float = Course.SLAB_SIDE[0] - v.tune.half_track() + 0.25
			var r: Dictionary = await _lane(v, "kerb", x, 30.0, -30.0, -105.0, 40.0)
			return r
		"flyover":
			# the deck joints are every 20 m from 20 m into the deck; the window runs from 10 m before the first to 10 m
			# after the last. The deck starts with a sharp 6 percent crest (the ramp top), which throws the car at 100
			# km/h: those ticks are counted apart (lossTicksBefore), they are not a joint.
			var deck_z0: float = Course.RAMP_START - Course.RAMP_LEN
			var first: float = deck_z0 - Course.DECK_SEG + 10.0
			var last: float = deck_z0 - Course.DECK_SEG * (Course.DECK_SEGS - 1) - 10.0
			return await _lane(v, "flyover", Course.FLYOVER_X, 140.0, first, last, 100.0)
	return {"error": "unknown test '%s' (straight, lock, kerb, flyover)" % test}


## Full throttle from rest on the straight, then full brake. `until`: "top" (until the speed stops growing),
## "100" (until 100 km/h: 0 to 100 and the brake from 100 only).
func _straight(v: Node, until: String) -> Dictionary:
	await _stage(v, 0.0, 100.0)
	var n := v as Node3D
	var p0 := n.global_position
	var f0: Vector3 = v.fwd()
	_drive(1.0, 0.0, 0.0)
	var t := 0
	var lat_v := -1
	var t100 := -1
	var d100 := NAN
	var last := 0.0
	var top := 0.0
	while t < 60 * 120:
		await _tick()
		t += 1
		var kmh: float = v.kmh()
		if lat_v < 0 and v.linear_velocity.dot(f0) > 0.02:
			lat_v = t - 1
		if t100 < 0 and kmh >= 100.0:
			t100 = t
			d100 = (n.global_position - p0).dot(f0)
		top = maxf(top, kmh)
		if until == "100" and kmh >= 101.0:
			break
		if t % 180 == 0:
			if t > 900 and kmh - last < 0.1:
				break
			last = kmh
	var steady: float = v.kmh()
	var top_s := t / 60.0
	var top_dist := (n.global_position - p0).dot(f0)
	_drive(0.0, 1.0, 0.0)
	var p_from := Vector3.ZERO
	var t_from := -1
	var bt := 0
	while bt < 60 * 30:
		await _tick()
		bt += 1
		if t_from < 0 and v.kmh() <= 100.0:
			t_from = bt
			p_from = n.global_position
		if v.kmh() < 0.5:
			break
	_drive(0.0, 0.0, 0.0)
	var stop := n.global_position
	return {
		"latencyTicks": lat_v, "zeroTo100S": snappedf(t100 / 60.0, 0.01) if t100 > 0 else null,
		"zeroTo100DistanceM": snappedf(d100, 0.1) if t100 > 0 else null,
		"topSpeedKmh": snappedf(steady, 0.1), "peakSpeedKmh": snappedf(top, 0.1), "topReachedAfterS": snappedf(top_s, 0.1),
		"topDistanceM": roundf(top_dist), "brakeFrom100M": snappedf((stop - p_from).length(), 0.01) if t_from > 0 else null,
		"brakeTimeS": snappedf((bt - t_from) / 60.0, 0.01) if t_from > 0 else null,
		"lateralDriftM": snappedf(absf(stop.x - p0.x), 0.001), "gear": v.input.gear,
	}


## Full right lock while holding a speed: the steady turn radius (speed over yaw rate).
func _lock(v: Node, target: float) -> Dictionary:
	await _stage(v, 350.0, -700.0)
	var t := 0
	while t < 60 * 25 and v.kmh() < target - 0.5:
		var c := _hold(v, target)
		_drive(c.x, c.y, 0.0)
		await _tick()
		t += 1
	for i in 360:
		var c := _hold(v, target)
		_drive(c.x, c.y, 1.0)
		await _tick()
	var speed := 0.0
	var yaw := 0.0
	var kmh := 0.0
	var max_roll := 0.0
	var k := 300
	for i in k:
		var c := _hold(v, target)
		_drive(c.x, c.y, 1.0)
		await _tick()
		var vel: Vector3 = v.linear_velocity
		speed += Vector2(vel.x, vel.z).length()
		yaw += (v.angular_velocity as Vector3).y
		kmh += v.kmh()
		max_roll = maxf(max_roll, absf(_roll_deg(v)))
	_drive(0.0, 0.0, 0.0)
	speed /= k
	yaw /= k
	return {"targetKmh": target, "heldKmh": snappedf(kmh / k, 0.1), "radiusM": snappedf(speed / maxf(0.0001, absf(yaw)), 0.01),
		"turnsRight": yaw < 0.0, "lateralG": snappedf(speed * absf(yaw) / 9.8, 0.01), "maxRollDeg": snappedf(max_roll, 0.01)}


## Drives north along a lane at a held speed, keeping the lane with a light hand; numbers inside z0..z1 (z0 > z1).
func _lane(v: Node, name: String, x: float, z_start: float, z0: float, z1: float, target: float) -> Dictionary:
	await _stage(v, x, z_start)
	var n := v as Node3D
	var t := 0
	var max_roll := 0.0
	var min_kmh := 1e9
	var ticks := 0
	var all_in := 0
	var min_contacts: int = v.wheel_count()
	var entry_kmh := NAN
	var max_lat := 0.0
	var finished := false
	var loss := []
	var air_before := 0
	var trace := []
	while t < 60 * 90:
		var c := _hold(v, target)
		var p := n.global_position
		_drive(c.x, c.y, _steer_to(v, Vector3(x, 0.0, p.z - 12.0), 1.0))
		await _tick()
		t += 1
		p = n.global_position
		if t % 30 == 0 and trace.size() < 40:
			trace.append([snappedf(p.z, 0.1), snappedf(v.kmh(), 0.1), v.input.gear, snappedf(v.input.engine, 1.0)])
		if p.z > z0:
			if v.contact_count() < v.wheel_count() and p.z < z_start - 60.0:
				air_before += 1
			continue
		if is_nan(entry_kmh):
			entry_kmh = v.kmh()
		ticks += 1
		max_roll = maxf(max_roll, absf(_roll_deg(n)))
		min_kmh = minf(min_kmh, v.kmh())
		var cc: int = v.contact_count()
		min_contacts = mini(min_contacts, cc)
		if cc == v.wheel_count():
			all_in += 1
		elif loss.size() < 24:
			loss.append([snappedf(p.z, 0.01), cc, snappedf(p.y, 0.001)])
		max_lat = maxf(max_lat, absf(p.x - x))
		if p.z <= z1:
			finished = true
			break
	_drive(0.0, 0.0, 0.0)
	return {
		"name": name, "targetKmh": target, "entryKmh": snappedf(entry_kmh, 0.1), "finished": finished, "ticks": ticks,
		"maxRollDeg": snappedf(max_roll, 0.01), "flipped": max_roll > 60.0, "minKmh": snappedf(min_kmh, 0.1),
		"speedLossPct": snappedf(100.0 * (1.0 - min_kmh / target), 0.1), "allWheelsTicksPct": snappedf(100.0 * all_in / maxf(1.0, ticks), 0.1),
		"minWheelsInContact": min_contacts, "maxLaneErrorM": snappedf(max_lat, 0.01),
		"contactLoss": loss, "windowZ": [z0, z1], "lossTicksBefore": air_before, "trace": trace,
	}


## n more vehicles drive on the straight beside each other: the script time per vehicle and the physics iteration time
## per vehicle (the whole iteration with them, less the iteration with the player alone, over n).
func _cost(v: Node, count: int) -> Dictionary:
	await _stage(v, -250.0, 100.0)
	var base := await _physics_ms(240)
	var world := (v as Node3D).get_parent()
	var cars: Array[Node] = []
	for i in count:
		var c: RigidBody3D = Vehicle.new()
		c.is_player = false
		c.name = "CostCar%d" % i
		c.position = Vector3(-200.0 + 12.0 * (i % 16), 0.0, 100.0 - 15.0 * int(i / 16))
		world.add_child(c)
		cars.append(c)
	await _ticks(90)
	for c in cars:
		c.controls(0.7, 0.0, 0.0)
		c.cpu_us = 0
		c.cpu_ticks = 0
	await _ticks(60)
	var with := await _physics_ms(240)
	var us := 0.0
	for c in cars:
		us += float(c.cpu_us) / maxf(1.0, c.cpu_ticks)
		c.queue_free()
	await _tick()
	var per_frame := (with - base) / maxf(1, count)
	var script := us / maxf(1, count) / 1000.0
	print("vehicle cost: %d cars, %.4f ms per car per tick (physics frame %.3f ms with them, %.3f ms without), script %.4f ms" % [count, per_frame, with, base, script])
	return {"cars": count, "msPerCar": snappedf(per_frame, 0.0001), "scriptMsPerCar": snappedf(script, 0.0001),
		"physicsFrameMs": snappedf(with, 0.001), "physicsFrameBaseMs": snappedf(base, 0.001)}


## Median time of one whole physics iteration (the scripts on the tick, the server step and the state sync): the gap
## between two physics frame starts inside the same drawn frame (needs 2 or more ticks a frame: time scale 4 in a window).
func _physics_ms(n: int) -> float:
	var gaps := PackedFloat64Array()
	var last_us := 0
	var last_frame := -1
	var guard := 0
	while gaps.size() < n and guard < n * 20:
		await get_tree().physics_frame
		guard += 1
		var now := Time.get_ticks_usec()
		var f := Engine.get_process_frames()
		if f == last_frame:
			gaps.append((now - last_us) / 1000.0)
		last_us = now
		last_frame = f
	if gaps.is_empty():
		return NAN
	gaps.sort()
	return gaps[gaps.size() / 2]


func _process(_delta: float) -> void:
	if not _rec:
		return
	var v := _vehicle() as Node3D
	var cam := get_viewport().get_camera_3d()
	if v == null or cam == null:
		return
	var space := cam.get_world_3d().direct_space_state
	var cp := cam.global_position
	var vp := v.global_position
	var above := cp.y - vp.y
	_rec_out.frames += 1
	_rec_out.minAboveM = minf(_rec_out.minAboveM, above)
	_rec_out.minDistM = minf(_rec_out.minDistM, cp.distance_to(vp))
	_sphere.transform = Transform3D(Basis.IDENTITY, cp)
	var inside := not space.intersect_shape(_sphere, 1).is_empty()
	_ray.from = vp + Vector3.UP * 1.4
	_ray.to = cp
	var blocked := not space.intersect_ray(_ray).is_empty()
	if inside:
		_rec_out.insideFrames += 1
	if blocked:
		_rec_out.blockedFrames += 1
	if (inside or blocked or above < 0.5) and (_rec_out.worst as Array).size() < 20:
		(_rec_out.worst as Array).append({"t": snappedf(_clock().t, 0.01), "above": snappedf(above, 0.01), "inside": inside, "blocked": blocked,
			"cam": [snappedf(cp.x, 0.01), snappedf(cp.y, 0.01), snappedf(cp.z, 0.01)], "car": [snappedf(vp.x, 0.01), snappedf(vp.y, 0.01), snappedf(vp.z, 0.01)]})
