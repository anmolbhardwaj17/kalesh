## On-foot option F1 of ARCH_OPTIONS.md: a CharacterBody3D capsule with our own step-up (P0-017 bench version).
## Godot has no built-in stair step. Each sim tick, when the capsule is on the floor and its forward move is blocked
## by something that is not a walkable slope, it tries the same move one step higher: up (at most STEP_MAX), forward,
## down. If it lands on a walkable surface that is higher than where it stood, it takes that position and keeps its
## whole forward move, so kerbs (0.15 m) and stair risers (0.18 m) cost no speed. The capsule's round foot lands on
## the step edge first, so the landing is judged by a ray just ahead of the foot, not by the capsule's own contact.
## Everything else is move_and_slide with floor snapping (stepping down, ramps, walls).
## It steps from the bench clock (sim_step), so the hold and the time scale reach it.
extends CharacterBody3D

const STEP_MAX := 0.25
const RADIUS := 0.3
const HEIGHT := 1.75
const COYOTE_TICKS := 3

## Metres per second along dir.
var speed := 0.0
## Unit vector on the ground plane.
var dir := Vector3.FORWARD
var cpu_us := 0
var cpu_ticks := 0
var steps_taken := 0
var _gravity := 9.8
var _grounded := false
var _air := 0
var _floor_cos := cos(deg_to_rad(46.0))
var _col := KinematicCollision3D.new()
var _ray := PhysicsRayQueryParameters3D.new()


func setup(color: Color = Color(0.9, 0.62, 0.2)) -> void:
	collision_layer = 4
	collision_mask = 1
	floor_max_angle = deg_to_rad(46.0)
	floor_snap_length = 0.3
	floor_constant_speed = true
	_gravity = float(ProjectSettings.get_setting("physics/3d/default_gravity"))
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = RADIUS
	cap.height = HEIGHT
	cs.shape = cap
	cs.position = Vector3(0, HEIGHT * 0.5, 0)
	add_child(cs)
	var mi := MeshInstance3D.new()
	var cm := CapsuleMesh.new()
	cm.radius = RADIUS
	cm.height = HEIGHT
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	cm.material = mat
	mi.mesh = cm
	mi.position = cs.position
	add_child(mi)
	_ray.collision_mask = 1


func sim_step(dt: float) -> void:
	var t0 := Time.get_ticks_usec()
	var hv := dir * speed
	velocity.x = hv.x
	velocity.z = hv.z
	if _grounded:
		velocity.y = 0.0
		_air = 0
	else:
		velocity.y -= _gravity * dt
		_air += 1
	# a step may also start within a few ticks of leaving the floor: the round foot often sits on a step edge,
	# which is too steep to count as floor, and without this the capsule drops back and loses a tick or two per step
	if _air <= COYOTE_TICKS and speed > 0.0 and _step_up(hv * dt):
		_grounded = true
		velocity.y = 0.0
	else:
		move_and_slide()
		_grounded = is_on_floor()
	cpu_us += Time.get_ticks_usec() - t0
	cpu_ticks += 1


func _step_up(motion: Vector3) -> bool:
	var from := global_transform
	if not test_move(from, motion, _col):
		return false
	if _col.get_normal().y > _floor_cos:
		return false # a walkable slope: move_and_slide climbs it
	var up_dist := STEP_MAX
	if test_move(from, Vector3(0, STEP_MAX, 0), _col):
		up_dist = _col.get_travel().y
	if up_dist < 0.02:
		return false
	var raised := from.translated(Vector3(0, up_dist, 0))
	var fwd := motion
	if test_move(raised, motion, _col):
		# blocked one step higher too: the next riser at speed (take the part of the move that fits), or a wall
		fwd = _col.get_travel()
		if fwd.length_squared() < motion.length_squared() * 0.04:
			return false
	var over := raised.translated(fwd)
	if not test_move(over, Vector3(0, -up_dist, 0), _col):
		return false
	var landed := over.translated(_col.get_travel())
	if landed.origin.y - from.origin.y < 0.002:
		return false
	# is there a walkable surface just ahead of the foot, within one step of where we stood?
	var ahead := landed.origin + motion.normalized() * RADIUS
	_ray.from = Vector3(ahead.x, from.origin.y + STEP_MAX + 0.1, ahead.z)
	_ray.to = Vector3(ahead.x, from.origin.y - 0.05, ahead.z)
	var hit := get_world_3d().direct_space_state.intersect_ray(_ray)
	if hit.is_empty() or (hit.normal as Vector3).y < _floor_cos:
		return false
	global_transform = landed
	steps_taken += 1
	return true
