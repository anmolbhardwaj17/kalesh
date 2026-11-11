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

var style_id := ""
var light_id := ""
## The hour of the day the current light was built for.
var hour := DayClockScript.START_HOUR
var style: RefCounted = null
var _tree: SceneTree
var _preset: Resource
var _off := ""


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
	print("style: %s, light %s%s" % [style_id, light_id, (", off " + off) if off != "" else ""])


func _build(lp: Resource) -> void:
	style = load(DIR + style_id + ".gd").new(_preset, lp)
	if _off != "" and style.has_method("set_off"):
		style.set_off(_off.split(",", false))


## Builds the light again at the day clock's hour when it moved RELIGHT_STEP or more since the last build. Called as a
## scene's WorldEnvironment enters the tree, before the scene's meshes (stand-in builders and main.tscn add it first).
func follow_clock() -> bool:
	var clock: Node = _tree.root.get_node_or_null("DayClock") if _tree != null and _tree.root != null else null
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
