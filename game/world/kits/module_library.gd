## The area kits' module library (P2-010, KT2): every module id the bake can place (`<building type>.<part>`, types
## from kits.json, parts from tools/bake/areas/facade.ts PARTS) and every piece a kit adds (`<kit>.<piece>`) mapped to
## a mesh, plus the kit materials (game/render/shaders/kit_b.gdshader with the kit's texture array and atlas). Ids of
## one kit that share a design share one mesh, so they draw as one MultiMesh. `replace(id, mesh)` swaps one module
## for an ingested model: the baked placements stay as they are (the test in game/tests/test_area_kits.gd).
## Built on the main thread once; worker threads only read it.
extends RefCounted

const Modules := preload("res://world/kits/kit_modules.gd")
const KIT_SHADER := preload("res://render/shaders/kit_b.gdshader")
const KITS_PATH := "res://world/kits/kits.json"
const TEX_DIR := "res://world/kits/textures/"
## tools/bake/areas/facade.ts PARTS, in its order
const PARTS := ["gf_shop", "gf_door", "gf_plain", "gf_colonnade", "gf_arcade", "gf_gate", "up_window", "up_balcony", "up_jharokha", "up_blank", "up_strip", "up_glass", "roof_parapet"]
## the kit whose layers the far shells use (a middle wear, plain plaster)
const SHELL_KIT := "hotel"

var data: Dictionary
## id -> Mesh
var meshes := {}
## id -> kit id
var kit_of := {}
## id -> design name
var design_of := {}
## kit id -> ShaderMaterial
var materials := {}
var shell_material: ShaderMaterial
## id -> true for ids replaced since the library was built
var replaced := {}
## palette words the bake tints walls with: [[r, g, b, sum]] in kits.json `palette` order, and their names
var _words := []
var _word_names := []
## kit id -> word index -> PackedInt32Array of the kit's wall colours (0xRRGGBB) for walls tinted with that word
var _walls := {}


func _init(with_materials := true) -> void:
	data = load_data()
	if with_materials:
		for kit: String in data.kits:
			materials[kit] = material(kit)
		shell_material = material(SHELL_KIT)
		shell_material.set_shader_parameter("kit_shell", true)
	_build()
	_build_walls()


static func load_data() -> Dictionary:
	var f := FileAccess.open(KITS_PATH, FileAccess.READ)
	var parsed: Variant = JSON.parse_string(f.get_as_text()) if f != null else null
	return parsed if parsed is Dictionary else {"types": {}, "kits": {}}


## The kit material: the stylised B surface with KIT on, the kit's layers and atlas and its accent colours. The look
## numbers are the signed stylised B ones (styles/stylised_b.tres: detail, albedo saturation, wear scale; calm on).
func material(kit: String) -> ShaderMaterial:
	var k: Dictionary = data.kits[kit]
	var s := ShaderMaterial.new()
	s.shader = KIT_SHADER
	s.resource_name = "kit_%s" % kit
	s.set_shader_parameter("kit_tiles", load(TEX_DIR + kit + "_tiles.png"))
	s.set_shader_parameter("kit_atlas", load(TEX_DIR + kit + "_atlas.png"))
	s.set_shader_parameter("kit_noise", load(TEX_DIR + "kit_noise.png"))
	var acc := PackedVector3Array()
	for h: String in k.accent:
		var c := Color.html(h)
		acc.append(Vector3(c.r, c.g, c.b))
	var n := acc.size()
	while acc.size() < 8:
		acc.append(acc[acc.size() % n])
	s.set_shader_parameter("kit_accents", acc)
	s.set_shader_parameter("kit_accent_count", n)
	s.set_shader_parameter("roughness_base", 0.92)
	s.set_shader_parameter("detail", 1.0)
	# the wall colours are sampled from the area photos (kits.json walls): no saturation boost on top of them
	s.set_shader_parameter("albedo_saturation", 1.0)
	s.set_shader_parameter("wear_scale", 1.15)
	s.set_shader_parameter("tex_mix", 1.0)
	s.set_shader_parameter("calm", 1.0)
	s.set_shader_parameter("mottle", 0.7)
	return s


## The share of a kit piece (0 when the kit has none).
func share(kit: String, piece: String) -> float:
	var extra: Dictionary = Modules.EXTRA_SHARES.get(kit, {})
	if extra.has(piece):
		return float(extra[piece])
	var sh: Dictionary = data.kits[kit].get("shares", {})
	return float(sh.get(Modules.PIECES[piece].share, 0.0))


## Wall colours from the area photos (P2-010 fix round, tools/kits/sample_walls.mjs): the bake tints a building with a
## palette word, scaled by a shade of 0.92 to 1.06 (tools/bake/areas/plan.ts). The word comes back from the tint's
## chromaticity, and the wall takes one of the kit's photo colours nearest that word (picked by the tint, so a
## building keeps its colour and its neighbours differ), at the same shade. Brick words keep their colour. Pure.
func wall_tint(kit: String, rgb: int) -> int:
	var table: Array = _walls.get(kit, [])
	if table.is_empty() or rgb <= 0:
		return rgb
	var r := float((rgb >> 16) & 255)
	var g := float((rgb >> 8) & 255)
	var b := float(rgb & 255)
	var sum := r + g + b
	if sum <= 0.0:
		return rgb
	var best := -1
	var best_d := INF
	var best_f := 1.0
	for i in _words.size():
		var w: PackedFloat32Array = _words[i]
		var f := sum / w[3]
		var d := absf(r / sum - w[0] / w[3]) + absf(g / sum - w[1] / w[3]) + absf(b / sum - w[2] / w[3])
		# the shade is 0.92 to 1.06 (a bright word clips at 255, so allow a little more below)
		d += maxf(0.0, 0.88 - f) + maxf(0.0, f - 1.09)
		if d < best_d:
			best_d = d
			best = i
			best_f = f
	var cands: PackedInt32Array = table[best]
	if cands.is_empty():
		return rgb
	var c := cands[(((rgb * 2654435761) >> 13) & 0xffff) % cands.size()]
	var f := clampf(best_f, 0.9, 1.08)
	var nr := clampi(roundi(float((c >> 16) & 255) * f), 0, 255)
	var ng := clampi(roundi(float((c >> 8) & 255) * f), 0, 255)
	var nb := clampi(roundi(float(c & 255) * f), 0, 255)
	return (nr << 16) | (ng << 8) | nb


func _build_walls() -> void:
	var pal: Dictionary = data.get("palette", {})
	for word: String in pal:
		var c := Color.html(pal[word])
		var r := roundf(c.r * 255.0)
		var g := roundf(c.g * 255.0)
		var b := roundf(c.b * 255.0)
		_words.append(PackedFloat32Array([r, g, b, maxf(1.0, r + g + b)]))
		_word_names.append(word)
	for kit: String in data.kits:
		var w: Dictionary = data.kits[kit].get("walls", {})
		var m: Dictionary = w.get("map", {})
		if m.is_empty():
			continue
		var table := []
		for word: String in _word_names:
			var list := PackedInt32Array()
			for h: String in m.get(word, []):
				list.append(Color.html(h).to_rgba32() >> 8)
			table.append(list)
		_walls[kit] = table


func _build() -> void:
	var by_design := {}
	var types: Dictionary = data.types
	for type: String in types:
		var kit: String = types[type]
		var recipe: Dictionary = Modules.RECIPES.get(kit, {})
		for part: String in PARTS:
			var r: Array = recipe.get(part, Modules.DEFAULT[part])
			_add("%s.%s" % [type, part], kit, r[0], r[1], by_design)
	for kit: String in data.kits:
		for piece: String in Modules.PIECES:
			if share(kit, piece) > 0.0:
				_add("%s.%s" % [kit, piece], kit, piece, {}, by_design)
		for piece: String in Modules.UNPLACED.get(kit, []):
			_add("%s.%s" % [kit, piece], kit, piece, {}, by_design)


func _add(id: String, kit: String, design: String, opts: Dictionary, by_design: Dictionary) -> void:
	var key := "%s/%s/%s" % [kit, design, JSON.stringify(opts)]
	if not by_design.has(key):
		var mesh := Modules.build(design, opts, kit)
		if mesh.get_surface_count() > 0 and materials.has(kit):
			mesh.surface_set_material(0, materials[kit])
		by_design[key] = mesh
	meshes[id] = by_design[key]
	kit_of[id] = kit
	design_of[id] = design


## The mesh of a module id, or null for an id no kit knows.
func mesh_of(id: String) -> Mesh:
	return meshes.get(id)


## Swaps the mesh of one module id (an ingested model later). Placements are untouched; only that id draws the new mesh.
func replace(id: String, mesh: Mesh) -> void:
	if not meshes.has(id):
		return
	if mesh.get_surface_count() > 0 and mesh.surface_get_material(0) == null and materials.has(kit_of[id]):
		mesh.surface_set_material(0, materials[kit_of[id]])
	meshes[id] = mesh
	replaced[id] = true


## Every id of a kit.
func ids_of(kit: String) -> Array:
	var out := []
	for id: String in kit_of:
		if kit_of[id] == kit:
			out.append(id)
	out.sort()
	return out


## The distinct meshes (modules) of a kit.
func modules_of(kit: String) -> int:
	var seen := {}
	for id: String in ids_of(kit):
		seen[meshes[id]] = true
	return seen.size()
