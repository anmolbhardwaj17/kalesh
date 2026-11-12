## Streamed system: the buildings of a tile. For now the plain shells the bake wrote (one merged mesh per tile, the
## material `building`); the facade modules as MultiMesh cells and the visibility range LOD come with the area
## profiles (P2). Built on a worker thread, attached in one step.
## Budget: one mesh step a tile; GPU 2.0 ms for generated buildings (perf_budgets.json world.gpuMs.generatedBuildings).
extends RefCounted

const TileMesh := preload("res://world/systems/tile_mesh.gd")
const ONLY := ["building"]

var id := "buildings"
var lane := "mesh"
var exclusive := true
var per_frame := 0
var budget_ms := 0.3
var root: Node3D
var materials: Dictionary
var live := 0
var triangles := 0


func _init(parent: Node3D, stand_ins: Dictionary) -> void:
	root = parent
	materials = stand_ins


func prepare(tile: Dictionary) -> Variant:
	return TileMesh.build(tile, materials, ONLY, [])


func attach(tile: Dictionary, part: Variant) -> bool:
	TileMesh.attach(root, id, tile, part)
	part["on"] = true
	live += 1
	triangles += int(part.triangles)
	return true


func dispose(_tile: Dictionary, part: Variant) -> bool:
	if part.get("on", false):
		part["on"] = false
		live -= 1
		triangles -= int(part.triangles)
	TileMesh.dispose(part)
	return true


func info() -> Dictionary:
	return {"tiles": live, "triangles": triangles}
