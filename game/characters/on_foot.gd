## The on-foot character (TECH.md "On foot and combat (F1, CB1)", from the physics bench walker, P0-017): a
## CharacterBody3D capsule with our own step-up for kerbs (0.15 m) and stair risers (0.18 m), walk, jog, sprint with
## stamina, crouch, jump, and a vault over walls and railings up to 1.2 m when facing one (vault.gd). The movement rules
## and numbers are in foot_motor.gd. Steps on SimClock.sim_tick (never its own _physics_process), so the time scale and
## the sim hold reach it.
## The player's character reads the InputMap actions (move_*, walk, sprint, crouch, jump) relative to `view_yaw`, the
## compass yaw of its camera (on_foot_camera.gd sets it); others take controls(). A seated character (in a vehicle) is
## hidden, has no collision and does not step. The body drawn is the humanoid of humanoid_anim.gd (P1-023: a library
## mannequin dressed as one of the leads, `look`); the capsule stays the collision shape, and is drawn only when the
## rig files are missing.
## Coordinates: feet at the node origin, a node faces -Z at rotation 0, heading h has rotation.y = -h.
extends CharacterBody3D

const Motor := preload("res://characters/foot_motor.gd")
const Vault := preload("res://characters/vault.gd")
const Humanoid := preload("res://characters/humanoid_anim.gd")

const RADIUS := 0.3
const HEIGHT := 1.75
const CROUCH_HEIGHT := 1.15
## Head pivot of the camera over the feet, standing and crouched.
const HEAD := 1.65
const CROUCH_HEAD := 1.1
const STEP_MAX := 0.25
## Longer forward moves a step-up tries when this tick's move lands back on the tread it stands on (m).
const STEP_FWD_TRY := [0.06, 0.1]
const COYOTE_TICKS := 3
## A fall this short (ticks: a kerb, a stair at a run) keeps the gait's animation and its foot placement, so the legs
## step down; only a jump or a longer fall shows the air pose.
const FALL_ANIM_TICKS := 14
## World (1) and vehicles (2); the character is on layer 4.
const MASK := 3
## Ticks after getting out of a seat with collisions against the world only (seat()).
const UNSEAT_TICKS := 3
const LAYER := 4

@export var is_player := true
@export var body_color := Color(0.36, 0.72, 0.42)
## Which lead the humanoid is dressed as (leads.gd): bittu, meera or danny.
@export var look := "bittu"
## Draw the painted stand-in mannequin even when the lead has a model (P2-063, side by side checks only).
var stand_in := false
## Foot placement on kerbs, stairs and slopes (body_feel.gd): 1 on, 0 off, -1 for the player's character only (four
## rays and two leg solves a tick; a crowd turns it on only near the camera).
@export var foot_ik := -1

var motor := Motor.new()
## Compass yaw the move keys are relative to (the camera's).
var view_yaw := 0.0
## "ground", "air", "vault", "seated".
var state := "ground"
var vy := 0.0
var cpu_us := 0
var cpu_ticks := 0
var steps_taken := 0
var vaults := 0
var jumps := 0
## Eased head height over the feet (crouch moves it).
var head_h := HEAD

## Compass heading the body faces and its ground speed along it (state().player reads these).
var heading: float:
	get:
		return motor.heading
var speed: float:
	get:
		return motor.speed

var _cmd_move := Vector3.ZERO
var _cmd_walk := false
var _cmd_sprint := false
var _cmd_crouch := false
var _cmd_jump := false
var _jump_was := false
var _crouch_was := false
var _grounded := true
var _air := 0
var _vault := {}
var _vault_t := 0
var _floor_cos := cos(deg_to_rad(46.0))
var _col := KinematicCollision3D.new()
var _ray := PhysicsRayQueryParameters3D.new()
var _shape: CapsuleShape3D
var _cs: CollisionShape3D
var _mesh: MeshInstance3D
var _cap_mesh: CapsuleMesh
var _visor: MeshInstance3D
## The drawn body (humanoid_anim.gd), or null when the capsule is drawn.
var humanoid: Node3D
var _connected := false
var _unseat := 0
var _jumped := false


func _init() -> void:
	collision_layer = LAYER
	collision_mask = MASK
	floor_max_angle = deg_to_rad(46.0)
	floor_snap_length = 0.3
	floor_constant_speed = true
	safe_margin = 0.01
	_cs = CollisionShape3D.new()
	_cs.name = "Capsule"
	_shape = CapsuleShape3D.new()
	_shape.radius = RADIUS
	_shape.height = HEIGHT
	_cs.shape = _shape
	_cs.position = Vector3(0, HEIGHT * 0.5, 0)
	add_child(_cs)
	_ray.collision_mask = MASK


func _ready() -> void:
	_build_body()
	_ray.exclude = [get_rid()]
	if is_player and state != "seated":
		add_to_group("player")
	add_to_group("characters")
	var clock := get_node_or_null("/root/SimClock")
	if clock != null and not _connected:
		clock.sim_tick.connect(sim_step)
		_connected = true


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


## The humanoid (P1-023), or the capsule stand-in with a darker visor at the front when the rig files are missing.
func _build_body() -> void:
	if Humanoid.available():
		humanoid = Humanoid.new()
		humanoid.name = "Humanoid"
		add_child(humanoid)
		if humanoid.setup(look, stand_in):
			humanoid.feel.body = self
			humanoid.feel.ik_on = foot_ik == 1 or (foot_ik < 0 and is_player)
			humanoid.feel.look_on = is_player
			return
		humanoid.queue_free()
		humanoid = null
	_mesh = MeshInstance3D.new()
	_mesh.name = "Body"
	var cm := CapsuleMesh.new()
	cm.radius = RADIUS
	cm.height = HEIGHT
	_cap_mesh = cm
	var mat := StandardMaterial3D.new()
	mat.albedo_color = body_color
	mat.roughness = 0.7
	cm.material = mat
	_mesh.mesh = cm
	_mesh.position = Vector3(0, HEIGHT * 0.5, 0)
	add_child(_mesh)
	var visor := MeshInstance3D.new()
	visor.name = "Visor"
	var vm := BoxMesh.new()
	vm.size = Vector3(0.36, 0.12, 0.16)
	var vmat := StandardMaterial3D.new()
	vmat.albedo_color = Color(0.12, 0.13, 0.16)
	vmat.roughness = 0.4
	vm.material = vmat
	visor.mesh = vm
	visor.position = Vector3(0, HEIGHT * 0.5 - 0.25, -RADIUS + 0.06)
	_mesh.add_child(visor)
	_visor = visor


## Controls for a character that is not the player's (AI, probes): a world move direction with the stick strength as
## its length, and the held buttons.
func controls(move: Vector3, sprint := false, walk := false, jump := false, crouch := false) -> void:
	_cmd_move = move
	_cmd_sprint = sprint
	_cmd_walk = walk
	_cmd_jump = jump
	_cmd_crouch = crouch


## The player's keys, relative to the camera yaw: W is the way the camera looks.
func read_input() -> void:
	var fwd := Input.get_action_strength("move_forward") - Input.get_action_strength("move_back")
	var side := Input.get_action_strength("move_right") - Input.get_action_strength("move_left")
	var f := Motor.forward(view_yaw)
	var r := Vector3(-f.z, 0.0, f.x)
	var m := f * fwd + r * side
	if m.length() > 1.0:
		m = m.normalized()
	_cmd_move = m
	_cmd_walk = Input.is_action_pressed("walk")
	_cmd_sprint = Input.is_action_pressed("sprint")
	_cmd_jump = Input.is_action_pressed("jump")
	_cmd_crouch = Input.is_action_pressed("crouch")


func is_grounded() -> bool:
	return state == "seated" or (state == "ground" and _grounded)


func head_position() -> Vector3:
	return global_position + Vector3.UP * head_h


## Staging (teleport, probes, getting out of a vehicle): stands the character on the ground at x, z facing heading h,
## at rest. The ground is found by a ray down from y + 2 (or from 50 m) when y is not given exactly.
func place(x: float, z: float, h: float = NAN, y: float = NAN) -> void:
	var gy := y
	if is_inside_tree():
		var from := 50.0 if is_nan(y) else y + 2.0
		_ray.from = Vector3(x, from, z)
		_ray.to = Vector3(x, (0.0 if is_nan(y) else y) - 20.0, z)
		var hit := get_world_3d().direct_space_state.intersect_ray(_ray)
		if not hit.is_empty():
			gy = float(hit.position.y)
	if is_nan(gy):
		gy = 0.0
	global_position = Vector3(x, gy, z)
	if not is_nan(h):
		motor.heading = wrapf(h, -PI, PI)
		view_yaw = motor.heading
	rotation = Vector3(0, -motor.heading, 0)
	motor.speed = 0.0
	velocity = Vector3.ZERO
	vy = 0.0
	_vault = {}
	if state != "seated":
		state = "ground"
	_grounded = true
	_air = 0
	motor.accel = 0.0
	if humanoid != null:
		humanoid.feel.reset()
	reset_physics_interpolation()


## In or out of a vehicle seat: seated, the body is hidden, out of the physics world and stops stepping.
func seat(on: bool) -> void:
	if on:
		state = "seated"
		visible = false
		collision_layer = 0
		collision_mask = 0
		motor.speed = 0.0
		velocity = Vector3.ZERO
	else:
		state = "ground"
		visible = true
		# out of the seat the body meets the world at once but vehicles only after UNSEAT_TICKS: Jolt moves a kinematic
		# body to the transform place() gives it during the next step, so for a step its body is still inside the
		# vehicle, and with the vehicle in the pair the recovery pulled it into the car body (P1-024)
		collision_layer = 0
		collision_mask = 1
		_unseat = UNSEAT_TICKS
		_grounded = true
		_air = 0


func sim_step(dt: float) -> void:
	if state == "seated":
		return
	if _unseat > 0:
		_unseat -= 1
		if _unseat == 0:
			collision_layer = LAYER
			collision_mask = MASK
	var t0 := Time.get_ticks_usec()
	if is_player:
		read_input()
	var jump_edge := _cmd_jump and not _jump_was
	_jump_was = _cmd_jump
	var crouch_edge := _cmd_crouch and not _crouch_was
	_crouch_was = _cmd_crouch
	if state == "vault":
		_vault_step(dt)
	else:
		if crouch_edge and state == "ground":
			_set_crouch(not motor.crouched)
		if motor.crouched and _cmd_sprint and _cmd_move.length() > Motor.DEAD:
			_set_crouch(false)
		_move_step(dt, jump_edge)
	head_h = move_toward(head_h, CROUCH_HEAD if motor.crouched else HEAD, dt * 4.0)
	rotation.y = -motor.heading
	cpu_us += Time.get_ticks_usec() - t0
	cpu_ticks += 1
	if humanoid != null:
		# what the motor is doing, for the stop, start and turn moves (none at a walk or crouched)
		var intent := "walk"
		if not motor.crouched and motor.gait != "walk":
			intent = "stop" if motor.gait == "idle" else ("turn" if motor.turning else "go")
		humanoid.sense(Motor.forward(motor.heading) * motor.speed, motor.heading, view_yaw)
		var shown := "ground" if state == "air" and not _jumped and _air <= FALL_ANIM_TICKS else state
		humanoid.step(dt, shown, motor.speed, motor.crouched, intent)


## A one-shot of the body ("sit_enter" at a vehicle door, "sit_exit" after getting out) over `seconds`.
func pose(shot: String, seconds: float) -> void:
	if humanoid != null:
		humanoid.play(shot, seconds)


func _move_step(dt: float, jump_edge: bool) -> void:
	var on_ground := state == "ground" and _grounded
	if on_ground and jump_edge:
		var fwd := Motor.forward(motor.heading)
		var v := Vault.find(get_world_3d().direct_space_state, global_position, fwd, RADIUS, HEIGHT, MASK, [get_rid()])
		if not v.is_empty() and not motor.crouched:
			_start_vault(v)
			return
		if not motor.crouched:
			vy = Motor.JUMP_V
			state = "air"
			_grounded = false
			_jumped = true
			jumps += 1
	var hv: Vector3
	if state == "air":
		# in the air the stick only turns the body; the run carries on as it left the ground
		var keep := motor.speed
		motor.step(dt, _cmd_move, _cmd_walk, false)
		motor.speed = keep
		hv = Motor.forward(motor.heading) * keep
	else:
		hv = motor.step(dt, _cmd_move, _cmd_walk, _cmd_sprint)
	velocity.x = hv.x
	velocity.z = hv.z
	if state == "ground" and _grounded:
		vy = 0.0
		_air = 0
		velocity.y = 0.0
	else:
		var f := Motor.fall(vy, dt)
		vy = f.x
		velocity.y = f.y / dt
		_air += 1
	# a step may also start within a few ticks of leaving the floor: the round foot often sits on a step edge, which is
	# too steep to count as floor (walker.gd, P0-017)
	if state == "ground" and _air <= COYOTE_TICKS and motor.speed > 0.0 and _step_up(hv * dt):
		_grounded = true
		_air = 0
		vy = 0.0
		velocity.y = 0.0
		return
	move_and_slide()
	velocity.y = vy
	if is_on_floor():
		if state == "air" and vy <= 0.0:
			state = "ground"
		if state == "ground":
			_grounded = true
			_jumped = false
			vy = 0.0
	else:
		_grounded = false
		if state == "ground" and _air > COYOTE_TICKS:
			state = "air"
	if is_on_ceiling() and vy > 0.0:
		vy = 0.0


func _start_vault(v: Dictionary) -> void:
	_vault = v
	_vault_t = 0
	state = "vault"
	vaults += 1
	collision_mask = 0
	velocity = Vector3.ZERO


func _vault_step(dt: float) -> void:
	_vault_t += 1
	var n := maxi(1, roundi(Vault.VAULT_S / dt))
	var u := minf(1.0, float(_vault_t) / n)
	global_position = Vault.path(_vault, Motor.forward(motor.heading), RADIUS, u)
	if _vault_t >= n:
		collision_mask = MASK
		_vault = {}
		state = "ground"
		_grounded = true
		_air = 0
		vy = 0.0
		motor.speed = minf(motor.speed, Motor.JOG)


func _set_crouch(on: bool) -> void:
	if on == motor.crouched:
		return
	if not on:
		# stand up only with room over the head
		var q := PhysicsShapeQueryParameters3D.new()
		var cap := CapsuleShape3D.new()
		cap.radius = RADIUS - 0.02
		cap.height = HEIGHT
		q.shape = cap
		q.collision_mask = MASK
		q.exclude = [get_rid()]
		q.transform = Transform3D(Basis.IDENTITY, global_position + Vector3.UP * (HEIGHT * 0.5 + 0.03))
		if not get_world_3d().direct_space_state.intersect_shape(q, 1).is_empty():
			return
	motor.crouched = on
	var h := CROUCH_HEIGHT if on else HEIGHT
	_shape.height = h
	_cs.position = Vector3(0, h * 0.5, 0)
	# a shorter capsule, not a squashed one
	if _cap_mesh != null:
		_cap_mesh.height = h
		_mesh.position = Vector3(0, h * 0.5, 0)
		_visor.position.y = h * 0.5 - 0.25


## The bench walker's step-up (P0-017): try the move one step higher (up, forward, down); the landing is judged by a ray
## just ahead of the foot, because the round foot lands on the step edge, whose normal is too steep to count as floor.
## The contact test looks 2 cm further than the move (move_and_slide moves along a tilted floor normal and meets a riser
## edge that a flat test would just miss). Where the foot first touches a kerb or riser edge, a short move lands back
## on the tread it stands on and the body would stop dead there: then the step tries the longer moves of STEP_FWD_TRY.
func _step_up(motion: Vector3) -> bool:
	var from := global_transform
	var dir := motion.normalized()
	if not test_move(from, motion + dir * 0.02, _col, safe_margin, false, 4):
		return false
	# only walkable contacts at the feet (a slope, or the edge the foot stands on): move_and_slide climbs it. A kerb or
	# riser edge can report its top face's normal (Jolt), so a walkable normal met above the feet is still a step.
	var step := false
	for i in _col.get_collision_count():
		if _col.get_normal(i).y <= _floor_cos or _col.get_position(i).y - from.origin.y >= 0.03:
			step = true
			break
	if not step:
		return false
	var up_dist := STEP_MAX
	if test_move(from, Vector3(0, STEP_MAX, 0), _col, safe_margin):
		up_dist = _col.get_travel().y
	if up_dist < 0.02:
		return false
	var raised := from.translated(Vector3(0, up_dist, 0))
	# the shortest forward move that lands higher: this tick's move, then STEP_FWD_TRY
	var landed := Transform3D()
	var found := false
	for k in STEP_FWD_TRY.size() + 1:
		var length := motion.length() if k == 0 else maxf(motion.length(), float(STEP_FWD_TRY[k - 1]))
		if k > 0 and length <= motion.length() + 1e-6:
			continue
		var want := dir * length
		var fwd := want
		if test_move(raised, want, _col, safe_margin):
			# blocked one step higher too: the next riser at speed (take the part of the move that fits), or a wall
			fwd = _col.get_travel()
			if fwd.length_squared() < want.length_squared() * 0.04:
				return false
		var over := raised.translated(fwd)
		if not test_move(over, Vector3(0, -up_dist, 0), _col, safe_margin):
			continue # nothing under the foot within a step: a longer move may land on the riser edge
		landed = over.translated(_col.get_travel())
		if landed.origin.y - from.origin.y >= 0.002:
			found = true
			break
	if not found:
		return false
	var ahead := landed.origin + dir * RADIUS
	_ray.from = Vector3(ahead.x, from.origin.y + STEP_MAX + 0.1, ahead.z)
	_ray.to = Vector3(ahead.x, from.origin.y - 0.05, ahead.z)
	var hit := get_world_3d().direct_space_state.intersect_ray(_ray)
	if hit.is_empty() or (hit.normal as Vector3).y < _floor_cos:
		return false
	global_transform = Transform3D(from.basis, landed.origin)
	steps_taken += 1
	return true


## What the probes and state() read.
func info() -> Dictionary:
	var p := global_position
	return {
		"pos": [p.x, p.y, p.z], "heading": motor.heading, "speed": motor.speed, "gait": motor.gait, "state": state,
		"stamina": motor.stamina, "exhausted": motor.exhausted, "crouched": motor.crouched, "grounded": is_grounded(),
		"headY": p.y + head_h, "vaults": vaults, "jumps": jumps, "steps": steps_taken,
		"scriptUsPerTick": snappedf(float(cpu_us) / maxf(1.0, cpu_ticks), 0.01),
		"anim": humanoid.info() if humanoid != null else {},
	}
