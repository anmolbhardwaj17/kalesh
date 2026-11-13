## Driver inputs to wheel commands for every V2 vehicle (from the physics bench's drive_logic.gd, P0-017): gears by
## speed with a shift pause, engine force per gear that fades over the last 15 percent of a gear, a steering wheel with
## a rate limit (slower out than back) and less lock at speed, brakes that work against the direction of travel,
## reverse on the brake pedal at a standstill, and a parking hold with no pedal near a standstill. Pure logic, unit
## tested (game/tests/test_vehicle.gd). `read()` takes the pedals from the InputMap actions, the way a player's keys do.
extends RefCounted

const Tune := preload("res://vehicles/vehicle_tune.gd")

var gear := 1
var shift_timer := 0.0
## Steer angle of the front wheels in radians, positive to the right.
var steer := 0.0
## Newtons per driven wheel, negative in reverse.
var engine := 0.0
## Impulse cap per wheel and step.
var brake := 0.0
var handbrake := false

## Pedals of this tick, 0..1, steer -1 (left) .. 1 (right).
var throttle_in := 0.0
var brake_in := 0.0
var steer_in := 0.0
var handbrake_in := false


## Reads the InputMap actions (throttle, brake, steer_left, steer_right, handbrake).
func read() -> void:
	throttle_in = Input.get_action_strength("throttle")
	brake_in = Input.get_action_strength("brake")
	steer_in = Input.get_axis("steer_left", "steer_right")
	handbrake_in = InputMap.has_action("handbrake") and Input.is_action_pressed("handbrake")


func reset() -> void:
	gear = 1
	shift_timer = 0.0
	steer = 0.0
	engine = 0.0
	brake = 0.0
	handbrake = false
	throttle_in = 0.0
	brake_in = 0.0
	steer_in = 0.0
	handbrake_in = false


## One tick: kmh is the speed along the vehicle's forward axis (negative when rolling back).
func update(tune: Tune, kmh: float, dt: float) -> void:
	var throttle := clampf(throttle_in, 0.0, 1.0)
	var brake_p := clampf(brake_in, 0.0, 1.0)
	var abs_kmh := absf(kmh)
	var gears: Array = tune.gears
	shift_timer = maxf(0.0, shift_timer - dt)
	var top: float = gears[gear - 1]
	if shift_timer <= 0.0 and kmh > -0.5:
		var prev_top: float = gears[gear - 2] if gear > 1 else 0.0
		if abs_kmh >= top * tune.shift_at and gear < gears.size() and throttle > 0.0:
			gear += 1
			shift_timer = tune.shift_pause
		elif gear > 1 and abs_kmh < prev_top * 0.7 and abs_kmh > 3.0:
			gear -= 1
			shift_timer = tune.shift_pause
	if abs_kmh < 2.0 and throttle == 0.0:
		gear = 1
	top = gears[gear - 1]

	var cut := 1.0 - minf(tune.steer_cut_max, abs_kmh / tune.steer_cut_kmh)
	var target := clampf(steer_in, -1.0, 1.0) * tune.max_steer * cut
	var returning := absf(target) < absf(steer)
	var max_delta := (tune.steer_return if returning else tune.steer_rate) * dt
	steer += clampf(target - steer, -max_delta, max_delta)

	var fade := 1.0
	var fade_from := top * (1.0 - tune.fade_share)
	if abs_kmh > fade_from:
		fade = maxf(0.0, 1.0 - (abs_kmh - fade_from) / (top * tune.fade_share))
	engine = 0.0
	if brake_p > 0.05 and kmh > 1.0:
		engine = 0.0
	elif throttle > 0.02:
		# in the shift pause the clutch is out
		var share := tune.force_share(gear) if shift_timer <= 0.0 or gear == 1 else 0.0
		engine = throttle * tune.engine * share * fade * (0.25 if kmh < -1.0 else 1.0)
	elif brake_p > 0.05:
		var rev_fade := clampf((tune.reverse_kmh + kmh) / (tune.reverse_kmh * 0.15), 0.0, 1.0)
		engine = -brake_p * tune.engine * tune.reverse_share * rev_fade
	var fwd_brake := brake_p if (brake_p > 0.05 and kmh > 1.0) else 0.0
	var rev_brake := throttle if (throttle > 0.05 and kmh < -1.0) else 0.0
	brake = maxf(fwd_brake, rev_brake) * tune.brake
	if throttle <= 0.02 and brake_p <= 0.05 and abs_kmh < tune.park_kmh:
		brake = tune.brake
	handbrake = handbrake_in
