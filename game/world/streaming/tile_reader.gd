## Reads one KTL1 tile (TECH.md "Tile format (T1, KTL1)", written by tools/bake/tile/): the file's bytes, its JSON
## header and typed views of its arrays. Safe on a WorkerThreadPool thread: it touches no node and no shared state.
## It builds nothing: each streamed system (game/world/systems/) turns the arrays it needs into its own parts.
##
## Rules (a tile that breaks one is refused with a reason; the streaming core reports it and skips it, the tiles
## around it still load):
## - the magic is KTL1 and the version is VERSION, anything else fails loudly;
## - every array the header names lies inside the file;
## - the magnitude rule: no lane point or pin lies outside the tile square plus the header's margin. Mesh bounds are
##   checked by the systems with `inside()` right after the engine worked them out (no per-vertex script work).
## File layout: "KTL1", u32 version, u32 header length, a JSON header, then float32 and uint32 arrays (little endian).
extends RefCounted

const MAGIC := "KTL1"
const VERSION := 1


## Reads a tile file. {ok = true, path, bytes, base, header, size, margin, origin: Vector3 (world metres), block, key:
## Vector2i, pins: [{id, name, kind, pos (tile metres)}], thread_us} or {ok = false, error}.
static func read(path: String) -> Dictionary:
	var t0 := Time.get_ticks_usec()
	if not FileAccess.file_exists(path):
		return {"ok": false, "error": "%s: no such tile file" % path}
	var f := FileAccess.open(path, FileAccess.READ)
	if f == null:
		return {"ok": false, "error": "%s: cannot open (error %d)" % [path, FileAccess.get_open_error()]}
	var tile := parse(f.get_buffer(f.get_length()))
	f.close()
	if not tile.ok:
		tile["error"] = "%s: %s" % [path, tile.error]
		return tile
	tile["path"] = path
	tile["thread_us"] = Time.get_ticks_usec() - t0
	return tile


## The same from bytes already in memory.
static func parse(bytes: PackedByteArray) -> Dictionary:
	if bytes.size() < 12 or bytes.slice(0, 4).get_string_from_ascii() != MAGIC:
		return {"ok": false, "error": "not a KTL1 tile"}
	var version := bytes.decode_u32(4)
	if version != VERSION:
		return {"ok": false, "error": "KTL1 version %d is not supported (this build reads version %d)" % [version, VERSION]}
	var head_len := bytes.decode_u32(8)
	if 12 + head_len > bytes.size():
		return {"ok": false, "error": "the header runs past the end of the file"}
	var parsed: Variant = JSON.parse_string(bytes.slice(12, 12 + head_len).get_string_from_ascii())
	if typeof(parsed) != TYPE_DICTIONARY:
		return {"ok": false, "error": "the tile header is not JSON"}
	var header: Dictionary = parsed
	if typeof(header.get("tile")) != TYPE_DICTIONARY or typeof(header.get("origin")) != TYPE_ARRAY or typeof(header.get("meshes")) != TYPE_ARRAY:
		return {"ok": false, "error": "the tile header has no tile, origin or meshes"}
	var base := 12 + head_len
	var room := bytes.size() - base
	var why := _ranges(header, room)
	if why != "":
		return {"ok": false, "error": why}
	var o: Array = header.origin
	var tile := {
		"ok": true, "bytes": bytes, "base": base, "header": header, "size": float(header.tile.size),
		"margin": float(header.margin) if header.get("margin") != null else -1.0,
		"origin": Vector3(float(o[0]), float(o[1]), float(o[2])),
		"block": str(header.tile.get("district", header.tile.get("block", ""))),
		"key": Vector2i(int(header.tile.x), int(header.tile.z)),
	}
	var pins: Array[Dictionary] = []
	var box_set := false
	var box := AABB()
	for p: Dictionary in header.get("pins", []):
		var pos: Array = p.pos
		var at := Vector3(float(pos[0]), float(pos[1]), float(pos[2]))
		pins.append({"id": str(p.id), "name": str(p.get("name", "")), "kind": str(p.get("kind", "")), "pos": at})
		box = box.expand(at) if box_set else AABB(at, Vector3.ZERO)
		box_set = true
	tile["pins"] = pins
	for q in lane_points(tile):
		box = box.expand(q) if box_set else AABB(q, Vector3.ZERO)
		box_set = true
	if box_set and not inside(box, tile.size, tile.margin):
		return {"ok": false, "error": "a lane point or pin lies outside the tile plus its %.0f m margin" % tile.margin}
	return tile


## "" when every array of the header lies inside the payload of `room` bytes, else what does not.
static func _ranges(header: Dictionary, room: int) -> String:
	for m: Dictionary in header.meshes:
		var n := int(m.get("vertices", 0))
		var spans := [[int(m.get("pos", 0)), n * 12], [int(m.get("nrm", 0)), n * 12], [int(m.get("idx", 0)), int(m.get("indices", 0)) * 4]]
		if m.has("uv"):
			spans.append([int(m.uv), n * 8])
		if m.has("uv2"):
			spans.append([int(m.uv2), n * 8])
		for s: Array in spans:
			if s[0] < 0 or s[1] < 0 or s[0] + s[1] > room:
				return "mesh %s names bytes outside the file" % str(m.get("name", "?"))
	for c: Dictionary in header.get("colliders", []):
		var from := int(c.get("faces", 0))
		if from < 0 or from + int(c.get("triangles", 0)) * 36 > room:
			return "collider %s names bytes outside the file" % str(c.get("name", "?"))
	var lanes: Variant = header.get("lanes")
	if typeof(lanes) == TYPE_DICTIONARY and (lanes as Dictionary).has("list"):
		if int(lanes.get("pts", 0)) < 0 or int(lanes.get("pts", 0)) + int(lanes.get("points", 0)) * 12 > room:
			return "the lane points lie outside the file"
		for l: Dictionary in lanes.list:
			if int(l.get("start", 0)) < 0 or int(l.get("start", 0)) + int(l.get("count", 0)) > int(lanes.get("points", 0)):
				return "lane %s names points outside the lane array" % str(l.get("id", "?"))
	return ""


## `count` float32 triples at payload offset `at`, in one call.
static func vec3(tile: Dictionary, at: int, count: int) -> PackedVector3Array:
	var from: int = int(tile.base) + at
	return (tile.bytes as PackedByteArray).slice(from, from + count * 12).to_vector3_array()


## `count` float32 pairs at payload offset `at`.
static func vec2(tile: Dictionary, at: int, count: int) -> PackedVector2Array:
	var from: int = int(tile.base) + at
	return (tile.bytes as PackedByteArray).slice(from, from + count * 8).to_vector2_array()


## `count` uint32 at payload offset `at` (indices).
static func ints(tile: Dictionary, at: int, count: int) -> PackedInt32Array:
	var from: int = int(tile.base) + at
	return (tile.bytes as PackedByteArray).slice(from, from + count * 4).to_int32_array()


## Every lane point of the tile, in tile metres (empty when the tile has no lanes).
static func lane_points(tile: Dictionary) -> PackedVector3Array:
	var lanes: Variant = tile.header.get("lanes")
	if typeof(lanes) != TYPE_DICTIONARY or not (lanes as Dictionary).has("list"):
		return PackedVector3Array()
	return vec3(tile, int(lanes.pts), int(lanes.points))


## The magnitude rule on a box of tile metres: x and z within the square plus the margin, y within eight margins
## (the bake's codec.ts badVertex). A tile with no margin in its header (a Phase 0 bench tile) is not checked.
static func inside(box: AABB, size: float, margin: float) -> bool:
	if margin < 0.0:
		return true
	var lo := box.position
	var hi := box.end
	return lo.x >= -margin and lo.z >= -margin and hi.x <= size + margin and hi.z <= size + margin and lo.y >= -margin * 8.0 and hi.y <= margin * 8.0
