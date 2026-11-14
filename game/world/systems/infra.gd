## Streamed system: the infrastructure kits of a tile (P2-034): its flyovers, bridges, rail track, metro viaduct and
## foot over bridges, built from the tile's records of the folder's infra.json (tools/bake/infra/build.ts) by the
## kits in game/world/infra/ on a worker thread, attached in one step. Per group (road, rail, metro, fob) one mesh
## for the base level and one for the near level (visibility range NEAR_M, so sleepers, paint and posts cost nothing
## from far); materials are the stand-in kit's, so the look restyles them like the landmarks, with the group's wear.
## The tiles keep the plain shapes these stand on as colliders (ground_roads.gd does not draw them when the folder
## has infra.json). Budget: one mesh step a tile, inside the city's GPU line (perf_budgets.json world.gpuMs).
extends RefCounted

const InfraKit := preload("res://world/infra/infra_kit.gd")
const Kit := preload("res://scenes/standin/kit.gd")
const KitMesh := preload("res://world/landmarks/kit_mesh.gd")
const MURAL_SHADER := preload("res://world/infra/tunnel_mural.gdshader")
const MURAL_INSIDE_SHADER := preload("res://world/infra/tunnel_mural_inside.gdshader")
const TUNNEL_LIT_SHADER := preload("res://world/infra/tunnel_lit.gdshader")
const TUNNEL_GLOW_SHADER := preload("res://world/infra/tunnel_glow.gdshader")
## The surfaces of tunnel_lit.gdshader (P2-032): key -> its `surface`
const TUNNEL_SURFACES := {"tunnel_lit": 0, "tunnel_road": 1, "tunnel_wall": 2, "tunnel_soffit": 3, "tunnel_road_petals": 4}
## Mural materials (P2-032): key -> [shader kind, inside a roofed tunnel]
const MURALS := {"mural_wave": [0, true], "mural_ramp": [1, false], "mural_pillar": [2, true]}


var id := "infra"
var lane := "mesh"
var exclusive := true
var per_frame := 0
var budget_ms := 0.3
var root: Node3D
## tile id -> records (the folder's infra.json "tiles")
var records: Dictionary
var materials := {}
## The tunnel materials that follow the scene's exposure (tick), and the exposure they were last set for.
var _tunnel: Array = []
var _exposure := -1.0
var live := 0
var triangles := 0
var nodes := 0


func _init(parent: Node3D, tile_records: Dictionary) -> void:
	root = parent
	records = tile_records
	materials = Kit.materials()
	# the Pragati Maidan tunnel's painted walls (P2-032): drawn by a shader from the quads' UVs (metres along, height)
	for k: String in MURALS:
		var m := ShaderMaterial.new()
		m.shader = MURAL_INSIDE_SHADER if MURALS[k][1] else MURAL_SHADER
		m.set_shader_parameter("kind", MURALS[k][0])
		m.resource_name = k
		materials[k] = m
	# the inside of a roofed tunnel (P2-032): lit by its LED strip lines per pixel, never by the sun or the sky, seen
	# through its own haze: the fittings, the asphalt road, the painted concrete walls, the soffit
	for k: String in TUNNEL_SURFACES:
		var lit := ShaderMaterial.new()
		lit.shader = TUNNEL_LIT_SHADER
		lit.set_shader_parameter("surface", TUNNEL_SURFACES[k])
		lit.resource_name = k
		materials[k] = lit
	# the strip lines themselves and the lit faces of signs
	var tglow := ShaderMaterial.new()
	tglow.shader = TUNNEL_GLOW_SHADER
	tglow.resource_name = "tunnel_glow"
	materials["tunnel_glow"] = tglow
	_tunnel = [tglow]
	for k: String in TUNNEL_SURFACES:
		_tunnel.append(materials[k])
	for k: String in MURALS:
		if MURALS[k][1]:
			_tunnel.append(materials[k])


## Keeps the tunnels' light the same at any hour: their materials are unshaded and go through the scene's tonemap, so
## they take the scene's exposure back out (`exposure_comp`). Called every frame by the city (world_stream.gd).
func tick() -> void:
	if not is_instance_valid(root) or not root.is_inside_tree():
		return
	var world := root.get_viewport().find_world_3d()
	var env := world.environment if world != null else null
	var exposure := env.tonemap_exposure if env != null else 1.0
	if is_equal_approx(exposure, _exposure):
		return
	_exposure = exposure
	for m: ShaderMaterial in _tunnel:
		m.set_shader_parameter("exposure_comp", 1.0 / maxf(exposure, 0.05))


func prepare(tile: Dictionary) -> Variant:
	var tid := "%d_%d" % [tile.key.x, tile.key.y]
	var recs: Dictionary = records.get(tid, {})
	if recs.is_empty():
		return {"meshes": [], "triangles": 0, "nodes": [], "labels": []}
	var built := InfraKit.build(recs, tile.origin)
	var meshes := []
	for g: String in InfraKit.GROUPS:
		for level: String in ["base", "near"]:
			var arrays: Dictionary = built[g][level].arrays_of("main")
			if arrays.is_empty():
				continue
			var mesh := ArrayMesh.new()
			var keys := arrays.keys()
			keys.sort()
			for k: String in keys:
				var arr: Array = arrays[k]
				mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr, [], {}, KitMesh.CUSTOM_FLAGS if arr[Mesh.ARRAY_CUSTOM0] != null else 0)
				mesh.surface_set_material(mesh.get_surface_count() - 1, materials.get(k, materials["matte"]))
			meshes.append({"group": g, "level": level, "mesh": mesh})
	return {"meshes": meshes, "triangles": int(built.triangles), "nodes": [], "labels": built.get("labels", [])}


func attach(tile: Dictionary, part: Variant) -> bool:
	for m: Dictionary in part.meshes:
		var mi := MeshInstance3D.new()
		mi.name = "Infra_%s_%s_%d_%d" % [m.group, m.level, tile.key.x, tile.key.y]
		mi.mesh = m.mesh
		mi.position = tile.origin
		mi.set_meta("wear", InfraKit.WEAR.get(m.group, 0.3))
		if m.level == "near":
			mi.visibility_range_end = InfraKit.NEAR_M
			mi.visibility_range_end_margin = InfraKit.NEAR_M * 0.1
			mi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		root.add_child(mi)
		part.nodes.append(mi)
	# the tunnel names on the headwalls (P2-032): a label each, made here on the main thread
	for lab: Dictionary in part.get("labels", []):
		var l := Label3D.new()
		l.name = "TunnelName_%d_%d_%d" % [tile.key.x, tile.key.y, part.nodes.size()]
		l.text = str(lab.text)
		l.pixel_size = 0.004
		l.font_size = int(clampf(float(lab.size) / 0.004 * 0.75, 24.0, 160.0))
		l.outline_size = 0
		l.modulate = Color("#f4f1e8")
		l.shaded = true
		l.double_sided = false
		l.visibility_range_end = InfraKit.NEAR_M
		l.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		l.transform = lab.xf
		root.add_child(l)
		part.nodes.append(l)
	live += 1
	triangles += int(part.triangles)
	nodes += part.nodes.size()
	part["on"] = true
	return true


func dispose(_tile: Dictionary, part: Variant) -> bool:
	if part.get("on", false):
		part["on"] = false
		live -= 1
		triangles -= int(part.triangles)
		nodes -= part.nodes.size()
	for n: Node in part.nodes:
		if is_instance_valid(n):
			if n.is_inside_tree():
				n.free()
			else:
				n.queue_free()
	part.nodes.clear()
	part.meshes = []
	return true


func info() -> Dictionary:
	return {"tiles": live, "triangles": triangles, "nodes": nodes}


## The far skyline pieces of the folder (infra.json "skyline", the Signature Bridge), built once on the main thread
## with the landmarks' haze material so they read as pale silhouettes past the fog, like the far landmarks.
static func skyline(parent: Node3D, list: Array, haze: Material) -> Array:
	const Elevated := preload("res://world/infra/kit_elevated.gd")
	var out := []
	for k: Dictionary in list:
		if str(k.get("v", "")) != "BRI-Y2":
			continue
		var m := KitMesh.new()
		Elevated.signature_bridge(m)
		var arrays: Dictionary = m.arrays_of("main")
		if arrays.is_empty():
			continue
		var mesh := ArrayMesh.new()
		for key: String in arrays:
			mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays[key])
			mesh.surface_set_material(mesh.get_surface_count() - 1, haze)
		var mi := MeshInstance3D.new()
		mi.name = "Infra_skyline_%s" % str(k.id)
		mi.mesh = mesh
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var pos: Array = k.pos
		var b := deg_to_rad(float(k.get("bearingDeg", 90.0)))
		mi.transform = Transform3D(Basis(Vector3.UP, PI * 0.5 - b), Vector3(float(pos[0]), float(pos[1]), float(pos[2])))
		mi.set_meta("landmark", str(k.id))
		parent.add_child(mi)
		out.append(mi)
	return out
