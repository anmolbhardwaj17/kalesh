## The Mixamo clips of the leads (P2-072): every clip the owner downloaded, by name, converted by
## tools/characters/mixamo_build.mjs into rig/mixamo/<category>.res, with data/mixamo_clips.json listing them (category,
## length, loop, root motion, turn). The leads are rigged by Mixamo and share the profile frames of the import, so a
## clip turns each bone from its rest as Mixamo plays it; only a lead's limbs are aimed at the source skeleton's
## directions (lead_library(): a model's legs and arms stand a few degrees off the source's at rest, and a clip played
## as it is then straddles with the elbows out). Root motion, where a clip has it, is on the Root bone (the hips keep
## their first ground position). The leads' everyday set (idle, gaits, picks) is built offline into rig/mx_<id>.res
## (characters/tools/mixamo_lead.gd); this file serves the rest by category for later systems (combat, climbing,
## swimming, driving, injured, actions).
extends RefCounted

const Retarget := preload("res://characters/tools/lead_retarget.gd")
const INDEX := "res://data/mixamo_clips.json"
const LIB := "res://characters/rig/mixamo/%s.res"
const P := "%GeneralSkeleton:"

static var _index := {}
static var _by_name := {}
static var _libs := {}
static var _lead_libs := {}


## data/mixamo_clips.json: {source, count, clips: [{name, category, file, length, loop, root_m, turn_deg}]}.
static func index() -> Dictionary:
	if _index.is_empty() and FileAccess.file_exists(INDEX):
		_index = JSON.parse_string(FileAccess.get_file_as_string(INDEX))
		for c in _index.get("clips", []):
			_by_name[c.name] = c
	return _index


## Every clip name, in the order of the index (category, then file name).
static func names() -> PackedStringArray:
	var out := PackedStringArray()
	for c in index().get("clips", []):
		out.append(c.name)
	return out


static func categories() -> PackedStringArray:
	var out := PackedStringArray()
	for c in index().get("clips", []):
		if not out.has(c.category):
			out.append(c.category)
	return out


## The index entry of a clip ({} when there is none).
static func info(name: String) -> Dictionary:
	index()
	return _by_name.get(name, {})


## The shared library of a category (the clips as the source skeleton plays them).
static func library(category: String) -> AnimationLibrary:
	if not _libs.has(category):
		var p := LIB % category
		_libs[category] = load(p) if ResourceLoader.exists(p) else null
	return _libs[category]


## One clip as the source skeleton plays it (null when there is none).
static func clip(name: String) -> Animation:
	var c := info(name)
	if c.is_empty():
		return null
	var lib := library(str(c.category))
	return lib.get_animation(name) if lib != null and lib.has_animation(name) else null


## The turn of each limb of skeleton `sk` onto the source skeleton's direction (lead_retarget.gd's limbs), and the
## degrees: {q: {bone: Quaternion}, deg: {bone: float}}.
static func aims(sk: Skeleton3D) -> Dictionary:
	var off: Dictionary = index().get("source", {}).get("offsets", {})
	var q := {}
	var deg := {}
	for pair in Retarget.AIMED:
		var b := sk.find_bone(pair[0])
		var c := sk.find_bone(pair[1])
		if b < 0 or c < 0 or not off.has(pair[1]):
			continue
		var o: Array = off[pair[1]]
		var d_src := Vector3(o[0], o[1], o[2]).normalized()
		var d_lead := sk.get_bone_rest(c).origin.normalized()
		if d_lead.angle_to(d_src) < 1e-4:
			continue
		q[pair[0]] = Quaternion(d_lead, d_src)
		deg[pair[0]] = snappedf(rad_to_deg(d_lead.angle_to(d_src)), 0.1)
	return {"q": q, "deg": deg}


## A library of clips for a lead's skeleton: the limbs aimed (aims()) and the hips' travel scaled from hip heights to
## the lead's own hip height. Cached per lead and category (the first call of a category costs a few ms per clip).
static func lead_library(id: String, category: String, sk: Skeleton3D) -> AnimationLibrary:
	var key := id + "/" + category
	if not _lead_libs.has(key):
		var lib := library(category)
		_lead_libs[key] = for_skeleton(lib, sk) if lib != null else null
	return _lead_libs[key]


## `lib` fitted to skeleton `sk` (see lead_library()).
static func for_skeleton(lib: AnimationLibrary, sk: Skeleton3D) -> AnimationLibrary:
	var out := Retarget.retarget(lib, sk, aims(sk).q)
	var h := sk.get_bone_rest(sk.find_bone("Hips")).origin.y
	for n in out.get_animation_list():
		scale_positions(out.get_animation(n), h)
	return out


## Scales the position tracks (hips and root, in hip heights) of `a` to metres of a skeleton whose hips stand `h` high.
static func scale_positions(a: Animation, h: float) -> void:
	for t in a.get_track_count():
		if a.track_get_type(t) != Animation.TYPE_POSITION_3D:
			continue
		for k in a.track_get_key_count(t):
			a.track_set_key_value(t, k, (a.track_get_key_value(t, k) as Vector3) * h)
