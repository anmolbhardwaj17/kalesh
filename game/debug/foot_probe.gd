## Debug probes of the on-foot player for the harness: the hook foot(cmd, opts) of docs/GAME_HOOKS.md (P1-022). A child
## of the debug server, made on its first call. The feel probes press the InputMap actions (Input.action_press, the way
## a player's keys do) and measure in sim ticks; staging puts the character on foot like teleport does. They run in the
## course scene (scene id `course`, game/scenes/course/), whose PlayerMode owns the character.
##   info                    mode, the character (pos, heading, speed, gait, stamina, state), the camera (which one is
##                           current, distance to the head, lift), the last enter or exit, overlap with the world
##   stage {x, z, h}         on foot at x, z facing compass heading h, the camera behind, stamina full (staging only)
##   run {test, ...}         one feel probe (foot_routes.gd): speeds, stamina, jump, vault, turn, kerbs
##   camrec {on}             records every drawn frame: camera distance to the head, camera inside geometry, the player
##                           hidden (every ray from the camera to the head, chest and hips blocked by a wall that is not
##                           faded), the head out of the frame; {on: false} stops and answers the numbers
##   cost {n}                n more characters walk on the pad: cost per character per tick (median physics iteration
##                           with them less without, over n; windowed at time scale 4)
extends Node

const Routes := preload("res://debug/foot_routes.gd")
const OnFoot := preload("res://characters/on_foot.gd")
const ACTIONS := ["move_forward", "move_back", "move_left", "move_right", "walk", "sprint", "crouch", "jump", "enter_exit",
	"look_left", "look_right", "look_up", "look_down"]

var _rec := false
var _rec_out := {}
var _sphere := PhysicsShapeQueryParameters3D.new()
var _ray := PhysicsRayQueryParameters3D.new()


func _ready() -> void:
	var s := SphereShape3D.new()
	s.radius = 0.1
	_sphere.shape = s
	_sphere.collision_mask = 3
	_ray.collision_mask = 3


func hook(a: Array) -> Dictionary:
	var cmd: String = a[0] if a.size() > 0 and a[0] is String else "info"
	var o: Dictionary = a[1] if a.size() > 1 and a[1] is Dictionary else {}
	var pm := mode_node()
	if pm == null or pm.character == null:
		return {"ok": false, "error": "foot(%s): no PlayerMode with a character in this scene (load('course'))" % cmd}
	match cmd:
		"info":
			return {"ok": true, "result": info()}
		"stage":
			await stage(float(o.get("x", -290.0)), float(o.get("z", 40.0)), deg_to_rad(float(o.get("h", 0.0))))
			return {"ok": true, "result": info()}
		"run":
			var res: Dictionary = await Routes.run(self, str(o.get("test", "")), o)
			release()
			if res.has("error"):
				return {"ok": false, "error": "foot(run): %s" % res.error}
			return {"ok": true, "result": res}
		"camrec":
			if bool(o.get("on", false)):
				_rec = true
				_rec_out = {"frames": 0, "footFrames": 0, "minHeadM": 1e9, "insideFrames": 0, "hiddenFrames": 0, "outOfFrame": 0,
					"fadedFrames": 0, "liftedFrames": 0, "maxLift": 0.0, "worst": []}
				return {"ok": true, "result": {"recording": true}}
			_rec = false
			return {"ok": true, "result": _rec_out}
		"cost":
			return {"ok": true, "result": await _cost(int(o.get("n", 16)))}
	return {"ok": false, "error": "foot(cmd): unknown cmd %s (info, stage, run, camrec, cost)" % cmd}


func mode_node() -> Node:
	return get_tree().get_first_node_in_group("player_mode")


func character() -> CharacterBody3D:
	var pm := mode_node()
	return pm.character if pm != null else null


func info() -> Dictionary:
	var pm := mode_node()
	var c := character()
	var out: Dictionary = c.info()
	out["mode"] = pm.mode
	out["lastSwitch"] = pm.last_switch
	out["overlap"] = overlap(c)
	var cam := get_viewport().get_camera_3d()
	var which := "other"
	if cam == pm.foot_camera:
		which = "foot"
	elif cam == pm.chase_camera:
		which = "chase"
	var fc: Camera3D = pm.foot_camera
	out["camera"] = {"current": which, "fov": cam.fov if cam != null else null,
		"headDistM": snappedf(fc.global_position.distance_to(c.head_position()), 0.001), "lift": snappedf(fc.lift, 0.001),
		"shoulderK": snappedf(fc.shoulder_k, 0.001), "freeM": snappedf(fc.free_m, 0.001), "yaw": fc.yaw, "pitch": fc.pitch}
	return out


## True when the character's capsule (1 cm thinner) touches the world or a vehicle: a stuck or sunk body.
func overlap(c: CharacterBody3D) -> bool:
	if c.state == "seated":
		return false
	var q := PhysicsShapeQueryParameters3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = OnFoot.RADIUS - 0.01
	cap.height = OnFoot.HEIGHT - 0.04
	q.shape = cap
	q.collision_mask = 3
	q.exclude = [c.get_rid()]
	q.transform = Transform3D(Basis.IDENTITY, c.global_position + Vector3.UP * (OnFoot.HEIGHT * 0.5 + 0.02))
	return not c.get_world_3d().direct_space_state.intersect_shape(q, 1).is_empty()


## Staging: on foot at x, z facing h (radians), at rest, stamina full, the camera behind, then a few ticks to settle.
func stage(x: float, z: float, h: float) -> void:
	release()
	var pm := mode_node()
	pm.put_on_foot(x, z, h)
	var c := character()
	if c.motor.crouched:
		c._set_crouch(false)
	c.motor.stamina = 1.0
	c.motor.exhausted = false
	c.motor.sprint_ticks = 0
	await ticks(6)


func clock() -> Node:
	return get_node("/root/SimClock")


func tick() -> void:
	await clock().sim_tick


func ticks(n: int) -> void:
	for i in n:
		await clock().sim_tick


## A key or stick through the InputMap action, the way a player presses it.
func press(action: String, s: float) -> void:
	if s > 0.0:
		Input.action_press(action, clampf(s, 0.0, 1.0))
	else:
		Input.action_release(action)


func release() -> void:
	for a: String in ACTIONS:
		Input.action_release(a)


## n puppets (not the player) walk circles on the pad beside the course: the script time per character and the
## physics iteration time per character (the whole iteration with them, less without, over n).
func _cost(count: int) -> Dictionary:
	await stage(-290.0, 120.0, 0.0)
	var base := await _physics_ms(240)
	var world := character().get_parent()
	var list: Array[CharacterBody3D] = []
	for i in count:
		var c := OnFoot.new()
		c.is_player = false
		c.name = "CostWalker%d" % i
		world.add_child(c)
		c.place(-292.0 + 2.0 * (i % 8), 110.0 - 3.0 * int(i / 8), 0.0)
		list.append(c)
	await ticks(30)
	for i in count:
		var c := list[i]
		c.controls(Vector3(sin(i * 0.7), 0.0, -cos(i * 0.7)), false)
		c.cpu_us = 0
		c.cpu_ticks = 0
	await ticks(30)
	var with := await _physics_ms(240)
	var us := 0.0
	for c in list:
		us += float(c.cpu_us) / maxf(1.0, c.cpu_ticks)
		c.queue_free()
	await tick()
	var per := (with - base) / maxf(1, count)
	var script := us / maxf(1, count) / 1000.0
	print("foot cost: %d characters, %.4f ms per character per tick (physics frame %.3f ms with them, %.3f ms without), script %.4f ms" % [count, per, with, base, script])
	return {"characters": count, "msPerCharacter": snappedf(per, 0.0001), "scriptMsPerCharacter": snappedf(script, 0.0001),
		"physicsFrameMs": snappedf(with, 0.001), "physicsFrameBaseMs": snappedf(base, 0.001)}


## Median time of one whole physics iteration: the gap between two physics frame starts inside one drawn frame (needs
## 2 or more ticks a frame: time scale 4 in a window).
func _physics_ms(n: int) -> float:
	var gaps := PackedFloat64Array()
	var last_us := 0
	var last_frame := -1
	var guard := 0
	while gaps.size() < n and guard < n * 20:
		await get_tree().physics_frame
		guard += 1
		var now := Time.get_ticks_usec()
		var f := Engine.get_process_frames()
		if f == last_frame:
			gaps.append((now - last_us) / 1000.0)
		last_us = now
		last_frame = f
	if gaps.is_empty():
		return NAN
	gaps.sort()
	return gaps[gaps.size() / 2]


func _process(_delta: float) -> void:
	if not _rec:
		return
	var pm := mode_node()
	if pm == null:
		return
	_rec_out.frames += 1
	var cam := get_viewport().get_camera_3d()
	var c := character()
	if cam == null or cam != pm.foot_camera or c == null or c.state == "seated":
		return
	_rec_out.footFrames += 1
	var space := cam.get_world_3d().direct_space_state
	var cp := cam.global_position
	var head: Vector3 = c.head_position()
	var d := cp.distance_to(head)
	_rec_out.minHeadM = minf(_rec_out.minHeadM, d)
	_sphere.transform = Transform3D(Basis.IDENTITY, cp)
	var inside := not space.intersect_shape(_sphere, 1).is_empty()
	var seen := 0
	var feet := c.global_position
	for p in [head, feet + Vector3.UP * 1.1, feet + Vector3.UP * 0.5]:
		_ray.from = cp
		_ray.to = p
		_ray.exclude = [c.get_rid()]
		var hit := _ray_through_faded(space, cp, p)
		if not hit:
			seen += 1
	var hidden := seen == 0
	var out := not cam.is_position_in_frustum(head)
	if inside:
		_rec_out.insideFrames += 1
	if hidden:
		_rec_out.hiddenFrames += 1
	if out:
		_rec_out.outOfFrame += 1
	var fc = pm.foot_camera
	if not fc.fade.meshes.is_empty():
		_rec_out.fadedFrames += 1
	if fc.lift > 0.01:
		_rec_out.liftedFrames += 1
	_rec_out.maxLift = maxf(_rec_out.maxLift, fc.lift)
	if (inside or hidden or out or d < 0.6) and (_rec_out.worst as Array).size() < 20:
		(_rec_out.worst as Array).append({"t": snappedf(clock().t, 0.01), "headM": snappedf(d, 0.01), "inside": inside, "hidden": hidden, "out": out,
			"cam": [snappedf(cp.x, 0.01), snappedf(cp.y, 0.01), snappedf(cp.z, 0.01)], "head": [snappedf(head.x, 0.01), snappedf(head.y, 0.01), snappedf(head.z, 0.01)]})


## True when something that is not faded stands between a and b (faded walls are seen through).
func _ray_through_faded(space: PhysicsDirectSpaceState3D, a: Vector3, b: Vector3) -> bool:
	var fade = mode_node().foot_camera.fade
	var from := a
	for k in 4:
		_ray.from = from
		_ray.to = b
		var hit := space.intersect_ray(_ray)
		if hit.is_empty():
			return false
		if not fade.is_faded(hit.collider):
			return true
		from = Vector3(hit.position) + (b - a).normalized() * 0.02
	return true
