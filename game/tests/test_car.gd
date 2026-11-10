## Car model port (game/scripts/car_model.gd) of the retired three.js car tests, and the forward(heading) axis rule.
extends RefCounted

const CarModel := preload("res://scripts/car_model.gd")

var t
var tree: SceneTree


func _run(throttle: float, steer: float, secs: float, speed := 0.0):
	var c := CarModel.new()
	c.speed = speed
	for i in int(secs * 60):
		c.step(throttle, steer, 1.0 / 60.0)
	return c


func test_forward_axis_rule() -> void:
	var n := CarModel.forward(0.0)
	t.near(n.x, 0.0, 1e-6, "forward(0).x")
	t.near(n.z, -1.0, 1e-6, "forward(0).z is -1 (north is -Z)")
	var e := CarModel.forward(PI / 2.0)
	t.near(e.x, 1.0, 1e-6, "forward(PI/2).x is +1 (east is +X)")
	t.near(e.z, 0.0, 1e-6, "forward(PI/2).z")


func test_throttle_at_heading_0_drives_north() -> void:
	var c = _run(1.0, 0.0, 2.0)
	t.less(c.z, -5.0, "z after 2 s of throttle")
	t.near(c.x, 0.0, 1e-6, "x stays 0")


func test_steer_right_turns_east() -> void:
	var c = _run(1.0, 1.0, 2.0)
	t.ok(c.heading > 0.0, "heading grows when steering right")
	t.ok(c.x > 0.0, "x is positive (east) after a right turn")


func test_stops_with_no_input() -> void:
	var c = _run(0.0, 0.0, 20.0, 10.0)
	t.less(absf(c.speed), 0.05, "speed after 20 s coasting")
