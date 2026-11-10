## The box car stand-in. Reads the InputMap actions (throttle, brake, steer_left, steer_right), steps the kinematic
## model (car_model.gd) on the fixed 60 Hz physics tick and places itself. A node faces -Z (north) at rotation 0,
## so rotation.y = -heading turns it to face forward(heading). No negative scale.
extends Node3D

const CarModel := preload("res://scripts/car_model.gd")

var model := CarModel.new()


func _ready() -> void:
	model.x = position.x
	model.z = position.z
	model.heading = -rotation.y
	apply_model()


func _physics_process(delta: float) -> void:
	var throttle := Input.get_action_strength("throttle") - Input.get_action_strength("brake")
	var steer := Input.get_axis("steer_left", "steer_right")
	model.step(throttle, steer, delta)
	apply_model()


## Writes the model's position and heading onto the node.
func apply_model() -> void:
	position = Vector3(model.x, 0.0, model.z)
	rotation = Vector3(0.0, -model.heading, 0.0)
