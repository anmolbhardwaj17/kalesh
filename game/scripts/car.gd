## The box car stand-in. Reads the InputMap actions (throttle, brake, steer_left, steer_right) and steps the kinematic
## model (car_model.gd) on the sim tick (SimClock.sim_tick: fixed 60 Hz, with time scale and the sim hold), then
## places itself. A node faces -Z (north) at rotation 0, so rotation.y = -heading turns it to face forward(heading).
## No negative scale. In the group "player" (the debug hooks read and teleport it there).
extends Node3D

const CarModel := preload("res://scripts/car_model.gd")

var model := CarModel.new()


func _ready() -> void:
	add_to_group("player")
	model.x = position.x
	model.z = position.z
	model.heading = -rotation.y
	apply_model()
	var clock := get_node_or_null("/root/SimClock")
	if clock != null:
		clock.sim_tick.connect(sim_step)


func sim_step(dt: float) -> void:
	var throttle := Input.get_action_strength("throttle") - Input.get_action_strength("brake")
	var steer := Input.get_axis("steer_left", "steer_right")
	model.step(throttle, steer, dt)
	apply_model()


## Puts the car at a ground position and stops it (staging only: debug teleport, scene start).
func place(x: float, z: float, heading: float = NAN) -> void:
	model.x = x
	model.z = z
	if not is_nan(heading):
		model.heading = heading
	model.speed = 0.0
	apply_model()


## Writes the model's position and heading onto the node.
func apply_model() -> void:
	position = Vector3(model.x, 0.0, model.z)
	rotation = Vector3(0.0, -model.heading, 0.0)
