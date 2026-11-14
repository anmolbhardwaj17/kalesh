## The area kits (P2-010, game/world/kits/): every kit has at least 8 modules and 6 facade colours, its textures fit
## 60 MB (printed), every module mesh is finite and inside its bay, the buildings system groups the test tiles'
## placements by module and 125 m cell with the colour and wear in the custom data, a module replaced by id leaves
## the baked placements as they were, and sign boards take names only from the kit's names file.
extends RefCounted

const Library := preload("res://world/kits/module_library.gd")
const Buildings := preload("res://world/systems/buildings.gd")
const TileReader := preload("res://world/streaming/tile_reader.gd")
const M := preload("res://world/kits/module_mesh.gd")
const TEST_TILES := ["res://world/test_tiles/-3_-6.ktl", "res://world/test_tiles/8_-5.ktl"]
const MB := 1048576.0

var t
var tree: SceneTree


static func _lib() -> Library:
	return Buildings.library()


func test_every_kit_has_eight_modules_and_six_facade_colours() -> void:
	var lib := _lib()
	t.ok(lib.data.kits.size() == 8, "eight kits (%d)" % lib.data.kits.size())
	for kit: String in lib.data.kits:
		var n := lib.modules_of(kit)
		var colours := {}
		for w: String in lib.data.kits[kit].facade:
			colours[w] = true
		print("    kit %s: %d modules (%d ids), %d facade colours, %d accents" % [kit, n, lib.ids_of(kit).size(), colours.size(), lib.data.kits[kit].accent.size()])
		t.ok(n >= 8, "kit %s has at least 8 modules (%d)" % [kit, n])
		t.ok(colours.size() >= 6, "kit %s has at least 6 facade colours (%d)" % [kit, colours.size()])


## Bytes of a VRAM compressed texture of this format and size with its mipmaps.
static func _bytes(fmt: int, w: int, h: int, mips: bool) -> float:
	var bpp := 32.0
	match fmt:
		Image.FORMAT_DXT1, Image.FORMAT_ETC2_RGB8, Image.FORMAT_ETC:
			bpp = 4.0
		Image.FORMAT_DXT5, Image.FORMAT_ETC2_RGBA8, Image.FORMAT_BPTC_RGBA, Image.FORMAT_ASTC_4x4, Image.FORMAT_DXT3:
			bpp = 8.0
	return float(w) * float(h) * bpp / 8.0 * (4.0 / 3.0 if mips else 1.0)


func test_each_kit_texture_set_fits_sixty_mb() -> void:
	var lib := _lib()
	for kit: String in lib.data.kits:
		var arr: Variant = load(Library.TEX_DIR + kit + "_tiles.png")
		var atlas: Variant = load(Library.TEX_DIR + kit + "_atlas.png")
		t.ok(arr is CompressedTexture2DArray, "kit %s tiles import as a compressed texture array" % kit)
		t.ok(atlas is CompressedTexture2D, "kit %s atlas imports as a compressed texture" % kit)
		if not (arr is CompressedTexture2DArray and atlas is CompressedTexture2D):
			continue
		var a: CompressedTexture2DArray = arr
		var b: CompressedTexture2D = atlas
		var vram := a.get_format() != Image.FORMAT_RGBA8 and a.get_format() != Image.FORMAT_RGB8
		t.ok(vram, "kit %s layers are VRAM compressed (format %d)" % [kit, a.get_format()])
		t.ok(a.get_layers() == lib.data.layers.size(), "kit %s has %d layers (%d)" % [kit, lib.data.layers.size(), a.get_layers()])
		var tiles_b := _bytes(a.get_format(), a.get_width(), a.get_height(), a.has_mipmaps()) * a.get_layers()
		var atlas_img := b.get_image()
		var atlas_b := _bytes(atlas_img.get_format() if atlas_img != null else Image.FORMAT_DXT5, b.get_width(), b.get_height(), true)
		var total := (tiles_b + atlas_b) / MB
		print("    kit %s textures: layers %.1f MB + atlas %.1f MB = %.1f MB (limit 60)" % [kit, tiles_b / MB, atlas_b / MB, total])
		t.ok(total <= 60.0, "kit %s textures fit 60 MB (%.1f)" % [kit, total])


func test_every_module_mesh_is_finite_and_inside_its_bay() -> void:
	var lib := _lib()
	var seen := {}
	for id: String in lib.meshes:
		var mesh: Mesh = lib.meshes[id]
		if seen.has(mesh):
			continue
		seen[mesh] = true
		t.ok(mesh.get_surface_count() == 1, "%s is one surface (one draw a cell)" % id)
		if mesh.get_surface_count() == 0:
			continue
		var a := mesh.surface_get_arrays(0)
		var v: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
		var u2: PackedVector2Array = a[Mesh.ARRAY_TEX_UV2]
		var bad := 0
		var out := 0
		for p in v:
			if not (is_finite(p.x) and is_finite(p.y) and is_finite(p.z)):
				bad += 1
			elif absf(p.x) > 1.9 or p.z < -2.2 or p.z > 2.6 or p.y < -3.5 or p.y > 6.5:
				out += 1
		var codes := 0
		for q in u2:
			if q.x < 0.0 or q.x > 11.0 or q.y < 0.0 or q.y > 3.0:
				codes += 1
		t.ok(bad == 0 and out == 0, "%s: every vertex finite and inside the bay frame (%d bad, %d out)" % [id, bad, out])
		t.ok(codes == 0, "%s: every part code and colour mode known (%d not)" % [id, codes])
		t.ok(v.size() / 4 <= 1200, "%s: under 600 quads (%d vertices)" % [id, v.size()])


func _tile(path: String) -> Dictionary:
	return TileReader.read(path)


func test_module_lods_drop_fine_detail_first() -> void:
	# P2-010 perf: the far LODs are subsets of the full mesh, each smaller than the last, and keep the wall face
	const KM := preload("res://world/kits/kit_modules.gd")
	var m := M.new()
	KM._balcony(m, {"railing": true})
	var l := m.lods()
	var keys := l.keys()
	t.ok(keys.size() == 2, "a railed balcony has two LODs (%d)" % keys.size())
	var last := m.idx.size()
	var prev_key := 0.0
	for k: float in keys:
		var ix: PackedInt32Array = l[k]
		t.ok(k > prev_key and ix.size() < last and ix.size() % 3 == 0, "LOD %.3f: %d indices, fewer than %d" % [k, ix.size(), last])
		var bad := 0
		for i in ix:
			if i < 0 or i >= m.v.size():
				bad += 1
		t.ok(bad == 0, "LOD %.3f: every index is a vertex of the mesh" % k)
		prev_key = k
		last = ix.size()
	t.ok(m.levels.size() * 6 == m.idx.size(), "one detail level a quad")
	t.ok(absf(float(keys[0]) * 1280.0 / (2.0 * tan(deg_to_rad(35.0)) * 16.0 / 9.0) - M.LOD1_M) < 0.01, "the first LOD switches at LOD1_M at a 1280 px view")


func test_buildings_group_the_test_tiles_by_module_and_cell() -> void:
	var lib := _lib()
	for path: String in TEST_TILES:
		var tile := _tile(path)
		t.ok(tile.ok, "%s reads" % path)
		if not tile.ok:
			continue
		var baked := 0
		for p: Dictionary in tile.header.placements:
			baked += int(p.count)
		var out := Buildings.cells_of(tile, lib)
		var drawn := 0
		var base := 0
		var bad := 0
		for g: Dictionary in out.groups:
			var buf: PackedFloat32Array = g.buffer
			t.ok(buf.size() == int(g.count) * 16, "%s: a group buffer holds 16 floats an instance" % g.id)
			drawn += int(g.count)
			if (str(g.id).get_slice(".", 0) as String) in lib.data.types:
				base += int(g.count)
			for k in int(g.count):
				var o := k * 16
				var x := buf[o + 3]
				var z := buf[o + 11]
				var cell := (1 if x >= Buildings.CELL_M else 0) + (2 if z >= Buildings.CELL_M else 0)
				if cell != int(g.cell):
					bad += 1
				for j in 4:
					if buf[o + 12 + j] < 0.0 or buf[o + 12 + j] > 1.0:
						bad += 1
		print("    %s: %d baked instances, %d drawn (%d kit pieces), %d groups, %d unknown" % [path.get_file(), baked, drawn, drawn - base, out.groups.size(), out.unknown])
		t.ok(int(out.unknown) == 0, "%s: every baked module id has a mesh (%d unknown)" % [path.get_file(), out.unknown])
		t.ok(base == baked, "%s: every baked instance is drawn once (%d of %d)" % [path.get_file(), base, baked])
		t.ok(bad == 0, "%s: every instance in its cell with colour and wear in 0..1 (%d bad)" % [path.get_file(), bad])
		t.ok(drawn > base, "%s: the kits add their pieces (boards, stairs, tanks, railings)" % path.get_file())


## Every drawn instance (rows of 16 floats as exact strings), sorted; only the groups drawing `mesh` when given.
static func _rows(out: Dictionary, mesh: Mesh = null) -> Array:
	var rows := []
	for g: Dictionary in out.groups:
		if mesh != null and g.mesh != mesh:
			continue
		var buf: PackedFloat32Array = g.buffer
		for k in int(g.count):
			rows.append(str(buf.slice(k * 16, k * 16 + 16)))
	rows.sort()
	return rows


## The rows of one module id straight from the tile's placements.
static func _baked_rows(tile: Dictionary, id: String) -> Array:
	var rows := []
	for p: Dictionary in tile.header.placements:
		if str(p.module) != id:
			continue
		var xf := TileReader.floats(tile, int(p.xforms), int(p.count) * 12)
		var data := TileReader.ints(tile, int(p.data), int(p.count))
		for i in int(p.count):
			var r := xf.slice(i * 12, i * 12 + 12)
			var d := data[i]
			r.append_array(PackedFloat32Array([float((d >> 24) & 255) / 255.0, float((d >> 16) & 255) / 255.0, float((d >> 8) & 255) / 255.0, float(d & 255) / 255.0]))
			rows.append(str(r))
	rows.sort()
	return rows


func test_replacing_a_module_by_id_leaves_the_placements() -> void:
	var lib := Library.new(false)
	var tile := _tile(TEST_TILES[0])
	var before := Buildings.cells_of(tile, lib)
	var id := ""
	var most := 0
	for p: Dictionary in tile.header.placements:
		if int(p.count) > most:
			most = int(p.count)
			id = str(p.module)
	var old: Mesh = lib.mesh_of(id)
	var m := M.new()
	m.paint(M.RENDER, M.WALL)
	m.front(-1.5, 0.0, 1.5, 3.2, M.SKIN)
	var fresh := m.mesh()
	lib.replace(id, fresh)
	var after := Buildings.cells_of(tile, lib)
	t.ok(lib.mesh_of(id) == fresh and old != fresh, "the library hands out the new mesh for %s" % id)
	t.ok(_rows(before) == _rows(after), "every drawn instance (transform, colour, wear) is the same before and after replacing %s (%d)" % [id, _rows(after).size()])
	var baked := _baked_rows(tile, id)
	t.ok(baked.size() == most and _rows(after, fresh) == baked, "the new mesh draws exactly the %d baked placements of %s" % [most, id])
	t.ok(int(before.instances) == int(after.instances), "the same number of instances (%d)" % int(after.instances))


func test_sign_boards_take_names_only_from_the_kit_names_file() -> void:
	var lib := _lib()
	var f := FileAccess.open(Library.TEX_DIR + "boards.json", FileAccess.READ)
	var boards: Dictionary = JSON.parse_string(f.get_as_text())
	for kit: String in lib.data.kits:
		var area: String = lib.data.kits[kit].area
		var nf := FileAccess.open("res://data/names/%s.json" % area, FileAccess.READ)
		t.ok(nf != null, "kit %s names file %s exists" % [kit, area])
		if nf == null:
			continue
		var names: Dictionary = JSON.parse_string(nf.get_as_text())
		var known := {}
		for n: Dictionary in names.names:
			known[JSON.stringify(n.text, "", true)] = true
		var cells: Array = boards.kits[kit].cells
		var missing := 0
		for c: Dictionary in cells:
			if not known.has(JSON.stringify(c.text, "", true)):
				missing += 1
		t.ok(str(boards.kits[kit].area) == area, "kit %s boards are from %s" % [kit, area])
		t.ok(cells.size() == 32 and missing == 0, "kit %s: all %d boards carry a name of %s (%d not)" % [kit, cells.size(), area, missing])
