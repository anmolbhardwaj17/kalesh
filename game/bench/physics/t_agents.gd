## Scripting test of the physics bench (P0-017), option LANG1 of ARCH_OPTIONS.md: one GDScript tick for 200
## pedestrians and 30 traffic agents, written data first: every field is a packed array, neighbours come from a
## cell list in packed arrays, each agent casts one ray, and the result goes to the renderer as one MultiMesh buffer
## per group. Timed all at once (every agent steers every tick) and in turns (a quarter of the agents steer per
## tick; everyone still moves every tick).
##   pedestrians  walk a loop of waypoints around a block of stalls, keep apart, and slide along what the ray hits
##   traffic      follow a lane loop with a car-following rule (gap, speed difference), brake for what the ray hits
extends RefCounted

const Util := preload("res://bench/physics/util.gd")
const PathDriver := preload("res://bench/physics/path_driver.gd")

const PEDS := 200
const CARS := 30
const AREA := Vector3(-110.0, 0.0, -420.0)
const HALF := 48.0
const CELL := 2.0
const GRID_N := 48
const OBSTACLE_LAYER := 64
const TICKS := 900

var b: Node
var clock: Node
var rng := RandomNumberGenerator.new()
var space: PhysicsDirectSpaceState3D
var query := PhysicsRayQueryParameters3D.new()
var rays := 0
var ray_hits := 0
# pedestrians
var px := PackedFloat32Array()
var pz := PackedFloat32Array()
var vx := PackedFloat32Array()
var vz := PackedFloat32Array()
var pref := PackedFloat32Array()
var wp := PackedInt32Array()
var waypoints := PackedVector2Array()
var cell_head := PackedInt32Array()
var cell_next := PackedInt32Array()
var ped_buf := PackedFloat32Array()
var ped_mm: MultiMesh
# traffic
var lane := PackedVector3Array()
var cs := PackedFloat32Array()
var cv := PackedFloat32Array()
var ca := PackedFloat32Array()
var car_buf := PackedFloat32Array()
var car_mm: MultiMesh
var base := Vector3.ZERO


func run(bench: Node, _opts: Dictionary) -> Dictionary:
	b = bench
	clock = b.clock
	rng.seed = 31
	clock.set_scale(4.0)
	base = b.origin + AREA
	space = b.get_world_3d().direct_space_state
	query.collision_mask = 1 | OBSTACLE_LAYER
	_world()
	_init_agents()
	b.look_from(AREA + Vector3(0, 52, 64), AREA + Vector3(0, 0, 4))
	await b.ticks(60)
	var all: Dictionary = await _timed(1)
	var quarter: Dictionary = await _timed(4)
	clock.set_scale(1.0)
	return {
		"agents": {"pedestrians": PEDS, "traffic": CARS, "raysPerAgentDecision": 1},
		"all": all, "quarter": quarter,
		"perAgentUs": {"all": Util.r(float(all.ms.mean) * 1000.0 / (PEDS + CARS), 2), "quarter": Util.r(float(quarter.ms.mean) * 1000.0 / (PEDS + CARS), 2)},
		"note": "ms per sim tick of the whole agent update in GDScript: cell list, steering with one ray per deciding agent, movement of every agent, and two MultiMesh buffer writes. In turns, a quarter of the agents decide per tick",
	}


func _timed(groups: int) -> Dictionary:
	var us := PackedFloat64Array()
	rays = 0
	ray_hits = 0
	clock.timing_begin()
	for t in TICKS:
		var t0 := Time.get_ticks_usec()
		_tick(1.0 / 60.0, t % groups, groups)
		us.append(Time.get_ticks_usec() - t0)
		await clock.post_tick
	clock.timing_end()
	var mean_speed := 0.0
	for i in PEDS:
		mean_speed += Vector2(vx[i], vz[i]).length() / PEDS
	var car_speed := 0.0
	for i in CARS:
		car_speed += cv[i] / CARS
	return {"groups": groups, "ticks": TICKS, "ms": Util.stats(us, 0.001), "raysPerTick": Util.r(float(rays) / TICKS, 1), "rayHitShare": Util.r(float(ray_hits) / maxf(1.0, rays), 3),
		"pedestrianMeanSpeed": Util.r(mean_speed, 2), "trafficMeanKmh": Util.r(car_speed * 3.6, 1), "physicsStepMs": Util.stats(clock.step_us, 0.001)}


func _world() -> void:
	var root := Node3D.new()
	root.name = "AgentArea"
	root.position = AREA
	b.world.add_child(root)
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.6, 0.45, 0.3)
	# a block of stalls in the middle, and a few posts on the footpath loop
	for i in 60:
		var sb := StaticBody3D.new()
		sb.collision_layer = OBSTACLE_LAYER
		sb.collision_mask = 0
		var size := Vector3(rng.randf_range(1.0, 3.0), rng.randf_range(1.5, 3.0), rng.randf_range(1.0, 3.0))
		var pos := Vector3(rng.randf_range(-16.0, 16.0), size.y * 0.5, rng.randf_range(-16.0, 16.0))
		if i >= 44:
			var a := rng.randf_range(0.0, TAU)
			pos = Vector3(cos(a) * 24.0, 0.75, sin(a) * 24.0)
			size = Vector3(0.4, 1.5, 0.4)
		var shape := BoxShape3D.new()
		shape.size = size
		var col := CollisionShape3D.new()
		col.shape = shape
		sb.add_child(col)
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = size
		bm.material = mat
		mi.mesh = bm
		sb.add_child(mi)
		sb.position = pos
		root.add_child(sb)
	ped_mm = _multimesh(root, PEDS, Vector3(0.45, 1.7, 0.3), Color(0.95, 0.8, 0.3))
	car_mm = _multimesh(root, CARS, Vector3(1.8, 1.4, 4.2), Color(0.3, 0.6, 0.9))
	ped_buf.resize(PEDS * 12)
	car_buf.resize(CARS * 12)


func _multimesh(root: Node3D, count: int, size: Vector3, color: Color) -> MultiMesh:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	var bm := BoxMesh.new()
	bm.size = size
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	bm.material = mat
	mm.mesh = bm
	mm.instance_count = count
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	mi.position = Vector3(0, size.y * 0.5, 0)
	mi.custom_aabb = AABB(Vector3(-HALF, -2, -HALF), Vector3(HALF * 2.0, 6, HALF * 2.0))
	root.add_child(mi)
	return mm


func _init_agents() -> void:
	# waypoints: a ring around the stalls (area coordinates)
	for k in 16:
		var a := TAU * k / 16.0
		waypoints.append(Vector2(cos(a) * 24.0, sin(a) * 24.0))
	px.resize(PEDS)
	pz.resize(PEDS)
	vx.resize(PEDS)
	vz.resize(PEDS)
	pref.resize(PEDS)
	wp.resize(PEDS)
	cell_next.resize(PEDS)
	cell_head.resize(GRID_N * GRID_N)
	for i in PEDS:
		var a := rng.randf_range(0.0, TAU)
		var r := rng.randf_range(19.0, 29.0)
		px[i] = cos(a) * r
		pz[i] = sin(a) * r
		pref[i] = rng.randf_range(1.2, 1.9)
		# half walk the ring one way, half the other
		var k := int(a / TAU * 16.0)
		wp[i] = (k + 1) % 16 if i % 2 == 0 else -((k + 15) % 16) - 1
	# traffic: an oval lane around everything
	lane = PathDriver.oval(Vector3.ZERO, 110.0, 38.0, 1.0)
	cs.resize(CARS)
	cv.resize(CARS)
	ca.resize(CARS)
	for i in CARS:
		cs[i] = float(lane.size()) * i / CARS + rng.randf_range(-1.5, 1.5)
		cv[i] = rng.randf_range(5.0, 9.0)


func _tick(dt: float, phase: int, groups: int) -> void:
	# ---- pedestrians: cell list
	cell_head.fill(-1)
	for i in PEDS:
		var c := clampi(int((px[i] + HALF) / CELL), 0, GRID_N - 1) + clampi(int((pz[i] + HALF) / CELL), 0, GRID_N - 1) * GRID_N
		cell_next[i] = cell_head[c]
		cell_head[c] = i
	# ---- pedestrians: steering for this tick's group
	var i := phase
	while i < PEDS:
		var x := px[i]
		var z := pz[i]
		var w := wp[i]
		var forward := w >= 0
		var wi := w if forward else -w - 1
		var target := waypoints[wi]
		var dx := target.x - x
		var dz := target.y - z
		var dist := sqrt(dx * dx + dz * dz)
		if dist < 2.5:
			wi = (wi + 1) % 16 if forward else (wi + 15) % 16
			wp[i] = wi if forward else -wi - 1
		var inv := 1.0 / maxf(dist, 0.001)
		dx *= inv
		dz *= inv
		# keep apart from neighbours in the 3 by 3 cells around
		var cx := clampi(int((x + HALF) / CELL), 0, GRID_N - 1)
		var cz := clampi(int((z + HALF) / CELL), 0, GRID_N - 1)
		var sx := 0.0
		var sz := 0.0
		for gz in range(maxi(0, cz - 1), mini(GRID_N, cz + 2)):
			for gx in range(maxi(0, cx - 1), mini(GRID_N, cx + 2)):
				var j := cell_head[gx + gz * GRID_N]
				while j >= 0:
					if j != i:
						var ox := x - px[j]
						var oz := z - pz[j]
						var d2 := ox * ox + oz * oz
						if d2 < 1.44 and d2 > 0.0001:
							var push := (1.2 - sqrt(d2)) / sqrt(d2)
							sx += ox * push
							sz += oz * push
					j = cell_next[j]
		dx += sx * 1.5
		dz += sz * 1.5
		# one ray ahead: slide along what it hits
		var mag := sqrt(dx * dx + dz * dz)
		if mag > 0.001:
			dx /= mag
			dz /= mag
			query.from = base + Vector3(x, 0.9, z)
			query.to = query.from + Vector3(dx, 0.0, dz) * 2.2
			var hit := space.intersect_ray(query)
			rays += 1
			if not hit.is_empty():
				ray_hits += 1
				var n: Vector3 = hit.normal
				var into := dx * n.x + dz * n.z
				if into < 0.0:
					dx -= n.x * into * 1.4
					dz -= n.z * into * 1.4
		var sp := pref[i]
		vx[i] += (dx * sp - vx[i]) * 0.25
		vz[i] += (dz * sp - vz[i]) * 0.25
		i += groups
	# ---- pedestrians: everyone moves, and the instance buffer is filled
	var k := 0
	for p in PEDS:
		var nx := px[p] + vx[p] * dt
		var nz := pz[p] + vz[p] * dt
		px[p] = nx
		pz[p] = nz
		var sp2 := sqrt(vx[p] * vx[p] + vz[p] * vz[p])
		var fx := vx[p] / sp2 if sp2 > 0.01 else 0.0
		var fz := vz[p] / sp2 if sp2 > 0.01 else 1.0
		# rows of a 3 by 4 transform: the box's Z axis along the walk direction
		ped_buf[k] = fz
		ped_buf[k + 1] = 0.0
		ped_buf[k + 2] = fx
		ped_buf[k + 3] = nx
		ped_buf[k + 4] = 0.0
		ped_buf[k + 5] = 1.0
		ped_buf[k + 6] = 0.0
		ped_buf[k + 7] = 0.0
		ped_buf[k + 8] = -fx
		ped_buf[k + 9] = 0.0
		ped_buf[k + 10] = fz
		ped_buf[k + 11] = nz
		k += 12
	ped_mm.buffer = ped_buf
	# ---- traffic: car following on the lane loop, one ray ahead
	var n_lane := lane.size()
	var loop := float(n_lane)
	var c := phase
	while c < CARS:
		var s := cs[c]
		var v := cv[c]
		var lead := (c + 1) % CARS
		var gap := fposmod(cs[lead] - s, loop) - 4.6
		var dv := v - cv[lead]
		var want := 2.0 + v * 1.2 + v * dv / 3.5
		var acc := 1.6 * (1.0 - pow(v / 11.0, 4.0) - pow(maxf(want, 0.5) / maxf(gap, 0.5), 2.0))
		var idx := int(s) % n_lane
		var here := lane[idx]
		var ahead := lane[(idx + 3) % n_lane]
		var dir := (ahead - here).normalized()
		query.from = base + here + Vector3(0, 0.6, 0) + dir * 2.3
		query.to = query.from + dir * maxf(6.0, v * 2.0)
		var hit := space.intersect_ray(query)
		rays += 1
		if not hit.is_empty():
			ray_hits += 1
			acc = minf(acc, -4.0)
		ca[c] = clampf(acc, -6.0, 2.0)
		c += groups
	k = 0
	for q in CARS:
		var v := maxf(0.0, cv[q] + ca[q] * dt)
		cv[q] = v
		var s := fposmod(cs[q] + v * dt, loop)
		cs[q] = s
		var idx := int(s)
		var here := lane[idx % n_lane]
		var nxt := lane[(idx + 1) % n_lane]
		var f := s - idx
		var pos := here.lerp(nxt, f)
		var d := (nxt - here).normalized()
		car_buf[k] = d.z
		car_buf[k + 1] = 0.0
		car_buf[k + 2] = d.x
		car_buf[k + 3] = pos.x
		car_buf[k + 4] = 0.0
		car_buf[k + 5] = 1.0
		car_buf[k + 6] = 0.0
		car_buf[k + 7] = 0.0
		car_buf[k + 8] = -d.x
		car_buf[k + 9] = 0.0
		car_buf[k + 10] = d.z
		car_buf[k + 11] = pos.z
		k += 12
	car_mm.buffer = car_buf
