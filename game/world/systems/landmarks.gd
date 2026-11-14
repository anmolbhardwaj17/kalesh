## The streamed landmarks of the city (P2-007): every placed landmark with a kit recipe (the landmark file's `kit`,
## game/world/tiles/landmarks.json) is built by the parts kit (game/world/landmarks/) on a worker thread when the city
## starts, then shown as its LOD chain: one MeshInstance3D per part and level with Godot visibility ranges that
## cross-fade (fade mode self, the margin a tenth of the switch distance), so a level change never pops. A hero's
## distances are its LOD slots and far slot from the file (350, 900, 1,800 m, far to 6 km); a signature and a marker
## get a far silhouette too (RANGES), so nothing a Delhiite names vanishes at 700 m. At most
## limits.heroesAtFullDetailInView heroes show level 0 at once (game/world/landmark_slots.gd picks them). The far
## landmarks of the backdrop show their baked silhouettes. A delivered hero model (public/assets/manifest.json,
## models["model_lm_<id>"], landmark_model.gd) replaces the stand-in by id. Colliders: level 0's boxes and hulls on
## layer 1, the bodies in the group "landmark_kit" (city('surface') leaves them out: it checks the tile files).
extends Node3D

const KitBuild := preload("res://world/landmarks/kit_build.gd")
const LandmarkModel := preload("res://world/landmarks/landmark_model.gd")
const LandmarkSlots := preload("res://world/landmark_slots.gd")
const Kit := preload("res://scenes/standin/kit.gd")
const HAZE_SHADER := preload("res://world/landmarks/landmark_haze.gdshader")
## The haze ceiling of the skyline material (landmark_haze.gdshader): past the distance where the scene fog reaches
## it, a landmark stays a pale silhouette. Level 0 keeps the look's own materials and fog.
const HAZE_CAP := 0.75
const HAZE_EVERY_S := 0.5

## Level distances (m) of the tiers without far slots in the file: [from, to] for levels 0, 1, 2 and the far one.
const RANGES := {
	"signature": [[0.0, 180.0], [180.0, 700.0], [700.0, 1500.0], [1500.0, 3200.0]],
	"marker": [[0.0, 250.0], [250.0, 700.0], [700.0, 1200.0], [1200.0, 2500.0]],
}
## The fade band of a switch, as a share of its distance.
const FADE := 0.1
## Wear (the look's grime mask) per recipe, from the area sheets: the Red Fort's soot-darkened walls, India Gate kept
## clean (STYLE_BIBLE.md "Landmark tiers").
const WEAR := {"red_fort": 0.35, "jama_masjid": 0.3, "cp_circle": 0.15, "india_gate": 0.03, "canopy": 0.05}
## Parts whose level 0 gets the night uplight of the look (its decorate() lights meshes named Landmark_*).
const LIT := ["gate", "gate0", "gate1", "masjid", "canopy"]
const CAP_EVERY_S := 0.25

var index: RefCounted = null
## id -> {lm, task, result, nodes: [[MeshInstance3D per part] per level], body, built, source, ms}
var entries := {}
var far_nodes: Array = []
var materials := {}
var shown := true
var _mutex := Mutex.new()
var _results := {}
var _since := 0.0
var _haze_since := 1e9
## The skyline material of levels 1 to 3 and the far landmarks (named so the style runner keeps it).
var haze: ShaderMaterial = null
var _we: Node = null


## `build` false lists the kit landmarks without building them (streaming tests count the engine's objects).
func setup(tile_index: RefCounted, build := true) -> void:
	index = tile_index
	name = "Landmarks"
	materials = Kit.materials()
	haze = ShaderMaterial.new()
	haze.shader = HAZE_SHADER
	haze.resource_name = "landmark_haze"
	haze.set_shader_parameter("cap", HAZE_CAP)
	for lm: Dictionary in index.landmarks:
		if not KitBuild.has_recipe(lm):
			continue
		var id := str(lm.id)
		var e := {"lm": lm, "task": -1, "built": false, "nodes": [], "body": null, "source": "kit", "result": {}}
		entries[id] = e
		var model := LandmarkModel.find(id)
		if model != "":
			e.source = "model"
			e["model"] = model
			continue
		if not build:
			continue
		var copy: Dictionary = lm.duplicate(true)
		e.task = WorkerThreadPool.add_task(_build_on_worker.bind(id, copy), false, "landmark %s" % id)


func _ready() -> void:
	_far_silhouettes()
	for id: String in entries:
		if entries[id].source == "model":
			_attach_model(id)


func _exit_tree() -> void:
	for id: String in entries:
		var t: int = entries[id].task
		if t >= 0:
			WorkerThreadPool.wait_for_task_completion(t)
			entries[id].task = -1


func _build_on_worker(id: String, lm: Dictionary) -> void:
	var r := KitBuild.build(lm)
	_mutex.lock()
	_results[id] = r
	_mutex.unlock()


func _process(delta: float) -> void:
	_collect()
	_haze_since += delta
	if _haze_since >= HAZE_EVERY_S:
		_haze_since = 0.0
		_follow_fog()
	_since += delta
	if _since >= CAP_EVERY_S:
		_since = 0.0
		_keep_cap()


## Main thread: turns finished builds into nodes.
func _collect() -> void:
	_mutex.lock()
	var done := _results.duplicate()
	_results.clear()
	_mutex.unlock()
	for id: String in done:
		var e: Dictionary = entries[id]
		if e.task >= 0:
			WorkerThreadPool.wait_for_task_completion(e.task)
			e.task = -1
		e.result = done[id]
		_attach(id)


func _ranges(lm: Dictionary) -> Array:
	var lod: Dictionary = lm.get("lod", {})
	var slots: Array = lod.get("slots", [])
	if str(lm.get("tier", "")) == "hero" and slots.size() >= 3 and lod.get("far") is Dictionary:
		var out := []
		for k in 3:
			out.append([float(slots[k].fromM), float(slots[k].toM)])
		out.append([float(lod.far.fromM), float(lod.far.toM)])
		return out
	return RANGES.get(str(lm.get("tier", "")), RANGES.marker)


func _attach(id: String) -> void:
	var e: Dictionary = entries[id]
	var r: Dictionary = e.result
	var lm: Dictionary = e.lm
	var root := Node3D.new()
	root.name = "LM_%s" % id
	root.position = Vector3(float(lm.pos[0]), float(lm.pos[1]), float(lm.pos[2]))
	add_child(root)
	var ranges := _ranges(lm)
	var levels: Array = r.get("levels", [])
	e.nodes = []
	for lod in levels.size():
		var row := []
		var parts: Dictionary = levels[lod].parts
		for part: String in parts:
			var mesh := ArrayMesh.new()
			var keys: Array = parts[part].keys()
			keys.sort()
			for k: String in keys:
				mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, parts[part][k])
				mesh.surface_set_material(mesh.get_surface_count() - 1, materials.get(k, materials["matte"]) if lod == 0 or k == "glow" else haze)
			var mi := MeshInstance3D.new()
			if lod == 0 and part in LIT:
				mi.name = "Landmark_%s_%s" % [id, part]
			else:
				mi.name = "LM_%s_%s_l%d" % [id, part, lod]
			mi.mesh = mesh
			# a part's distance is measured to the middle of its box: a long one (a stretch of the Red Fort's wall, a
			# wedge of the Connaught Place ring) starts its ranges later by half its width, so its near end keeps detail
			var box := mesh.get_aabb()
			_set_range(mi, ranges, lod, Vector2(box.size.x, box.size.z).length() * 0.5 if box.size.length() > 120.0 else 0.0)
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if lod <= 1 else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			mi.set_meta("wear", WEAR.get(str(r.recipe), 0.1))
			mi.set_meta("landmark", id)
			mi.set_meta("begin", mi.visibility_range_begin)
			mi.visible = shown
			root.add_child(mi)
			row.append(mi)
		e.nodes.append(row)
	e.body = _colliders(root, r.get("colliders", []))
	e.built = true


## The visibility range of level `lod`: from its begin to its end, cross-fading over a tenth of each distance.
## Measured in the engine (P2-007 sweep through 900 m): an instance shows from begin + begin_margin to end - end_margin,
## so the set values are pushed out by their margin and two levels meet exactly at the switch distance (no gap).
static func _set_range(mi: GeometryInstance3D, ranges: Array, lod: int, reach := 0.0) -> void:
	var rg: Array = ranges[mini(lod, ranges.size() - 1)]
	var b := float(rg[0])
	var e := float(rg[1])
	mi.visibility_range_begin_margin = b * FADE
	mi.visibility_range_begin = maxf(0.0, b + reach - b * FADE) if b > 0.0 else 0.0
	mi.visibility_range_end_margin = e * FADE
	mi.visibility_range_end = e + reach + e * FADE
	mi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF


func _colliders(root: Node3D, shapes: Array) -> StaticBody3D:
	if shapes.is_empty():
		return null
	var body := StaticBody3D.new()
	body.name = "Collision"
	body.collision_layer = 1
	body.collision_mask = 0
	body.add_to_group("landmark_kit")
	for s: Dictionary in shapes:
		var cs := CollisionShape3D.new()
		if s.kind == "box":
			var b := BoxShape3D.new()
			b.size = s.size
			cs.shape = b
			cs.transform = s.xf
		else:
			var h := ConvexPolygonShape3D.new()
			h.points = s.points
			cs.shape = h
		body.add_child(cs)
	root.add_child(body)
	return body


func _attach_model(id: String) -> void:
	var e: Dictionary = entries[id]
	var lm: Dictionary = e.lm
	var node := LandmarkModel.load_model(str(e.model), _ranges(lm), FADE)
	if node == null:
		# a file that does not load leaves the stand-in in charge
		push_warning("landmark %s: model %s did not load, building the stand-in" % [id, e.model])
		e.source = "kit"
		e.task = WorkerThreadPool.add_task(_build_on_worker.bind(id, lm.duplicate(true)), false, "landmark %s" % id)
		return
	node.name = "LM_%s" % id
	node.position = Vector3(float(lm.pos[0]), float(lm.pos[1]), float(lm.pos[2]))
	if lm.get("yaw") != null:
		node.rotation.y = -deg_to_rad(float(lm.yaw))
	add_child(node)
	e.nodes = LandmarkModel.levels_of(node)
	e.result = {"recipe": "model", "heightM": LandmarkModel.height_of(node), "heightPart": "the model's top", "topM": LandmarkModel.height_of(node), "levels": []}
	e.built = true


## The far landmarks of the backdrop: their baked silhouettes (never reachable, never a destination).
func _far_silhouettes() -> void:
	for f: Dictionary in index.far_landmarks:
		var si := int(f.get("silhouette", -1))
		if si < 0 or si >= index.silhouettes.size():
			continue
		var s: Dictionary = index.silhouettes[si]
		var pos: Array = s.pos
		var verts := PackedVector3Array()
		var norms := PackedVector3Array()
		var cols := PackedColorArray()
		var col := Color("#c9b49a")
		for k in range(0, pos.size() - 8, 9):
			var a := Vector3(pos[k], pos[k + 1], pos[k + 2])
			var b := Vector3(pos[k + 3], pos[k + 4], pos[k + 5])
			var c := Vector3(pos[k + 6], pos[k + 7], pos[k + 8])
			var n := (c - a).cross(b - a).normalized()
			verts.append_array([a, b, c])
			norms.append_array([n, n, n])
			cols.append_array([col, col, col])
		if verts.is_empty():
			continue
		var arr := []
		arr.resize(Mesh.ARRAY_MAX)
		arr[Mesh.ARRAY_VERTEX] = verts
		arr[Mesh.ARRAY_NORMAL] = norms
		arr[Mesh.ARRAY_COLOR] = cols
		var mesh := ArrayMesh.new()
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
		mesh.surface_set_material(0, haze)
		var mi := MeshInstance3D.new()
		mi.name = "LM_far_%s" % f.id
		mi.mesh = mesh
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.position = Vector3(float(s.origin[0]), float(s.origin[1]), float(s.origin[2]))
		mi.set_meta("landmark", str(f.id))
		add_child(mi)
		far_nodes.append(mi)


## The skyline material follows the scene's fog (its colour and density change with the light and the clock).
func _follow_fog() -> void:
	if not is_inside_tree():
		return
	var env: Environment = get_viewport().world_3d.environment if get_viewport().world_3d != null else null
	if env == null:
		if _we == null or not is_instance_valid(_we):
			var found := get_tree().root.find_children("*", "WorldEnvironment", true, false)
			_we = found[0] if not found.is_empty() else null
		if _we != null:
			env = (_we as WorldEnvironment).environment
	if env == null:
		return
	var c := env.fog_light_color * env.fog_light_energy
	haze.set_shader_parameter("fog_color", Color(c.r, c.g, c.b))
	haze.set_shader_parameter("fog_density", env.fog_density if env.fog_enabled else 0.0)


## Keeps the cap on heroes at full detail: a hero past the cap shows level 1 where it would show level 0.
func _keep_cap() -> void:
	var cam := get_viewport().get_camera_3d() if is_inside_tree() else null
	if cam == null or index == null:
		return
	var plan: Array = LandmarkSlots.plan(index.landmarks, index.landmark_limits, cam.global_position)
	var capped := {}
	for p: Dictionary in plan:
		if p.tier == "hero" and int(p.level) == 1 and LandmarkSlots.level_at(_lod_of(p.id), float(p.distance)) == 0:
			capped[p.id] = true
	for id: String in entries:
		var e: Dictionary = entries[id]
		if not e.built or e.source != "kit" or e.nodes.size() < 2:
			continue
		var cap: bool = capped.has(id)
		for mi: MeshInstance3D in e.nodes[0]:
			mi.visible = shown and not cap
		for mi: MeshInstance3D in e.nodes[1]:
			mi.visibility_range_begin = 0.0 if cap else float(mi.get_meta("begin", _ranges(e.lm)[1][0]))


func _lod_of(id: String) -> Dictionary:
	return entries[id].lm.get("lod", {}) if entries.has(id) else {}


## True once every kit landmark within `radius` of `at` (ground plane) is built (or has no build to wait for).
func ready_within(at: Vector3, radius: float) -> bool:
	for id: String in entries:
		var e: Dictionary = entries[id]
		var p: Array = e.lm.pos
		if Vector2(float(p[0]) - at.x, float(p[2]) - at.z).length() <= radius and not e.built:
			return false
	return true


## Waits (frames) until ready_within, at most `limit_s` of wall time.
func settle(at: Vector3, radius: float, limit_s := 20.0) -> void:
	var t0 := Time.get_ticks_msec()
	while is_inside_tree() and not ready_within(at, radius):
		if Time.get_ticks_msec() - t0 > limit_s * 1000.0:
			push_warning("landmarks: not built within %d s of the start (%s)" % [int(limit_s), building()])
			return
		await get_tree().process_frame


func building() -> Array:
	var out := []
	for id: String in entries:
		if not entries[id].built:
			out.append(id)
	return out


## Shows or hides every landmark the system draws (the perf scenario measures the landmark GPU cost this way).
func set_shown(on: bool) -> void:
	shown = on
	for id: String in entries:
		for row: Array in entries[id].nodes:
			for mi: Node in row:
				(mi as Node3D).visible = on
	for mi: Node3D in far_nodes:
		mi.visible = on
	_keep_cap()


## The debug report (city('kit')): per landmark its recipe, the built height against the registry height, triangles
## per level, parts, colliders, the level the camera sees and the respect flags.
func report(eye: Vector3) -> Dictionary:
	var out := []
	for id: String in entries:
		var e: Dictionary = entries[id]
		var lm: Dictionary = e.lm
		var r: Dictionary = e.result
		var reg = lm.get("height")
		var built := float(r.get("heightM", 0.0))
		var tris := []
		var parts := 0
		var part_max := []
		for lv: Dictionary in r.get("levels", []):
			tris.append(int(lv.triangles))
			parts = maxi(parts, (lv.parts as Dictionary).size())
			var most := 0
			for n: String in lv.get("partTriangles", {}):
				most = maxi(most, int(lv.partTriangles[n]))
			part_max.append(most)
		var p: Array = lm.pos
		var d := Vector2(float(p[0]) - eye.x, float(p[2]) - eye.z).length()
		var ranges := _ranges(lm)
		var level := -2
		for k in ranges.size():
			if d >= float(ranges[k][0]) and d < float(ranges[k][1]):
				level = k if k < 3 else -1
				break
		out.append({
			"id": id, "tier": lm.get("tier", ""), "recipe": r.get("recipe", ""), "source": e.source, "built": e.built,
			"pos": p, "registryHeightM": reg, "heightM": snappedf(built, 0.01), "heightPart": r.get("heightPart", ""), "topM": snappedf(float(r.get("topM", 0.0)), 0.01),
			"heightErrPct": snappedf(absf(built - float(reg)) / float(reg) * 100.0, 0.01) if reg != null and float(reg) > 0.0 else null,
			"triangles": tris, "maxPartTriangles": part_max, "parts": parts, "colliders": (r.get("colliders", []) as Array).size(), "buildMs": snappedf(float(r.get("ms", 0.0)), 0.1),
			"ranges": ranges, "distance": snappedf(d, 0.1), "level": level,
			"worship": bool(lm.get("worship", false)), "combatArena": false if bool(lm.get("worship", false)) else null,
		})
	return {"ready": building().is_empty(), "building": building(), "shown": shown, "landmarks": out, "far": far_nodes.size()}


func info() -> Dictionary:
	var built := 0
	var tris := 0
	for id: String in entries:
		if entries[id].built:
			built += 1
			var lv: Array = entries[id].result.get("levels", [])
			if not lv.is_empty():
				tris += int(lv[0].triangles)
	return {"kit": entries.size(), "built": built, "level0Triangles": tris, "farSilhouettes": far_nodes.size()}
