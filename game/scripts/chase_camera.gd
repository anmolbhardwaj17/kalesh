## Chase camera stand-in, same rig as the browser scaffold: 10 m behind the car, 4.5 m up, looking at a point 6 m
## ahead and 1 m up. Runs after the car on the physics tick (higher process_physics_priority).
extends Camera3D

const CarModel := preload("res://scripts/car_model.gd")

@export var target_path: NodePath
@export var back := 10.0
@export var height := 4.5
@export var look_ahead := 6.0


func _ready() -> void:
	process_physics_priority = 10
	follow()


func _physics_process(_delta: float) -> void:
	follow()


func follow() -> void:
	var car := get_node_or_null(target_path) as Node3D
	if car == null:
		return
	var h: float = car.model.heading if "model" in car else -car.rotation.y
	var f := CarModel.forward(h)
	var p := car.global_position
	global_position = Vector3(p.x - f.x * back, height, p.z - f.z * back)
	look_at(Vector3(p.x + f.x * look_ahead, 1.0, p.z + f.z * look_ahead), Vector3.UP)
