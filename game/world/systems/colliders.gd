## Streamed system: the static colliders of a tile (roads, ground, kerbs, walls, decks and building shells), the
## chunks of at most about 500 triangles the bake cut (TECH.md "Tile format": one piece per tile is a 17 ms frame).
## The shapes are made on a worker thread. Jolt builds a mesh shape on the main thread when its body enters the
## space, whatever thread made the shape (measured, P0-017), so one attach step is one chunk and the queue runs at
## most 3 a frame, none in a frame that attaches meshes (`exclusive`).
## Bodies are plain PhysicsServer3D static bodies (no nodes): a tile of 40 chunks adds no node and frees in a few
## steps. Rays, vehicles and characters hit them like any static body; a ray result has no collider object.
## Budget: 0.5 ms for the worst chunk (perf_budgets.json streaming.colliderChunkMsWorst).
extends RefCounted

const TileReader := preload("res://world/streaming/tile_reader.gd")
## Bodies freed in one dispose step.
const FREE_PER_STEP := 8

var id := "colliders"
var lane := "collider"
var exclusive := true
var per_frame := 3
var budget_ms := 0.5
var root: Node3D
var chunks := 0
var triangles := 0
var _space := RID()


func _init(parent: Node3D) -> void:
	root = parent


func prepare(tile: Dictionary) -> Variant:
	var shapes: Array[ConcavePolygonShape3D] = []
	var counts := PackedInt32Array()
	for c: Dictionary in tile.header.get("colliders", []):
		var n := int(c.triangles)
		if n <= 0:
			continue
		var shape := ConcavePolygonShape3D.new()
		shape.set_faces(TileReader.vec3(tile, int(c.faces), n * 3))
		shapes.append(shape)
		counts.append(n)
	return {"shapes": shapes, "counts": counts, "bodies": [] as Array[RID], "next": 0}


## One chunk: a static body with the chunk's shape at the tile origin enters the space.
func attach(tile: Dictionary, part: Variant) -> bool:
	var shapes: Array = part.shapes
	var i: int = part.next
	if i >= shapes.size():
		return true
	if not _space.is_valid():
		_space = root.get_world_3d().space
	var body := PhysicsServer3D.body_create()
	PhysicsServer3D.body_set_mode(body, PhysicsServer3D.BODY_MODE_STATIC)
	PhysicsServer3D.body_add_shape(body, (shapes[i] as ConcavePolygonShape3D).get_rid())
	PhysicsServer3D.body_set_state(body, PhysicsServer3D.BODY_STATE_TRANSFORM, Transform3D(Basis.IDENTITY, tile.origin))
	PhysicsServer3D.body_set_space(body, _space)
	part.bodies.append(body)
	part.next = i + 1
	chunks += 1
	triangles += int(part.counts[i])
	return part.next >= shapes.size()


## A few bodies a step, the shapes with the last of them.
func dispose(_tile: Dictionary, part: Variant) -> bool:
	var bodies: Array = part.bodies
	for k in mini(FREE_PER_STEP, bodies.size()):
		PhysicsServer3D.free_rid(bodies.pop_back())
		chunks -= 1
		triangles -= int(part.counts[bodies.size()])
	if not bodies.is_empty():
		return false
	part.shapes.clear()
	part.next = 0
	return true


func info() -> Dictionary:
	return {"chunks": chunks, "triangles": triangles}
