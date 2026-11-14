## Street lamps of the streamed city (P2-052, owner 2026-11-14: "street lamps on at night with warm pools"; WORLD_LOGIC.md
## 1: every pool has a visible source). A stand-in until the street furniture kit (P2-036) places lamps from the bake:
## galvanised poles on the kerb side of the outermost lane of every car road at grade (Delhi keeps left, so the kerb is
## left of the leftmost lane), one every SPACING metres, with an arm and a sodium head over the carriageway. Placed from
## the lane graph of the loaded tiles (world_stream.gd `lanes`) round the camera, rebuilt when the camera has moved.
## The poles stand at every hour; at night the heads glow, each throws a soft additive pool on the road under it
## (lamp_pool.gdshader, no light cost) and only the LIGHTS nearest the camera are real SpotLights.
## Made by stylised_b.gd decorate_environment; it calls set_night() on every relight. No world stream: nothing is made.
extends Node3D

const POOL_SHADER := preload("res://render/shaders/lamp_pool.gdshader")
## Delhi's street lights are mostly warm LED now with some sodium left: a warm white between the two.
const SODIUM := Color(1.0, 0.76, 0.5)
const SPACING := 30.0
const RADIUS := 220.0
## The camera moves this far before the lamps round it are placed again.
const REBUILD_M := 60.0
## Real lights at the heads nearest the camera.
const LIGHTS := 6
const POLE_H := 8.5
const ARM := 1.8
## Wall bracket lamps in galis and car-free streets (WORLD_LOGIC.md: deep galis are lit by their own lamps).
const WALL_SPACING := 9.0
const BRACKET := 0.7
## The car roads that get lamps (OSM classes; service roads, galis and paths get theirs from the area kits).
const CLASSES := ["motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street",
	"motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link"]

var night := 0.0
var gain := 1.0
var _stream: Node = null
var _centre := Vector3(INF, INF, INF)
var _pieces_seen := -1
var _heads: Array[Vector3] = []
## the real light's energy at full night per head (a wall bulb 4 m up is weaker than a pole head 8 m up)
var _head_e: Array[float] = []
var _poles: MultiMeshInstance3D
var _brackets: MultiMeshInstance3D
var _glow: MultiMeshInstance3D
var _pools: MultiMeshInstance3D
var _head_mat := StandardMaterial3D.new()
var _pool_mat := ShaderMaterial.new()
var _lights: Array[SpotLight3D] = []
var _t := 0.0
## What the last placement did (state().time.live.streetLamps): lamps placed and candidates left out, by reason.
var stats := {"lamps": 0, "wall": 0, "lit": 0, "inLane": 0, "junction": 0, "ground": 0, "blocked": 0, "near": 0}


func _ready() -> void:
	var pole_mat := StandardMaterial3D.new()
	pole_mat.albedo_color = Color(0.5, 0.51, 0.5)
	pole_mat.roughness = 0.55
	pole_mat.metallic = 0.4
	pole_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	_poles = _mm("Poles", _pole_mesh(), pole_mat, GeometryInstance3D.SHADOW_CASTING_SETTING_ON)
	_brackets = _mm("Brackets", _bracket_mesh(), pole_mat, GeometryInstance3D.SHADOW_CASTING_SETTING_OFF)
	_head_mat.albedo_color = Color(0.3, 0.29, 0.27)
	_head_mat.emission_enabled = true
	_head_mat.emission = SODIUM
	_head_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	_glow = _mm("Heads", _head_mesh(), _head_mat, GeometryInstance3D.SHADOW_CASTING_SETTING_OFF)
	_pool_mat.shader = POOL_SHADER
	_pool_mat.render_priority = -1
	var q := QuadMesh.new()
	q.size = Vector2(1, 1)
	q.orientation = PlaneMesh.FACE_Y
	_pools = _mm("Pools", q, _pool_mat, GeometryInstance3D.SHADOW_CASTING_SETTING_OFF)
	for i in LIGHTS:
		var s := SpotLight3D.new()
		s.light_color = SODIUM
		s.spot_range = 26.0
		s.spot_angle = 62.0
		s.spot_angle_attenuation = 1.2
		s.spot_attenuation = 2.0
		s.light_specular = 0.4
		s.shadow_enabled = false
		s.light_volumetric_fog_energy = 0.0
		s.visible = false
		add_child(s)
		_lights.append(s)
	_apply_night()


func _mm(n: String, mesh: Mesh, mat: Material, shadow: GeometryInstance3D.ShadowCastingSetting) -> MultiMeshInstance3D:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = mesh
	var mi := MultiMeshInstance3D.new()
	mi.name = n
	mi.multimesh = mm
	mi.material_override = mat
	mi.cast_shadow = shadow
	mi.set_meta("dressing", true)
	add_child(mi)
	return mi


## The night (0 day, 1 full night) and the look's lamp gain; called by stylised_b on every relight.
func set_night(n: float, lamp_gain: float) -> void:
	night = n
	gain = lamp_gain
	if is_inside_tree():
		_apply_night()


func _apply_night() -> void:
	_head_mat.emission_energy_multiplier = 0.0 if night < 0.05 else (1.2 + 2.2 * night) * clampf(gain / 4.0, 0.5, 1.6)
	_head_mat.albedo_color = Color(0.3, 0.29, 0.27).lerp(Color(1.0, 0.75, 0.5), clampf(night * 2.0, 0.0, 1.0))
	_pool_mat.set_shader_parameter("strength", clampf((night - 0.1) / 0.6, 0.0, 1.0) * 0.32)
	_pools.visible = night > 0.1
	_place_lights()


func _process(delta: float) -> void:
	_t += delta
	if _t < 0.5:
		return
	_t = 0.0
	if _stream == null or not is_instance_valid(_stream):
		_stream = get_tree().get_first_node_in_group("world_stream")
		if _stream == null:
			return
	if not bool(_stream.get("booted")) or _stream.get("lanes") == null:
		return
	var cam := get_viewport().get_camera_3d()
	if cam == null:
		return
	var c := cam.global_position
	var n: int = (_stream.lanes.pieces as Dictionary).size()
	var moved := Vector2(c.x - _centre.x, c.z - _centre.z).length() > REBUILD_M
	if moved or n != _pieces_seen:
		_centre = c
		_pieces_seen = n
		_build(c)
	_place_lights()


## The lamp positions round `c`: [foot (on the ground), out (unit, from the pole toward the road)].
func _build(c: Vector3) -> void:
	var lanes: RefCounted = _stream.lanes
	var feet: Array = []
	var taken := {}
	var space := get_world_3d().direct_space_state
	for k in stats:
		stats[k] = 0
	var walls: Array = []
	for id: String in lanes.near(c.x, c.z, RADIUS):
		var p: Dictionary = lanes.pieces[id]
		if p.kind != "lane" or int(p.layer) != 0:
			continue
		if not ("car" in (p.get("modes", ["car"]) as Array)):
			_wall_lamps(p, c, space, taken, walls)
			continue
		if not (str(p.cls) in CLASSES):
			continue
		for s: Array in kerb_points(p.pts, float(p.width), SPACING):
			var q: Vector3 = s[0]
			if Vector2(q.x - c.x, q.z - c.z).length() > RADIUS:
				continue
			var cell := Vector2i(floori(q.x / 12.0), floori(q.z / 12.0))
			if taken.has(cell):
				stats.near += 1
				continue
			# the kerb side of the outermost lane only: no other lane within 2.2 m of the pole (no pole in a lane), and
			# none of the junction paths within 7 m (no pole in a junction)
			var other: Dictionary = lanes.closest(q.x, q.y, q.z, 2.2, func(o: Dictionary) -> bool: return int(o.layer) == 0, 3.0)
			if not other.is_empty():
				stats.inLane += 1
				continue
			var jn: Dictionary = lanes.closest(q.x, q.y, q.z, 7.0, func(o: Dictionary) -> bool: return o.kind == "path", 3.0)
			if not jn.is_empty():
				stats.junction += 1
				continue
			# on the ground at the kerb: not on a roof or a wall top, and nothing solid between the lane and the pole
			# (a building or a wall right at the lane edge)
			var g: Dictionary = _stream.ground_at(q.x, q.z, q.y + 6.0, true)
			if not g.hit or absf(float(g.y) - q.y) > 0.6:
				stats.ground += 1
				continue
			var lane_at: Vector3 = q + (s[1] as Vector3) * (float(p.width) * 0.5 + 1.3)
			var ray := PhysicsRayQueryParameters3D.create(lane_at + Vector3.UP * 1.5, q - (s[1] as Vector3) * 0.4 + Vector3.UP * 1.5, 1)
			if not space.intersect_ray(ray).is_empty():
				stats.blocked += 1
				continue
			taken[cell] = true
			feet.append([Vector3(q.x, float(g.y), q.z), s[1]])
	stats.lamps = feet.size()
	stats.wall = walls.size()
	_fill(feet, walls)


## Galis and car-free streets (no pole fits): a bulb on a bracket on the nearest wall every WALL_SPACING metres,
## sides taken in turn, 4.2 m up. A sideways ray from the lane centre finds the wall (the building shells collide).
## [bracket foot on the wall, out (unit, from the wall toward the lane)] into `walls`.
func _wall_lamps(p: Dictionary, c: Vector3, space: PhysicsDirectSpaceState3D, taken: Dictionary, walls: Array) -> void:
	var k := 0
	for s: Array in kerb_points(p.pts, 0.0, WALL_SPACING):
		k += 1
		if k % 2 == 0:
			continue
		var side: Vector3 = -(s[1] as Vector3) if (k / 2) % 2 == 0 else (s[1] as Vector3)
		# from the lane's centre line (the kerb point less its offset)
		var at: Vector3 = (s[0] as Vector3) + (s[1] as Vector3) * (2.5 * 0.5 + 1.3)
		if Vector2(at.x - c.x, at.z - c.z).length() > RADIUS:
			continue
		var cell := Vector2i(floori(at.x / 8.0), floori(at.z / 8.0))
		if taken.has(cell):
			stats.near += 1
			continue
		var from := at + Vector3.UP * 4.2
		var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(from, from + side * 7.0, 1))
		if hit.is_empty() or absf((hit.normal as Vector3).y) > 0.3:
			stats.blocked += 1
			continue
		var n := Vector3((hit.normal as Vector3).x, 0.0, (hit.normal as Vector3).z).normalized()
		taken[cell] = true
		walls.append([hit.position as Vector3, n])


func _fill(feet: Array, walls: Array) -> void:
	var pm := _poles.multimesh
	var bm := _brackets.multimesh
	var hm := _glow.multimesh
	var om := _pools.multimesh
	pm.instance_count = feet.size()
	bm.instance_count = walls.size()
	hm.instance_count = feet.size() + walls.size()
	om.instance_count = feet.size() + walls.size()
	_heads.clear()
	_head_e.clear()
	for i in feet.size():
		var foot: Vector3 = feet[i][0]
		var out: Vector3 = feet[i][1]
		var side := Vector3.UP.cross(out)
		var b := Basis(side, Vector3.UP, out)
		pm.set_instance_transform(i, Transform3D(b, foot))
		var head := foot + out * ARM + Vector3.UP * (POLE_H - 0.15)
		hm.set_instance_transform(i, Transform3D(b, head))
		_heads.append(head)
		_head_e.append(150.0)
		# the pool: 14 m along the road, 11 m across, centred a little out from the head, just over the asphalt
		var pc := foot + out * (ARM + 1.5) + Vector3.UP * 0.07
		om.set_instance_transform(i, Transform3D(Basis(side * 14.0, Vector3.UP, out * 11.0), pc))
	for j in walls.size():
		var foot: Vector3 = walls[j][0]
		var out: Vector3 = walls[j][1]
		var side := Vector3.UP.cross(out)
		var b := Basis(side, Vector3.UP, out)
		bm.set_instance_transform(j, Transform3D(b, foot))
		var i := feet.size() + j
		var head := foot + out * BRACKET + Vector3.UP * 0.02
		hm.set_instance_transform(i, Transform3D(b.scaled(Vector3(0.6, 1.0, 0.45)), head))
		_heads.append(head)
		_head_e.append(40.0)
		var ground := foot.y - 4.2
		om.set_instance_transform(i, Transform3D(Basis(side * 9.0, Vector3.UP, out * 7.0), Vector3(foot.x, ground + 0.07, foot.z) + out * 2.0))
	_place_lights()


## Real SpotLights at the heads nearest the camera, at night only.
func _place_lights() -> void:
	var on := night >= 0.2 and not _heads.is_empty()
	var cam := get_viewport().get_camera_3d() if is_inside_tree() else null
	var order: Array = []
	if on and cam != null:
		var c := cam.global_position
		for i in _heads.size():
			order.append([_heads[i].distance_squared_to(c), _heads[i], _head_e[i]])
		order.sort_custom(func(a: Array, b: Array) -> bool: return a[0] < b[0])
	stats.lit = mini(order.size(), _lights.size())
	for i in _lights.size():
		var l := _lights[i]
		if not on or i >= order.size():
			l.visible = false
			continue
		var h: Vector3 = order[i][1]
		l.visible = true
		l.light_energy = float(order[i][2]) * night
		l.spot_range = 26.0 if float(order[i][2]) > 100.0 else 12.0
		l.transform = Transform3D(Basis.looking_at(Vector3.DOWN, Vector3.FORWARD), h - Vector3.UP * 0.2)


## Lamp feet along one lane piece: a point every `spacing` metres (from the piece start, half a spacing in), set out
## from the lane's centre to its left (the kerb side when traffic keeps left) and to its right (a median or the far
## kerb) by half its width plus 1.3 m, with the unit direction from the foot back toward the lane. Pure; tested in game/tests/test_style.gd.
static func kerb_points(pts: PackedVector3Array, width: float, spacing: float) -> Array:
	var out: Array = []
	var next := spacing * 0.5
	var walk := 0.0
	for i in pts.size() - 1:
		var a := pts[i]
		var b := pts[i + 1]
		var d := Vector3(b.x - a.x, 0.0, b.z - a.z)
		var len := d.length()
		if len < 1e-4:
			continue
		var t := d / len
		# east +X, north -Z: the left of a heading t is up x t
		var left := Vector3.UP.cross(t)
		while next <= walk + len:
			var f := (next - walk) / len
			var off := maxf(width, 2.5) * 0.5 + 1.3
			# the kerb side first, then the right side (a median or the far kerb; placement drops it when a lane is there)
			out.append([a.lerp(b, f) + left * off, -left])
			out.append([a.lerp(b, f) - left * off, left])
			next += spacing
		walk += len
	return out


func _pole_mesh() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	# a tapered octagonal pole on a base plate, the arm out along +Z (the road), a brace under it
	_cyl(st, Vector3.ZERO, 0.11, 0.07, POLE_H, 8)
	_box(st, Vector3(0, 0.05, 0), Vector3(0.36, 0.1, 0.36))
	_box(st, Vector3(0, POLE_H - 0.05, ARM * 0.5), Vector3(0.07, 0.07, ARM + 0.1))
	_box(st, Vector3(0, POLE_H - 0.42, 0.28), Vector3(0.045, 0.75, 0.045), Vector3(0.62, 0, 0))
	# the head housing over the lens
	_box(st, Vector3(0, POLE_H + 0.02, ARM), Vector3(0.32, 0.14, 0.62))
	return st.commit()


## A wall bracket: a plate on the wall, an arm out along +Z, a small shade at its end (the lens is the head mesh).
func _bracket_mesh() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	_box(st, Vector3(0, 0, 0.02), Vector3(0.16, 0.24, 0.04))
	_box(st, Vector3(0, 0.05, BRACKET * 0.5), Vector3(0.04, 0.04, BRACKET))
	_box(st, Vector3(0, 0.07, BRACKET), Vector3(0.2, 0.06, 0.3))
	return st.commit()


func _head_mesh() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	# the lens under the housing (the head transform sits at its centre)
	_box(st, Vector3(0, -0.04, 0), Vector3(0.26, 0.05, 0.52))
	return st.commit()


## A box with flat normals (both faces drawn: the materials do not cull, so the winding does not matter).
static func _box(st: SurfaceTool, c: Vector3, s: Vector3, tilt := Vector3.ZERO) -> void:
	var b := Basis.from_euler(tilt)
	var h := s * 0.5
	for f: Array in [[Vector3.RIGHT, Vector3.UP, Vector3.BACK], [Vector3.UP, Vector3.BACK, Vector3.RIGHT],
			[Vector3.BACK, Vector3.RIGHT, Vector3.UP]]:
		for sg in [1.0, -1.0]:
			var n: Vector3 = f[0] * sg
			var u: Vector3 = f[1] * h
			var v: Vector3 = f[2] * h
			var o := n * h
			var q := [o - u - v, o + u - v, o + u + v, o - u + v]
			st.set_normal((b * n).normalized())
			for k in [0, 1, 2, 0, 2, 3]:
				st.add_vertex(c + b * (q[k] as Vector3))


static func _cyl(st: SurfaceTool, base: Vector3, r0: float, r1: float, h: float, n: int) -> void:
	for i in n:
		var a0 := TAU * i / n
		var a1 := TAU * (i + 1) / n
		var n0 := Vector3(cos(a0), 0, sin(a0))
		var n1 := Vector3(cos(a1), 0, sin(a1))
		var p0 := base + n0 * r0
		var p1 := base + n1 * r0
		var q0 := base + n0 * r1 + Vector3.UP * h
		var q1 := base + n1 * r1 + Vector3.UP * h
		for e: Array in [[p0, n0], [q1, n1], [p1, n1], [p0, n0], [q0, n0], [q1, n1]]:
			st.set_normal(e[1])
			st.add_vertex(e[0])
