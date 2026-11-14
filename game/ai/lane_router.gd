## Path search on the lane graph of the loaded tiles (P2-045, ARCH row `ai/`): shared by the route line (GPS,
## game/ui/gps.gd), traffic (game/ai/traffic.gd) and later the pursuit AI. It keeps to the pieces a mode may use
## (lanes.gd allows(), the access model of P2-042): a car route never enters a car-free street, a scooter may take a
## two-wheeler gali, and a walker (mode `foot`) may walk a piece either way, on its carriageway where walkers share it
## and on its footpath beside a main road at grade (walkable()). Pure data: it reads the lanes system, draws nothing.
## Points are world metres (east +X, north -Z).
extends RefCounted

## Cost factor of small roads in a vehicle route (a car keeps to the main roads; tools/fixtures/lanegraph.mjs SMALL).
const SMALL := {"service": 4.0, "residential": 2.5, "living_street": 4.0, "unclassified": 2.0, "tertiary": 1.4, "pedestrian": 6.0, "track": 6.0}
## Metres of cost a full turn back adds (1 - cos of the turn, times this).
const TURN_COST := 60.0
## A search stops after this many settled pieces (a route across the loaded ring settles a few thousand).
const MAX_SETTLED := 40000
## The vehicle modes of the access model and the tune ids that drive as each (game/data/vehicles/<id>.tres).
const TUNE_MODE := {"car": "car", "auto": "auto", "scooter": "two_wheeler", "patrol_car": "emergency"}

## The lanes system (game/world/systems/lanes.gd) of the streamed city.
var lanes: RefCounted


func _init(lanes_system: RefCounted) -> void:
	lanes = lanes_system


## The access mode of a vehicle tune id ("car" for a tune not in TUNE_MODE).
static func mode_of_tune(tune_id: String) -> String:
	return TUNE_MODE.get(tune_id, "car")


## The access mode of the node the player controls: `foot` on foot, else the vehicle tune's mode.
static func mode_of_player(p: Node) -> String:
	if p == null or not p.has_method("foot_position"):
		return "foot"
	var tune: Variant = p.get("tune")
	return mode_of_tune(str(tune.id)) if tune != null else "car"


## True when `mode` may use the piece: the piece's own modes (lanes.gd allows) for a vehicle; for a walker also the
## footpath beside a car road at grade (walkers on a main road use its footpaths, not its lanes: graph/access.ts).
static func walkable(p: Dictionary) -> bool:
	var modes: Array = p.get("modes", [])
	return "foot" in modes or (int(p.get("layer", 0)) == 0 and ("car" in modes or "auto" in modes))


static func usable(p: Dictionary, mode: String) -> bool:
	if p.is_empty():
		return false
	return walkable(p) if mode == "foot" else mode in (p.get("modes", []) as Array)


## A piece the mode may start or end a route on: a lane (not a junction path) the mode may use.
func _anchor_ok(p: Dictionary, mode: String) -> bool:
	return str(p.kind) == "lane" and usable(p, mode)


## The route from piece `a` to piece `b` for `mode`: the piece ids in order, or [] when none is found. A vehicle
## follows `next` links; a walker follows `next` and `back` links (either way along a piece).
func search(a: String, b: String, mode: String) -> PackedStringArray:
	var pa: Dictionary = lanes.piece(a)
	if pa.is_empty() or lanes.piece(b).is_empty():
		return PackedStringArray()
	if a == b:
		return PackedStringArray([a])
	var both := mode == "foot"
	var dist := {a: 0.0}
	var prev := {}
	var done := {}
	var heap: Array = [[0.0, a]]
	var settled := 0
	while not heap.is_empty():
		var top: Array = _pop(heap)
		var id: String = top[1]
		if done.has(id):
			continue
		done[id] = true
		settled += 1
		if id == b or settled > MAX_SETTLED:
			break
		var p: Dictionary = lanes.piece(id)
		var links: Array = (p.next as Array).duplicate()
		if both:
			links.append_array(p.back)
		for n: Variant in links:
			var nid := str(n)
			if done.has(nid):
				continue
			var q: Dictionary = lanes.piece(nid)
			if q.is_empty() or not usable(q, mode):
				continue
			var nd: float = float(top[0]) + _cost(p, q, mode)
			if nd < float(dist.get(nid, INF)):
				dist[nid] = nd
				prev[nid] = id
				_push(heap, [nd, nid])
	if not done.has(b):
		return PackedStringArray()
	var ids := PackedStringArray([b])
	while ids[0] != a:
		ids.insert(0, str(prev[ids[0]]))
	return ids


## A route for `mode` from a world point to a world point (the route line's request). It starts on the nearest piece
## the mode may use within `reach` m of `from` (a vehicle: one whose direction is within 60 degrees of `heading`
## when given). When the piece nearest the target is one the mode may not use (a car route into a car-free street),
## or no route reaches it, the route ends at the nearest point to the target that the mode may use and reach.
## {ok, ids, points: PackedVector3Array, lengthM, end: Vector3, endPiece, clipped (true when it ends short of the
## target's piece), targetPiece, targetModes, mode, reason}.
func route_to(from: Vector3, to: Vector3, mode: String, heading := NAN, reach := 40.0) -> Dictionary:
	var out := {"ok": false, "ids": PackedStringArray(), "points": PackedVector3Array(), "lengthM": 0.0, "end": to,
		"endPiece": "", "clipped": false, "targetPiece": "", "targetModes": [], "mode": mode, "reason": ""}
	var start := _start_on(from, mode, heading, reach)
	if start.is_empty():
		out.reason = "no piece the %s may use within %d m of the start" % [mode, int(reach)]
		return out
	var want: Dictionary = lanes.closest(to.x, to.y, to.z, 120.0, func(p: Dictionary) -> bool: return str(p.kind) == "lane", 6.0)
	if want.is_empty():
		want = lanes.closest(to.x, to.y, to.z, 120.0, func(p: Dictionary) -> bool: return str(p.kind) == "lane")
	if not want.is_empty():
		out.targetPiece = want.id
		out.targetModes = lanes.piece(want.id).get("modes", [])
	var cands: Array = []
	if not want.is_empty() and _anchor_ok(lanes.piece(want.id), mode):
		cands.append(want)
	# the allowed pieces nearest the target, nearest first: the route ends on the first one it reaches
	for c: Dictionary in _nearest_allowed(to, mode, 300.0, 12):
		if want.is_empty() or c.id != want.id:
			cands.append(c)
	for c: Dictionary in cands:
		var ids := search(start.id, c.id, mode)
		if ids.is_empty():
			continue
		out.ok = true
		out.ids = ids
		out.endPiece = c.id
		out.end = c.pos
		out.clipped = want.is_empty() or c.id != want.id
		out.points = _polyline(ids, start, c, mode)
		out.lengthM = _length(out.points)
		if out.clipped:
			out.reason = "the target's road is closed to %s: the route ends at the nearest point it may reach" % mode
		return out
	out.reason = "no route for %s from the start reaches the target" % mode
	return out


## The nearest piece to `from` that `mode` may start on (a lane); a vehicle's must run within 60 degrees of `heading`.
func _start_on(from: Vector3, mode: String, heading: float, reach: float) -> Dictionary:
	var ok := func(p: Dictionary) -> bool: return _anchor_ok(p, mode)
	var c: Dictionary = lanes.closest(from.x, from.y, from.z, reach, ok, 4.0)
	if c.is_empty():
		c = lanes.closest(from.x, from.y, from.z, reach, ok)
	if c.is_empty() or mode == "foot" or is_nan(heading) or absf(wrapf(float(c.heading) - heading, -PI, PI)) <= PI / 3.0:
		return c
	# the nearest piece runs the other way (the far side of the road): the nearest one in the vehicle's direction
	var aligned := func(p: Dictionary) -> bool:
		if not _anchor_ok(p, mode):
			return false
		var q: Dictionary = lanes.closest_on(p.id, from.x, from.y, from.z)
		return not q.is_empty() and absf(wrapf(float(q.heading) - heading, -PI, PI)) <= PI / 3.0
	var c2: Dictionary = lanes.closest(from.x, from.y, from.z, reach, aligned)
	return c2 if not c2.is_empty() else c


## Up to `limit` lane pieces the mode may use within `reach` m of `to`, each at its nearest point, nearest first.
func _nearest_allowed(to: Vector3, mode: String, reach: float, limit: int) -> Array:
	var found: Array = []
	for id: String in lanes.near(to.x, to.z, reach):
		var p: Dictionary = lanes.piece(id)
		if not _anchor_ok(p, mode):
			continue
		var c: Dictionary = lanes.closest_on(id, to.x, to.y, to.z)
		if not c.is_empty() and float(c.d) <= reach:
			found.append(c)
	found.sort_custom(func(x: Dictionary, y: Dictionary) -> bool: return float(x.d) < float(y.d) or (float(x.d) == float(y.d) and str(x.id) < str(y.id)))
	return found.slice(0, limit)


func _cost(p: Dictionary, q: Dictionary, mode: String) -> float:
	var len_q := float(q.length)
	if mode == "foot":
		# a walker prefers the streets walkers share over the footpath of a main road, and never minds a turn
		return len_q * (1.0 if "foot" in (q.get("modes", []) as Array) else 1.2)
	var e := _end_dir(p.pts)
	var s := _start_dir(q.pts)
	var turn := 1.0 - (e.x * s.x + e.y * s.y)
	var small := float(SMALL.get(str(q.cls), 1.0))
	if mode == "two_wheeler":
		small = sqrt(small)
	return len_q * small + turn * TURN_COST


## The route's points: from the start point along each piece to the end point, without repeated points. A walker
## may take a piece backwards (it came in from a `next` piece, or leaves by a `back` one).
func _polyline(ids: PackedStringArray, start: Dictionary, end: Dictionary, mode: String) -> PackedVector3Array:
	var out := PackedVector3Array([start.pos])
	var n := ids.size()
	for k in n:
		var p: Dictionary = lanes.piece(ids[k])
		var pts: PackedVector3Array = p.pts
		var fwd := true
		if mode == "foot":
			if k < n - 1:
				fwd = ids[k + 1] in (p.next as Array)
			elif k > 0:
				fwd = not (ids[k - 1] in (p.next as Array))
			else:
				fwd = float(end.t) >= float(start.t)
		var order: Array = []
		if fwd:
			order = range(int(start.i) + 1 if k == 0 else 0, (int(end.i) if k == n - 1 else pts.size() - 1) + 1)
		else:
			order = range(int(start.i) if k == 0 else pts.size() - 1, (int(end.i) + 1 if k == n - 1 else 0) - 1, -1)
		for i: int in order:
			if out[out.size() - 1].distance_to(pts[i]) > 0.05:
				out.append(pts[i])
	if out[out.size() - 1].distance_to(end.pos) > 0.05:
		out.append(end.pos)
	return out


static func _length(pts: PackedVector3Array) -> float:
	var s := 0.0
	for i in range(1, pts.size()):
		s += pts[i - 1].distance_to(pts[i])
	return s


static func _end_dir(pts: PackedVector3Array) -> Vector2:
	var a := pts[maxi(0, pts.size() - 2)]
	var b := pts[pts.size() - 1]
	return Vector2(b.x - a.x, b.z - a.z).normalized()


static func _start_dir(pts: PackedVector3Array) -> Vector2:
	var a := pts[0]
	var b := pts[mini(1, pts.size() - 1)]
	return Vector2(b.x - a.x, b.z - a.z).normalized()


## A binary min-heap of [cost, id] pairs.
static func _push(heap: Array, item: Array) -> void:
	heap.append(item)
	var i := heap.size() - 1
	while i > 0:
		var up := (i - 1) >> 1
		if float(heap[up][0]) <= float(item[0]):
			break
		heap[i] = heap[up]
		i = up
	heap[i] = item


static func _pop(heap: Array) -> Array:
	var top: Array = heap[0]
	var last: Array = heap.pop_back()
	if heap.is_empty():
		return top
	var i := 0
	var n := heap.size()
	while true:
		var l := i * 2 + 1
		if l >= n:
			break
		var c := l
		if l + 1 < n and float(heap[l + 1][0]) < float(heap[l][0]):
			c = l + 1
		if float(heap[c][0]) >= float(last[0]):
			break
		heap[i] = heap[c]
		i = c
	heap[i] = last
	return top
