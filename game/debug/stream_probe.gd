## Debug probes of the streamed city for the harness: the hook stream(cmd, opts) of docs/GAME_HOOKS.md. A child of the
## debug server, made on its first call, so a game without --debug (or a run that never asks) does not load it.
##   info                         the city's state (state().world) plus the path, the systems and the queue's worst steps
##   path {points, speedKmh, loop}  moves the player along a polyline of world points [x, y, z] at a constant speed on
##                                the sim tick (a scripted drive for perf and memory scenarios: the V2 vehicle is frozen
##                                and carried along it, vehicle.gd carry()). {stop: true} ends it and stands it there
##   record {on, skipS}           starts a recording of every drawn frame (frame time, the core's work, attach steps);
##                                {on: false} stops it and answers the numbers; {} answers them so far
##   layers {hide: [names], show: [names]}  P1-026: hides or shows the drawn meshes of a streaming system by its name
##                                (`ground_roads`, `buildings`) on every live tile, for GPU ablation runs; only for a
##                                player that stands still (a tile that streams in later is drawn). {} lists the counts
##   probe {x, z, y}              the collider under a point (a ray down) against the drawn surface there (the tile
##                                files' own triangles, paint, water and deck undersides left out)
##   mem                          engine object counts, static and process memory, tiles held
## It reads the game and moves the player the way a staging hook may; it changes nothing in the streaming code.
extends Node

const Stats := preload("res://debug/perf_stats.gd")
const TileReader := preload("res://world/streaming/tile_reader.gd")
const WorldFrame := preload("res://geo/world_frame.gd")
## Drawn meshes that are not a surface to stand on (the bake leaves them out of the colliders too).
const NOT_GROUND := ["marking", "water", "underside"]
## The heading of a scripted drive looks this far along the path.
const LOOK_M := 8.0
const MB := 1048576.0

var _pts := PackedVector3Array()
var _cum: Array[float] = []
var _length := 0.0
var _s := 0.0
var _seg := 0
var _speed := 0.0
var _loop := false
var _laps := 0
var _running := false
var _rec := false
var _rec_sim0 := 0.0
var _rec_skip := 2.0
var _last_usec := 0
var _frame: Array[float] = []
var _sim: Array[float] = []
var _core: Array[float] = []
var _attach: Array[float] = []
var _calls: Array[float] = []
## Per frame: the scripts' process time and the viewport's render CPU time, to say what a long frame was made of.
var _proc: Array[float] = []
var _render: Array[float] = []
## Per frame: Performance TIME_PHYSICS_PROCESS (the monitor refreshes about once a second, so read it as a mean).
var _phys: Array[float] = []
var _chunks_max := 0
var _chunk_frames := 0
var _mesh_frames := 0
var _mixed := 0
var _burst := 0
var _held_max := 0
var _live_max := 0
var _totals0 := {}


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	get_node("/root/SimClock").sim_tick.connect(_tick)
	RenderingServer.frame_post_draw.connect(_after_draw)


func _exit_tree() -> void:
	if RenderingServer.frame_post_draw.is_connected(_after_draw):
		RenderingServer.frame_post_draw.disconnect(_after_draw)


## The hook: {ok, result} or {ok = false, error}.
func hook(a: Array) -> Dictionary:
	var city := get_tree().get_first_node_in_group("world_stream")
	if city == null:
		return {"ok": false, "error": "stream: no streamed city in this scene (start the game with --tiles=test or --tiles=full)"}
	var cmd := str(a[0]) if a.size() > 0 else "info"
	var o: Dictionary = a[1] if a.size() > 1 and a[1] is Dictionary else {}
	match cmd:
		"info":
			var out: Dictionary = city.info()
			out["path"] = _path_state()
			out["worstStepMs"] = city.core.queue.worst_ms
			out["overBudget"] = city.core.queue.over
			out["focus"] = [city.core.focus.x, city.core.focus.y, city.core.focus.z]
			out["speed"] = city.core.speed
			return {"ok": true, "result": out}
		"path":
			return _path(o)
		"record":
			if o.has("on") and bool(o.on):
				_record_start(city, float(o.get("skipS", 2.0)))
				return {"ok": true, "result": {"recording": true}}
			var res := _record_stats(city)
			if o.has("on"):
				_rec = false
			return {"ok": true, "result": res}
		"probe":
			if not (o.get("x") is float or o.get("x") is int) or not (o.get("z") is float or o.get("z") is int):
				return {"ok": false, "error": "stream(probe, {x, z, y}): x and z must be numbers (world metres)"}
			return {"ok": true, "result": _probe(city, float(o.x), float(o.z), float(o.y) if o.get("y") is float or o.get("y") is int else NAN)}
		"mem":
			return {"ok": true, "result": _mem(city)}
		"layers":
			return {"ok": true, "result": _layers(city, o)}
	return {"ok": false, "error": "stream(cmd, opts): unknown cmd '%s' (info, path, record, probe, mem, layers)" % cmd}


## Hides or shows the drawn meshes of the named streaming systems on every live tile; answers the count per system.
func _layers(city: Node, o: Dictionary) -> Dictionary:
	var out := {}
	for key: String in ["hide", "show"]:
		for n: Variant in o.get(key, []):
			var name := str(n)
			var count := 0
			for node: Node in city.find_children("%s_*" % name, "MeshInstance3D", true, false):
				(node as MeshInstance3D).visible = key == "show"
				count += 1
			out[name] = {"meshes": count, "visible": key == "show"}
	return out


# ---------------------------------------------------------------- the scripted drive


func _path(o: Dictionary) -> Dictionary:
	if o.get("stop", false):
		var was := _running
		_running = false
		if was:
			_place()
		return {"ok": true, "result": _path_state()}
	var list: Variant = o.get("points")
	var kmh: Variant = o.get("speedKmh")
	if not (list is Array) or (list as Array).size() < 2 or not (kmh is float or kmh is int) or float(kmh) <= 0.0:
		return {"ok": false, "error": "stream(path, {points, speedKmh, loop}): needs at least 2 points [x, y, z] and a speed over 0"}
	_pts = PackedVector3Array()
	_cum = [0.0]
	for q: Variant in list:
		if not (q is Array) or (q as Array).size() != 3:
			return {"ok": false, "error": "stream(path): every point is [x, y, z] in world metres"}
		var at := Vector3(float(q[0]), float(q[1]), float(q[2]))
		if _pts.size() > 0:
			_cum.append(_cum[-1] + _pts[-1].distance_to(at))
		_pts.append(at)
	_length = _cum[-1]
	_speed = float(kmh) / 3.6
	_loop = bool(o.get("loop", false))
	_s = 0.0
	_seg = 0
	_laps = 0
	_running = true
	_place()
	return {"ok": true, "result": _path_state()}


func _path_state() -> Dictionary:
	return {"running": _running, "s": _s, "lengthM": _length, "laps": _laps, "speedKmh": _speed * 3.6, "loop": _loop}


func _tick(dt: float) -> void:
	if not _running:
		return
	_s += _speed * dt
	if _s >= _length:
		if _loop:
			_s -= _length
			_seg = 0
			_laps += 1
		else:
			_s = _length
			_running = false
			get_node("/root/GameEvents").emit_event("stream:path_done", {"lengthM": _length})
	_place()


## The point of the path at distance s (the cursor only walks forward between laps).
func _at(s: float) -> Vector3:
	var i := _seg
	while i < _cum.size() - 2 and _cum[i + 1] < s:
		i += 1
	var span := _cum[i + 1] - _cum[i]
	return _pts[i].lerp(_pts[i + 1], clampf((s - _cum[i]) / span, 0.0, 1.0) if span > 0.0 else 0.0)


func _place() -> void:
	var car := get_tree().get_first_node_in_group("player") as Node3D
	if car == null:
		return
	var pos := _at(_s)
	while _seg < _cum.size() - 2 and _cum[_seg + 1] < _s:
		_seg += 1
	var to := _s + LOOK_M
	var ahead := _at(minf(to, _length))
	if _loop and to >= _length:
		# the look point is on the next lap: read it from the start of the path
		var keep := _seg
		_seg = 0
		ahead = _at(to - _length)
		_seg = keep
	var d := ahead - pos
	if car.has_method("carry"):
		# the V2 vehicle: frozen and moved along the path (a scripted drive, not physics)
		var h: float = atan2(d.x, -d.z) if d.length() > 0.01 else float(car.heading)
		if _running:
			car.carry(pos, h, _speed)
		else:
			# the path ended or was stopped: the vehicle stands there and is a physics body again
			car.ground_y = pos.y
			car.place(pos.x, pos.z, h)
	elif car.has_method("place"):
		car.ground_y = pos.y
		if d.length() > 0.01:
			car.place(pos.x, pos.z, atan2(d.x, -d.z))
		else:
			car.place(pos.x, pos.z)
		car.model.speed = _speed if _running else 0.0
	else:
		car.global_position = pos


# ---------------------------------------------------------------- the frame recording


func _record_start(city: Node, skip_s: float) -> void:
	RenderingServer.viewport_set_measure_render_time(get_viewport().get_viewport_rid(), true)
	for list: Array in [_frame, _sim, _core, _attach, _calls, _proc, _render, _phys]:
		list.clear()
	_chunks_max = 0
	_chunk_frames = 0
	_mesh_frames = 0
	_mixed = 0
	_burst = 0
	_held_max = 0
	_live_max = 0
	_rec_skip = skip_s
	_rec_sim0 = get_node("/root/SimClock").t
	_totals0 = (city.core.totals as Dictionary).duplicate()
	_last_usec = 0
	_rec = true


func _after_draw() -> void:
	if not _rec:
		return
	var city := get_tree().get_first_node_in_group("world_stream")
	if city == null:
		return
	var now := Time.get_ticks_usec()
	if _last_usec > 0:
		var q: Dictionary = city.core.queue.frame
		_frame.append(float(now - _last_usec) / 1000.0)
		_sim.append(get_node("/root/SimClock").t - _rec_sim0)
		_core.append(float(city.core.frame_ms))
		_proc.append(Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0)
		_phys.append(Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0)
		_render.append(RenderingServer.viewport_get_measured_render_time_cpu(get_viewport().get_viewport_rid()) + RenderingServer.get_frame_setup_time_cpu())
		_attach.append(float(q.ms))
		_calls.append(RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME))
		var chunks := int((q.attach as Dictionary).get("collider", 0))
		var meshes := int((q.attach as Dictionary).get("mesh", 0))
		if bool(q.burst):
			_burst += 1
		else:
			_chunks_max = maxi(_chunks_max, chunks)
		_chunk_frames += 1 if chunks > 0 else 0
		_mesh_frames += 1 if meshes > 0 else 0
		_mixed += 1 if bool(q.mixed) or (chunks > 0 and meshes > 0) else 0
		_held_max = maxi(_held_max, (city.core.tiles as Dictionary).size())
		_live_max = maxi(_live_max, (city.core.live_ids() as Array).size())
	_last_usec = now


static func _pct(values: Array[float]) -> Dictionary:
	if values.is_empty():
		return {"p50": 0.0, "p95": 0.0, "p99": 0.0, "max": 0.0}
	var s := values.duplicate()
	s.sort()
	var q := func(f: float) -> float: return s[mini(s.size() - 1, int(floor(f * s.size())))]
	return {"p50": q.call(0.5), "p95": q.call(0.95), "p99": q.call(0.99), "max": s[-1]}


func _record_stats(city: Node) -> Dictionary:
	var over: Array[Dictionary] = []
	var late: Array[float] = []
	for i in _frame.size():
		if _sim[i] < _rec_skip:
			continue
		late.append(_frame[i])
		if _frame[i] > 33.0 and over.size() < 20:
			# a long frame with little process and render time was spent outside the game's work (present, the OS)
			over.append({"t": _sim[i], "ms": _frame[i], "coreMs": _core[i], "processMs": _proc[i], "renderCpuMs": _render[i]})
	var count := 0
	for ms in late:
		count += 1 if ms > 33.0 else 0
	var totals: Dictionary = city.core.totals
	return {
		"recording": _rec, "frames": _frame.size(), "simS": _sim[-1] if not _sim.is_empty() else 0.0, "skipS": _rec_skip,
		"frameMs": _pct(late), "frameMsAll": _pct(_frame), "over33": count, "over33List": over,
		"coreMs": _pct(_core), "attachMs": _pct(_attach), "processMs": _pct(_proc), "physicsMs": _pct(_phys), "renderCpuMs": _pct(_render),
		"chunksMax": _chunks_max, "chunkFrames": _chunk_frames, "meshFrames": _mesh_frames, "mixedFrames": _mixed, "burstFrames": _burst,
		"drawCalls": {"max": Stats.stats(_calls).max, "avg": Stats.mean(_calls)}, "heldMax": _held_max, "liveMax": _live_max,
		"capTiles": city.core.plan.cap_tiles,
		"tilesRead": int(totals.read) - int(_totals0.get("read", 0)), "tilesGone": int(totals.gone) - int(_totals0.get("gone", 0)),
		"readMsMax": totals.readMsMax, "readMsAvg": float(totals.readMsSum) / maxf(1.0, float(totals.read)),
		"worstStepMs": city.core.queue.worst_ms, "overBudget": city.core.queue.over, "path": _path_state(),
	}


# ---------------------------------------------------------------- ground and memory


## The collider under (x, z) against the drawn surface: {hit, colliderY, drawn, drawnY, material, gapM, tile}. Both
## look down from the same height (`from_y`, or from above everything), so on a flyover both find the deck.
func _probe(city: Node, x: float, z: float, from_y: float) -> Dictionary:
	var ray: Dictionary = city.ground_at(x, z, from_y)
	var key := WorldFrame.tile_of(x, z)
	var top := from_y if not is_nan(from_y) else INF
	var best_y := -INF
	var best_material := ""
	for dz in range(-1, 2):
		for dx in range(-1, 2):
			var near := key + Vector2i(dx, dz)
			if not city.index.has(near):
				continue
			var tile: Dictionary = TileReader.read(city.index.path(near))
			if not tile.ok:
				continue
			var local := Vector3(x, 0.0, z) - (tile.origin as Vector3)
			var limit: float = top - (tile.origin as Vector3).y
			for m: Dictionary in tile.header.meshes:
				if str(m.material) in NOT_GROUND:
					continue
				var y := _top_under(TileReader.vec3(tile, int(m.pos), int(m.vertices)), TileReader.ints(tile, int(m.idx), int(m.indices)), local.x, local.z, limit)
				if y > -INF and y + (tile.origin as Vector3).y > best_y:
					best_y = y + (tile.origin as Vector3).y
					best_material = str(m.material)
	var drawn := best_y > -INF
	return {
		"hit": ray.hit, "colliderY": ray.y, "drawn": drawn, "drawnY": best_y if drawn else 0.0, "material": best_material,
		"gapM": absf(float(ray.y) - best_y) if ray.hit and drawn else -1.0, "tile": ray.tile,
	}


## The highest point at or under `limit` where the vertical line through (x, z) meets a triangle that faces up
## (front faces wind clockwise, so (b - a) x (c - a) points down for one). -INF when there is none.
static func _top_under(pos: PackedVector3Array, idx: PackedInt32Array, x: float, z: float, limit: float) -> float:
	var best := -INF
	for i in range(0, idx.size(), 3):
		var a := pos[idx[i]]
		var b := pos[idx[i + 1]]
		var c := pos[idx[i + 2]]
		if (a.x < x and b.x < x and c.x < x) or (a.x > x and b.x > x and c.x > x) or (a.z < z and b.z < z and c.z < z) or (a.z > z and b.z > z and c.z > z):
			continue
		var det := (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z)
		if det <= 1e-9:
			continue
		var u := ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / det
		var v := ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / det
		if u < 0.0 or v < 0.0 or u + v > 1.0:
			continue
		var y := u * a.y + v * b.y + (1.0 - u - v) * c.y
		if y <= limit and y > best:
			best = y
	return best


func _mem(city: Node) -> Dictionary:
	var out := {
		"objects": int(Performance.get_monitor(Performance.OBJECT_COUNT)), "nodes": int(Performance.get_monitor(Performance.OBJECT_NODE_COUNT)),
		"resources": int(Performance.get_monitor(Performance.OBJECT_RESOURCE_COUNT)),
		"staticMB": float(OS.get_static_memory_usage()) / MB,
		"videoMB": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_VIDEO_MEM_USED) / MB,
		"held": (city.core.tiles as Dictionary).size(), "live": (city.core.live_ids() as Array).size(), "capTiles": city.core.plan.cap_tiles,
		"colliderChunks": int(city.colliders.chunks), "lanePieces": (city.lanes.pieces as Dictionary).size(),
	}
	# the process's resident memory, where `ps` exists (macOS, Linux)
	var lines := []
	if OS.get_name() != "Windows" and OS.execute("ps", ["-o", "rss=", "-p", str(OS.get_process_id())], lines) == 0 and lines.size() > 0:
		var kb := str(lines[0]).strip_edges()
		if kb.is_valid_int():
			out["rssMB"] = float(int(kb)) / 1024.0
	return out
