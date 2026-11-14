## Road access by mode for the player (P2-045, the access model of P2-042): a car or an auto driven where no lane piece
## or junction path under it lets its mode in (a car-free street, a two-wheeler gali) is a violation. Most such streets have no bollards (a
## gali closed by width or context, decisions.md 2026-11-14): nothing stops the vehicle, so the game raises one
## `access_violation` event per entry (GameEvents, docs/GAME_HOOKS.md events), the hook for the later police and
## wanted level. A child of the streamed city (game/world/world_stream.gd); it reads the lanes system and moves nothing.
## Steps on the sim tick, every STEP_S of sim.
extends Node

const LaneRouter := preload("res://ai/lane_router.gd")
## Sim seconds between two checks.
const STEP_S := 0.1
## Checks in a row on a closed piece before the entry counts (a vehicle crossing a junction past a gali's mouth
## touches its first metre and leaves).
const CONFIRM := 3
## Sim seconds back on open pieces before a new entry can count again.
const RESET_S := 2.0
## A piece (lane or junction path) is under the vehicle when its centre line is within half its width plus this, in plan.
const SIDE_SLACK_M := 0.75
## A bollard or gate line that stops cars (the tile folder's access.json) this near the entry: `barrier` true.
const BARRIER_NEAR_M := 40.0

var lanes: RefCounted
## Car-stopping barrier lines of the tile folder: [Vector2(x, z)].
var barriers: Array[Vector2] = []
## True while the player's vehicle is inside a piece closed to its mode (from the confirmed entry until RESET_S on
## open pieces).
var inside := false
var violations := 0
## The last event's data, {} before the first.
var last := {}
## The piece the vehicle was last on: {id, mode, allowed}.
var on := {}
var _acc := 0.0
var _closed_checks := 0
var _open_s := 0.0


func setup(lanes_system: RefCounted, folder: String) -> void:
	lanes = lanes_system
	var f := folder + "access.json"
	if not FileAccess.file_exists(f):
		return
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(f))
	if typeof(parsed) != TYPE_DICTIONARY:
		return
	for b: Dictionary in (parsed as Dictionary).get("barriers", []):
		if bool(b.get("stopsCar", false)):
			barriers.append(Vector2(float(b.x), float(b.z)))


func _ready() -> void:
	var clock := get_node_or_null("/root/SimClock")
	if clock != null:
		clock.sim_tick.connect(_tick)


func _tick(dt: float) -> void:
	_acc += dt
	if _acc + 1e-6 < STEP_S:
		return
	_acc = 0.0
	check()


## One check of the player's vehicle against the piece under it.
func check() -> void:
	var p := get_tree().get_first_node_in_group("player") as Node3D
	if lanes == null or p == null or not p.has_method("foot_position"):
		# on foot: a walker may go anywhere a walker can reach
		_closed_checks = 0
		return
	var mode := LaneRouter.mode_of_player(p)
	var at: Vector3 = p.foot_position()
	# every piece under the vehicle, lanes and junction paths: the spot is open when one of them lets the mode in (a
	# car crossing a junction stands on its own open path and on the closed path into a gali at once)
	var under: Dictionary = {}
	var allowed := false
	for id: String in lanes.near(at.x, at.z, 8.0):
		var c: Dictionary = lanes.closest_on(id, at.x, at.y, at.z, 2.5)
		if c.is_empty() or float(c.d) > float(lanes.piece(id).width) * 0.5 + SIDE_SLACK_M:
			continue
		if lanes.allows(id, mode):
			allowed = true
		if under.is_empty() or float(c.d) < float(under.d):
			under = c
	if under.is_empty():
		# between pieces (a forecourt, off the road): the state stays
		return
	var piece: Dictionary = lanes.piece(under.id)
	var c := under
	on = {"id": c.id, "mode": mode, "allowed": allowed}
	if allowed:
		_closed_checks = 0
		if inside:
			_open_s += STEP_S
			if _open_s >= RESET_S:
				inside = false
		return
	_open_s = 0.0
	_closed_checks += 1
	if inside or _closed_checks < CONFIRM:
		return
	inside = true
	violations += 1
	last = {"piece": c.id, "mode": mode, "pos": [at.x, at.y, at.z], "cls": piece.cls, "widthM": piece.width,
		"modes": piece.get("modes", []), "barrier": _barrier_near(at)}
	var ev := get_node_or_null("/root/GameEvents")
	if ev != null:
		ev.emit_event("access_violation", last)


func _barrier_near(at: Vector3) -> bool:
	for b in barriers:
		if b.distance_to(Vector2(at.x, at.z)) <= BARRIER_NEAR_M:
			return true
	return false


## What state().world.access reports.
func info() -> Dictionary:
	return {"violations": violations, "inside": inside, "on": on, "last": last, "barriers": barriers.size()}
