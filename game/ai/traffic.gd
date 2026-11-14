## Traffic stand-in (P2-045, ARCH row `ai/`): lane followers on the lane graph of the loaded tiles, cars, autos and
## scooters, that keep to the pieces their mode may use (the access model of P2-042, lanes.gd allows): a car or an
## auto is never spawned on, and never turns into, a car-free street; a scooter may ride a two-wheeler gali. At the
## end of a piece an agent takes one of its `next` pieces its mode may use (straight ahead more often than a turn);
## with none (a dead end, a closed street ahead, a tile not loaded) it is put down again elsewhere.
## Kinematic and ghost: no physics, no signals, no lane changes, it only waits behind the agent ahead on its lane.
## Off until start() (the debug hook traffic(), docs/GAME_HOOKS.md): the full traffic (signals, gap acceptance, Delhi
## habits, physics near the player) is later work. Every agent's piece is checked against its mode on every tick
## (`audit`), apart from the chooser, so a scenario can prove the rule. Steps on the sim tick. World metres.
extends Node3D

const LaneRouter := preload("res://ai/lane_router.gd")
const Kit := preload("res://scenes/standin/kit.gd")
const KitGeo := preload("res://scenes/standin/geo.gd")

## Cruise speed per mode, m/s (light traffic in town).
const SPEED := {"car": 10.0, "auto": 8.0, "two_wheeler": 8.5}
## Half width of each body, metres (for keeping left in a narrow shared lane).
const HALF_W := {"car": 0.87, "auto": 0.7, "two_wheeler": 0.3}
## The gap kept to the agent ahead on the same lane chain, metres (front to back about a body length).
const GAP_M := 7.5
## Lanes narrower than this are shared by both directions: an agent keeps left in them and goes at half speed.
const NARROW_M := 4.0
## No agent is put down nearer the player than this.
const CLEAR_M := 30.0

var lanes: RefCounted
var running := false
## [{id, mode, piece, s, speed, node, dist}]
var agents: Array[Dictionary] = []
## {ticks, checks, bad, badList, entries: {mode: n}, closedToCars: {mode: n}, spawned: {mode: n}, putDown}
var audit := {}
var opts := {}
var _rng := RandomNumberGenerator.new()
var _meshes := {}
var _next_id := 0


func setup(lanes_system: RefCounted) -> void:
	lanes = lanes_system


func _ready() -> void:
	var clock := get_node_or_null("/root/SimClock")
	if clock != null:
		clock.sim_tick.connect(_tick)


## Starts (or restarts) traffic: `count` agents (default 24) on pieces within `radius` m (default 220) of `at` ([x, z],
## the player when left out), modes drawn from `mix` ({car, auto, two_wheeler} shares), seeded by `seed`.
func start(o: Dictionary) -> Dictionary:
	stop()
	opts = {"count": int(o.get("count", 24)), "radius": float(o.get("radius", 220.0)), "seed": int(o.get("seed", 7)),
		"mix": o.get("mix", {"car": 0.4, "auto": 0.3, "two_wheeler": 0.3})}
	if o.get("at") is Array and (o.at as Array).size() >= 2:
		opts["at"] = Vector3(float(o.at[0]), 0.0, float(o.at[1]))
	_rng.seed = int(opts.seed)
	audit = {"ticks": 0, "checks": 0, "bad": 0, "badList": [], "entries": {}, "closedToCars": {}, "spawned": {}, "putDown": 0}
	running = true
	for k in int(opts.count):
		var a := {"id": _next_id, "mode": _pick_mode(), "piece": "", "s": 0.0, "speed": 0.0, "node": null, "dist": 0.0}
		_next_id += 1
		if _put_down(a):
			agents.append(a)
	return info()


func stop() -> void:
	running = false
	for a in agents:
		if is_instance_valid(a.node):
			(a.node as Node).queue_free()
	agents.clear()


## {on, count, agents: [{id, mode, piece, modes, pos, speed, dist}], audit}
func info() -> Dictionary:
	var list := []
	for a in agents:
		var p: Dictionary = lanes.piece(a.piece)
		var pos: Vector3 = (a.node as Node3D).global_position if is_instance_valid(a.node) else Vector3.ZERO
		list.append({"id": a.id, "mode": a.mode, "piece": a.piece, "modes": p.get("modes", []), "cls": p.get("cls", ""),
			"pos": [pos.x, pos.y, pos.z], "speed": a.speed, "dist": a.dist})
	return {"on": running, "count": agents.size(), "agents": list, "audit": audit}


func _tick(dt: float) -> void:
	if not running or lanes == null:
		return
	audit.ticks += 1
	var focus := _focus()
	for a in agents:
		_step(a, dt)
		# far behind the player: put down again near it (the ring moves on)
		if is_instance_valid(a.node) and Vector2(a.node.global_position.x - focus.x, a.node.global_position.z - focus.z).length() > float(opts.radius) + 160.0:
			_put_down(a)
		var p: Dictionary = lanes.piece(a.piece)
		audit.checks += 1
		if not LaneRouter.usable(p, a.mode):
			audit.bad += 1
			if (audit.badList as Array).size() < 10:
				audit.badList.append({"agent": a.id, "mode": a.mode, "piece": a.piece, "modes": p.get("modes", null)})


func _step(a: Dictionary, dt: float) -> void:
	var p: Dictionary = lanes.piece(a.piece)
	if p.is_empty():
		_put_down(a)
		return
	var want: float = SPEED[a.mode] * (0.5 if float(p.width) < NARROW_M - 0.8 else 1.0)
	var ahead := _gap_ahead(a)
	if ahead < GAP_M:
		want = 0.0
	elif ahead < GAP_M * 2.5:
		want *= (ahead - GAP_M) / (GAP_M * 1.5)
	a.speed = move_toward(float(a.speed), want, (4.0 if want < float(a.speed) else 2.0) * dt)
	a.s = float(a.s) + float(a.speed) * dt
	a.dist = float(a.dist) + float(a.speed) * dt
	while float(a.s) > float(p.length):
		var n := _choose_next(a, p)
		if n == "":
			_put_down(a)
			return
		a.s = float(a.s) - float(p.length)
		a.piece = n
		p = lanes.piece(n)
		_count_entry(a, p)
	_place(a, p)


## The distance to the nearest agent ahead on this piece or the pieces this one leads into (INF when none).
func _gap_ahead(a: Dictionary) -> float:
	var best := INF
	var p: Dictionary = lanes.piece(a.piece)
	var left := float(p.length) - float(a.s)
	for b in agents:
		if b.id == a.id:
			continue
		if b.piece == a.piece and float(b.s) > float(a.s):
			best = minf(best, float(b.s) - float(a.s))
		elif str(b.piece) in (p.next as Array):
			best = minf(best, left + float(b.s))
	return best


## One of the piece's `next` pieces the agent's mode may use, straight ahead three times as likely as a turn; "" when
## none is loaded and open to it.
func _choose_next(a: Dictionary, p: Dictionary) -> String:
	var opts_n: Array = []
	var weights: Array = []
	var e := _dir(p.pts, true)
	for n: Variant in p.next:
		var q: Dictionary = lanes.piece(str(n))
		if q.is_empty() or not LaneRouter.usable(q, a.mode) or (q.pts as PackedVector3Array).size() < 2:
			continue
		var s := _dir(q.pts, false)
		opts_n.append(str(n))
		weights.append(3.0 if e.dot(s) > 0.9 else 1.0)
	if opts_n.is_empty():
		return ""
	var total := 0.0
	for w: float in weights:
		total += w
	var r := _rng.randf() * total
	for i in opts_n.size():
		r -= float(weights[i])
		if r <= 0.0:
			return opts_n[i]
	return opts_n[opts_n.size() - 1]


## Puts an agent down on a random lane piece its mode may use, CLEAR_M to `radius` m from the focus. False when none.
func _put_down(a: Dictionary) -> bool:
	var focus := _focus()
	var cands: Array = []
	for id: String in lanes.near(focus.x, focus.z, float(opts.radius)):
		var p: Dictionary = lanes.piece(id)
		if str(p.kind) != "lane" or float(p.length) < 12.0 or not LaneRouter.usable(p, a.mode) or not (p.next as Array).size():
			continue
		var mid: Vector3 = (p.pts as PackedVector3Array)[(p.pts as PackedVector3Array).size() / 2]
		var d := Vector2(mid.x - focus.x, mid.z - focus.z).length()
		if d >= CLEAR_M and d <= float(opts.radius):
			cands.append(id)
	if cands.is_empty():
		if is_instance_valid(a.node):
			(a.node as Node3D).visible = false
		return false
	cands.sort()
	var pick: String = cands[_rng.randi_range(0, cands.size() - 1)]
	var p2: Dictionary = lanes.piece(pick)
	a.piece = pick
	a.s = _rng.randf_range(0.0, float(p2.length) * 0.6)
	a.speed = SPEED[a.mode] * 0.5
	if not is_instance_valid(a.node):
		var m := MeshInstance3D.new()
		m.name = "Agent%d" % a.id
		m.mesh = _mesh_for(a.mode, int(a.id))
		add_child(m)
		a.node = m
	(a.node as Node3D).visible = true
	audit.putDown += 1
	audit.spawned[a.mode] = int(audit.spawned.get(a.mode, 0)) + 1
	_count_entry(a, p2)
	_place(a, p2)
	return true


func _count_entry(a: Dictionary, p: Dictionary) -> void:
	audit.entries[a.mode] = int(audit.entries.get(a.mode, 0)) + 1
	if not ("car" in (p.get("modes", []) as Array)):
		audit.closedToCars[a.mode] = int(audit.closedToCars.get(a.mode, 0)) + 1


## Stands the body on the piece at distance s, facing along it, kept left in a narrow shared lane.
func _place(a: Dictionary, p: Dictionary) -> void:
	var pts: PackedVector3Array = p.pts
	var run := 0.0
	var s := float(a.s)
	var at := pts[0]
	var dir := Vector3.FORWARD
	for i in pts.size() - 1:
		var seg := pts[i].distance_to(pts[i + 1])
		if seg < 1e-4:
			continue
		dir = (pts[i + 1] - pts[i]) / seg
		if run + seg >= s or i == pts.size() - 2:
			at = pts[i].lerp(pts[i + 1], clampf((s - run) / seg, 0.0, 1.0))
			break
		run += seg
	var w := float(p.width)
	if w > 0.0 and w < NARROW_M:
		var left := Vector3(dir.z, 0.0, -dir.x).normalized()
		at += left * maxf(0.0, w * 0.5 - float(HALF_W[a.mode]) - 0.15)
	var flat := Vector3(dir.x, 0.0, dir.z)
	if flat.length_squared() < 1e-6:
		return
	(a.node as Node3D).global_transform = Transform3D(Basis.looking_at(dir, Vector3.UP), at)


func _focus() -> Vector3:
	if opts.has("at"):
		return opts.at
	var p := get_tree().get_first_node_in_group("player") as Node3D
	return p.global_position if p != null else Vector3.ZERO


func _pick_mode() -> String:
	var mix: Dictionary = opts.mix
	var total := 0.0
	for k: String in mix:
		total += float(mix[k])
	var r := _rng.randf() * total
	for k: String in ["car", "auto", "two_wheeler"]:
		if not mix.has(k):
			continue
		r -= float(mix[k])
		if r <= 0.0:
			return k
	return "car"


## A stand-in body per mode from the parts kit (cars in three paints), built once.
func _mesh_for(mode: String, id: int) -> Mesh:
	var key := mode if mode != "car" else "car%d" % (id % 3)
	if _meshes.has(key):
		return _meshes[key]
	var sink := KitGeo.Sink.new()
	match mode:
		"auto":
			Kit.auto_rickshaw(sink, true)
		"two_wheeler":
			Kit.scooter(sink, Kit.CAR_PAINT[(id * 3) % Kit.CAR_PAINT.size()], true)
		_:
			Kit.car(sink, [Color("#eeeeec"), Color("#8a1f1f"), Color("#1f3d6b")][id % 3], "hatch", true)
	_meshes[key] = sink.to_mesh(Kit.materials())
	return _meshes[key]


static func _dir(pts: PackedVector3Array, at_end: bool) -> Vector2:
	var a := pts[maxi(0, pts.size() - 2)] if at_end else pts[0]
	var b := pts[pts.size() - 1] if at_end else pts[mini(1, pts.size() - 1)]
	return Vector2(b.x - a.x, b.z - a.z).normalized()
