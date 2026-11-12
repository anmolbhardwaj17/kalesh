## The world frame: where each block of the map sits in world metres, read from the tile index (TECH.md "World
## layout"). A block is placed by a translation only: world = block metres + the block's offset (no rotation, scale
## or mirror; east +X, north -Z). The centre block's frame origin is India Gate, so a latitude and longitude lands at
## offset + geo_to_world(lat, lon). Also the one world grid of 250 m tiles (the same rule as tools/bake/layout/grid.ts:
## a tile id comes from world metres only, tile (0, 0) has its north-west corner on the world origin).
## Plain floats in and out: Vector2 and Vector3 are 32 bit, so maths stays in floats and only tile keys are vectors.
extends RefCounted

const Geo := preload("res://geo/projection.gd")
const TILE := 250.0
## No position may lie farther from the world origin than this (a 32 bit float steps by 0.49 mm up to here; rule
## R-STITCH-06, after the recentre step of the bake).
const REACH := 8192.0

## Block id -> [offset x, offset z] in world metres.
var offsets := {}


## The frame of a parsed index.json: its block and offset (and every entry of `blocks` that carries its own offset).
static func from_index(index: Dictionary) -> RefCounted:
	var out: RefCounted = load("res://geo/world_frame.gd").new()
	var off: Variant = index.get("offset")
	if typeof(off) == TYPE_ARRAY and (off as Array).size() == 2:
		out.offsets[str(index.get("block", "centre"))] = [float(off[0]), float(off[1])]
	for b: Variant in index.get("blocks", []):
		if typeof(b) == TYPE_DICTIONARY and typeof((b as Dictionary).get("offset")) == TYPE_ARRAY:
			out.offsets[str(b.id)] = [float(b.offset[0]), float(b.offset[1])]
	return out


func has_block(block: String) -> bool:
	return offsets.has(block)


## Block metres to world metres: {x, z}. An unknown block has no offset (and is reported by has_block).
func block_to_world(block: String, x: float, z: float) -> Dictionary:
	var o: Array = offsets.get(block, [0.0, 0.0])
	return {"x": x + float(o[0]), "z": z + float(o[1])}


func world_to_block(block: String, x: float, z: float) -> Dictionary:
	var o: Array = offsets.get(block, [0.0, 0.0])
	return {"x": x - float(o[0]), "z": z - float(o[1])}


## A latitude and longitude of the centre block in world metres: {x, z}.
func geo_to_world(lat: float, lon: float) -> Dictionary:
	var p: Dictionary = Geo.geo_to_world(lat, lon)
	return block_to_world("centre", p.x, p.z)


## The tile of a world position.
static func tile_of(x: float, z: float) -> Vector2i:
	return Vector2i(floori(x / TILE), floori(z / TILE))


## "<tileX>_<tileZ>", the id the bake, the overrides and the inspector use.
static func tile_id(key: Vector2i) -> String:
	return "%d_%d" % [key.x, key.y]


## World metres of a tile's north-west corner: [x, z].
static func tile_corner(key: Vector2i) -> Array:
	return [key.x * TILE, key.y * TILE]


## Distance on the ground from a world point to the nearest point of a tile's square (0 inside it). `cell` is the
## square's side: 250 m tiles, or the 1 km cells of the far ring.
static func tile_distance(key: Vector2i, x: float, z: float, cell := TILE) -> float:
	var dx := maxf(maxf(key.x * cell - x, x - (key.x + 1) * cell), 0.0)
	var dz := maxf(maxf(key.y * cell - z, z - (key.y + 1) * cell), 0.0)
	return sqrt(dx * dx + dz * dz)


## True when a world position is inside the reach limit.
static func within_reach(x: float, z: float) -> bool:
	return sqrt(x * x + z * z) <= REACH
