## The attach queue of the streaming core: main thread work in small steps under a time cap per frame (TECH.md
## "Streaming (ST1, TL1)": at most 1 ms a frame). It knows nothing about what a step does. A job is one system's
## work on one tile, `attach` or `dispose`; the system's function does one step and says when the job is done.
##
## What a system declares (its own budget):
##   lane        the kind of step: "mesh", "collider", "data", ...
##   exclusive   true: a frame that ran an attach step of another exclusive lane runs none of this one. So collider
##               chunks never share a frame with a mesh step.
##   per_frame   most attach steps of this lane in one frame (0: only the time cap). Colliders: 3.
##   budget_ms   what one step may cost; a step over it is counted in `over` (reported, never an error).
## Order: attach jobs by rank (the tile nearest the lead point first), then by the order the systems registered;
## dispose jobs after them, unless `dispose_first` (the core sets it over the memory cap).
## Time cap: a step starts only when the time used so far plus what such a step usually costs (a running average
## with a safety factor) fits the cap. The first step of a frame always runs, so work never stalls.
## Burst (a load screen or a teleport, nothing is playing): the cap is `burst_ms` and per_frame is not applied.
extends RefCounted

var budget_ms := 1.0
var burst_ms := 8.0
## How much of a step's usual cost must still fit (1.5: a step half as slow again as usual still lands in the cap).
var safety := 1.5
var dispose_first := false
## The clock, in microseconds (tests pass their own).
var now_usec: Callable = Time.get_ticks_usec
var jobs: Array[Dictionary] = []
## The last run: ms of work, attach steps per lane, dispose steps, and whether two exclusive lanes shared the frame.
var frame := {"ms": 0.0, "attach": {}, "dispose": 0, "mixed": false, "burst": false}
## Steps over their system's own budget, and the worst step, per "<system>:<op>".
var over := {}
var worst_ms := {}
var steps_total := 0
var _avg := {}
var _dirty := false


func push(sys: Object, tile: Dictionary, part: Variant, op: String, rank: float, order: int) -> void:
	jobs.append({"sys": sys, "tile": tile, "part": part, "op": op, "rank": rank, "order": order, "key": tile.key})
	_dirty = true


## Takes the jobs of a tile out of the queue (`op` "" for both kinds). Returns how many.
func drop(key: Vector2i, op := "") -> int:
	var n := 0
	for i in range(jobs.size() - 1, -1, -1):
		if jobs[i].key == key and (op == "" or jobs[i].op == op):
			jobs.remove_at(i)
			n += 1
	return n


## New ranks after the focus moved: Callable(Vector2i) -> float.
func rerank(rank_of: Callable) -> void:
	for j in jobs:
		j.rank = rank_of.call(j.key)
	_dirty = true


func pending(op := "") -> int:
	if op == "":
		return jobs.size()
	var n := 0
	for j in jobs:
		if j.op == op:
			n += 1
	return n


func has_tile(key: Vector2i, op: String) -> bool:
	for j in jobs:
		if j.key == key and j.op == op:
			return true
	return false


func _sort() -> void:
	var first := "dispose" if dispose_first else "attach"
	jobs.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		if a.op != b.op:
			return a.op == first
		if a.rank != b.rank:
			return a.rank < b.rank
		if a.key != b.key:
			return a.key.x < b.key.x or (a.key.x == b.key.x and a.key.y < b.key.y)
		return a.order < b.order)
	_dirty = false


## Runs steps until the time cap. Returns the jobs that finished: [{sys, tile, part, op, key}].
func run(burst := false) -> Array[Dictionary]:
	var done: Array[Dictionary] = []
	var attach := {}
	frame = {"ms": 0.0, "attach": attach, "dispose": 0, "mixed": false, "burst": burst}
	if jobs.is_empty():
		return done
	if _dirty:
		_sort()
	var cap := burst_ms if burst else budget_ms
	var t0: int = now_usec.call()
	var ran := 0
	var lane_of_frame := ""
	var exclusive_lanes := {}
	var i := 0
	var stop := false
	while i < jobs.size() and not stop:
		var job: Dictionary = jobs[i]
		var sys: Object = job.sys
		var is_attach: bool = job.op == "attach"
		var lane: String = sys.lane
		if is_attach and sys.exclusive and lane_of_frame != "" and lane_of_frame != lane:
			i += 1
			continue
		var name := "%s:%s" % [sys.id, job.op]
		var finished := false
		while true:
			if is_attach and not burst and sys.per_frame > 0 and int(attach.get(lane, 0)) >= sys.per_frame:
				break
			var used := float(now_usec.call() - t0) / 1000.0
			if ran > 0 and used + float(_avg.get(name, 0.2)) * safety > cap:
				stop = true
				break
			var s0: int = now_usec.call()
			finished = sys.attach(job.tile, job.part) if is_attach else sys.dispose(job.tile, job.part)
			var cost := float(now_usec.call() - s0) / 1000.0
			_avg[name] = cost if not _avg.has(name) else lerpf(float(_avg[name]), cost, 0.2)
			worst_ms[name] = maxf(float(worst_ms.get(name, 0.0)), cost)
			if cost > sys.budget_ms:
				over[name] = int(over.get(name, 0)) + 1
			ran += 1
			if is_attach:
				attach[lane] = int(attach.get(lane, 0)) + 1
				if sys.exclusive:
					lane_of_frame = lane
					exclusive_lanes[lane] = true
			else:
				frame.dispose = int(frame.dispose) + 1
			if finished:
				break
		if finished:
			done.append(job)
			jobs.remove_at(i)
		else:
			i += 1
	steps_total += ran
	frame.mixed = exclusive_lanes.size() > 1
	frame.ms = float(now_usec.call() - t0) / 1000.0
	return done
