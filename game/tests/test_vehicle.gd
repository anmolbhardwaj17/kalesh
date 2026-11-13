## The V2 vehicle (P1-020): the car tune, the drive input logic (gears, steer rate and lock by speed, brakes, reverse,
## the parking hold), the tyre maths, and the axis rule on a real physics body (heading 0 drives toward -Z, PI/2
## toward +X, rotation.y = -heading).
extends RefCounted

const Tune := preload("res://vehicles/vehicle_tune.gd")
const DriveInput := preload("res://vehicles/drive_input.gd")
const Tyre := preload("res://vehicles/tyre_model.gd")
const Vehicle := preload("res://vehicles/vehicle.gd")
const OnFoot := preload("res://characters/on_foot.gd")
const CAR := "res://data/vehicles/car.tres"
const AUTO := "res://data/vehicles/auto.tres"
const SCOOTER := "res://data/vehicles/scooter.tres"
const PATROL := "res://data/vehicles/patrol_car.tres"
const DT := 1.0 / 60.0

var t
var tree: SceneTree


func test_car_tune_loads_with_its_numbers() -> void:
	var c := load(CAR) as Tune
	t.ok(c != null, "car.tres loads as a vehicle tune")
	t.ok(c.id == "car" and c.wheels.size() == 4, "the car has four wheels")
	t.near(c.health, 1000.0, 0.0, "vehicle health 1000 (data only)")
	t.near(c.mass, 1730.0, 0.0, "the KEEP mass")
	t.ok(c.gears.size() == c.gear_force.size(), "one force share per gear")
	t.ok(float(c.gears[-1]) > 140.0, "the top gear reaches past 140 km/h (%s)" % c.gears[-1])
	var ride := c.ride_height()
	t.ok(ride > c.radius and ride < 0.5, "ride height %.3f m" % ride)
	t.ok(c.box_y - c.box_half.y + ride > c.radius * 0.7, "the body box clears the ground at rest")


## P1-021: the auto, the scooter and the patrol car tunes (GAME.md vehicle table): wheels, gears that reach the top
## speed, a shift before each fade, the body clear of the ground, the stand-in bodies and the camera view.
func test_auto_scooter_and_patrol_tunes() -> void:
	var a := load(AUTO) as Tune
	var s := load(SCOOTER) as Tune
	var pc := load(PATROL) as Tune
	var c := load(CAR) as Tune
	t.ok(a != null and s != null and pc != null, "auto, scooter and patrol_car tunes load")
	t.ok(a.id == "auto" and a.wheels.size() == 3, "the auto has three wheels")
	t.ok(s.id == "scooter" and s.wheels.size() == 2, "the scooter has two wheels")
	t.ok(a.body == "auto" and s.body == "scooter", "kit bodies for the auto and the scooter")
	t.ok(a.camera_view == "close", "the auto starts in the close chase camera (GAME.md)")
	t.ok(s.roll_stiffness > 0.0 and s.lean_max > 0.0, "the scooter has the hidden stabiliser and a visual lean")
	t.ok(a.roll_stiffness == 0.0 and c.roll_stiffness == 0.0, "no stabiliser on the auto or the car")
	for tune in [a, s]:
		t.ok(tune.gears.size() == tune.gear_force.size(), "%s: one force share per gear" % tune.id)
		t.ok(tune.shift_at <= 1.0 - tune.fade_share + 1e-6, "%s: shifts before the fade starts" % tune.id)
		var ride: float = tune.ride_height()
		t.ok(tune.box_y - tune.box_half.y + ride > tune.radius * 0.4, "%s: the body box clears the ground at rest" % tune.id)
		t.ok(ride > tune.radius, "%s: ride height %.3f m over the wheel radius" % [tune.id, ride])
		var sag: float = 9.8 / (tune.stiffness * tune.wheels.size())
		t.ok(sag < tune.travel * 0.85, "%s: the static sag %.3f m sits inside the travel %.2f m (not on the bump stop)" % [tune.id, sag, tune.travel])
	t.ok(float(a.gears[-1]) > 65.0 and float(a.gears[-1]) < 70.0, "the auto's top gear ends just over 65 km/h")
	t.ok(float(s.gears[-1]) > 90.0 and float(s.gears[-1]) < 95.0, "the scooter's top gear ends just over 90 km/h")
	for w in s.wheels:
		t.near(float(w[0]), 0.0, 0.0, "the scooter's wheels are on the centre line")
	t.ok(pc.id == "patrol_car", "patrol_car id")
	for k in ["mass", "engine", "brake", "max_steer", "grip_front", "grip_rear", "linear_damp", "compression", "relaxation", "fade_share", "shift_at"]:
		t.near(float(pc.get(k)), float(c.get(k)), 1e-9, "the patrol car starts as the car tune (%s)" % k)
	t.ok(pc.gears == c.gears and pc.gear_force == c.gear_force, "the patrol car has the car's gears")


## The scooter's hidden stabiliser on a real body: it stands, drives straight and stays upright; the drawn body leans
## while the physics body does not.
func test_scooter_stands_and_drives_upright() -> void:
	var clock := tree.root.get_node("SimClock")
	clock.set_scale(1.0)
	var world := Node3D.new()
	world.name = "ScooterTestWorld"
	var ground := StaticBody3D.new()
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(400, 1, 400)
	cs.shape = box
	cs.position = Vector3(0, -0.5, 0)
	ground.add_child(cs)
	world.add_child(ground)
	var v: RigidBody3D = Vehicle.new()
	v.is_player = false
	v.tune_path = SCOOTER
	world.add_child(v)
	tree.root.add_child(world)
	v.controls(1.0, 0.0, 0.0)
	var worst := 0.0
	for i in 150:
		await tree.physics_frame
		worst = maxf(worst, absf(v.roll_deg()))
	t.ok(v.is_settled(), "the scooter settled on the ground")
	t.ok(-v.global_position.z > 4.0, "the scooter drove %.2f m north" % -v.global_position.z)
	t.ok(worst < 2.0, "the scooter stayed upright on a straight (worst roll %.2f degrees)" % worst)
	v.controls(0.6, 0.0, 1.0)
	var lean := 0.0
	for i in 90:
		await tree.physics_frame
		lean = maxf(lean, v.lean)
		worst = maxf(worst, absf(v.roll_deg()))
	t.ok(lean > deg_to_rad(5.0), "the drawn body leans right into a right turn (%.1f degrees)" % rad_to_deg(lean))
	t.ok(worst < 15.0, "the physics body stays near upright in the turn (%.2f degrees)" % worst)
	tree.root.remove_child(world)
	world.free()
	await tree.physics_frame


func test_drive_input_gears_brakes_reverse_and_hold() -> void:
	var c := load(CAR) as Tune
	var d := DriveInput.new()
	d.throttle_in = 1.0
	d.update(c, 0.0, DT)
	t.ok(d.gear == 1 and d.engine > 0.0, "throttle from rest: first gear and engine force")
	var g1 := d.engine
	d.update(c, float(c.gears[0]) * 0.95, DT)
	t.ok(d.gear == 2, "shifts up near the top of first gear")
	t.near(d.engine, 0.0, 0.0, "clutch out in the shift pause")
	for i in 30:
		d.update(c, float(c.gears[0]) * 1.05, DT)
	t.near(d.engine, g1 * c.force_share(2), 1e-3, "second gear pulls with its force share (%.0f)" % d.engine)
	var g3 := DriveInput.new()
	g3.gear = 3
	g3.throttle_in = 1.0
	g3.update(c, float(c.gears[1]) * 1.02, DT)
	t.ok(g3.engine > 0.0 and g3.engine < g1, "third gear pulls with less force than first (%.0f < %.0f)" % [g3.engine, g1])
	var top := DriveInput.new()
	top.gear = c.gears.size()
	top.throttle_in = 1.0
	top.update(c, float(c.gears[-1]), DT)
	t.near(top.engine, 0.0, 1e-6, "no engine force at the top of the last gear")
	var b := DriveInput.new()
	b.brake_in = 1.0
	b.update(c, 80.0, DT)
	t.near(b.brake, c.brake, 1e-6, "the brake pedal brakes while rolling forward")
	t.near(b.engine, 0.0, 0.0, "no engine force while braking forward")
	var r := DriveInput.new()
	r.brake_in = 1.0
	r.update(c, 0.0, DT)
	t.ok(r.engine < 0.0, "the brake pedal at a standstill reverses")
	var park := DriveInput.new()
	park.update(c, 0.5, DT)
	t.near(park.brake, c.brake, 1e-6, "no pedal near a standstill: the brakes hold the car")


func test_drive_input_steer_rate_and_lock_by_speed() -> void:
	var c := load(CAR) as Tune
	var d := DriveInput.new()
	d.steer_in = 1.0
	d.update(c, 0.0, DT)
	t.near(d.steer, c.steer_rate * DT, 1e-6, "steer moves at the steer rate")
	for i in 120:
		d.update(c, 0.0, DT)
	t.near(d.steer, c.max_steer, 1e-6, "full lock at a standstill")
	var f := DriveInput.new()
	f.steer_in = 1.0
	for i in 120:
		f.update(c, 140.0, DT)
	t.ok(f.steer < c.max_steer * 0.5, "less lock at 140 km/h (%.3f rad)" % f.steer)
	f.steer_in = 0.0
	f.update(c, 140.0, DT)
	t.ok(f.steer < c.max_steer * 0.5 - c.steer_rate * DT, "steer returns faster than it goes out")


func test_tyre_maths() -> void:
	t.ok(Tyre.side_impulse(0.2, 1.2, 1.0, 1.0 / 400.0) < 0.0, "the side impulse works against the slip")
	t.near(Tyre.forward_impulse(1000.0, 0.0, 5.0, 0.001, 1, DT), 1000.0 * DT, 1e-9, "engine impulse is force times step")
	t.near(Tyre.forward_impulse(0.0, 50.0, 10.0, 0.001, 4, DT), -50.0, 1e-9, "a brake impulse is capped")
	t.near(Tyre.forward_impulse(0.0, 50.0, 0.01, 0.001, 4, DT), -2.5, 1e-9, "a small speed is stopped, shared by the braked wheels")
	t.near(Tyre.grip_scale(0.0, 3.0, 6.0), 1.0, 0.0, "inside the grip circle nothing is cut")
	t.near(Tyre.grip_scale(0.0, 12.0, 6.0), 0.5, 1e-9, "outside the grip circle the impulses are cut to it")
	var inv := Tyre.inv_mass_along(1.0 / 1730.0, Basis.IDENTITY.scaled(Vector3(1.0 / 3600.0, 1.0 / 3820.0, 1.0 / 814.0)), Vector3(0.78, -0.4, -1.43), Vector3.RIGHT)
	t.ok(inv > 1.0 / 1730.0, "an offset contact feels lighter than the whole body")


## A real body on a ground box: heading 0 drives toward -Z and PI/2 toward +X under throttle (engine physics frames).
func test_vehicle_drives_along_its_heading() -> void:
	var clock := tree.root.get_node("SimClock")
	clock.set_scale(1.0)
	for h in [0.0, PI / 2.0]:
		var world := Node3D.new()
		world.name = "VehicleTestWorld"
		var ground := StaticBody3D.new()
		var cs := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = Vector3(400, 1, 400)
		cs.shape = box
		cs.position = Vector3(0, -0.5, 0)
		ground.add_child(cs)
		world.add_child(ground)
		var v: RigidBody3D = Vehicle.new()
		v.is_player = false
		v.rotation.y = -h
		world.add_child(v)
		tree.root.add_child(world)
		v.controls(1.0, 0.0, 0.0)
		for i in 150:
			await tree.physics_frame
		var p: Vector3 = v.global_position
		var f: Vector3 = Vector3(sin(h), 0.0, -cos(h))
		var along := p.dot(f)
		var across := absf(p.x * f.z - p.z * f.x)
		t.ok(v.is_settled(), "heading %.2f: the vehicle settled on the ground" % h)
		t.ok(along > 4.0, "heading %.2f: drove %.2f m along forward(heading)" % [h, along])
		t.ok(across < 0.05, "heading %.2f: %.3f m off the line" % [h, across])
		t.ok(absf(sin(v.rotation.y + h)) < 1e-3, "heading %.2f: rotation.y is -heading (%.4f)" % [h, v.rotation.y])
		t.near(p.y, v.tune.ride_height(), 0.02, "heading %.2f: rides at its tuned height" % h)
		tree.root.remove_child(world)
		world.free()
		await tree.physics_frame


## P1-024: the vehicle body collides with people on foot (on_foot.gd LAYER is in vehicle.gd MASK): a car driven at a
## person standing 12 m ahead stops against them and never passes through, and the person stays standing.
func test_car_stops_against_a_person() -> void:
	t.ok(Vehicle.MASK & OnFoot.LAYER != 0, "the vehicle mask %d holds the character layer %d" % [Vehicle.MASK, OnFoot.LAYER])
	t.ok(OnFoot.MASK & 2 != 0, "and the character collides with vehicles (layer 2)")
	var clock := tree.root.get_node("SimClock")
	clock.set_scale(1.0)
	var world := Node3D.new()
	world.name = "PersonTestWorld"
	var ground := StaticBody3D.new()
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(400, 1, 400)
	cs.shape = box
	cs.position = Vector3(0, -0.5, 0)
	ground.add_child(cs)
	world.add_child(ground)
	var v: RigidBody3D = Vehicle.new()
	v.is_player = false
	world.add_child(v)
	var person: CharacterBody3D = OnFoot.new()
	person.is_player = false
	world.add_child(person)
	tree.root.add_child(world)
	person.place(0.0, -12.0, PI)
	var front_gap := INF
	for i in 300:
		v.controls(1.0, 0.0, 0.0)
		await tree.physics_frame
		# the bumper's distance to the person's capsule axis (the car faces -Z)
		front_gap = minf(front_gap, (v.global_position.z - v.tune.box_half.z) - person.global_position.z)
	var stopped_kmh := absf(float(v.kmh()))
	t.ok(v.global_position.z > person.global_position.z + v.tune.box_half.z * 0.5, "the car never passed the person (car z %.2f, person z %.2f)" % [v.global_position.z, person.global_position.z])
	t.ok(front_gap > OnFoot.RADIUS - 0.15, "the bumper stopped at the capsule (closest %.2f m from its axis, radius %.2f)" % [front_gap, OnFoot.RADIUS])
	t.ok(stopped_kmh < 3.0, "the car is held against the person (%.1f km/h at the end)" % stopped_kmh)
	t.ok(absf(person.global_position.y) < 0.1, "the person still stands on the ground (y %.3f)" % person.global_position.y)
	tree.root.remove_child(world)
	world.free()
	await tree.physics_frame
