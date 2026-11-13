## The tuning data of one vehicle (TECH.md "Vehicles (V2)"): body, wheels, suspension, tyres, steering, engine, gears,
## brakes and health. One file per vehicle in game/data/vehicles/<id>.tres. Axes: front is -Z, right is +X, up is +Y
## (no mirroring); the body origin is the centre of mass. The defaults are the KEEP numbers from the old game
## (decisions.md "KEEP from delhi-drive: car handling numbers"); the .tres files hold the retuned values. No class_name:
## loaded by path.
extends Resource

@export var id := "car"
@export var mass := 1730.0
@export var inertia := Vector3(3600.0, 3820.0, 814.0)
## Half extents of the collision box and the height of its centre above the origin.
@export var box_half := Vector3(0.95, 0.6575, 2.395)
@export var box_y := 0.5575
@export var linear_damp := 0.05
@export var angular_damp := 0.6
@export var friction := 0.5
@export var bounce := 0.05
## One entry per wheel: [x, y, z, steers, drives]. Front is -Z. Any count: 3 for the auto, 4 for a car.
@export var wheels: Array = [
	[-0.78, 0.2, -1.43, true, false], [0.78, 0.2, -1.43, true, false],
	[-0.78, 0.2, 1.43, false, true], [0.78, 0.2, 1.43, false, true],
]
@export var radius := 0.34
@export var wheel_width := 0.22

@export_group("Suspension")
## Spring and damper per unit mass (the old controller's numbers): force = mass * (stiffness * compression_m - damper * v).
@export var rest := 0.32
@export var stiffness := 28.0
@export var compression := 0.82
@export var relaxation := 0.88
@export var travel := 0.3
@export var max_force := 6000.0
## Share of the side impulse that acts at the contact point height (the rest acts at the centre of mass): less lean.
@export var roll_influence := 0.1

@export_group("Tyres")
@export var grip_front := 3.1
@export var grip_rear := 2.2
@export var grip_handbrake := 0.9
@export var side_front := 1.2
@export var side_rear := 1.1
## Share of the side slip one wheel cancels per step (the old controller's contact damping).
@export var side_damp := 0.2

@export_group("Steering")
@export var max_steer := 0.64
@export var steer_rate := 1.10
@export var steer_return := 1.85
## Steer lock falls with speed: by kmh / steer_cut_kmh, at most steer_cut_max.
@export var steer_cut_max := 0.6
@export var steer_cut_kmh := 170.0
## Quadratic yaw damping against a spin (off on the handbrake, so a drift stays free).
@export var yaw_damp := 5200.0

@export_group("Engine and brakes")
## Newtons per driven wheel in first gear.
@export var engine := 5200.0
## Engine force share per gear (1 = `engine`). Missing entries count as 1.
@export var gear_force: Array = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0]
## Top speed of each gear in km/h; the engine force fades over the last `fade_share` of a gear (to 0 at its top).
@export var gears: Array = [34.0, 60.0, 84.0, 100.0, 106.0, 110.0]
@export var fade_share := 0.15
## Shift up at this share of the gear's top speed (with the throttle down).
@export var shift_at := 0.92
@export var shift_pause := 0.3
@export var reverse_share := 0.6
@export var reverse_kmh := 30.0
## Brake and handbrake are impulse caps per wheel and step (N s).
@export var brake := 90.0
@export var handbrake := 60.0
## With no pedal below this speed the brakes hold the car (it does not roll away on a slope).
@export var park_kmh := 2.0

@export_group("Health")
## Data only for now (GAME.md "Vehicles and driving"): smoke under smoke_at, disabled at 0.
@export var health := 1000.0
@export var smoke_at := 300.0


func half_track() -> float:
	var m := 0.0
	for w in wheels:
		m = maxf(m, absf(float(w[0])))
	return m


func wheelbase() -> float:
	var lo := 0.0
	var hi := 0.0
	for w in wheels:
		lo = minf(lo, float(w[2]))
		hi = maxf(hi, float(w[2]))
	return hi - lo


## Height of the origin over flat ground at rest (the suspension loaded by gravity).
func ride_height(gravity: float = 9.8) -> float:
	var sag := gravity / (stiffness * wheels.size())
	return radius + (rest - sag) - float(wheels[0][1])


func force_share(gear: int) -> float:
	return float(gear_force[gear - 1]) if gear >= 1 and gear <= gear_force.size() else 1.0


func to_dict() -> Dictionary:
	return {
		"id": id, "massKg": mass, "rideHeightM": snappedf(ride_height(), 0.0001), "wheels": wheels.size(), "radius": radius,
		"stiffness": stiffness, "compression": compression, "relaxation": relaxation, "gripFront": grip_front, "gripRear": grip_rear,
		"maxSteer": max_steer, "engineN": engine, "gearForce": gear_force, "gearTopKmh": gears, "brake": brake, "health": health,
	}
