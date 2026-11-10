## Style test B+D, stylised realistic with Old Delhi grime (game arg --style=stylised_grime, STYLE_OPTIONS.md "B+D").
## Look B (stylised.gd) plus D's grime as a layer driven by the per-block wear value (builder.gd AREA_WEAR, the
## stand-in for the area profile `wear`): the surface shader's grime mask (wear_scale in stylised_grime.tres), wall
## decals (posters, damp stains, soot, patched plaster) along the shop fronts of worn blocks, and dust motes in the
## air above their street. Character materials are untouched, so people stay clean and readable. Every decal
## texture is procedural (no art files) and every poster is wordless colour blocks (no real brands or parties).
extends "res://render/styles/stylised.gd"

const DECAL_SEED := 20261111

static var _textures := {}


func decorate(mi: MeshInstance3D) -> void:
	var wear: float = mi.get_meta("wear", 0.0)
	if wear < preset.decal_wear_min:
		return
	var holder := Node3D.new()
	holder.name = "Grime"
	var rng := RandomNumberGenerator.new()
	rng.seed = DECAL_SEED
	for f in mi.get_meta("facades", []):
		_facade_decals(holder, rng, f[0], f[1], f[2], wear)
		if f.size() > 3:
			# posters pasted on the wall piers between shops, at eye height
			for p in f[3]:
				if rng.randf() < 0.6:
					_decal(holder, p, 1.55 + rng.randf_range(-0.1, 0.1), f[2], Vector2(0.62, 0.8), _poster(rng.randi_range(0, 5)), 1.0)
	holder.add_child(_dust(mi.get_aabb(), wear))
	# the mesh is entering the tree right now (node_added): add children on the next idle step
	mi.add_child.call_deferred(holder)


## Decals along one shop front from a to b (ground level), wall facing n (outward, horizontal).
func _facade_decals(holder: Node3D, rng: RandomNumberGenerator, a: Vector3, b: Vector3, n: Vector3, wear: float) -> void:
	var along := (b - a).normalized()
	var length := a.distance_to(b)
	var u := rng.randf_range(0.5, 2.0)
	while u < length - 1.0:
		var p := a + along * u
		var r := rng.randf()
		if r < 0.3:
			# a row of 2 to 4 small posters on the strip between the first floor band and the windows
			var k := rng.randi_range(2, 4)
			for i in k:
				_decal(holder, p + along * (i * 0.46), 4.0, n, Vector2(0.4, 0.5), _poster(rng.randi_range(0, 5)), 1.0)
			u += k * 0.46
		elif r < 0.6:
			# soot and rain streaks running down from an upper floor band (stand-in floors are 3.2 m, from 0.4 m)
			var band := 0.4 + 3.2 * rng.randi_range(2, 3)
			var sh := rng.randf_range(1.8, 2.8)
			_decal(holder, p, band - sh * 0.5 - 0.1, n, Vector2(rng.randf_range(0.8, 1.8), sh), _tex("streak"), wear)
		elif r < 0.8:
			_decal(holder, p, rng.randf_range(4.8, 9.5), n, Vector2.ONE * rng.randf_range(1.0, 2.2), _tex("stain"), wear)
		else:
			_decal(holder, p, rng.randf_range(4.0, 9.0), n, Vector2(rng.randf_range(0.9, 1.8), rng.randf_range(0.7, 1.3)), _tex("patch"), wear)
		u += rng.randf_range(1.5, 4.0)


## One decal centred at height y on the wall through ground point p, facing n; size (width, height) in metres.
func _decal(holder: Node3D, p: Vector3, y: float, n: Vector3, size: Vector2, tex: Texture2D, strength: float) -> void:
	var d := Decal.new()
	d.texture_albedo = tex
	d.size = Vector3(size.x, 0.6, size.y)
	d.albedo_mix = clampf(strength, 0.0, 1.0)
	d.upper_fade = 0.0
	d.lower_fade = 0.0
	d.distance_fade_enabled = true
	d.distance_fade_begin = 90.0
	d.distance_fade_length = 20.0
	# a Decal projects along its local -Y: +Y is the wall normal, X runs along the wall, Z points down (texture rows)
	var x := Vector3.UP.cross(n).normalized()
	var basis := Basis(x, n, x.cross(n))
	d.transform = Transform3D(basis, Vector3(p.x, y, p.z))
	holder.add_child(d)


## Dust motes in the air over a worn street. CPUParticles3D: a few hundred motes cost nothing on the CPU, and a
## ParticleProcessMaterial leaks its engine shader at exit (an ERROR line on quit).
func _dust(box: AABB, wear: float) -> CPUParticles3D:
	var quad := QuadMesh.new()
	quad.size = Vector2(0.035, 0.035)
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	mat.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	mat.vertex_color_use_as_albedo = true
	mat.albedo_color = Color(1.0, 0.86, 0.62, 0.35 * light.dust_energy)
	mat.albedo_texture = _tex("mote")
	mat.distance_fade_mode = BaseMaterial3D.DISTANCE_FADE_PIXEL_ALPHA
	mat.distance_fade_min_distance = 1.0
	mat.distance_fade_max_distance = 4.0
	quad.material = mat
	var p := CPUParticles3D.new()
	p.name = "Dust"
	p.amount = int(500 * wear)
	p.lifetime = 12.0
	p.preprocess = 12.0
	p.mesh = quad
	p.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
	p.emission_box_extents = Vector3(minf(box.size.x * 0.5, 3.0), 3.5, box.size.z * 0.45)
	p.direction = Vector3(0.3, 0.2, 0.1)
	p.spread = 180.0
	p.initial_velocity_min = 0.02
	p.initial_velocity_max = 0.12
	p.gravity = Vector3(0, -0.01, 0)
	p.scale_amount_min = 0.5
	p.scale_amount_max = 1.5
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	p.position = Vector3(box.get_center().x, 4.0, box.get_center().z)
	return p


# ---------------------------------------------------------------- procedural decal textures


func _tex(kind: String) -> Texture2D:
	if _textures.has(kind):
		return _textures[kind]
	var img: Image
	match kind:
		"stain":
			img = _blob(64, 64, Color(0.24, 0.2, 0.15), 0.75, 3.0)
		"streak":
			img = _streaks(48, 96)
		"patch":
			img = _blob(64, 48, Color(0.86, 0.82, 0.72), 0.9, 1.2)
		"mote":
			img = Image.create_empty(16, 16, false, Image.FORMAT_RGBA8)
			for y in 16:
				for x in 16:
					var r := Vector2(x - 7.5, y - 7.5).length() / 8.0
					img.set_pixel(x, y, Color(1, 1, 1, clampf(1.0 - r, 0.0, 1.0) ** 2))
	var t := ImageTexture.create_from_image(img)
	_textures[kind] = t
	return t


## A soft irregular blob of colour c (alpha falls off from the centre, ragged by noise).
func _blob(w: int, h: int, c: Color, alpha: float, softness: float) -> Image:
	var img := Image.create_empty(w, h, false, Image.FORMAT_RGBA8)
	var noise := FastNoiseLite.new()
	noise.seed = 7
	noise.frequency = 0.09
	for y in h:
		for x in w:
			var dx := (x + 0.5) / w * 2.0 - 1.0
			var dy := (y + 0.5) / h * 2.0 - 1.0
			var r := sqrt(dx * dx + dy * dy) + noise.get_noise_2d(x, y) * 0.45
			var a := clampf((1.0 - r) * softness, 0.0, 1.0) * alpha
			var v := 1.0 + noise.get_noise_2d(x * 3.0, y * 3.0) * 0.15
			img.set_pixel(x, y, Color(c.r * v, c.g * v, c.b * v, a))
	return img


## Vertical soot and rain streaks: dark at the top, fading down, in thin uneven runs.
func _streaks(w: int, h: int) -> Image:
	var img := Image.create_empty(w, h, false, Image.FORMAT_RGBA8)
	var noise := FastNoiseLite.new()
	noise.seed = 11
	noise.frequency = 0.25
	for y in h:
		for x in w:
			var col := noise.get_noise_2d(x, 0.0) * 0.5 + 0.5
			var run := clampf((col - 0.35) * 2.5, 0.0, 1.0)
			var fade := 1.0 - float(y) / h
			var edge := 1.0 - absf((x + 0.5) / w * 2.0 - 1.0)
			var a := run * fade * clampf(edge * 2.0, 0.0, 1.0) * 0.8
			img.set_pixel(x, y, Color(0.09, 0.08, 0.07, a))
	return img


## A wordless paper poster: a bright colour field with blocks for a face and headline, torn and faded at the edge.
func _poster(i: int) -> Texture2D:
	var key := "poster%d" % i
	if _textures.has(key):
		return _textures[key]
	var fields := [Color("#d6336c"), Color("#f2c230"), Color("#1f5fa8"), Color("#e67e22"), Color("#2e8b57"), Color("#f4efe4")]
	var inks := [Color("#f4efe4"), Color("#b03a2e"), Color("#f2c230"), Color("#1c1c1e"), Color("#f4efe4"), Color("#c0392b")]
	var w := 40
	var h := 56
	var img := Image.create_empty(w, h, false, Image.FORMAT_RGBA8)
	var noise := FastNoiseLite.new()
	noise.seed = 31 + i
	noise.frequency = 0.2
	var field: Color = fields[i % fields.size()]
	var ink: Color = inks[i % inks.size()]
	for y in h:
		for x in w:
			var c := field
			if y > 6 and y < 16 and x > 4 and x < w - 4:
				c = ink
			elif y > 20 and y < 40 and x > 10 and x < w - 10:
				c = field.darkened(0.35)
			elif y > 44 and y < 50 and x > 6 and x < w - 6:
				c = ink
			var torn := noise.get_noise_2d(x, y) * 0.5 + 0.5
			var border := mini(mini(x, w - 1 - x), mini(y, h - 1 - y))
			var a := 0.0 if border < 1 + int(torn * 3.0) else 0.92
			var fade := 0.85 + noise.get_noise_2d(x * 2.0, y * 2.0) * 0.15
			img.set_pixel(x, y, Color(c.r * fade, c.g * fade, c.b * fade, a))
	var t := ImageTexture.create_from_image(img)
	_textures[key] = t
	return t
