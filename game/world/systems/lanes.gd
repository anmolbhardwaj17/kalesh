## Streamed system: the lane graph of the loaded tiles, held as data for the later traffic and pursuit (TECH.md "Tile
## format": lane pieces `<lane>:<k>` cut at the tile lines, with `next` and `back` ids that cross tiles). It draws
## nothing and has no physics. Points are world metres. A piece whose `next` id is not here yet belongs to a tile
## that is not loaded.
## Budget: one data step a tile, off the mesh and collider lanes.
extends RefCounted

const TileReader := preload("res://world/streaming/tile_reader.gd")

var id := "lanes"
var lane := "data"
var exclusive := false
var per_frame := 0
var budget_ms := 0.3
## Piece id -> {id, of, kind, cls, layer, width, next, back, tile: Vector2i, pts: PackedVector3Array, length}.
var pieces := {}


## Worker thread: the tile's pieces with their points moved to world metres (a few hundred points a tile).
func prepare(tile: Dictionary) -> Variant:
	var out: Array[Dictionary] = []
	var head: Variant = tile.header.get("lanes")
	if typeof(head) != TYPE_DICTIONARY or not (head as Dictionary).has("list"):
		return {"pieces": out, "on": false}
	var points := TileReader.lane_points(tile)
	var origin: Vector3 = tile.origin
	for l: Dictionary in head.list:
		var pts := points.slice(int(l.start), int(l.start) + int(l.count))
		var length := 0.0
		for i in pts.size():
			pts[i] += origin
			if i > 0:
				length += pts[i - 1].distance_to(pts[i])
		out.append({
			"id": str(l.id), "of": str(l.get("of", "")), "kind": str(l.get("kind", "lane")), "cls": str(l.get("cls", "")),
			"layer": int(l.get("layer", 0)), "width": float(l.get("widthM", 0.0)), "next": l.get("next", []), "back": l.get("back", []),
			"tile": tile.key, "pts": pts, "length": length,
		})
	return {"pieces": out, "on": false}


func attach(_tile: Dictionary, part: Variant) -> bool:
	for p: Dictionary in part.pieces:
		pieces[p.id] = p
	part.on = true
	return true


func dispose(tile: Dictionary, part: Variant) -> bool:
	if part.on:
		for p: Dictionary in part.pieces:
			if pieces.has(p.id) and pieces[p.id].tile == tile.key:
				pieces.erase(p.id)
	part.on = false
	part.pieces = [] as Array[Dictionary]
	return true


## The piece of an id, or {} when its tile is not loaded.
func piece(piece_id: String) -> Dictionary:
	return pieces.get(piece_id, {})


## Where a vehicle can start: the first point of the longest lane piece at grade (layer 0, a lane, not a junction
## path) with at least 2 points, in `tile` when given, heading along it. {pos, heading (compass radians, 0 north),
## lane, length_m}, or {} when there is none.
func spawn(tile: Variant = null) -> Dictionary:
	var best := {}
	for key: String in pieces:
		var p: Dictionary = pieces[key]
		if p.layer != 0 or p.kind != "lane" or (p.pts as PackedVector3Array).size() < 2 or (tile != null and p.tile != tile):
			continue
		if best.is_empty() or p.length > best.length or (is_equal_approx(p.length, best.length) and str(p.id) < str(best.id)):
			best = p
	if best.is_empty():
		return {}
	var pts: PackedVector3Array = best.pts
	var d := pts[mini(pts.size() - 1, 3)] - pts[0]
	return {"pos": pts[0], "heading": atan2(d.x, -d.z), "lane": str(best.id), "length_m": float(best.length)}


func info() -> Dictionary:
	return {"pieces": pieces.size()}
