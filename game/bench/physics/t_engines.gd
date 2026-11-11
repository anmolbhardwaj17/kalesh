## Engine test of the physics bench (P0-017), decision P of ARCH_OPTIONS.md: the cost of the physics step with 200
## static and 30 dynamic bodies, and of 1000 ray casts, on whichever engine this run started with (the harness
## runs it once per engine). The dynamic bodies never sleep and are thrown again every 3 s, so the step is measured
## while they collide, not after they came to rest.
extends RefCounted

const Util := preload("res://bench/physics/util.gd")

const STATIC := 200
const DYNAMIC := 30
const PEN := Vector3(300.0, 0.0, -100.0)
const PEN_X := 60.0
const PEN_Z := 30.0

var b: Node
var clock: Node
var rng := RandomNumberGenerator.new()
var root: Node3D
var bodies: Array[RigidBody3D] = []


func run(bench: Node, _opts: Dictionary) -> Dictionary:
	b = bench
	clock = b.clock
	rng.seed = 17
	clock.set_scale(4.0)
	await b.ticks(30)
	var idle: Dictionary = await _window(600, false)
	_build()
	await b.ticks(10)
	var busy: Dictionary = await _window(1200, true)
	var rays := _rays()
	# the same load at time scale 1 (one step per rendered frame or less, worker threads idle in between)
	clock.set_scale(1.0)
	var cold: Dictionary = await _window(480, true)
	clock.set_scale(4.0)
	# not asked for: five times the dynamic bodies, for how each engine scales
	_add_dynamic(DYNAMIC * 4)
	await b.ticks(10)
	var heavy: Dictionary = await _window(900, true)
	var out := {
		"bodies": {"static": STATIC, "dynamic": DYNAMIC, "activeAvg": busy.active, "collisionPairsAvg": busy.pairs, "islandsAvg": busy.islands},
		"step": {"idle": idle.step, "busy": busy.step, "unit": "ms per physics step, server step plus body state sync",
			"idleNote": "the course collider only, no bodies of this test",
			"busyStepOnly": busy.stepOnly, "atTimeScale1StepOnly": cold.stepOnly,
			"stepOnlyNote": "the server step without the body state sync; at time scale 1 the engine steps once per rendered frame or less",
			"heavy": heavy.step, "heavyBodies": {"static": STATIC, "dynamic": DYNAMIC * 5, "activeAvg": heavy.active, "collisionPairsAvg": heavy.pairs}},
		"scriptMs": busy.script,
		"rays": rays,
	}
	_throw()
	await b.ticks(70)
	b.look_from(Vector3(PEN.x + PEN_X * 0.5, 16.0, PEN.z + PEN_Z + 22.0), Vector3(PEN.x + PEN_X * 0.5, 0.5, PEN.z + PEN_Z * 0.4))
	clock.set_scale(1.0)
	return out


func _window(n: int, throwing: bool) -> Dictionary:
	var active := 0.0
	var pairs := 0.0
	var islands := 0.0
	var samples := 0
	clock.timing_begin()
	for t in n:
		if throwing and t % 180 == 0:
			_throw()
		await clock.post_tick
		if t % 20 == 10:
			active += Performance.get_monitor(Performance.PHYSICS_3D_ACTIVE_OBJECTS)
			pairs += Performance.get_monitor(Performance.PHYSICS_3D_COLLISION_PAIRS)
			islands += Performance.get_monitor(Performance.PHYSICS_3D_ISLAND_COUNT)
			samples += 1
	clock.timing_end()
	return {"step": Util.stats(clock.step_us, 0.001), "stepOnly": Util.stats(clock.step_only_us, 0.001), "script": Util.stats(clock.script_us, 0.001),
		"active": Util.r(active / maxf(1.0, samples), 1), "pairs": Util.r(pairs / maxf(1.0, samples), 1), "islands": Util.r(islands / maxf(1.0, samples), 1)}


func _mat(c: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = 0.8
	return m


func _static_box(pos: Vector3, size: Vector3, yaw: float, mat: Material) -> void:
	var sb := StaticBody3D.new()
	sb.collision_layer = 1
	sb.collision_mask = 0
	var cs := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = size
	cs.shape = shape
	sb.add_child(cs)
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	bm.material = mat
	mi.mesh = bm
	sb.add_child(mi)
	sb.position = pos
	sb.rotation.y = yaw
	root.add_child(sb)


func _build() -> void:
	root = Node3D.new()
	root.name = "EnginePen"
	root.position = PEN
	b.world.add_child(root)
	var grey := _mat(Color(0.55, 0.52, 0.48))
	var wall := _mat(Color(0.4, 0.42, 0.46))
	# four walls, then 196 obstacle boxes on a grid
	_static_box(Vector3(PEN_X * 0.5, 1.5, -0.5), Vector3(PEN_X + 2.0, 3.0, 1.0), 0.0, wall)
	_static_box(Vector3(PEN_X * 0.5, 1.5, PEN_Z + 0.5), Vector3(PEN_X + 2.0, 3.0, 1.0), 0.0, wall)
	_static_box(Vector3(-0.5, 1.5, PEN_Z * 0.5), Vector3(1.0, 3.0, PEN_Z), 0.0, wall)
	_static_box(Vector3(PEN_X + 0.5, 1.5, PEN_Z * 0.5), Vector3(1.0, 3.0, PEN_Z), 0.0, wall)
	var n := 0
	for ix in 20:
		for iz in 10:
			if n >= STATIC - 4:
				break
			var size := Vector3(rng.randf_range(0.6, 2.0), rng.randf_range(0.3, 1.5), rng.randf_range(0.6, 2.0))
			_static_box(Vector3(1.5 + ix * 3.0, size.y * 0.5, 1.5 + iz * 3.0), size, rng.randf_range(0.0, PI), grey)
			n += 1
	_add_dynamic(DYNAMIC)


func _add_dynamic(count: int) -> void:
	for i in count:
		var rb := RigidBody3D.new()
		rb.mass = rng.randf_range(20.0, 80.0)
		rb.can_sleep = false
		rb.collision_layer = 2
		rb.collision_mask = 3
		var cs := CollisionShape3D.new()
		var mi := MeshInstance3D.new()
		var mat := _mat(Color.from_hsv(float(i) / count, 0.75, 0.9))
		if i % 3 == 0:
			var s := BoxShape3D.new()
			s.size = Vector3.ONE * rng.randf_range(0.5, 0.9)
			cs.shape = s
			var m := BoxMesh.new()
			m.size = s.size
			m.material = mat
			mi.mesh = m
		elif i % 3 == 1:
			var s := SphereShape3D.new()
			s.radius = rng.randf_range(0.3, 0.5)
			cs.shape = s
			var m := SphereMesh.new()
			m.radius = s.radius
			m.height = s.radius * 2.0
			m.material = mat
			mi.mesh = m
		else:
			var s := CapsuleShape3D.new()
			s.radius = rng.randf_range(0.25, 0.35)
			s.height = rng.randf_range(1.0, 1.6)
			cs.shape = s
			var m := CapsuleMesh.new()
			m.radius = s.radius
			m.height = s.height
			m.material = mat
			mi.mesh = m
		rb.add_child(cs)
		rb.add_child(mi)
		root.add_child(rb)
		bodies.append(rb)


## Throws every dynamic body into the pen again.
func _throw() -> void:
	for rb in bodies:
		rb.global_position = b.origin + PEN + Vector3(rng.randf_range(3.0, PEN_X - 3.0), rng.randf_range(3.0, 7.0), rng.randf_range(3.0, PEN_Z - 3.0))
		rb.linear_velocity = Vector3(rng.randf_range(-5.0, 5.0), rng.randf_range(-3.0, 0.0), rng.randf_range(-5.0, 5.0))
		rb.angular_velocity = Vector3(rng.randf_range(-4.0, 4.0), rng.randf_range(-4.0, 4.0), rng.randf_range(-4.0, 4.0))


## 20 batches of 1000 rays: half straight down into the pen, half level through the obstacles.
func _rays() -> Dictionary:
	var space := b.get_world_3d().direct_space_state as PhysicsDirectSpaceState3D
	var q := PhysicsRayQueryParameters3D.new()
	q.collision_mask = 3
	var times := PackedFloat64Array()
	var hits := 0
	var total := 0
	var base: Vector3 = b.origin + PEN
	for batch in 20:
		var from := PackedVector3Array()
		var to := PackedVector3Array()
		for i in 1000:
			var p := base + Vector3(rng.randf_range(0.0, PEN_X), 0.0, rng.randf_range(0.0, PEN_Z))
			if i % 2 == 0:
				from.append(p + Vector3(0, 12.0, 0))
				to.append(p + Vector3(0, -1.0, 0))
			else:
				var a := rng.randf_range(0.0, TAU)
				from.append(p + Vector3(0, rng.randf_range(0.2, 1.2), 0))
				to.append(from[i] + Vector3(cos(a), 0.0, sin(a)) * 30.0)
		var t0 := Time.get_ticks_usec()
		for i in 1000:
			q.from = from[i]
			q.to = to[i]
			if not space.intersect_ray(q).is_empty():
				hits += 1
		times.append(Time.get_ticks_usec() - t0)
		total += 1000
	var st := Util.stats(times, 0.001)
	return {"msPer1000": st, "msPerFrameAt1000PerSecond": Util.r(float(st.p50) / 60.0, 4), "usPerRay": Util.r(float(st.p50), 3),
		"hitShare": Util.r(float(hits) / total, 3), "batches": 20, "note": "intersect_ray from GDScript with one reused query object, against 200 static and 30 dynamic bodies plus the course mesh"}
