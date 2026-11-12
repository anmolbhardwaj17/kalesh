## Reader of our own binary tile (ARCH_OPTIONS T1, written by tools/bake/tile/codec.ts encodeT1; the production tiles
## by tools/bake/tile/write.ts). Safe to call on a WorkerThreadPool thread: it reads the file, turns each array into a
## packed array in one call (no per-vertex script work) and builds meshes, collider shapes and MultiMesh placements
## as nodes that are not in the tree yet, plus the lane pieces and pins as data.
## File layout: "KTL1", u32 version, u32 header length, a JSON header, then float32 and uint32 arrays.
## Magnitude rule (TECH.md "Tile format"): a production tile names a margin; a mesh whose bounds (worked out by the
## engine when the surface is added) reach past the tile square plus that margin, or a lane point or pin past it,
## refuses the whole tile. Collider faces are made from the same vertices by the bake (checked there and in tests).
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
	var size := float(header.tile.size)
	var margin := float(header.margin) if header.get("margin") != null else -1.0
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
		if m.has("uv"):
			arrays[Mesh.ARRAY_TEX_UV] = bytes.slice(base + int(m.uv), base + int(m.uv) + n * 8).to_vector2_array()
		if m.has("uv2"):
			arrays[Mesh.ARRAY_TEX_UV2] = bytes.slice(base + int(m.uv2), base + int(m.uv2) + n * 8).to_vector2_array()
		var mesh := ArrayMesh.new()
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		if margin >= 0.0 and not _inside(mesh.get_aabb(), size, margin):
			root.free()
			return {"ok": false, "error": "mesh %s reaches outside the tile plus its %.0f m margin (%s)" % [m.name, margin, mesh.get_aabb()]}
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
	# the lane graph pieces and the pins, as data (traffic and missions read them); a few hundred points a tile
	var lanes: Array[Dictionary] = []
	var points := PackedVector3Array()
	var lane_head: Variant = header.get("lanes")
	if typeof(lane_head) == TYPE_DICTIONARY and (lane_head as Dictionary).has("list"):
		points = _vec3(bytes, base + int(lane_head.pts), int(lane_head.points))
		for l: Dictionary in lane_head.list:
			var piece := l.duplicate()
			piece["pts"] = points.slice(int(l.start), int(l.start) + int(l.count))
			lanes.append(piece)
	var pins: Array[Dictionary] = []
	for p: Dictionary in header.get("pins", []):
		var pos: Array = p.pos
		var at := Vector3(pos[0], pos[1], pos[2])
		points.append(at)
		pins.append({"id": str(p.id), "name": str(p.name), "kind": str(p.kind), "pos": at})
	if margin >= 0.0 and points.size() > 0:
		var box := AABB(points[0], Vector3.ZERO)
		for q in points:
			box = box.expand(q)
		if not _inside(box, size, margin):
			root.free()
			for b in bodies:
				b.free()
			return {"ok": false, "error": "a lane point or pin lies outside the tile plus its %.0f m margin" % margin}
	return {
		"ok": true, "root": root, "bodies": bodies, "header": header, "bytes": bytes.size(), "triangles": triangles,
		"collider_triangles": collider_triangles, "placements": placements, "lanes": lanes, "pins": pins,
	}


## The magnitude rule on a box of tile-relative metres: x and z within the square plus the margin, y within eight
## margins (the bake's codec.ts badVertex).
static func _inside(box: AABB, size: float, margin: float) -> bool:
	var lo := box.position
	var hi := box.end
	return lo.x >= -margin and lo.z >= -margin and hi.x <= size + margin and hi.z <= size + margin and lo.y >= -margin * 8.0 and hi.y <= margin * 8.0
