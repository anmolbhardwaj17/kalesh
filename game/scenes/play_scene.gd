## The root of the scenes the player plays in: the city (game/scenes/city.tscn, the game's main scene since P1-024)
## and the flat scaffold (main.tscn). It makes PlayerMode (game/characters/player_mode.gd): the player starts in the
## scene's World/Car with the on-foot character seated in it, F gets out and back in.
## In the city (`city` true) the vehicle is the spawn pin's (game/data/spawn_pins.json, --spawn=<pin>), set before the
## car is ready; the streamed tiles themselves are attached by GameArgs (attach_tiles) and the debug load().
## Coordinates: east +X, north -Z, up +Y, metres.
extends Node3D

const PlayerMode := preload("res://characters/player_mode.gd")
const SpawnPins := preload("res://world/spawn_pins.gd")
const TileIndex := preload("res://world/streaming/tile_index.gd")
const WorldFrame := preload("res://geo/world_frame.gd")
const GameArgsScript := preload("res://core/game_args.gd")

## True in the city scene: the start vehicle comes from the spawn pin.
@export var city := false


func _enter_tree() -> void:
	if not city:
		return
	var car := get_node_or_null("World/Car")
	var tune := start_tune(GameArgsScript.parse(OS.get_cmdline_user_args()))
	if car != null and tune != "" and not car.is_node_ready():
		car.tune_path = tune


func _ready() -> void:
	var world := get_node("World") as Node3D
	var pm := PlayerMode.new()
	pm.name = "PlayerMode"
	add_child(pm)
	pm.setup(world, world.get_node("Car") as Node3D, get_node("ChaseCamera") as Camera3D, self)


## The tune of the spawn pin the city starts at, or "" (the scene's own car) when the pin's tile is not in the tile set
## the city will stream (the test block has no Janpath: the old start near India Gate takes the car). `args` is
## GameArgs.parse() output: this runs before the GameArgs autoload has read the command line at boot.
static func start_tune(args: Dictionary) -> String:
	var pin := SpawnPins.pick(str(args.get("spawn", "")))
	if pin.is_empty() or pin.tune == "":
		return ""
	var name := str(args.get("tiles", ""))
	if name == "":
		name = GameArgsScript.CITY_TILES
		if not FileAccess.file_exists(TileIndex.folder_of(name) + "index.json"):
			name = GameArgsScript.CITY_TILES_FALLBACK
	var dir := TileIndex.folder_of(name)
	if dir == "":
		return ""
	var index: RefCounted = TileIndex.open(dir)
	if index.error != "":
		return ""
	var at: Dictionary = WorldFrame.from_index(index.raw).geo_to_world(pin.lat, pin.lon)
	return pin.tune if index.has(WorldFrame.tile_of(at.x, at.z)) else ""
