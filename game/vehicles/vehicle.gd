## The V2 vehicle (TECH.md "Vehicles (V2)", from the physics bench's vehicle_v2.gd, P0-017): our own raycast vehicle on
## a Jolt RigidBody3D for any wheel count. Each sim tick (SimClock.sim_tick, never its own _physics_process): one ray
## per wheel along the body's down axis, a spring and damper along the contact normal, then the tyre impulses of
## tyre_model.gd (grip per axle, a grip circle), steer lock by speed and gears from drive_input.gd, quadratic yaw
## damping against a spin, a handbrake on the rear wheels. All impulses are summed and sent to the server in two calls.
## A node faces -Z at rotation 0: heading h has rotation.y = -h (north is -Z, east +X; no negative scale).
## Staging: place() stands the vehicle on the ground under it and stops it; carry() moves it along a scripted path with
## the body frozen (perf and stream probes only).
## Two wheels (the scooter, P1-021): a hidden stabiliser (a roll spring and damper while a wheel touches) keeps the body
## upright, and the drawn body and wheels lean into a turn on the node `Lean` (the physics body never leans). Every
## body and wheel mesh hangs under `Lean`, whose origin is the ground point under the centre of mass.
extends RigidBody3D

const Tune := preload("res://vehicles/vehicle_tune.gd")
const DriveInput := preload("res://vehicles/drive_input.gd")
const Tyre := preload("res://vehicles/tyre_model.gd")
const Kit := preload("res://scenes/standin/kit.gd")
const KitGeo := preload("res://scenes/standin/geo.gd")
## How far below the wheel ray a settle looks for ground after place().
## What the body collides with: the world (1), vehicles (2) and characters on foot (4).
const MASK := 7
const SETTLE_REACH := 60.0
const SETTLE_UP := 2.5
## Where the kit car bodies (Kit.car, width 1.74 m) put a wheel centre across: the drawn wheel sits there.
const KIT_WHEEL_X := 0.81

@export var tune_path := "res://data/vehicles/car.tres"
## The player's vehicle reads the InputMap actions and joins the group "player"; others take controls().
@export var is_player := true
## Overrides the tune's paint when its alpha is above 0.
@export var body_color := Color(0, 0, 0, 0)

var tune: Tune
var input := DriveInput.new()
## Height of the ground under place() (the debug teleport and the streamed city set it before calling place).
var ground_y := 0.0
## Compass heading (0 north, PI/2 east) and the speed along it in m/s; a carried vehicle reports its path speed.
var heading: float:
	get:
		var f := -global_transform.basis.z
		return atan2(f.x, -f.z)
var speed: float:
	get:
		return _carry_speed if _carried else linear_velocity.dot(-global_transform.basis.z)
var health := 1000.0

## Script time of sim_step, for the cost per vehicle.
var cpu_us := 0
var cpu_ticks := 0
var contacts := 0
## Ticks in which a wheel was pushed to the end of its travel.
var bottomed := 0
## Wheel rays that missed on a mesh edge and hit 1 cm to the side.
var edge_retries := 0
var susp_len := PackedFloat32Array()
var susp_force := PackedFloat32Array()
## Where each wheel ray met the ground in the last step (world metres; unused for a wheel in the air: see wheel_contacts).
var wheel_hits := PackedVector3Array()
## The visual lean of the drawn body in radians, positive to the right (0 unless the tune has lean_max).
var lean := 0.0

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
var _spin := PackedFloat32Array()
var _query := PhysicsRayQueryParameters3D.new()
var _wheel_nodes: Array[Node3D] = []
var _lean_node: Node3D
var _built := false
var _stepped := false
var _settling := false
var _carried := false
var _carry_speed := 0.0
var _connected := false
## Where place() or carry() last put the body.
var _staged := Transform3D.IDENTITY


func _init() -> void:
	can_sleep = false


func _ready() -> void:
	if not _built:
		setup(load(tune_path) as Tune)
	if is_player:
		add_to_group("player")
	# every vehicle, driven or not: PlayerMode looks here for a door to get in by (P1-022)
	add_to_group("vehicles")
	_query.exclude = [get_rid()]
	var clock := get_node_or_null("/root/SimClock")
	if clock != null and not _connected:
		clock.sim_tick.connect(sim_step)
		_connected = true
	place(position.x, position.z, -rotation.y, position.y)


func _exit_tree() -> void:
	var clock := get_node_or_null("/root/SimClock")
	if clock != null and _connected:
		clock.sim_tick.disconnect(sim_step)
		_connected = false


func _enter_tree() -> void:
	var clock := get_node_or_null("/root/SimClock")
	if clock != null and is_node_ready() and not _connected:
		clock.sim_tick.connect(sim_step)
		_connected = true


## Builds the body from a tune: mass, damping, the collision box, the body and wheel meshes.
func setup(t: Tune) -> void:
	tune = t
	_built = true
	health = t.health
	mass = t.mass
	center_of_mass_mode = RigidBody3D.CENTER_OF_MASS_MODE_CUSTOM
	center_of_mass = Vector3.ZERO
	inertia = t.inertia
	linear_damp_mode = RigidBody3D.DAMP_MODE_REPLACE
	linear_damp = t.linear_damp
	angular_damp_mode = RigidBody3D.DAMP_MODE_REPLACE
	angular_damp = t.angular_damp
	# static, not kinematic: Jolt moves a kinematic body to a new transform only in the next step, and the node reads the
	# old one back meanwhile (a teleport looked back to where it came from for a frame)
	freeze_mode = RigidBody3D.FREEZE_MODE_STATIC
	var pm := PhysicsMaterial.new()
	pm.friction = t.friction
	pm.bounce = t.bounce
	physics_material_override = pm
	collision_layer = 2
	# the world (1), other vehicles (2) and people on foot (4, on_foot.gd LAYER): a car stops against a person (P1-024)
	collision_mask = MASK
	var cs := CollisionShape3D.new()
	cs.name = "Box"
	var box := BoxShape3D.new()
	box.size = t.box_half * 2.0
	cs.shape = box
	cs.position = Vector3(0, t.box_y, 0)
	add_child(cs)
	_lean_node = Node3D.new()
	_lean_node.name = "Lean"
	_lean_node.position = Vector3(0, -t.ride_height(), 0)
	add_child(_lean_node)
	_build_body(t)
	_n = t.wheels.size()
	for arr in [_hard, _r, _nrm, _axle, _fdir, wheel_hits]:
		arr.resize(_n)
	for arr in [_steers, _drives, _front, _hit]:
		arr.resize(_n)
	for arr in [_fi, _si, _spin, susp_len, susp_force]:
		arr.resize(_n)
	var tyre := StandardMaterial3D.new()
	tyre.albedo_color = Color(0.08, 0.08, 0.09)
	tyre.roughness = 0.9
	var hub := StandardMaterial3D.new()
	hub.albedo_color = Color(0.62, 0.63, 0.66)
	hub.metallic = 0.6
	hub.roughness = 0.4
	for i in _n:
		var w: Array = t.wheels[i]
		_hard[i] = Vector3(w[0], w[1], w[2])
		_steers[i] = 1 if w[3] else 0
		_drives[i] = 1 if w[4] else 0
		_front[i] = 1 if float(w[2]) < 0.0 else 0
		susp_len[i] = t.rest
		var pivot := Node3D.new()
		pivot.name = "Wheel%d" % i
		pivot.position = _hard[i] - Vector3(0, t.rest, 0) - _lean_node.position
		# the drawn wheel stands just proud of the body side (the physics hardpoint stays where the tune puts it); under
		# a kit car body, where the kit draws its own wheels (their centre KIT_WHEEL_X out)
		var side_x := KIT_WHEEL_X if _kit_car(t) else t.box_half.x - t.wheel_width * 0.5 + 0.025
		var outward := signf(_hard[i].x) * maxf(0.0, side_x - absf(_hard[i].x))
		var wm := MeshInstance3D.new()
		var cyl := CylinderMesh.new()
		cyl.top_radius = t.radius
		cyl.bottom_radius = t.radius
		cyl.height = t.wheel_width
		cyl.radial_segments = 20
		cyl.material = tyre
		wm.mesh = cyl
		wm.rotation = Vector3(0, 0, PI / 2.0)
		wm.position = Vector3(outward, 0, 0)
		pivot.add_child(wm)
		# a hub plate on the outer face, so the wheel reads as turning
		var hm := MeshInstance3D.new()
		var hb := BoxMesh.new()
		hb.size = Vector3(0.02, t.radius * 1.1, t.radius * 0.35)
		hb.material = hub
		hm.mesh = hb
		hm.position = Vector3(outward + signf(_hard[i].x) * (t.wheel_width * 0.5 + 0.005), 0, 0)
		pivot.add_child(hm)
		_lean_node.add_child(pivot)
		_wheel_nodes.append(pivot)
	_query.collision_mask = 1


## The stand-in body: the kit's auto, scooter, hatch or sedan (origin on the ground, so it sits on the Lean node; the
## cars without their own wheels), or a plain body over the collision box with a cabin set back from the bonnet.
func _build_body(t: Tune) -> void:
	var col := body_color if body_color.a > 0.0 else t.paint
	if t.body == "auto" or t.body == "scooter" or _kit_car(t):
		var sink := KitGeo.Sink.new()
		if t.body == "auto":
			Kit.driven_auto(sink)
		elif t.body == "scooter":
			Kit.ridden_scooter(sink, col)
		else:
			Kit.car(sink, col, t.body, false)
		var km := MeshInstance3D.new()
		km.name = "Body"
		km.mesh = sink.to_mesh(Kit.materials())
		_lean_node.add_child(km)
		return
	var paint := StandardMaterial3D.new()
	paint.albedo_color = col
	paint.roughness = 0.45
	var glass := StandardMaterial3D.new()
	glass.albedo_color = Color(0.13, 0.16, 0.19)
	glass.roughness = 0.25
	var h := t.box_half
	# the drawn body starts a little above the collision box bottom, so the wheels show under it
	var bottom := t.box_y - h.y + 0.12
	var lower_h := (h.y * 2.0 - 0.12) * 0.55
	var body := MeshInstance3D.new()
	body.name = "Body"
	var bm := BoxMesh.new()
	bm.size = Vector3(h.x * 2.0, lower_h, h.z * 2.0)
	bm.material = paint
	body.mesh = bm
	body.position = Vector3(0, bottom + lower_h * 0.5, 0) - _lean_node.position
	_lean_node.add_child(body)
	var cabin := MeshInstance3D.new()
	cabin.name = "Cabin"
	var cm := BoxMesh.new()
	var cab_h := h.y * 2.0 - 0.12 - lower_h
	cm.size = Vector3(h.x * 2.0 * 0.9, cab_h, h.z * 2.0 * 0.5)
	cm.material = glass
	cabin.mesh = cm
	cabin.position = Vector3(0, bottom + lower_h + cab_h * 0.5, h.z * 0.12) - _lean_node.position
	_lean_node.add_child(cabin)


static func _kit_car(t: Tune) -> bool:
	return t.body == "hatch" or t.body == "sedan"


## Staging: stands the vehicle on the ground at x, z (ground_y, or `y` when given), facing a compass heading, at rest.
## The body is frozen until the next tick finds the ground under it, so it never falls while the ground streams in.
func place(x: float, z: float, h: float = NAN, y: float = NAN) -> void:
	if not is_nan(y):
		ground_y = y
	var hd := heading if is_nan(h) else h
	var ride := tune.ride_height() if tune != null else 0.0
	freeze = true
	_put(Transform3D(Basis(Vector3.UP, -hd), Vector3(x, ground_y + ride, z)))
	input.reset()
	_carried = false
	_carry_speed = 0.0
	_settling = true
	lean = 0.0
	reset_physics_interpolation()


## Scripted motion for perf and stream probes (never in a milestone): the ground point, heading and speed of a path.
func carry(ground: Vector3, h: float, speed_ms: float) -> void:
	freeze = true
	_settling = false
	_carried = true
	_carry_speed = speed_ms
	ground_y = ground.y
	_put(Transform3D(Basis(Vector3.UP, -h), ground + Vector3(0, tune.ride_height(), 0)))


## Moves the body at once, node and physics server alike, and stops it (staging only). The server is told directly: a
## node transform set on a rigid body is overwritten by the next state sync when the server did not take it.
func _put(xf: Transform3D) -> void:
	_staged = xf
	global_transform = xf
	linear_velocity = Vector3.ZERO
	angular_velocity = Vector3.ZERO
	if is_inside_tree():
		PhysicsServer3D.body_set_state(get_rid(), PhysicsServer3D.BODY_STATE_TRANSFORM, xf)
		PhysicsServer3D.body_set_state(get_rid(), PhysicsServer3D.BODY_STATE_LINEAR_VELOCITY, Vector3.ZERO)
		PhysicsServer3D.body_set_state(get_rid(), PhysicsServer3D.BODY_STATE_ANGULAR_VELOCITY, Vector3.ZERO)


## Where the vehicle meets the ground at rest (what state().player.pos reports): the origin less the ride height.
func foot_position() -> Vector3:
	return global_position - global_transform.basis.y * tune.ride_height()


func fwd() -> Vector3:
	return -global_transform.basis.z


func kmh() -> float:
	return speed * 3.6


func wheel_count() -> int:
	return _n


## The ground points of the wheels that touched in the last step (world metres).
func wheel_contacts() -> PackedVector3Array:
	var out := PackedVector3Array()
	for i in _n:
		if _hit[i] == 1:
			out.append(wheel_hits[i])
	return out


func contact_count() -> int:
	return contacts


## Roll of the physics body in degrees, positive when the right side is down.
func roll_deg() -> float:
	return rad_to_deg(asin(clampf(-global_transform.basis.x.y, -1.0, 1.0)))


func is_settled() -> bool:
	return not _settling and not freeze


## Controls for a vehicle that is not the player's (AI, probes): pedals 0..1, steer -1..1.
func controls(th: float, br: float, st: float, hb: bool = false) -> void:
	input.throttle_in = th
	input.brake_in = br
	input.steer_in = st
	input.handbrake_in = hb


func sim_step(dt: float) -> void:
	if _carried:
		return
	if _settling:
		_settle()
		return
	# No forces in the first tick after the body was made or unfrozen: the engine has not stepped it yet (the inverse
	# inertia tensor reads as identity until the first state sync).
	if not _stepped:
		_stepped = true
		return
	var t0 := Time.get_ticks_usec()
	if is_player:
		input.read()
	_step(dt)
	cpu_us += Time.get_ticks_usec() - t0
	cpu_ticks += 1
	_update_wheels(dt)


func _settle() -> void:
	var xf := _staged
	_query.from = xf.origin + Vector3.UP * SETTLE_UP
	_query.to = xf.origin - Vector3.UP * SETTLE_REACH
	var hit := get_world_3d().direct_space_state.intersect_ray(_query)
	if hit.is_empty():
		return
	var pos: Vector3 = hit.position
	ground_y = pos.y
	_put(Transform3D(xf.basis, Vector3(xf.origin.x, pos.y + tune.ride_height(), xf.origin.z)))
	freeze = false
	_settling = false
	_stepped = false
	for i in _n:
		susp_len[i] = tune.rest
	_update_wheels(0.0)


func _step(dt: float) -> void:
	var xf := global_transform
	var b := xf.basis
	var up := b.y
	var right := b.x
	var com := xf.origin
	var v := linear_velocity
	var w := angular_velocity
	input.update(tune, v.dot(-b.z) * 3.6, dt)
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
			# a ray exactly on a shared edge of a triangle mesh can miss both triangles (a wheel on the centre line on a
			# seam of the ground mesh): look once more 1 cm to the side
			_query.from = hard + right * 0.01
			_query.to = _query.from - up * ray_len
			hit = space.intersect_ray(_query)
			if not hit.is_empty():
				edge_retries += 1
				# the contact stays on the wheel's own line
				hit.position = (hit.position as Vector3) - right * 0.01
		if hit.is_empty():
			_hit[i] = 0
			susp_len[i] = minf(hi, susp_len[i] + 0.02)
			susp_force[i] = 0.0
			continue
		var cp: Vector3 = hit.position
		wheel_hits[i] = cp
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
		if _drives[i] == 0 or input.engine == 0.0:
			braked += 1
		var j := nrm * (force * dt)
		sum_j += j
		sum_t += r.cross(j)
	if hit_stop:
		bottomed += 1

	# tyres: velocities after the suspension impulses, as the old controller did
	var v2 := v + sum_j * inv_mass
	var w2 := w + inv_i * sum_t
	var steer := input.steer
	var hb := input.handbrake
	for i in _n:
		if _hit[i] == 0:
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
		var side := Tyre.side_impulse(tune.side_damp, tune.side_front if front else tune.side_rear, axle.dot(vel), Tyre.inv_mass_along(inv_mass, inv_i, r, axle))
		var brk := input.brake
		if hb and not front:
			brk = maxf(brk, tune.handbrake)
		var eng := input.engine if _drives[i] == 1 else 0.0
		var fi := Tyre.forward_impulse(eng, brk, f.dot(vel), Tyre.inv_mass_along(inv_mass, inv_i, r, f), braked, dt)
		var grip := tune.grip_front if front else (tune.grip_handbrake if hb else tune.grip_rear)
		var k := Tyre.grip_scale(fi, side, susp_force[i] * dt * grip)
		fi *= k
		side *= k
		var jf := f * fi
		sum_j += jf
		sum_t += r.cross(jf)
		# the side impulse acts lower on the body than the contact point (roll influence), so the car leans less
		var rr := r - up * (r.dot(up) * (1.0 - tune.roll_influence))
		var js := axle * side
		sum_j += js
		sum_t += rr.cross(js)
	# anti-spin: quadratic yaw damping, off on the handbrake so a drift stays free
	if not hb:
		sum_t -= up * (w.dot(up) * absf(w.dot(up)) * tune.yaw_damp * dt)
	# the hidden stabiliser: a roll spring and damper about the forward axis while a wheel touches
	if tune.roll_stiffness > 0.0 and contacts > 0:
		var fa := -b.z
		var tilt := up.cross(Vector3.UP).dot(fa)
		var i_roll := 1.0 / maxf(1e-6, fa.dot(inv_i * fa))
		sum_t += fa * (i_roll * (tune.roll_stiffness * tilt - tune.roll_damping * w.dot(fa)) * dt)
	apply_central_impulse(sum_j)
	apply_torque_impulse(sum_t)


func _update_wheels(dt: float) -> void:
	var fwd_speed := linear_velocity.dot(-global_transform.basis.z)
	if tune.lean_max > 0.0 and dt > 0.0:
		# lean into the turn: toward atan(lateral acceleration / g); a right turn has a negative yaw rate
		var yaw_rate := angular_velocity.dot(global_transform.basis.y)
		var want := clampf(atan(fwd_speed * -yaw_rate / 9.8), -tune.lean_max, tune.lean_max)
		lean = lerpf(lean, want, 1.0 - exp(-tune.lean_rate * dt))
		_lean_node.basis = Basis(Vector3.FORWARD, lean)
	for i in _n:
		var node := _wheel_nodes[i]
		node.position = _hard[i] - Vector3(0, susp_len[i], 0) - _lean_node.position
		_spin[i] = wrapf(_spin[i] - fwd_speed * dt / tune.radius, -PI, PI)
		var yaw := -input.steer if _steers[i] == 1 else 0.0
		node.basis = Basis(Vector3.UP, yaw) * Basis(Vector3.RIGHT, _spin[i])
