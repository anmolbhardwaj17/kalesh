## The on-foot camera (GAME.md "Movement and camera feel"): 3.0 m behind the head pivot (1.65 m over the feet, lower
## when crouched), 0.45 m to the right of it, FOV 65 degrees plus 5 while sprinting. Mouse or the look actions turn it
## (compass yaw, pitch); the character moves relative to its yaw (it writes the target's `view_yaw`).
## Walls: a 0.15 m sphere is swept from the head to the wanted spot and the camera stops short of the first contact, so it
## never sits inside geometry. When that leaves less than COMFORT metres it tries poses that squeeze the shoulder offset
## and rise over the head looking down, and takes the first with room; it never comes closer than 0.6 m to the head.
## It pulls in at once and eases back out. Walls between the camera and the body fade (wall_fade.gd).
## Follows on _physics_process after the character stepped (process_physics_priority 10). Coordinates: compass yaw 0
## looks north (-Z), PI/2 east (+X).
extends Camera3D

const WallFade := preload("res://camera/wall_fade.gd")

@export var target_path: NodePath
@export var back := 3.0
@export var shoulder := 0.45
@export var base_fov := 65.0
@export var sprint_fov := 5.0
@export var min_head := 0.6
@export var comfort := 1.2
@export var pitch_default := -0.17
@export var pitch_min := -1.1
@export var pitch_max := 0.6
## Full stick turn rate (rad/s) and mouse radians per pixel.
@export var look_rate := 3.0
@export var mouse_rad := 0.0025
## How fast the camera eases back out after a wall let it go (m/s) and lowers after a lift (rad/s).
@export var ease_out := 3.0
@export var lower_rate := 1.5
@export var sphere_r := 0.15
@export var wall_margin := 0.08

## [lift (rad, the camera rises over the head and looks down), shoulder share] tried in order when a wall is close.
const POSES := [[0.0, 1.0], [0.0, 0.0], [0.35, 0.5], [0.7, 0.3], [1.05, 0.1], [1.35, 0.0]]

var yaw := 0.0
var pitch := -0.17
## Eased pose: distance from the head, lift and shoulder share.
var dist := 3.0
var lift := 0.0
var shoulder_k := 1.0
## Last frame's numbers (probes): the free distance of the pose, how many body rays a wall blocked, the head pivot.
var free_m := 3.0
var blocked_rays := 0
var pivot := Vector3.ZERO
var fade := WallFade.new()

var _sprint := 0.0
var _pivot_y := NAN
var _sphere := PhysicsShapeQueryParameters3D.new()
var _target_id := 0


func _ready() -> void:
	process_physics_priority = 10
	fov = base_fov
	near = 0.05
	pitch = pitch_default
	var s := SphereShape3D.new()
	s.radius = sphere_r
	_sphere.shape = s
	_sphere.collision_mask = 3


func target() -> Node3D:
	return get_node_or_null(target_path) as Node3D


## Behind the character at once (a scene start, getting out of a vehicle, a teleport).
func snap_behind(h: float) -> void:
	yaw = h
	pitch = pitch_default
	lift = 0.0
	shoulder_k = 1.0
	dist = back
	_pivot_y = NAN
	var t := target()
	if t != null and "view_yaw" in t:
		t.view_yaw = yaw
	follow(0.0)


func _unhandled_input(event: InputEvent) -> void:
	if not current:
		return
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var rel: Vector2 = event.relative
		yaw = wrapf(yaw + rel.x * mouse_rad, -PI, PI)
		pitch = clampf(pitch - rel.y * mouse_rad, pitch_min, pitch_max)
	elif event is InputEventMouseButton and event.pressed and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	elif event.is_action_pressed("ui_cancel"):
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


func _physics_process(delta: float) -> void:
	if not current:
		return
	_read_look(delta)
	follow(delta)


func _read_look(dt: float) -> void:
	var lx := Input.get_axis("look_left", "look_right")
	var ly := Input.get_axis("look_down", "look_up")
	yaw = wrapf(yaw + lx * look_rate * dt, -PI, PI)
	pitch = clampf(pitch + ly * look_rate * 0.6 * dt, pitch_min, pitch_max)


## The camera basis of a pose: yaw, then the pitch less the lift (looking further down).
func _basis(l: float) -> Basis:
	return Basis(Vector3.UP, -yaw) * Basis(Vector3.RIGHT, clampf(pitch - l, -1.45, pitch_max))


func _offset(l: float, sk: float) -> Vector3:
	return _basis(l) * Vector3(shoulder * sk, 0.0, back)


func follow(dt: float) -> void:
	var t := target()
	if t == null:
		return
	if t.get_instance_id() != _target_id:
		_target_id = t.get_instance_id()
		_pivot_y = NAN
	var head: Vector3 = t.head_position() if t.has_method("head_position") else t.global_position + Vector3.UP * 1.65
	# stairs and kerbs lift the feet in steps: the pivot follows the height smoothly
	if is_nan(_pivot_y) or dt <= 0.0:
		_pivot_y = head.y
	else:
		_pivot_y = lerpf(_pivot_y, head.y, 1.0 - exp(-14.0 * dt))
		_pivot_y = clampf(_pivot_y, head.y - 0.3, head.y + 0.3)
	pivot = Vector3(head.x, _pivot_y, head.z)
	var space := get_world_3d().direct_space_state if get_world_3d() != null else null
	var free_now := back
	if space != null:
		_sphere.collision_mask = 3
		# the pose wanted: the first of POSES with room, or the roomiest
		var want_l := 0.0
		var want_s := 1.0
		var best := -1.0
		for p in POSES:
			var f := _free(space, _offset(float(p[0]), float(p[1])))
			if f >= comfort:
				want_l = float(p[0])
				want_s = float(p[1])
				best = f
				break
			if f > best:
				best = f
				want_l = float(p[0])
				want_s = float(p[1])
		# rise and squeeze at once, lower and widen slowly
		lift = want_l if want_l > lift else move_toward(lift, want_l, lower_rate * dt)
		shoulder_k = want_s if want_s < shoulder_k else move_toward(shoulder_k, want_s, 1.5 * dt)
		free_now = _free(space, _offset(lift, shoulder_k))
		if free_now < min_head:
			lift = want_l
			shoulder_k = want_s
			free_now = best
	free_m = free_now
	var goal := minf(back, free_now)
	dist = goal if goal < dist or dt <= 0.0 else move_toward(dist, goal, ease_out * dt)
	var b := _basis(lift)
	var off := _offset(lift, shoulder_k)
	global_transform = Transform3D(b, pivot + off.normalized() * (dist * off.length() / back))
	if "view_yaw" in t:
		t.view_yaw = yaw
	var sprinting: bool = "motor" in t and t.motor.gait == "sprint"
	_sprint = move_toward(_sprint, 1.0 if sprinting else 0.0, dt * 3.0)
	fov = base_fov + sprint_fov * _sprint
	if space != null:
		var feet := t.global_position
		blocked_rays = fade.update(space, global_position, [head, feet + Vector3.UP * 1.1, feet + Vector3.UP * 0.5], maxf(dt, 1.0 / 60.0))


## Metres from the head the camera may go along `off` (scaled to `back`) before the sphere meets the world, less the
## margin.
func _free(space: PhysicsDirectSpaceState3D, off: Vector3) -> float:
	var full := off.length()
	_sphere.transform = Transform3D(Basis.IDENTITY, pivot)
	_sphere.motion = off
	var r := space.cast_motion(_sphere)
	var share := 1.0 if r.size() < 2 else clampf(r[0], 0.0, 1.0)
	if share >= 1.0:
		return back
	return maxf(0.0, share * full - wall_margin) * back / full
