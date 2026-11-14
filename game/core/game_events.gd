## Autoload GameEvents: a ring buffer of recent game events for the harness (docs/GAME_HOOKS.md events()).
## Each event is {seq, t (sim s), w (wall ms since start), type, data}. Cheap, so it runs with or without --debug.
## Event types the harness reads: checkpoint, objective_complete, milestone:done, milestone:failed, ai:state,
## dialogue:line, error (unexpected engine or script errors, sent by the debug server), sim:hold, access_violation (P2-045).
extends Node

const RING := 200

var seq := 0
var ring: Array[Dictionary] = []


func emit_event(type: String, data: Variant = null) -> void:
	seq += 1
	var clock := get_node_or_null("/root/SimClock") if is_inside_tree() else null
	var e := {"seq": seq, "t": clock.t if clock != null else 0.0, "w": Time.get_ticks_msec(), "type": type}
	if data != null:
		e["data"] = data
	ring.append(e)
	if ring.size() > RING:
		ring.pop_front()


## Events with seq above `after` (all of them for 0).
func since(after: int) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for e in ring:
		if int(e.seq) > after:
			out.append(e)
	return out
