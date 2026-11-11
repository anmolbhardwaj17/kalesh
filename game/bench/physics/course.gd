## Test course of the physics bench (P0-017): a flat pad with a 2.4 km straight, kerb slabs (0.15 m), a junction
## with four footpath corners, a flyover (6 percent ramps, a deck with joints, parapets) and an on-foot course (kerb,
## stairs with 0.18 m risers, a landing, a 1 in 6 ramp). Coordinates are local to the course node: east +X, north -Z,
## up +Y, vehicles drive north. The collider is one triangle mesh made from the drawn vertices (collider option K3).
extends RefCounted

const Geo := preload("res://bench/physics/geo.gd")

const KERB := 0.15
const RISER := 0.18
const TREAD := 0.3
const STEPS := 10
## Square kerb slab across a lane: x 30 to 50, z -70 to -60.
const SLAB_SQUARE := [30.0, 50.0, -70.0, -60.0]
## Slab whose west edge runs along a lane (one side of the car climbs it): x 60.2 to 70, z -90 to -60.
const SLAB_SIDE := [60.2, 70.0, -90.0, -60.0]
const FLYOVER_X := 100.0
const FLYOVER_HALF := 5.0
const FLYOVER_H := 6.0
const RAMP_START := -50.0
const RAMP_LEN := 100.0
const DECK_SEG := 20.0
const DECK_SEGS := 6
## One open gap between two deck segments (the fourth joint), the other joints are 1.5 cm lips.
const JOINT_GAP := 0.04
const JOINT_LIP := 0.015
const JUNCTION := Vector2(200.0, -200.0)
const ROAD_HALF := 5.0
## On-foot course: x from FOOT_X0 to FOOT_X1; distances s run north from z = 0 (s = -z).
const FOOT_X0 := -200.0
const FOOT_X1 := -170.0
const FOOT_KERB_S := 25.0
const FOOT_STAIRS_S := 29.0
const FOOT_LANDING := 3.0
const FOOT_RAMP_RUN := 10.8

const ASPHALT := Color(0.26, 0.26, 0.28)
const PATH := Color(0.62, 0.6, 0.56)
const CONCRETE := Color(0.5, 0.5, 0.52)
const PAINT := Color(0.9, 0.88, 0.8)

var geo := Geo.new()
var marks := Geo.new()
var body: StaticBody3D
var stats := {}


func build(parent: Node3D) -> void:
	_pad()
	_kerbs()
	_flyover()
	_junction()
	_foot_course()
	var mi := MeshInstance3D.new()
	mi.name = "CourseMesh"
	mi.mesh = geo.mesh()
	mi.material_override = Geo.material()
	parent.add_child(mi)
	var mm := MeshInstance3D.new()
	mm.name = "CourseMarks"
	mm.mesh = marks.mesh()
	mm.material_override = Geo.material()
	mm.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mm)
	body = StaticBody3D.new()
	body.name = "CourseCollider"
	body.collision_layer = 1
	body.collision_mask = 0
	var cs := CollisionShape3D.new()
	cs.shape = geo.shape()
	body.add_child(cs)
	parent.add_child(body)
	stats = {"triangles": geo.triangles(), "collider": "one ConcavePolygonShape3D from the drawn vertices"}


func _pad() -> void:
	# 50 m cells, so no triangle is huge
	var x := -300.0
	while x < 500.0:
		var z := -2400.0
		while z < 150.0:
			var shade := ASPHALT if (int(x / 50.0) + int(z / 50.0)) % 2 == 0 else ASPHALT.lightened(0.04)
			geo.quad(Vector3(x, 0, z), Vector3(x + 50, 0, z), Vector3(x + 50, 0, z + 50), Vector3(x, 0, z + 50), shade, Vector3.UP)
			z += 50.0
		x += 50.0
	# paint only (not in the collider): a dashed centre line on the straight and distance bars every 100 m
	var z := 100.0
	while z > -2380.0:
		marks.quad(Vector3(-3.6, 0.01, z - 3), Vector3(-3.45, 0.01, z - 3), Vector3(-3.45, 0.01, z), Vector3(-3.6, 0.01, z), PAINT, Vector3.UP)
		marks.quad(Vector3(3.45, 0.01, z - 3), Vector3(3.6, 0.01, z - 3), Vector3(3.6, 0.01, z), Vector3(3.45, 0.01, z), PAINT, Vector3.UP)
		z -= 9.0
	for k in 24:
		var zz := -100.0 * k
		marks.quad(Vector3(-3.6, 0.01, zz - 0.3), Vector3(3.6, 0.01, zz - 0.3), Vector3(3.6, 0.01, zz), Vector3(-3.6, 0.01, zz), PAINT, Vector3.UP)


func _kerbs() -> void:
	for s in [SLAB_SQUARE, SLAB_SIDE]:
		geo.box(Vector3(s[0], 0, s[2]), Vector3(s[1], KERB, s[3]), PATH)


func _flyover() -> void:
	var x0 := FLYOVER_X - FLYOVER_HALF
	var x1 := FLYOVER_X + FLYOVER_HALF
	var z_up := RAMP_START - RAMP_LEN
	geo.ramp(x0, x1, RAMP_START, 0.0, z_up, FLYOVER_H, 0.0, CONCRETE)
	var z := z_up
	for i in DECK_SEGS:
		var lip := JOINT_LIP if i % 2 == 1 else 0.0
		var gap := JOINT_GAP if i == 3 else 0.0
		geo.box(Vector3(x0, FLYOVER_H - 0.8, z - DECK_SEG), Vector3(x1, FLYOVER_H + lip, z - gap), CONCRETE.lightened(0.06 * (i % 2)), true)
		z -= DECK_SEG
	geo.ramp(x0, x1, z, FLYOVER_H, z - RAMP_LEN, 0.0, 0.0, CONCRETE)
	# parapets along both edges, following the ramps and the deck (railings from the deck edge)
	for x in [x0 - 0.3, x1]:
		var want := Vector3.RIGHT
		_parapet(x, RAMP_START, 0.0, z_up, FLYOVER_H, want)
		_parapet(x, z_up, FLYOVER_H + JOINT_LIP, z, FLYOVER_H + JOINT_LIP, want)
		_parapet(x, z, FLYOVER_H, z - RAMP_LEN, 0.0, want)
	# pillars under the deck
	for i in DECK_SEGS + 1:
		var pz := z_up - DECK_SEG * i
		geo.box(Vector3(FLYOVER_X - 0.8, 0, pz - 0.8), Vector3(FLYOVER_X + 0.8, FLYOVER_H - 0.8, pz + 0.8), CONCRETE.darkened(0.1))


func _parapet(x: float, z0: float, y0: float, z1: float, y1: float, _want: Vector3) -> void:
	var c := Color(0.72, 0.7, 0.66)
	var w := 0.3
	var h := 0.8
	geo.quad(Vector3(x, y0 + h, z0), Vector3(x + w, y0 + h, z0), Vector3(x + w, y1 + h, z1), Vector3(x, y1 + h, z1), c, Vector3.UP)
	geo.quad(Vector3(x, y0, z0), Vector3(x, y0 + h, z0), Vector3(x, y1 + h, z1), Vector3(x, y1, z1), c.darkened(0.15), Vector3.LEFT)
	geo.quad(Vector3(x + w, y0, z0), Vector3(x + w, y0 + h, z0), Vector3(x + w, y1 + h, z1), Vector3(x + w, y1, z1), c.darkened(0.15), Vector3.RIGHT)


func _junction() -> void:
	var size := 30.0
	for sx in [-1.0, 1.0]:
		for sz in [-1.0, 1.0]:
			var ax: float = JUNCTION.x + sx * ROAD_HALF
			var az: float = JUNCTION.y + sz * ROAD_HALF
			var lo := Vector3(minf(ax, ax + sx * size), 0, minf(az, az + sz * size))
			var hi := Vector3(maxf(ax, ax + sx * size), KERB, maxf(az, az + sz * size))
			geo.box(lo, hi, PATH)
	# lane paint through the junction arms
	for k in 8:
		var o := ROAD_HALF + 2.0 + k * 4.0
		for s in [-1.0, 1.0]:
			marks.quad(Vector3(JUNCTION.x - 0.07, 0.01, JUNCTION.y + s * o), Vector3(JUNCTION.x + 0.07, 0.01, JUNCTION.y + s * o), Vector3(JUNCTION.x + 0.07, 0.01, JUNCTION.y + s * (o + 2.0)), Vector3(JUNCTION.x - 0.07, 0.01, JUNCTION.y + s * (o + 2.0)), PAINT, Vector3.UP)
			marks.quad(Vector3(JUNCTION.x + s * o, 0.01, JUNCTION.y - 0.07), Vector3(JUNCTION.x + s * o, 0.01, JUNCTION.y + 0.07), Vector3(JUNCTION.x + s * (o + 2.0), 0.01, JUNCTION.y + 0.07), Vector3(JUNCTION.x + s * (o + 2.0), 0.01, JUNCTION.y - 0.07), PAINT, Vector3.UP)


func _foot_course() -> void:
	var x0 := FOOT_X0
	var x1 := FOOT_X1
	# footpath slab from the kerb to the stairs
	geo.box(Vector3(x0, 0, -FOOT_STAIRS_S), Vector3(x1, KERB, -FOOT_KERB_S), PATH)
	for k in STEPS:
		var s0 := FOOT_STAIRS_S + TREAD * k
		var top := KERB + RISER * (k + 1)
		geo.box(Vector3(x0, 0, -(s0 + TREAD)), Vector3(x1, top, -s0), CONCRETE.lightened(0.05 * (k % 2)))
	var top_y := foot_top_y()
	var s_land := FOOT_STAIRS_S + TREAD * STEPS
	geo.box(Vector3(x0, 0, -(s_land + FOOT_LANDING)), Vector3(x1, top_y, -s_land), PATH)
	var s_ramp := s_land + FOOT_LANDING
	geo.ramp(x0, x1, -s_ramp, top_y, -(s_ramp + FOOT_RAMP_RUN), KERB, 0.0, CONCRETE)
	var s_slab := s_ramp + FOOT_RAMP_RUN
	geo.box(Vector3(x0, 0, -foot_end_s()), Vector3(x1, KERB, -s_slab), PATH)


static func foot_top_y() -> float:
	return KERB + RISER * STEPS


## Where the far kerb of the on-foot course drops back to the road.
static func foot_end_s() -> float:
	return FOOT_STAIRS_S + TREAD * STEPS + FOOT_LANDING + FOOT_RAMP_RUN + 3.2
