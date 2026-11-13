## The city checks of the harness (P1-024): the debug hook city(cmd, opts) of docs/GAME_HOOKS.md. A child of the debug
## server, made on its first call. It reads the streamed city and the camera; it moves nothing.
##   pins                     pins of the live tiles [{id, name, kind, x, y, z, tile}] (world metres); a landmark pin
##                            (kind landmark, id lm:<registry id>) also has tier, mode, yaw and height
##   landmarks {at: [x, z], limit}  the landmark file of the tile folder (P2-006): {limits, placed, silhouettes, far:
##                            [{id, pos, bearing, distance, reachable, nav}], heroesAtFullDetail, plan: [{id, tier,
##                            level, distance}]}: the LOD slot each landmark shows from `at` (the camera when left
##                            out), nearest first; level -1 is the far silhouette (game/world/landmark_slots.gd)
##   geo {places: [{id, lat, lon}]}  where the game's projection puts each place: [{id, x, z}] (the world frame of the
##                            loaded tile index: offset + geo_to_world, game/geo/world_frame.gd)
##   screen {points: [[x, y, z]]}  where the current camera draws each world point: {size: [w, h], points: [{x, y,
##                            front}]} (pixels from the top left; front false when the point is behind the camera)
##   mirror                   every node under the scene's World root: a negative scale or a mirrored basis (local or
##                            global), every MultiMesh instance and every streamed collider body (server bodies, no
##                            node) with a mirrored basis: {nodes, instances, bodies, bad}
##   surface {points: [[x, z]]}  for each point a ray down from above everything against the colliders, and the highest
##                            drawn surface there: [{x, z, hit, colliderY, drawn, drawnY, material, gapM}]
##   watch {on}               starts ({on: true}) or stops ({on: false}) a per-tick record of the player against the drawn
##                            surface: each wheel contact (driving) or the feet (on foot, grounded) to the nearest drawn
##                            height there; {} answers the numbers so far
extends Node

const DrawnSurface := preload("res://debug/drawn_surface.gd")
const LandmarkSlots := preload("res://world/landmark_slots.gd")
## A watched point farther than this from every drawn height counts in `over`.
const LIMIT_M := 0.05
## The player is under the drawn surface (fell through) when its feet are this far below the highest drawn surface
## within FALL_UP of them.
const FALL_M := 0.5
const FALL_UP := 3.0

var _ds: RefCounted = null
var _ds_index: RefCounted = null
var _on := false
var _w := {}


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	get_node("/root/SimClock").sim_tick.connect(_tick)


func hook(a: Array) -> Dictionary:
	var city := get_tree().get_first_node_in_group("world_stream")
	var cmd := str(a[0]) if a.size() > 0 else "pins"
	var o: Dictionary = a[1] if a.size() > 1 and a[1] is Dictionary else {}
	if cmd == "mirror":
		return {"ok": true, "result": _mirror(city)}
	if cmd == "screen":
		return _screen(o)
	if city == null:
		return {"ok": false, "error": "city: no streamed city in this scene (the city scene, or --tiles=test|full)"}
	match cmd:
		"pins":
			return {"ok": true, "result": city.live_pins()}
		"landmarks":
			# the landmark file of the tile folder and the LOD plan from a point (the camera when none is given)
			var eye := Vector3.ZERO
			var cam := get_viewport().get_camera_3d()
			if o.get("at") is Array and (o.at as Array).size() >= 2:
				eye = Vector3(float(o.at[0]), 0.0, float(o.at[1]))
			elif cam != null:
				eye = cam.global_position
			var plan: Array = LandmarkSlots.plan(city.index.landmarks, city.index.landmark_limits, eye)
			var far := []
			for f: Dictionary in city.index.far_landmarks:
				far.append({"id": f.id, "pos": f.pos, "bearing": f.bearing, "distance": f.distance, "reachable": f.reachable, "nav": f.nav})
			return {"ok": true, "result": {
				"limits": city.index.landmark_limits, "placed": city.index.landmarks.size(), "silhouettes": city.index.silhouettes.size(), "far": far,
				"heroesAtFullDetail": LandmarkSlots.heroes_at_full_detail(plan), "plan": plan.slice(0, int(o.get("limit", 24))),
			}}
		"geo":
			var out := []
			for p: Variant in o.get("places", []):
				if not (p is Dictionary) or not ((p as Dictionary).get("lat") is float or (p as Dictionary).get("lat") is int):
					return {"ok": false, "error": "city(geo, {places: [{id, lat, lon}]}): every place needs lat and lon"}
				var w: Dictionary = city.frame.geo_to_world(float(p.lat), float(p.lon))
				out.append({"id": str(p.get("id", "")), "x": w.x, "z": w.z})
			return {"ok": true, "result": out}
		"surface":
			var res := []
			var ds := _surface(city)
			for q: Variant in o.get("points", []):
				if not (q is Array) or (q as Array).size() < 2:
					return {"ok": false, "error": "city(surface, {points: [[x, z]]}): every point is [x, z] in world metres"}
				var x := float(q[0])
				var z := float(q[1])
				var ray: Dictionary = city.ground_at(x, z)
				var top: Dictionary = ds.top(x, z)
				var drawn := not top.is_empty()
				res.append({
					"x": x, "z": z, "hit": ray.hit, "colliderY": ray.y, "drawn": drawn, "drawnY": top.get("y", 0.0),
					"material": top.get("material", ""), "gapM": absf(float(ray.y) - float(top.y)) if ray.hit and drawn else -1.0,
				})
			return {"ok": true, "result": res}
		"watch":
			if o.has("on"):
				if bool(o.on):
					_on = true
					_w = {"ticks": 0, "samples": 0, "over": 0, "maxGapM": 0.0, "worst": {}, "undrawn": 0, "airTicks": 0, "fallTicks": 0,
						"fall": {}, "foot": 0, "vehicle": 0}
					_surface(city)
					return {"ok": true, "result": {"watching": true}}
				_on = false
			var out := _w.duplicate(true)
			out["readMs"] = _ds.read_ms if _ds != null else 0.0
			return {"ok": true, "result": out}
	return {"ok": false, "error": "city(cmd, opts): unknown cmd '%s' (pins, geo, screen, mirror, surface, watch)" % cmd}


func _surface(city: Node) -> RefCounted:
	if _ds == null or _ds_index != city.index:
		_ds = DrawnSurface.new(city.index)
		_ds_index = city.index
	return _ds


func _tick(_dt: float) -> void:
	if not _on:
		return
	var city := get_tree().get_first_node_in_group("world_stream")
	var p := get_tree().get_first_node_in_group("player") as Node3D
	if city == null or p == null or _ds == null:
		return
	_w.ticks += 1
	var points := PackedVector3Array()
	var feet: Vector3
	if p.has_method("wheel_contacts"):
		_w.vehicle += 1
		points = p.wheel_contacts()
		feet = p.foot_position()
		if points.is_empty():
			_w.airTicks += 1
	else:
		_w.foot += 1
		feet = p.global_position
		if p.has_method("is_grounded") and p.is_grounded():
			points.append(feet)
		else:
			_w.airTicks += 1
	for q in points:
		var n: Dictionary = _ds.nearest(q.x, q.z, q.y)
		_w.samples += 1
		if n.is_empty():
			_w.undrawn += 1
			continue
		if float(n.gap) > LIMIT_M:
			_w.over += 1
		if float(n.gap) > float(_w.maxGapM):
			_w.maxGapM = float(n.gap)
			_w.worst = {"x": q.x, "y": q.y, "z": q.z, "drawnY": n.y, "material": n.material, "tick": _w.ticks}
	var top: Dictionary = _ds.top(feet.x, feet.z, feet.y + FALL_UP)
	if not top.is_empty() and feet.y < float(top.y) - FALL_M:
		_w.fallTicks += 1
		if _w.fall.is_empty():
			_w.fall = {"x": feet.x, "y": feet.y, "z": feet.z, "drawnY": top.y, "tick": _w.ticks}


func _screen(o: Dictionary) -> Dictionary:
	var cam := get_viewport().get_camera_3d()
	if cam == null:
		return {"ok": false, "error": "city(screen): no camera"}
	var size := get_viewport().get_visible_rect().size
	var out := []
	for q: Variant in o.get("points", []):
		if not (q is Array) or (q as Array).size() != 3:
			return {"ok": false, "error": "city(screen, {points: [[x, y, z]]}): every point is [x, y, z] in world metres"}
		var w := Vector3(float(q[0]), float(q[1]), float(q[2]))
		var s := cam.unproject_position(w)
		out.append({"x": s.x, "y": s.y, "front": not cam.is_position_behind(w)})
	return {"ok": true, "result": {"size": [size.x, size.y], "points": out}}


func _mirror(city: Node) -> Dictionary:
	var scene := get_tree().current_scene
	var world := scene.get_node_or_null("World") if scene != null else null
	var out := {"nodes": 0, "instances": 0, "bodies": 0, "bad": []}
	if city != null:
		# the tile colliders are PhysicsServer3D bodies with no node (colliders.gd): read their transforms from the server
		for key: Vector2i in city.core.tiles:
			var parts: Variant = city.core.tiles[key].get("parts")
			if not (parts is Dictionary) or not (parts as Dictionary).has("colliders"):
				continue
			for body: RID in parts.colliders.get("bodies", []):
				out.bodies += 1
				var xf: Transform3D = PhysicsServer3D.body_get_state(body, PhysicsServer3D.BODY_STATE_TRANSFORM)
				if xf.basis.determinant() < 0.0 and (out.bad as Array).size() < 20:
					(out.bad as Array).append("collider body of tile %d_%d: mirrored basis" % [key.x, key.y])
	if world == null:
		out["error"] = "no World node in the scene"
		return out
	var stack: Array[Node] = [world]
	while not stack.is_empty():
		var n: Node = stack.pop_back()
		for c in n.get_children():
			stack.append(c)
		var n3 := n as Node3D
		if n3 == null:
			continue
		out.nodes += 1
		var s := n3.scale
		var why := ""
		if s.x < 0.0 or s.y < 0.0 or s.z < 0.0:
			why = "negative scale %s" % s
		elif n3.transform.basis.determinant() < 0.0:
			why = "mirrored local basis"
		elif n3.is_inside_tree() and n3.global_transform.basis.determinant() < 0.0:
			why = "mirrored global basis"
		var mmi := n3 as MultiMeshInstance3D
		if why == "" and mmi != null and mmi.multimesh != null and mmi.multimesh.transform_format == MultiMesh.TRANSFORM_3D:
			var mm := mmi.multimesh
			var count := mm.visible_instance_count if mm.visible_instance_count >= 0 else mm.instance_count
			for i in count:
				out.instances += 1
				if mm.get_instance_transform(i).basis.determinant() < 0.0:
					why = "MultiMesh instance %d mirrored" % i
					break
		if why != "" and (out.bad as Array).size() < 20:
			(out.bad as Array).append("%s: %s" % [world.get_path_to(n3), why])
		elif why != "":
			out["more"] = int(out.get("more", 0)) + 1
	return out
