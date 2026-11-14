## The bake's tile index (index.json of a tile folder, written by tools/bake/tile/write.ts): which 250 m tiles exist,
## their files, bytes and origins, the bake hash and the block offset. Read once at start; the streaming core asks it
## which tiles exist and where their files are. It reads no tile and builds nothing.
extends RefCounted

## --tiles values -> tile folders. A value that starts with res:// is a folder as it is.
const FOLDERS := {
	"test": "res://world/test_tiles/",
	"full": "res://world/tiles/",
}

var folder := ""
var error := ""
var bake_hash := ""
var stage := ""
var size := 250.0
var margin := 250.0
## The raw index (block ids and offsets for game/geo/world_frame.gd).
var raw := {}
## Vector2i(tile x, tile z) -> {key, id, file, bytes, origin: Vector3 (world metres of the north-west corner at the
## tile's lowest ground), chunks, triangles, colliderTriangles, lanes}.
var tiles := {}
var total_bytes := 0
## The landmark file of the folder (landmarks.json, P2-006; empty when the folder has none): where each placed
## landmark stands with its LOD slots, the far landmarks of the backdrop, the far silhouettes and the limits
## (game/world/landmark_slots.gd picks the level each one shows).
var landmarks: Array = []
var far_landmarks: Array = []
var silhouettes: Array = []
var landmark_limits := {}
## The infrastructure kits of the folder (infra.json, P2-034; empty when the folder has none): tile id -> records.
var infra := {}
## Far skyline pieces of infra.json (the Signature Bridge): never reachable.
var infra_skyline: Array = []


## The tile folder of a --tiles value ("" for an unknown name).
static func folder_of(value: String) -> String:
	if value.begins_with("res://"):
		return value if value.ends_with("/") else value + "/"
	return FOLDERS.get(value, "")


## Opens a folder's index.json. `error` is "" when it loaded.
static func open(dir: String) -> RefCounted:
	var out: RefCounted = load("res://world/streaming/tile_index.gd").new()
	out.folder = dir
	var f := dir + "index.json"
	if not FileAccess.file_exists(f):
		out.error = "no %s (the full set is baked by `npm run bake -- pilot`, the test block is committed)" % f
		return out
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(f))
	if typeof(parsed) != TYPE_DICTIONARY or typeof((parsed as Dictionary).get("tiles")) != TYPE_ARRAY:
		out.error = "%s is not a tile index" % f
		return out
	out.take(parsed)
	var lf := dir + "landmarks.json"
	if FileAccess.file_exists(lf):
		var lm: Variant = JSON.parse_string(FileAccess.get_file_as_string(lf))
		if typeof(lm) == TYPE_DICTIONARY:
			out.take_landmarks(lm)
	var inf := dir + "infra.json"
	if FileAccess.file_exists(inf):
		var parsed_infra: Variant = JSON.parse_string(FileAccess.get_file_as_string(inf))
		if typeof(parsed_infra) == TYPE_DICTIONARY and typeof((parsed_infra as Dictionary).get("tiles")) == TYPE_DICTIONARY:
			out.infra = parsed_infra.tiles
			out.infra_skyline = parsed_infra.get("skyline", [])
	return out


## Fills the index from a parsed index.json (tests pass their own).
func take(index: Dictionary) -> void:
	raw = index
	bake_hash = str(index.get("bakeHash", ""))
	stage = str(index.get("stage", ""))
	size = float(index.get("size", 250.0))
	margin = float(index.get("margin", 250.0))
	tiles.clear()
	total_bytes = 0
	for rec: Dictionary in index.tiles:
		var key := Vector2i(int(rec.x), int(rec.z))
		var o: Array = rec.get("origin", [key.x * size, 0.0, key.y * size])
		tiles[key] = {
			"key": key, "id": str(rec.get("id", "%d_%d" % [key.x, key.y])), "file": str(rec.get("file", "%d_%d.ktl" % [key.x, key.y])),
			"bytes": int(rec.get("bytes", 0)), "origin": Vector3(float(o[0]), float(o[1]), float(o[2])),
			"chunks": int(rec.get("chunks", 0)), "triangles": int(rec.get("triangles", 0)),
			"colliderTriangles": int(rec.get("colliderTriangles", 0)), "lanes": int(rec.get("lanes", 0)),
		}
		total_bytes += int(rec.get("bytes", 0))


## Fills the landmark lists from a parsed landmarks.json (tests pass their own).
func take_landmarks(file: Dictionary) -> void:
	landmarks = file.get("landmarks", [])
	far_landmarks = file.get("far", [])
	silhouettes = file.get("silhouettes", [])
	landmark_limits = file.get("limits", {})


func has(key: Vector2i) -> bool:
	return tiles.has(key)


func count() -> int:
	return tiles.size()


## The file of a tile ("" when the index has no such tile).
func path(key: Vector2i) -> String:
	return folder + str(tiles[key].file) if tiles.has(key) else ""


## The tile of the index whose centre is nearest to a world point (where a game with no save starts). Ties go to the
## lower id, so the answer does not depend on the order of the file.
func nearest(x: float, z: float) -> Vector2i:
	var best := Vector2i.ZERO
	var best_d := INF
	for key: Vector2i in tiles:
		var d := Vector2((key.x + 0.5) * size - x, (key.y + 0.5) * size - z).length()
		if d < best_d - 1e-6 or (absf(d - best_d) <= 1e-6 and str(tiles[key].id) < str(tiles[best].id)):
			best_d = d
			best = key
	return best
