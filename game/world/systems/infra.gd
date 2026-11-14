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

var id := "infra"
var lane := "mesh"
var exclusive := true
var per_frame := 0
var budget_ms := 0.3
var root: Node3D
## tile id -> records (the folder's infra.json "tiles")
var records: Dictionary
var materials := {}
var live := 0
var triangles := 0
var nodes := 0


func _init(parent: Node3D, tile_records: Dictionary) -> void:
	root = parent
	records = tile_records
	materials = Kit.materials()


func prepare(tile: Dictionary) -> Variant:
	var tid := "%d_%d" % [tile.key.x, tile.key.y]
	var recs: Dictionary = records.get(tid, {})
	if recs.is_empty():
		return {"meshes": [], "triangles": 0, "nodes": []}
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
				mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays[k])
				mesh.surface_set_material(mesh.get_surface_count() - 1, materials.get(k, materials["matte"]))
			meshes.append({"group": g, "level": level, "mesh": mesh})
	return {"meshes": meshes, "triangles": int(built.triangles), "nodes": []}


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
	const KitMesh := preload("res://world/landmarks/kit_mesh.gd")
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
