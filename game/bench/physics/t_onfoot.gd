## On-foot test of the physics bench (P0-017), option F1: the walker (walker.gd) over the on-foot course at the
## GAME.md speeds (walk 1.6, jog 3.8, sprint 6.5 m/s). Per speed three batches of 20 runs side by side: north
## (kerb up, stairs up, landing, ramp down, kerb down), north at a 15 degree slant, and south (kerb up, ramp up,
## stairs down, kerb down). Runs start a few centimetres apart so steps are met at every phase.
## A run passes when its mean ground speed is within 5 percent of the target and it never snags: no 0.2 s window
## slower than 80 percent of the target.
extends RefCounted

const Util := preload("res://bench/physics/util.gd")
const Walker := preload("res://bench/physics/walker.gd")
const Course := preload("res://bench/physics/course.gd")

const RUNS := 20
const SPEEDS := [["walk", 1.6], ["jog", 3.8], ["sprint", 6.5]]
const WINDOW := 12

var b: Node
var clock: Node
var o := Vector3.ZERO


func run(bench: Node, opts: Dictionary) -> Dictionary:
	b = bench
	clock = b.clock
	o = b.origin
	clock.set_scale(float(opts.get("scale", 4.0)))
	var out := {"capsule": {"radiusM": Walker.RADIUS, "heightM": Walker.HEIGHT, "stepMaxM": Walker.STEP_MAX},
		"course": {"kerbM": Course.KERB, "riserM": Course.RISER, "treadM": Course.TREAD, "steps": Course.STEPS, "rampSlope": "1 in 6"}}
	var speeds: Array = []
	var all_pass := true
	var cpu_us := 0
	var cpu_ticks := 0
	for s in SPEEDS:
		var target: float = s[1]
		var batches: Array = []
		for batch in ["north", "slant", "south"]:
			var r: Dictionary = await _batch(batch, target)
			cpu_us += int(r.cpuUs)
			cpu_ticks += int(r.cpuTicks)
			r.erase("cpuUs")
			r.erase("cpuTicks")
			batches.append(r)
		var runs := 0
		var snags := 0
		var unfinished := 0
		var mean := 0.0
		var lo := 1e9
		var hi := 0.0
		var worst_window := 1e9
		for r in batches:
			runs += int(r.runs)
			snags += int(r.snags)
			unfinished += int(r.unfinished)
			mean += float(r.meanSpeed) * int(r.runs)
			lo = minf(lo, r.minRunSpeed)
			hi = maxf(hi, r.maxRunSpeed)
			worst_window = minf(worst_window, r.slowestWindowSpeed)
		mean /= maxf(1.0, runs)
		var worst_err := maxf(absf(lo - target), absf(hi - target)) / target * 100.0
		var ok := snags == 0 and unfinished == 0 and worst_err <= 5.0
		all_pass = all_pass and ok
		speeds.append({"name": s[0], "targetSpeed": target, "runs": runs, "meanSpeed": Util.r(mean, 3), "minRunSpeed": Util.r(lo, 3), "maxRunSpeed": Util.r(hi, 3),
			"worstErrorPct": Util.r(worst_err, 2), "slowestWindowSpeed": Util.r(worst_window, 3), "snags": snags, "unfinished": unfinished, "pass": ok, "batches": batches})
	out["speeds"] = speeds
	out["passes"] = all_pass
	out["cpuUsPerCharacterTick"] = Util.r(float(cpu_us) / maxf(1.0, cpu_ticks), 2)
	out["flatJitter"] = await _flat()
	# leave a group on the stairs for the shot
	var show: Array[Walker] = _spawn("north", 3.8)
	await b.ticks(150)
	for w in show:
		w.speed = 0.0
	await b.ticks(2)
	b.look_from(Vector3(Course.FOOT_X1 + 9.0, 4.2, -22.0), Vector3(Course.FOOT_X0 + 12.0, 1.0, -33.0))
	clock.set_scale(1.0)
	return out


func _spawn(batch: String, target: float) -> Array[Walker]:
	var list: Array[Walker] = []
	var end_s := Course.foot_end_s()
	for i in RUNS:
		var w := Walker.new()
		w.setup(Color.from_hsv(0.08 + 0.03 * i, 0.7, 0.9))
		b.world.add_child(w)
		var x := Course.FOOT_X0 + 1.0 + 1.0 * i
		var jitter := 0.037 * i
		if batch == "south":
			w.global_position = o + Vector3(x + 5.0, 0.0, -(end_s + 4.0 + jitter))
			w.dir = Vector3(0, 0, 1)
		else:
			w.global_position = o + Vector3(x, 0.0, -(Course.FOOT_KERB_S - 4.0 - jitter))
			w.dir = Vector3(0, 0, -1) if batch == "north" else Vector3(sin(deg_to_rad(15.0)), 0, -cos(deg_to_rad(15.0)))
		w.speed = target
		clock.sim_tick.connect(w.sim_step)
		list.append(w)
	return list


func _free(list: Array[Walker]) -> void:
	for w in list:
		clock.sim_tick.disconnect(w.sim_step)
		w.queue_free()
	await b.get_tree().physics_frame


## 20 walkers side by side over the course; each is timed between the line 2 m before the first kerb and the line
## 2 m after the last one.
func _batch(batch: String, target: float) -> Dictionary:
	var list := _spawn(batch, target)
	var s_in := Course.FOOT_KERB_S - 2.0
	var s_out := Course.foot_end_s() + 2.0
	if batch == "south":
		var swap := s_in
		s_in = s_out
		s_out = swap
	var n := list.size()
	var state := PackedByteArray()
	state.resize(n)
	var dist := PackedFloat64Array()
	dist.resize(n)
	var ticks := PackedInt32Array()
	ticks.resize(n)
	var slowest := PackedFloat64Array()
	slowest.resize(n)
	slowest.fill(1e9)
	var slowest_s := PackedFloat64Array()
	slowest_s.resize(n)
	var max_y := PackedFloat64Array()
	max_y.resize(n)
	var prev := PackedVector3Array()
	prev.resize(n)
	var hist: Array[PackedFloat64Array] = []
	for i in n:
		prev[i] = list[i].global_position
		hist.append(PackedFloat64Array())
	var done := 0
	var t := 0
	var cap := int(60.0 * 3.0 * (absf(s_out - s_in) + 8.0) / target)
	while done < n and t < cap:
		await clock.post_tick
		t += 1
		for i in n:
			if state[i] == 2:
				continue
			var p := list[i].global_position
			var s := -(p.z - o.z)
			var step := Vector2(p.x - prev[i].x, p.z - prev[i].z).length()
			prev[i] = p
			if state[i] == 0:
				if (s >= s_in) if batch != "south" else (s <= s_in):
					state[i] = 1
				continue
			dist[i] += step
			ticks[i] += 1
			max_y[i] = maxf(max_y[i], p.y - o.y)
			var h := hist[i]
			h.append(step)
			if h.size() >= WINDOW:
				var sum := 0.0
				for k in range(h.size() - WINDOW, h.size()):
					sum += h[k]
				var win := sum / (WINDOW / 60.0)
				if win < slowest[i]:
					slowest[i] = win
					slowest_s[i] = s
			if (s >= s_out) if batch != "south" else (s <= s_out):
				state[i] = 2
				done += 1
	var mean := 0.0
	var lo := 1e9
	var hi := 0.0
	var snags := 0
	var worst_window := 1e9
	var steps := 0
	var cpu_us := 0
	var cpu_ticks := 0
	var top := 0.0
	var worst_s := 0.0
	for i in n:
		var sp := dist[i] / maxf(1.0, ticks[i]) * 60.0
		mean += sp / n
		lo = minf(lo, sp)
		hi = maxf(hi, sp)
		if slowest[i] < worst_window:
			worst_window = slowest[i]
			worst_s = slowest_s[i]
		if slowest[i] < 0.8 * target:
			snags += 1
		steps += list[i].steps_taken
		cpu_us += list[i].cpu_us
		cpu_ticks += list[i].cpu_ticks
		top = maxf(top, max_y[i])
	await _free(list)
	return {"batch": batch, "runs": n, "unfinished": n - done, "meanSpeed": Util.r(mean, 3), "minRunSpeed": Util.r(lo, 3), "maxRunSpeed": Util.r(hi, 3),
		"slowestWindowSpeed": Util.r(worst_window, 3), "slowestWindowAtS": Util.r(worst_s, 2), "snags": snags, "stepUpsPerRun": Util.r(float(steps) / n, 1), "topHeightM": Util.r(top, 3),
		"simS": Util.r(t / 60.0, 1), "cpuUs": cpu_us, "cpuTicks": cpu_ticks}


## One walker on flat ground: height noise while walking and position noise while standing (for FP1).
func _flat() -> Dictionary:
	var w := Walker.new()
	w.setup()
	b.world.add_child(w)
	w.global_position = o + Vector3(Course.FOOT_X0 - 20.0, 0.0, -10.0)
	w.dir = Vector3(0, 0, -1)
	w.speed = 1.6
	clock.sim_tick.connect(w.sim_step)
	await b.ticks(60)
	var ys := PackedFloat64Array()
	var xs := PackedFloat64Array()
	var steps := PackedFloat64Array()
	var prev := w.global_position
	for i in 240:
		await clock.post_tick
		var p := w.global_position
		ys.append((p.y - o.y) * 1000.0)
		xs.append((p.x - o.x) * 1000.0)
		steps.append((p - prev).length() * 1000.0)
		prev = p
	w.speed = 0.0
	await b.ticks(30)
	var sx := PackedFloat64Array()
	var sy := PackedFloat64Array()
	var sz := PackedFloat64Array()
	for i in 120:
		await clock.post_tick
		var p := w.global_position - o
		sx.append(p.x * 1000.0)
		sy.append(p.y * 1000.0)
		sz.append(p.z * 1000.0)
	clock.sim_tick.disconnect(w.sim_step)
	w.queue_free()
	var stand := maxf(Util.spread(sx).p2p, maxf(Util.spread(sy).p2p, Util.spread(sz).p2p))
	return {"yP2pMm": Util.spread(ys, 4).p2p, "lateralXP2pMm": Util.spread(xs, 4).p2p, "stepPerTickMm": Util.spread(steps, 4),
		"standingP2pMm": Util.r(stand, 4), "note": "walking 1.6 m/s on flat ground for 4 s, then standing for 2 s; a step per tick should be 26.667 mm"}
