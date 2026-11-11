## A 250 m tile for the collider test of the physics bench (P0-017, decision K). It keeps two triangle lists:
##   surfaces   everything you can drive or walk on: roads, kerb faces, footpaths and plots, on a 2.5 m grid over a
##              gently rolling ground
##   detail     the buildings as they are drawn: walls, roofs, window frames, sills and balconies
## plus one box (shell) per building. K1 is one triangle mesh of surfaces and detail together; K3 is a triangle mesh
## of the surfaces (the same vertices as the drawn mesh) plus the shells. Seeded, no mirroring.
extends RefCounted

const Geo := preload("res://bench/physics/geo.gd")

const SIZE := 250.0
const CELL := 2.5
const ROAD_HALF := 5.0
const PATH_OUT := 7.5
const KERB := 0.15
const ROAD := Color(0.24, 0.24, 0.26)
const PATH := Color(0.6, 0.58, 0.54)
const PLOT := Color(0.46, 0.44, 0.38)

var surfaces := Geo.new()
var detail := Geo.new()
## One entry per building: [centre, size].
var shells: Array = []
## 20 points on drivable or walkable ground, away from buildings: tile coordinates (x, z).
var samples := PackedVector2Array()
var stats := {}


static func ground_h(x: float, z: float) -> float:
	return 1.2 * sin(x / 37.0) * cos(z / 51.0) + 0.012 * x


## 0 road, 1 footpath, 2 plot.
static func kind_at(x: float, z: float) -> int:
	var ax := absf(x)
	var az := absf(z)
	if ax < ROAD_HALF or az < ROAD_HALF:
		return 0
	if ax < PATH_OUT or az < PATH_OUT:
		return 1
	return 2


func build(seed_value: int = 7) -> void:
	var t0 := Time.get_ticks_msec()
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_value
	var half := SIZE * 0.5
	var n := int(SIZE / CELL)
	for ix in n:
		for iz in n:
			var x0 := -half + ix * CELL
			var z0 := -half + iz * CELL
			var x1 := x0 + CELL
			var z1 := z0 + CELL
			var k := kind_at(x0 + CELL * 0.5, z0 + CELL * 0.5)
			var lift := 0.0 if k == 0 else KERB
			var c := ROAD if k == 0 else (PATH if k == 1 else PLOT)
			surfaces.quad(Vector3(x0, ground_h(x0, z0) + lift, z0), Vector3(x1, ground_h(x1, z0) + lift, z0),
				Vector3(x1, ground_h(x1, z1) + lift, z1), Vector3(x0, ground_h(x0, z1) + lift, z1), c, Vector3.UP)
			# kerb faces where a road cell meets a raised cell to the east or the south
			if ix + 1 < n:
				var ke := kind_at(x1 + CELL * 0.5, z0 + CELL * 0.5)
				if (k == 0) != (ke == 0):
					var want := Vector3.LEFT if ke != 0 else Vector3.RIGHT
					surfaces.quad(Vector3(x1, ground_h(x1, z0), z0), Vector3(x1, ground_h(x1, z0) + KERB, z0),
						Vector3(x1, ground_h(x1, z1) + KERB, z1), Vector3(x1, ground_h(x1, z1), z1), PATH.darkened(0.2), want)
			if iz + 1 < n:
				var ks := kind_at(x0 + CELL * 0.5, z1 + CELL * 0.5)
				if (k == 0) != (ks == 0):
					var want := Vector3.FORWARD if ks != 0 else Vector3.BACK
					surfaces.quad(Vector3(x0, ground_h(x0, z1), z1), Vector3(x0, ground_h(x0, z1) + KERB, z1),
						Vector3(x1, ground_h(x1, z1) + KERB, z1), Vector3(x1, ground_h(x1, z1), z1), PATH.darkened(0.2), want)
	# buildings: 3 by 3 per quadrant
	var pitch := (half - PATH_OUT - 3.0) / 3.0
	var bays := 0
	for qx in [-1.0, 1.0]:
		for qz in [-1.0, 1.0]:
			for i in 3:
				for j in 3:
					var cx: float = qx * (PATH_OUT + 3.0 + pitch * (i + 0.5))
					var cz: float = qz * (PATH_OUT + 3.0 + pitch * (j + 0.5))
					var w := rng.randf_range(20.0, 30.0)
					var d := rng.randf_range(20.0, 30.0)
					var floors := rng.randi_range(3, 7)
					bays += _building(cx, cz, w, d, floors, rng)
	_samples(rng)
	stats = {
		"sizeM": SIZE, "gridM": CELL, "surfaceTriangles": surfaces.triangles(), "detailTriangles": detail.triangles(),
		"buildings": shells.size(), "facadeBays": bays, "dataBuildMs": Time.get_ticks_msec() - t0,
	}


func _building(cx: float, cz: float, w: float, d: float, floors: int, rng: RandomNumberGenerator) -> int:
	var base := 1e9
	for sx in [-0.5, 0.5]:
		for sz in [-0.5, 0.5]:
			base = minf(base, ground_h(cx + sx * w, cz + sz * d))
	base -= 0.3
	var h := floors * 3.2 + 0.8
	var wall := Color.from_hsv(rng.randf_range(0.05, 0.12), rng.randf_range(0.15, 0.4), rng.randf_range(0.6, 0.85))
	var lo := Vector3(cx - w * 0.5, base, cz - d * 0.5)
	var hi := Vector3(cx + w * 0.5, base + h, cz + d * 0.5)
	detail.box(lo, hi, wall)
	shells.append([(lo + hi) * 0.5, hi - lo])
	var frame := wall.darkened(0.35)
	var bays := 0
	# facades: bays every 3.5 m on each floor, with a window frame (4 bars), a sill, and a balcony on some
	for side in 4:
		var along := w if side < 2 else d
		var count := int((along - 2.0) / 3.5)
		for f in floors:
			var y := base + 1.6 + f * 3.2
			for k in count:
				var a := -along * 0.5 + 1.0 + 1.75 + k * 3.5
				bays += 1
				_bay(side, cx, cz, w, d, a, y, frame, rng.randf() < 0.25 and f > 0)
	return bays


## One facade bay. side: 0 north (-Z), 1 south (+Z), 2 west (-X), 3 east (+X). a: position along the facade.
func _bay(side: int, cx: float, cz: float, w: float, d: float, a: float, y: float, c: Color, balcony: bool) -> void:
	var out := 0.12
	# boxes in facade space: u along the wall, v up, n out of the wall
	var parts: Array = [
		[-0.8, 0.0, 0.8, 0.08, out], [-0.8, 1.32, 0.8, 1.4, out], [-0.8, 0.08, -0.72, 1.32, out], [0.72, 0.08, 0.8, 1.32, out],
		[-0.9, -0.1, 0.9, 0.0, out + 0.08],
	]
	if balcony:
		parts.append([-1.3, -0.5, 1.3, -0.38, 1.1])
		parts.append([-1.3, -0.38, 1.3, 0.5, -1.1])
	for p in parts:
		var n0 := 0.0
		var n1: float = p[4]
		if n1 < 0.0:
			# a railing: a thin wall at the outer edge of the balcony slab
			n0 = -n1 - 0.06
			n1 = -n1
		var u0: float = a + float(p[0])
		var u1: float = a + float(p[2])
		var v0: float = y + float(p[1])
		var v1: float = y + float(p[3])
		var lo: Vector3
		var hi: Vector3
		match side:
			0:
				lo = Vector3(cx + u0, v0, cz - d * 0.5 - n1)
				hi = Vector3(cx + u1, v1, cz - d * 0.5 - n0)
			1:
				lo = Vector3(cx + u0, v0, cz + d * 0.5 + n0)
				hi = Vector3(cx + u1, v1, cz + d * 0.5 + n1)
			2:
				lo = Vector3(cx - w * 0.5 - n1, v0, cz + u0)
				hi = Vector3(cx - w * 0.5 - n0, v1, cz + u1)
			_:
				lo = Vector3(cx + w * 0.5 + n0, v0, cz + u0)
				hi = Vector3(cx + w * 0.5 + n1, v1, cz + u1)
		detail.box(lo, hi, c, true)


func _clear_of_buildings(x: float, z: float, margin: float) -> bool:
	for s in shells:
		var c: Vector3 = s[0]
		var size: Vector3 = s[1]
		if absf(x - c.x) < size.x * 0.5 + margin and absf(z - c.z) < size.z * 0.5 + margin:
			return false
	return true


## 20 points: 6 on the roads, 4 on footpaths, 4 right beside a kerb face (2 cm either side), 6 on plots.
func _samples(rng: RandomNumberGenerator) -> void:
	var half := SIZE * 0.5 - 2.0
	while samples.size() < 6:
		var along := rng.randf_range(-half, half)
		var across := rng.randf_range(-ROAD_HALF + 0.3, ROAD_HALF - 0.3)
		samples.append(Vector2(across, along) if samples.size() % 2 == 0 else Vector2(along, across))
	while samples.size() < 10:
		var along := rng.randf_range(PATH_OUT + 1.0, half)
		var across := rng.randf_range(ROAD_HALF + 0.3, PATH_OUT - 0.3) * (1.0 if rng.randf() < 0.5 else -1.0)
		samples.append(Vector2(across, along) if samples.size() % 2 == 0 else Vector2(-along, across))
	while samples.size() < 14:
		var along := rng.randf_range(PATH_OUT + 1.0, half)
		var side := 0.02 if samples.size() % 2 == 0 else -0.02
		samples.append(Vector2(ROAD_HALF + side, along) if samples.size() < 12 else Vector2(-along, -ROAD_HALF - side))
	while samples.size() < 20:
		var x := rng.randf_range(-half, half)
		var z := rng.randf_range(-half, half)
		if kind_at(x, z) == 2 and _clear_of_buildings(x, z, 2.0):
			samples.append(Vector2(x, z))
