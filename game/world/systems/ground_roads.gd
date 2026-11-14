## Streamed system: the ground and the roads of a tile (every drawn mesh but the building shells: ground, plots,
## lawns, roads, markings, kerbs, footpaths, medians, walls, piers, deck undersides, the river bed and water),
## merged into one mesh with a surface per material. Built on a worker thread, attached in one step.
## Budget: one mesh step a tile; GPU 1.0 ms for roads and ground (perf_budgets.json world.gpuMs.roadsAndGround).
extends RefCounted

const TileMesh := preload("res://world/systems/tile_mesh.gd")
const SKIP := ["building"]
## The plain shapes the infrastructure kits stand on (P2-034): colliders only when the folder has infra.json. The side
## walls of cuts and tunnels and a tunnel's ceiling are the tunnel kit's (P2-032, game/world/infra/kit_tunnel.gd).
const KIT_ENVELOPES := ["barrier", "fascia", "retaining", "abutment", "pier", "underside", "railbed", "fob", "platform", "wall", "ceiling"]

var id := "ground_roads"
var lane := "mesh"
var exclusive := true
var per_frame := 0
var budget_ms := 0.3
var root: Node3D
var materials: Dictionary
var live := 0
var triangles := 0
var skip: Array = SKIP.duplicate()


func _init(parent: Node3D, stand_ins: Dictionary) -> void:
	root = parent
	materials = stand_ins


func prepare(tile: Dictionary) -> Variant:
	return TileMesh.build(tile, materials, [], skip)


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
