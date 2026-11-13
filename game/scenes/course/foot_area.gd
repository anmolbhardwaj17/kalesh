## The on-foot test area of the course scene (P1-022), west of the straight: a lane of 10 kerb slabs (0.15 m), a
## 12 step stair (0.18 m risers, 0.3 m treads) up to a landing and a 1 in 8 ramp back down; a vault lane with a 1.2 m
## wall, a 1.0 m railing and a 1.3 m wall; and a camera yard: a lane 2 m wide between 3 m walls opening into a walled
## court with a corner, a pillar and a 1.0 m wall. The kerbs, stairs and ramp are one mesh and one collider from the
## same vertices; every wall is its own StaticBody3D with its mesh as a child, so the on-foot camera can fade it.
## Coordinates: east +X, north -Z, up +Y, metres. Distances s run north from Z0 (z = Z0 - s).
extends RefCounted

const Geo := preload("res://bench/physics/geo.gd")

const Z0 := -100.0
## Kerb and stair lane: x KX0..KX1.
const KX0 := -262.0
const KX1 := -258.0
const KERB := 0.15
const SLABS := 10
const SLAB_S0 := 10.0
const SLAB_LEN := 1.5
const SLAB_GAP := 1.5
const STAIRS_S := 46.0
const STEPS := 12
const RISER := 0.18
const TREAD := 0.3
const LANDING := 3.0
const RAMP_SLOPE := 8.0
const LANE_END_S := 75.0
## Vault lane: x VX0..VX1; walls [s, height, thickness].
const VX0 := -248.0
const VX1 := -244.0
const VAULT_WALLS := [[10.0, 1.2, 0.3], [34.0, 1.3, 0.3]]
const RAIL_S := 22.0
const RAIL_H := 1.0
## Camera yard: the lane interior x YX0..YX1 from z YZ0 north to YZ1; the court from YZ1 north to YZ2, x CX0..CX1.
const YX0 := -273.0
const YX1 := -271.0
const YZ0 := -202.0
const YZ1 := -216.0
const YZ2 := -232.0
const CX0 := -282.0
const CX1 := -262.0
const WALL_H := 3.0
const WALL_T := 0.3

const PATH := Color(0.62, 0.6, 0.56)
const CONCRETE := Color(0.52, 0.52, 0.54)
const BRICK := Color(0.72, 0.5, 0.4)
const PLASTER := Color(0.82, 0.74, 0.6)
const RAIL := Color(0.25, 0.3, 0.33)

var geo := Geo.new()


static func z_at(s: float) -> float:
	return Z0 - s


static func stairs_top() -> float:
	return RISER * STEPS


static func landing_end_s() -> float:
	return STAIRS_S + TREAD * STEPS + LANDING


static func ramp_end_s() -> float:
	return landing_end_s() + stairs_top() * RAMP_SLOPE


## The wall boxes of the camera yard as [lo, hi].
static func yard_walls() -> Array:
	return [
		[Vector3(YX0 - WALL_T, 0, YZ1), Vector3(YX0, WALL_H, YZ0)],
		[Vector3(YX1, 0, YZ1), Vector3(YX1 + WALL_T, WALL_H, YZ0)],
		[Vector3(CX0 - WALL_T, 0, YZ2 - WALL_T), Vector3(CX1, WALL_H, YZ2)],
		[Vector3(CX0 - WALL_T, 0, YZ2), Vector3(CX0, WALL_H, YZ1)],
		[Vector3(-276.3, 0, -224.3), Vector3(-275.7, WALL_H, -223.7)],
		[Vector3(-268.0, 0, -222.0), Vector3(-264.0, 1.0, -221.7)],
	]


func build(world: Node3D) -> void:
	var root := Node3D.new()
	root.name = "FootArea"
	world.add_child(root)
	_lane()
	var mi := MeshInstance3D.new()
	mi.name = "FootLaneMesh"
	mi.mesh = geo.mesh()
	mi.material_override = Geo.material()
	root.add_child(mi)
	var body := StaticBody3D.new()
	body.name = "FootLane"
	var cs := CollisionShape3D.new()
	cs.shape = geo.shape()
	body.add_child(cs)
	root.add_child(body)
	var k := 0
	for w in VAULT_WALLS:
		var s: float = w[0]
		var lo := Vector3(VX0, 0, z_at(s + float(w[2])))
		var hi := Vector3(VX1, float(w[1]), z_at(s))
		_wall(root, "VaultWall%d" % k, [[lo, hi]], BRICK)
		k += 1
	_wall(root, "Railing", _rail_parts(), RAIL)
	var shades := [PLASTER, PLASTER.darkened(0.06), BRICK, BRICK.lightened(0.05), CONCRETE, PLASTER.darkened(0.12)]
	k = 0
	for w in yard_walls():
		_wall(root, "YardWall%d" % k, [w], shades[k % shades.size()])
		k += 1


func _lane() -> void:
	for i in SLABS:
		var s0 := SLAB_S0 + (SLAB_LEN + SLAB_GAP) * i
		geo.box(Vector3(KX0, 0, z_at(s0 + SLAB_LEN)), Vector3(KX1, KERB, z_at(s0)), PATH)
	for i in STEPS:
		var s0 := STAIRS_S + TREAD * i
		geo.box(Vector3(KX0, 0, z_at(s0 + TREAD)), Vector3(KX1, RISER * (i + 1), z_at(s0)), CONCRETE.lightened(0.05 * (i % 2)))
	var top := stairs_top()
	var s_land := STAIRS_S + TREAD * STEPS
	geo.box(Vector3(KX0, 0, z_at(landing_end_s())), Vector3(KX1, top, z_at(s_land)), PATH)
	geo.ramp(KX0, KX1, z_at(landing_end_s()), top, z_at(ramp_end_s()), 0.0, 0.0, CONCRETE)


## A railing across the vault lane: a top rail, a mid rail and posts, each its own box (the collider matches what is
## drawn; there is no invisible board between the posts).
func _rail_parts() -> Array:
	var z1 := z_at(RAIL_S)
	var z0 := z1 - 0.06
	var parts := [
		[Vector3(VX0, RAIL_H - 0.06, z0), Vector3(VX1, RAIL_H, z1)],
		[Vector3(VX0, 0.44, z0), Vector3(VX1, 0.5, z1)],
	]
	var x := VX0
	while x <= VX1 - 0.06 + 0.001:
		parts.append([Vector3(x, 0, z0), Vector3(x + 0.06, RAIL_H - 0.06, z1)])
		x += 0.494
	return parts


func _wall(root: Node3D, nm: String, boxes: Array, color: Color) -> void:
	var g := Geo.new()
	var body := StaticBody3D.new()
	body.name = nm
	for b in boxes:
		var lo: Vector3 = b[0]
		var hi: Vector3 = b[1]
		g.box(lo, hi, color)
		var cs := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = hi - lo
		cs.shape = box
		cs.position = (lo + hi) * 0.5
		body.add_child(cs)
	var mi := MeshInstance3D.new()
	mi.name = "Mesh"
	mi.mesh = g.mesh()
	mi.material_override = Geo.material()
	body.add_child(mi)
	root.add_child(body)
