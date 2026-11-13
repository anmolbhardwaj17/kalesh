## The look of the game (TECH.md "Render pipeline"): GameArgs makes this runner at boot with the signed style,
## stylised B, unless the game arg --style names another one (`stylised`, `stylised_grime` and `realistic` stay as
## reference sets until the P1 gate) or `--style=none` (the flat stand-in look for fast verification: no runner, no
## style code). Restyles every scene as it loads, without the scenes knowing: on SceneTree.node_added it replaces a
## WorldEnvironment's Environment, sets a DirectionalLight3D as the sun, and swaps the materials of each
## MeshInstance3D by their key (kit.gd materials() resource names), then lets the style decorate the mesh (decals,
## particles). Touches render setup only: no gameplay, camera or UI.
## A style is game/render/styles/<id>.gd with <id>.tres (style_preset.gd). The light is a point on the day curve
## (day_cycle.gd) at the day clock's hour (game/core/day_clock.gd, autoload DayClock): --light=<preset> uses the
## preset itself (styles/light_<id>.tres) and --time=<0..24> that hour, both pinned. When a scene loads (its
## WorldEnvironment enters the tree) and the clock has moved a game minute or more from the hour the light was built
## for, the style is built again at the clock's hour, so every scene loads in the light of its time of day.
## Inside a loaded scene the look follows the clock live (P1-028): every frame the runner checks the clock, and when it
## moved RELIGHT_STEP or more (at most every LIVE_MIN_MS of real time while it runs) the style moves its Environment,
## materials, night lights, lit windows and haze to the new hour in place (style.relight) and the runner sets the
## scene's sun again. Nothing is rebuilt; a style that cannot relight (realistic) keeps the rebuild on a scene load.
## Label3D nodes go to the style's decorate_label and the WorldEnvironment to its decorate_environment when the style
## has them (stylised_b: signs, heat shimmer).
extends RefCounted

const DayCycle := preload("res://render/day_cycle.gd")
const DayClockScript := preload("res://core/day_clock.gd")
const STYLES := ["stylised", "stylised_grime", "stylised_b", "realistic"]
const LIGHTS := ["dawn", "afternoon", "golden", "night"]
const DEFAULT_LIGHT := "afternoon"
const DIR := "res://render/styles/"
## The clock must move this far (hours: one game minute) before a scene load builds the light again.
const RELIGHT_STEP := 1.0 / 60.0
## Real time between two live relights while the clock runs (a fast clock would otherwise relight every frame).
const LIVE_MIN_MS := 100

var style_id := ""
var light_id := ""
## The hour of the day the current light was built for.
var hour := DayClockScript.START_HOUR
var style: RefCounted = null
var _tree: SceneTree
var _preset: Resource
var _off := ""
## Live relight counters for the debug state: style builds (boot and scene loads), live relights, the slowest relight.
var builds := 0
var relights := 0
var relight_ms_max := 0.0
## The slowest frame of live work (a relight and a finished LUT put in), main thread.
var tick_ms_max := 0.0
## The same while the clock runs (a pinned jump builds its exact grade LUT at once: a deliberate one-off cost).
var tick_ms_max_running := 0.0
var _last_relight_ms := -1000000
## The DirectionalLight3D nodes the style set up (the scene's sun): set again on every live relight.
var _suns: Array = []


func _init(tree: SceneTree, id: String, light: String, time := "", off := "") -> void:
	if not id in STYLES:
		print("style: unknown --style=%s (known: %s), default look kept" % [id, ", ".join(STYLES)])
		return
	_tree = tree
	_off = off
	light_id = light if light in LIGHTS else DEFAULT_LIGHT
	if light != "" and not light in LIGHTS:
		print("style: unknown --light=%s (known: %s), using %s" % [light, ", ".join(LIGHTS), light_id])
	if time != "" and not time.is_valid_float():
		print("style: --time=%s is not a number of hours, using %s" % [time, light_id if light != "" else "the day clock"])
	style_id = id
	_preset = load(DIR + id + ".tres")
	var start := DayClockScript.start(light, time)
	hour = start.hour
	var lp: Resource
	if light != "" and not (time != "" and time.is_valid_float()):
		lp = load(DIR + "light_" + light_id + ".tres")
	else:
		lp = DayCycle.at(hour)
		light_id = ("time %.2f" if start.pinned else "clock %.2f") % hour
	_build(lp)
	tree.node_added.connect(_on_node_added)
	tree.process_frame.connect(_tick)
	print("style: %s, light %s%s" % [style_id, light_id, (", off " + off) if off != "" else ""])


func _build(lp: Resource) -> void:
	if style != null and style.has_method("finish"):
		style.finish()
	style = load(DIR + style_id + ".gd").new(_preset, lp)
	builds += 1
	if _off != "" and style.has_method("set_off"):
		style.set_off(_off.split(",", false))


## Builds the light again at the day clock's hour when it moved RELIGHT_STEP or more since the last build. Called as a
## scene's WorldEnvironment enters the tree, before the scene's meshes (stand-in builders and main.tscn add it first).
func follow_clock() -> bool:
	var clock := _clock()
	if clock == null:
		return false
	var h: float = clock.hour
	var d := absf(fposmod(h - hour + 12.0, 24.0) - 12.0)
	if d < RELIGHT_STEP:
		return false
	hour = h
	light_id = ("time %.2f" if clock.pinned else "clock %.2f") % h
	_build(DayCycle.at(h))
	print("style: %s, light %s (day clock)" % [style_id, light_id])
	return true


## The day clock once it has read the game args, else null. The boot scene is restyled from GameArgs._ready, before
## DayClock._ready has read --light and --time: its hour is still the default one then, and following it would throw
## away the pinned light (P1-026).
func _clock() -> Node:
	var clock: Node = _tree.root.get_node_or_null("DayClock") if _tree != null and _tree.root != null else null
	if clock == null or not clock.is_node_ready():
		return null
	return clock


## Every frame: a finished worker-thread LUT goes in (style.poll), then a live relight when the clock moved.
func _tick() -> void:
	if style == null:
		return
	var t0 := Time.get_ticks_usec()
	var lut: bool = style.has_method("poll") and style.poll()
	if relight_to_clock() or lut:
		var ms := (Time.get_ticks_usec() - t0) / 1000.0
		tick_ms_max = maxf(tick_ms_max, ms)
		var clock := _clock()
		if clock != null and not clock.pinned:
			tick_ms_max_running = maxf(tick_ms_max_running, ms)


## Moves the loaded scene's look to the day clock's hour in place, when the clock moved RELIGHT_STEP or more and (while
## it runs) LIVE_MIN_MS passed since the last relight. A pinned clock that jumps (timeOfDay({hour}), a mission's hour)
## relights at once with the exact grade; a running one gets its grade LUT from a worker thread. Returns true when it
## relit.
func relight_to_clock() -> bool:
	var clock := _clock()
	if clock == null or style == null or not style.has_method("can_relight") or not style.can_relight():
		return false
	var h: float = clock.hour
	if absf(fposmod(h - hour + 12.0, 24.0) - 12.0) < RELIGHT_STEP:
		return false
	var now := Time.get_ticks_msec()
	var pinned: bool = clock.pinned
	if not pinned and now - _last_relight_ms < LIVE_MIN_MS:
		return false
	_last_relight_ms = now
	var t0 := Time.get_ticks_usec()
	hour = h
	light_id = ("time %.2f" if pinned else "clock %.2f") % h
	style.relight(DayCycle.at(h), pinned)
	var keep: Array = []
	for s in _suns:
		if is_instance_valid(s) and (s as Node).is_inside_tree():
			style.setup_sun(s)
			keep.append(s)
	_suns = keep
	relights += 1
	relight_ms_max = maxf(relight_ms_max, (Time.get_ticks_usec() - t0) / 1000.0)
	return true


## The live relight numbers for the debug state (state().time.live).
func live_state() -> Dictionary:
	var out := {"builds": builds, "relights": relights, "relightMsMax": snappedf(relight_ms_max, 0.001),
		"tickMsMax": snappedf(tick_ms_max, 0.001), "tickMsMaxRunning": snappedf(tick_ms_max_running, 0.001),
		"lutBusy": style != null and style.has_method("lut_busy") and style.lut_busy(),
		"live": style != null and style.has_method("can_relight") and style.can_relight()}
	if style != null and style.has_method("live_stats"):
		out.merge(style.live_stats())
	return out


## Restyles a subtree that entered the tree before this runner existed (the boot scene: the engine adds the main
## scene before the autoloads' _ready, so its nodes never reached node_added). Returns the number of nodes seen.
func restyle_tree(node: Node) -> int:
	if style == null:
		return 0
	_on_node_added(node)
	var n := 1
	for c in node.get_children():
		n += restyle_tree(c)
	return n


## Stops restyling (tests make runners on the test tree).
func stop() -> void:
	if _tree != null and _tree.node_added.is_connected(_on_node_added):
		_tree.node_added.disconnect(_on_node_added)
	if _tree != null and _tree.process_frame.is_connected(_tick):
		_tree.process_frame.disconnect(_tick)
	if style != null and style.has_method("finish"):
		style.finish()


func _on_node_added(node: Node) -> void:
	if node is WorldEnvironment:
		follow_clock()
		node.environment = style.environment()
		if style.has_method("decorate_environment"):
			style.decorate_environment(node)
	elif node is Label3D:
		if style.has_method("decorate_label"):
			style.decorate_label(node)
	elif node is DirectionalLight3D:
		style.setup_sun(node)
		_suns = _suns.filter(func(x): return is_instance_valid(x))
		if not node in _suns:
			_suns.append(node)
	elif node is MeshInstance3D:
		restyle_mesh(node)


func restyle_mesh(mi: MeshInstance3D) -> void:
	if mi.mesh == null:
		return
	for i in mi.mesh.get_surface_count():
		var m: Material = style.material_for(mi.mesh.surface_get_material(i))
		if m != null:
			mi.set_surface_override_material(i, m)
	if mi.has_meta("wear"):
		mi.set_instance_shader_parameter("wear", float(mi.get_meta("wear")))
	style.decorate(mi)
