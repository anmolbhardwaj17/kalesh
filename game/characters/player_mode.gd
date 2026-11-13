## Who the player is: on foot (the character, on_foot.gd, with the on-foot camera) or driving a vehicle (vehicle.gd with
## the chase camera). F (action `enter_exit`) switches: on foot it walks to the door of the nearest vehicle within
## ENTER_REACH, gets in and hands the camera to the chase camera; driving it stops the vehicle, finds a free spot by a
## door (right first: Delhi cars are right hand drive), puts the character there and hands the camera back.
## Exactly one node is in the group "player" at a time; state().player.mode reads `mode` ("foot", "vehicle",
## "entering", "exiting"). Steps on SimClock.sim_tick. In the group "player_mode".
## setup() makes the character and the on-foot camera when the scene has none (the course scene calls it).
extends Node

const OnFoot := preload("res://characters/on_foot.gd")
const FootCamera := preload("res://camera/on_foot_camera.gd")

const ENTER_REACH := 2.6
## The walk to the door gives up after WALK_MAX_S (the character is put at the door), then getting in or out takes
## GET_IN_S or GET_OUT_S.
const WALK_MAX_S := 1.0
const GET_IN_S := 0.35
const GET_OUT_S := 0.3
## Out of the seat the body stands up over STAND_S (humanoid_anim.gd "sit_exit"); the player can move at once.
const STAND_S := 0.45
## A vehicle slows to this before the character gets out (km/h), braking for at most BRAKE_MAX_S.
const EXIT_KMH := 3.0
const BRAKE_MAX_S := 3.0
## Gap from the vehicle's side to the character's capsule axis at the door.
const DOOR_GAP := 0.5

var mode := "vehicle"
var character: CharacterBody3D
var foot_camera: Camera3D
var chase_camera: Camera3D
## The vehicle being driven, entered or left last.
var vehicle: Node3D
## The last switch: {from, to, ticks, s, side, ok}.
var last_switch := {}

var _f_was := false
var _phase_t := 0
var _door := Vector3.ZERO
var _side := ""
var _switch_t := 0
var _connected := false


func _ready() -> void:
	add_to_group("player_mode")
	var clock := get_node_or_null("/root/SimClock")
	if clock != null and not _connected:
		clock.sim_tick.connect(_tick)
		_connected = true


func _exit_tree() -> void:
	var clock := get_node_or_null("/root/SimClock")
	if clock != null and _connected:
		clock.sim_tick.disconnect(_tick)
		_connected = false


## Makes the character (seated in `start_vehicle` when given, else standing at its spot) and the on-foot camera.
func setup(world: Node3D, start_vehicle: Node3D, chase: Camera3D, cam_parent: Node) -> void:
	chase_camera = chase
	character = OnFoot.new()
	character.name = "Player"
	world.add_child(character)
	foot_camera = FootCamera.new()
	foot_camera.name = "FootCamera"
	foot_camera.far = chase.far if chase != null else 3000.0
	cam_parent.add_child(foot_camera)
	foot_camera.target_path = foot_camera.get_path_to(character)
	vehicle = start_vehicle
	if start_vehicle != null:
		mode = "vehicle"
		character.remove_from_group("player")
		character.seat(true)
		character.global_position = _foot_of(start_vehicle)
	else:
		mode = "foot"
		foot_camera.make_current()
		foot_camera.snap_behind(character.heading)


func _tick(_dt: float) -> void:
	if character == null:
		return
	var f := InputMap.has_action("enter_exit") and Input.is_action_pressed("enter_exit")
	var edge := f and not _f_was
	_f_was = f
	match mode:
		"foot":
			if edge:
				_begin_enter()
		"vehicle":
			var v := driven()
			if v != null:
				vehicle = v
				character.global_position = _foot_of(v)
				if edge:
					_begin_exit(v)
		"entering":
			_enter_step()
		"exiting":
			_exit_step()
	_switch_t += 1


## The vehicle in the group "player" (the probes may swap it for another tune), or null on foot.
func driven() -> Node3D:
	for p in get_tree().get_nodes_in_group("player"):
		if p.has_method("foot_position"):
			return p
	return null


static func _foot_of(v: Node3D) -> Vector3:
	return v.foot_position() if v.has_method("foot_position") else v.global_position


## Door points of a vehicle, right side first: [side name, world point on the ground].
static func doors(v: Node3D) -> Array:
	var out := []
	var half: Vector3 = v.tune.box_half if "tune" in v and v.tune != null else Vector3(0.9, 0.7, 2.2)
	var foot := _foot_of(v)
	var b := v.global_transform.basis
	var right := b.x
	right.y = 0.0
	right = right.normalized()
	var fwd := -b.z
	fwd.y = 0.0
	fwd = fwd.normalized()
	for s in [["right", 1.0], ["left", -1.0]]:
		var side: float = s[1]
		out.append([s[0], foot + right * side * (half.x + DOOR_GAP) + fwd * (half.z * 0.15)])
	out.append(["rear", foot - fwd * (half.z + DOOR_GAP + 0.2)])
	out.append(["front", foot + fwd * (half.z + DOOR_GAP + 0.2)])
	return out


## The nearest vehicle with a door within reach of the character: [vehicle, side, door point] or [].
func _nearest_door() -> Array:
	var best := []
	var best_d := ENTER_REACH
	var at := character.global_position
	for v in get_tree().get_nodes_in_group("vehicles"):
		var n := v as Node3D
		if n == null or not n.is_inside_tree() or absf(float(n.speed)) > 2.0:
			continue
		for d in doors(n).slice(0, 2):
			var p: Vector3 = d[1]
			var dist := Vector2(p.x - at.x, p.z - at.z).length()
			if dist < best_d:
				best_d = dist
				best = [n, d[0], p]
	return best


func _begin_enter() -> void:
	var near := _nearest_door()
	if near.is_empty():
		_event("foot:enter_none", {})
		return
	vehicle = near[0]
	_side = near[1]
	_door = near[2]
	mode = "entering"
	_phase_t = 0
	_switch_t = 0
	character.is_player = false
	_event("foot:enter", {"side": _side})


func _enter_step() -> void:
	_phase_t += 1
	var walk_ticks := roundi(WALK_MAX_S * 60.0)
	var to := _door - character.global_position
	to.y = 0.0
	if _phase_t <= walk_ticks and to.length() > 0.15:
		character.controls(to.normalized() * clampf(to.length() / 0.4, 0.3, 1.0))
		return
	if _phase_t <= walk_ticks:
		_phase_t = walk_ticks + 1
	character.controls(Vector3.ZERO)
	if _phase_t == walk_ticks + 1:
		character.pose("sit_enter", GET_IN_S)
	if _phase_t < walk_ticks + 1 + roundi(GET_IN_S * 60.0):
		return
	if not is_instance_valid(vehicle):
		_back_on_foot()
		return
	character.seat(true)
	character.remove_from_group("player")
	character.is_player = true
	vehicle.add_to_group("player")
	vehicle.is_player = true
	if chase_camera != null:
		if "target_path" in chase_camera:
			chase_camera.target_path = chase_camera.get_path_to(vehicle)
		chase_camera.make_current()
		if chase_camera.has_method("snap"):
			chase_camera.snap()
	mode = "vehicle"
	_done("foot", "vehicle", true)


func _begin_exit(v: Node3D) -> void:
	vehicle = v
	mode = "exiting"
	_phase_t = 0
	_switch_t = 0
	v.is_player = false
	_stop(v)
	_event("foot:exit", {})


func _exit_step() -> void:
	_phase_t += 1
	if not is_instance_valid(vehicle):
		_back_on_foot()
		return
	_stop(vehicle)
	var slow := absf(float(vehicle.speed)) * 3.6 <= EXIT_KMH
	if not slow and _phase_t < roundi(BRAKE_MAX_S * 60.0):
		_phase_t = mini(_phase_t, 1)
		return
	if _phase_t < roundi(GET_OUT_S * 60.0):
		return
	var spot := _exit_spot(vehicle)
	if spot.is_empty():
		# nowhere to stand: stay in
		vehicle.is_player = true
		mode = "vehicle"
		_event("foot:exit_blocked", {})
		_done("vehicle", "vehicle", false)
		return
	vehicle.controls(0.0, 0.0, 0.0, true)
	vehicle.remove_from_group("player")
	_side = spot[0]
	character.seat(false)
	character.place(spot[1].x, spot[1].z, float(vehicle.heading), spot[1].y)
	character.is_player = true
	character.add_to_group("player")
	character.pose("sit_exit", STAND_S)
	_hand_camera_to_foot(float(vehicle.heading))
	mode = "foot"
	_done("vehicle", "foot", true)


## Brings a vehicle to rest for getting out, every tick of the exit: the brake pedal while it rolls forward, the
## throttle while it rolls back, then no pedal at all, so the parking hold keeps it still. Never the brake pedal at a
## standstill: that is reverse (drive_input.gd), and a car reversing at 3 km/h passed EXIT_KMH and dragged the
## character it had just put by its door into the body (P1-024, enter_exit_vehicle).
static func _stop(v: Node3D) -> void:
	if not v.has_method("controls"):
		return
	var kmh := float(v.speed) * 3.6
	v.controls(0.4 if kmh < -1.0 else 0.0, 1.0 if kmh > 1.0 else 0.0, 0.0, true)


## A free spot by a door (right, left, then behind, in front): the capsule fits there and stands on ground.
func _exit_spot(v: Node3D) -> Array:
	var space := character.get_world_3d().direct_space_state
	var q := PhysicsShapeQueryParameters3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = OnFoot.RADIUS + 0.03
	cap.height = OnFoot.HEIGHT
	q.shape = cap
	q.collision_mask = OnFoot.MASK
	q.exclude = [character.get_rid()]
	var ray := PhysicsRayQueryParameters3D.create(Vector3.ZERO, Vector3.ZERO, 1)
	for d in doors(v):
		var p: Vector3 = d[1]
		ray.from = p + Vector3.UP * 1.2
		ray.to = p + Vector3.DOWN * 1.5
		var g := space.intersect_ray(ray)
		if g.is_empty():
			continue
		var gy := float(g.position.y)
		q.transform = Transform3D(Basis.IDENTITY, Vector3(p.x, gy + OnFoot.HEIGHT * 0.5 + 0.05, p.z))
		if space.intersect_shape(q, 1).is_empty():
			return [d[0], Vector3(p.x, gy, p.z)]
	return []


func _hand_camera_to_foot(h: float) -> void:
	if foot_camera == null:
		return
	foot_camera.make_current()
	foot_camera.snap_behind(h)


## Staging (probes, missions): the character on foot at x, z facing h at once, the vehicle left where it stands.
func put_on_foot(x: float, z: float, h: float) -> void:
	var v := driven()
	if v != null:
		v.is_player = false
		v.controls(0.0, 0.0, 0.0, true)
		v.remove_from_group("player")
		vehicle = v
	character.seat(false)
	character.is_player = true
	if not character.is_in_group("player"):
		character.add_to_group("player")
	character.place(x, z, h)
	mode = "foot"
	_hand_camera_to_foot(h)


func _back_on_foot() -> void:
	character.is_player = true
	character.seat(false)
	if not character.is_in_group("player"):
		character.add_to_group("player")
	mode = "foot"
	_hand_camera_to_foot(character.heading)


func _done(from: String, to: String, ok: bool) -> void:
	last_switch = {"from": from, "to": to, "ok": ok, "ticks": _switch_t, "s": snappedf(_switch_t / 60.0, 0.001), "side": _side}
	_event("player:mode", {"mode": mode, "from": from, "ok": ok, "s": last_switch.s})


func _event(type: String, data: Dictionary) -> void:
	var ev := get_node_or_null("/root/GameEvents")
	if ev != null:
		ev.emit_event(type, data)
