## Streamed system: the buildings of a tile (P2-010, TECH.md "Rendering of the city"). The unique shells the bake wrote
## stay one merged mesh per tile (material `building`), drawn with the kit shell material: wall colour and wear from
## the shell's UV2, windows and shop openings from its facade UV where no module stands (the far look). The facade
## modules of the area generator's placements are MultiMesh instances per module mesh per 125 m cell (a quarter of the
## tile), wall colour and wear in the MultiMesh custom data (game/render/shaders/kit_b.gdshader reads them; a per-instance
## uniform has room for about 4,096 instances only). Each kit adds its own pieces (sign boards, outside stairs, roof
## tanks and railings, AC units, awnings) to some bays, decided by a hash of the bay's place, so a rebake that keeps a
## building keeps its pieces; a shop bay takes at most one front sign board (P2-048: one hash, the shares back to back). Modules draw to MODULE_RANGE_M (visibility range from the cell's middle), small pieces to
## PIECE_RANGE_M; no module casts a shadow (measured: 5.3 M triangles with shadow passes in the busiest view). Built on a worker thread; attached in steps of STEP_NODES nodes.
## Budget: GPU 2.0 ms for generated buildings (perf_budgets.json world.gpuMs.generatedBuildings).
extends RefCounted

const TileMesh := preload("res://world/systems/tile_mesh.gd")
const TileReader := preload("res://world/streaming/tile_reader.gd")
const Library := preload("res://world/kits/module_library.gd")
const Modules := preload("res://world/kits/kit_modules.gd")
const ONLY := ["building"]
const CELL_M := 125.0
## visibility range ends, measured from a cell's middle (a 125 m cell reaches about 88 m from it)
const MODULE_RANGE_M := 200.0
const PIECE_RANGE_M := 120.0
const SMALL := ["board", "ac", "rail", "vsign", "tank", "board_tilt", "board_lamp", "flex", "glow", "vboard", "band", "stack", "enamel", "small", "notice", "wallsign", "upflex", "upboards", "blade", "shutpaint", "cables"]
const STEP_NODES := 40

## one library for every streamed city (built on the main thread the first time a system is made)
static var _lib: Library = null

var id := "buildings"
var lane := "mesh"
var exclusive := true
var per_frame := 0
var budget_ms := 0.3
var root: Node3D
var materials: Dictionary
var lib: Library
var live := 0
var triangles := 0
var instances := 0
var multimeshes := 0
var unknown := 0


func _init(parent: Node3D, stand_ins: Dictionary) -> void:
	root = parent
	lib = library()
	materials = stand_ins.duplicate()
	materials["building"] = lib.shell_material


static func library() -> Library:
	if _lib == null:
		_lib = Library.new()
	return _lib


func prepare(tile: Dictionary) -> Variant:
	var cells := cells_of(tile, lib)
	# the shells take the same photo wall colours as their modules (a far building keeps its colour as it nears)
	var tints: Dictionary = cells.tints
	var kit: String = cells.kit
	var shell := TileMesh.build(tile, materials, ONLY, [], func(uv2: PackedVector2Array) -> PackedVector2Array: return shell_tints(uv2, tints, kit, lib))
	if shell.has("error"):
		return shell
	var groups := []
	for g: Dictionary in cells.groups:
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_custom_data = true
		mm.mesh = g.mesh
		mm.instance_count = int(g.count)
		mm.buffer = g.buffer
		groups.append({"mm": mm, "cell": g.cell, "small": g.small, "count": g.count, "id": g.id})
	return {"mesh": shell.mesh, "triangles": shell.triangles, "node": null, "groups": groups, "instances": cells.instances, "unknown": cells.unknown, "nodes": [], "at": 0}


## The module instances of a tile grouped by mesh and 125 m cell: {groups: [{id, mesh, cell, small, count, buffer
## (16 floats an instance: 12 of transform, then colour r, g, b and wear)}], instances, unknown}. Pure: reads the
## placements and the library only (the tests call it on the test tiles).
static func cells_of(tile: Dictionary, library: Library) -> Dictionary:
	var lists := {}
	var meta := {}
	var xfs := []
	var datas := []
	var unknown_n := 0
	var total := 0
	# baked tint -> photo wall colour (P2-010 fix round, module_library.gd wall_tint), and how many instances each kit has
	var tints := {}
	var kit_n := {}
	var placements: Array = tile.header.get("placements", [])
	for pi in placements.size():
		var p: Dictionary = placements[pi]
		var mid := str(p.module)
		var cnt := int(p.count)
		var mesh: Mesh = library.mesh_of(mid)
		if mesh == null or cnt <= 0:
			unknown_n += maxi(cnt, 0)
			xfs.append(PackedFloat32Array())
			datas.append(PackedInt32Array())
			continue
		var xf := TileReader.floats(tile, int(p.xforms), cnt * 12)
		var data := TileReader.ints(tile, int(p.data), cnt)
		var kit: String = library.kit_of[mid]
		kit_n[kit] = int(kit_n.get(kit, 0)) + cnt
		var last := -1
		var last_out := 0
		for i in cnt:
			var d: int = data[i]
			var rgb := (d >> 8) & 0xffffff
			if rgb != last:
				last = rgb
				var key := "%s:%d" % [kit, rgb]
				if not tints.has(key):
					tints[key] = library.wall_tint(kit, rgb)
					if not tints.has(rgb):
						tints[rgb] = tints[key]
				last_out = tints[key]
			data[i] = (last_out << 8) | (d & 255)
		xfs.append(xf)
		datas.append(data)
		var part := mid.get_slice(".", 1)
		var outs := [_lists(lists, meta, mesh, mid, false)]
		var pieces := []
		# pieces of one slot (the front sign board, P2-048) share the slot's hash and take back to back ranges of it
		var slot_at := {}
		for piece: String in Modules.PIECES:
			var spec: Dictionary = Modules.PIECES[piece]
			if not part in spec.from:
				continue
			var s := library.share(kit, piece)
			var pid := "%s.%s" % [kit, piece]
			var pm: Mesh = library.mesh_of(pid)
			if s <= 0.0 or pm == null:
				continue
			var slot: String = spec.get("slot", "")
			var lo := 0.0
			var salt := piece.hash()
			if slot != "":
				lo = float(slot_at.get(slot, 0.0))
				slot_at[slot] = lo + s
				salt = slot.hash()
			pieces.append([lo + s, bool(spec.column), _lists(lists, meta, pm, pid, piece in SMALL), salt, lo])
		for i in cnt:
			var b := i * 12
			var ox := xf[b + 3]
			var oz := xf[b + 11]
			var cell := (1 if ox >= CELL_M else 0) + (2 if oz >= CELL_M else 0)
			var key := (pi << 20) | i
			(outs[0][cell] as Array).append(key)
			total += 1
			for pc: Array in pieces:
				var hy := 0 if pc[1] else roundi(xf[b + 7] * 2.0)
				var h := bay_hash(ox, oz, hy, pc[3])
				if h < float(pc[0]) and h >= float(pc[4]):
					(pc[2][cell] as Array).append(key)
					total += 1
	var groups := []
	for k: int in lists:
		var m: Dictionary = meta[k]
		for cell in 4:
			var list: Array = lists[k][cell]
			if list.is_empty():
				continue
			var buf := PackedFloat32Array()
			buf.resize(list.size() * 16)
			var o := 0
			for key: int in list:
				var pi := key >> 20
				var i := key & 0xfffff
				var xf: PackedFloat32Array = xfs[pi]
				var b := i * 12
				for j in 12:
					buf[o + j] = xf[b + j]
				var d: int = (datas[pi] as PackedInt32Array)[i]
				buf[o + 12] = float((d >> 24) & 255) / 255.0
				buf[o + 13] = float((d >> 16) & 255) / 255.0
				buf[o + 14] = float((d >> 8) & 255) / 255.0
				buf[o + 15] = float(d & 255) / 255.0
				o += 16
			groups.append({"id": m.id, "mesh": m.mesh, "cell": cell, "small": m.small, "count": list.size(), "buffer": buf})
	var top := ""
	for k: String in kit_n:
		if top == "" or int(kit_n[k]) > int(kit_n[top]):
			top = k
	return {"groups": groups, "instances": total, "unknown": unknown_n, "tints": tints, "kit": top if top != "" else Library.SHELL_KIT}


## The shell UV2 with every wall tint repainted: the colour its modules took (same building, same baked tint), else the
## photo colour of the tile's main kit. UV2.x is the tint as a whole number (0 = no tint), y the wear.
static func shell_tints(uv2: PackedVector2Array, tints: Dictionary, kit: String, library: Library) -> PackedVector2Array:
	var last := -1.0
	var last_out := 0.0
	for i in uv2.size():
		var t := uv2[i].x
		if t < 0.5:
			continue
		if t != last:
			last = t
			var rgb := roundi(t)
			last_out = float(tints[rgb] if tints.has(rgb) else library.wall_tint(kit, rgb))
		uv2[i].x = last_out
	return uv2


static func _lists(lists: Dictionary, meta: Dictionary, mesh: Mesh, mid: String, small: bool) -> Array:
	var k := mesh.get_instance_id()
	if not lists.has(k):
		lists[k] = [[], [], [], []]
		meta[k] = {"id": mid, "mesh": mesh, "small": small}
	return lists[k]


## A number in [0, 1) from a bay's place (x, z in tile metres, a height step) and a salt: the same bay always draws the
## same, whatever else changes in the tile.
static func bay_hash(x: float, z: float, hy: int, salt: int) -> float:
	var h := hash(Vector4i(roundi(x * 4.0), roundi(z * 4.0), hy, salt))
	return float(h & 0xffff) / 65536.0


func attach(tile: Dictionary, part: Variant) -> bool:
	if int(part.at) == 0:
		TileMesh.attach(root, id, tile, part)
		if part.node != null:
			part.nodes.append(part.node)
	var groups: Array = part.groups
	var end := mini(int(part.at) + STEP_NODES, groups.size())
	for gi in range(int(part.at), end):
		var g: Dictionary = groups[gi]
		var mmi := MultiMeshInstance3D.new()
		var small: bool = g.small
		# modules buildings_<tile>_m<n>, small pieces buildings_<tile>_p<n> (stream layers can hide either alone)
		mmi.name = "%s_%s_%s%d" % [id, tile.id, "p" if small else "m", gi]
		mmi.multimesh = g.mm
		mmi.position = tile.origin
		mmi.visibility_range_end = PIECE_RANGE_M if small else MODULE_RANGE_M
		mmi.visibility_range_end_margin = 20.0
		mmi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF
		# no module casts a sun shadow: a MultiMesh is culled as one box, so every instance of a cell would draw in
		# every shadow split it touches (the shells keep the buildings' shadows; SSAO shades the reliefs)
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		root.add_child(mmi)
		part.nodes.append(mmi)
	part.at = end
	if end < groups.size():
		return false
	part["on"] = true
	live += 1
	triangles += int(part.triangles)
	instances += int(part.instances)
	multimeshes += groups.size()
	unknown += int(part.unknown)
	return true


func dispose(_tile: Dictionary, part: Variant) -> bool:
	if part.get("on", false):
		part["on"] = false
		live -= 1
		triangles -= int(part.triangles)
		instances -= int(part.instances)
		multimeshes -= (part.groups as Array).size()
		unknown -= int(part.unknown)
	for n: Node in part.get("nodes", []):
		if is_instance_valid(n):
			if n.is_inside_tree():
				n.free()
			else:
				n.queue_free()
	part.nodes = []
	part.node = null
	part.mesh = null
	part.groups = []
	return true


func info() -> Dictionary:
	return {"tiles": live, "triangles": triangles, "instances": instances, "multimeshes": multimeshes, "unknownModules": unknown}
