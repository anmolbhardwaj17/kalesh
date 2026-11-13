## The vehicle test course (P1-020, scene id `course`): the physics bench's course (game/bench/physics/course.gd: a
## 2.4 km straight, kerb slabs of 0.15 m, a junction, a flyover with deck joints and parapets, an on-foot course) plus
## a wall across the flyover lane at the south end of the pad, for the chase camera's reverse-into-a-wall check. The feel probes
## (debug hook `vehicle`, game/debug/vehicle_probe.gd) run here. Coordinates: east +X, north -Z, up +Y, metres.
extends Node3D

const Course := preload("res://bench/physics/course.gd")
const Geo := preload("res://bench/physics/geo.gd")

## The wall: its two corners, across the flyover lane at the south end of the pad (the flyover probe starts in front of
## it, so its run-up stays clear).
const WALL_LO := Vector3(93.0, 0.0, 145.0)
const WALL_HI := Vector3(107.0, 3.0, 146.0)
## Where the camera run starts: on the flyover lane facing north, the rear 12.6 m short of the wall.
const CAM_START := Vector3(100.0, 0.0, 130.0)

var course := Course.new()


func _ready() -> void:
	var world := get_node("World") as Node3D
	var geo_node := Node3D.new()
	geo_node.name = "Course"
	world.add_child(geo_node)
	world.move_child(geo_node, 0)
	course.build(geo_node)
	_wall(world)


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


## Height of the course surface under x, z (NAN off the course): what the probes stand a vehicle on.
func ground_y(x: float, z: float, from_y: float = 20.0) -> float:
	var q := PhysicsRayQueryParameters3D.create(Vector3(x, from_y, z), Vector3(x, -5.0, z), 1)
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	return NAN if hit.is_empty() else float(hit.position.y)
