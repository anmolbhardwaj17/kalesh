## Traffic cost test of the physics bench (P0-017), option TR2 of ARCH_OPTIONS.md: 30 cars that are all physics
## vehicles (kind v2, or v1 for the engine-side cost of VehicleBody3D), driving a loop at 40 km/h with a simple
## driver. Reports the script time per tick, the physics step with and without the cars, and the cost per car.
extends RefCounted

const Util := preload("res://bench/physics/util.gd")
const PathDriver := preload("res://bench/physics/path_driver.gd")

const CARS := 30
const CENTRE := Vector3(320.0, 0.0, -1000.0)
const TARGET_KMH := 40.0

var b: Node
var clock: Node


func run(bench: Node, opts: Dictionary) -> Dictionary:
	b = bench
	clock = b.clock
	var kind := str(opts.get("kind", "v2"))
	clock.set_scale(4.0)
	await b.ticks(30)
	clock.timing_begin()
	await b.ticks(600)
	clock.timing_end()
	var step_base := Util.stats(clock.step_us, 0.001)
	var path := PathDriver.oval(CENTRE, 240.0, 40.0, 1.0)
	var n := path.size()
	var cars: Array[Node] = []
	var idx := PackedInt32Array()
	for i in CARS:
		var k := int(float(n) * i / CARS)
		var t := path[(k + 1) % n] - path[k]
		var v: Node = b.spawn_vehicle(kind, path[k], atan2(t.x, -t.z))
		cars.append(v)
		idx.append(k)
	b.look_from(CENTRE + Vector3(75, 38, 150), CENTRE + Vector3(10, 0, 60))
	# warm up to speed, then measure
	var kmh := 0.0
	var min_contacts := 4
	var us0 := 0
	var ticks0 := 0
	var total := 300 + 1200
	for t in total:
		if t == 300:
			for v in cars:
				us0 += int(v.cpu_us)
				ticks0 += int(v.cpu_ticks)
			clock.timing_begin()
		for i in CARS:
			var v := cars[i]
			var p: Vector3 = b.local((v as Node3D).global_position)
			p.y = 0.0
			var k := idx[i]
			while p.distance_squared_to(path[(k + 1) % n]) <= p.distance_squared_to(path[k]):
				k = (k + 1) % n
			idx[i] = k
			var c := PathDriver.hold_speed(v, TARGET_KMH)
			v.controls(c.x, c.y, PathDriver.steer_to(v, b.origin + path[(k + 10) % n], 2.5))
			if t >= 300:
				kmh += float(v.kmh())
				min_contacts = mini(min_contacts, v.contact_count())
		await clock.post_tick
	clock.timing_end()
	var us := 0
	var ticks := 0
	for v in cars:
		us += int(v.cpu_us)
		ticks += int(v.cpu_ticks)
	var script_ms_per_car := float(us - us0) / maxf(1.0, ticks - ticks0) / 1000.0
	var step := Util.stats(clock.step_us, 0.001)
	var engine_per_car := (float(step.mean) - float(step_base.mean)) / CARS
	clock.set_scale(1.0)
	return {
		"kind": kind, "cars": CARS, "targetKmh": TARGET_KMH, "heldKmh": Util.r(kmh / (1200.0 * CARS), 1), "minWheelsInContact": min_contacts,
		"scriptMsPerCar": Util.r(script_ms_per_car, 4), "scriptMsPerTick": Util.r(script_ms_per_car * CARS, 3),
		"stepBase": step_base, "step": step, "engineMsPerCar": Util.r(engine_per_car, 4),
		"perCarMs": Util.r(script_ms_per_car + engine_per_car, 4), "totalMsPerTick": Util.r(script_ms_per_car * CARS + float(step.mean), 3),
		"note": "scriptMs is the vehicle's own sim_step (for v1: the driver logic and setting wheel values; the wheel maths runs inside the engine and shows in the step). The test driver's steering code is not counted",
	}
