## Vehicle option V2 of ARCH_OPTIONS.md: our own raycast vehicle on a RigidBody3D (P0-017 bench version).
## Each sim tick: one ray per wheel along the body's down axis, a spring and damper force along the contact normal
## (the same formula as the old controller, so the KEEP tune maps one to one), then tyre impulses: sideways the
## wheel cancels a share of its side slip, forward it takes the engine force or a brake impulse, and both are cut
## to the grip circle (grip times the suspension force). Extras the built-in vehicle does not have: any number of
## wheels (the three wheel auto), side stiffness per axle, brakes shared between the braked wheels so a stopped car
## does not shake, all impulses summed and sent to the physics server in two calls.
## It steps from the bench clock (sim_step), never from its own _physics_process, so the hold and the time scale
## reach it. Front is -Z, right is +X. No negative scale.
extends RigidBody3D

const Tune := preload("res://bench/physics/tune.gd")
const DriveLogic := preload("res://bench/physics/drive_logic.gd")
## Share of the side slip one wheel cancels per step (the old controller's contact damping).
const SIDE_DAMP := 0.2

var tune: Tune
var logic := DriveLogic.new()
var throttle := 0.0
var brake_in := 0.0
var steer_in := 0.0
var handbrake := false
## Script time of sim_step, for the cost per vehicle.
var cpu_us := 0
var cpu_ticks := 0
var contacts := 0
## Ticks in which a wheel was pushed to the end of its travel.
var bottomed := 0
var susp_len := PackedFloat32Array()
var susp_force := PackedFloat32Array()
var show_wheels := true

var _n := 0
var _hard := PackedVector3Array()
var _steers := PackedByteArray()
var _drives := PackedByteArray()
var _front := PackedByteArray()
var _hit := PackedByteArray()
var _r := PackedVector3Array()
var _nrm := PackedVector3Array()
var _axle := PackedVector3Array()
var _fdir := PackedVector3Array()
var _fi := PackedFloat32Array()
var _si := PackedFloat32Array()
var _skid := PackedFloat32Array()
var _query := PhysicsRayQueryParameters3D.new()
var _wheel_nodes: Array[Node3D] = []
var _stepped := false


func setup(t: Tune, color: Color = Color(0.82, 0.2, 0.16)) -> void:
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
	_n = t.wheels.size()
	_hard.resize(_n)
	_r.resize(_n)
	_nrm.resize(_n)
	_axle.resize(_n)
	_fdir.resize(_n)
	_steers.resize(_n)
	_drives.resize(_n)
	_front.resize(_n)
	_hit.resize(_n)
	_fi.resize(_n)
	_si.resize(_n)
	_skid.resize(_n)
	susp_len.resize(_n)
	susp_force.resize(_n)
	var tyre := StandardMaterial3D.new()
	tyre.albedo_color = Color(0.08, 0.08, 0.09)
	for i in _n:
		var w: Array = t.wheels[i]
		_hard[i] = Vector3(w[0], w[1], w[2])
		_steers[i] = 1 if w[3] else 0
		_drives[i] = 1 if w[4] else 0
		_front[i] = 1 if float(w[2]) < 0.0 else 0
		susp_len[i] = t.rest
		var wm := MeshInstance3D.new()
		var cyl := CylinderMesh.new()
		cyl.top_radius = t.radius
		cyl.bottom_radius = t.radius
		cyl.height = 0.22
		cyl.material = tyre
		wm.mesh = cyl
		wm.rotation = Vector3(0, 0, PI / 2.0)
		wm.position = _hard[i] - Vector3(0, t.rest, 0)
		add_child(wm)
		_wheel_nodes.append(wm)
	_query.collision_mask = 1


func _ready() -> void:
	_query.exclude = [get_rid()]


## Puts the car at a world position, facing a compass heading (0 is north, -Z), at rest.
func place(pos: Vector3, heading: float = 0.0) -> void:
	global_transform = Transform3D(Basis(Vector3.UP, -heading), pos)
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
	return -global_transform.basis.z


func kmh() -> float:
	return linear_velocity.dot(fwd()) * 3.6


func wheel_count() -> int:
	return _n


func contact_count() -> int:
	return contacts


func susp(i: int) -> float:
	return susp_len[i]


func sim_step(dt: float) -> void:
	# No forces in the tick the body was made: the physics engine has not stepped it yet. On GodotPhysics3D the
	# mass only takes effect at the first step (an impulse before it acts on 1 kg: the car left at 185 m/s), and
	# on both engines the inverse inertia tensor reads as identity until the first state sync.
	if not _stepped:
		_stepped = true
		return
	var t0 := Time.get_ticks_usec()
	var xf := global_transform
	var b := xf.basis
	var up := b.y
	var right := b.x
	var com := xf.origin
	var v := linear_velocity
	var w := angular_velocity
	logic.update(tune, v.dot(-b.z) * 3.6, throttle, brake_in, steer_in, handbrake, dt)
	var inv_i := get_inverse_inertia_tensor()
	var inv_mass := 1.0 / mass
	var space := get_world_3d().direct_space_state
	var rest := tune.rest
	var radius := tune.radius
	var lo := rest - tune.travel
	var hi := rest + tune.travel
	var ray_len := rest + radius
	var sum_j := Vector3.ZERO
	var sum_t := Vector3.ZERO
	contacts = 0
	var braked := 0
	var hit_stop := false

	# suspension: one ray per wheel, spring and damper along the contact normal
	for i in _n:
		var hard := xf * _hard[i]
		_query.from = hard
		_query.to = hard - up * ray_len
		var hit := space.intersect_ray(_query)
		if hit.is_empty():
			_hit[i] = 0
			susp_len[i] = rest
			susp_force[i] = 0.0
			continue
		var cp: Vector3 = hit.position
		var nrm: Vector3 = hit.normal
		var dist := (hard - cp).dot(up)
		var length := clampf(dist - radius, lo, hi)
		if dist - radius < lo:
			hit_stop = true
		var r := cp - com
		var denom := nrm.dot(up)
		var inv := 10.0
		var rel_vel := 0.0
		if denom > 0.1:
			inv = 1.0 / denom
			rel_vel = nrm.dot(v + w.cross(r)) * inv
		var force := tune.stiffness * (rest - length) * inv - (tune.compression if rel_vel < 0.0 else tune.relaxation) * rel_vel
		force = clampf(force * mass, 0.0, tune.max_force)
		_hit[i] = 1
		_r[i] = r
		_nrm[i] = nrm
		susp_len[i] = length
		susp_force[i] = force
		contacts += 1
		if _drives[i] == 0 or logic.engine == 0.0:
			braked += 1
		var j := nrm * (force * dt)
		sum_j += j
		sum_t += r.cross(j)
	if hit_stop:
		bottomed += 1

	# tyres: velocities after the suspension impulses, as the old controller did
	var v2 := v + sum_j * inv_mass
	var w2 := w + inv_i * sum_t
	var sliding := false
	var steer := logic.steer
	for i in _n:
		if _hit[i] == 0:
			_fi[i] = 0.0
			_si[i] = 0.0
			continue
		var nrm := _nrm[i]
		var r := _r[i]
		var axle := right
		if _steers[i] == 1 and steer != 0.0:
			axle = right.rotated(up, -steer)
		axle = (axle - nrm * axle.dot(nrm)).normalized()
		var f := nrm.cross(axle)
		var vel := v2 + w2.cross(r)
		var front := _front[i] == 1
		var side_denom := inv_mass + axle.dot((inv_i * r.cross(axle)).cross(r))
		var side := -SIDE_DAMP * (tune.side_front if front else tune.side_rear) * axle.dot(vel) / side_denom
		var fi := 0.0
		var eng := logic.engine if _drives[i] == 1 else 0.0
		var brk := logic.brake
		if handbrake and not front:
			brk = maxf(brk, tune.handbrake)
		if eng != 0.0:
			fi = eng * dt
		elif brk > 0.0:
			var f_denom := inv_mass + f.dot((inv_i * r.cross(f)).cross(r))
			fi = clampf(-f.dot(vel) / f_denom / maxf(1.0, braked), -brk, brk)
		var grip := tune.grip_front if front else (tune.grip_handbrake if handbrake else tune.grip_rear)
		var max_imp := susp_force[i] * dt * grip
		var sq := fi * fi * 0.25 + side * side
		_skid[i] = 1.0
		if sq > max_imp * max_imp:
			sliding = true
			_skid[i] = max_imp / sqrt(sq)
		_fi[i] = fi
		_si[i] = side
		_axle[i] = axle
		_fdir[i] = f
	for i in _n:
		if _hit[i] == 0:
			continue
		var fi := _fi[i]
		var side := _si[i]
		if sliding and side != 0.0 and _skid[i] < 1.0:
			fi *= _skid[i]
			side *= _skid[i]
		var r := _r[i]
		var jf := _fdir[i] * fi
		sum_j += jf
		sum_t += r.cross(jf)
		# the side impulse acts lower on the body than the contact point (roll influence), so the car leans less
		var rr := r - up * (r.dot(up) * (1.0 - tune.roll_influence))
		var js := _axle[i] * side
		sum_j += js
		sum_t += rr.cross(js)
	# anti-spin: quadratic yaw damping, off on the handbrake so a drift stays free
	if not handbrake:
		sum_t.y -= w.y * absf(w.y) * tune.yaw_damp * dt
	apply_central_impulse(sum_j)
	apply_torque_impulse(sum_t)
	cpu_us += Time.get_ticks_usec() - t0
	cpu_ticks += 1
	if show_wheels:
		for i in _n:
			_wheel_nodes[i].position = _hard[i] - Vector3(0, susp_len[i], 0)
			if _steers[i] == 1:
				_wheel_nodes[i].rotation = Vector3(0, -steer, PI / 2.0)
