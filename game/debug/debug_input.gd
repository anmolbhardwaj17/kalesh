## The input hook of the debug server (docs/GAME_HOOKS.md input(action, value)): drives the game's action layer the way
## a player's keys do, and remembers what it pressed so load() can release it all.
extends RefCounted

## Composite actions the harness scripts use (the browser scaffold's names) mapped onto InputMap actions:
## [negative action, positive action]. Any InputMap action name also works directly.
const COMPOSITE := {
	"throttle": ["brake", "throttle"],
	"steer": ["steer_left", "steer_right"],
	# on foot (P1-022): the move keys and the camera look, -1..1
	"move_y": ["move_back", "move_forward"],
	"move_x": ["move_left", "move_right"],
	"look_x": ["look_left", "look_right"],
	"look_y": ["look_down", "look_up"],
}
var pressed := {}


## Drives the game's action layer like a player: Input.action_press with a strength, release at 0.
func drive(action: String, value: Variant) -> String:
	var v := 0.0
	if value is bool:
		v = 1.0 if value else 0.0
	elif value is float or value is int:
		v = float(value)
	else:
		return "input(%s, value): value must be a number or a boolean" % action
	if COMPOSITE.has(action):
		press(COMPOSITE[action][0], maxf(0.0, -v))
		press(COMPOSITE[action][1], maxf(0.0, v))
		return ""
	if not InputMap.has_action(action):
		return "unknown action '%s' (InputMap actions or %s)" % [action, ", ".join(COMPOSITE.keys())]
	press(action, absf(v))
	return ""


func press(action: String, strength: float) -> void:
	if strength > 0.0:
		Input.action_press(action, clampf(strength, 0.0, 1.0))
		pressed[action] = true
	else:
		Input.action_release(action)
		pressed.erase(action)


func release_all() -> void:
	for action in pressed.keys():
		Input.action_release(action)
	pressed.clear()
