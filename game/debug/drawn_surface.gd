## The drawn surface of the streamed city for the city checks (P1-024): the up-facing triangles of a tile file's meshes
## (paint, water and deck undersides left out: nothing stands on them, and the bake leaves them out of the colliders),
## in world metres, binned in CELL m cells so a height lookup tests a few triangles. Tiles are read from their files on
## first use and cached. A triangle belongs to the tile of its centre and may reach past the tile by the index's
## `overhangM`, so a lookup also asks the neighbours whose overhang covers the point.
## Debug only: it reads the files the game drew, never the game's nodes.
extends RefCounted

const TileReader := preload("res://world/streaming/tile_reader.gd")
const WorldFrame := preload("res://geo/world_frame.gd")
const NOT_GROUND := ["marking", "water", "underside", "ceiling"]
const CELL := 8.0

var index: RefCounted = null
## Tile key -> {tris: PackedVector3Array (3 a triangle), mats: PackedStringArray, grid: {Vector2i: Array[int]}}.
var _tiles := {}
var _overhang := {}
var read_ms := 0.0


func _init(tile_index: RefCounted) -> void:
	index = tile_index
	for rec: Dictionary in index.raw.get("tiles", []):
		_overhang[Vector2i(int(rec.x), int(rec.z))] = float(rec.get("overhangM", 0.0))


## Every drawn height over (x, z): [[y, material], ...].
func heights(x: float, z: float) -> Array:
	var out := []
	var key := WorldFrame.tile_of(x, z)
	var cell := Vector2i(floori(x / CELL), floori(z / CELL))
	for dz in range(-1, 2):
		for dx in range(-1, 2):
			var k := key + Vector2i(dx, dz)
			if not index.has(k) or (k != key and WorldFrame.tile_distance(k, x, z) > float(_overhang.get(k, 0.0)) + 0.5):
				continue
			var t := _tile(k)
			var list: Array = t.grid.get(cell, [])
			var tris: PackedVector3Array = t.tris
			for i: int in list:
				var y := _height_in(tris[i * 3], tris[i * 3 + 1], tris[i * 3 + 2], x, z)
				if not is_nan(y):
					out.append([y, t.mats[i]])
	return out


## The highest drawn surface at or under `limit`: {y, material} or {} when none.
func top(x: float, z: float, limit := INF) -> Dictionary:
	var best := {}
	for h: Array in heights(x, z):
		if float(h[0]) <= limit and (best.is_empty() or float(h[0]) > float(best.y)):
			best = {"y": float(h[0]), "material": str(h[1])}
	return best


## The drawn surface nearest in height to a point on it (a wheel contact, a foot): {y, material, gap} or {}.
func nearest(x: float, z: float, y: float) -> Dictionary:
	var best := {}
	for h: Array in heights(x, z):
		var gap := absf(float(h[0]) - y)
		if best.is_empty() or gap < float(best.gap):
			best = {"y": float(h[0]), "material": str(h[1]), "gap": gap}
	return best


func _tile(key: Vector2i) -> Dictionary:
	if _tiles.has(key):
		return _tiles[key]
	var t0 := Time.get_ticks_usec()
	var out := {"tris": PackedVector3Array(), "mats": PackedStringArray(), "grid": {}}
	var tile: Dictionary = TileReader.read(index.path(key))
	if tile.ok:
		var origin: Vector3 = tile.origin
		var tris: PackedVector3Array = out.tris
		var mats: PackedStringArray = out.mats
		var grid: Dictionary = out.grid
		for m: Dictionary in tile.header.meshes:
			var mat := str(m.material)
			if mat in NOT_GROUND:
				continue
			var pos := TileReader.vec3(tile, int(m.pos), int(m.vertices))
			var idx := TileReader.ints(tile, int(m.idx), int(m.indices))
			for i in range(0, idx.size(), 3):
				var a := pos[idx[i]] + origin
				var b := pos[idx[i + 1]] + origin
				var c := pos[idx[i + 2]] + origin
				# up-facing only: front faces wind clockwise, so (b - a) x (c - a) points down for one
				if (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z) <= 1e-9:
					continue
				var n := mats.size()
				tris.append(a)
				tris.append(b)
				tris.append(c)
				mats.append(mat)
				var x0 := floori(minf(a.x, minf(b.x, c.x)) / CELL)
				var x1 := floori(maxf(a.x, maxf(b.x, c.x)) / CELL)
				var z0 := floori(minf(a.z, minf(b.z, c.z)) / CELL)
				var z1 := floori(maxf(a.z, maxf(b.z, c.z)) / CELL)
				for cz in range(z0, z1 + 1):
					for cx in range(x0, x1 + 1):
						var cell := Vector2i(cx, cz)
						if not grid.has(cell):
							grid[cell] = []
						grid[cell].append(n)
		out.tris = tris
		out.mats = mats
	_tiles[key] = out
	read_ms += float(Time.get_ticks_usec() - t0) / 1000.0
	return out


## The height of triangle abc over (x, z), or NAN when the point is outside it (stream_probe.gd _top_under's maths).
static func _height_in(a: Vector3, b: Vector3, c: Vector3, x: float, z: float) -> float:
	if (a.x < x and b.x < x and c.x < x) or (a.x > x and b.x > x and c.x > x) or (a.z < z and b.z < z and c.z < z) or (a.z > z and b.z > z and c.z > z):
		return NAN
	var det := (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z)
	if det <= 1e-9:
		return NAN
	var u := ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / det
	var v := ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / det
	if u < 0.0 or v < 0.0 or u + v > 1.0:
		return NAN
	return u * a.y + v * b.y + (1.0 - u - v) * c.y
