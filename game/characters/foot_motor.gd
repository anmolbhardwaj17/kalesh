## The on-foot movement rules (GAME.md "Movement and camera feel", TECH.md "On foot and combat (F1, CB1)"): which gait a
## command asks for, the speed it ramps to, the stamina of a sprint, how fast the body turns and the jump arc. Pure logic
## on numbers, stepped once per sim tick by on_foot.gd and tested in game/tests/test_on_foot.gd.
## Compass headings: 0 is north (-Z), PI/2 is east (+X).
extends RefCounted

const WALK := 1.6
const JOG := 3.8
const SPRINT := 6.5
const CROUCH := 1.2
## A full stamina bar lasts SPRINT_S of sprinting and comes back in REGEN_S. An empty bar blocks the sprint until it is
## back to RESPRINT.
const SPRINT_S := 8.0
const REGEN_S := 5.0
const RESPRINT := 0.25
## Ground speed changes (P2-041: a body with weight; before, 22 and 26 m/s2 put a sprint under the feet in 0.3 s).
## Speeding up: ACCEL (m/s2) up to the jog's speed, ACCEL_FAST above it (rest to a jog in 0.45 s, to a sprint in
## 0.9 s). Slowing down: DECEL (a jog stops in 0.4 s over 0.58 m, a sprint in 0.6 s over 1.7 m). The push builds up
## at JERK (m/s3) instead of being there at once, and the last of a change eases in: within EASE_GAP of the target
## the rate falls with the gap (rate = gap x EASE) down to RATE_MIN, so the speed curve has no corner at either end.
const ACCEL := 10.0
const ACCEL_FAST := 7.0
const DECEL := 13.0
const JERK := 150.0
const EASE := 14.0
const RATE_MIN := 2.5
## 180 degrees in 0.25 s.
const TURN_RATE := PI / 0.25
## Jump apex 0.45 m reached in 0.30 s: launch speed 2h/t, gravity 2h/t^2 (also the fall of a step off a ledge).
const JUMP_APEX := 0.45
const JUMP_T := 0.30
const JUMP_V := 2.0 * JUMP_APEX / JUMP_T
const GRAVITY := 2.0 * JUMP_APEX / (JUMP_T * JUMP_T)
## A stick under this share walks; a stick under DEAD stands.
const WALK_STICK := 0.5
const DEAD := 0.05

## Compass heading the body faces.
var heading := 0.0
## Ground speed along the heading, m/s.
var speed := 0.0
## 0..1.
var stamina := 1.0
var exhausted := false
var crouched := false
## "idle", "walk", "jog", "sprint", "crouch".
var gait := "idle"
## Ticks spent sprinting since the bar was last full (for the probes).
var sprint_ticks := 0
## Rate of change of the ground speed now (m/s2, signed) and whether the body is turning back (over a right angle
## still to go): what the animation reads for the lean, the stop and the plant-and-turn.
var accel := 0.0
var turning := false


static func forward(h: float) -> Vector3:
	return Vector3(sin(h), 0.0, -cos(h))


static func heading_of(v: Vector3) -> float:
	return atan2(v.x, -v.z)


## Smallest signed angle from a to b (radians, -PI..PI).
static func angle_to(a: float, b: float) -> float:
	return wrapf(b - a, -PI, PI)


## The gait a move command asks for: `move` is the world direction with the stick's strength as its length (0..1).
func want_gait(move_len: float, walk_held: bool, sprint_held: bool) -> String:
	if move_len < DEAD:
		return "idle"
	if crouched:
		return "crouch"
	if sprint_held and not exhausted and stamina > 0.0:
		return "sprint"
	if walk_held or move_len < WALK_STICK:
		return "walk"
	return "jog"


static func gait_speed(g: String) -> float:
	match g:
		"walk":
			return WALK
		"jog":
			return JOG
		"sprint":
			return SPRINT
		"crouch":
			return CROUCH
	return 0.0


## One tick on the ground: turns toward `move` (world, length = stick strength), ramps the speed to the gait's and
## spends or refills stamina. Answers the horizontal velocity to move by this tick.
func step(dt: float, move: Vector3, walk_held: bool, sprint_held: bool) -> Vector3:
	move.y = 0.0
	var m := minf(1.0, move.length())
	gait = want_gait(m, walk_held, sprint_held)
	var target := gait_speed(gait)
	turning = false
	if m >= DEAD:
		var err := angle_to(heading, heading_of(move))
		var turn := clampf(err, -TURN_RATE * dt, TURN_RATE * dt)
		heading = wrapf(heading + turn, -PI, PI)
		# a turn of more than a right angle still to go slows the run, so a 180 is a tight arc, not a wide loop
		if absf(err) > PI * 0.5:
			target *= 0.4
			turning = true
	speed = ramp(speed, target, dt)
	_stamina(dt)
	return forward(heading) * speed


## The ground speed a tick later on its way to `target`: the rate builds up at JERK, holds at ACCEL (ACCEL_FAST above
## the jog) or DECEL, and eases off with the gap that is left.
func ramp(v: float, target: float, dt: float) -> float:
	var gap := target - v
	if absf(gap) < 1e-9:
		accel = 0.0
		return target
	var cap := DECEL if gap < 0.0 else (ACCEL if v < JOG - 1e-6 else ACCEL_FAST)
	var want := signf(gap) * minf(cap, maxf(absf(gap) * EASE, RATE_MIN))
	# a push in a new direction builds up; easing off is free
	if signf(want) != signf(accel) or absf(want) > absf(accel):
		accel = move_toward(accel if signf(want) == signf(accel) else 0.0, want, JERK * dt)
	else:
		accel = want
	var next := v + accel * dt
	if (gap > 0.0 and next >= target) or (gap < 0.0 and next <= target):
		accel = 0.0
		return target
	return next


## Stamina for one tick: a sprint tick spends 1/(SPRINT_S * 60) of the bar, any other tick refills 1/(REGEN_S * 60).
func _stamina(dt: float) -> void:
	if gait == "sprint":
		stamina = maxf(0.0, stamina - dt / SPRINT_S)
		sprint_ticks += 1
		if stamina <= 1e-6:
			stamina = 0.0
			exhausted = true
	else:
		stamina = minf(1.0, stamina + dt / REGEN_S)
		if exhausted and stamina >= RESPRINT:
			exhausted = false
		if stamina >= 1.0:
			sprint_ticks = 0


## One tick of a jump or a fall: the vertical speed after dt and the distance to move this tick (the mean of the speeds
## at both ends, so the arc is the exact parabola: apex JUMP_APEX after JUMP_T, whatever the tick).
static func fall(vy: float, dt: float) -> Vector2:
	var after := vy - GRAVITY * dt
	return Vector2(after, (vy + after) * 0.5 * dt)
