## Generates the procedural tiling textures and the trim sheet of style test B (stylised_b, STYLE_OPTIONS.md batch B)
## into game/render/textures/. Run once after a change (the PNGs are committed, the game only loads them):
##   node harness/bin/godot.mjs run -- --headless --path game -s res://render/tools/make_textures.gd
## (or the pinned Godot binary with the same args). Every texture is seeded noise and pattern maths, no art files:
## they are slots for the AI texture cards that come after the style sign-off.
##   tile_<layer>.png  512 x 512, RGB = albedo (grey around 0.5 is a multiplier on the vertex colour; brick and
##                     footpath tiles carry their own colour), A = joint, crack or groove mask. Layers in LAYERS order.
##   trim.png          512 x 512 trim sheet, four rows of 128 px: moulded floor band, concrete sill and sunshade
##                     edge, black and yellow paint, ribbed shutter drum. A = 1.
##   grille.png        256 x 256 window grille: white bars on transparent (tinted by the vertex colour).
extends SceneTree

const OUT := "res://render/textures/"
const N := 512
const LAYERS := ["plaster", "brick", "concrete", "asphalt", "paver", "shutter"]

var _done := false


func _process(_d: float) -> bool:
	if _done:
		return true
	_done = true
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(OUT))
	for l in LAYERS:
		var img: Image = call("_" + l)
		img.save_png(ProjectSettings.globalize_path(OUT + "tile_" + l + ".png"))
		print("textures: tile_%s.png" % l)
	_trim().save_png(ProjectSettings.globalize_path(OUT + "trim.png"))
	_grille().save_png(ProjectSettings.globalize_path(OUT + "grille.png"))
	print("textures: trim.png, grille.png")
	quit(0)
	return true


func _noise(seed: int, freq: float, octaves := 4) -> FastNoiseLite:
	var n := FastNoiseLite.new()
	n.seed = seed
	n.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	n.frequency = freq
	n.fractal_octaves = octaves
	return n


## Tileable noise in -1..1 at pixel (x, y) of an N tile: four samples blended across the seams.
func _tn(n: FastNoiseLite, x: float, y: float, size := N) -> float:
	var fx := x / size
	var fy := y / size
	var a := n.get_noise_2d(x, y)
	var b := n.get_noise_2d(x - size, y)
	var c := n.get_noise_2d(x, y - size)
	var d := n.get_noise_2d(x - size, y - size)
	return lerpf(lerpf(a, b, fx), lerpf(c, d, fx), fy)


func _img() -> Image:
	return Image.create_empty(N, N, false, Image.FORMAT_RGBA8)


func _grey(v: float, a := 0.0) -> Color:
	v = clampf(v, 0.0, 1.0)
	return Color(v, v, v, clampf(a, 0.0, 1.0))


func _plaster() -> Image:
	var img := _img()
	var mott := _noise(1, 0.008, 5)
	var grain := _noise(2, 0.35, 2)
	var crack := _noise(3, 0.012, 3)
	var trowel := _noise(4, 0.02, 2)
	for y in N:
		for x in N:
			var m := _tn(mott, x, y) * 0.12
			var g := _tn(grain, x, y) * 0.05
			var t := absf(_tn(trowel, x, y * 0.6)) * 0.04
			var c := 1.0 - smoothstep(0.0, 0.018, absf(_tn(crack, x, y)))
			c *= smoothstep(0.1, 0.35, _tn(mott, y, x) + 0.3)
			img.set_pixel(x, y, _grey(0.5 + m + g - t - c * 0.18, c))
	return img


func _brick() -> Image:
	# 4 bricks of 24 cm across and 12 courses of 8 cm down a 0.96 m tile: 128 x 42.7 px per brick and joint
	var img := _img()
	var grain := _noise(11, 0.25, 3)
	var chip := _noise(12, 0.05, 2)
	var rng := RandomNumberGenerator.new()
	rng.seed = 13
	var tones := []
	for i in 48:
		var base := Color("#a65136").lerp(Color("#7a3a28"), rng.randf()).lerp(Color("#c27a52"), rng.randf() * 0.35)
		tones.append(base)
	var ch := N / 12.0
	var bw := N / 4.0
	for y in N:
		var course := int(y / ch)
		var fy := fmod(y, ch)
		var shift := bw * 0.5 if course % 2 == 1 else 0.0
		for x in N:
			var xs := fposmod(x + shift, N)
			var brick := int(xs / bw)
			var fx := fmod(xs, bw)
			var e := minf(minf(fx, bw - fx), minf(fy, ch - fy))
			var ragged := 3.2 + _tn(chip, x, y) * 2.0
			var mortar := 1.0 - smoothstep(ragged - 1.0, ragged + 0.6, e)
			var tone: Color = tones[(course * 4 + brick) % tones.size()]
			var g := _tn(grain, x, y) * 0.08
			var c := Color(tone.r + g, tone.g + g * 0.8, tone.b + g * 0.6)
			c = c.darkened(clampf(0.25 - e * 0.04, 0.0, 0.25))
			var mc := Color(0.6, 0.57, 0.52) * (0.9 + g)
			var o := c.lerp(mc, mortar)
			o.a = mortar
			img.set_pixel(x, y, o)
	return img


func _concrete() -> Image:
	var img := _img()
	var mott := _noise(21, 0.01, 4)
	var pores := _noise(22, 0.6, 1)
	var stain := _noise(23, 0.004, 3)
	for y in N:
		for x in N:
			var m := _tn(mott, x, y) * 0.09
			var p := smoothstep(0.55, 0.75, _tn(pores, x, y)) * 0.18
			var st := smoothstep(0.1, 0.5, _tn(stain, x, y)) * 0.08
			# formwork joints every quarter tile (60 cm on a 2.4 m tile)
			var j := 1.0 - smoothstep(0.0, 1.6, absf(fposmod(y + 2.0, N / 4.0) - 2.0))
			img.set_pixel(x, y, _grey(0.52 + m - p - st - j * 0.12, j))
	return img


func _asphalt() -> Image:
	# 6 m tile: aggregate speckle, two old patches and meandering black crack-seal (tar) lines
	var img := _img()
	var agg := _noise(31, 0.9, 1)
	var agg2 := _noise(32, 0.35, 2)
	var mott := _noise(33, 0.006, 3)
	var tar := _noise(34, 0.006, 2)
	var tar2 := _noise(35, 0.011, 2)
	var patches := [Rect2(60, 300, 150, 90), Rect2(330, 70, 110, 160), Rect2(280, 400, 200, 70)]
	var jag := _noise(36, 0.08, 2)
	for y in N:
		for x in N:
			var a := _tn(agg, x, y)
			var s := 0.0
			if a > 0.55:
				s = 0.14
			elif a < -0.6:
				s = -0.1
			var v := 0.5 + s + _tn(agg2, x, y) * 0.05 + _tn(mott, x, y) * 0.08
			var mask := 0.0
			for r in patches:
				var d := minf(minf(x - r.position.x, r.end.x - x), minf(y - r.position.y, r.end.y - y)) + _tn(jag, x, y) * 4.0
				if d > 0.0:
					v = v * 0.78 + 0.02 + _tn(agg2, x * 1.7, y * 1.7) * 0.03
					if d < 2.5:
						v = 0.28
						mask = 1.0
			var t1 := 1.0 - smoothstep(0.004, 0.012, absf(_tn(tar, x, y)))
			var t2 := (1.0 - smoothstep(0.004, 0.011, absf(_tn(tar2, x, y)))) * smoothstep(0.0, 0.3, _tn(mott, y, x))
			var t := maxf(t1 * smoothstep(-0.2, 0.2, _tn(mott, x * 0.5, y * 0.5)), t2)
			v = lerpf(v, 0.14, t)
			img.set_pixel(x, y, _grey(v, maxf(mask, t)))
	return img


func _paver() -> Image:
	# 1.2 m tile of 30 cm square footpath tiles: red and grey checker, dark joints, a few cracked or stained tiles
	var img := _img()
	var grain := _noise(41, 0.3, 2)
	var stain := _noise(42, 0.01, 3)
	var crack := _noise(43, 0.02, 2)
	var rng := RandomNumberGenerator.new()
	rng.seed = 44
	var t := N / 4.0
	var shade := []
	for i in 16:
		shade.append(rng.randf_range(0.88, 1.08))
	for y in N:
		var ty := int(y / t)
		var fy := fmod(y, t)
		for x in N:
			var tx := int(x / t)
			var fx := fmod(x, t)
			var red := (tx + ty) % 2 == 0
			var c := Color("#a4553f") if red else Color("#9d9890")
			var k: float = shade[(ty * 4 + tx) % 16]
			var g := _tn(grain, x, y) * 0.06
			c = Color(c.r * k + g, c.g * k + g, c.b * k + g)
			var e := minf(minf(fx, t - fx), minf(fy, t - fy))
			var joint := 1.0 - smoothstep(1.5, 3.5, e)
			c = c.darkened(clampf(0.12 - e * 0.02, 0.0, 0.12))
			var st := smoothstep(0.2, 0.6, _tn(stain, x, y))
			c = c.lerp(Color(0.3, 0.27, 0.24), st * 0.35)
			if (tx * 7 + ty * 3) % 11 == 0:
				var cr := 1.0 - smoothstep(0.0, 0.02, absf(_tn(crack, x, y)))
				c = c.lerp(Color(0.18, 0.16, 0.14), cr)
				joint = maxf(joint, cr)
			var o := c.lerp(Color(0.25, 0.23, 0.21), joint)
			o.a = joint
			img.set_pixel(x, y, o)
	return img


func _shutter() -> Image:
	# 1 m tile: 12 ribs, a dent or two, rust runs from the ribs
	var img := _img()
	var rust := _noise(51, 0.02, 3)
	var dents := _noise(52, 0.01, 2)
	var rib := N / 12.0
	for y in N:
		var f := fmod(y, rib) / rib
		var prof := sin(f * TAU) * 0.12 + (0.06 if f < 0.12 else 0.0)
		var groove := 1.0 - smoothstep(0.0, 0.1, absf(f - 0.95))
		for x in N:
			var r := smoothstep(0.15, 0.6, _tn(rust, x * 3.0, y * 0.25)) * 0.5
			var d := _tn(dents, x, y) * 0.05
			var v := 0.5 + prof + d - groove * 0.2
			var c := Color(v, v, v).lerp(Color(0.42, 0.25, 0.14), r)
			c.a = groove
			img.set_pixel(x, y, c)
	return img


func _trim() -> Image:
	var img := _img()
	var grain := _noise(61, 0.2, 2)
	var row := N / 4
	for y in N:
		var r := y / row
		var fy := float(y % row) / row
		for x in N:
			var g := _tn(grain, x, y) * 0.04
			var c := Color(0.5, 0.5, 0.5)
			match r:
				0:
					# moulded floor band: light fillet, groove, band with dentil blocks, shadow lip
					var v := 0.55
					if fy < 0.12:
						v = 0.72
					elif fy < 0.2:
						v = 0.3
					elif fy < 0.62:
						var dent := fmod(x, N / 16.0) / (N / 16.0)
						v = 0.6 if (fy > 0.3 and fy < 0.55 and dent < 0.55) else 0.47
					elif fy < 0.72:
						v = 0.62
					else:
						v = lerpf(0.5, 0.25, (fy - 0.72) / 0.28)
					c = Color(v + g, v + g, v + g)
				1:
					# concrete sill or sunshade slab edge: rough top, sharp front, dark drip line under the lip
					var v2 := 0.56 + g
					if fy > 0.78:
						v2 = lerpf(0.4, 0.18, (fy - 0.78) / 0.22)
					elif fy < 0.1:
						v2 = 0.66
					c = Color(v2, v2, v2 * 0.97)
				2:
					# black and yellow paint, half a tile each, scuffed
					var yellow := x >= N / 2
					c = Color("#f0c419") if yellow else Color("#1e1e1e")
					var scuff := smoothstep(0.25, 0.5, _tn(grain, x * 2.0, y * 4.0))
					c = c.lerp(Color(0.55, 0.53, 0.5), scuff * 0.5)
				3:
					# shutter drum and guide: vertical ribs, a little rust
					var fx := fmod(x, N / 24.0) / (N / 24.0)
					var v3 := 0.5 + sin(fx * TAU) * 0.12
					c = Color(v3, v3, v3).lerp(Color(0.42, 0.26, 0.15), smoothstep(0.2, 0.5, _tn(grain, x, y * 3.0)) * 0.4)
			c.a = 1.0
			img.set_pixel(x, y, c)
	return img


func _grille() -> Image:
	var n := 256
	var img := Image.create_empty(n, n, false, Image.FORMAT_RGBA8)
	for y in n:
		for x in n:
			var u := (x + 0.5) / n
			var v := (y + 0.5) / n
			var on := false
			# frame
			if u < 0.04 or u > 0.96 or v < 0.03 or v > 0.97:
				on = true
			# vertical bars, one cross rail at a third
			if absf(fmod(u, 1.0 / 6.0) - 1.0 / 12.0) < 0.012:
				on = true
			if absf(v - 0.33) < 0.012:
				on = true
			# a diamond and a sunburst arc in the lower part (common Delhi grille motifs)
			var dx := absf(u - 0.5)
			var dy := absf(v - 0.66)
			if absf(dx + dy * 0.8 - 0.2) < 0.012:
				on = true
			var rr := Vector2(u - 0.5, (v - 0.33) * 1.2).length()
			if v < 0.33 and absf(rr - 0.22) < 0.012:
				on = true
			img.set_pixel(x, y, Color(1, 1, 1, 1.0 if on else 0.0))
	return img
