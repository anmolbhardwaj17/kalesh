## The tyre model of the V2 vehicle (TECH.md "Vehicles (V2)"), pure maths on impulses per wheel and step, unit tested
## (game/tests/test_vehicle.gd). Sideways a wheel cancels a share of its side slip; forward it takes the engine
## force or a brake impulse shared between the braked wheels (so a stopped car does not shake); both are cut to the
## grip circle, grip times the suspension force. Same formulas as the old controller, so the KEEP tune maps one to one.
extends RefCounted


## 1 / effective mass of the body at offset r from the centre of mass along a unit direction.
static func inv_mass_along(inv_mass: float, inv_i: Basis, r: Vector3, dir: Vector3) -> float:
	return inv_mass + dir.dot((inv_i * r.cross(dir)).cross(r))


## Side impulse that cancels `damp * stiffness` of the slip velocity `slip` (m/s along the axle).
static func side_impulse(damp: float, stiffness: float, slip: float, inv_m: float) -> float:
	return -damp * stiffness * slip / inv_m


## Forward impulse: the engine force over the step, or a brake impulse that stops the wheel's forward velocity
## `vel` (m/s), shared by `braked` wheels and capped at `brake`.
static func forward_impulse(engine: float, brake: float, vel: float, inv_m: float, braked: int, dt: float) -> float:
	if engine != 0.0:
		return engine * dt
	if brake > 0.0:
		return clampf(-vel / inv_m / maxf(1.0, braked), -brake, brake)
	return 0.0


## Scale (0..1] that brings a wheel's impulses inside its grip circle (the forward impulse counts half, as in the old
## controller: drive and brake keep more of the side grip).
static func grip_scale(fwd: float, side: float, max_impulse: float) -> float:
	var sq := fwd * fwd * 0.25 + side * side
	if sq > max_impulse * max_impulse:
		return max_impulse / sqrt(sq)
	return 1.0
