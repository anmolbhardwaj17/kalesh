## Shared by the streamed systems that draw a tile's merged meshes (ground_roads.gd, buildings.gd): turns the header
## meshes of some materials into one ArrayMesh with a surface per material, on a worker thread, and holds the flat
## stand-in materials by the names the bake gives (the look of the streamed city is P2; the style runner restyles
## a MeshInstance3D by its surface materials). No per-vertex script work: each array is one call.
extends RefCounted

const TileReader := preload("res://world/streaming/tile_reader.gd")
const COLORS := {
	"ground": Color(0.62, 0.58, 0.46), "plot": Color(0.56, 0.52, 0.42), "road": Color(0.22, 0.22, 0.24), "gore": Color(0.5, 0.5, 0.48),
	"marking": Color(0.92, 0.92, 0.86), "joint": Color(0.3, 0.3, 0.32), "median": Color(0.45, 0.5, 0.38), "footpath": Color(0.66, 0.64, 0.6),
	"kerb": Color(0.55, 0.54, 0.52), "wall": Color(0.72, 0.66, 0.56), "pier": Color(0.6, 0.6, 0.58), "underside": Color(0.4, 0.4, 0.4),
	"building": Color(0.78, 0.7, 0.58), "lawn": Color(0.42, 0.55, 0.32), "bed": Color(0.45, 0.42, 0.36), "water": Color(0.27, 0.43, 0.5),
	"parking": Color(0.3, 0.3, 0.32), "planter": Color(0.4, 0.5, 0.34),
	# landmark ground and stand-in massing (P2-006): a forecourt, a flat pad, the footing of a wall, a moat bed, and
	# the massing in buff and in red sandstone until the parts kit (P2-007) builds the real shapes
	"forecourt": Color(0.72, 0.62, 0.5), "pad": Color(0.8, 0.73, 0.62), "wallbase": Color(0.5, 0.3, 0.25), "moat": Color(0.42, 0.38, 0.3),
	"landmark": Color(0.84, 0.74, 0.58), "landmark_red": Color(0.66, 0.33, 0.27),
	# who may use each road (P2-042): paved footways, paths and pedestrian areas in the ground, and the bollards and
	# gates where the access changes (dark steel; the parts kit gives them their stripes later)
	"walkway": Color(0.7, 0.6, 0.52), "bollard": Color(0.2, 0.2, 0.22),
	# the plain shapes the infrastructure kits stand on (P2-034): drawn only when the folder has no infra.json
	"barrier": Color(0.72, 0.66, 0.56), "fascia": Color(0.72, 0.66, 0.56), "retaining": Color(0.72, 0.66, 0.56),
	"abutment": Color(0.72, 0.66, 0.56), "railbed": Color(0.48, 0.45, 0.41), "fob": Color(0.5, 0.52, 0.55), "platform": Color(0.6, 0.58, 0.55),
	"ceiling": Color(0.5, 0.5, 0.5),
}
## The material of a name the table does not know.
const OTHER := "_"


## The stand-in materials, one per name plus OTHER. Made once on the main thread; worker threads only read them.
static func stand_ins() -> Dictionary:
	var out := {}
	for name: String in COLORS:
		out[name] = _flat(COLORS[name])
	out[OTHER] = _flat(Color(0.7, 0.7, 0.7))
	return out


static func _flat(color: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = 1.0
	# a flat stand-in colour: the style runner gives it a twin that reads right under the look (stylised.gd FLAT_META)
	m.set_meta("flat_stand_in", true)
	return m


## One ArrayMesh from the header meshes whose material is in `only` (or, with `only` empty, not in `skip`).
## Returns {mesh (null when the tile has none of them), triangles, node = null} or {error} when the mesh reaches
## outside the tile plus its margin (the magnitude rule, on the bounds the engine worked out).
## `uv2_fn` (optional) rewrites the UV2 array of each surface that has one (buildings.gd repaints the shell tints).
static func build(tile: Dictionary, materials: Dictionary, only: Array, skip: Array, uv2_fn := Callable()) -> Dictionary:
	var mesh := ArrayMesh.new()
	var triangles := 0
	var surfaces := 0
	for m: Dictionary in tile.header.meshes:
		var material := str(m.material)
		if (not only.is_empty() and not material in only) or material in skip:
			continue
		var n := int(m.vertices)
		if n <= 0 or int(m.indices) <= 0:
			continue
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = TileReader.vec3(tile, int(m.pos), n)
		arrays[Mesh.ARRAY_NORMAL] = TileReader.vec3(tile, int(m.nrm), n)
		arrays[Mesh.ARRAY_INDEX] = TileReader.ints(tile, int(m.idx), int(m.indices))
		if m.has("uv"):
			arrays[Mesh.ARRAY_TEX_UV] = TileReader.vec2(tile, int(m.uv), n)
		if m.has("uv2"):
			arrays[Mesh.ARRAY_TEX_UV2] = TileReader.vec2(tile, int(m.uv2), n) if not uv2_fn.is_valid() else uv2_fn.call(TileReader.vec2(tile, int(m.uv2), n))
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		mesh.surface_set_name(surfaces, str(m.name))
		mesh.surface_set_material(surfaces, materials.get(material, materials[OTHER]))
		surfaces += 1
		triangles += int(m.indices) / 3
	if surfaces == 0:
		return {"mesh": null, "triangles": 0, "node": null}
	if not TileReader.inside(mesh.get_aabb(), tile.size, tile.margin):
		return {"error": "a mesh reaches outside the tile plus its %.0f m margin (%s)" % [tile.margin, mesh.get_aabb()]}
	return {"mesh": mesh, "triangles": triangles, "node": null}


## Main thread: puts a built part into the tree under `root` at the tile's origin.
static func attach(root: Node3D, name: String, tile: Dictionary, part: Dictionary) -> void:
	if part.mesh == null:
		return
	var mi := MeshInstance3D.new()
	mi.name = "%s_%s" % [name, tile.id]
	mi.mesh = part.mesh
	mi.position = tile.origin
	root.add_child(mi)
	part.node = mi


## Main thread: frees the node and lets the mesh go. When the scene itself is leaving (the node has already left the
## tree with its parent, which is busy removing children) the node is only queued: its parent frees it.
static func dispose(part: Dictionary) -> void:
	if part.node != null and is_instance_valid(part.node):
		var node: Node = part.node
		if node.is_inside_tree():
			node.free()
		else:
			node.queue_free()
	part.node = null
	part.mesh = null
