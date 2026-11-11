## Combat test of the physics bench (P0-017), option CB1 of ARCH_OPTIONS.md:
##   hitscan  rays against 100 characters that each carry three hit zones (head, torso, limbs) as shapes of one
##            Area3D; the zone is the shape the ray hit. 20 batches of 1000 rays, plus an aim check.
##   ragdolls 10 ragdolls (PhysicalBoneSimulator3D, ragdoll.gd) pushed over the stairs and the kerb of the on-foot
##            course: step time while they fall and while they lie, and stability (speed, joint gaps, tunnelling).
extends RefCounted

const Util := preload("res://bench/physics/util.gd")
const Ragdoll := preload("res://bench/physics/ragdoll.gd")
const Course := preload("res://bench/physics/course.gd")

const CHARACTERS := 100
const HIT_LAYER := 32
const GRID := Vector3(300.0, 0.0, -330.0)
const SPACING := 2.5
## Shape index to zone: 0 head, 1 torso, 2 limbs.
const ZONE_OF_SHAPE := [0, 1, 2, 2]
const ZONE_NAMES := ["head", "torso", "limbs"]
const RAGDOLLS := 10

var b: Node
var clock: Node
var rng := RandomNumberGenerator.new()
var chars: Array[Area3D] = []
var home := PackedVector3Array()


func run(bench: Node, _opts: Dictionary) -> Dictionary:
	b = bench
	clock = b.clock
	rng.seed = 23
	clock.set_scale(4.0)
	_characters()
	await b.ticks(20)
	var out := {"characters": CHARACTERS, "zones": {"names": ZONE_NAMES, "shapesPerCharacter": 4, "how": "one Area3D per character, 4 shapes (head sphere, torso box, arms box, legs box); the hit zone is the shape index of the ray result"}}
	# cost of moving the hit zones every tick
	var move_us := PackedFloat64Array()
	clock.timing_begin()
	for t in 600:
		var t0 := Time.get_ticks_usec()
		_move(t)
		move_us.append(Time.get_ticks_usec() - t0)
		await clock.post_tick
	clock.timing_end()
	out["moveMsPerTick"] = {"script": Util.stats(move_us, 0.001), "physicsStep": Util.stats(clock.step_us, 0.001)}
	out["rays"] = _rays()
	b.look_from(GRID + Vector3(12.0, 5.0, 34.0), GRID + Vector3(12.0, 1.0, 10.0))
	out["ragdolls"] = await _ragdolls()
	clock.set_scale(1.0)
	return out


func _characters() -> void:
	var root := Node3D.new()
	root.name = "HitCharacters"
	b.world.add_child(root)
	var mats: Array[StandardMaterial3D] = []
	for c in [Color(0.9, 0.75, 0.6), Color(0.2, 0.4, 0.7), Color(0.25, 0.25, 0.3)]:
		var m := StandardMaterial3D.new()
		m.albedo_color = c
		mats.append(m)
	for i in CHARACTERS:
		var a := Area3D.new()
		a.collision_layer = HIT_LAYER
		a.collision_mask = 0
		a.monitoring = false
		a.monitorable = false
		var head := SphereShape3D.new()
		head.radius = 0.12
		var torso := BoxShape3D.new()
		torso.size = Vector3(0.4, 0.6, 0.24)
		var arms := BoxShape3D.new()
		arms.size = Vector3(0.74, 0.5, 0.12)
		var legs := BoxShape3D.new()
		legs.size = Vector3(0.34, 0.9, 0.2)
		var parts: Array = [[head, Vector3(0, 1.63, 0), 0], [torso, Vector3(0, 1.2, 0), 1], [arms, Vector3(0, 1.2, 0), 2], [legs, Vector3(0, 0.45, 0), 2]]
		for p in parts:
			var cs := CollisionShape3D.new()
			cs.shape = p[0]
			cs.position = p[1]
			a.add_child(cs)
			var mi := MeshInstance3D.new()
			if p[0] is SphereShape3D:
				var sm := SphereMesh.new()
				sm.radius = 0.12
				sm.height = 0.24
				mi.mesh = sm
			else:
				var bm := BoxMesh.new()
				bm.size = (p[0] as BoxShape3D).size
				mi.mesh = bm
			mi.material_override = mats[p[2]]
			mi.position = p[1]
			a.add_child(mi)
		var at: Vector3 = b.origin + GRID + Vector3((i % 10) * SPACING, 0.0, int(i / 10.0) * SPACING)
		root.add_child(a)
		a.global_position = at
		chars.append(a)
		home.append(at)


## Every character walks a small circle, so the hit zones move every tick as they would in the game.
func _move(t: int) -> void:
	var ang := t * 0.02
	for i in chars.size():
		var ph := ang + i * 0.7
		chars[i].global_position = home[i] + Vector3(cos(ph) * 0.4, 0.0, sin(ph) * 0.4)


func _rays() -> Dictionary:
	var space := b.get_world_3d().direct_space_state as PhysicsDirectSpaceState3D
	var q := PhysicsRayQueryParameters3D.new()
	q.collision_mask = 1 | HIT_LAYER
	q.collide_with_areas = true
	q.collide_with_bodies = true
	var shooter: Vector3 = b.origin + GRID + Vector3(4.5 * SPACING, 1.6, 9.0 * SPACING + 25.0)
	var aim_y := [1.63, 1.2, 0.45]
	var times := PackedFloat64Array()
	var hist := [0, 0, 0, 0, 0] # head, torso, limbs, world, miss
	for batch in 20:
		var to := PackedVector3Array()
		for i in 1000:
			var c := rng.randi_range(0, CHARACTERS - 1)
			var target := chars[c].global_position + Vector3(rng.randfn(0.0, 0.12), float(aim_y[rng.randi_range(0, 2)]) + rng.randfn(0.0, 0.12), 0.0)
			to.append(shooter + (target - shooter) * 1.6)
		var t0 := Time.get_ticks_usec()
		for i in 1000:
			q.from = shooter
			q.to = to[i]
			var hit := space.intersect_ray(q)
			if hit.is_empty():
				hist[4] += 1
			elif hit.collider is Area3D:
				hist[ZONE_OF_SHAPE[int(hit.shape)]] += 1
			else:
				hist[3] += 1
		times.append(Time.get_ticks_usec() - t0)
	# aim check: a ray at the centre of each zone of the ten nearest characters must report that zone
	var wrong := 0
	var checked := 0
	for i in range(90, 100):
		for z in 3:
			var off := Vector3(0, aim_y[z], 0)
			if z == 2:
				off = Vector3(0.1, 0.45, 0)
			q.from = shooter
			q.to = shooter + (chars[i].global_position + off - shooter) * 1.2
			var hit := space.intersect_ray(q)
			checked += 1
			if hit.is_empty() or not (hit.collider is Area3D) or ZONE_OF_SHAPE[int(hit.shape)] != z:
				wrong += 1
	var st := Util.stats(times, 0.001)
	return {"msPer1000": st, "msPerFrameAt1000PerSecond": Util.r(float(st.p50) / 60.0, 4), "usPerRay": Util.r(float(st.p50), 3), "batches": 20,
		"hits": {"head": hist[0], "torso": hist[1], "limbs": hist[2], "world": hist[3], "miss": hist[4]},
		"aimCheck": {"rays": checked, "wrongZone": wrong}, "rangeM": "25 to 50"}


func _ragdolls() -> Dictionary:
	var base: Dictionary = await _step_window(300)
	var dolls: Array[Ragdoll] = []
	var stairs_z := -(Course.FOOT_STAIRS_S + Course.TREAD * 5.0)
	var stairs_y := Course.KERB + Course.RISER * 5.0
	for i in RAGDOLLS:
		var d := Ragdoll.new()
		var sk := d.build(Color.from_hsv(0.55 + 0.04 * i, 0.5, 0.9))
		var on_stairs := i < 5
		var x := Course.FOOT_X0 + 4.0 + 2.2 * i
		var pos := Vector3(x, stairs_y + 0.35, stairs_z) if on_stairs else Vector3(x, Course.KERB + 0.3, -(Course.FOOT_KERB_S + 0.25))
		sk.transform = Transform3D(Basis(Vector3.UP, rng.randf_range(0.0, TAU)), b.origin + pos)
		b.world.add_child(sk)
		dolls.append(d)
	await b.get_tree().physics_frame
	for i in RAGDOLLS:
		# pushed down the stairs, or backwards off the kerb
		dolls[i].start(Vector3(rng.randf_range(-0.5, 0.5), 0.0, 3.0))
	b.look_from(Vector3(Course.FOOT_X0 + 15.0, 3.2, -15.5), Vector3(Course.FOOT_X0 + 14.0, 0.6, -28.0))
	var max_speed := 0.0
	var max_stretch := 0.0
	var min_y := 1e9
	var nan := 0
	var settle := -1
	var quiet := 0
	var fall := PackedFloat64Array()
	var rest := PackedFloat64Array()
	clock.timing_begin()
	var n := 600
	for t in n:
		await clock.post_tick
		var fastest := 0.0
		for d in dolls:
			for pb in d.bones:
				var p := pb.global_position
				var sp := pb.linear_velocity.length()
				if is_nan(p.x) or is_nan(p.y) or is_nan(p.z) or is_nan(sp):
					nan += 1
					continue
				fastest = maxf(fastest, sp)
				min_y = minf(min_y, p.y - b.origin.y)
			max_stretch = maxf(max_stretch, d.joint_stretch())
		max_speed = maxf(max_speed, fastest)
		if fastest < 0.2:
			quiet += 1
			if quiet == 30 and settle < 0:
				settle = t - 29
		else:
			quiet = 0
		if t == 239:
			fall = clock.step_us.duplicate()
			clock.step_us.clear()
	rest = clock.step_us.duplicate()
	clock.timing_end()
	var asleep := 0
	var total := 0
	for d in dolls:
		for pb in d.bones:
			total += 1
			if bool(PhysicsServer3D.body_get_state(pb.get_rid(), PhysicsServer3D.BODY_STATE_SLEEPING)):
				asleep += 1
	var stable := nan == 0 and max_stretch < 0.1 and max_speed < 25.0 and min_y > -0.3
	var fall_stats := Util.stats(fall, 0.001)
	return {
		"count": RAGDOLLS, "bonesEach": Ragdoll.BONES.size(), "where": "5 pushed down the stairs (0.18 m risers), 5 pushed backwards off the 0.15 m kerb",
		"stepBase": base, "step": fall_stats, "stepAfter4S": Util.stats(rest, 0.001),
		"msPerRagdollWhileFalling": Util.r((float(fall_stats.mean) - float(base.mean)) / RAGDOLLS, 4),
		"maxBoneSpeedMs": Util.r(max_speed, 2), "maxJointGapM": Util.r(max_stretch, 4), "lowestBoneM": Util.r(min_y, 3), "nanValues": nan,
		"settledAfterS": Util.r(settle / 60.0, 2) if settle >= 0 else null, "bonesAsleepAtEnd": "%d of %d" % [asleep, total], "stable": stable,
		"stableMeans": "no NaN, no joint gap over 0.1 m, no bone over 25 m/s, no bone under the ground",
	}


func _step_window(n: int) -> Dictionary:
	clock.timing_begin()
	await b.ticks(n)
	clock.timing_end()
	return Util.stats(clock.step_us, 0.001)
