## Root of a stand-in scene (P0-009): street, landmarks or areas. Builds the world on _ready with builder.gd. Loaded
## with debug load('street') or the game arg --scene=street (ids in game/core/game_args.gd SCENES).
extends Node3D

const Builder := preload("res://scenes/standin/builder.gd")

@export_enum("street", "landmarks", "areas") var layout := "street"


func _ready() -> void:
	var t0 := Time.get_ticks_msec()
	var stats: Dictionary = Builder.new().build(self, layout)
	print("standin: built %s in %d ms: %s" % [layout, Time.get_ticks_msec() - t0, JSON.stringify(stats)])
