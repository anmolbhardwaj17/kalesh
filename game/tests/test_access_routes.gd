## Traffic, the route line and the access watch keep to the access modes (P2-045, the access model of P2-042), tested
## over the pilot lane graph (the baked tiles of game/world/tiles round Chandni Chowk; skipped with a note when the
## folder has not been baked): traffic never spawns or turns a car or an auto onto a piece its mode may not use and a
## scooter rides the two-wheeler galis; a car route into a car-free street ends at the nearest point a car may reach,
## on foot the same request walks in; a car driven into a gali raises one access_violation.
extends RefCounted

const TileIndex := preload("res://world/streaming/tile_index.gd")
const TileReader := preload("res://world/streaming/tile_reader.gd")
const Lanes := preload("res://world/systems/lanes.gd")
const LaneRouter := preload("res://ai/lane_router.gd")
const Traffic := preload("res://ai/traffic.gd")
const AccessWatch := preload("res://world/access_watch.gd")
const Tune := preload("res://vehicles/vehicle_tune.gd")
const PILOT := "res://world/tiles/"
## Chandni Chowk main road (car-free in the day, P2-042), halfway along; the old city south of it.
const CC_MAIN := Vector3(1100.0, 221.0, -4316.0)
## The middle of the area loaded for these tests, and its half size (tiles whose centre lies inside load).
const AREA := Vector3(950.0, 0.0, -4300.0)
const AREA_HALF := 520.0

var t
var tree: SceneTree


## A stand-in player vehicle: the access watch reads foot_position() and the tune's id.
class FakeVehicle:
	extends Node3D
	var tune: Resource
	var at := Vector3.ZERO

	func foot_position() -> Vector3:
		return at


## The lanes system holding every piece of the pilot tiles round AREA, or null when the folder is missing.
func _pilot_lanes() -> RefCounted:
	var index: RefCounted = TileIndex.open(PILOT)
	if index.error != "":
		return null
	var lanes: RefCounted = Lanes.new()
	for key: Vector2i in index.tiles:
		var c := Vector2((key.x + 0.5) * index.size, (key.y + 0.5) * index.size)
		if absf(c.x - AREA.x) > AREA_HALF or absf(c.y - AREA.z) > AREA_HALF:
			continue
		var tile: Dictionary = TileReader.read(index.path(key))
		if tile.ok:
			lanes.attach(tile, lanes.prepare(tile))
	return lanes


static var _cache: RefCounted = null


func _lanes() -> RefCounted:
	if _cache == null:
		_cache = _pilot_lanes()
	if _cache == null:
		print("    note: no baked pilot tiles in %s, the pilot lane graph checks are skipped" % PILOT)
	return _cache


func test_the_lane_grid_finds_pieces_near_a_point() -> void:
	var lanes := _lanes()
	if lanes == null:
		return
	var c: Dictionary = lanes.closest(CC_MAIN.x, CC_MAIN.y, CC_MAIN.z, 20.0)
	var brute := INF
	for id: String in lanes.pieces:
		for q: Vector3 in lanes.pieces[id].pts:
			brute = minf(brute, Vector2(q.x - CC_MAIN.x, q.z - CC_MAIN.z).length())
	t.ok(not c.is_empty() and float(c.d) <= brute + 1e-3, "closest() finds a piece at least as near as the nearest lane point (%.2f m, points %.2f m)" % [float(c.get("d", -1.0)), brute])
	t.ok(not ("car" in (lanes.piece(c.id).modes as Array)), "the piece on Chandni Chowk main road is closed to cars (%s)" % [lanes.piece(c.id).modes])


func test_traffic_keeps_cars_and_autos_off_car_free_pieces() -> void:
	var lanes := _lanes()
	if lanes == null:
		return
	var traffic: Node3D = Traffic.new()
	tree.root.add_child(traffic)
	traffic.setup(lanes)
	var started: Dictionary = traffic.start({"count": 45, "radius": 420.0, "at": [AREA.x, AREA.z], "seed": 11,
		"mix": {"car": 1.0, "auto": 1.0, "two_wheeler": 1.0}})
	t.ok(int(started.count) == 45, "45 agents put down round Chandni Chowk (%d)" % int(started.count))
	for a: Dictionary in started.agents:
		t.ok(LaneRouter.usable(lanes.piece(a.piece), a.mode), "agent %d (%s) starts on a piece its mode may use" % [a.id, a.mode])
	for k in 900:
		traffic._tick(0.1)
	var au: Dictionary = traffic.audit
	t.ok(int(au.checks) == 900 * 45 and int(au.bad) == 0, "90 s of sim: no agent tick on a piece its mode may not use (%d of %d; %s)" % [int(au.bad), int(au.checks), au.badList])
	t.ok(int(au.closedToCars.get("car", 0)) == 0 and int(au.closedToCars.get("auto", 0)) == 0, "no car or auto entered a piece closed to cars (%s)" % [au.closedToCars])
	t.ok(int(au.closedToCars.get("two_wheeler", 0)) > 0, "scooters rode two-wheeler galis (%d entries)" % int(au.closedToCars.get("two_wheeler", 0)))
	t.ok(int(au.entries.get("car", 0)) > 40 and int(au.entries.get("auto", 0)) > 40, "cars and autos moved on through the graph (%s)" % [au.entries])
	traffic.stop()
	traffic.free()


func test_a_car_route_into_a_car_free_street_ends_at_the_nearest_open_point() -> void:
	var lanes := _lanes()
	if lanes == null:
		return
	var router: RefCounted = LaneRouter.new(lanes)
	var from := _open_point(lanes, Vector3(1134.0, 220.0, -4180.0), "car")
	t.ok(not from.is_empty(), "an open lane south of Chandni Chowk to start from")
	if from.is_empty():
		return
	var car: Dictionary = router.route_to(from.pos, CC_MAIN, "car")
	t.ok(car.ok and car.clipped and not ("car" in (car.targetModes as Array)), "the car route is found and ends short of the car-free target piece (%s)" % car.reason)
	var all_ok := true
	for id: String in car.ids:
		all_ok = all_ok and LaneRouter.usable(lanes.piece(id), "car")
	t.ok(all_ok and (car.ids as PackedStringArray).size() > 1, "every piece of the car route is open to cars (%d pieces)" % (car.ids as PackedStringArray).size())
	var nearest := _nearest_reachable_d(lanes, router, from, CC_MAIN, "car")
	var end_d := Vector2(car.end.x - CC_MAIN.x, car.end.z - CC_MAIN.z).length()
	t.ok(absf(end_d - nearest) < 0.5, "it ends at the nearest point a car may reach (%.1f m from the target; nearest reachable %.1f m)" % [end_d, nearest])
	var walk: Dictionary = router.route_to(from.pos, CC_MAIN, "foot")
	var closed := 0
	for id: String in walk.ids:
		closed += 0 if "car" in (lanes.piece(id).modes as Array) else 1
	t.ok(walk.ok and not walk.clipped and walk.endPiece == walk.targetPiece and closed > 0, "on foot the same request walks into the car-free street (%d car-free pieces, %.0f m)" % [closed, float(walk.lengthM)])
	var auto: Dictionary = router.route_to(from.pos, CC_MAIN, "auto")
	t.ok(auto.ok and auto.clipped, "an auto route ends short too")


func test_a_scooter_route_takes_a_two_wheeler_gali() -> void:
	var lanes := _lanes()
	if lanes == null:
		return
	var router: RefCounted = LaneRouter.new(lanes)
	# a gali closed to cars that scooters may ride, some way from Chandni Chowk main road
	var gali := {}
	for id: String in lanes.near(AREA.x - 250.0, AREA.z, 200.0):
		var p: Dictionary = lanes.piece(id)
		var m: Array = p.modes
		if str(p.kind) == "lane" and "two_wheeler" in m and not ("car" in m) and float(p.length) > 20.0 and (gali.is_empty() or str(id) < str(gali.id)):
			gali = p
	t.ok(not gali.is_empty(), "a two-wheeler gali west of the test area")
	if gali.is_empty():
		return
	var mid: Vector3 = (gali.pts as PackedVector3Array)[(gali.pts as PackedVector3Array).size() / 2]
	var from := _open_point(lanes, mid, "car", 260.0)
	var r: Dictionary = router.route_to(from.pos, mid, "two_wheeler")
	t.ok(r.ok and not r.clipped and r.endPiece == gali.id, "the scooter route reaches the gali (%s)" % r.reason)
	var c: Dictionary = router.route_to(from.pos, mid, "car")
	t.ok(not c.ok or c.clipped, "a car route to the same point stops short")


func test_driving_into_a_gali_raises_one_access_violation() -> void:
	var lanes := _lanes()
	if lanes == null:
		return
	var watch: Node = AccessWatch.new()
	watch.setup(lanes, PILOT)
	tree.root.add_child(watch)
	var car := FakeVehicle.new()
	car.tune = Tune.new()
	car.tune.id = "car"
	car.add_to_group("player")
	tree.root.add_child(car)
	var ev := tree.root.get_node("GameEvents")
	var seq0: int = ev.seq
	# a car-free piece on Chandni Chowk main road and an open piece south of it
	var closed: Dictionary = lanes.closest(CC_MAIN.x, CC_MAIN.y, CC_MAIN.z, 20.0, func(p: Dictionary) -> bool: return str(p.kind) == "lane" and not ("car" in (p.modes as Array)))
	var open := _open_point(lanes, Vector3(1134.0, 220.0, -4180.0), "car")
	var steps := [[open.pos, 5], [closed.pos, 30], [open.pos, 5], [closed.pos, 10], [open.pos, 30], [closed.pos, 2], [open.pos, 30], [closed.pos, 10]]
	for s: Array in steps:
		car.at = s[0]
		for k in int(s[1]):
			watch.check()
	var got: Array = []
	for e: Dictionary in ev.since(seq0):
		if e.type == "access_violation":
			got.append(e.data)
	t.ok(got.size() == 2, "two entries 2 s apart raise two events, a 0.2 s touch and a re-entry within 2 s none (%d)" % got.size())
	if not got.is_empty():
		var d: Dictionary = got[0]
		t.ok(d.piece == closed.id and d.mode == "car" and (d.pos as Array).size() == 3 and not ("car" in (d.modes as Array)), "the event names the piece, the mode and the position (%s)" % [d])
	car.tune.id = "scooter"
	watch.inside = false
	car.at = closed.pos
	for k in 10:
		watch.check()
	# Chandni Chowk main road is walkers, cycle rickshaws and emergency vehicles only: a scooter there is a violation
	# too; on a two-wheeler gali it would not be
	var scooter_ok := "two_wheeler" in (lanes.piece(closed.id).modes as Array)
	t.ok(watch.violations == (2 if scooter_ok else 3) and watch.last.mode == ("car" if scooter_ok else "two_wheeler"), "a scooter is held to its own mode (%d violations)" % watch.violations)
	car.free()
	watch.free()


## The nearest point of an open lane piece (for `mode`) to `at` within `reach` m: closest() with the mode's filter.
func _open_point(lanes: RefCounted, at: Vector3, mode: String, reach := 120.0) -> Dictionary:
	return lanes.closest(at.x, at.y, at.z, reach, func(p: Dictionary) -> bool: return str(p.kind) == "lane" and LaneRouter.usable(p, mode))


## By brute force: the plan distance from `to` to the nearest point of a lane piece the mode may use that a route
## from `from` reaches (tried nearest first).
func _nearest_reachable_d(lanes: RefCounted, router: RefCounted, from: Dictionary, to: Vector3, mode: String) -> float:
	var cands: Array = []
	for id: String in lanes.pieces:
		var p: Dictionary = lanes.pieces[id]
		if str(p.kind) != "lane" or not LaneRouter.usable(p, mode):
			continue
		var c: Dictionary = lanes.closest_on(id, to.x, to.y, to.z)
		if not c.is_empty():
			cands.append(c)
	cands.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return float(a.d) < float(b.d))
	for c: Dictionary in cands:
		if not router.search(from.id, c.id, mode).is_empty():
			return float(c.d)
	return INF
