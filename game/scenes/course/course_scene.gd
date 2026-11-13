## The vehicle test course (P1-020, scene id `course`): the physics bench's course (game/bench/physics/course.gd: a
## 2.4 km straight, kerb slabs of 0.15 m, a junction, a flyover with deck joints and parapets, an on-foot course) plus
## a wall across the flyover lane at the south end of the pad, for the chase camera's reverse-into-a-wall check, and a
## gali (P1-021): a lane 3 m wide running north that turns right (east) into another lane 3 m wide, between walls 2.5 m
## high, for the auto's corner. The feel probes (debug hook `vehicle`, game/debug/vehicle_probe.gd) run here.
## P1-022: the on-foot test area (foot_area.gd: kerbs, stairs, ramp, vault walls, a camera yard with a 2 m lane) and
## the player: PlayerMode (game/characters/player_mode.gd) starts in the car and makes the character and the on-foot
## camera; F gets out and back in. The on-foot probes (debug hook `foot`, game/debug/foot_probe.gd) run here.
## Coordinates: east +X, north -Z, up +Y, metres.
extends Node3D

const Course := preload("res://bench/physics/course.gd")
const Geo := preload("res://bench/physics/geo.gd")
const FootArea := preload("res://scenes/course/foot_area.gd")
const PlayerMode := preload("res://characters/player_mode.gd")

## The wall: its two corners, across the flyover lane at the south end of the pad (the flyover probe starts in front of
## it, so its run-up stays clear).
const WALL_LO := Vector3(93.0, 0.0, 145.0)
const WALL_HI := Vector3(107.0, 3.0, 146.0)
## Where the camera run starts: on the flyover lane facing north, the rear 12.6 m short of the wall.
const CAM_START := Vector3(100.0, 0.0, 130.0)

## The gali: the north lane is x GALI_X..GALI_X + GALI_W from GALI_Z0 north to the corner, the east lane z
## GALI_CORNER_Z - GALI_W..GALI_CORNER_Z from GALI_X east to GALI_X1. The inner corner is (GALI_X + GALI_W, GALI_CORNER_Z).
const GALI_X := 300.0
const GALI_W := 3.0
const GALI_Z0 := -80.0
const GALI_CORNER_Z := -130.0
const GALI_X1 := 345.0
const GALI_H := 2.5
const GALI_T := 0.3

var course := Course.new()


func _ready() -> void:
	var world := get_node("World") as Node3D
	var geo_node := Node3D.new()
	geo_node.name = "Course"
	world.add_child(geo_node)
	world.move_child(geo_node, 0)
	course.build(geo_node)
	_wall(world)
	_gali(world)
	FootArea.new().build(world)
	var pm := PlayerMode.new()
	pm.name = "PlayerMode"
	add_child(pm)
	pm.setup(world, world.get_node("Car") as Node3D, get_node("ChaseCamera") as Camera3D, self)


func _wall(world: Node3D) -> void:
	var g := Geo.new()
	g.box(WALL_LO, WALL_HI, Color(0.66, 0.6, 0.52))
	var mi := MeshInstance3D.new()
	mi.name = "WallMesh"
	mi.mesh = g.mesh()
	mi.material_override = Geo.material()
	world.add_child(mi)
	var body := StaticBody3D.new()
	body.name = "Wall"
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = WALL_HI - WALL_LO
	cs.shape = box
	cs.position = (WALL_LO + WALL_HI) * 0.5
	body.add_child(cs)
	world.add_child(body)


## The gali's walls as [lo, hi] corners (world, axis aligned): west and north outside walls, the inner east wall of the
## north lane and the inner south wall of the east lane (they meet at the inner corner).
static func gali_walls() -> Array:
	var x0 := GALI_X
	var x_in := GALI_X + GALI_W
	var z_out := GALI_CORNER_Z - GALI_W
	return [
		[Vector3(x0 - GALI_T, 0, z_out - GALI_T), Vector3(x0, GALI_H, GALI_Z0)],
		[Vector3(x0, 0, z_out - GALI_T), Vector3(GALI_X1, GALI_H, z_out)],
		[Vector3(x_in, 0, GALI_CORNER_Z), Vector3(x_in + GALI_T, GALI_H, GALI_Z0)],
		[Vector3(x_in + GALI_T, 0, GALI_CORNER_Z), Vector3(GALI_X1, GALI_H, GALI_CORNER_Z + GALI_T)],
	]


func _gali(world: Node3D) -> void:
	var g := Geo.new()
	var body := StaticBody3D.new()
	body.name = "Gali"
	var shades := [Color(0.78, 0.64, 0.5), Color(0.72, 0.58, 0.46), Color(0.8, 0.7, 0.56), Color(0.74, 0.62, 0.5)]
	var k := 0
	for w in gali_walls():
		var lo: Vector3 = w[0]
		var hi: Vector3 = w[1]
		g.box(lo, hi, shades[k % shades.size()])
		k += 1
		var cs := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = hi - lo
		cs.shape = box
		cs.position = (lo + hi) * 0.5
		body.add_child(cs)
	var mi := MeshInstance3D.new()
	mi.name = "GaliMesh"
	mi.mesh = g.mesh()
	mi.material_override = Geo.material()
	world.add_child(mi)
	world.add_child(body)


## Height of the course surface under x, z (NAN off the course): what the probes stand a vehicle on.
func ground_y(x: float, z: float, from_y: float = 20.0) -> float:
	var q := PhysicsRayQueryParameters3D.create(Vector3(x, from_y, z), Vector3(x, -5.0, z), 1)
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	return NAN if hit.is_empty() else float(hit.position.y)
