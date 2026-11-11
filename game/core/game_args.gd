## Autoload GameArgs: the user args after the `--` separator, which replace the browser page params.
##   --debug              start the debug server (game/debug/debug_server.gd, docs/GAME_HOOKS.md "Godot transport")
##   --debug-port=N       its port on 127.0.0.1 (default DEFAULT_DEBUG_PORT, same as kit.config.json godot.debugPort)
##   --verify             hide every debug overlay (the harness always passes it)
##   --quality=<preset>   start on that quality preset
##   --style=<name>       Phase 0 style test (game/render/style_runner.gd; ids in its STYLES)
##   --light=<preset>     light preset for a style test: dawn, afternoon (default), golden or night
##   --time=<0..24>       style test hour of day on the day-night curve (game/render/day_cycle.gd); overrides --light
##   --style-off=<a,b>    style test features to switch off for cost measuring (stylised_b: volfog, shimmer, dressing,
##                        lights, textures, decals, ssao, ssil, glow, sunshadow; p34 = the P0-034 setup)
##   --scene=<id>         start in that scene (ids in SCENES)
##   --arch=<name>        architecture bench: loads the bench scene from ARCH_SCENES; a setup goes after a colon
##                        (--arch=render:city+i3+lod), read by the bench scene with arch_setup()
##   --lockstep           one sim tick per rendered frame at most (a loaded machine runs slower, never catches up)
##   --mute               master bus muted
## Resolution is an engine arg (`--resolution WxH`, before `--`), handled by Godot itself.
## Without --debug no port opens and no debug node exists: the debug script is not even loaded.
extends Node

const DEFAULT_DEBUG_PORT := 47181
const DEBUG_SERVER_PATH := "res://debug/debug_server.gd"
const STYLE_RUNNER_PATH := "res://render/style_runner.gd"
## Scene ids the game can load (debug load(id) and --scene=<id>).
const SCENES := {
	"scaffold": "res://scenes/main.tscn",
	"street": "res://scenes/standin/street.tscn",
	"landmarks": "res://scenes/standin/landmarks.tscn",
	"areas": "res://scenes/standin/areas.tscn",
}

## Architecture bench scenes (game/bench/<name>/, ARCH_OPTIONS.md "Bench tasks"), started with --arch=<name>[:setup].
## Loaded by path only when --arch is given; the default game never loads them.
const ARCH_SCENES := {
	"render": "res://bench/render/render_bench.tscn",
	"physics": "res://bench/physics/physics_bench.tscn",
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
var lockstep := false
var mute := false
## Args that were not understood (reported in debug state, never an error).
var unknown: Array[String] = []
var _style_runner: RefCounted = null


## Parses user args into a Dictionary. Pure, so it is unit tested. Accepts `--key=value` and `--key value`.
static func parse(args: PackedStringArray) -> Dictionary:
	var out := {
		"debug": false, "debug_port": DEFAULT_DEBUG_PORT, "verify": false, "quality": "medium", "style": "", "light": "", "time": "", "style_off": "",
		"scene": "", "arch": "", "lockstep": false, "mute": false, "unknown": [] as Array[String],
	}
	var flags := ["debug", "verify", "lockstep", "mute"]
	var values := ["debug-port", "quality", "style", "light", "time", "style-off", "scene", "arch"]
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
	apply(parse(OS.get_cmdline_user_args()))
	if style != "":
		# Loaded by path only for a style test, so the default look runs no style code at all. It restyles every
		# scene as its nodes enter the tree (SceneTree.node_added), so it must start before the main scene loads.
		_style_runner = load(STYLE_RUNNER_PATH).new(get_tree(), style, light, time, style_off)
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
	if debug:
		# Loaded by path, never preloaded: without --debug the debug code is not loaded at all.
		var server: Node = load(DEBUG_SERVER_PATH).new()
		server.name = "DebugServer"
		get_tree().root.add_child.call_deferred(server)
	print("game: boot debug=%s verify=%s lockstep=%s quality=%s" % [debug, verify, lockstep, quality])


func apply(p: Dictionary) -> void:
	debug = p.debug
	debug_port = p.debug_port
	verify = p.verify
	quality = p.quality
	style = p.style
	light = p.light
	time = p.time
	style_off = p.style_off
	scene = p.scene
	arch = p.arch
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
		"scene": scene, "arch": arch, "lockstep": lockstep, "mute": mute, "unknown": unknown,
	}
