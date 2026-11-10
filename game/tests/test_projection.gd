## Projection port (game/geo/projection.gd) against the TypeScript reference: landmarks, axes, round trips and the
## 20 point fixture generated from src/geo/projection.ts (harness/data/fixtures/projection_points.json).
extends RefCounted

const Geo := preload("res://geo/projection.gd")
const FIXTURE := "res://../harness/data/fixtures/projection_points.json"

var t
var tree: SceneTree


func test_origin_maps_to_zero() -> void:
	var p := Geo.geo_to_world(Geo.ORIGIN_LAT, Geo.ORIGIN_LON)
	t.near(p.x, 0.0, 1e-6, "origin x")
	t.near(p.z, 0.0, 1e-6, "origin z")


func test_connaught_place() -> void:
	var p := Geo.geo_to_world(28.6315, 77.2167)
	t.near(p.x, -1246.0, 25.0, "Connaught Place x")
	t.near(p.z, -2071.0, 25.0, "Connaught Place z")
	t.ok(p.x < 0.0, "Connaught Place is west (-X)")
	t.ok(p.z < 0.0, "Connaught Place is north (-Z)")


func test_red_fort() -> void:
	var p := Geo.geo_to_world(28.6562, 77.241)
	t.near(p.x, 1129.0, 25.0, "Red Fort x")
	t.near(p.z, -4821.0, 25.0, "Red Fort z")
	t.ok(p.x > 0.0, "Red Fort is east (+X)")
	t.ok(p.z < 0.0, "Red Fort is north (-Z)")


func test_due_north_has_x_zero_and_negative_z() -> void:
	var p := Geo.geo_to_world(Geo.ORIGIN_LAT + 0.05, Geo.ORIGIN_LON)
	t.near(p.x, 0.0, 1e-6, "due north x")
	t.ok(p.z < 0.0, "due north z is negative")
	t.ok(Geo.geo_to_world(Geo.ORIGIN_LAT - 0.05, Geo.ORIGIN_LON).z > 0.0, "due south z is positive")
	t.ok(Geo.geo_to_world(Geo.ORIGIN_LAT, Geo.ORIGIN_LON + 0.05).x > 0.0, "due east x is positive")
	t.ok(Geo.geo_to_world(Geo.ORIGIN_LAT, Geo.ORIGIN_LON - 0.05).x < 0.0, "due west x is negative")


func test_round_trip_under_1cm() -> void:
	var worst := 0.0
	for xi in range(-5, 6):
		for zi in range(-5, 6):
			var x := xi * 5000.0
			var z := zi * 5000.0
			var g := Geo.world_to_geo(x, z)
			var p := Geo.geo_to_world(g.lat, g.lon)
			worst = maxf(worst, Vector2(p.x - x, p.z - z).length())
	t.less(worst, 0.01, "worst world to geo to world round trip over a 50 km box, m")
	for ll in [[28.6315, 77.2167], [28.6562, 77.241], [28.4, 77.0], [28.85, 77.45]]:
		var w := Geo.geo_to_world(ll[0], ll[1])
		var g := Geo.world_to_geo(w.x, w.z)
		t.less(absf(g.lat - ll[0]), 1e-7, "geo round trip lat at %s" % [ll])
		t.less(absf(g.lon - ll[1]), 1e-7, "geo round trip lon at %s" % [ll])


func test_matches_typescript_fixture_within_1cm() -> void:
	var text := FileAccess.get_file_as_string(ProjectSettings.globalize_path(FIXTURE))
	var doc = JSON.parse_string(text)
	t.ok(doc is Dictionary, "fixture parses: " + FIXTURE)
	if not (doc is Dictionary):
		return
	var pts: Array = doc.points
	t.ok(pts.size() == 20, "fixture has 20 points (has %d)" % pts.size())
	t.near(doc.origin.lat, Geo.ORIGIN_LAT, 0.0, "fixture origin lat")
	t.near(doc.origin.lon, Geo.ORIGIN_LON, 0.0, "fixture origin lon")
	var worst := 0.0
	for pt in pts:
		var p := Geo.geo_to_world(pt.lat, pt.lon)
		var d := Vector2(p.x - pt.x, p.z - pt.z).length()
		worst = maxf(worst, d)
		t.less(d, 0.01, "GDScript vs TypeScript at %s, m" % pt.name)
	print("    fixture: worst GDScript vs TypeScript difference ", worst, " m over ", pts.size(), " points")
