## Vehicle option V1 of ARCH_OPTIONS.md: Godot's VehicleBody3D with the KEEP tune (P0-017 bench version).
## The built-in vehicle drives along its local +Z and steers left for a positive angle (probed on 4.7.2), so the
## body is turned half a turn about Y and the wheel positions and the steer sign are converted here: outside this
## file the car faces -Z like every other node, and nothing is mirrored.
## Same driver logic as V2 (drive_logic.gd). Not available on the built-in wheel: side stiffness per axle.
extends VehicleBody3D

const Tune := preload("res://bench/physics/tune.gd")
const DriveLogic := preload("res://bench/physics/drive_logic.gd")

var tune: Tune
var logic := DriveLogic.new()
var throttle := 0.0
var brake_in := 0.0
var steer_in := 0.0
var handbrake := false
var cpu_us := 0
var cpu_ticks := 0
var bottomed := 0
var _wheels: Array[VehicleWheel3D] = []
var _steers := PackedByteArray()
var _drives := PackedByteArray()
var _front := PackedByteArray()


func setup(t: Tune, color: Color = Color(0.16, 0.36, 0.8)) -> void:
	tune = t
	mass = t.mass
	center_of_mass_mode = RigidBody3D.CENTER_OF_MASS_MODE_CUSTOM
	center_of_mass = Vector3.ZERO
	inertia = t.inertia
	linear_damp_mode = RigidBody3D.DAMP_MODE_REPLACE
	linear_damp = t.linear_damp
	angular_damp_mode = RigidBody3D.DAMP_MODE_REPLACE
	angular_damp = t.angular_damp
	can_sleep = false
	var pm := PhysicsMaterial.new()
	pm.friction = t.friction
	pm.bounce = t.bounce
	physics_material_override = pm
	collision_layer = 2
	collision_mask = 3
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = t.box_half * 2.0
	cs.shape = box
	cs.position = Vector3(0, t.box_y, 0)
	add_child(cs)
	var body := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = t.box_half * 2.0
	var mat := StandardMaterial3D.new()
	mat.albedo_color = color
	mat.roughness = 0.5
	bm.material = mat
	body.mesh = bm
	body.position = cs.position
	add_child(body)
	var tyre := StandardMaterial3D.new()
	tyre.albedo_color = Color(0.08, 0.08, 0.09)
	for w in t.wheels:
		var wheel := VehicleWheel3D.new()
		# the body is turned half a turn about Y: car right (+X) is local -X, car front (-Z) is local +Z
		wheel.position = Vector3(-float(w[0]), w[1], -float(w[2]))
		var front := float(w[2]) < 0.0
		wheel.use_as_steering = w[3]
		wheel.use_as_traction = w[4]
		wheel.wheel_radius = t.radius
		wheel.wheel_rest_length = t.rest
		wheel.suspension_travel = t.travel
		wheel.suspension_stiffness = t.stiffness
		wheel.suspension_max_force = t.max_force
		wheel.damping_compression = t.compression
		wheel.damping_relaxation = t.relaxation
		wheel.wheel_friction_slip = t.grip_front if front else t.grip_rear
		wheel.wheel_roll_influence = t.roll_influence
		var wm := MeshInstance3D.new()
		var cyl := CylinderMesh.new()
		cyl.top_radius = t.radius
		cyl.bottom_radius = t.radius
		cyl.height = 0.22
		cyl.material = tyre
		wm.mesh = cyl
		wm.rotation = Vector3(0, 0, PI / 2.0)
		wheel.add_child(wm)
		add_child(wheel)
		_wheels.append(wheel)
		_steers.append(1 if w[3] else 0)
		_drives.append(1 if w[4] else 0)
		_front.append(1 if front else 0)


func place(pos: Vector3, heading: float = 0.0) -> void:
	global_transform = Transform3D(Basis(Vector3.UP, -heading + PI), pos)
	linear_velocity = Vector3.ZERO
	angular_velocity = Vector3.ZERO
	logic = DriveLogic.new()
	controls(0.0, 0.0, 0.0, false)
	reset_physics_interpolation()


func controls(th: float, br: float, st: float, hb: bool = false) -> void:
	throttle = th
	brake_in = br
	steer_in = st
	handbrake = hb


func fwd() -> Vector3:
	return global_transform.basis.z


func kmh() -> float:
	return linear_velocity.dot(fwd()) * 3.6


func wheel_count() -> int:
	return _wheels.size()


func contact_count() -> int:
	var n := 0
	for w in _wheels:
		if w.is_in_contact():
			n += 1
	return n


## Suspension length of wheel i (the wheel node rides down from its connection point).
func susp(i: int) -> float:
	return float(tune.wheels[i][1]) - _wheels[i].position.y


func sim_step(dt: float) -> void:
	var t0 := Time.get_ticks_usec()
	logic.update(tune, kmh(), throttle, brake_in, steer_in, handbrake, dt)
	var lo := tune.rest - tune.travel + 0.001
	var hit_stop := false
	for i in _wheels.size():
		var wheel := _wheels[i]
		var front := _front[i] == 1
		if _steers[i] == 1:
			wheel.steering = -logic.steer
		wheel.engine_force = logic.engine if _drives[i] == 1 else 0.0
		var brk := logic.brake
		if handbrake and not front:
			brk = maxf(brk, tune.handbrake)
			wheel.wheel_friction_slip = tune.grip_handbrake
		elif not front:
			wheel.wheel_friction_slip = tune.grip_rear
		wheel.brake = brk
		if wheel.is_in_contact() and susp(i) < lo:
			hit_stop = true
	if hit_stop:
		bottomed += 1
	if not handbrake:
		var yr := angular_velocity.y
		apply_torque_impulse(Vector3(0.0, -yr * absf(yr) * tune.yaw_damp * dt, 0.0))
	cpu_us += Time.get_ticks_usec() - t0
	cpu_ticks += 1
