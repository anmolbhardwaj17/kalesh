## The main scene: no node under the world root has a negative scale or a mirrored basis; the V2 car node faces
## forward(heading) with rotation.y = -heading; the north post is 50 m along -Z and ahead of the chase camera when the car faces north.
extends RefCounted

const MAIN := preload("res://scenes/main.tscn")

var t
var tree: SceneTree


## The forward axis of a compass heading (0 is north, -Z; PI/2 is east, +X): the axis rule every node follows.
static func forward(h: float) -> Vector3:
	return Vector3(sin(h), 0.0, -cos(h))


func test_forward_axis_rule() -> void:
	var n := forward(0.0)
	t.near(n.x, 0.0, 1e-6, "forward(0).x")
	t.near(n.z, -1.0, 1e-6, "forward(0).z is -1 (north is -Z)")
	var e := forward(PI / 2.0)
	t.near(e.x, 1.0, 1e-6, "forward(PI/2).x is +1 (east is +X)")
	t.near(e.z, 0.0, 1e-6, "forward(PI/2).z")


func _with_main(fn: Callable) -> void:
	var main: Node3D = MAIN.instantiate()
	tree.root.add_child(main)
	fn.call(main)
	tree.root.remove_child(main)
	main.free()


func _walk(n: Node, out: Array) -> void:
	out.append(n)
	for c in n.get_children():
		_walk(c, out)


func test_no_negative_scale_under_world_root() -> void:
	_with_main(func(main: Node3D) -> void:
		var world := main.get_node("World") as Node3D
		t.ok(world != null, "main scene has a World root")
		var nodes := []
		_walk(world, nodes)
		var count := 0
		for n in nodes:
			if n is Node3D:
				count += 1
				var s: Vector3 = n.scale
				t.ok(s.x > 0.0 and s.y > 0.0 and s.z > 0.0, "%s scale %s has no negative or zero axis" % [n.get_path(), s])
				t.ok(n.global_transform.basis.determinant() > 0.0, "%s global basis is not mirrored" % n.get_path())
		t.ok(count >= 6, "walked %d Node3D nodes under World" % count))


func test_car_node_faces_forward_heading() -> void:
	_with_main(func(main: Node3D) -> void:
		var car = main.get_node("World/Car")
		for h in [0.0, PI / 2.0, PI, -PI / 4.0]:
			car.place(0.0, 0.0, h)
			var fwd: Vector3 = -car.global_transform.basis.z
			var want := forward(h)
			t.ok(fwd.distance_to(want) < 1e-5, "car -basis.z %s matches forward(%.3f) %s" % [fwd, h, want])
			var d: float = car.rotation.y + h
			t.ok(absf(sin(d)) < 1e-5 and cos(d) > 0.0, "rotation.y %.5f is -heading for heading %.3f" % [car.rotation.y, h])
			t.ok(absf(sin(float(car.heading) - h)) < 1e-5 and cos(float(car.heading) - h) > 0.0, "the car reads back heading %.3f (%.5f)" % [h, car.heading]))


func test_north_post_ahead_of_camera_facing_north() -> void:
	_with_main(func(main: Node3D) -> void:
		var post := main.get_node("World/NorthPost") as Node3D
		var cam := main.get_node("ChaseCamera") as Camera3D
		var car = main.get_node("World/Car")
		t.near(post.global_position.x, 0.0, 1e-6, "north post x")
		t.near(post.global_position.z, -50.0, 1e-6, "north post z is -50 (50 m north)")
		car.place(0.0, 0.0, 0.0)
		cam.snap()
		cam.follow(1.0 / 60.0)
		var look: Vector3 = -cam.global_transform.basis.z
		t.ok(look.z < -0.9, "camera looks along -Z when the car faces north (look %s)" % look)
		t.ok(cam.global_position.z > car.global_position.z, "camera sits south of (behind) the car")
		t.ok(not cam.is_position_behind(post.global_position), "north post is in front of the camera")
		t.ok(cam.is_position_in_frustum(post.global_position), "north post is inside the camera frustum"))


## The chase camera rig (P1-020): wide 6.6 m behind and 2.5 m up at rest with FOV 70; V's close view 4.5 m and 2.05 m;
## C looks back from in front of the car; never under 0.5 m above the car.
func test_chase_camera_views() -> void:
	_with_main(func(main: Node3D) -> void:
		var cam = main.get_node("ChaseCamera")
		var car = main.get_node("World/Car")
		car.place(0.0, 0.0, 0.0)
		var p: Vector3 = car.global_position
		cam.snap()
		cam.follow(1.0 / 60.0)
		t.near(cam.global_position.z - p.z, 6.6, 1e-3, "wide view: 6.6 m behind (south of) the car facing north")
		t.near(cam.global_position.y - p.y, 2.5, 1e-3, "wide view: 2.5 m up")
		t.near(cam.fov, 70.0, 1e-3, "FOV 70 at rest")
		cam.set_view("close")
		for i in 120:
			cam.follow(1.0 / 60.0)
		t.near(cam.global_position.z - p.z, 4.5, 0.01, "close view: 4.5 m behind after the blend")
		t.near(cam.global_position.y - p.y, 2.05, 0.01, "close view: 2.05 m up after the blend")
		cam.looking_back = true
		cam.follow(1.0 / 60.0)
		t.ok(cam.global_position.z < p.z - 3.0, "look back: the camera sits in front of (north of) the car (z %.2f)" % cam.global_position.z)
		t.ok((-cam.global_transform.basis.z).z > 0.5, "look back: it looks south, behind the car")
		t.ok(cam.global_position.y >= p.y + 0.5, "never under 0.5 m above the car"))
