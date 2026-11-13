## The vehicle chase camera (GAME.md "Movement and camera feel"), the old game's rig kept in decisions.md ("KEEP ...
## chase camera numbers"): wide chase 6.6 m behind and 2.5 m up, close chase 4.5 m and 2.05 m, look-ahead 4.0 and 3.2 m;
## with speed it pulls back, drops a little, looks further ahead and widens the FOV from 70 by up to 21 degrees.
## Position and look follow with frame-rate independent lerps, the horizontal lag is capped, the camera never goes under
## 0.5 m above the vehicle, and a ray from a pivot over the roof pulls it in front of walls (it never sits inside
## geometry) and lifts it over the roof when that brings it close. V toggles wide and close (blended over 0.6 s on an arc over the roof), C looks back while held. A sudden
## stop above 16 km/h shakes it a little. Follows on _physics_process after the vehicle (process_physics_priority 10).
extends Camera3D

@export var target_path: NodePath
## [back, up, look-ahead] of each view.
@export var wide := Vector3(6.6, 2.5, 4.0)
@export var close := Vector3(4.5, 2.05, 3.2)
## At full speed: added distance, height change, added look-ahead.
@export var at_speed := Vector3(0.3, -0.25, 3.0)
## Speed (km/h) at which the speed effects reach full strength.
@export var full_kmh := 130.0
@export var base_fov := 70.0
@export var fov_gain := 21.0
## Per 1/60 s frame.
@export var pos_lerp := 0.16
@export var look_lerp := 0.22
@export var max_horizontal := 9.3
@export var floor_above := 0.5
@export var blend_s := 0.6
@export var blend_lift := 0.8
## The pivot the wall ray starts from, above the vehicle origin, and the gap kept to a wall.
@export var pivot_up := 1.4
@export var wall_margin := 0.35
## When a wall pulls the camera closer than wall_keep to the pivot, it rises by the shortfall (at most wall_lift_max).
@export var wall_keep := 4.0
@export var wall_lift_max := 3.0
@export var shake_kmh := 16.0
@export var shake_max := 0.2

var view := "wide"
var looking_back := false
## The last pull-in by a wall: 1 when free, smaller when a wall moved the camera in.
var wall_free := 1.0

var _look := Vector3.ZERO
var _blend := 1.0
var _from := Vector3.ZERO
var _last_kmh := 0.0
var _shake := 0.0
var _shake_t := 0.0
var _fresh := true
var _sphere := PhysicsShapeQueryParameters3D.new()
var _view_was := false


func _ready() -> void:
	process_physics_priority = 10
	fov = base_fov
	var s := SphereShape3D.new()
	s.radius = 0.2
	_sphere.shape = s
	_sphere.collision_mask = 1
	follow(1.0 / 60.0)


func _physics_process(delta: float) -> void:
	_read_keys()
	follow(delta)


func target() -> Node3D:
	return get_node_or_null(target_path) as Node3D


func set_view(v: String) -> void:
	if v == view or not (v in ["wide", "close"]):
		return
	view = v
	_blend = 0.0
	_from = global_position


func _read_keys() -> void:
	var pressed := InputMap.has_action("camera_view") and Input.is_action_pressed("camera_view")
	if pressed and not _view_was:
		set_view("close" if view == "wide" else "wide")
	_view_was = pressed
	looking_back = InputMap.has_action("look_back") and Input.is_action_pressed("look_back")


## Snaps to the rig at once on the next follow (after a teleport or a scene start).
func snap() -> void:
	_fresh = true


func follow(dt: float) -> void:
	var car := target()
	if car == null:
		return
	var b := car.global_transform.basis
	var p := car.global_position
	var flat := -b.z
	flat.y = 0.0
	if flat.length_squared() < 1e-6:
		flat = Vector3.FORWARD
	flat = flat.normalized()
	var kmh: float = absf(float(car.speed)) * 3.6 if "speed" in car else 0.0
	var s := smoothstep(0.0, 1.0, clampf(kmh / full_kmh, 0.0, 1.0))
	var rig := (wide if view == "wide" else close) + at_speed * s
	var dir := -flat if looking_back else flat
	var want := p - dir * rig.x + Vector3.UP * rig.y
	# pulled in by a wall (last frame), the look point comes back toward the vehicle so it stays in the frame
	var look_at_pt := p + dir * (rig.z * wall_free) + Vector3.UP * 1.0
	var k_pos := 1.0 - pow(1.0 - pos_lerp, dt * 60.0)
	var k_look := 1.0 - pow(1.0 - look_lerp, dt * 60.0)
	var pos := want
	if _fresh or looking_back:
		_look = look_at_pt
		_fresh = false
	else:
		pos = global_position.lerp(want, k_pos)
		_look = _look.lerp(look_at_pt, k_look)
	# view change: an arc from where the camera was, lifted over the roof
	if _blend < 1.0:
		_blend = minf(1.0, _blend + dt / blend_s)
		var e := smoothstep(0.0, 1.0, _blend)
		pos = _from.lerp(pos, e) + Vector3.UP * (sin(e * PI) * blend_lift)
	# horizontal lag cap
	var off := pos - p
	var h := Vector2(off.x, off.z)
	if h.length() > max_horizontal:
		h = h.normalized() * max_horizontal
		pos = Vector3(p.x + h.x, pos.y, p.z + h.y)
	# never under the floor over the vehicle
	pos.y = maxf(pos.y, p.y + floor_above)
	# impact shake on a sudden stop
	if _last_kmh - kmh > shake_kmh * dt * 60.0 and _last_kmh > shake_kmh:
		_shake = minf(shake_max, (_last_kmh - kmh) * 0.01)
		_shake_t = 0.0
	_last_kmh = kmh
	if _shake > 0.001:
		_shake_t += dt
		pos += Vector3(sin(_shake_t * 61.0), sin(_shake_t * 47.0 + 1.0), 0.0) * _shake
		_shake *= pow(0.02, dt)
		pos.y = maxf(pos.y, p.y + floor_above)
	pos = _clear_of_walls(p, pos)
	global_position = pos
	if pos.distance_squared_to(_look) > 0.01:
		look_at(_look, Vector3.UP)
	fov = base_fov + fov_gain * s


## Pulls the camera in toward a pivot over the roof when anything is between them: a 0.2 m sphere is swept from the
## pivot to the wanted spot (so a ray grazing a wall top cannot pass), and the camera stops short of the first contact.
## Pulled in close it rises over the vehicle (swept again). A start inside geometry leaves it just over the pivot.
func _clear_of_walls(car_pos: Vector3, want: Vector3) -> Vector3:
	var world := get_world_3d()
	if world == null:
		return want
	var space := world.direct_space_state
	if space == null:
		return want
	var pivot := car_pos + Vector3.UP * pivot_up
	wall_free = 1.0
	var d := pivot.distance_to(want)
	var safe := _sweep(space, pivot, want)
	if safe >= 1.0:
		return want
	var keep := maxf(0.0, safe * d - wall_margin)
	wall_free = keep / maxf(0.001, d)
	var out := pivot + (want - pivot) / maxf(0.001, d) * keep
	out.y = maxf(out.y, car_pos.y + floor_above)
	# pulled in close: rise over the vehicle and look down at it rather than hug the roof
	var lift := clampf(wall_keep - keep, 0.0, wall_lift_max)
	if lift > 0.01:
		var up_to := out + Vector3.UP * lift
		var up_safe := _sweep(space, pivot, up_to)
		out = pivot.lerp(up_to, maxf(0.0, up_safe - wall_margin / maxf(0.001, pivot.distance_to(up_to))))
		out.y = maxf(out.y, car_pos.y + floor_above)
	return out


## Share (0..1) of the way from a to b a 0.2 m sphere can move before it touches the world (layer 1).
func _sweep(space: PhysicsDirectSpaceState3D, a: Vector3, b: Vector3) -> float:
	_sphere.transform = Transform3D(Basis.IDENTITY, a)
	_sphere.motion = b - a
	var r := space.cast_motion(_sphere)
	if r.size() < 2:
		return 1.0
	return clampf(r[0], 0.0, 1.0)
