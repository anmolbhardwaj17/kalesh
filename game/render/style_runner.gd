## Phase 0 style tests (game args --style=<id> --light=<preset>; STYLE_OPTIONS.md). Created by GameArgs only when
## --style is given, so the default look never loads any of this. Restyles every scene as it loads, without the
## scenes knowing: on SceneTree.node_added it replaces a WorldEnvironment's Environment, sets a DirectionalLight3D
## as the sun, and swaps the materials of each MeshInstance3D by their key (kit.gd materials() resource names),
## then lets the style decorate the mesh (decals, particles). Touches render setup only: no gameplay, camera or UI.
## A style is game/render/styles/<id>.gd with <id>.tres (style_preset.gd); a light is styles/light_<id>.tres, or with
## --time=<0..24> a point on the day-night curve (day_cycle.gd). Label3D nodes go to the style's decorate_label and
## the WorldEnvironment to its decorate_environment when the style has them (stylised_b: signs, heat shimmer).
extends RefCounted

const DayCycle := preload("res://render/day_cycle.gd")
const STYLES := ["stylised", "stylised_grime", "stylised_b"]
const LIGHTS := ["dawn", "afternoon", "golden", "night"]
const DEFAULT_LIGHT := "afternoon"
const DIR := "res://render/styles/"

var style_id := ""
var light_id := ""
var style: RefCounted = null


func _init(tree: SceneTree, id: String, light: String, time := "", off := "") -> void:
	if not id in STYLES:
		print("style: unknown --style=%s (known: %s), default look kept" % [id, ", ".join(STYLES)])
		return
	light_id = light if light in LIGHTS else DEFAULT_LIGHT
	if light != "" and not light in LIGHTS:
		print("style: unknown --light=%s (known: %s), using %s" % [light, ", ".join(LIGHTS), light_id])
	style_id = id
	var preset: Resource = load(DIR + id + ".tres")
	var lp: Resource = load(DIR + "light_" + light_id + ".tres")
	if time != "":
		if time.is_valid_float():
			light_id = "time %.2f" % fposmod(float(time), 24.0)
			lp = DayCycle.at(float(time))
		else:
			print("style: --time=%s is not a number of hours, using %s" % [time, light_id])
	style = load(DIR + id + ".gd").new(preset, lp)
	if off != "" and style.has_method("set_off"):
		style.set_off(off.split(",", false))
	tree.node_added.connect(_on_node_added)
	print("style: %s, light %s%s" % [style_id, light_id, (", off " + off) if off != "" else ""])


func _on_node_added(node: Node) -> void:
	if node is WorldEnvironment:
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
