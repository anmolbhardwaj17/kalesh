## Measures the game logic time of each frame for the debug perf hook: a START probe marks the frame start on the
## tree's physics_frame signal (before every node's _physics_process) or on its own first _process (lowest process
## priority), and an END probe runs after every other node's _process. logic_ms is the wall time from the first
## physics or process callback of a frame to the last _process callback. No _physics_process here: only the sim clock
## and the cameras have one (game/tests/test_sim_clock.gd). (Performance monitors
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


func _ready() -> void:
	if is_start:
		get_tree().physics_frame.connect(_mark_start)


func _exit_tree() -> void:
	if is_start and get_tree().physics_frame.is_connected(_mark_start):
		get_tree().physics_frame.disconnect(_mark_start)


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
