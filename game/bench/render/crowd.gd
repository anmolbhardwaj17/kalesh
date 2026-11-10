## Crowd of the render bench (P0-016, ARCH_OPTIONS.md "Animation and crowds"): COUNT people walking along the
## footpaths around the centre junction of the bench city, as one of two setups:
##   an1: every person is a skinned mesh (20 bones) with its own AnimationTree (idle and walk blended, time scaled).
##   an2: the nearest NEAR_CAP people within NEAR metres are skinned with an AnimationTree; everyone else is one
##        instance of a MultiMesh whose walk is baked vertex animation (vat.gdshader). Reassigned 4 times a second.
## The stand-in person is procedural: rigid parts on a 20 bone skeleton, the walk built in code. No imported asset.
extends Node3D

const Geo := preload("res://scenes/standin/geo.gd")
const Kit := preload("res://scenes/standin/kit.gd")
const VAT_SHADER := preload("res://bench/render/vat.gdshader")

const COUNT := 300
const NEAR := 25.0
const NEAR_CAP := 40
const FRAMES := 24
const VARIANTS := 6
const WALK_BONES := [14, 17, 15, 18, 7, 11, 8, 12, 2, 3, 5]
## name, parent, rest position in the person's frame (facing -Z, feet at the origin)
const BONES := [
	["root", -1, Vector3(0, 0, 0)], ["hips", 0, Vector3(0, 0.95, 0)], ["spine", 1, Vector3(0, 1.1, 0)],
	["chest", 2, Vector3(0, 1.28, 0)], ["neck", 3, Vector3(0, 1.47, 0)], ["head", 4, Vector3(0, 1.55, 0)],
	["clav_l", 3, Vector3(0.08, 1.4, 0)], ["upper_l", 6, Vector3(0.2, 1.38, 0)], ["fore_l", 7, Vector3(0.23, 1.1, 0)],
	["hand_l", 8, Vector3(0.25, 0.86, 0)],
	["clav_r", 3, Vector3(-0.08, 1.4, 0)], ["upper_r", 10, Vector3(-0.2, 1.38, 0)], ["fore_r", 11, Vector3(-0.23, 1.1, 0)],
	["hand_r", 12, Vector3(-0.25, 0.86, 0)],
	["thigh_l", 1, Vector3(0.09, 0.92, 0)], ["shin_l", 14, Vector3(0.095, 0.5, 0)], ["foot_l", 15, Vector3(0.095, 0.08, 0)],
	["thigh_r", 1, Vector3(-0.09, 0.92, 0)], ["shin_r", 17, Vector3(-0.095, 0.5, 0)], ["foot_r", 18, Vector3(-0.095, 0.08, 0)],
]

var mode := "an1"
var stats := {}
var _satin: Material
var _meshes: Array[ArrayMesh] = []
var _vat_meshes: Array[ArrayMesh] = []
var _skin: Skin
var _lib: AnimationLibrary
var _tree_root: AnimationNodeBlendTree
# part geometry shared by every variant
var _v := PackedVector3Array()
var _n := PackedVector3Array()
var _idx := PackedInt32Array()
var _bone := PackedInt32Array()
var _role := PackedInt32Array()
# walkers
var _a: Array[Vector3] = []
var _dir: Array[Vector3] = []
var _basis: Array[Basis] = []
var _len := PackedFloat32Array()
var _u := PackedFloat32Array()
var _spd := PackedFloat32Array()
var _variant := PackedInt32Array()
var _slot := PackedInt32Array()
var _phase := PackedFloat32Array()
# an1: one rig per walker. an2: a pool of NEAR_CAP rigs plus one MultiMesh per variant.
var _rigs: Array[Node3D] = []
var _rig_mesh: Array[MeshInstance3D] = []
var _rig_tree: Array[AnimationTree] = []
var _rig_of := {}
var _free: Array[int] = []
var _mm: Array[MultiMesh] = []
var _since := 1.0


func setup(crowd_mode: String, satin: Material) -> void:
	mode = crowd_mode
	_satin = satin


func _ready() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 20261117
	_build_parts()
	for k in VARIANTS:
		var palette := [Kit.pick(rng, Kit.SKIN), Kit.pick(rng, Kit.CLOTHES),
			Kit.pick(rng, [Color("#2c2f36"), Color("#4a4e58"), Color("#e9e2d0"), Color("#6b5a48")]), Color("#2a211c"), Color("#1b1714")]
		_meshes.append(_variant_mesh(palette, false))
		_vat_meshes.append(_variant_mesh(palette, true))
	_build_animation()
	_spawn_walkers(rng)
	if mode == "an1":
		for w in COUNT:
			_make_rig(_variant[w], _spd[w], _phase[w])
	else:
		_build_vat()
		for r in NEAR_CAP:
			_make_rig(0, 1.35, 0.0)
			_rigs[r].visible = false
			_rig_tree[r].active = false
			_free.append(r)
	stats = {"mode": mode, "people": COUNT, "bones": BONES.size(), "verticesPerPerson": _v.size(), "trianglesPerPerson": _idx.size() / 3,
		"skinnedRigs": _rigs.size(), "animationTrees": _rigs.size(), "vatInstances": COUNT if mode == "an2" else 0,
		"nearRadiusM": NEAR, "nearCap": NEAR_CAP}
	_step(0.0)


func _process(delta: float) -> void:
	_step(delta)


func _step(delta: float) -> void:
	var cam := get_viewport().get_camera_3d()
	var cp := cam.global_position if cam != null else Vector3.ZERO
	if mode == "an2":
		_since += delta
		if _since >= 0.25:
			_since = 0.0
			_assign(cp)
	for w in COUNT:
		var u := _u[w] + _spd[w] * delta
		if u > _len[w]:
			u -= _len[w]
		_u[w] = u
		var xf := Transform3D(_basis[w], _a[w] + _dir[w] * u)
		if mode == "an1":
			_rigs[w].transform = xf
		elif _rig_of.has(w):
			_rigs[_rig_of[w]].transform = xf
		else:
			_mm[_variant[w]].set_instance_transform(_slot[w], xf)


## an2: the nearest NEAR_CAP walkers within NEAR of the camera get a skinned rig; the rest stay in the MultiMesh.
func _assign(cp: Vector3) -> void:
	var near: Array[int] = []
	var dist := {}
	for w in COUNT:
		var d := (_a[w] + _dir[w] * _u[w]).distance_to(cp)
		if d < NEAR:
			near.append(w)
			dist[w] = d
	near.sort_custom(func(x: int, y: int) -> bool: return dist[x] < dist[y])
	if near.size() > NEAR_CAP:
		near.resize(NEAR_CAP)
	var keep := {}
	for w in near:
		keep[w] = true
	for w in _rig_of.keys():
		if not keep.has(w):
			var r: int = _rig_of[w]
			_rigs[r].visible = false
			_rig_tree[r].active = false
			_free.append(r)
			_rig_of.erase(w)
	for w in near:
		if _rig_of.has(w) or _free.is_empty():
			continue
		var r: int = _free.pop_back()
		_rig_of[w] = r
		_rig_mesh[r].mesh = _meshes[_variant[w]]
		_rig_tree[r].active = true
		_rig_tree[r].set("parameters/ts/scale", _spd[w] / 1.35)
		_rigs[r].visible = true
		# park the baked instance of this walker out of sight while it is skinned
		_mm[_variant[w]].set_instance_transform(_slot[w], Transform3D(Basis.from_scale(Vector3.ONE * 0.001), Vector3(0, -200, 0)))


# ------------------------------------------------------------------ the stand-in person


func _part(bone: int, role: int, arrays: Array, xf: Transform3D) -> void:
	var base := _v.size()
	var v: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
	var n: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
	var nb := xf.basis.inverse().transposed()
	for k in v.size():
		_v.append(xf * v[k])
		_n.append((nb * n[k]).normalized())
		_bone.append(bone)
		_role.append(role)
	var ind: PackedInt32Array = arrays[Mesh.ARRAY_INDEX]
	for k in ind.size():
		_idx.append(ind[k] + base)


## Rigid parts, each bound to one bone. role: 0 skin, 1 top, 2 bottom, 3 shoes, 4 hair.
func _build_parts() -> void:
	var cyl := func(bone: int, role: int, c: Vector3, r: float, h: float, taper: float) -> void:
		_part(bone, role, Geo.unit_cyl(Geo.SEG_SMALL, taper), Transform3D(Basis.from_scale(Vector3(r, h, r)), c))
	var rod := func(bone: int, role: int, a: Vector3, b: Vector3, r: float, taper: float) -> void:
		_part(bone, role, Geo.unit_cyl(Geo.SEG_SMALL, taper), Geo.rod_xf(a, b, r))
	var ball := func(bone: int, role: int, c: Vector3, rad: Vector3) -> void:
		_part(bone, role, Geo.unit_sphere(Geo.SEG_SMALL), Transform3D(Basis.from_scale(rad), c))
	cyl.call(1, 2, Vector3(0, 0.95, 0), 0.16, 0.2, 1.0)
	cyl.call(2, 1, Vector3(0, 1.13, 0), 0.165, 0.3, 1.1)
	cyl.call(3, 1, Vector3(0, 1.31, 0), 0.18, 0.2, 1.0)
	ball.call(3, 1, Vector3(0, 1.39, 0), Vector3(0.21, 0.08, 0.13))
	cyl.call(4, 0, Vector3(0, 1.47, 0), 0.05, 0.1, 1.0)
	_part(5, 0, Geo.unit_sphere(Geo.SEG_MID), Transform3D(Basis.from_scale(Vector3(0.1, 0.125, 0.11)), Vector3(0, 1.6, -0.01)))
	_part(5, 4, Geo.unit_dome(Geo.SEG_MID), Transform3D(Basis.from_scale(Vector3(0.108, 0.11, 0.108)), Vector3(0, 1.63, 0.01)))
	for xs in [1.0, -1.0]:
		var o := 0 if xs > 0.0 else 4
		rod.call(7 + o, 1, Vector3(xs * 0.2, 1.38, 0), Vector3(xs * 0.23, 1.1, 0), 0.05, 0.9)
		rod.call(8 + o, 0, Vector3(xs * 0.23, 1.1, 0), Vector3(xs * 0.25, 0.86, 0), 0.04, 0.85)
		ball.call(9 + o, 0, Vector3(xs * 0.25, 0.82, 0), Vector3.ONE * 0.045)
		var l := 0 if xs > 0.0 else 3
		rod.call(14 + l, 2, Vector3(xs * 0.09, 0.92, 0), Vector3(xs * 0.095, 0.5, 0), 0.08, 0.8)
		rod.call(15 + l, 2, Vector3(xs * 0.095, 0.5, 0), Vector3(xs * 0.095, 0.08, 0), 0.06, 0.8)
		_part(16 + l, 3, Geo.unit_box(), Transform3D(Basis.from_scale(Vector3(0.11, 0.08, 0.26)), Vector3(xs * 0.095, 0.04, -0.05)))


## One clothes variant as a mesh: skinned (bones and weights) or for the baked MultiMesh (UV2.x = vertex column).
func _variant_mesh(palette: Array, vat: bool) -> ArrayMesh:
	var cols := PackedColorArray()
	cols.resize(_v.size())
	for k in _v.size():
		cols[k] = palette[_role[k]]
	var a := []
	a.resize(Mesh.ARRAY_MAX)
	a[Mesh.ARRAY_VERTEX] = _v
	a[Mesh.ARRAY_NORMAL] = _n
	a[Mesh.ARRAY_COLOR] = cols
	a[Mesh.ARRAY_INDEX] = _idx
	var mesh := ArrayMesh.new()
	if vat:
		var uv2 := PackedVector2Array()
		uv2.resize(_v.size())
		for k in _v.size():
			uv2[k] = Vector2((k + 0.5) / _v.size(), 0.0)
		a[Mesh.ARRAY_TEX_UV2] = uv2
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, a)
	else:
		var bones := PackedInt32Array()
		var weights := PackedFloat32Array()
		bones.resize(_v.size() * 4)
		weights.resize(_v.size() * 4)
		for k in _v.size():
			bones[k * 4] = _bone[k]
			weights[k * 4] = 1.0
		a[Mesh.ARRAY_BONES] = bones
		a[Mesh.ARRAY_WEIGHTS] = weights
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, a)
		mesh.surface_set_material(0, _satin)
	return mesh


func _skeleton() -> Skeleton3D:
	var sk := Skeleton3D.new()
	sk.name = "Skeleton3D"
	for b in BONES:
		sk.add_bone(b[0])
	for i in BONES.size():
		var parent: int = BONES[i][1]
		sk.set_bone_parent(i, parent)
		var rest := Transform3D(Basis.IDENTITY, (BONES[i][2] as Vector3) - ((BONES[parent][2] as Vector3) if parent >= 0 else Vector3.ZERO))
		sk.set_bone_rest(i, rest)
		sk.set_bone_pose_position(i, rest.origin)
	return sk


## Bone rotations of the walk at phase 0..1 (rest rotations are identity, so these are the local poses).
static func walk_pose(ph: float) -> Dictionary:
	var s := sin(TAU * ph)
	return {
		14: Quaternion(Vector3.RIGHT, 0.5 * s), 17: Quaternion(Vector3.RIGHT, -0.5 * s),
		15: Quaternion(Vector3.RIGHT, -0.75 * maxf(0.0, sin(TAU * ph + 2.2))),
		18: Quaternion(Vector3.RIGHT, -0.75 * maxf(0.0, sin(TAU * (ph + 0.5) + 2.2))),
		7: Quaternion(Vector3.RIGHT, -0.4 * s), 11: Quaternion(Vector3.RIGHT, 0.4 * s),
		8: Quaternion(Vector3.RIGHT, 0.35), 12: Quaternion(Vector3.RIGHT, 0.35),
		2: Quaternion(Vector3.UP, 0.06 * s), 3: Quaternion(Vector3.UP, -0.1 * s), 5: Quaternion(Vector3.UP, 0.04 * s),
	}


func _build_animation() -> void:
	var walk := Animation.new()
	walk.length = 1.0
	walk.loop_mode = Animation.LOOP_LINEAR
	for b in WALK_BONES:
		var tr := walk.add_track(Animation.TYPE_ROTATION_3D)
		walk.track_set_path(tr, NodePath("Skeleton3D:%s" % BONES[b][0]))
		for k in 17:
			walk.rotation_track_insert_key(tr, k / 16.0, walk_pose(k / 16.0)[b])
	var idle := Animation.new()
	idle.length = 2.0
	idle.loop_mode = Animation.LOOP_LINEAR
	for b in WALK_BONES:
		var tr := idle.add_track(Animation.TYPE_ROTATION_3D)
		idle.track_set_path(tr, NodePath("Skeleton3D:%s" % BONES[b][0]))
		for k in 5:
			var q := Quaternion(Vector3.RIGHT, 0.02 * sin(TAU * k / 4.0)) if b in [3, 5] else Quaternion.IDENTITY
			idle.rotation_track_insert_key(tr, k * 0.5, q)
	_lib = AnimationLibrary.new()
	_lib.add_animation(&"walk", walk)
	_lib.add_animation(&"idle", idle)
	_tree_root = AnimationNodeBlendTree.new()
	var a_idle := AnimationNodeAnimation.new()
	a_idle.animation = &"idle"
	var a_walk := AnimationNodeAnimation.new()
	a_walk.animation = &"walk"
	_tree_root.add_node(&"idle", a_idle)
	_tree_root.add_node(&"walk", a_walk)
	_tree_root.add_node(&"blend", AnimationNodeBlend2.new())
	_tree_root.add_node(&"ts", AnimationNodeTimeScale.new())
	_tree_root.connect_node(&"blend", 0, &"idle")
	_tree_root.connect_node(&"blend", 1, &"walk")
	_tree_root.connect_node(&"ts", 0, &"blend")
	_tree_root.connect_node(&"output", 0, &"ts")


func _make_rig(variant: int, speed: float, phase: float) -> void:
	var root := Node3D.new()
	var sk := _skeleton()
	root.add_child(sk)
	if _skin == null:
		_skin = sk.create_skin_from_rest_transforms()
	var mi := MeshInstance3D.new()
	mi.mesh = _meshes[variant]
	mi.skin = _skin
	sk.add_child(mi)
	mi.skeleton = NodePath("..")
	var tree := AnimationTree.new()
	tree.add_animation_library(&"", _lib)
	tree.tree_root = _tree_root
	root.add_child(tree)
	add_child(root)
	tree.active = true
	tree.set("parameters/blend/blend_amount", 0.9)
	tree.set("parameters/ts/scale", speed / 1.35)
	if phase > 0.0:
		tree.advance(phase)
	_rigs.append(root)
	_rig_mesh.append(mi)
	_rig_tree.append(tree)


func _spawn_walkers(rng: RandomNumberGenerator) -> void:
	var lines := [
		[Vector3(-120, 0.17, -7.6), Vector3(120, 0.17, -7.6)], [Vector3(120, 0.17, -6.4), Vector3(-120, 0.17, -6.4)],
		[Vector3(-120, 0.17, 6.4), Vector3(120, 0.17, 6.4)], [Vector3(120, 0.17, 7.6), Vector3(-120, 0.17, 7.6)],
		[Vector3(-7, 0.17, -120), Vector3(-7, 0.17, 120)], [Vector3(7, 0.17, 120), Vector3(7, 0.17, -120)],
	]
	var per_variant := PackedInt32Array()
	per_variant.resize(VARIANTS)
	for w in COUNT:
		var l: Array = lines[w % lines.size()]
		var a: Vector3 = l[0]
		var b: Vector3 = l[1]
		var d := (b - a).normalized()
		_a.append(a)
		_dir.append(d)
		_basis.append(Basis.looking_at(d, Vector3.UP))
		_len.append(a.distance_to(b))
		_u.append(rng.randf_range(0.0, a.distance_to(b)))
		_spd.append(rng.randf_range(1.15, 1.55))
		_phase.append(rng.randf())
		var v := rng.randi_range(0, VARIANTS - 1)
		_variant.append(v)
		_slot.append(per_variant[v])
		per_variant[v] += 1
	if mode == "an2":
		for v in VARIANTS:
			var mm := MultiMesh.new()
			mm.transform_format = MultiMesh.TRANSFORM_3D
			mm.use_custom_data = true
			mm.mesh = _vat_meshes[v]
			mm.instance_count = per_variant[v]
			_mm.append(mm)
		for w in COUNT:
			_mm[_variant[w]].set_instance_custom_data(_slot[w], Color(_phase[w], _spd[w] / 1.35, 0, 0))


## Bakes the walk cycle into the position and normal textures and gives every baked mesh the shader.
func _build_vat() -> void:
	var nv := _v.size()
	var pos := PackedFloat32Array()
	var nrm := PackedFloat32Array()
	pos.resize(nv * FRAMES * 3)
	nrm.resize(nv * FRAMES * 3)
	for f in FRAMES:
		var pose := walk_pose(float(f) / FRAMES)
		var global: Array[Transform3D] = []
		for i in BONES.size():
			var parent: int = BONES[i][1]
			var local := Transform3D(Basis(pose.get(i, Quaternion.IDENTITY) as Quaternion),
				(BONES[i][2] as Vector3) - ((BONES[parent][2] as Vector3) if parent >= 0 else Vector3.ZERO))
			global.append(global[parent] * local if parent >= 0 else local)
		for k in nv:
			var g := global[_bone[k]]
			var p := g * (_v[k] - (BONES[_bone[k]][2] as Vector3))
			var n := g.basis * _n[k]
			var o := (f * nv + k) * 3
			pos[o] = p.x
			pos[o + 1] = p.y
			pos[o + 2] = p.z
			nrm[o] = n.x
			nrm[o + 1] = n.y
			nrm[o + 2] = n.z
	var mat := ShaderMaterial.new()
	mat.shader = VAT_SHADER
	mat.set_shader_parameter("vat_pos", ImageTexture.create_from_image(Image.create_from_data(nv, FRAMES, false, Image.FORMAT_RGBF, pos.to_byte_array())))
	mat.set_shader_parameter("vat_nrm", ImageTexture.create_from_image(Image.create_from_data(nv, FRAMES, false, Image.FORMAT_RGBF, nrm.to_byte_array())))
	mat.set_shader_parameter("frames", float(FRAMES))
	for v in VARIANTS:
		_vat_meshes[v].surface_set_material(0, mat)
		var mmi := MultiMeshInstance3D.new()
		mmi.name = "Far%d" % v
		mmi.multimesh = _mm[v]
		mmi.custom_aabb = AABB(Vector3(-130, -1, -130), Vector3(260, 4, 260))
		add_child(mmi)
