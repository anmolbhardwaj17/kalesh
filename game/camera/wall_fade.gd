## Fades walls that stand between a camera and the player (GAME.md "Movement and camera feel": walls between the camera
## and the player fade). Each frame on_foot_camera.gd casts rays from the camera to points on the body; every collider
## hit names the meshes it fades: its MeshInstance3D children, or the nodes in its `fade_meshes` metadata (an Array of
## NodePaths from the collider). Faded meshes ease to FADED transparency and back when nothing hides the player.
extends RefCounted

const FADED := 0.72
const RATE := 6.0

## Mesh instance id -> GeometryInstance3D being faded in or out.
var meshes := {}
## Instance ids of the meshes wanted faded this frame.
var _want := {}
var _ray := PhysicsRayQueryParameters3D.new()


func _init() -> void:
	_ray.collision_mask = 1


## Rays from `from` to each of `points`; every hit collider's meshes are faded. Answers how many rays were blocked.
func update(space: PhysicsDirectSpaceState3D, from: Vector3, points: Array, dt: float) -> int:
	_want.clear()
	var blocked := 0
	for p in points:
		var target: Vector3 = p
		_ray.from = from
		_ray.to = target
		# a ray can pass several walls: step through them, at most 3
		for k in 3:
			var hit := space.intersect_ray(_ray)
			if hit.is_empty():
				break
			if k == 0:
				blocked += 1
			var col := hit.collider as Node
			for m in fade_targets(col):
				_want[m.get_instance_id()] = m
			_ray.from = Vector3(hit.position) + (target - from).normalized() * 0.02
	for id in _want:
		meshes[id] = _want[id]
	var k := 1.0 - exp(-RATE * dt)
	for id in meshes.keys():
		var g := meshes[id] as GeometryInstance3D
		if not is_instance_valid(g):
			meshes.erase(id)
			continue
		var goal := FADED if _want.has(id) else 0.0
		g.transparency = lerpf(g.transparency, goal, k)
		if goal == 0.0 and g.transparency < 0.01:
			g.transparency = 0.0
			meshes.erase(id)
	return blocked


## The meshes a collider fades.
static func fade_targets(col: Node) -> Array:
	var out := []
	if col == null:
		return out
	if col.has_meta("fade_meshes"):
		for path in col.get_meta("fade_meshes"):
			var n := col.get_node_or_null(path)
			if n is GeometryInstance3D:
				out.append(n)
		return out
	for c in col.get_children():
		if c is GeometryInstance3D:
			out.append(c)
	return out


## True when the collider is faded enough to see through (the probes count a ray blocked only by faded walls as seen).
func is_faded(col: Node) -> bool:
	var t := fade_targets(col)
	if t.is_empty():
		return false
	for m in t:
		if (m as GeometryInstance3D).transparency < 0.5:
			return false
	return true


func clear() -> void:
	for id in meshes:
		var g := meshes[id] as GeometryInstance3D
		if is_instance_valid(g):
			g.transparency = 0.0
	meshes.clear()
