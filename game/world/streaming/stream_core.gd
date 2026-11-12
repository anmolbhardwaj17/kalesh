## The streaming core (TECH.md "Streaming (ST1, TL1)"): which tiles are loaded around the focus, and when their work
## runs. It owns the tile states and the schedule and nothing else: it never reads a tile (tile_reader.gd), never
## chooses a ring by itself (ring_plan.gd), never times a step (attach_queue.gd) and knows nothing about what a
## streamed system builds (game/world/systems/). The old game's tile manager owned all of these in 4,065 lines.
##
## A streamed system registers with `register(system)`. It is an object with
##   id, lane, exclusive, per_frame, budget_ms       its name and its own budget (attach_queue.gd)
##   prepare(tile) -> part                           on a WorkerThreadPool thread: turns the tile's arrays into its
##                                                   own part (resources only, no nodes, nothing shared written);
##                                                   {"error": text} refuses the tile
##   attach(tile, part) -> bool                      main thread, one small step; true when the part is attached
##   dispose(tile, part) -> bool                     main thread, one small step; true when everything is freed
## A tile goes READING (a worker reads the file and every system prepares its part), ATTACHING (the queue runs the
## systems' attach steps, at most 1 ms a frame), LIVE, then DISPOSING once it is past the hysteresis ring or over the
## memory cap. A bad tile (wrong version, a vertex outside the margin, a broken file) is reported once in `errors`
## and by `tile_bad`, skipped, and never loaded again; the tiles around it load as usual.
##
## Far rings (block shells to about 900 m, the skyline per 1 km cell): `register_ring(ring, system)` gets
## ring_enter(ring, cell) and ring_exit(ring, cell) as cells come and go. Nothing registers before P2.
##
## Burst: `warp(pos)` (the first load, a teleport, a respawn: nothing is playing) lifts the queue's cap until the
## ring around the focus is live. While playing the cap always holds.
extends Node

signal tile_live(key: Vector2i)
signal tile_gone(key: Vector2i)
signal tile_bad(key: Vector2i, error: String)

const TileReader := preload("res://world/streaming/tile_reader.gd")
const RingPlan := preload("res://world/streaming/ring_plan.gd")
const AttachQueue := preload("res://world/streaming/attach_queue.gd")
const READING := 0
const ATTACHING := 1
const LIVE := 2
const DISPOSING := 3
## Tile files read at once (each on its own worker task).
const MAX_READS := 4
## The focus moves this far before the wanted set is worked out again.
const REPLAN_M := 16.0
## A move of the focus over this in one frame is a jump: the heading starts again from nothing.
const JUMP_M := 150.0
## The heading and speed of the focus are measured over at least this much wall time.
const TRACK_USEC := 100000

var index: RefCounted = null
var plan := RingPlan.new()
var queue := AttachQueue.new()
var systems: Array = []
var ring_systems := {RingPlan.RING_SHELLS: [], RingPlan.RING_SKYLINE: []}
var ring_cells := {RingPlan.RING_SHELLS: {}, RingPlan.RING_SKYLINE: {}}
## Vector2i -> {key, id, state, bytes, view (what the systems get on the main thread: key, id, origin, pins),
## parts (system id -> part), pending (jobs still in the queue), cancelled, task, job}.
var tiles := {}
## Vector2i -> why the tile was refused.
var bad := {}
var errors: Array[String] = []
## The node the ring follows (the player). Without one, call set_focus().
var target: Node3D = null
var focus := Vector3.ZERO
var heading := Vector2.ZERO
var speed := 0.0
var burst := false
## False reads tiles on the calling thread. setup() turns it off in a headless run: the dummy renderer's mesh storage
## is not thread safe (meshes made on two threads at once end as "wrong RID" errors; the real renderer's is, measured
## over 540 threaded reads), so headless runs and unit tests read on the main thread.
var threaded := true
## The whole core step of the last frame in ms, and totals for reports.
var frame_ms := 0.0
var totals := {"read": 0, "live": 0, "gone": 0, "bad": 0, "readMsMax": 0.0, "readMsSum": 0.0}
var _reading: Array[Vector2i] = []
var _to_read: Array[Vector2i] = []
var _wanted := {}
var _plan_at := Vector3(INF, INF, INF)
var _plan_dirty := true
var _ready_now := false
var _ready_dirty := true
var _anchor := Vector3.ZERO
var _anchor_usec := 0
var _sky_cells: Array = []
var _ids: Array = []
var _ids_dirty := true


func setup(tile_index: RefCounted) -> void:
	index = tile_index
	if DisplayServer.get_name() == "headless":
		threaded = false
	var cells := {}
	var per: float = RingPlan.RINGS[RingPlan.RING_SKYLINE].cell / index.size
	for key: Vector2i in index.tiles:
		cells[Vector2i(floori(key.x / per), floori(key.y / per))] = true
	_sky_cells = cells.keys()


## Adds a streamed system. The order of the calls is the order its steps run in for one tile.
func register(system: Object) -> void:
	systems.append(system)


## Adds a far ring hook (RingPlan.RING_SHELLS or RING_SKYLINE): ring_enter(ring, cell) and ring_exit(ring, cell).
func register_ring(ring: int, system: Object) -> void:
	ring_systems[ring].append(system)
	_plan_dirty = true


func _process(_delta: float) -> void:
	if target != null and is_instance_valid(target):
		track(target.global_position)
	step()


func _exit_tree() -> void:
	unload_all()


## Follows a moving focus: its heading and speed come from where it was at least TRACK_USEC ago.
func track(pos: Vector3) -> void:
	var now := Time.get_ticks_usec()
	if _anchor_usec == 0 or pos.distance_to(focus) > JUMP_M:
		_anchor = pos
		_anchor_usec = now
		heading = Vector2.ZERO
		speed = 0.0
	elif now - _anchor_usec >= TRACK_USEC:
		var d := Vector2(pos.x - _anchor.x, pos.z - _anchor.z)
		speed = d.length() / (float(now - _anchor_usec) / 1e6)
		if d.length() > 0.05:
			heading = d.normalized()
		_anchor = pos
		_anchor_usec = now
	focus = pos


## Sets the focus by hand (tests, and a game with no target node).
func set_focus(pos: Vector3, dir := Vector2.ZERO, metres_per_second := 0.0) -> void:
	focus = pos
	heading = dir
	speed = metres_per_second
	_plan_dirty = true


## Moves the focus to a new place at once and loads its ring in a burst (a load screen, a teleport).
func warp(pos: Vector3) -> void:
	set_focus(pos)
	_anchor = pos
	_anchor_usec = Time.get_ticks_usec()
	burst = true
	_ready_dirty = true


## One frame of the core: finished reads, the plan when the focus moved, new reads, then the queue under its cap.
func step() -> void:
	if index == null:
		return
	var t0 := Time.get_ticks_usec()
	_collect()
	if _plan_dirty or Vector2(focus.x - _plan_at.x, focus.z - _plan_at.z).length() >= REPLAN_M:
		_replan()
	_start_reads()
	for job in queue.run(burst):
		_job_done(job)
	if burst and ring_ready():
		burst = false
	frame_ms = float(Time.get_ticks_usec() - t0) / 1000.0


## True when every tile the map has inside the full ring around the focus is live (a refused tile counts: it will
## never come).
func ring_ready() -> bool:
	if _ready_dirty and index != null:
		_ready_now = plan.ring_live(focus.x, focus.z, index.has, is_settled)
		_ready_dirty = false
	return _ready_now


func is_live(key: Vector2i) -> bool:
	return tiles.has(key) and tiles[key].state == LIVE


func is_settled(key: Vector2i) -> bool:
	return bad.has(key) or is_live(key)


## Ids of the live tiles, sorted.
func live_ids() -> Array:
	if _ids_dirty:
		_ids = []
		for key: Vector2i in tiles:
			if tiles[key].state == LIVE:
				_ids.append(str(tiles[key].id))
		_ids.sort()
		_ids_dirty = false
	return _ids


## Tiles that hold memory now (every state but a read that was cancelled), and their file bytes.
func loaded() -> Dictionary:
	var out := {}
	for key: Vector2i in tiles:
		if tiles[key].state != DISPOSING and not tiles[key].cancelled:
			out[key] = tiles[key].bytes
	return out


## What the debug state reports: the loaded tiles and the queues.
func info() -> Dictionary:
	var bytes := 0
	for key: Vector2i in tiles:
		bytes += int(tiles[key].bytes)
	return {
		"tiles": live_ids().size(), "loaded": live_ids(), "held": tiles.size(), "heldBytes": bytes,
		"queue": {"reading": _reading.size(), "waiting": _to_read.size(), "attach": queue.pending("attach"), "dispose": queue.pending("dispose")},
		"ready": ring_ready(), "burst": burst, "cap": {"tiles": plan.cap_tiles, "bytes": plan.cap_bytes},
		"errors": errors, "bad": bad.size(), "totals": totals,
	}


## Frees every tile now (leaving the scene, tests). Waits for reads that are still running.
func unload_all() -> void:
	for key in _reading:
		if threaded and tiles[key].task >= 0:
			WorkerThreadPool.wait_for_task_completion(tiles[key].task)
	_reading.clear()
	_to_read.clear()
	queue.jobs.clear()
	for key: Vector2i in tiles:
		var e: Dictionary = tiles[key]
		for sys: Object in systems:
			if e.parts.has(sys.id):
				while not sys.dispose(e.view, e.parts[sys.id]):
					pass
	tiles.clear()
	_plan_dirty = true
	_ready_dirty = true
	_ids_dirty = true


# ---------------------------------------------------------------- the plan


func _replan() -> void:
	_plan_dirty = false
	_plan_at = focus
	_ready_dirty = true
	var list: Array[Vector2i] = plan.wanted(focus.x, focus.z, heading, speed, index.has)
	_wanted.clear()
	for key in list:
		_wanted[key] = true
	for key: Vector2i in tiles.keys():
		var e: Dictionary = tiles[key]
		if e.state != DISPOSING and not plan.keep(key, focus.x, focus.z, heading, speed):
			_unload(key)
	_to_read.clear()
	for key in list:
		if tiles.has(key):
			tiles[key].cancelled = false
		elif not bad.has(key):
			_to_read.append(key)
	var held := loaded()
	for key in plan.over_cap(held, _wanted, focus.x, focus.z, _to_read.size()):
		_unload(key)
	queue.dispose_first = held.size() > plan.cap_tiles
	queue.rerank(func(key: Vector2i) -> float: return plan.rank(key, focus.x, focus.z, heading, speed))
	_far_rings()


func _start_reads() -> void:
	while not _to_read.is_empty() and _reading.size() < MAX_READS:
		var held := loaded()
		var bytes := 0
		for key: Vector2i in held:
			bytes += int(held[key])
		var next: Vector2i = _to_read[0]
		if held.size() >= plan.cap_tiles or bytes + int(index.tiles[next].bytes) > plan.cap_bytes:
			return
		_to_read.pop_front()
		if tiles.has(next):
			continue
		var job := {"path": index.path(next), "key": next, "systems": systems.duplicate(), "out": null}
		var e := {
			"key": next, "id": str(index.tiles[next].id), "state": READING, "bytes": int(index.tiles[next].bytes), "view": {},
			"parts": {}, "pending": 0, "cancelled": false, "task": -1, "job": job,
		}
		tiles[next] = e
		_reading.append(next)
		if threaded:
			e.task = WorkerThreadPool.add_task(_read_job.bind(job), false, "tile %s" % e.id)
		else:
			_read_job(job)


## On a worker thread: reads the file and lets every system prepare its part. Writes only into `job`.
func _read_job(job: Dictionary) -> void:
	var tile: Dictionary = TileReader.read(job.path)
	if tile.ok and tile.key != job.key:
		tile = {"ok": false, "error": "%s holds tile %d_%d" % [job.path, tile.key.x, tile.key.y]}
	if tile.ok:
		var parts := {}
		for sys: Object in job.systems:
			var part: Variant = sys.prepare(tile)
			if typeof(part) == TYPE_DICTIONARY and (part as Dictionary).has("error"):
				tile = {"ok": false, "error": "%s: %s" % [job.path, part.error]}
				break
			parts[sys.id] = part
		if tile.ok:
			# the systems hold what they need: the file's bytes and header go
			tile = {"ok": true, "origin": tile.origin, "pins": tile.pins, "parts": parts, "thread_us": tile.thread_us}
	job.out = tile


func _collect() -> void:
	for key: Vector2i in _reading.duplicate():
		var e: Dictionary = tiles[key]
		if threaded:
			if not WorkerThreadPool.is_task_completed(e.task):
				continue
			WorkerThreadPool.wait_for_task_completion(e.task)
		_reading.erase(key)
		var out: Dictionary = e.job.out
		e.job = {}
		totals.read += 1
		if not out.ok:
			tiles.erase(key)
			bad[key] = str(out.error)
			errors.append(str(out.error))
			totals.bad += 1
			_ready_dirty = true
			push_warning("stream: tile skipped: %s" % out.error)
			tile_bad.emit(key, str(out.error))
			continue
		var ms := float(out.thread_us) / 1000.0
		totals.readMsMax = maxf(totals.readMsMax, ms)
		totals.readMsSum += ms
		if e.cancelled:
			# never attached: its parts are plain resources and go with this entry
			tiles.erase(key)
			continue
		e.view = {"key": key, "id": e.id, "origin": out.origin, "pins": out.pins}
		e.parts = out.parts
		e.state = ATTACHING
		e.pending = systems.size()
		var rank: float = plan.rank(key, focus.x, focus.z, heading, speed)
		for i in systems.size():
			queue.push(systems[i], e.view, e.parts[systems[i].id], "attach", rank, i)
		if systems.is_empty():
			_set_live(e)


func _unload(key: Vector2i) -> void:
	var e: Dictionary = tiles[key]
	if e.state == READING:
		e.cancelled = true
		return
	queue.drop(key, "attach")
	e.state = DISPOSING
	e.pending = systems.size()
	_ids_dirty = true
	_ready_dirty = true
	for i in systems.size():
		queue.push(systems[i], e.view, e.parts[systems[i].id], "dispose", 0.0, i)
	if systems.is_empty():
		_set_gone(e)


func _job_done(job: Dictionary) -> void:
	if not tiles.has(job.key):
		return
	var e: Dictionary = tiles[job.key]
	e.pending -= 1
	if e.pending > 0:
		return
	if job.op == "attach":
		_set_live(e)
	else:
		_set_gone(e)


func _set_live(e: Dictionary) -> void:
	e.state = LIVE
	totals.live += 1
	_ids_dirty = true
	_ready_dirty = true
	tile_live.emit(e.key)


func _set_gone(e: Dictionary) -> void:
	tiles.erase(e.key)
	totals.gone += 1
	if _wanted.has(e.key):
		_plan_dirty = true
	tile_gone.emit(e.key)


## The far rings: tells the registered systems which cells came inside and which left.
func _far_rings() -> void:
	for ring: int in ring_systems:
		if (ring_systems[ring] as Array).is_empty():
			continue
		var cells: Dictionary = ring_cells[ring]
		var exists := func(key: Vector2i) -> bool: return index.has(key)
		var now := {}
		for key in plan.wanted(focus.x, focus.z, heading, speed, exists, ring, _sky_cells):
			now[key] = true
			if not cells.has(key):
				cells[key] = true
				for sys: Object in ring_systems[ring]:
					sys.ring_enter(ring, key)
		for key: Vector2i in cells.keys():
			if not now.has(key) and not plan.keep(key, focus.x, focus.z, heading, speed, ring):
				cells.erase(key)
				for sys: Object in ring_systems[ring]:
					sys.ring_exit(ring, key)
