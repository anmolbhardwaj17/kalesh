## Which tiles the streaming core wants, keeps and drops (TECH.md "Streaming (ST1, TL1)"). Pure maths on tile keys and a
## focus: no nodes, no files, so game/tests/test_streaming.gd checks it directly.
##
## Three rings. Ring 0 is full detail (roads, ground, shells, colliders, lanes) to about 375 m; ring 1 is block shells
## to about 900 m; ring 2 is the skyline, one mesh per 1 km cell, always loaded. Rings 1 and 2 only say which cells
## are inside: what they load is registered with the core by the P2 systems.
##
## Distance and heading: a tile is wanted when its square comes within the ring's radius of the focus, or of the
## lead point (where the focus will be in `lead_s` seconds on its heading, at most `lead_max` metres ahead). Tiles
## nearest to the lead point load first, so the road ahead comes before the road behind.
## Hysteresis: a loaded tile is kept until it is `hysteresis` metres past the radius, so a player who turns round at a
## ring edge does not unload and reload the same tile.
## Memory cap: at most `cap_tiles` tiles and `cap_bytes` of tile files are loaded; over the cap the farthest go first.
extends RefCounted

const WorldFrame := preload("res://geo/world_frame.gd")
const RING_FULL := 0
const RING_SHELLS := 1
const RING_SKYLINE := 2
## id, radius in metres (INF: every cell of the map) and the side of the cells the ring loads.
const RINGS := [
	{"id": "full", "radius": 375.0, "cell": 250.0},
	{"id": "shells", "radius": 900.0, "cell": 250.0},
	{"id": "skyline", "radius": INF, "cell": 1000.0},
]

var radius := [375.0, 900.0, INF]
var hysteresis := 125.0
var lead_s := 2.0
var lead_max := 150.0
var cap_tiles := 40
var cap_bytes := 96 * 1048576


## The point the focus is heading for: [x, z].
func lead_point(x: float, z: float, dir: Vector2, speed: float) -> Array:
	var ahead := minf(maxf(speed, 0.0) * lead_s, lead_max)
	return [x + dir.x * ahead, z + dir.y * ahead]


## How near a cell is: metres from its square to the focus or to the lead point, whichever is less.
func reach(key: Vector2i, x: float, z: float, dir: Vector2, speed: float, ring := RING_FULL) -> float:
	var cell: float = RINGS[ring].cell
	var lead := lead_point(x, z, dir, speed)
	return minf(WorldFrame.tile_distance(key, x, z, cell), WorldFrame.tile_distance(key, lead[0], lead[1], cell))


## Load order: metres from the cell to the lead point, the distance to the focus breaking ties. Lower loads first.
func rank(key: Vector2i, x: float, z: float, dir: Vector2, speed: float, ring := RING_FULL) -> float:
	var cell: float = RINGS[ring].cell
	var lead := lead_point(x, z, dir, speed)
	return WorldFrame.tile_distance(key, lead[0], lead[1], cell) + 0.001 * WorldFrame.tile_distance(key, x, z, cell)


## The cells of a ring to load, best rank first. `exists` says if the map has a cell (Callable(Vector2i) -> bool);
## for the skyline ring (radius INF) pass `all`, the cells of the map.
func wanted(x: float, z: float, dir: Vector2, speed: float, exists: Callable, ring := RING_FULL, all: Array = []) -> Array[Vector2i]:
	var out: Array[Vector2i] = []
	var r: float = radius[ring]
	var cell: float = RINGS[ring].cell
	if is_inf(r):
		for key: Vector2i in all:
			out.append(key)
	else:
		var lead := lead_point(x, z, dir, speed)
		# one cell more on the low side: a cell whose far edge is exactly r away is still inside
		var x0 := floori((minf(x, lead[0]) - r) / cell) - 1
		var x1 := floori((maxf(x, lead[0]) + r) / cell)
		var z0 := floori((minf(z, lead[1]) - r) / cell) - 1
		var z1 := floori((maxf(z, lead[1]) + r) / cell)
		for tz in range(z0, z1 + 1):
			for tx in range(x0, x1 + 1):
				var key := Vector2i(tx, tz)
				if exists.call(key) and reach(key, x, z, dir, speed, ring) <= r:
					out.append(key)
	var ranks := {}
	for key in out:
		ranks[key] = rank(key, x, z, dir, speed, ring)
	out.sort_custom(func(a: Vector2i, b: Vector2i) -> bool:
		return ranks[a] < ranks[b] or (ranks[a] == ranks[b] and (a.x < b.x or (a.x == b.x and a.y < b.y))))
	return out


## True while a loaded cell stays loaded: inside the radius plus the hysteresis.
func keep(key: Vector2i, x: float, z: float, dir: Vector2, speed: float, ring := RING_FULL) -> bool:
	var r: float = radius[ring]
	return is_inf(r) or reach(key, x, z, dir, speed, ring) <= r + hysteresis


## True when the whole ring around the focus itself (no lead) is in `live`: every cell the map has within the radius.
func ring_live(x: float, z: float, exists: Callable, live: Callable, ring := RING_FULL) -> bool:
	for key in wanted(x, z, Vector2.ZERO, 0.0, exists, ring):
		if not live.call(key):
			return false
	return true


## The loaded cells to drop, the farthest from the focus first. `loaded` maps a key to its file bytes.
## - Over the cap (count or bytes): cells go until it fits, cells outside `wanted_set` before wanted ones.
## - `incoming` wanted cells are waiting to load and there is no room: cells outside `wanted_set` (the hysteresis
##   band) go to make room. A wanted cell is never dropped for another wanted cell.
func over_cap(loaded: Dictionary, wanted_set: Dictionary, x: float, z: float, incoming := 0) -> Array[Vector2i]:
	var out: Array[Vector2i] = []
	var count := loaded.size()
	var total := 0
	for key: Vector2i in loaded:
		total += int(loaded[key])
	if count + incoming <= cap_tiles and total <= cap_bytes:
		return out
	var keys: Array[Vector2i] = []
	var far := {}
	for key: Vector2i in loaded:
		keys.append(key)
		far[key] = WorldFrame.tile_distance(key, x, z) + (0.0 if wanted_set.has(key) else 1e6)
	keys.sort_custom(func(a: Vector2i, b: Vector2i) -> bool:
		return far[a] > far[b] or (far[a] == far[b] and (a.x < b.x or (a.x == b.x and a.y < b.y))))
	for key in keys:
		var over := count > cap_tiles or total > cap_bytes
		var tight := count + incoming > cap_tiles and not wanted_set.has(key)
		if not over and not tight:
			break
		out.append(key)
		count -= 1
		total -= int(loaded[key])
	return out
