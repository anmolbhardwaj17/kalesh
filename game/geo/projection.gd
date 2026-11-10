## Geographic projection: latitude and longitude (WGS84 degrees) to world metres and back, around one named origin.
## Port of src/geo/projection.ts, which stays as the reference for the offline bake tooling. Checked against
## harness/data/fixtures/projection_points.json (generated from the TypeScript code) in game/tests/test_projection.gd.
##
## World axes (TECH.md "Coordinates"): east +X, north -Z, up +Y, 1 unit = 1 metre. A point north of the origin has a
## negative z, a point east has a positive x. No mirroring and no axis flips.
##
## Method: transverse Mercator on the WGS84 ellipsoid (Kruger series, 3rd order), central meridian through the origin,
## scale 1 on that meridian, origin northing subtracted so the origin maps to (0, 0).
##
## Precision: GDScript floats are 64 bit, but Vector2 and Vector3 are 32 bit in the standard Godot build (about 0.4 mm
## at 25 km). geo_to_world returns plain floats in a Dictionary; use geo_to_world_v3 only to place nodes.
extends RefCounted

## India Gate, the world origin.
const ORIGIN_LAT := 28.612894
const ORIGIN_LON := 77.229446

const A := 6378137.0 # WGS84 semi-major axis, m
const F := 1.0 / 298.257223563 # WGS84 flattening
const N := F / (2.0 - F) # third flattening
const N2 := N * N
const N3 := N2 * N
const RECT := (A / (1.0 + N)) * (1.0 + N2 / 4.0 + (N2 * N2) / 64.0) # rectifying radius
const ALPHA := [N / 2.0 - (2.0 * N2) / 3.0 + (5.0 * N3) / 16.0, (13.0 * N2) / 48.0 - (3.0 * N3) / 5.0, (61.0 * N3) / 240.0]
const BETA := [N / 2.0 - (2.0 * N2) / 3.0 + (37.0 * N3) / 96.0, N2 / 48.0 + N3 / 15.0, (17.0 * N3) / 480.0]
const DELTA := [2.0 * N - (2.0 * N2) / 3.0 - 2.0 * N3, (7.0 * N2) / 3.0 - (8.0 * N3) / 5.0, (56.0 * N3) / 15.0]
const RAD := PI / 180.0

static var _k: float = (2.0 * sqrt(N)) / (1.0 + N)
static var _northing_at_origin: float = _tm_forward(ORIGIN_LAT, ORIGIN_LON, ORIGIN_LON)[1]


## Transverse Mercator [easting, northing] in metres from the central meridian lon0, northing 0 at the equator.
static func _tm_forward(lat: float, lon: float, lon0: float) -> PackedFloat64Array:
	var phi := lat * RAD
	var dl := (lon - lon0) * RAD
	var sp := sin(phi)
	var tau := sinh(atanh(sp) - _k * atanh(_k * sp))
	var xi0 := atan2(tau, cos(dl))
	var eta0 := atanh(sin(dl) / sqrt(1.0 + tau * tau))
	var xi := xi0
	var eta := eta0
	for j in range(1, 4):
		var a: float = ALPHA[j - 1]
		xi += a * sin(2 * j * xi0) * cosh(2 * j * eta0)
		eta += a * cos(2 * j * xi0) * sinh(2 * j * eta0)
	return PackedFloat64Array([RECT * eta, RECT * xi])


## [lat, lon] in degrees from transverse Mercator easting and northing.
static func _tm_inverse(e: float, n: float, lon0: float) -> PackedFloat64Array:
	var xi := n / RECT
	var eta := e / RECT
	var xi0 := xi
	var eta0 := eta
	for j in range(1, 4):
		var b: float = BETA[j - 1]
		xi0 -= b * sin(2 * j * xi) * cosh(2 * j * eta)
		eta0 -= b * cos(2 * j * xi) * sinh(2 * j * eta)
	var chi := asin(sin(xi0) / cosh(eta0))
	var phi := chi
	for j in range(1, 4):
		var d: float = DELTA[j - 1]
		phi += d * sin(2 * j * chi)
	var dl := atan2(sinh(eta0), cos(xi0))
	return PackedFloat64Array([phi / RAD, lon0 + dl / RAD])


## Latitude and longitude to world metres: {"x": metres east, "z": metres south (north is -Z)}.
static func geo_to_world(lat: float, lon: float) -> Dictionary:
	var en := _tm_forward(lat, lon, ORIGIN_LON)
	return {"x": en[0], "z": -(en[1] - _northing_at_origin)}


## World metres back to latitude and longitude: {"lat": degrees north, "lon": degrees east}.
static func world_to_geo(x: float, z: float) -> Dictionary:
	var ll := _tm_inverse(x, _northing_at_origin - z, ORIGIN_LON)
	return {"lat": ll[0], "lon": ll[1]}


## A world position for placing a node (32 bit floats: fine for placement, not for further maths).
static func geo_to_world_v3(lat: float, lon: float, y: float = 0.0) -> Vector3:
	var p := geo_to_world(lat, lon)
	return Vector3(p.x, y, p.z)
