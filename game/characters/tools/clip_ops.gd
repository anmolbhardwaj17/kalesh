## Clip operations of the Mixamo lead build (P2-072, characters/tools/mixamo_lead.gd; offline, never loaded by the
## game): a held pose, an additive copy, a left to right mirror. Tracks are on the humanoid profile ("%GeneralSkeleton:").
extends RefCounted

const P := "%GeneralSkeleton:"
## Keys a second of a mirrored clip (the source's own rate).
const SRC_FPS := 30.0


## A one pose loop of `a` at time `t` (a held pose: the carrying arms).
static func still(a: Animation, t: float) -> Animation:
	var out := Animation.new()
	out.length = 1.0
	out.loop_mode = Animation.LOOP_LINEAR
	for i in a.get_track_count():
		var ty := a.track_get_type(i)
		var o := out.add_track(ty)
		out.track_set_path(o, a.track_get_path(i))
		if ty == Animation.TYPE_ROTATION_3D:
			out.rotation_track_insert_key(o, 0.0, a.rotation_track_interpolate(i, t))
		else:
			out.position_track_insert_key(o, 0.0, a.position_track_interpolate(i, t))
	return out


## An additive copy of `a`: every rotation key becomes rest * first^-1 * key, every position rest + key - first, so
## an AnimationNodeAdd2 lays only the change from the clip's first pose over whatever the body plays (Godot adds each
## input as rest^-1 * value).
static func additive(a: Animation, sk: Skeleton3D) -> Animation:
	var out := a.duplicate(true) as Animation
	for t in out.get_track_count():
		var bone := sk.find_bone(String(out.track_get_path(t)).trim_prefix(P))
		if bone < 0 or out.track_get_key_count(t) == 0:
			continue
		var rest := sk.get_bone_rest(bone)
		if out.track_get_type(t) == Animation.TYPE_ROTATION_3D:
			var q0: Quaternion = out.track_get_key_value(t, 0)
			var r := rest.basis.get_rotation_quaternion()
			for i in out.track_get_key_count(t):
				out.track_set_key_value(t, i, (r * q0.inverse() * (out.track_get_key_value(t, i) as Quaternion)).normalized())
		elif out.track_get_type(t) == Animation.TYPE_POSITION_3D:
			var p0: Vector3 = out.track_get_key_value(t, 0)
			for i in out.track_get_key_count(t):
				out.track_set_key_value(t, i, rest.origin + (out.track_get_key_value(t, i) as Vector3) - p0)
	return out


## `a` mirrored left to right on skeleton `sk` (a left turn into a right turn). Each bone's turn from its rest in
## skeleton space, D = G * R^-1, is reflected across the body's middle plane (x -> -x: a quaternion (x, y, z, w) turns
## into (x, -y, -z, w)) and given to its mirror bone: G'(m(b)) = M(D(b)) * R(m(b)); the local keys follow from the
## parents. Positions (hips, root) flip x. Every bone of the result gets a track at SRC_FPS.
static func mirror(a: Animation, sk: Skeleton3D) -> Animation:
	var n := sk.get_bone_count()
	var names := []
	var rest_g := []
	for i in n:
		names.append(String(sk.get_bone_name(i)))
		rest_g.append(sk.get_bone_global_rest(i).basis.get_rotation_quaternion())
	var mirror_of := []
	for i in n:
		var nm: String = names[i]
		var other := nm.replace("Left", "#").replace("Right", "Left").replace("#", "Right")
		var j := sk.find_bone(other)
		mirror_of.append(j if j >= 0 else i)
	var tracks := {}
	for t in a.get_track_count():
		if a.track_get_type(t) == Animation.TYPE_ROTATION_3D:
			tracks[sk.find_bone(String(a.track_get_path(t)).trim_prefix(P))] = t
	var out := Animation.new()
	out.length = a.length
	out.loop_mode = a.loop_mode
	var otr := []
	for i in n:
		var o := out.add_track(Animation.TYPE_ROTATION_3D)
		out.track_set_path(o, NodePath(P + names[i]))
		otr.append(o)
	var nk := int(round(a.length * SRC_FPS))
	for kk in nk + 1:
		var tm := minf(float(kk) / SRC_FPS, a.length)
		var g := []
		g.resize(n)
		for i in n:
			var l: Quaternion = a.rotation_track_interpolate(tracks[i], tm) if tracks.has(i) else sk.get_bone_rest(i).basis.get_rotation_quaternion()
			var p := sk.get_bone_parent(i)
			g[i] = (g[p] * l) if p >= 0 else l
		var gm := []
		gm.resize(n)
		for i in n:
			var src_b: int = mirror_of[i]
			var d: Quaternion = (g[src_b] as Quaternion) * (rest_g[src_b] as Quaternion).inverse()
			gm[i] = Quaternion(d.x, -d.y, -d.z, d.w) * (rest_g[i] as Quaternion)
		for i in n:
			var p := sk.get_bone_parent(i)
			var l: Quaternion = ((gm[p] as Quaternion).inverse() * gm[i]) if p >= 0 else gm[i]
			out.rotation_track_insert_key(otr[i], tm, l.normalized())
	for t in a.get_track_count():
		if a.track_get_type(t) != Animation.TYPE_POSITION_3D:
			continue
		var o := out.add_track(Animation.TYPE_POSITION_3D)
		out.track_set_path(o, a.track_get_path(t))
		for kk in a.track_get_key_count(t):
			var v: Vector3 = a.track_get_key_value(t, kk)
			out.position_track_insert_key(o, a.track_get_key_time(t, kk), Vector3(-v.x, v.y, v.z))
	return out
