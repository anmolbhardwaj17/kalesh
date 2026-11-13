## The longer feel probes of the vehicle hook (P1-021, split from vehicle_probe.gd): the course gali's right angle
## corner and a two wheeler's stability run. Each takes the probe node for its input and staging helpers (the InputMap
## actions, the way a player's keys do; sim ticks).
extends RefCounted

const CourseScene := preload("res://scenes/course/course_scene.gd")


## The course gali (course_scene.gd): staged in the north lane near its west wall, the vehicle creeps north at opts.kmh
## (8), turns full right lock when its centre passes opts.turnZ (the corner less opts.turnAhead, 1.6 m; the auto clears
## the walls from 1.4 to 1.8), keeps the lock until it heads east (opts.releaseDeg, 75), then follows the east lane's
## centre line to its end. Every tick the collision box (a 0.02 m skin) is tested against the walls (contact ticks)
## and the gap between the box footprint and the walls is measured (minClearanceM).
static func gali(probe: Node, v: Node, o: Dictionary) -> Dictionary:
	var gx := CourseScene.GALI_X
	var gw := CourseScene.GALI_W
	var cz := CourseScene.GALI_CORNER_Z
	var line_x := gx + float(o.get("lineOffset", v.tune.box_half.x + 0.4))
	var target := float(o.get("kmh", 8.0))
	var turn_z := float(o.get("turnZ", cz + float(o.get("turnAhead", 1.6))))
	var release := deg_to_rad(float(o.get("releaseDeg", 75.0)))
	await probe._stage(v, line_x, CourseScene.GALI_Z0 - 6.0)
	var n := v as Node3D
	var walls := CourseScene.gali_walls()
	var gali := probe.get_tree().current_scene.get_node_or_null("World/Gali")
	var q := PhysicsShapeQueryParameters3D.new()
	var shape := BoxShape3D.new()
	shape.size = v.tune.box_half * 2.0 + Vector3.ONE * 0.04
	q.shape = shape
	q.collision_mask = 1
	q.exclude = [v.get_rid()]
	var phase := 0
	var t := 0
	var touch := 0
	var first_touch := []
	var min_clear := 1e9
	var min_at := []
	var trace := []
	var end_x := CourseScene.GALI_X1 - 6.0
	var done := false
	var max_roll := 0.0
	while t < 60 * 60:
		var p := n.global_position
		var c: Vector2 = probe._hold(v, target)
		var st := 0.0
		if phase == 0:
			st = probe._steer_to(v, Vector3(line_x, 0.0, p.z - 6.0), 1.0)
			if p.z <= turn_z:
				phase = 1
		if phase == 1:
			st = 1.0
			if v.heading >= release:
				phase = 2
		if phase == 2:
			st = probe._steer_to(v, Vector3(p.x + 5.0, 0.0, cz - gw * 0.5), 1.5)
		probe._drive(c.x, c.y, st)
		await probe._tick()
		t += 1
		p = n.global_position
		var xf := n.global_transform
		q.transform = Transform3D(xf.basis, xf * Vector3(0, v.tune.box_y, 0))
		for hit in n.get_world_3d().direct_space_state.intersect_shape(q, 8):
			if hit.collider == gali:
				touch += 1
				if first_touch.is_empty():
					first_touch = [snappedf(p.x, 0.01), snappedf(p.z, 0.01), snappedf(rad_to_deg(v.heading), 0.1)]
				break
		var cl := clearance(xf, v.tune.box_half, walls)
		if cl < min_clear:
			min_clear = cl
			min_at = [snappedf(p.x, 0.01), snappedf(p.z, 0.01), snappedf(rad_to_deg(v.heading), 0.1), phase]
		max_roll = maxf(max_roll, absf(probe._roll_deg(n)))
		if t % 20 == 0 and trace.size() < 60:
			trace.append([snappedf(p.x, 0.01), snappedf(p.z, 0.01), snappedf(rad_to_deg(v.heading), 0.1), snappedf(v.kmh(), 0.1), phase])
		if p.x >= end_x:
			done = true
			break
	probe._drive(0.0, 0.0, 0.0)
	return {"finished": done, "contactTicks": touch, "firstContact": first_touch, "minClearanceM": snappedf(min_clear, 0.001),
		"minClearanceAt": min_at, "ticks": t, "simS": snappedf(t / 60.0, 0.01), "lineX": line_x, "turnZ": turn_z,
		"targetKmh": target, "maxRollDeg": snappedf(max_roll, 0.01), "laneWidthM": gw, "trace": trace}


## Smallest gap (m) on the ground plane between the vehicle's collision box footprint and the walls ([lo, hi] boxes):
## each box corner to each wall rectangle, and each wall corner to the footprint (two convex shapes: exact while apart;
## 0 when they overlap).
static func clearance(xf: Transform3D, half: Vector3, walls: Array) -> float:
	var o := Vector2(xf.origin.x, xf.origin.z)
	var ax := Vector2(xf.basis.x.x, xf.basis.x.z).normalized()
	var az := Vector2(xf.basis.z.x, xf.basis.z.z).normalized()
	var corners: Array[Vector2] = []
	for sx in [-1.0, 1.0]:
		for sz in [-1.0, 1.0]:
			corners.append(o + ax * half.x * sx + az * half.z * sz)
	var best := 1e9
	for w in walls:
		var lo: Vector3 = w[0]
		var hi: Vector3 = w[1]
		for c in corners:
			var dx := maxf(0.0, maxf(lo.x - c.x, c.x - hi.x))
			var dz := maxf(0.0, maxf(lo.z - c.y, c.y - hi.z))
			best = minf(best, sqrt(dx * dx + dz * dz))
		for wc in [Vector2(lo.x, lo.z), Vector2(hi.x, lo.z), Vector2(lo.x, hi.z), Vector2(hi.x, hi.z)]:
			var d: Vector2 = wc - o
			var lx := maxf(0.0, absf(d.dot(ax)) - half.x)
			var lz := maxf(0.0, absf(d.dot(az)) - half.z)
			best = minf(best, sqrt(lx * lx + lz * lz))
	return best


## A two wheeler's stability: full throttle for opts.straightS (30) of sim on the straight keeping the lane, then down to
## opts.kmh (40) and a slalom (a sine path of opts.amp m (2) and opts.wave m (24)) for opts.slalomS (12). Answers the
## largest roll of the physics body, the largest visual lean, wheels down and whether it fell (roll over 30 degrees,
## the body's up axis under 0.85, or no wheel down for 10 ticks in a row).
static func stable(probe: Node, v: Node, o: Dictionary) -> Dictionary:
	var straight_s := float(o.get("straightS", 30.0))
	var target := float(o.get("kmh", 40.0))
	var amp := float(o.get("amp", 2.0))
	var wave := float(o.get("wave", 24.0))
	var slalom_s := float(o.get("slalomS", 12.0))
	await probe._stage(v, 0.0, 100.0)
	var n := v as Node3D
	var out := {"straight": {}, "slalom": {}}
	var air := 0
	var fell := false
	for part in ["straight", "slalom"]:
		var max_roll := 0.0
		var max_lean := 0.0
		var min_up := 1.0
		var min_contacts: int = v.wheel_count()
		var max_x := 0.0
		var top := 0.0
		var ticks := int((straight_s if part == "straight" else slalom_s) * 60.0)
		var z_s := n.global_position.z
		if part == "slalom":
			# down to the slalom speed first, keeping the lane
			var guard := 0
			while v.kmh() > target + 1.0 and guard < 600:
				var c0: Vector2 = probe._hold(v, target)
				var p0 := n.global_position
				probe._drive(c0.x, c0.y, probe._steer_to(v, Vector3(0.0, 0.0, p0.z - 12.0), 1.0))
				await probe._tick()
				guard += 1
			z_s = n.global_position.z
		var entry: float = v.kmh()
		for i in ticks:
			var p := n.global_position
			var th := 1.0
			var br := 0.0
			var aim := Vector3(0.0, 0.0, p.z - 12.0)
			if part == "slalom":
				var c: Vector2 = probe._hold(v, target)
				th = c.x
				br = c.y
				var az := p.z - 5.0
				aim = Vector3(amp * sin(TAU * (z_s - az) / wave), 0.0, az)
			probe._drive(th, br, probe._steer_to(v, aim, 1.0 if part == "straight" else 2.0))
			await probe._tick()
			max_roll = maxf(max_roll, absf(v.roll_deg()))
			max_lean = maxf(max_lean, absf(rad_to_deg(v.lean)))
			min_up = minf(min_up, n.global_transform.basis.y.y)
			var cc: int = v.contact_count()
			min_contacts = mini(min_contacts, cc)
			air = air + 1 if cc == 0 else 0
			if air >= 10 or max_roll > 30.0 or min_up < 0.85:
				fell = true
			max_x = maxf(max_x, absf(n.global_position.x))
			top = maxf(top, v.kmh())
		out[part] = {"entryKmh": snappedf(entry, 0.1), "topKmh": snappedf(top, 0.1), "maxRollDeg": snappedf(max_roll, 0.01),
			"maxLeanDeg": snappedf(max_lean, 0.1), "minUpY": snappedf(min_up, 0.0001), "minWheelsInContact": min_contacts,
			"maxLateralM": snappedf(max_x, 0.01), "simS": snappedf(ticks / 60.0, 0.01)}
	probe._drive(0.0, 0.0, 0.0)
	out["fell"] = fell
	return out
