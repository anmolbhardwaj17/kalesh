## Pure parts of the physics bench (game/bench/physics/, P0-017): the C1 clock rates, the driver logic on the KEEP
## tune, the triangle builder (one vertex list for mesh and collider), the seeded tile, the paths, the frames of
## both vehicles (never mirrored) and the stand-in ragdoll.
extends RefCounted

const BenchClock := preload("res://bench/physics/bench_clock.gd")
const DriveLogic := preload("res://bench/physics/drive_logic.gd")
const Tune := preload("res://bench/physics/tune.gd")
const Geo := preload("res://bench/physics/geo.gd")
const Tile := preload("res://bench/physics/tile.gd")
const Course := preload("res://bench/physics/course.gd")
const PathDriver := preload("res://bench/physics/path_driver.gd")
const VehicleV1 := preload("res://bench/physics/vehicle_v1.gd")
const VehicleV2 := preload("res://bench/physics/vehicle_v2.gd")
const Ragdoll := preload("res://bench/physics/ragdoll.gd")
const Util := preload("res://bench/physics/util.gd")

var t
var tree: SceneTree


func test_c1_time_scale_keeps_the_step_at_one_sixtieth() -> void:
	for s in [0.25, 0.3, 0.5, 1.0, 2.0, 4.0, 8.0]:
		var r: Dictionary = BenchClock.c1_rates(s)
		t.near(r.step, 1.0 / 60.0, 1e-12, "the sim step at time scale %s" % s)
		t.ok(int(r.ticksPerSecond) == roundi(60.0 * s), "whole physics frames per second at scale %s (%s)" % [s, r.ticksPerSecond])
	t.ok(int(BenchClock.c1_rates(0.25).ticksPerSecond) == 15 and int(BenchClock.c1_rates(4.0).ticksPerSecond) == 240, "15 and 240 physics frames per second at scale 0.25 and 4")
	t.ok(int(BenchClock.c1_rates(0.0).ticksPerSecond) == 1, "never zero physics frames per second")


func test_keep_tune_numbers_and_clearance() -> void:
	var c: Tune = Tune.car()
	t.ok(c.mass == 1730.0 and c.inertia == Vector3(3600, 3820, 814), "mass and inertia of the KEEP tune")
	t.ok(c.wheels.size() == 4 and c.radius == 0.34 and c.rest == 0.32 and c.stiffness == 28.0, "four wheels, radius, rest length, stiffness")
	t.ok(c.grip_front == 3.1 and c.grip_rear == 2.2 and c.grip_handbrake == 0.9 and c.max_steer == 0.64, "grip and steer lock")
	var front_steer := true
	var rear_drive := true
	for w in c.wheels:
		if float(w[2]) < 0.0:
			front_steer = front_steer and bool(w[3]) and not bool(w[4])
		else:
			rear_drive = rear_drive and bool(w[4]) and not bool(w[3])
	t.ok(front_steer and rear_drive, "front wheels (-Z) steer, rear wheels drive")
	# the body box must clear more than one wheel radius with the suspension unloaded (the old kerb rule)
	var clearance := (c.rest + c.radius - float(c.wheels[0][1])) + (c.box_y - c.box_half.y)
	t.ok(clearance > c.radius, "box clearance %.3f m is more than one wheel radius" % clearance)
	t.near(c.ride_height(), 0.3725, 0.001, "ride height of the origin at rest")
	var a: Tune = Tune.auto()
	t.ok(a.wheels.size() == 3 and float(a.gears[a.gears.size() - 1]) == 65.0, "the auto has three wheels and a 65 km/h top gear")
	t.ok(c.to_dict().massKg == 1730.0, "the tune goes into the report")


func test_drive_logic_gears_fade_steer_and_brakes() -> void:
	var c: Tune = Tune.car()
	var d := DriveLogic.new()
	d.update(c, 0.0, 1.0, 0.0, 1.0, false, 1.0 / 60.0)
	t.ok(d.gear == 1 and d.engine == 5200.0 and d.brake == 0.0, "full throttle from rest: first gear, full engine force")
	t.near(d.steer, 1.10 / 60.0, 1e-9, "the steering wheel turns at its rate limit")
	d.update(c, 33.0, 1.0, 0.0, 0.0, false, 1.0 / 60.0)
	t.ok(d.gear == 2 and d.shift_timer > 0.0, "shifts up at 92 percent of the gear's top speed")
	t.ok(d.steer < 1.10 / 60.0, "the wheel returns when the input is released")
	var top := DriveLogic.new()
	top.gear = 6
	top.update(c, 110.0, 1.0, 0.0, 0.0, false, 1.0 / 60.0)
	t.ok(top.engine == 0.0, "no engine force at the top of the last gear")
	top.update(c, 93.0, 1.0, 0.0, 0.0, false, 1.0 / 60.0)
	t.ok(top.engine == 5200.0, "full force below 85 percent of the gear's top speed")
	var fast := DriveLogic.new()
	for i in 120:
		fast.update(c, 170.0, 0.0, 0.0, 1.0, false, 1.0 / 60.0)
	t.near(fast.steer, 0.64 * 0.4, 1e-6, "steer lock is cut by 60 percent at speed")
	var b := DriveLogic.new()
	b.update(c, 50.0, 0.0, 1.0, 0.0, false, 1.0 / 60.0)
	t.ok(b.brake == 90.0 and b.engine == 0.0, "the brake pedal brakes while rolling forward")
	b.update(c, 0.0, 0.0, 1.0, 0.0, false, 1.0 / 60.0)
	t.ok(b.brake == 0.0 and b.engine == -5200.0 * 0.6, "the brake pedal reverses from a standstill")
	b.update(c, -20.0, 1.0, 0.0, 0.0, false, 1.0 / 60.0)
	t.ok(b.brake == 90.0, "throttle brakes while rolling backwards")


func test_geo_one_vertex_list_for_mesh_and_collider() -> void:
	var g := Geo.new()
	g.box(Vector3(0, 0, 0), Vector3(2, 1, 3), Color.WHITE)
	t.ok(g.triangles() == 10, "a box without a bottom is 10 triangles (%d)" % g.triangles())
	var up := 0
	var outward := true
	for i in range(0, g.verts.size(), 3):
		var n := (g.verts[i + 2] - g.verts[i]).cross(g.verts[i + 1] - g.verts[i]).normalized()
		var centre := (g.verts[i] + g.verts[i + 1] + g.verts[i + 2]) / 3.0
		if n.y > 0.99:
			up += 1
		outward = outward and n.dot(centre - Vector3(1, 0.5, 1.5)) > 0.0
	t.ok(up == 2 and outward, "every face looks outward, the top looks up")
	var m := g.mesh()
	var s := g.shape()
	t.ok((m.surface_get_arrays(0)[Mesh.ARRAY_VERTEX] as PackedVector3Array) == g.verts, "the mesh draws the vertex list")
	t.ok(s.get_faces() == g.verts, "the collider is the same vertex list")
	t.near(Geo.height_at(g.verts, 1.0, 1.0), 1.0, 1e-6, "the drawn height on the box")
	t.ok(is_nan(Geo.height_at(g.verts, 5.0, 5.0)), "nothing drawn beside the box")
	var r := Geo.new()
	r.ramp(0.0, 4.0, 0.0, 0.0, -10.0, 1.0, 0.0, Color.WHITE)
	t.near(Geo.height_at(r.verts, 2.0, -5.0), 0.5, 1e-5, "half way up a ramp")


func test_tile_is_seeded_and_samples_stand_on_open_ground() -> void:
	var a := Tile.new()
	a.build()
	var b := Tile.new()
	b.build()
	a.stats.erase("dataBuildMs")
	b.stats.erase("dataBuildMs")
	t.ok(a.stats == b.stats and a.samples == b.samples, "two builds are the same")
	t.ok(a.shells.size() == 36 and a.samples.size() == 20, "36 buildings and 20 sample points")
	t.ok(a.stats.detailTriangles > a.stats.surfaceTriangles * 5, "the drawn detail is much heavier than the surfaces (%s against %s)" % [a.stats.detailTriangles, a.stats.surfaceTriangles])
	var clear := true
	for p in a.samples:
		clear = clear and a._clear_of_buildings(p.x, p.y, 1.0) and not is_nan(Geo.height_at(a.surfaces.verts, p.x, p.y))
	t.ok(clear, "every sample point is on a drawn surface, away from buildings")
	t.ok(Tile.kind_at(0.0, 60.0) == 0 and Tile.kind_at(6.0, 60.0) == 1 and Tile.kind_at(40.0, 60.0) == 2, "road, footpath, plot")
	t.near(Geo.height_at(a.surfaces.verts, 5.02, 60.0) - Geo.height_at(a.surfaces.verts, 4.98, 60.0), Tile.KERB, 0.01, "the kerb is 0.15 m")


func test_course_has_its_features() -> void:
	var root := Node3D.new()
	var c := Course.new()
	c.build(root)
	t.ok(c.stats.triangles > 1000 and c.body != null and c.body.get_child_count() == 1, "one collider body from the drawn vertices")
	t.near(Geo.height_at(c.geo.verts, 40.0, -65.0), Course.KERB, 1e-5, "the square kerb slab")
	var deck_z: float = Course.RAMP_START - Course.RAMP_LEN
	t.near(Geo.height_at(c.geo.verts, Course.FLYOVER_X, deck_z - 10.0), Course.FLYOVER_H, 0.02, "the flyover deck")
	t.near(Geo.height_at(c.geo.verts, Course.FLYOVER_X, -100.0), Course.FLYOVER_H * 0.5, 0.01, "half way up the 6 percent ramp")
	# P1-044: the ramp top is a crest curve, not a kink: the drawn slope changes by under 0.6 percent per 2 m step and
	# ends level at the deck height
	var prev := NAN
	var worst := 0.0
	var zz := Course.RAMP_START - 70.0
	while zz > deck_z + 0.5:
		var g: float = (Geo.height_at(c.geo.verts, Course.FLYOVER_X, zz - 2.0) - Geo.height_at(c.geo.verts, Course.FLYOVER_X, zz)) / 2.0
		if not is_nan(prev):
			worst = maxf(worst, absf(g - prev))
		prev = g
		zz -= 2.0
	t.ok(worst < 0.006 and absf(prev) < 0.004, "the crest curve changes the grade by at most %.4f per 2 m and ends level (last %.4f)" % [worst, prev])
	t.near(Geo.height_at(c.geo.verts, Course.FLYOVER_X, deck_z + 0.2), Course.FLYOVER_H, 0.01, "the ramp meets the deck level")
	t.near(Geo.height_at(c.geo.verts, -185.0, -(Course.FOOT_STAIRS_S + 0.15)), Course.KERB + Course.RISER, 1e-5, "the first stair")
	t.near(Geo.height_at(c.geo.verts, -185.0, -(Course.FOOT_STAIRS_S + 3.5)), Course.foot_top_y(), 1e-5, "the landing over ten 0.18 m risers")
	root.free()


func test_paths() -> void:
	var p := PathDriver.left_turn_path(Vector3(10, 0, 0), 20.0, 6.0, 15.0)
	var last := p[p.size() - 1]
	t.near(last.x, 10.0 - 6.0 - 15.0, 0.01, "a left turn ends to the west")
	t.near(last.z, -26.0, 0.01, "one radius further north")
	var o := PathDriver.oval(Vector3.ZERO, 100.0, 30.0, 1.0)
	t.less(o[0].distance_to(o[o.size() - 1]), 2.0, "the oval closes")
	var north := o[1].z < o[0].z and o[0].x > 0.0
	t.ok(north, "north along the east side: counter-clockwise from above")


func test_vehicles_face_north_and_are_not_mirrored() -> void:
	var v2 := VehicleV2.new()
	v2.setup(Tune.car())
	t.ok(v2.wheel_count() == 4 and v2._front[0] == 1 and v2._front[2] == 0, "V2: wheels 0 and 1 are the front ones")
	t.ok(v2._hard[1] == Vector3(0.78, 0.2, -1.43), "V2: the front right wheel is at +X, -Z")
	var v1 := VehicleV1.new()
	v1.setup(Tune.car())
	# the built-in vehicle drives along +Z, so its body is turned half a turn: both x and z change sign (a rotation)
	t.ok(v1._wheels[1].position.is_equal_approx(Vector3(-0.78, 0.2, 1.43)), "V1: the front right wheel after the half turn")
	t.ok(v1._wheels[0].use_as_steering and not v1._wheels[0].use_as_traction and v1._wheels[2].use_as_traction, "V1: front steers, rear drives")
	t.ok(Basis(Vector3.UP, PI).determinant() > 0.0, "a half turn is a rotation, not a mirror")
	var auto := VehicleV2.new()
	auto.setup(Tune.auto())
	t.ok(auto.wheel_count() == 3, "the auto has three wheels on the same vehicle code")
	v2.free()
	v1.free()
	auto.free()


func test_ragdoll_and_stats() -> void:
	var d := Ragdoll.new()
	var sk := d.build(Color.WHITE)
	var mass := 0.0
	for pb in d.bones:
		mass += pb.mass
	t.ok(d.bones.size() == 10 and sk.get_bone_count() == 10, "ten bones, one physical bone each")
	t.near(mass, 75.0, 0.001, "75 kg")
	sk.free()
	var s: Dictionary = Util.stats(PackedFloat64Array([1000.0, 2000.0, 3000.0, 4000.0]), 0.001)
	t.ok(s.n == 4 and s.max == 4.0 and s.mean == 2.5, "stats in ms from microseconds")
	var sp: Dictionary = Util.spread(PackedFloat64Array([1.0, 3.0]))
	t.ok(sp.p2p == 2.0 and sp.mean == 2.0 and sp.std == 1.0, "spread of a series")
