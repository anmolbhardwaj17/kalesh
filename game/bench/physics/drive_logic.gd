## Driver inputs to wheel commands, shared by both bench vehicles (V1 VehicleBody3D and V2 our own raycast vehicle),
## so the two differ only in the wheel and body model. The rules are the old car's, with its numbers in tune.gd:
## gears by speed with a 0.3 s shift pause, engine force that fades over the last 15 percent of a gear, a steering
## wheel with a rate limit (slower out than back) and less lock at speed, brakes that work against the direction of
## travel, reverse on the brake pedal at a standstill. Pure logic, unit tested.
extends RefCounted

const Tune := preload("res://bench/physics/tune.gd")
const SHIFT_PAUSE := 0.3

var gear := 1
var shift_timer := 0.0
## Steer angle of the front wheels in radians, positive to the right.
var steer := 0.0
## Newtons per driven wheel, negative in reverse.
var engine := 0.0
## Impulse cap per wheel and step.
var brake := 0.0
var handbrake := false


func update(tune: Tune, kmh: float, throttle: float, brake_in: float, steer_in: float, hb: bool, dt: float) -> void:
	var abs_kmh := absf(kmh)
	var gears: Array = tune.gears
	shift_timer = maxf(0.0, shift_timer - dt)
	var top: float = gears[gear - 1]
	if shift_timer <= 0.0 and kmh > -0.5:
		var prev_top: float = gears[gear - 2] if gear > 1 else 0.0
		if abs_kmh >= top * 0.92 and gear < gears.size() and throttle > 0.0:
			gear += 1
			shift_timer = SHIFT_PAUSE
		elif gear > 1 and abs_kmh < prev_top * 0.7 and abs_kmh > 3.0:
			gear -= 1
			shift_timer = SHIFT_PAUSE
	if abs_kmh < 2.0 and throttle == 0.0:
		gear = 1
	top = gears[gear - 1]

	var cut := 1.0 - minf(tune.steer_cut_max, abs_kmh / tune.steer_cut_kmh)
	var target := clampf(steer_in, -1.0, 1.0) * tune.max_steer * cut
	var returning := absf(target) < absf(steer)
	var max_delta := (tune.steer_return if returning else tune.steer_rate) * dt
	steer += clampf(target - steer, -max_delta, max_delta)

	var fade := 1.0
	if abs_kmh > top * 0.85:
		fade = maxf(0.0, 1.0 - (abs_kmh - top * 0.85) / (top * 0.15))
	engine = 0.0
	if brake_in > 0.05 and kmh > 1.0:
		engine = 0.0
	elif throttle > 0.02:
		engine = throttle * tune.engine * fade * (0.25 if kmh < -1.0 else 1.0)
	elif brake_in > 0.05:
		engine = -brake_in * tune.engine * tune.reverse_share
	var fwd_brake := brake_in if (brake_in > 0.05 and kmh > 1.0) else 0.0
	var rev_brake := throttle if (throttle > 0.05 and kmh < -1.0) else 0.0
	brake = maxf(fwd_brake, rev_brake) * tune.brake
	handbrake = hb
