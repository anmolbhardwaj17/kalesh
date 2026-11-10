## The main scene: no node under the world root has a negative scale or a mirrored basis; the car node faces
## forward(heading); the north post is 50 m along -Z and ahead of the chase camera when the car faces north.
extends RefCounted

const CarModel := preload("res://scripts/car_model.gd")
const MAIN := preload("res://scenes/main.tscn")

var t
var tree: SceneTree


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
			car.model.heading = h
			car.apply_model()
			var fwd: Vector3 = -car.global_transform.basis.z
			var want := CarModel.forward(h)
			t.ok(fwd.distance_to(want) < 1e-5, "car -basis.z %s matches forward(%.3f) %s" % [fwd, h, want]))


func test_north_post_ahead_of_camera_facing_north() -> void:
	_with_main(func(main: Node3D) -> void:
		var post := main.get_node("World/NorthPost") as Node3D
		var cam := main.get_node("ChaseCamera") as Camera3D
		var car = main.get_node("World/Car")
		t.near(post.global_position.x, 0.0, 1e-6, "north post x")
		t.near(post.global_position.z, -50.0, 1e-6, "north post z is -50 (50 m north)")
		car.model.heading = 0.0
		car.apply_model()
		cam.follow()
		var look: Vector3 = -cam.global_transform.basis.z
		t.ok(look.z < -0.9, "camera looks along -Z when the car faces north (look %s)" % look)
		t.ok(cam.global_position.z > car.global_position.z, "camera sits south of (behind) the car")
		t.ok(not cam.is_position_behind(post.global_position), "north post is in front of the camera")
		t.ok(cam.is_position_in_frustum(post.global_position), "north post is inside the camera frustum"))
