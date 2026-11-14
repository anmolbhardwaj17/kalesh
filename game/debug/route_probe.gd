## The debug hooks traffic(cmd, opts) and gps(cmd, opts) of docs/GAME_HOOKS.md (P2-045): they drive the traffic
## stand-in (game/ai/traffic.gd) and the route line (game/ui/gps.gd) of the streamed city the way a mission would
## (start traffic, set a target); they never move the player. A child of the debug server, made on first use.
##   traffic start {count, radius, at: [x, z], mix: {car, auto, two_wheeler}, seed} | stop | info
##   gps set {to: [x, y, z] or [x, z]} | clear | info | plan {from: [x, y, z], to: [x, y, z], mode, heading}
extends Node


func hook(method: String, a: Array) -> Dictionary:
	var city := get_tree().get_first_node_in_group("world_stream")
	if city == null or not city.booted:
		return {"ok": false, "error": "%s: no streamed city ready in this scene" % method}
	var cmd := str(a[0]) if a.size() > 0 else "info"
	var o: Dictionary = a[1] if a.size() > 1 and a[1] is Dictionary else {}
	if method == "traffic":
		match cmd:
			"start":
				return {"ok": true, "result": city.traffic.start(o)}
			"stop":
				city.traffic.stop()
				return {"ok": true, "result": city.traffic.info()}
			"info":
				return {"ok": true, "result": city.traffic.info()}
		return {"ok": false, "error": "traffic(cmd): unknown cmd %s (start, stop, info)" % cmd}
	match cmd:
		"set":
			var to: Variant = _vec(o.get("to"))
			if to == null:
				return {"ok": false, "error": "gps('set', {to}): to must be [x, z] or [x, y, z]"}
			return {"ok": true, "result": city.gps.set_target(to)}
		"clear":
			city.gps.clear()
			return {"ok": true, "result": city.gps.info()}
		"info":
			return {"ok": true, "result": city.gps.info()}
		"plan":
			var from: Variant = _vec(o.get("from"))
			var to2: Variant = _vec(o.get("to"))
			var mode := str(o.get("mode", "car"))
			if from == null or to2 == null or not mode in ["car", "auto", "two_wheeler", "cycle", "foot", "emergency"]:
				return {"ok": false, "error": "gps('plan', {from, to, mode}): from and to are points, mode an access mode"}
			var h := float(o.heading) if o.get("heading") is float or o.get("heading") is int else NAN
			return {"ok": true, "result": city.gps.plan(from, to2, mode, h)}
	return {"ok": false, "error": "gps(cmd): unknown cmd %s (set, clear, info, plan)" % cmd}


## [x, z] (y from the ground there is not needed: the route reads the lane height) or [x, y, z] as a Vector3; null
## when it is neither.
static func _vec(v: Variant) -> Variant:
	if not (v is Array):
		return null
	var arr: Array = v
	for e: Variant in arr:
		if not (e is float or e is int):
			return null
	if arr.size() == 2:
		return Vector3(float(arr[0]), 0.0, float(arr[1]))
	if arr.size() == 3:
		return Vector3(float(arr[0]), float(arr[1]), float(arr[2]))
	return null
