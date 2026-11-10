## Writes the generated kit textures of the texture bench (P0-016, ARCH_OPTIONS.md TX1 against TX3) as PNG files:
##   kit_albedo.png, kit_normal.png  4096 x 3072, 12 layers of 1024 x 1024 in a 4 x 3 grid (one Texture2DArray each)
##   trim.png, decal.png             2048 x 2048 (decal with an alpha channel)
## Noise only: sizes and formats are what the bench measures, not the picture. Run by harness/bench/render.plan.mjs:
##   godot --path game --headless -s res://bench/render/tools/make_tex.gd -- --out=<absolute folder>
extends SceneTree

const LAYER := 1024
const COLS := 4
const ROWS := 3
const TINTS := [Color("#e8e3d5"), Color("#8f5e45"), Color("#8c8a84"), Color("#3e3d3a"), Color("#9a8d80"), Color("#7a7d7e"),
	Color("#d8cdb4"), Color("#d9a79a"), Color("#9ec3a8"), Color("#d6a84e"), Color("#a4533b"), Color("#c9a77c")]


func _initialize() -> void:
	var out := ""
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--out="):
			out = a.substr(6)
	if out == "" or not out.is_absolute_path():
		print("make_tex: pass -- --out=<absolute folder>")
		quit(1)
		return
	DirAccess.make_dir_recursive_absolute(out)
	var albedo := Image.create_empty(LAYER * COLS, LAYER * ROWS, false, Image.FORMAT_RGBA8)
	var normal := Image.create_empty(LAYER * COLS, LAYER * ROWS, false, Image.FORMAT_RGBA8)
	for i in COLS * ROWS:
		var grey := _noise(LAYER, 100 + i, 0.004 + 0.003 * (i % 4))
		var at := Vector2i((i % COLS) * LAYER, (i / COLS) * LAYER)
		var nrm: Image = grey.duplicate()
		nrm.bump_map_to_normal_map(6.0)
		normal.blit_rect(nrm, Rect2i(0, 0, LAYER, LAYER), at)
		albedo.blit_rect(_tinted(grey, TINTS[i]), Rect2i(0, 0, LAYER, LAYER), at)
	albedo.save_png(out.path_join("kit_albedo.png"))
	normal.save_png(out.path_join("kit_normal.png"))
	_tinted(_noise(2048, 300, 0.01), Color("#b9a48a")).save_png(out.path_join("trim.png"))
	var decal := _tinted(_noise(2048, 301, 0.006), Color("#5a4636"))
	var mask := _noise(2048, 302, 0.003).get_data()
	var data := decal.get_data()
	var k := 3
	var j := 0
	while k < data.size():
		data[k] = mask[j]
		k += 4
		j += 4
	Image.create_from_data(2048, 2048, false, Image.FORMAT_RGBA8, data).save_png(out.path_join("decal.png"))
	print("make_tex: wrote kit_albedo.png, kit_normal.png, trim.png, decal.png to %s" % out)
	quit(0)


func _noise(size: int, noise_seed: int, freq: float) -> Image:
	var n := FastNoiseLite.new()
	n.seed = noise_seed
	n.frequency = freq
	n.fractal_octaves = 5
	var img := n.get_image(size, size)
	img.convert(Image.FORMAT_RGBA8)
	return img


func _tinted(grey: Image, tint: Color) -> Image:
	var img: Image = grey.duplicate()
	var veil := Image.create_empty(img.get_width(), img.get_height(), false, Image.FORMAT_RGBA8)
	veil.fill(Color(tint.r, tint.g, tint.b, 0.6))
	img.blend_rect(veil, Rect2i(0, 0, img.get_width(), img.get_height()), Vector2i.ZERO)
	return img
