## Measures the game logic time of each frame for the debug perf hook: a START probe runs before every other node
## (lowest process and physics priority) and an END probe after every other node's _process. logic_ms is the wall
## time from the first physics or process callback of a frame to the last _process callback. (Performance monitors
## TIME_PROCESS and TIME_PHYSICS_PROCESS only refresh about once a second, so they cannot give per frame numbers.)
extends Node

const FIRST := -1000000
const LAST := 1000000

var is_start := true
## Shared between the pair: the START probe owns the frame start; the END probe writes logic_ms onto it.
var partner: Node = null
var frame_start_us := 0
var in_frame := false
var logic_ms := 0.0


func setup(start: bool, other: Node) -> void:
	is_start = start
	partner = other
	process_mode = Node.PROCESS_MODE_ALWAYS
	process_priority = FIRST if start else LAST
	process_physics_priority = FIRST
	set_physics_process(start)


func _physics_process(_delta: float) -> void:
	_mark_start()


func _process(_delta: float) -> void:
	if is_start:
		_mark_start()
	elif partner != null:
		partner.logic_ms = (Time.get_ticks_usec() - partner.frame_start_us) / 1000.0
		partner.in_frame = false


func _mark_start() -> void:
	if not in_frame:
		in_frame = true
		frame_start_us = Time.get_ticks_usec()
