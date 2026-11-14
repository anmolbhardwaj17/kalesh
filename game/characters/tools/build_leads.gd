## Offline build of the three lead models (P2-063), run by tools/characters/lead_build.mjs (never by the game):
##   godot --headless --path game -s res://characters/tools/build_leads.gd -- bittu meera danny
## Reads the owner's models that the driver copied into the gitignored res://characters/lead_src/<id>.glb with the
## import setting that retargets the Mixamo rig to Godot's SkeletonProfileHumanoid (rig/mixamo_bone_map.tres, rests
## fixed, the A-pose fixed to the profile's T silhouette, the skeleton named %GeneralSkeleton): the same profile as the
## Universal Animation Library clips (rig/ual_clips.res) and the built locomotion (rig/loco_clips.res), so every clip
## plays on the lead's own skeleton. Writes per lead:
##   rig/lead_<id>.scn         a Node3D with the %GeneralSkeleton and three skinned levels of one mesh:
##                             Body_LOD0 the full model (close-ups), Body_LOD1 25,000 triangles or fewer (play),
##                             Body_LOD2 about 6,000 (distance); 4 bone weights a vertex; the stylised B material
##                             (StandardMaterial3D: satin, rim 0.25, no normal map) on the model's own texture.
##                             Root metadata "lead": rest height, the sole points (heel and ball in each foot
##                             bone's frame, for the locomotion build), the unit factor, triangles per level.
##   rig/lead_<id>_albedo.res  the base colour, 2048 px, mipmapped, VRAM compressed (S3TC).
## The model is stored in the library mannequin's units (its legs as long as the mannequin's: the clips' hips track and
## every tolerance of the locomotion build are in those units); the game scales it to the lead's height. The driver
## then builds the lead's own locomotion clips on this skeleton (build_locomotion.gd -- lead <id>: rig/loco_<id>.res),
## so the planted feet hold on this body's legs, not the mannequin's.
extends SceneTree

const LegIK := preload("res://characters/leg_ik.gd")

const SRC := "res://characters/lead_src/"
const OUT := "res://characters/rig/"
const MANNEQUIN := "res://characters/rig/mannequin_m.scn"
const MANNEQUIN_F := "res://characters/rig/mannequin_f.scn"
const Leads := preload("res://characters/leads.gd")
## Triangle targets of the play and distance levels.
const LOD1_MAX := 25000
const LOD2_TARGET := 6000
## Camera distance (m) where each level starts: the full mesh only for close-ups.
const LOD1_FROM := 2.4
const LOD2_FROM := 20.0
const TEX_SIZE := 2048
const SIDES := ["Left", "Right"]

var _ran := false


func _process(_d: float) -> bool:
	if _ran:
		return false
	_ran = true
	var ids := OS.get_cmdline_user_args()
	var err := ""
	for id in ids:
		err = _build(id)
		if err != "":
			break
	if err != "":
		printerr("build_leads: ", err)
		quit(1)
	else:
		print("build_leads: ok")
		quit(0)
	return false


func _build(id: String) -> String:
	var ps := load(SRC + id + ".glb") as PackedScene
	if ps == null:
		return "missing %s%s.glb (run tools/characters/lead_build.mjs)" % [SRC, id]
	var src := ps.instantiate()
	var sk_src := src.find_child("GeneralSkeleton", true, false) as Skeleton3D
	if sk_src == null:
		return "%s: no GeneralSkeleton after the retarget" % id
	var mis := src.find_children("*", "MeshInstance3D", true, false)
	if mis.size() != 1:
		return "%s: expected one mesh, found %d" % [id, mis.size()]
	var mi_src := mis[0] as MeshInstance3D
	for b in ["Hips", "LeftUpperLeg", "LeftFoot", "LeftToes", "RightToes", "Head"]:
		if sk_src.find_bone(b) < 0:
			return "%s: bone %s missing after the retarget" % [id, b]
	# a clean scene: Node3D root, the skeleton in its (T) rest, the mesh levels
	var root_n := Node3D.new()
	root_n.name = "Lead" + id.capitalize()
	# the profile's bones of the model, under a Root at the origin, plus the mannequin's leaf bones (the clips carry
	# tracks for Root and the leaves: a track whose bone is missing makes Godot print an error every tick)
	var man0 := (load(MANNEQUIN) as PackedScene).instantiate() as Node3D
	var msk0 := man0.get_node("GeneralSkeleton") as Skeleton3D
	var sk := Skeleton3D.new()
	sk.name = "GeneralSkeleton"
	var has_root := sk_src.find_bone("Root") >= 0
	if not has_root:
		sk.add_bone("Root")
	for i in sk_src.get_bone_count():
		sk.add_bone(sk_src.get_bone_name(i))
	for i in sk_src.get_bone_count():
		var b := sk.find_bone(sk_src.get_bone_name(i))
		var par := sk_src.get_bone_parent(i)
		sk.set_bone_parent(b, sk.find_bone(sk_src.get_bone_name(par)) if par >= 0 else (-1 if has_root else 0))
		sk.set_bone_rest(b, sk_src.get_bone_rest(i))
	for i in msk0.get_bone_count():
		var n := msk0.get_bone_name(i)
		var par := msk0.get_bone_parent(i)
		if sk.find_bone(n) >= 0 or par < 0 or sk.find_bone(msk0.get_bone_name(par)) < 0:
			continue
		sk.add_bone(n)
		var b := sk.find_bone(n)
		sk.set_bone_parent(b, sk.find_bone(msk0.get_bone_name(par)))
		sk.set_bone_rest(b, msk0.get_bone_rest(i))
	man0.free()
	sk.reset_bone_poses()
	root_n.add_child(sk)
	sk.owner = root_n
	sk.unique_name_in_owner = true
	var skin := mi_src.skin.duplicate(true) as Skin
	# binds by bone name, so the added Root and leaf bones cannot shift what a bind follows
	for bi in skin.get_bind_count():
		if skin.get_bind_name(bi) == &"":
			skin.set_bind_name(bi, sk_src.get_bone_name(skin.get_bind_bone(bi)))
	var arrays := _clean_arrays(mi_src.mesh.surface_get_arrays(0))
	# the whole model in the library mannequin's units: its legs as long as the mannequin's, so the clips' hips track,
	# the locomotion build's tolerances and the body feel all hold as they are (the game scales it to its height)
	var man := (load(MANNEQUIN) as PackedScene).instantiate() as Node3D
	var msk := man.get_node("GeneralSkeleton") as Skeleton3D
	var units := LegIK.reach(msk, LegIK.leg(msk, "Left")) / LegIK.reach(sk, LegIK.leg(sk, "Left"))
	_rescale(sk, skin, arrays, units)
	var turned := _match_silhouette(sk, skin, arrays, msk)
	print("lead %s: rest matched to the mannequin's (degrees turned): %s" % [id, turned])
	var m_height: float = Leads.REST_HEIGHT[Leads.look(id)["mesh"]]
	var head_f := 1.0
	if Leads.look(id)["mesh"] == "f":
		var fm := (load(MANNEQUIN_F) as PackedScene).instantiate() as Node3D
		head_f = _fit_head(sk, skin, arrays, fm.get_node("GeneralSkeleton"), m_height)
		fm.free()
	else:
		head_f = _fit_head(sk, skin, arrays, msk, m_height)
	print("lead %s: head scaled by %.3f to the mannequin's proportion" % [id, head_f])
	man.free()
	var rest_pos := _skinned_rest(arrays, skin, sk)
	var split := _split_legs(arrays, skin, sk, rest_pos)
	if split.x + split.y > 0:
		print("lead %s: legs split below the crotch: %d vertices lost weights on the other leg, %d triangles joining the two legs removed" % [id, split.x, split.y])
	# levels
	var im := ImporterMesh.new()
	im.add_surface(Mesh.PRIMITIVE_TRIANGLES, arrays)
	im.generate_lods(25.0, 60.0, [])
	var tris0: int = (arrays[Mesh.ARRAY_INDEX] as PackedInt32Array).size() / 3
	var lods := [arrays[Mesh.ARRAY_INDEX]]
	var pick1 := PackedInt32Array()
	var pick2 := PackedInt32Array()
	var counts := [tris0]
	for l in im.get_surface_lod_count(0):
		var ix := im.get_surface_lod_indices(0, l)
		var t := ix.size() / 3
		counts.append(t)
		if t <= LOD1_MAX and (pick1.is_empty() or t > pick1.size() / 3):
			pick1 = ix
		if t <= LOD1_MAX and (pick2.is_empty() or absi(t - LOD2_TARGET) < absi(pick2.size() / 3 - LOD2_TARGET)):
			pick2 = ix
	print("lead %s: triangles %d, generated levels %s" % [id, tris0, counts])
	if pick1.is_empty() or pick2.is_empty():
		return "%s: no level under %d triangles" % [id, LOD1_MAX]
	lods.append(pick1)
	lods.append(pick2)
	# the material on the model's own texture
	var src_mat := mi_src.mesh.surface_get_material(0)
	if mi_src.get_surface_override_material(0) != null:
		src_mat = mi_src.get_surface_override_material(0)
	var tex := _albedo(id, src_mat)
	if tex == null:
		return "%s: no base colour texture" % id
	var mat := StandardMaterial3D.new()
	mat.resource_name = "lead_%s" % id
	mat.albedo_texture = tex
	mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	mat.roughness = 0.72
	mat.metallic_specular = 0.35
	mat.rim_enabled = true
	mat.rim = 0.25
	mat.rim_tint = 0.5
	# both faces: where fused legs were split (_split_legs) the cloth is open on the inside, and the inner face shows
	# the cloth instead of a see-through hole
	mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	var ranges := [[0.0, LOD1_FROM], [LOD1_FROM, LOD2_FROM], [LOD2_FROM, 0.0]]
	var tri_counts := []
	for l in 3:
		var a := _compact(arrays, lods[l])
		tri_counts.append((a[Mesh.ARRAY_INDEX] as PackedInt32Array).size() / 3)
		var am := ArrayMesh.new()
		am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, a, [], {}, 0)
		am.surface_set_material(0, mat)
		am.resource_name = "lead_%s_lod%d" % [id, l]
		var mi := MeshInstance3D.new()
		mi.name = "Body_LOD%d" % l
		mi.mesh = am
		mi.skin = skin
		mi.skeleton = NodePath("..")
		var rg: Array = ranges[l]
		mi.visibility_range_begin = float(rg[0])
		mi.visibility_range_end = float(rg[1])
		mi.visibility_range_begin_margin = 0.15 if l > 0 else 0.0
		mi.visibility_range_end_margin = 0.15 if l < 2 else 0.0
		mi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_DISABLED
		sk.add_child(mi)
		mi.owner = root_n
	# what the game needs to plant this skeleton's feet
	var meta := _measure(id, units, sk, rest_pos, arrays, skin)
	if meta.has("error"):
		return str(meta.error)
	meta["triangles"] = tri_counts
	meta["source"] = "public/assets/models/model_lead_%s.glb (owner upload, text to 3D plus Mixamo auto rig)" % id
	root_n.set_meta("lead", meta)
	var pk := PackedScene.new()
	pk.pack(root_n)
	var e := ResourceSaver.save(pk, OUT + "lead_%s.scn" % id, ResourceSaver.FLAG_COMPRESS)
	if e != OK:
		return "save lead_%s.scn: %d" % [id, e]
	print("lead %s: levels %s, %s" % [id, tri_counts, JSON.stringify(meta)])
	src.free()
	root_n.free()
	return ""


## The surface arrays the game draws: positions, normals, UVs, 4 bone weights (the strongest four, normalised) and the
## indices; tangents and second UVs dropped (no normal map in stylised B).
func _clean_arrays(arr: Array) -> Array:
	var out := []
	out.resize(Mesh.ARRAY_MAX)
	out[Mesh.ARRAY_VERTEX] = arr[Mesh.ARRAY_VERTEX]
	out[Mesh.ARRAY_NORMAL] = arr[Mesh.ARRAY_NORMAL]
	out[Mesh.ARRAY_TEX_UV] = arr[Mesh.ARRAY_TEX_UV]
	out[Mesh.ARRAY_INDEX] = arr[Mesh.ARRAY_INDEX]
	var pos: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	var bones: PackedInt32Array = arr[Mesh.ARRAY_BONES]
	var weights: PackedFloat32Array = arr[Mesh.ARRAY_WEIGHTS]
	var per := bones.size() / pos.size()
	var nb := PackedInt32Array()
	var nw := PackedFloat32Array()
	nb.resize(pos.size() * 4)
	nw.resize(pos.size() * 4)
	for v in pos.size():
		var pairs := []
		for k in per:
			pairs.append([weights[v * per + k], bones[v * per + k]])
		pairs.sort_custom(func(x, y): return x[0] > y[0])
		var sum := 0.0
		for k in 4:
			sum += float(pairs[k][0]) if k < pairs.size() else 0.0
		for k in 4:
			var w := float(pairs[k][0]) if k < pairs.size() else 0.0
			nb[v * 4 + k] = int(pairs[k][1]) if k < pairs.size() and w > 0.0 else 0
			nw[v * 4 + k] = w / sum if sum > 0.0 else (1.0 if k == 0 else 0.0)
	out[Mesh.ARRAY_BONES] = nb
	out[Mesh.ARRAY_WEIGHTS] = nw
	return out


## Only the vertices a level uses, renumbered (a level keeps its own small vertex buffer).
func _compact(arr: Array, indices: PackedInt32Array) -> Array:
	var pos: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	var remap := PackedInt32Array()
	remap.resize(pos.size())
	remap.fill(-1)
	var order := PackedInt32Array()
	var ni := PackedInt32Array()
	ni.resize(indices.size())
	for i in indices.size():
		var v := indices[i]
		if remap[v] < 0:
			remap[v] = order.size()
			order.append(v)
		ni[i] = remap[v]
	var out := []
	out.resize(Mesh.ARRAY_MAX)
	var p := PackedVector3Array()
	var n := PackedVector3Array()
	var uv := PackedVector2Array()
	var b := PackedInt32Array()
	var w := PackedFloat32Array()
	var sn: PackedVector3Array = arr[Mesh.ARRAY_NORMAL]
	var suv: PackedVector2Array = arr[Mesh.ARRAY_TEX_UV]
	var sb: PackedInt32Array = arr[Mesh.ARRAY_BONES]
	var sw: PackedFloat32Array = arr[Mesh.ARRAY_WEIGHTS]
	for v in order:
		p.append(pos[v])
		n.append(sn[v])
		uv.append(suv[v])
		for k in 4:
			b.append(sb[v * 4 + k])
			w.append(sw[v * 4 + k])
	out[Mesh.ARRAY_VERTEX] = p
	out[Mesh.ARRAY_NORMAL] = n
	out[Mesh.ARRAY_TEX_UV] = uv
	out[Mesh.ARRAY_BONES] = b
	out[Mesh.ARRAY_WEIGHTS] = w
	out[Mesh.ARRAY_INDEX] = ni
	return out


## Every vertex skinned to the skeleton's rest pose (skeleton space): the T pose the clips start from.
func _skinned_rest(arr: Array, skin: Skin, sk: Skeleton3D) -> PackedVector3Array:
	var mats := []
	for bi in skin.get_bind_count():
		var bone := sk.find_bone(skin.get_bind_name(bi)) if skin.get_bind_name(bi) != &"" else skin.get_bind_bone(bi)
		mats.append(sk.get_bone_global_rest(bone) * skin.get_bind_pose(bi))
	var pos: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	var bones: PackedInt32Array = arr[Mesh.ARRAY_BONES]
	var weights: PackedFloat32Array = arr[Mesh.ARRAY_WEIGHTS]
	var out := PackedVector3Array()
	out.resize(pos.size())
	for v in pos.size():
		var p := Vector3.ZERO
		for k in 4:
			var w := weights[v * 4 + k]
			if w > 0.0:
				p += (mats[bones[v * 4 + k]] as Transform3D) * pos[v] * w
		out[v] = p
	return out


## The base colour as a 2048 px mipmapped S3TC texture, saved next to the scene.
func _albedo(id: String, m: Material) -> Texture2D:
	var t: Texture2D = null
	if m is BaseMaterial3D:
		t = (m as BaseMaterial3D).albedo_texture
	if t == null:
		return null
	var img := t.get_image()
	if img == null:
		return null
	if img.is_compressed():
		img.decompress()
	img.convert(Image.FORMAT_RGBA8)
	if img.get_width() != TEX_SIZE:
		img.resize(TEX_SIZE, TEX_SIZE, Image.INTERPOLATE_LANCZOS)
	if not img.detect_alpha():
		img.convert(Image.FORMAT_RGB8)
	img.generate_mipmaps()
	var ct := PortableCompressedTexture2D.new()
	ct.keep_compressed_buffer = true
	ct.create_from_image(img, PortableCompressedTexture2D.COMPRESSION_MODE_S3TC)
	var path := OUT + "lead_%s_albedo.res" % id
	if ResourceSaver.save(ct, path) != OK:
		return null
	print("lead %s: texture %dx%d from %dx%d" % [id, img.get_width(), img.get_height(), t.get_width(), t.get_height()])
	return load(path) as Texture2D


## Text to 3D models can join the two legs (trousers fused between the knees, a base slab under the shoes) and the
## auto rig then weights that cloth to both legs: it stretches into sheets the moment the legs part. Below the crotch
## (the lower hip joint, rest pose) each vertex follows only the leg of its own side (the other leg's weights go to
## the same bone of its side), and a triangle with corners on both sides of the middle, 8 cm or more under the
## crotch, is removed (it could only stretch). Answers (vertices reweighted, triangles removed).
func _split_legs(arr: Array, skin: Skin, sk: Skeleton3D, rest: PackedVector3Array) -> Vector2i:
	var crotch := minf(sk.get_bone_global_rest(sk.find_bone("LeftUpperLeg")).origin.y,
		sk.get_bone_global_rest(sk.find_bone("RightUpperLeg")).origin.y)
	var mid := (sk.get_bone_global_rest(sk.find_bone("LeftUpperLeg")).origin.x
		+ sk.get_bone_global_rest(sk.find_bone("RightUpperLeg")).origin.x) * 0.5
	# bind index of each leg bone, and its counterpart on the other side
	var leg_bind := {}
	for bi in skin.get_bind_count():
		leg_bind[String(skin.get_bind_name(bi))] = bi
	var swap := {}
	for b in ["UpperLeg", "LowerLeg", "Foot", "Toes"]:
		if leg_bind.has("Left" + b) and leg_bind.has("Right" + b):
			swap[leg_bind["Left" + b]] = [leg_bind["Right" + b], "Left"]
			swap[leg_bind["Right" + b]] = [leg_bind["Left" + b], "Right"]
	var bones: PackedInt32Array = arr[Mesh.ARRAY_BONES]
	var weights: PackedFloat32Array = arr[Mesh.ARRAY_WEIGHTS]
	var moved := 0
	for v in rest.size():
		if rest[v].y >= crotch:
			continue
		var side := "Left" if rest[v].x > mid else "Right"
		var changed := false
		for k in 4:
			var bi := bones[v * 4 + k]
			if weights[v * 4 + k] > 0.0 and swap.has(bi) and swap[bi][1] != side:
				bones[v * 4 + k] = int(swap[bi][0])
				changed = true
		if changed:
			moved += 1
			# merge duplicate bones after the swap
			for a in 4:
				for b in range(a + 1, 4):
					if bones[v * 4 + a] == bones[v * 4 + b] and weights[v * 4 + b] > 0.0:
						weights[v * 4 + a] += weights[v * 4 + b]
						weights[v * 4 + b] = 0.0
	arr[Mesh.ARRAY_BONES] = bones
	arr[Mesh.ARRAY_WEIGHTS] = weights
	var ix: PackedInt32Array = arr[Mesh.ARRAY_INDEX]
	var out := PackedInt32Array()
	var cut := 0
	for t in ix.size() / 3:
		var m := 0
		for c in 3:
			var p := rest[ix[t * 3 + c]]
			if p.y < crotch - 0.08:
				m |= 1 if p.x > mid else 2
		if m == 3:
			cut += 1
			continue
		for c in 3:
			out.append(ix[t * 3 + c])
	arr[Mesh.ARRAY_INDEX] = out
	return Vector2i(moved, cut)


## The bone chains whose direction the clips' rotations act on, parent first: each bone and the child it points at.
const CHAINS := [["Spine", "Chest"], ["Chest", "UpperChest"], ["UpperChest", "Neck"], ["Neck", "Head"],
	["LeftShoulder", "LeftUpperArm"], ["LeftUpperArm", "LeftLowerArm"], ["LeftLowerArm", "LeftHand"],
	["RightShoulder", "RightUpperArm"], ["RightUpperArm", "RightLowerArm"], ["RightLowerArm", "RightHand"],
	["LeftUpperLeg", "LeftLowerLeg"], ["LeftLowerLeg", "LeftFoot"], ["RightUpperLeg", "RightLowerLeg"], ["RightLowerLeg", "RightFoot"]]


## The clips set absolute local rotations in the profile's bone frames, so a pose comes out the same on two skeletons
## only when each bone points at its child the same way in its own frame. The import's silhouette fix gives the
## profile's reference T, not the library mannequin's rest (its clavicles, arms and legs sit a few degrees apart):
## played on that, every clip shrugs the shoulders, pins the upper arms and splays the forearms. So the model is posed
## into the mannequin's rest (each chain bone turned, parent first, until it points where the mannequin's does), the
## mesh is skinned into that pose, and the pose becomes the new rest with the bone frames unchanged (only the joint
## positions move). Answers the degrees each chain bone turned.
func _match_silhouette(sk: Skeleton3D, skin: Skin, arr: Array, msk: Skeleton3D) -> Dictionary:
	sk.reset_bone_poses()
	var turned := {}
	for pair in CHAINS:
		var b := sk.find_bone(pair[0])
		var c := sk.find_bone(pair[1])
		var mb := msk.find_bone(pair[0])
		var mc := msk.find_bone(pair[1])
		if b < 0 or c < 0 or mb < 0 or mc < 0:
			continue
		sk.force_update_all_bone_transforms()
		var g := sk.get_bone_global_pose(b)
		var d_lead := (sk.get_bone_global_pose(c).origin - g.origin).normalized()
		var d_man := (msk.get_bone_global_rest(mc).origin - msk.get_bone_global_rest(mb).origin).normalized()
		var ang := d_lead.angle_to(d_man)
		turned[pair[0]] = snappedf(rad_to_deg(ang), 0.1)
		if ang < 1e-4:
			continue
		var q := Quaternion(d_lead, d_man)
		var ng := Basis(q) * g.basis
		var par := sk.get_bone_parent(b)
		var pg := sk.get_bone_global_pose(par).basis if par >= 0 else Basis.IDENTITY
		sk.set_bone_pose_rotation(b, (pg.inverse() * ng).get_rotation_quaternion())
	_bake_pose(sk, skin, arr)
	return turned


## Skins the mesh into the skeleton's current pose and makes that pose the rest, keeping each bone's rest frame (the
## basis: the profile's convention the clips rely on) and moving only the joints. `scale_bone` (a leaf: the head) is
## scaled by `scale` about its joint into the mesh.
func _bake_pose(sk: Skeleton3D, skin: Skin, arr: Array, scale_bone := -1, scale := 1.0) -> void:
	sk.force_update_all_bone_transforms()
	# skin the mesh into the pose
	var posed := []
	var rest_g := []
	for i in sk.get_bone_count():
		var g := sk.get_bone_global_pose(i)
		if i == scale_bone:
			g = Transform3D(g.basis * Basis.from_scale(Vector3.ONE * scale), g.origin)
		posed.append(g)
		rest_g.append(sk.get_bone_global_rest(i))
	var mats := []
	var bone_of := []
	for bi in skin.get_bind_count():
		var bone := sk.find_bone(skin.get_bind_name(bi))
		bone_of.append(bone)
		mats.append((posed[bone] as Transform3D) * skin.get_bind_pose(bi))
	var pos: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	var nrm: PackedVector3Array = arr[Mesh.ARRAY_NORMAL]
	var bones: PackedInt32Array = arr[Mesh.ARRAY_BONES]
	var weights: PackedFloat32Array = arr[Mesh.ARRAY_WEIGHTS]
	for v in pos.size():
		var p := Vector3.ZERO
		var n := Vector3.ZERO
		for k in 4:
			var w := weights[v * 4 + k]
			if w > 0.0:
				var m: Transform3D = mats[bones[v * 4 + k]]
				p += m * pos[v] * w
				n += m.basis * nrm[v] * w
		pos[v] = p
		nrm[v] = n.normalized() if n.length_squared() > 0.0 else nrm[v]
	arr[Mesh.ARRAY_VERTEX] = pos
	arr[Mesh.ARRAY_NORMAL] = nrm
	# the pose is the new rest: the bone frames stay, the joints move
	var new_g := []
	for i in sk.get_bone_count():
		new_g.append(Transform3D((rest_g[i] as Transform3D).basis, (posed[i] as Transform3D).origin))
	for i in sk.get_bone_count():
		var par := sk.get_bone_parent(i)
		var local: Transform3D = new_g[i] if par < 0 else (new_g[par] as Transform3D).affine_inverse() * (new_g[i] as Transform3D)
		sk.set_bone_rest(i, local)
	for bi in skin.get_bind_count():
		skin.set_bind_pose(bi, (new_g[bone_of[bi]] as Transform3D).affine_inverse())
	sk.reset_bone_poses()


## Text to 3D heads come out large (stylised). The head is scaled about its joint until the crown to neck joint length
## is the same share of the height as on the library mannequin of the same build (real adult proportions, about 7.5
## heads), never larger and at most 8 percent smaller (hair and a bun count in the crown). Answers the scale used.
func _fit_head(sk: Skeleton3D, skin: Skin, arr: Array, msk: Skeleton3D, m_height: float) -> float:
	var rest := _skinned_rest(arr, skin, sk)
	var top := -1e9
	var bottom := 1e9
	for p in rest:
		top = maxf(top, p.y)
		bottom = minf(bottom, p.y)
	var neck_y := sk.get_bone_global_rest(sk.find_bone("Neck")).origin.y
	var head_y := sk.get_bone_global_rest(sk.find_bone("Head")).origin.y
	var r := (m_height - msk.get_bone_global_rest(msk.find_bone("Neck")).origin.y) / m_height
	var h := top - bottom
	var l := top - neck_y
	var want := r * (h - l) / (1.0 - r)
	var f := clampf((want - (head_y - neck_y)) / (top - head_y), 0.92, 1.0)
	if f < 0.995:
		sk.reset_bone_poses()
		# (a bone pose scale does not reach get_bone_global_pose here, so the bake scales the leaf head itself)
		_bake_pose(sk, skin, arr, sk.find_bone("Head"), f)
		var top2 := -1e9
		for p in _skinned_rest(arr, skin, sk):
			top2 = maxf(top2, p.y)
		print("lead head: crown to neck %.4f -> %.4f (want %.4f)" % [l, top2 - sk.get_bone_global_rest(sk.find_bone("Neck")).origin.y, want])
	return f


## Every length times `f` (rests, bind poses, vertices); rotations and normals stay.
func _rescale(sk: Skeleton3D, skin: Skin, arr: Array, f: float) -> void:
	for i in sk.get_bone_count():
		var r := sk.get_bone_rest(i)
		sk.set_bone_rest(i, Transform3D(r.basis, r.origin * f))
	sk.reset_bone_poses()
	for bi in skin.get_bind_count():
		var b := skin.get_bind_pose(bi)
		skin.set_bind_pose(bi, Transform3D(b.basis, b.origin * f))
	var pos: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
	for v in pos.size():
		pos[v] *= f
	arr[Mesh.ARRAY_VERTEX] = pos


## The rest height (soles to the top of the head, T pose) and the sole of each foot (heel and ball points in the foot
## bone's frame, as loco_kit.gd finds them on the mannequin) from the vertices that follow the foot and the toes most.
func _measure(id: String, units: float, sk: Skeleton3D, rest_pos: PackedVector3Array, arr: Array, skin: Skin) -> Dictionary:
	var top := -1e9
	var bottom := 1e9
	var foot_bones := {}
	for side in SIDES:
		foot_bones[sk.find_bone(side + "Foot")] = side
		foot_bones[sk.find_bone(side + "Toes")] = side
	var bones: PackedInt32Array = arr[Mesh.ARRAY_BONES]
	var weights: PackedFloat32Array = arr[Mesh.ARRAY_WEIGHTS]
	var min_y := {"Left": 1e9, "Right": 1e9}
	var min_z := {"Left": 1e9, "Right": 1e9}
	for v in rest_pos.size():
		var p := rest_pos[v]
		top = maxf(top, p.y)
		bottom = minf(bottom, p.y)
		var bi := bones[v * 4]
		var bone := sk.find_bone(skin.get_bind_name(bi)) if skin.get_bind_name(bi) != &"" else skin.get_bind_bone(bi)
		if foot_bones.has(bone) and weights[v * 4] > 0.5:
			var side: String = foot_bones[bone]
			min_y[side] = minf(min_y[side], p.y)
			min_z[side] = minf(min_z[side], p.z)
	var sole := {}
	for side in SIDES:
		if min_y[side] > 1e8:
			return {"error": "%s: no %s foot vertices" % [id, side]}
		var foot := sk.get_bone_global_rest(sk.find_bone(side + "Foot"))
		var toes := sk.get_bone_global_rest(sk.find_bone(side + "Toes")).origin
		var heel_z: float = float(min_z[side]) + 0.03
		sole[side + "Heel"] = foot.affine_inverse() * Vector3(foot.origin.x, float(min_y[side]), heel_z)
		sole[side + "Ball"] = foot.affine_inverse() * Vector3(toes.x, float(min_y[side]), toes.z)
		sole["len"] = toes.z - heel_z
		sole["ankle"] = foot.origin.y - float(min_y[side])
	# heads tall: the height over the crown to the chin; the chin is taken a fifth of the head's length under the
	# neck joint (crown to neck joint is about 1.2 heads on a real adult and on the library mannequin alike)
	var neck_y := sk.get_bone_global_rest(sk.find_bone("Neck")).origin.y
	var heads := (top - bottom) / ((top - neck_y) / 1.2)
	return {"rest_height": snappedf(top - bottom, 0.0001), "rest_bottom": snappedf(bottom, 0.0001),
		"units": snappedf(units, 0.0001), "sole": sole, "heads": snappedf(heads, 0.01),
		"shoulder_width": snappedf(absf(sk.get_bone_global_rest(sk.find_bone("LeftUpperArm")).origin.x
			- sk.get_bone_global_rest(sk.find_bone("RightUpperArm")).origin.x) / (top - bottom), 0.001)}
