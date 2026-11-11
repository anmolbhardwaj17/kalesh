## Vehicle tuning data of the physics bench (P0-017). car() is the KEEP tune from decisions.md ("KEEP from
## delhi-drive: car handling numbers as the starting tune"): the numbers of the old Rapier raycast vehicle, with the
## axis signs derived again in this frame (front is -Z, right is +X, up is +Y; no mirroring). The body origin is the
## centre of mass, low in the car as in the old tune. auto() is a first guess for a three wheel auto rickshaw, made
## for this bench only (one steered front wheel, two driven rear wheels, top speed about 65 km/h).
extends RefCounted

var name := "car"
var mass := 1730.0
var inertia := Vector3(3600.0, 3820.0, 814.0)
var box_half := Vector3(0.95, 0.6575, 2.395)
## Centre of the body box above the origin: the box bottom stays more than one wheel radius over the ground.
var box_y := 0.5575
var linear_damp := 0.05
var angular_damp := 0.6
var friction := 0.5
var bounce := 0.05
## One entry per wheel: [x, y, z, steers, drives]. Front is -Z.
var wheels: Array = [
	[-0.78, 0.2, -1.43, true, false], [0.78, 0.2, -1.43, true, false],
	[-0.78, 0.2, 1.43, false, true], [0.78, 0.2, 1.43, false, true],
]
var radius := 0.34
var rest := 0.32
var stiffness := 28.0
var compression := 0.82
var relaxation := 0.88
var travel := 0.3
## Not in the KEEP list: the old code left it at the controller default (6000 N per wheel), as VehicleWheel3D does.
var max_force := 6000.0
## Not in the KEEP list: the Bullet and VehicleWheel3D default.
var roll_influence := 0.1
var grip_front := 3.1
var grip_rear := 2.2
var grip_handbrake := 0.9
var side_front := 1.2
var side_rear := 1.1
var max_steer := 0.64
var steer_rate := 1.10
var steer_return := 1.85
## Steer lock falls with speed: by kmh / steer_cut_kmh, at most steer_cut_max (60 percent from 102 km/h up).
var steer_cut_max := 0.6
var steer_cut_kmh := 170.0
## Newtons per driven wheel.
var engine := 5200.0
var reverse_share := 0.6
## Brake and handbrake are impulse caps per wheel and step, as in the old controller.
var brake := 90.0
var handbrake := 60.0
var yaw_damp := 5200.0
var gears: Array = [34.0, 60.0, 84.0, 100.0, 106.0, 110.0]


static func car() -> RefCounted:
	return new()


static func auto() -> RefCounted:
	var t := new()
	t.name = "auto"
	t.mass = 420.0
	t.inertia = Vector3(315.0, 296.0, 138.0) # a 1.3 by 1.5 by 2.6 m box at 420 kg
	t.box_half = Vector3(0.65, 0.7, 1.3)
	t.box_y = 0.72
	t.wheels = [[0.0, 0.12, -1.0, true, false], [-0.55, 0.12, 0.95, false, true], [0.55, 0.12, 0.95, false, true]]
	t.radius = 0.2
	t.rest = 0.18
	t.stiffness = 45.0
	t.compression = 2.0
	t.relaxation = 3.0
	t.travel = 0.12
	t.max_force = 3000.0
	t.grip_front = 2.6
	t.grip_rear = 2.4
	t.grip_handbrake = 0.9
	t.side_front = 1.0
	t.side_rear = 1.0
	t.max_steer = 0.7
	t.steer_cut_max = 0.5
	t.steer_cut_kmh = 110.0
	t.engine = 560.0
	t.brake = 22.0
	t.handbrake = 15.0
	t.yaw_damp = 600.0
	t.gears = [18.0, 32.0, 48.0, 65.0]
	return t


func half_track() -> float:
	var m := 0.0
	for w in wheels:
		m = maxf(m, absf(w[0]))
	return m


func wheelbase() -> float:
	var lo := 0.0
	var hi := 0.0
	for w in wheels:
		lo = minf(lo, w[2])
		hi = maxf(hi, w[2])
	return hi - lo


## Height of the origin over flat ground at rest (suspension loaded by gravity).
func ride_height(gravity: float = 9.8) -> float:
	var sag := gravity / (stiffness * wheels.size())
	return radius + (rest - sag) - float(wheels[0][1])


func to_dict() -> Dictionary:
	return {
		"name": name, "massKg": mass, "inertia": [inertia.x, inertia.y, inertia.z], "boxHalf": [box_half.x, box_half.y, box_half.z], "boxY": box_y,
		"linearDamp": linear_damp, "angularDamp": angular_damp, "friction": friction, "bounce": bounce, "wheels": wheels,
		"radius": radius, "rest": rest, "stiffness": stiffness, "compression": compression, "relaxation": relaxation, "travel": travel,
		"maxForce": max_force, "rollInfluence": roll_influence, "gripFront": grip_front, "gripRear": grip_rear, "gripHandbrake": grip_handbrake,
		"sideFront": side_front, "sideRear": side_rear, "maxSteer": max_steer, "steerRate": steer_rate, "steerReturn": steer_return,
		"steerCutMax": steer_cut_max, "steerCutKmh": steer_cut_kmh, "engineN": engine, "reverseShare": reverse_share, "brake": brake,
		"handbrake": handbrake, "yawDamp": yaw_damp, "gearTopKmh": gears,
	}
