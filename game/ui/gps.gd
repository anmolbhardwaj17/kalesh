## The route line (GPS, P2-045; HUD.md "Route guidance"): a route from the player to a target on the lane graph of
## the loaded tiles for the mode the player moves in now (game/ai/lane_router.gd): a car or an auto keeps to the
## pieces its mode may use and a route into a car-free street ends at the nearest point it may reach; a scooter may
## take a two-wheeler gali; on foot the route walks car-free streets and the footpaths of main roads, either way.
## It routes again when the player changes mode (gets out, gets in), strays STRAY_M off the line, or every
## REROUTE_S. Drawn as the road ribbon stand-in: marigold chevrons on the lane to take, from 8 m to 200 m ahead,
## fading at both ends (the full ribbon with scrolling chevrons, the minimap line and the turn card are HUD work).
## Nothing is drawn while no target is set (missions set it later; the debug hook gps() now). Steps on the sim tick.
extends Node3D

const LaneRouter := preload("res://ai/lane_router.gd")
## Sim seconds between checks of the player against the route.
const CHECK_S := 0.25
## Off the line by more than this (in plan), the route is found again.
const STRAY_M := 20.0
const REROUTE_S := 5.0
## The ribbon: chevrons every STEP_M from AHEAD_M to RANGE_M ahead of the player, HUD.md objective marigold.
const AHEAD_M := 8.0
const RANGE_M := 200.0
const STEP_M := 6.0
const LIFT_M := 0.06
const COLOR := Color("#ffb224")

var lanes: RefCounted
var router: RefCounted
var target := Vector3.INF
## The current route (LaneRouter.route_to), {} without a target.
var route := {}
var mode := ""
var reroutes := 0
var _acc := 0.0
var _since := 0.0
## Metres along the route to the point nearest the player (set by _off_route).
var _along := 0.0
var _ribbon: MeshInstance3D
var _mat: StandardMaterial3D


func setup(lanes_system: RefCounted) -> void:
	lanes = lanes_system
	router = LaneRouter.new(lanes)


func _ready() -> void:
	_ribbon = MeshInstance3D.new()
	_ribbon.name = "RouteRibbon"
	_ribbon.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_ribbon)
	_mat = StandardMaterial3D.new()
	_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_mat.vertex_color_use_as_albedo = true
	_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	_mat.albedo_color = Color.WHITE
	var clock := get_node_or_null("/root/SimClock")
	if clock != null:
		clock.sim_tick.connect(_tick)


## Sets the target (world metres) and routes to it now. Answers info().
func set_target(to: Vector3) -> Dictionary:
	target = to
	_reroute()
	return info()


func clear() -> void:
	target = Vector3.INF
	route = {}
	_ribbon.mesh = null


## A route for `mode` between two points without setting anything (the debug hook's `plan`).
func plan(from: Vector3, to: Vector3, for_mode: String, heading := NAN) -> Dictionary:
	return _public(router.route_to(from, to, for_mode, heading))


## {on, target, mode, reroutes, route: {ok, mode, pieces, lengthM, clipped, end, endPiece, targetPiece, targetModes,
## allUsable, closedToCars, reason, points}}
func info() -> Dictionary:
	return {"on": target != Vector3.INF, "target": null if target == Vector3.INF else [target.x, target.y, target.z],
		"mode": mode, "reroutes": reroutes, "route": _public(route) if not route.is_empty() else null}


func _public(r: Dictionary) -> Dictionary:
	var pts := []
	for q: Vector3 in r.points:
		pts.append([snappedf(q.x, 0.01), snappedf(q.y, 0.01), snappedf(q.z, 0.01)])
	var all_ok := true
	var closed := 0
	for id: String in r.ids:
		var p: Dictionary = lanes.piece(id)
		all_ok = all_ok and LaneRouter.usable(p, r.mode)
		closed += 0 if "car" in (p.get("modes", []) as Array) else 1
	var e: Vector3 = r.end
	return {"ok": r.ok, "mode": r.mode, "pieces": Array(r.ids), "lengthM": r.lengthM, "clipped": r.clipped,
		"end": [e.x, e.y, e.z], "endPiece": r.endPiece, "targetPiece": r.targetPiece, "targetModes": r.targetModes,
		"allUsable": all_ok, "closedToCars": closed, "reason": r.reason, "points": pts}


func _tick(dt: float) -> void:
	if target == Vector3.INF or lanes == null:
		return
	_acc += dt
	_since += dt
	if _acc + 1e-6 < CHECK_S:
		return
	_acc = 0.0
	var p := get_tree().get_first_node_in_group("player") as Node3D
	if p == null:
		return
	var m := LaneRouter.mode_of_player(p)
	if m != mode or route.is_empty() or not route.ok or _since >= REROUTE_S or _off_route(_player_pos(p)) > STRAY_M:
		_reroute()
	else:
		_draw(_player_pos(p))


func _reroute() -> void:
	var p := get_tree().get_first_node_in_group("player") as Node3D
	if p == null or target == Vector3.INF:
		return
	mode = LaneRouter.mode_of_player(p)
	var heading: float = float(p.get("heading")) if mode != "foot" and "heading" in p else NAN
	route = router.route_to(_player_pos(p), target, mode, heading)
	reroutes += 1
	_since = 0.0
	_draw(_player_pos(p))


static func _player_pos(p: Node3D) -> Vector3:
	return p.foot_position() if p.has_method("foot_position") else p.global_position


## The plan distance from `at` to the route line; the distance along the line to that point goes in `_along`.
func _off_route(at: Vector3) -> float:
	var pts: PackedVector3Array = route.get("points", PackedVector3Array())
	var best := INF
	var run := 0.0
	_along = 0.0
	var a2 := Vector2(at.x, at.z)
	for i in pts.size() - 1:
		var a := Vector2(pts[i].x, pts[i].z)
		var ab := Vector2(pts[i + 1].x, pts[i + 1].z) - a
		var l2 := ab.length_squared()
		var seg := sqrt(l2)
		var f := clampf((a2 - a).dot(ab) / l2, 0.0, 1.0) if l2 > 1e-6 else 0.0
		var d := a2.distance_to(a + ab * f)
		if d < best:
			best = d
			_along = run + seg * f
		run += seg
	return best


## The ribbon stand-in: one chevron (two quads in a V pointing along the route) every STEP_M.
func _draw(at: Vector3) -> void:
	var pts: PackedVector3Array = route.get("points", PackedVector3Array())
	if pts.size() < 2:
		_ribbon.mesh = null
		return
	_off_route(at)
	var verts := PackedVector3Array()
	var cols := PackedColorArray()
	var run := 0.0
	var next_d := _along + AHEAD_M
	var end_d := _along + RANGE_M
	for i in pts.size() - 1:
		var seg := pts[i].distance_to(pts[i + 1])
		if seg < 1e-4:
			continue
		var dir := (pts[i + 1] - pts[i]) / seg
		while next_d <= run + seg and next_d <= end_d:
			var q := pts[i].lerp(pts[i + 1], (next_d - run) / seg)
			var fade := clampf((next_d - _along - AHEAD_M + 4.0) / 12.0, 0.0, 1.0) * clampf((end_d - next_d) / 60.0, 0.0, 1.0)
			_chevron(verts, cols, q + Vector3.UP * LIFT_M, dir, Color(COLOR, 0.92 * fade))
			next_d += STEP_M
		run += seg
		if next_d > end_d:
			break
	if verts.is_empty():
		_ribbon.mesh = null
		return
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_COLOR] = cols
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	mesh.surface_set_material(0, _mat)
	_ribbon.mesh = mesh


static func _chevron(verts: PackedVector3Array, cols: PackedColorArray, c: Vector3, dir: Vector3, col: Color) -> void:
	var f := Vector3(dir.x, 0.0, dir.z).normalized()
	var r := Vector3(-f.z, 0.0, f.x)
	var rise := Vector3(0.0, dir.y, 0.0)
	var half_w := 1.05
	var back := 1.25
	var thick := 0.6
	# the two arms of the V: tip at c, ends back and to each side, each arm `thick` long along the route
	for side: float in [-1.0, 1.0]:
		var tip := c
		var tip2 := c - f * thick
		var end := c - f * back + r * side * half_w + rise * -back
		var end2 := end - f * thick
		for q: Vector3 in [tip, end, end2, tip, end2, tip2]:
			verts.append(q)
			cols.append(col)
