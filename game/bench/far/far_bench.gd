## Far float check (P1-029, follow-up of P1-008 and the physics bench FP1): the production V2 car (game/vehicles/vehicle.gd,
## the car tune), the production on-foot character with its humanoid (game/characters/on_foot.gd) and a slow camera pan,
## each run with the test course built at a distance from the world origin on both axes (0, 7000, 8030, 9000, 10000 m,
## then 0 again as the noise floor of the pan). Started with the game arg --arch=far; the harness drives it through the
## debug hook bench(cmd, opts) -> bench_call here:
##   info                          the setup and whether a test is running
##   run {test: "far", offsets: []}  runs every offset in turn (a coroutine, so the answer is only {started})
##   poll {test}                   {running, done, result}
## Everything runs on the game's own SimClock (the vehicle and the character connect to it themselves). The vehicle and
## the character are driven by controls() only (throttle, brake, steer, a walk direction); nothing writes a position
## except staging at the start of a probe. Run by node harness/bench/arch.mjs far. Never loaded by the default game.
extends Node3D

const Course := preload("res://bench/physics/course.gd")
const Util := preload("res://bench/physics/util.gd")
const Vehicle := preload("res://vehicles/vehicle.gd")
const OnFoot := preload("res://characters/on_foot.gd")
const Motor := preload("res://characters/foot_motor.gd")

const OFFSETS := [0.0, 7000.0, 8030.0, 9000.0, 10000.0, 0.0]
## Pan: frames, the camera step per frame (m) and the yaw step per frame (degrees), as the P0-029 pan.
const PAN_FRAMES := 24
const PAN_STEP_M := 0.002
const PAN_YAW_DEG := 0.01
const PAN_SIZE := Vector2i(320, 180)

var info := {"ready": false}
var results := {}
var running := ""
var cam: Camera3D
var clock: Node
var o := Vector3.ZERO
var world: Node3D
var car: Vehicle
var _frames: Array = []
## Folder for the first and last pan frame of every offset as full size PNGs (opts.dumpDir), for looking at.
var _dump := ""


func _ready() -> void:
	clock = get_node("/root/SimClock")
	_look()
	info = {"setup": get_node("/root/GameArgs").arch_setup(), "engine": _engine(), "ready": true,
		"doublePrecision": OS.has_feature("double"), "physicsTicksPerSecond": Engine.physics_ticks_per_second}
	print("bench far: ready on %s" % info.engine)


func _engine() -> String:
	var c := get_world_3d().direct_space_state.get_class()
	return "Jolt Physics" if c.begins_with("Jolt") else ("GodotPhysics3D" if c.begins_with("Godot") else c)


func bench_call(cmd: String, opts: Dictionary) -> Variant:
	match cmd:
		"info":
			var live := info.duplicate()
			live["running"] = running
			live["done"] = results.keys()
			return live
		"run":
			var test := str(opts.get("test", "far"))
			if test != "far":
				return {"error": "unknown test '%s' (far)" % test}
			if running != "":
				return {"error": "test '%s' is still running" % running}
			results.erase(test)
			_run(opts)
			return {"started": test}
		"poll":
			var test := str(opts.get("test", "far"))
			return {"running": running, "done": results.has(test), "result": results.get(test)}
	return {"error": "unknown bench command '%s' (info, run, poll)" % cmd}


func _run(opts: Dictionary) -> void:
	running = "far"
	var t0 := Time.get_ticks_msec()
	var offsets: Array = opts.get("offsets", OFFSETS)
	var rows: Array = []
	_frames = []
	_dump = str(opts.get("dumpDir", ""))
	for d in offsets:
		rows.append(await _at(float(d)))
	var pan := _pan_report(rows)
	for r in rows:
		r.erase("_idx")
	results["far"] = {"offsets": rows, "pan": pan, "engine": _engine(), "wallMs": Time.get_ticks_msec() - t0,
		"note": "each offset places the world at (d, 0, d); 32-bit floats step 0.49 mm between 4096 and 8192 m and 0.98 mm between 8192 and 16384 m"}
	_frames = []
	running = ""
	print("bench far: done in %d ms" % (Time.get_ticks_msec() - t0))


## Builds the course at (d, 0, d), runs the vehicle, the character and the pan there, and removes it again.
func _at(d: float) -> Dictionary:
	o = Vector3(d, 0.0, d)
	world = Node3D.new()
	world.name = "World"
	world.position = o
	add_child(world)
	var course := Course.new()
	course.build(world)
	clock.set_scale(4.0)
	var row := {"offsetM": d, "originMm": [o.x * 1000.0, o.z * 1000.0]}
	row["vehicle"] = await _vehicle()
	row["character"] = await _character()
	clock.set_scale(1.0)
	row["_idx"] = _frames.size()
	_frames.append(await _pan())
	world.queue_free()
	await get_tree().physics_frame
	await get_tree().physics_frame
	return row


func ticks(n: int) -> void:
	for i in n:
		await clock.ticked


func local(p: Vector3) -> Vector3:
	return p - o


# ------------------------------------------------------------------ the V2 car


func _spawn_car(x: float, z: float, heading: float = 0.0) -> void:
	if car == null:
		car = Vehicle.new()
		car.name = "Car"
		car.is_player = false
		car.position = o + Vector3(x, 0.0, z)
		add_child(car)
	car.place(o.x + x, o.z + z, heading, o.y)
	car.controls(0.0, 0.0, 0.0)
	await ticks(90)


static func _hold(v: Vehicle, target: float) -> Vector2:
	var e := target - v.kmh()
	if e < -6.0:
		return Vector2(0.0, clampf(-e * 0.05, 0.0, 1.0))
	return Vector2(clampf(e * 1.0, 0.0, 1.0), 0.0)


func _vehicle() -> Dictionary:
	car = null
	var out := {}
	await _spawn_car(1.7, 0.0)
	out["tune"] = car.tune.id if "id" in car.tune else "car"
	out["rest"] = await _noise(180, true)
	out["straight"] = await _straight()
	await _spawn_car(1.7, 0.0)
	out["cruise"] = await _cruise(60.0)
	out["turns"] = [await _turn(40.0), await _turn(80.0)]
	car.queue_free()
	car = null
	await get_tree().physics_frame
	return out


func _noise(n: int, handbrake: bool) -> Dictionary:
	car.controls(0.0, 0.0, 0.0, handbrake)
	await ticks(120)
	var xs := PackedFloat64Array()
	var ys := PackedFloat64Array()
	var zs := PackedFloat64Array()
	var wheels: int = car.wheel_count()
	var susp: Array[PackedFloat64Array] = []
	for w in wheels:
		susp.append(PackedFloat64Array())
	var min_contacts := wheels
	for i in n:
		await clock.ticked
		var p := local(car.global_position)
		xs.append(p.x * 1000.0)
		ys.append(p.y * 1000.0)
		zs.append(p.z * 1000.0)
		for w in wheels:
			susp[w].append(float(car.susp_len[w]) * 1000.0)
		min_contacts = mini(min_contacts, car.contact_count())
	car.controls(0.0, 0.0, 0.0, false)
	var worst_std := 0.0
	var worst_p2p := 0.0
	for w in wheels:
		var s := Util.spread(susp[w], 4)
		worst_std = maxf(worst_std, s.std)
		worst_p2p = maxf(worst_p2p, s.p2p)
	return {"samples": n, "bodyYMm": Util.spread(ys, 4), "bodyXMm": Util.spread(xs, 4), "bodyZMm": Util.spread(zs, 4),
		"wheelContactNoiseStdMm": Util.r(worst_std, 4), "wheelContactNoiseP2pMm": Util.r(worst_p2p, 4), "minWheelsInContact": min_contacts}


## Full throttle from rest to 101 km/h, then full brake from 100.
func _straight() -> Dictionary:
	var p0 := car.global_position
	var f0: Vector3 = car.global_transform.basis.z * -1.0
	car.controls(1.0, 0.0, 0.0)
	var t := 0
	var t60 := -1
	var t100 := -1
	while t < 60 * 30:
		await clock.ticked
		t += 1
		var kmh: float = car.kmh()
		if t60 < 0 and kmh >= 60.0:
			t60 = t
		if t100 < 0 and kmh >= 100.0:
			t100 = t
		if kmh >= 101.0:
			break
	var d100 := (car.global_position - p0).dot(f0)
	car.controls(0.0, 1.0, 0.0)
	var bt := 0
	var p_from := car.global_position
	var t_from := -1
	while bt < 60 * 30:
		await clock.ticked
		bt += 1
		if t_from < 0 and car.kmh() <= 100.0:
			t_from = bt
			p_from = car.global_position
		if car.kmh() < 1.0:
			break
	var stop := car.global_position
	car.controls(0.0, 0.0, 0.0)
	await ticks(60)
	return {"zeroTo60S": Util.r(t60 / 60.0, 2) if t60 > 0 else null, "zeroTo100S": Util.r(t100 / 60.0, 2) if t100 > 0 else null,
		"zeroTo101DistanceM": Util.r(d100, 1),
		"brakeFrom100M": Util.r((stop - p_from).length(), 2) if t_from > 0 else null,
		"brakeTimeS": Util.r((bt - t_from) / 60.0, 2) if t_from > 0 else null,
		"lateralDriftM": Util.r(absf(local(stop).x - 1.7), 3)}


func _cruise(target: float) -> Dictionary:
	for i in 600:
		var c := _hold(car, target)
		car.controls(c.x, c.y, 0.0)
		await clock.ticked
	var xs := PackedFloat64Array()
	var ys := PackedFloat64Array()
	var sp := PackedFloat64Array()
	var wheels: int = car.wheel_count()
	var susp: Array[PackedFloat64Array] = []
	for w in wheels:
		susp.append(PackedFloat64Array())
	for i in 300:
		var c := _hold(car, target)
		car.controls(c.x, c.y, 0.0)
		await clock.ticked
		var p := local(car.global_position)
		xs.append(p.x * 1000.0)
		ys.append(p.y * 1000.0)
		sp.append(car.kmh())
		for w in wheels:
			susp[w].append(float(car.susp_len[w]) * 1000.0)
	car.controls(0.0, 0.0, 0.0)
	var worst_std := 0.0
	var worst_p2p := 0.0
	for w in wheels:
		var s := Util.spread(susp[w], 4)
		worst_std = maxf(worst_std, s.std)
		worst_p2p = maxf(worst_p2p, s.p2p)
	return {"targetKmh": target, "speedKmh": Util.spread(sp, 3), "bodyYMm": Util.spread(ys, 4), "lateralXMm": Util.spread(xs, 4),
		"wheelContactNoiseStdMm": Util.r(worst_std, 4), "wheelContactNoiseP2pMm": Util.r(worst_p2p, 4)}


## Full right lock while holding a speed: the steady turn radius.
func _turn(target: float) -> Dictionary:
	await _spawn_car(350.0, -700.0)
	var t := 0
	while t < 60 * 25 and car.kmh() < target - 0.5:
		var c := _hold(car, target)
		car.controls(c.x, c.y, 0.0)
		await clock.ticked
		t += 1
	for i in 360:
		var c := _hold(car, target)
		car.controls(c.x, c.y, 1.0)
		await clock.ticked
	var speed := 0.0
	var yaw := 0.0
	var kmh_sum := 0.0
	var max_roll := 0.0
	var n := 300
	for i in n:
		var c := _hold(car, target)
		car.controls(c.x, c.y, 1.0)
		await clock.ticked
		var vel := car.linear_velocity
		speed += Vector2(vel.x, vel.z).length()
		yaw += car.angular_velocity.y
		kmh_sum += car.kmh()
		max_roll = maxf(max_roll, absf(car.roll_deg()))
	car.controls(0.0, 0.0, 0.0)
	speed /= n
	yaw /= n
	return {"targetKmh": target, "heldKmh": Util.r(kmh_sum / n, 1), "radiusM": Util.r(speed / maxf(0.0001, absf(yaw)), 2),
		"lateralG": Util.r(speed * absf(yaw) / 9.8, 2), "maxRollDeg": Util.r(max_roll, 2)}


# ------------------------------------------------------------------ the character


func _character() -> Dictionary:
	var out := {}
	out["flat"] = await _flat()
	var gaits: Array = []
	for g in [["jog", 3.8, false], ["sprint", 6.5, true]]:
		gaits.append(await _course_run(g[0], g[1], g[2]))
	out["course"] = gaits
	return out


func _make_foot(x: float, z: float, heading: float, tint: float = 0.4) -> OnFoot:
	var c := OnFoot.new()
	c.is_player = false
	c.body_color = Color.from_hsv(tint, 0.6, 0.9)
	c.position = o + Vector3(x, 0.0, z)
	add_child(c)
	c.place(o.x + x, o.z + z, heading, o.y)
	return c


## One character on flat ground: height and sideways noise while walking, position noise while standing.
func _flat() -> Dictionary:
	var c := _make_foot(-250.0, -10.0, 0.0)
	await ticks(30)
	c.controls(Vector3(0, 0, -1), false, true)
	await ticks(60)
	var ys := PackedFloat64Array()
	var xs := PackedFloat64Array()
	var steps := PackedFloat64Array()
	var prev := c.global_position
	for i in 240:
		await clock.ticked
		var p := c.global_position
		ys.append(local(p).y * 1000.0)
		xs.append(local(p).x * 1000.0)
		steps.append((p - prev).length() * 1000.0)
		prev = p
	c.controls(Vector3.ZERO)
	await ticks(60)
	var sx := PackedFloat64Array()
	var sy := PackedFloat64Array()
	var sz := PackedFloat64Array()
	for i in 120:
		await clock.ticked
		var p := local(c.global_position)
		sx.append(p.x * 1000.0)
		sy.append(p.y * 1000.0)
		sz.append(p.z * 1000.0)
	c.queue_free()
	await get_tree().physics_frame
	var stand := maxf(Util.spread(sx).p2p, maxf(Util.spread(sy).p2p, Util.spread(sz).p2p))
	return {"walkYP2pMm": Util.spread(ys, 4).p2p, "walkLateralXP2pMm": Util.spread(xs, 4).p2p, "stepPerTickMm": Util.spread(steps, 4),
		"standingP2pMm": Util.r(stand, 4), "note": "walking 1.6 m/s for 4 s on flat ground, then standing 2 s"}


## 8 characters side by side up the on-foot course (kerb, ten stairs, landing, ramp, kerb), timed between a line 2 m before
## the first kerb and a line 2 m after the last one.
func _course_run(gait: String, target: float, sprint: bool) -> Dictionary:
	var n := 8
	var list: Array[OnFoot] = []
	for i in n:
		var x := Course.FOOT_X0 + 2.0 + 3.0 * i
		list.append(_make_foot(x, -(Course.FOOT_KERB_S - 4.0 - 0.037 * i), 0.0, 0.08 + 0.03 * i))
	await ticks(30)
	for c in list:
		c.controls(Vector3(0, 0, -1), sprint, false)
	var s_in := Course.FOOT_KERB_S - 2.0
	var s_out := Course.foot_end_s() + 2.0
	var state: Array = []
	var dist: Array = []
	var tk: Array = []
	var slowest: Array = []
	var hist: Array = []
	var prev: Array = []
	for c in list:
		state.append(0)
		dist.append(0.0)
		tk.append(0)
		slowest.append(1e9)
		hist.append(PackedFloat64Array())
		prev.append(c.global_position)
	var done := 0
	var t := 0
	var cap := int(60.0 * 3.0 * (s_out - s_in + 8.0) / target)
	while done < n and t < cap:
		await clock.ticked
		t += 1
		for i in n:
			if state[i] == 2:
				continue
			var p := list[i].global_position
			var s := -(p.z - o.z)
			var step := Vector2(p.x - prev[i].x, p.z - prev[i].z).length()
			prev[i] = p
			if state[i] == 0:
				if s >= s_in:
					state[i] = 1
				continue
			dist[i] += step
			tk[i] += 1
			var h: PackedFloat64Array = hist[i]
			h.append(step)
			if h.size() >= 12:
				var sum := 0.0
				for k in range(h.size() - 12, h.size()):
					sum += h[k]
				slowest[i] = minf(slowest[i], sum / 0.2)
			if s >= s_out:
				state[i] = 2
				done += 1
	var mean := 0.0
	var lo := 1e9
	var hi := 0.0
	var worst := 1e9
	var snags := 0
	for i in n:
		var sp: float = dist[i] / maxf(1.0, tk[i]) * 60.0
		mean += sp / n
		lo = minf(lo, sp)
		hi = maxf(hi, sp)
		worst = minf(worst, slowest[i])
		if slowest[i] < 0.8 * target:
			snags += 1
	for c in list:
		c.queue_free()
	await get_tree().physics_frame
	return {"gait": gait, "targetMs": target, "runs": n, "unfinished": n - done, "meanSpeed": Util.r(mean, 3), "minRunSpeed": Util.r(lo, 3),
		"maxRunSpeed": Util.r(hi, 3), "slowestWindowSpeed": Util.r(worst, 3), "snags": snags, "simS": Util.r(t / 60.0, 1)}


# ------------------------------------------------------------------ the camera pan


## A slow pan at eye height over the course lines and a parked car: PAN_FRAMES frames, each 2 mm along and 0.01 degrees of
## yaw further. Returns the frames as 320x180 grey images.
func _pan() -> Array:
	var parked: Vehicle = Vehicle.new()
	parked.is_player = false
	parked.position = o + Vector3(1.7, 0.0, -14.0)
	add_child(parked)
	parked.place(o.x + 1.7, o.z - 14.0, 0.0, o.y)
	parked.controls(0.0, 0.0, 0.0, true)
	await ticks(90)
	var p0 := o + Vector3(-1.6, 1.6, 6.0)
	var yaw0 := deg_to_rad(-8.0)
	var out: Array = []
	for k in PAN_FRAMES:
		cam.global_position = p0 + Vector3(PAN_STEP_M * k, 0.0, 0.0)
		cam.rotation = Vector3(deg_to_rad(-6.0), yaw0 - deg_to_rad(PAN_YAW_DEG) * k, 0.0)
		await get_tree().process_frame
		await RenderingServer.frame_post_draw
		var img := get_viewport().get_texture().get_image()
		if _dump != "" and (k == 0 or k == PAN_FRAMES - 1):
			img.save_png("%s/pan_%d_%d.png" % [_dump, int(o.x), k])
		img.resize(PAN_SIZE.x, PAN_SIZE.y, Image.INTERPOLATE_BILINEAR)
		img.convert(Image.FORMAT_L8)
		out.append(img.get_data())
	parked.queue_free()
	await get_tree().physics_frame
	return out


static func _diff(a: PackedByteArray, b: PackedByteArray) -> float:
	var sum := 0.0
	var n := mini(a.size(), b.size())
	for i in n:
		sum += absf(float(a[i]) - float(b[i]))
	return sum / maxf(1.0, n)


## For every offset: frame k against the same frame at the first origin run, frame to frame change, and the same against
## the last origin run (the noise floor: the same world rebuilt).
func _pan_report(rows: Array) -> Dictionary:
	var out := {"frames": PAN_FRAMES, "stepMm": PAN_STEP_M * 1000.0, "yawStepDeg": PAN_YAW_DEG, "imageSize": [PAN_SIZE.x, PAN_SIZE.y],
		"note": "mean absolute grey difference (0 to 255) of 320x180 frames; 'vsFirstOrigin' compares frame k with frame k of the first run at the origin"}
	var base: Array = _frames[0]
	var per: Array = []
	for r in rows:
		var fr: Array = _frames[int(r._idx)]
		var vs := PackedFloat64Array()
		var f2f := PackedFloat64Array()
		for k in PAN_FRAMES:
			vs.append(_diff(fr[k], base[k]))
			if k > 0:
				f2f.append(_diff(fr[k], fr[k - 1]))
		var s := Util.spread(f2f, 4)
		var st := Util.spread(vs, 4)
		var lo := 1e9
		var hi := 0.0
		for v in f2f:
			lo = minf(lo, v)
			hi = maxf(hi, v)
		per.append({"offsetM": r.offsetM, "vsFirstOriginMean": st.mean, "vsFirstOriginMax": Util.r(_max(vs), 4),
			"frameToFrameMean": s.mean, "frameToFrameMin": Util.r(lo, 4), "frameToFrameMax": Util.r(hi, 4), "frameToFrameStd": s.std})
	out["perOffset"] = per
	return out


static func _max(a: PackedFloat64Array) -> float:
	var m := 0.0
	for v in a:
		m = maxf(m, v)
	return m


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
