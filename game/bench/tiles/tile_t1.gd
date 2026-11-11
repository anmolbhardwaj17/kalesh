## Reader of our own binary tile (ARCH_OPTIONS T1, written by tools/bake/tile.ts encodeT1). Safe to call on a
## WorkerThreadPool thread: it reads the file, turns each array into a packed array in one call (no per-vertex
## script work) and builds meshes, collider shapes and MultiMesh placements as nodes that are not in the tree yet.
## File layout: "KTL1", u32 version, u32 header length, a JSON header, then float32 and uint32 arrays.
extends RefCounted

const MAGIC := "KTL1"
const VERSION := 1


## Reads the header only: {ok, header, base} (base is the byte offset of the payload), or {ok = false, error}.
static func read_header(bytes: PackedByteArray) -> Dictionary:
	if bytes.size() < 12 or bytes.slice(0, 4).get_string_from_ascii() != MAGIC:
		return {"ok": false, "error": "not a KTL1 tile"}
	if bytes.decode_u32(4) != VERSION:
		return {"ok": false, "error": "KTL1 version %d is not supported" % bytes.decode_u32(4)}
	var head_len := bytes.decode_u32(8)
	var header: Variant = JSON.parse_string(bytes.slice(12, 12 + head_len).get_string_from_ascii())
	if typeof(header) != TYPE_DICTIONARY:
		return {"ok": false, "error": "the tile header is not JSON"}
	return {"ok": true, "header": header, "base": 12 + head_len}


static func _vec3(bytes: PackedByteArray, from: int, count: int) -> PackedVector3Array:
	return bytes.slice(from, from + count * 12).to_vector3_array()


## Loads a tile file into nodes. Returns {ok, root (Node3D with the meshes and placements), bodies (StaticBody3D per
## collider chunk, not children of root: the caller attaches them a few per frame), header, bytes, thread_us}.
static func load_tile(path: String) -> Dictionary:
	var t0 := Time.get_ticks_usec()
	var tile := build_tile(FileAccess.get_file_as_bytes(path))
	if not tile.ok:
		tile["error"] = "%s: %s" % [path, tile.error]
	tile["thread_us"] = Time.get_ticks_usec() - t0
	return tile


## The same from bytes already in memory.
static func build_tile(bytes: PackedByteArray) -> Dictionary:
	var head := read_header(bytes)
	if not head.ok:
		return {"ok": false, "error": head.error}
	var header: Dictionary = head.header
	var base: int = head.base
	var root := Node3D.new()
	root.name = "Tile_%s_%d_%d" % [header.tile.district, int(header.tile.x), int(header.tile.z)]
	var triangles := 0
	for m: Dictionary in header.meshes:
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		var n := int(m.vertices)
		arrays[Mesh.ARRAY_VERTEX] = _vec3(bytes, base + int(m.pos), n)
		arrays[Mesh.ARRAY_NORMAL] = _vec3(bytes, base + int(m.nrm), n)
		arrays[Mesh.ARRAY_INDEX] = bytes.slice(base + int(m.idx), base + int(m.idx) + int(m.indices) * 4).to_int32_array()
		var mesh := ArrayMesh.new()
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		var mi := MeshInstance3D.new()
		mi.name = str(m.name)
		mi.mesh = mesh
		mi.set_meta("material", str(m.material))
		root.add_child(mi)
		triangles += int(m.indices) / 3
	var bodies: Array[StaticBody3D] = []
	var collider_triangles := 0
	for c: Dictionary in header.colliders:
		var shape := ConcavePolygonShape3D.new()
		shape.set_faces(_vec3(bytes, base + int(c.faces), int(c.triangles) * 3))
		var body := StaticBody3D.new()
		body.name = str(c.name)
		var cs := CollisionShape3D.new()
		cs.shape = shape
		body.add_child(cs)
		bodies.append(body)
		collider_triangles += int(c.triangles)
	var placements := 0
	for p: Dictionary in header.placements:
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.instance_count = int(p.count)
		mm.buffer = bytes.slice(base + int(p.xforms), base + int(p.xforms) + int(p.count) * 48).to_float32_array()
		var mmi := MultiMeshInstance3D.new()
		mmi.name = str(p.module)
		mmi.multimesh = mm
		mmi.set_meta("module", str(p.module))
		root.add_child(mmi)
		placements += int(p.count)
	return {
		"ok": true, "root": root, "bodies": bodies, "header": header, "bytes": bytes.size(), "triangles": triangles,
		"collider_triangles": collider_triangles, "placements": placements,
	}
