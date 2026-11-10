## Placeholder car model, pure logic (no nodes), so it is unit tested. Port of the retired three.js car model: same numbers, same rules.
## World axes: east +X, north -Z, up +Y, 1 unit = 1 metre.
## heading is the compass heading in radians: 0 = north, PI/2 = east (clockwise seen from above).
extends RefCounted

const ACCEL := 8.0
const BRAKE := 14.0
const DRAG := 0.6
const MAX_SPEED := 30.0
const MAX_REVERSE := 8.0
const TURN_RATE := 1.6

var x := 0.0 # metres east
var z := 0.0 # metres south (north is -Z)
var heading := 0.0
var speed := 0.0 # m/s along the heading


## The unit vector a car with this heading drives along. forward(0) is -Z (north), forward(PI/2) is +X (east).
static func forward(h: float) -> Vector3:
	return Vector3(sin(h), 0.0, -cos(h))


## One step. throttle -1..1 (negative brakes, then reverses), steer -1 (left) .. 1 (right), dt in seconds.
func step(throttle: float, steer: float, dt: float) -> void:
	var t := clampf(throttle, -1.0, 1.0)
	var st := clampf(steer, -1.0, 1.0)
	var s := speed
	if t > 0.0:
		s += ACCEL * t * dt
	elif t < 0.0:
		s += (BRAKE if s > 0.0 else ACCEL) * t * dt
	s -= s * DRAG * dt
	s = clampf(s, -MAX_REVERSE, MAX_SPEED)
	if absf(s) < 0.01 and t == 0.0:
		s = 0.0
	var grip := minf(1.0, absf(s) / 4.0)
	heading += st * TURN_RATE * grip * signf(s) * dt
	var f := forward(heading)
	x += f.x * s * dt
	z += f.z * s * dt
	speed = s
