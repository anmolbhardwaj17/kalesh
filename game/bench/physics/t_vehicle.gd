## Vehicle test of the physics bench (P0-017): one vehicle (v1 VehicleBody3D, v2 our raycast vehicle, or auto, the
## three wheel variant of v2) through the feel probes on the course: rest noise, input latency, 0 to 100 km/h, top
## speed, braking distance, cruise noise, steady turn radius at two speeds, a square kerb strike, a one-sided kerb,
## the flyover with its joints, and a tight left turn at the junction. Inputs are throttle, brake and steer only.
## With the token far the same runs happen 7000 m from the origin (FP1): compare the noise numbers.
extends RefCounted

const Util := preload("res://bench/physics/util.gd")
const Course := preload("res://bench/physics/course.gd")
const PathDriver := preload("res://bench/physics/path_driver.gd")
const Tune := preload("res://bench/physics/tune.gd")

var b: Node
var clock: Node
var v: Node
var tune: Tune
var kind := "v2"
var ride := 0.0


func run(bench: Node, opts: Dictionary) -> Dictionary:
	b = bench
	clock = b.clock
	kind = str(opts.get("kind", "v2"))
	clock.set_scale(float(opts.get("scale", 4.0)))
	v = b.spawn_vehicle(kind, Vector3.ZERO)
	tune = v.tune
	ride = tune.ride_height()
	var out := {"kind": kind, "timeScale": clock.scale, "tune": tune.to_dict(), "rideHeightDesign": Util.r(ride, 4)}
	out["rest"] = await _rest()
	out["straight"] = await _straight()
	var is_auto := kind == "auto"
	out["cruise"] = await _cruise(40.0 if is_auto else 60.0)
	out["turns"] = [await _turn(40.0), await _turn(60.0 if is_auto else 80.0)]
	out["kerbSquare"] = await _obstacle("kerbSquare", 40.0, -20.0, -90.0, 30.0, Course.KERB)
	var side_x: float = Course.SLAB_SIDE[0] - tune.half_track() + 0.25
	out["kerbSide"] = await _obstacle("kerbSide", side_x, -30.0, -105.0, 40.0, Course.KERB)
	out["flyover"] = await _obstacle("flyover", Course.FLYOVER_X, 0.0, -400.0, 50.0 if is_auto else 80.0, Course.FLYOVER_H + Course.JOINT_LIP)
	out["junction"] = await _junction()
	out["cpu"] = {"scriptUsPerTick": Util.r(float(v.cpu_us) / maxf(1.0, v.cpu_ticks), 2), "ticks": v.cpu_ticks,
		"note": "script time of sim_step for one vehicle driving alone (a cold loop: about 3 times the per car time of the 30 car traffic test, which also has the engine side of the cost)"}
	# leave it on the one-sided kerb for the shot
	v.place(b.origin + Vector3(side_x, ride + 0.12, -75.0), 0.0)
	await b.ticks(120)
	b.look_from(Vector3(side_x - 5.5, 1.7, -68.5), Vector3(side_x + 0.4, 0.5, -75.5))
	clock.set_scale(1.0)
	return out


func _place(x: float, z: float, heading: float = 0.0) -> void:
	v.place(b.origin + Vector3(x, ride + 0.03, z), heading)
	await b.ticks(90)


func _roll_deg() -> float:
	return rad_to_deg(asin(clampf((v as Node3D).global_transform.basis.x.y, -1.0, 1.0)))


func _pitch_deg() -> float:
	var f: Vector3 = v.fwd()
	return rad_to_deg(asin(clampf(f.y, -1.0, 1.0)))


func _noise(n: int) -> Dictionary:
	var ys := PackedFloat64Array()
	var xs := PackedFloat64Array()
	var zs := PackedFloat64Array()
	var wheels: int = v.wheel_count()
	var susp: Array[PackedFloat64Array] = []
	for w in wheels:
		susp.append(PackedFloat64Array())
	var min_contacts := wheels
	for i in n:
		await clock.post_tick
		var p: Vector3 = b.local((v as Node3D).global_position)
		ys.append(p.y * 1000.0)
		xs.append(p.x * 1000.0)
		zs.append(p.z * 1000.0)
		for w in wheels:
			susp[w].append(float(v.susp(w)) * 1000.0)
		min_contacts = mini(min_contacts, v.contact_count())
	var worst_std := 0.0
	var worst_p2p := 0.0
	var mean_len := 0.0
	for w in wheels:
		var s := Util.spread(susp[w], 4)
		worst_std = maxf(worst_std, s.std)
		worst_p2p = maxf(worst_p2p, s.p2p)
		mean_len += float(s.mean) / wheels
	return {
		"samples": n, "bodyYMm": Util.spread(ys, 4), "bodyXMm": Util.spread(xs, 4), "bodyZMm": Util.spread(zs, 4),
		"wheelContactNoiseStdMm": Util.r(worst_std, 4), "wheelContactNoiseP2pMm": Util.r(worst_p2p, 4),
		"suspensionLengthMeanMm": Util.r(mean_len, 2), "minWheelsInContact": min_contacts,
	}


## Standing still on flat ground with the handbrake on: ride height and noise.
func _rest() -> Dictionary:
	await _place(0.0, 0.0)
	v.controls(0.0, 0.0, 0.0, true)
	await b.ticks(120)
	var out := await _noise(180)
	v.controls(0.0, 0.0, 0.0, false)
	out["rideHeightM"] = Util.r(float(out.bodyYMm.mean) / 1000.0, 4)
	return out


## Full throttle from rest on the straight, then full brake: latency, 0 to 100, top speed, braking distance.
func _straight() -> Dictionary:
	await _place(0.0, 0.0)
	var p0: Vector3 = (v as Node3D).global_position
	var f0: Vector3 = v.fwd()
	v.controls(1.0, 0.0, 0.0)
	var t := 0
	var lat_v := -1
	var lat_p := -1
	var t60 := -1
	var t100 := -1
	var d100 := NAN
	var last := 0.0
	var top := 0.0
	var max_gear := 1
	while t < 60 * 90:
		await clock.post_tick
		t += 1
		var kmh: float = v.kmh()
		var along: float = ((v as Node3D).global_position - p0).dot(f0)
		if lat_v < 0 and (v.linear_velocity as Vector3).dot(f0) > 0.02:
			lat_v = t - 1
		if lat_p < 0 and along > 0.001:
			lat_p = t - 1
		if t60 < 0 and kmh >= 60.0:
			t60 = t
		if t100 < 0 and kmh >= 100.0:
			t100 = t
			d100 = along
		max_gear = maxi(max_gear, v.logic.gear)
		top = maxf(top, kmh)
		if t % 180 == 0:
			if t > 600 and kmh - last < 0.1:
				break
			last = kmh
	var top_ticks := t
	var top_dist: float = ((v as Node3D).global_position - p0).dot(f0)
	var steady: float = v.kmh()
	# full brake
	v.controls(0.0, 1.0, 0.0)
	var from_kmh := minf(100.0, floorf(steady))
	var p_from := Vector3.ZERO
	var t_from := -1
	var bt := 0
	var max_pitch := 0.0
	while bt < 60 * 30:
		await clock.post_tick
		bt += 1
		var kmh: float = v.kmh()
		if t_from < 0 and kmh <= from_kmh:
			t_from = bt
			p_from = (v as Node3D).global_position
		max_pitch = maxf(max_pitch, absf(_pitch_deg()))
		if kmh < 1.0:
			break
	v.controls(0.0, 0.0, 0.0)
	var stop: Vector3 = (v as Node3D).global_position
	var drift: float = absf(b.local(stop).x)
	await b.ticks(60)
	return {
		"latencyTicksToVelocity": lat_v, "latencyTicksToPosition": lat_p,
		"latencyNote": "ticks between the tick that read the input and the first tick whose state shows motion (0.02 m/s, 1 mm)",
		"zeroTo60S": Util.r(t60 / 60.0, 2) if t60 > 0 else null,
		"zeroTo100S": Util.r(t100 / 60.0, 2) if t100 > 0 else null,
		"zeroTo100DistanceM": Util.r(d100, 1) if t100 > 0 else null,
		"topSpeedKmh": Util.r(steady, 1), "peakSpeedKmh": Util.r(top, 1), "topSpeedReachedAfterS": Util.r(top_ticks / 60.0, 1),
		"topSpeedDistanceM": Util.r(top_dist, 0), "topGear": max_gear,
		"brakeFromKmh": from_kmh, "brakeDistanceM": Util.r((stop - p_from).length(), 2) if t_from > 0 else null,
		"brakeTimeS": Util.r((bt - t_from) / 60.0, 2) if t_from > 0 else null, "brakeMaxPitchDeg": Util.r(max_pitch, 2),
		"lateralDriftOverRunM": Util.r(drift, 3),
	}


## Holding a steady speed on flat ground: noise while moving.
func _cruise(target: float) -> Dictionary:
	await _place(0.0, 0.0)
	for i in 600:
		var c := PathDriver.hold_speed(v, target)
		v.controls(c.x, c.y, 0.0)
		await clock.post_tick
	var ys := PackedFloat64Array()
	var xs := PackedFloat64Array()
	var sp := PackedFloat64Array()
	var wheels: int = v.wheel_count()
	var susp: Array[PackedFloat64Array] = []
	for w in wheels:
		susp.append(PackedFloat64Array())
	for i in 300:
		var c := PathDriver.hold_speed(v, target)
		v.controls(c.x, c.y, 0.0)
		await clock.post_tick
		var p: Vector3 = b.local((v as Node3D).global_position)
		ys.append(p.y * 1000.0)
		xs.append(p.x * 1000.0)
		sp.append(v.kmh())
		for w in wheels:
			susp[w].append(float(v.susp(w)) * 1000.0)
	v.controls(0.0, 0.0, 0.0)
	var worst_std := 0.0
	var worst_p2p := 0.0
	for w in wheels:
		var s := Util.spread(susp[w], 4)
		worst_std = maxf(worst_std, s.std)
		worst_p2p = maxf(worst_p2p, s.p2p)
	return {
		"targetKmh": target, "speedKmh": Util.spread(sp, 3), "bodyYMm": Util.spread(ys, 4), "lateralXMm": Util.spread(xs, 4),
		"wheelContactNoiseStdMm": Util.r(worst_std, 4), "wheelContactNoiseP2pMm": Util.r(worst_p2p, 4),
	}


## Full right lock while holding a speed: the steady turn radius.
func _turn(target: float) -> Dictionary:
	await _place(350.0, -700.0)
	var t := 0
	while t < 60 * 25 and v.kmh() < target - 0.5:
		var c := PathDriver.hold_speed(v, target)
		v.controls(c.x, c.y, 0.0)
		await clock.post_tick
		t += 1
	for i in 360:
		var c := PathDriver.hold_speed(v, target)
		v.controls(c.x, c.y, 1.0)
		await clock.post_tick
	var speed := 0.0
	var yaw := 0.0
	var slip := 0.0
	var max_roll := 0.0
	var kmh_sum := 0.0
	var min_contacts: int = v.wheel_count()
	var n := 300
	for i in n:
		var c := PathDriver.hold_speed(v, target)
		v.controls(c.x, c.y, 1.0)
		await clock.post_tick
		var vel: Vector3 = v.linear_velocity
		var f: Vector3 = v.fwd()
		var right: Vector3 = f.cross(Vector3.UP)
		speed += Vector2(vel.x, vel.z).length()
		yaw += (v.angular_velocity as Vector3).y
		slip += rad_to_deg(atan2(vel.dot(right), maxf(0.1, vel.dot(f))))
		kmh_sum += v.kmh()
		max_roll = maxf(max_roll, absf(_roll_deg()))
		min_contacts = mini(min_contacts, v.contact_count())
	v.controls(0.0, 0.0, 0.0)
	speed /= n
	yaw /= n
	var radius := speed / maxf(0.0001, absf(yaw))
	return {
		"targetKmh": target, "heldKmh": Util.r(kmh_sum / n, 1), "radiusM": Util.r(radius, 2), "yawRateDegS": Util.r(rad_to_deg(yaw), 2),
		"lateralG": Util.r(speed * absf(yaw) / 9.8, 2), "slipAngleDeg": Util.r(slip / n, 2), "maxRollDeg": Util.r(max_roll, 2),
		"minWheelsInContact": min_contacts, "turnsRight": yaw < 0.0, "steerAngleDeg": Util.r(rad_to_deg(v.logic.steer), 2),
	}


## Drives north along a lane over an obstacle at a held speed: stability numbers.
func _obstacle(name: String, lane_x: float, z_start: float, z_end: float, target: float, top_level: float) -> Dictionary:
	await _place(lane_x, z_start + 60.0)
	var t := 0
	var max_roll := 0.0
	var max_pitch := 0.0
	var up := 0.0
	var down := 0.0
	var overshoot := -1000.0
	var air := 0
	var min_contacts: int = v.wheel_count()
	var min_kmh := 1000.0
	var max_lat := 0.0
	var max_vy := 0.0
	var bottomed0: int = v.bottomed
	var entered := false
	var finished := false
	while t < 60 * 60:
		var c := PathDriver.hold_speed(v, target)
		# keep the lane with a light hand, as a driver would
		var p: Vector3 = b.local((v as Node3D).global_position)
		var aim: Vector3 = b.origin + Vector3(lane_x, 0.0, p.z - 12.0)
		v.controls(c.x, c.y, PathDriver.steer_to(v, aim, 1.0))
		await clock.post_tick
		t += 1
		p = b.local((v as Node3D).global_position)
		if not entered:
			entered = p.z <= z_start
			continue
		var g: float = b.ground_y((v as Node3D).global_position)
		var dev := p.y - g - ride if not is_nan(g) else 0.0
		up = maxf(up, dev)
		down = minf(down, dev)
		overshoot = maxf(overshoot, p.y - ride - top_level)
		max_roll = maxf(max_roll, absf(_roll_deg()))
		max_pitch = maxf(max_pitch, absf(_pitch_deg()))
		max_vy = maxf(max_vy, absf((v.linear_velocity as Vector3).y))
		var contacts: int = v.contact_count()
		min_contacts = mini(min_contacts, contacts)
		if contacts == 0:
			air += 1
		min_kmh = minf(min_kmh, v.kmh())
		max_lat = maxf(max_lat, absf(p.x - lane_x))
		if p.z <= z_end:
			finished = true
			break
	v.controls(0.0, 0.0, 0.0)
	return {
		"name": name, "targetKmh": target, "finished": finished, "timeS": Util.r(t / 60.0, 1),
		"maxRollDeg": Util.r(max_roll, 2), "maxPitchDeg": Util.r(max_pitch, 2),
		"bounceOverTopLevelM": Util.r(overshoot, 3), "rideHeightDevUpM": Util.r(up, 3), "rideHeightDevDownM": Util.r(down, 3),
		"maxVerticalSpeedMs": Util.r(max_vy, 2), "airborneTicks": air, "minWheelsInContact": min_contacts,
		"minSpeedKmh": Util.r(min_kmh, 1), "speedLossPct": Util.r(100.0 * (1.0 - min_kmh / target), 1),
		"maxLaneErrorM": Util.r(max_lat, 2), "bottomedTicks": int(v.bottomed) - bottomed0,
		"flipped": max_roll > 60.0,
	}


## A tight left turn at the junction (radius 6 m from the kerb-side lane): the rear inner wheel cuts the corner kerb.
func _junction() -> Dictionary:
	var j := Course.JUNCTION
	var start := Vector3(j.x - 2.5, 0.0, j.y + 50.0)
	var path := PathDriver.left_turn_path(start, 50.0 - 2.5 - 6.0, 6.0, 30.0)
	await _place(start.x, start.z)
	var idx := 0
	var t := 0
	var max_err := 0.0
	var max_roll := 0.0
	var up := 0.0
	var min_contacts: int = v.wheel_count()
	var finished := false
	var target := 20.0
	while t < 60 * 60:
		var p: Vector3 = b.local((v as Node3D).global_position)
		var flat := Vector3(p.x, 0.0, p.z)
		while idx < path.size() - 1 and flat.distance_squared_to(path[idx + 1]) <= flat.distance_squared_to(path[idx]):
			idx += 1
		var aim: Vector3 = b.origin + path[mini(path.size() - 1, idx + 7)]
		var c := PathDriver.hold_speed(v, target)
		v.controls(c.x, c.y, PathDriver.steer_to(v, aim, 3.0))
		await clock.post_tick
		t += 1
		max_err = maxf(max_err, flat.distance_to(path[idx]))
		max_roll = maxf(max_roll, absf(_roll_deg()))
		var g: float = b.ground_y((v as Node3D).global_position)
		if not is_nan(g):
			up = maxf(up, p.y - ride)
		min_contacts = mini(min_contacts, v.contact_count())
		if idx >= path.size() - 8:
			finished = true
			break
	v.controls(0.0, 0.0, 0.0)
	return {
		"targetKmh": target, "turnRadiusM": 6.0, "finished": finished, "timeS": Util.r(t / 60.0, 1), "maxPathErrorM": Util.r(max_err, 2),
		"maxRollDeg": Util.r(max_roll, 2), "bodyLiftM": Util.r(up, 3), "kerbClipped": up > 0.02, "minWheelsInContact": min_contacts,
	}
