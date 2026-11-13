## Autoload GameArgs: the user args after the `--` separator, which replace the browser page params.
##   --debug              start the debug server (game/debug/debug_server.gd, docs/GAME_HOOKS.md "Godot transport")
##   --debug-port=N       its port on 127.0.0.1 (default DEFAULT_DEBUG_PORT, same as kit.config.json godot.debugPort)
##   --verify             hide every debug overlay (the harness always passes it)
##   --quality=<preset>   start on that quality preset
##   --style=<name>       the look (game/render/style_runner.gd; ids in its STYLES). Absent: DEFAULT_STYLE, the signed
##                        stylised B. `none`: the flat stand-in look, no style code (fast verification)
##   --light=<preset>     pins the day clock to a light preset: dawn, afternoon, golden or night
##   --time=<0..24>       pins the day clock to that hour on the day curve (game/render/day_cycle.gd); overrides
##                        --light. Without either the day clock (game/core/day_clock.gd) starts at 15:00 and runs
##   --style-off=<a,b>    style test features to switch off for cost measuring (stylised_b: volfog, shimmer, dressing,
##                        lights, textures, decals, ssao, ssil, glow, sunshadow; p34 = the P0-034 setup)
##   --scene=<id>         start in that scene (ids in SCENES). Without it the game starts in `city` (P1-024): the streamed
##                        pilot centre with the player in a vehicle at a spawn pin
##   --spawn=<pin>        the city scene's start (game/data/spawn_pins.json, game/world/spawn_pins.gd); default: the
##                        file's default pin, the auto stand on Janpath south of Connaught Place
##   --arch=<name>        architecture bench: loads the bench scene from ARCH_SCENES; a setup goes after a colon
##                        (--arch=render:city+i3+lod), read by the bench scene with arch_setup()
##   --tiles=<name>       stream a baked tile folder into the scaffold scene (game/world/world_stream.gd): `test` is the
##                        small committed test block (game/world/test_tiles/), `full` the gitignored pilot set
##                        (game/world/tiles/), or a res:// folder. The city scene streams `full` without the arg (`test`
##                        when the full set is not there); the scaffold and the other scenes stream only with the arg
##   --lockstep           one sim tick per rendered frame at most (a loaded machine runs slower, never catches up)
##   --fps=<on|off>       the FPS counter (game/ui/fps_counter.gd): `on` shows it even under --verify (harness runs start it off),
##                        `off` hides it; without the arg it follows the build (on in development play, off in a release)
##   --mute               master bus muted
## Resolution is an engine arg (`--resolution WxH`, before `--`), handled by Godot itself.
## Without --debug no port opens and no debug node exists: the debug script is not even loaded.
extends Node

const DEFAULT_DEBUG_PORT := 47181
const DEBUG_SERVER_PATH := "res://debug/debug_server.gd"
const STYLE_RUNNER_PATH := "res://render/style_runner.gd"
## The look with no --style arg: the signed stylised B (STYLE_BIBLE.md). --style=NO_STYLE keeps the flat stand-in look.
const DEFAULT_STYLE := "stylised_b"
const NO_STYLE := "none"
## Scene ids the game can load (debug load(id) and --scene=<id>).
const SCENES := {
	"city": "res://scenes/city.tscn",
	"scaffold": "res://scenes/main.tscn",
	"street": "res://scenes/standin/street.tscn",
	"landmarks": "res://scenes/standin/landmarks.tscn",
	"areas": "res://scenes/standin/areas.tscn",
	"course": "res://scenes/course/course.tscn",
}

## The scene that streams the pilot city without a --tiles arg, and the tile set it takes then (CITY_TILES_FALLBACK when
## the gitignored full set is missing).
const CITY_SCENE := "city"
const CITY_TILES := "full"
const CITY_TILES_FALLBACK := "test"

## Architecture bench scenes (game/bench/<name>/, ARCH_OPTIONS.md "Bench tasks"), started with --arch=<name>[:setup].
## Loaded by path only when --arch is given; the default game never loads them.
const ARCH_SCENES := {
	"render": "res://bench/render/render_bench.tscn",
	"physics": "res://bench/physics/physics_bench.tscn",
	"tiles": "res://bench/tiles/tiles_bench.tscn",
	"roads": "res://bench/roads/roads_bench.tscn",
	"far": "res://bench/far/far_bench.tscn",
}

var debug := false
var debug_port := DEFAULT_DEBUG_PORT
var verify := false
var quality := "medium"
var style := ""
var light := ""
var time := ""
var style_off := ""
var scene := ""
var arch := ""
var tiles := ""
var spawn := ""
var fps := ""
var lockstep := false
var mute := false
## False from the start of a --tiles load until the ring round the player is attached with its colliders (the debug
## `ready` waits for it); true with no tiles, and when the tiles could not load.
var world_ready := true
## Args that were not understood (reported in debug state, never an error).
var unknown: Array[String] = []
var _style_runner: RefCounted = null


## Parses user args into a Dictionary. Pure, so it is unit tested. Accepts `--key=value` and `--key value`.
static func parse(args: PackedStringArray) -> Dictionary:
	var out := {
		"debug": false, "debug_port": DEFAULT_DEBUG_PORT, "verify": false, "quality": "medium", "style": "", "light": "", "time": "", "style_off": "",
		"scene": "", "arch": "", "tiles": "", "spawn": "", "fps": "", "lockstep": false, "mute": false, "unknown": [] as Array[String],
	}
	var flags := ["debug", "verify", "lockstep", "mute"]
	var values := ["debug-port", "quality", "style", "light", "time", "style-off", "scene", "arch", "tiles", "spawn", "fps"]
	var i := 0
	while i < args.size():
		var a: String = args[i]
		i += 1
		if not a.begins_with("--"):
			out.unknown.append(a)
			continue
		var key := a.substr(2)
		var val := ""
		var has_val := false
		var eq := key.find("=")
		if eq >= 0:
			val = key.substr(eq + 1)
			key = key.substr(0, eq)
			has_val = true
		if key in flags:
			out[key] = not (has_val and val in ["0", "false", "off", "no"])
		elif key in values:
			if not has_val and i < args.size() and not args[i].begins_with("--"):
				val = args[i]
				i += 1
				has_val = true
			if not has_val or val == "":
				out.unknown.append(a)
			elif key == "debug-port":
				if val.is_valid_int() and int(val) > 0 and int(val) < 65536:
					out.debug_port = int(val)
				else:
					out.unknown.append(a)
			else:
				out[key.replace("-", "_")] = val
		else:
			out.unknown.append(a)
	return out


func _ready() -> void:
	# an exported build mounts its map stage packs first: the scenes look for res://world/tiles/ when they load
	load("res://core/data_packs.gd").mount_all()
	apply(parse(OS.get_cmdline_user_args()))
	# It restyles every scene as its nodes enter the tree (SceneTree.node_added), so it must start before the main
	# scene loads. Loaded by path: --style=none runs no style code at all.
	_style_runner = make_style_runner(get_tree())
	var boot_scene := get_tree().current_scene
	if _style_runner != null and boot_scene != null:
		# the main scene is already in the tree when autoloads get _ready: restyle what node_added missed
		print("style: restyled the boot scene (%d nodes)" % _style_runner.restyle_tree(boot_scene))
	if mute:
		AudioServer.set_bus_mute(0, true)
	if arch != "" and ARCH_SCENES.has(arch_name()):
		get_tree().change_scene_to_file.call_deferred(ARCH_SCENES[arch_name()])
	elif arch != "":
		print("game: unknown --arch=%s (benches: %s), staying on the main scene" % [arch, ", ".join(ARCH_SCENES.keys())])
	elif scene != "" and SCENES.has(scene) and SCENES[scene] != ProjectSettings.get_setting("application/run/main_scene"):
		get_tree().change_scene_to_file.call_deferred(SCENES[scene])
	elif scene != "" and not SCENES.has(scene):
		print("game: unknown --scene=%s, staying on the main scene" % scene)
	if arch == "" and (tiles != "" or (scene in ["", CITY_SCENE] and current_scene_id() == CITY_SCENE)):
		world_ready = false
		attach_tiles.call_deferred(true)
	if debug:
		# Loaded by path, never preloaded: without --debug the debug code is not loaded at all.
		var server: Node = load(DEBUG_SERVER_PATH).new()
		server.name = "DebugServer"
		get_tree().root.add_child.call_deferred(server)
	print("game: boot debug=%s verify=%s lockstep=%s quality=%s" % [debug, verify, lockstep, quality])


## Streams the --tiles folder into the current scene (the scaffold: it has the World node and the car). An unknown
## name or a missing folder is a log line, never an error: the game stays on the stand-in ground.
func attach_tiles(boot := false) -> void:
	# a --scene swap at boot happens at the end of the first frame: stream into the new scene, never the one going
	var t0 := Time.get_ticks_msec()
	while boot and scene != "" and SCENES.has(scene) and current_scene_id() != scene and Time.get_ticks_msec() - t0 < 10000:
		await get_tree().process_frame
	var name := tiles_for(current_scene_id())
	var dir: String = load("res://world/streaming/tile_index.gd").folder_of(name)
	var scene := get_tree().current_scene
	var city: Node = scene.get_node_or_null("World/City") if scene != null else null
	if city != null:
		world_ready = city.booted
		return
	world_ready = false
	if dir == "":
		print("game: unknown --tiles=%s (use test, full or a res:// folder), no tiles loaded" % name)
	elif scene != null and load("res://world/world_stream.gd").attach(scene, dir) != null:
		return
	world_ready = true


## The tile set a scene streams: the --tiles arg; without it the city scene takes CITY_TILES, or CITY_TILES_FALLBACK when
## that folder has no index (a fresh clone has only the committed test block); any other scene none ("").
func tiles_for(scene_id: String) -> String:
	if tiles != "":
		return tiles
	if scene_id != CITY_SCENE:
		return ""
	var folder: String = load("res://world/streaming/tile_index.gd").folder_of(CITY_TILES)
	return CITY_TILES if FileAccess.file_exists(folder + "index.json") else CITY_TILES_FALLBACK


## The look id for a --style value: "" is DEFAULT_STYLE, anything else stays. Architecture benches (--arch) set up
## their own look, so there "" is NO_STYLE. Pure, unit tested.
static func style_id(value: String, arch_value := "") -> String:
	if value != "":
		return value
	return NO_STYLE if arch_value != "" else DEFAULT_STYLE


## The style runner for the current args on a tree, or null for --style=none. Tests call it on the test tree (and
## stop() the runner after).
func make_style_runner(tree: SceneTree) -> RefCounted:
	if style == NO_STYLE:
		return null
	return load(STYLE_RUNNER_PATH).new(tree, style, light, time, style_off)


## Stops the boot style runner (the headless test runner does this first: its test nodes must keep their stand-in
## materials unless a test restyles them on purpose).
func stop_style_runner() -> void:
	if _style_runner != null:
		_style_runner.stop()
	_style_runner = null


## The look now: {style, light (the runner's light id), hour (the hour its light was built for), live (the live
## relight numbers, style_runner.gd live_state)}. With --style=none
## light is "" and hour null.
func look() -> Dictionary:
	if _style_runner == null or _style_runner.style == null:
		return {"style": style, "light": "", "hour": null}
	return {"style": _style_runner.style_id, "light": _style_runner.light_id, "hour": _style_runner.hour,
		"live": _style_runner.live_state()}


## A grade LUT still building on a worker thread is waited for before the game quits.
func _exit_tree() -> void:
	if _style_runner != null:
		_style_runner.stop()


func apply(p: Dictionary) -> void:
	debug = p.debug
	debug_port = p.debug_port
	verify = p.verify
	quality = p.quality
	style = style_id(p.style, p.arch)
	light = p.light
	time = p.time
	style_off = p.style_off
	scene = p.scene
	arch = p.arch
	tiles = p.tiles
	spawn = p.spawn
	fps = p.fps
	lockstep = p.lockstep
	mute = p.mute
	unknown = p.unknown


## The bench name of --arch=<name>[:setup] ("" without --arch).
func arch_name() -> String:
	return split_arch(arch)[0]


## The setup of --arch=<name>:<setup> ("" when none was given).
func arch_setup() -> String:
	return split_arch(arch)[1]


## "render:city+i3" -> ["render", "city+i3"]; "render" -> ["render", ""]. Pure, unit tested.
static func split_arch(value: String) -> PackedStringArray:
	var i := value.find(":")
	if i < 0:
		return PackedStringArray([value, ""])
	return PackedStringArray([value.substr(0, i), value.substr(i + 1)])


## The res:// path of a scene id, or "" for an unknown id.
func scene_path(id: String) -> String:
	return SCENES.get(id, "")


func scene_ids() -> Array:
	return SCENES.keys()


## The id of the scene that is running now ("" when it is not in SCENES).
func current_scene_id() -> String:
	var cur := get_tree().current_scene
	if cur == null:
		return ""
	for id in SCENES:
		if SCENES[id] == cur.scene_file_path:
			return id
	return ""


func as_dict() -> Dictionary:
	return {
		"debug": debug, "debugPort": debug_port, "verify": verify, "quality": quality, "style": style, "light": light, "time": time, "styleOff": style_off,
		"scene": scene, "arch": arch, "tiles": tiles, "spawn": spawn, "fps": fps, "lockstep": lockstep, "mute": mute, "unknown": unknown,
	}
