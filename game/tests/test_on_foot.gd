## The on-foot rules (P1-022): gaits and their speeds, stamina (8 s of sprint, back in 5 s), the 180 degree turn in
## 0.25 s, the jump arc (apex 0.45 m after 0.30 s), the vault path over a wall, the on-foot camera's numbers and the
## door points PlayerMode uses. Pure logic: the motor steps at 60 ticks a second without the engine.
extends RefCounted

const Motor := preload("res://characters/foot_motor.gd")
const Vault := preload("res://characters/vault.gd")
const FootCamera := preload("res://camera/on_foot_camera.gd")
const DT := 1.0 / 60.0

var t
var tree: SceneTree


func _run(m: Motor, ticks: int, move: Vector3, walk := false, sprint := false) -> void:
	for i in ticks:
		m.step(DT, move, walk, sprint)


func test_gaits_reach_the_game_md_speeds() -> void:
	var cases := [["walk", true, false, 1.6], ["jog", false, false, 3.8], ["sprint", false, true, 6.5]]
	for c in cases:
		var m := Motor.new()
		_run(m, 60, Motor.forward(0.0), c[1], c[2])
		t.ok(m.gait == c[0], "%s gait from its keys (got %s)" % [c[0], m.gait])
		t.near(m.speed, c[3], 1e-6, "%s speed" % c[0])
	var cm := Motor.new()
	cm.crouched = true
	_run(cm, 60, Motor.forward(0.0), false, false)
	t.ok(cm.gait == "crouch", "crouched gait")
	t.near(cm.speed, 1.2, 1e-6, "crouch speed")
	var stick := Motor.new()
	_run(stick, 60, Motor.forward(0.0) * 0.4)
	t.ok(stick.gait == "walk", "a stick under half walks")
	var idle := Motor.new()
	_run(idle, 30, Vector3.ZERO)
	t.ok(idle.gait == "idle" and idle.speed == 0.0, "no stick stands")


func test_stamina_lasts_8_s_and_refills_in_5_s() -> void:
	var m := Motor.new()
	var n := 0
	while n < 1000:
		m.step(DT, Motor.forward(0.0), false, true)
		if m.gait != "sprint":
			break
		n += 1
	t.ok(n == 480, "8 s of sprint is 480 ticks (got %d)" % n)
	t.ok(m.exhausted, "an empty bar is exhausted")
	t.ok(m.gait == "jog", "the sprint key jogs on an empty bar")
	t.ok(m.want_gait(1.0, false, true) == "jog", "no sprint while exhausted")
	var r := 0
	var stamina0 := m.stamina
	while m.stamina < 1.0 and r < 1000:
		m.step(DT, Vector3.ZERO, false, false)
		r += 1
	t.ok(absf(r + stamina0 * 300.0 - 300.0) <= 1.0, "5 s from empty to full (%d ticks from %.4f)" % [r, stamina0])
	t.ok(not m.exhausted, "a full bar can sprint again")


func test_a_180_turn_takes_a_quarter_second() -> void:
	var m := Motor.new()
	_run(m, 60, Motor.forward(0.0))
	var n := 0
	var slowest := m.speed
	while absf(Motor.angle_to(m.heading, PI)) > 1e-4 and n < 100:
		m.step(DT, Motor.forward(PI), false, false)
		slowest = minf(slowest, m.speed)
		n += 1
	t.ok(n == 15, "180 degrees in 15 ticks, 0.25 s (got %d)" % n)
	t.ok(slowest < 3.0 and slowest > 1.0, "a hard turn slows the run on the way round (%.2f m/s)" % slowest)


func test_jump_arc_apex() -> void:
	var vy := Motor.JUMP_V
	var y := 0.0
	var top := 0.0
	var top_t := 0
	for i in 60:
		var f := Motor.fall(vy, DT)
		vy = f.x
		y += f.y
		if y > top:
			top = y
			top_t = i + 1
	t.near(top, 0.45, 1e-6, "apex 0.45 m")
	t.ok(top_t == 18, "apex after 18 ticks, 0.30 s (got %d)" % top_t)


func test_vault_path_clears_the_wall() -> void:
	var v := {"from": Vector3(0, 0, 0), "face": 0.75, "top": 1.2, "depth": 0.3, "ledge": false, "landing": Vector3(0, 0, -1.55)}
	var fwd := Vector3(0, 0, -1)
	var r := 0.3
	var prev: Vector3 = Vault.path(v, fwd, r, 0.0)
	t.ok(prev.distance_to(Vector3.ZERO) < 1e-6, "the vault starts at the feet")
	t.ok(Vault.path(v, fwd, r, 1.0).distance_to(v.landing) < 1e-6, "and ends on the landing")
	var max_step := 0.0
	for i in range(1, 37):
		var p: Vector3 = Vault.path(v, fwd, r, i / 36.0)
		max_step = maxf(max_step, p.distance_to(prev))
		prev = p
		# while the capsule overlaps the wall's span its feet are over the top
		var d := -p.z
		if d + r > 0.75 and d - r < 1.05:
			t.ok(p.y >= 1.2, "feet over the top at u %.2f (y %.3f, d %.3f)" % [i / 36.0, p.y, d])
	t.less(max_step, 0.2, "no jump in the path")


func test_camera_numbers() -> void:
	var c := FootCamera.new()
	t.near(c.back, 3.0, 0.0, "3.0 m behind the head")
	t.near(c.shoulder, 0.45, 0.0, "0.45 m to the right")
	t.near(c.base_fov, 65.0, 0.0, "FOV 65")
	t.near(c.sprint_fov, 5.0, 0.0, "plus 5 sprinting")
	t.near(c.min_head, 0.6, 0.0, "never closer than 0.6 m")
	# yaw 0 looks north: the camera sits south of the head (+Z) and to its east (+X, the right shoulder)
	c.yaw = 0.0
	c.pitch = 0.0
	var off: Vector3 = c._offset(0.0, 1.0)
	t.ok(off.z > 2.9 and off.x > 0.4 and absf(off.y) < 1e-5, "behind and right of the head at yaw 0: %s" % off)
	c.yaw = PI * 0.5
	off = c._offset(0.0, 1.0)
	t.ok(off.x < -2.9 and off.z > 0.4, "yaw east: the camera sits west of the head, its right shoulder south: %s" % off)
	t.ok(c._offset(1.35, 0.0).y > 2.5, "the highest lift is over the head")
	c.free()
