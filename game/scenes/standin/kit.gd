## Parts kit for the stand-in scenes: palette, materials and the props every block uses (shop houses, trees, street
## lights, signals, vehicles, people, carts). Every part is built in a local frame that faces -Z (north at rotation
## 0), origin on the ground, and goes into a Geo.Sink. Colours are the CITY_BRIEF.md "Materials" estimates.
## Stand-ins only: no textures, no final art. Shapes keep smooth silhouettes (Geo.SEG_ROUND on round parts).
extends RefCounted

const Geo := preload("res://scenes/standin/geo.gd")

const SAND_RED := Color("#a4533b")
const SAND_BUFF := Color("#c9a77c")
const PLASTER := Color("#e8e3d5")
const BRICK := Color("#8f5e45")
const LIME := Color("#d8cdb4")
const MINT := Color("#9ec3a8")
const PINK := Color("#d9a79a")
const OCHRE := Color("#d6a84e")
const CEMENT := Color("#8c8a84")
const GLASS := Color("#3d4f5a")
const SHUTTER := Color("#7a7d7e")
const ASPHALT := Color("#3e3d3a")
const AUTO_GREEN := Color("#3fa36b")
const AUTO_YELLOW := Color("#f2c230")
const PAVER := Color("#9a8d80")
const KERB := Color("#b5b1a8")
const GRASS := Color("#6d8a3e")
const DIRT := Color("#a08a68")
const LEAF := Color("#4f6a2c")
const TRUNK := Color("#5a4636")
const STEEL := Color("#5b5f62")
const BLACK := Color("#1c1c1e")
const WHITE := Color("#f2f0ea")
const MARK := Color("#e9e6dc")

const FACADES := [Color("#e8e3d5"), Color("#d8cdb4"), Color("#d9a79a"), Color("#9ec3a8"), Color("#d6a84e"),
	Color("#c7b9a1"), Color("#b9a48a"), Color("#e2d6b8"), Color("#c98f6b"), Color("#a9b6b0")]
const BOARDS := [Color("#c0392b"), Color("#f2c230"), Color("#1f5fa8"), Color("#2e8b57"), Color("#f4efe4"),
	Color("#e67e22"), Color("#7b2d8b"), Color("#0f7c7c"), Color("#d6336c")]
const CLOTHES := [Color("#f4efe4"), Color("#2c3e70"), Color("#b03a2e"), Color("#e6b422"), Color("#3a7d44"),
	Color("#7a4a8c"), Color("#d35400"), Color("#8e8a83"), Color("#1f6f8b"), Color("#c2185b"), Color("#5d4037"),
	Color("#ece0c8")]
const SKIN := [Color("#8d5a3b"), Color("#a86b45"), Color("#c68a5e"), Color("#6f4630"), Color("#b97c53")]
const CAR_PAINT := [Color("#eeeeec"), Color("#c9cbcc"), Color("#8e9294"), Color("#eeeeec"), Color("#2b2d30"),
	Color("#8a1f1f"), Color("#1f3d6b"), Color("#eeeeec")]
## Invented shop names (CITY_BRIEF.md "Signage and script": no real brands). Latin script only for now: the
## default font has no Devanagari, and a missing glyph box is a rubric fail.
const SHOP_NAMES := ["Gupta Electricals", "New Bharat Sweets", "Raj Mobile Point", "Shiv Shakti Hardware",
	"Kapoor Opticals", "Lucky Photostat", "Royal Tailors", "Jai Hind Dhaba", "Sharma Medicos", "Ganesh Steel",
	"Anand Paints", "Krishna Book Depot", "Sai Tent House", "Noor Cloth House", "Hira Jewellers", "City Chemist",
	"Laxmi Bartan", "Punjab Sweets", "Bhola Chaat", "Mehta Auto Parts", "Ravi Studio", "Diamond Footwear",
	"Durga Kirana Store", "Gulati Watch Co", "Singh Tyres", "Rahmat Electric", "Fresh Juice Corner",
	"Balaji Plastics", "Hanuman Glass", "DSouza Bakery", "Verma Cycle Store", "Arora Furnishing", "Sethi Dry Fruits",
	"Khan Biryani", "Jain Stationers", "Bansal Kirana", "Prakash Lights", "Delhi Tent Co"]

## Material keys used by every Sink. "glow" is unshaded (lamp heads, signal lamps).
static func materials() -> Dictionary:
	var m := {}
	m["matte"] = _mat(0.92, 0.0)
	m["road"] = _mat(0.97, 0.0)
	m["satin"] = _mat(0.55, 0.0)
	m["metal"] = _mat(0.45, 0.6)
	m["paint"] = _mat(0.32, 0.25)
	m["glass"] = _mat(0.08, 0.5)
	m["leaf"] = _mat(1.0, 0.0)
	var g := StandardMaterial3D.new()
	g.vertex_color_use_as_albedo = true
	g.vertex_color_is_srgb = true
	g.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m["glow"] = g
	# the key as the resource name, so a style test (game/render/style_runner.gd) can swap the material by key
	for k in m:
		m[k].resource_name = k
	return m


static func _mat(rough: float, metal: float) -> StandardMaterial3D:
	var s := StandardMaterial3D.new()
	s.vertex_color_use_as_albedo = true
	s.vertex_color_is_srgb = true
	s.roughness = rough
	s.metallic = metal
	return s


static func pick(rng: RandomNumberGenerator, list: Array) -> Variant:
	return list[rng.randi_range(0, list.size() - 1)]


static func shade(c: Color, f: float) -> Color:
	return Color(c.r * f, c.g * f, c.b * f, 1.0)


## Local frame at ground position p facing direction yaw (0 = -Z).
static func at(p: Vector3, yaw := 0.0) -> Transform3D:
	return Transform3D(Basis(Vector3.UP, yaw), p)


# ------------------------------------------------------------------ buildings


## A shop house in the local frame: front face on z = 0 facing -Z, x from -w/2 to w/2, depth d behind (+Z).
## o: floors, wear (0..1 darker base), board (bool), awning (bool), balcony share, tight (old city, more clutter).
## Returns the sign board's local centre and size (or null) so the caller can put a label on it.
static func shop_house(s: Geo.Sink, rng: RandomNumberGenerator, w: float, d: float, o: Dictionary) -> Variant:
	var floors: int = o.get("floors", 3)
	var fh := 3.2
	var h := floors * fh + 0.4
	var col: Color = o.get("color", pick(rng, FACADES))
	var tight: bool = o.get("tight", false)
	s.box("matte", col, Vector3(0, h * 0.5, d * 0.5), Vector3(w, h, d))
	# plinth and base grime band
	s.box("matte", shade(col, 0.62), Vector3(0, 0.25, -0.02), Vector3(w, 0.5, 0.06))
	# ground floor: shop opening, half raised shutter, goods
	var ow := w - 0.7
	s.anchor("shop", Transform3D.IDENTITY, {"w": w, "d": d, "h": h, "floors": floors, "tight": tight, "col": col, "ow": ow})
	s.box("matte", Color("#4a3a2c"), Vector3(0, 1.45, -0.02), Vector3(ow, 2.7, 0.05))
	s.box("matte", Color("#6a5848"), Vector3(0, 1.3, -0.03), Vector3(ow - 0.4, 1.2, 0.04))
	for i in maxi(1, int(ow / 1.6)):
		s.ball("glow", Color("#ffe2a8"), Vector3(-ow * 0.5 + 0.8 + i * 1.6, 2.15, -0.12), Vector3.ONE * 0.06, Geo.SEG_SMALL)
	s.box("metal", shade(SHUTTER, rng.randf_range(0.8, 1.1)), Vector3(0, 2.55, -0.05), Vector3(ow, 0.5, 0.06))
	s.box("matte", Color("#5b4636"), Vector3(0, 0.35, -0.25), Vector3(ow - 0.2, 0.7, 0.45))
	var goods := int(ow / 0.7)
	for i in goods:
		var gx := -ow * 0.5 + 0.45 + i * (ow - 0.9) / maxf(1, goods - 1)
		var gc: Color = shade(pick(rng, CLOTHES) if rng.randf() < 0.6 else pick(rng, BOARDS), rng.randf_range(0.6, 0.85))
		if rng.randf() < 0.5:
			s.ball("satin", gc, Vector3(gx, 0.86, -0.28), Vector3(0.28, 0.17, 0.2), Geo.SEG_SMALL)
		else:
			var gh := rng.randf_range(0.2, 0.45)
			s.box("satin", gc, Vector3(gx, 0.7 + gh * 0.5, -0.28), Vector3(0.5, gh, 0.32))
	# floor bands and windows
	for f in range(1, floors):
		var y := f * fh + 0.4
		s.box("matte", shade(col, 0.85), Vector3(0, y, -0.06), Vector3(w + 0.1, 0.18, 0.14))
		var n := maxi(1, int(w / 2.6))
		for i in n:
			var wx := -w * 0.5 + w * (i + 0.5) / n
			s.box("matte", shade(col, 0.75), Vector3(wx, y + 1.5, -0.025), Vector3(1.3, 1.7, 0.05))
			s.box("glass", GLASS, Vector3(wx, y + 1.5, -0.04), Vector3(1.05, 1.45, 0.04))
			s.anchor("window", Transform3D(Basis.IDENTITY, Vector3(wx, y + 1.5, 0)), {"f": f, "w": 1.05, "h": 1.45})
			if rng.randf() < 0.25:
				s.box("satin", Color("#d9d9d4"), Vector3(wx + 0.75, y + 1.0, -0.3), Vector3(0.8, 0.55, 0.5))
				s.anchor("ac", Transform3D(Basis.IDENTITY, Vector3(wx + 0.75, y + 1.0, -0.3)))
		if rng.randf() < o.get("balcony", 0.35):
			var bw := w * rng.randf_range(0.5, 0.9)
			s.box("matte", shade(col, 0.9), Vector3(0, y + 0.05, -0.55), Vector3(bw, 0.15, 1.1))
			s.box("metal", Color("#3a3f44"), Vector3(0, y + 0.6, -1.08), Vector3(bw, 0.9, 0.04))
			var bd := {"bw": bw, "laundry": false}
			s.anchor("balcony", Transform3D(Basis.IDENTITY, Vector3(0, y + 0.13, -1.08)), bd)
			if tight and rng.randf() < 0.5:
				bd.laundry = true
				# washing line with clothes
				for k in 4:
					s.box("satin", pick(rng, CLOTHES), Vector3(-bw * 0.4 + k * bw * 0.25, y + 1.05, -1.0), Vector3(0.5, 0.6, 0.02))
	# sign board band above the shop
	var board = null
	if o.get("board", true):
		var bc: Color = pick(rng, BOARDS)
		var bh := 0.95
		s.box("satin", bc, Vector3(0, 3.35, -0.12), Vector3(w - 0.25, bh, 0.12))
		board = {"pos": Vector3(0, 3.35, -0.185), "size": Vector2(w - 0.25, bh), "color": bc}
		s.anchor("board", Transform3D(Basis.IDENTITY, Vector3(0, 3.35, -0.18)), {"w": w - 0.25, "h": bh})
		if tight and floors > 2 and rng.randf() < 0.6:
			var b2: Color = pick(rng, BOARDS)
			var b2x := rng.randf_range(-0.3, 0.3)
			s.box("satin", b2, Vector3(b2x, 5.1, -0.1), Vector3(w * 0.7, 0.8, 0.1))
			s.anchor("board2", Transform3D(Basis.IDENTITY, Vector3(b2x, 5.1, -0.15)), {"w": w * 0.7, "h": 0.8, "color": b2})
	if o.get("awning", false):
		var ac: Color = pick(rng, BOARDS)
		s.anchor("awning", Transform3D.IDENTITY, {"w": w - 0.3})
		# cloth awning sloping down and out from the facade
		s.put("satin", Geo.unit_box(), Transform3D(Basis(Vector3.RIGHT, deg_to_rad(-14)) * Basis.from_scale(Vector3(w - 0.3, 0.04, 1.5)),
			Vector3(0, 2.92, -0.73)), ac)
	# roof: parapet, water tank, stair cabin
	s.box("matte", shade(col, 0.92), Vector3(0, h + 0.45, 0.1), Vector3(w, 0.9, 0.2))
	s.box("matte", shade(col, 0.92), Vector3(0, h + 0.45, d - 0.1), Vector3(w, 0.9, 0.2))
	s.anchor("roof", Transform3D(Basis.IDENTITY, Vector3(0, h, d * 0.5)), {"w": w, "d": d})
	if rng.randf() < 0.7:
		var tx := rng.randf_range(-w * 0.3, w * 0.3)
		s.anchor("tank", Transform3D(Basis.IDENTITY, Vector3(tx, h + 0.15, d * 0.6)))
		s.cyl("satin", Color("#202224"), Vector3(tx, h + 0.75, d * 0.6), 0.55, 1.2, Geo.SEG_MID)
		s.cyl("satin", Color("#202224"), Vector3(tx, h + 1.4, d * 0.6), 0.2, 0.12, Geo.SEG_SMALL)
	if rng.randf() < 0.4:
		s.box("matte", shade(col, 0.95), Vector3(-w * 0.2, h + 1.2, d * 0.75), Vector3(2.2, 2.4, 2.4))
	return board


## A plain far massing block (city beyond the street edge; no detail, fog hides it).
static func far_block(s: Geo.Sink, rng: RandomNumberGenerator, w: float, d: float, h: float) -> void:
	var col: Color = pick(rng, FACADES)
	s.box("matte", shade(col, 0.9), Vector3(0, h * 0.5, d * 0.5), Vector3(w, h, d))
	s.cyl("satin", Color("#202224"), Vector3(0, h + 0.6, d * 0.5), 0.55, 1.2, Geo.SEG_MID)
	s.anchor("tank", Transform3D(Basis.IDENTITY, Vector3(0, h, d * 0.5)), {"lid": false})
	s.anchor("roof", Transform3D(Basis.IDENTITY, Vector3(0, h, d * 0.5)), {"w": w, "d": d, "far": true})


# ------------------------------------------------------------------ street furniture


static func tree(s: Geo.Sink, rng: RandomNumberGenerator, scale := 1.0) -> void:
	var h := rng.randf_range(4.5, 6.5) * scale
	s.cyl("matte", TRUNK, Vector3(0, h * 0.4, 0), 0.22 * scale, h * 0.8, Geo.SEG_MID, 0.6)
	s.rod("matte", TRUNK, Vector3(0, h * 0.55, 0), Vector3(0.9, h * 0.85, 0.3) * Vector3(scale, 1, scale), 0.09 * scale, Geo.SEG_SMALL, 0.6)
	var lc := shade(LEAF, rng.randf_range(0.85, 1.15))
	var blobs := [Vector3(0, h, 0), Vector3(1.2, h - 0.3, 0.4), Vector3(-1.0, h - 0.2, -0.6), Vector3(0.2, h + 0.7, 0.8),
		Vector3(-0.4, h + 0.5, -1.0)]
	for b in blobs:
		var r := rng.randf_range(1.5, 2.1) * scale
		s.ball("leaf", shade(lc, rng.randf_range(0.9, 1.1)), Vector3(b.x * scale, b.y, b.z * scale), Vector3(r, r * 0.8, r), Geo.SEG_MID)


## Street light: pole on the ground, arms reaching along local -Z (and +Z when double).
static func street_light(s: Geo.Sink, h := 9.0, double := false) -> void:
	s.cyl("metal", STEEL, Vector3(0, h * 0.5, 0), 0.11, h, Geo.SEG_SMALL, 0.6)
	s.cyl("matte", KERB, Vector3(0, 0.3, 0), 0.22, 0.6, Geo.SEG_SMALL)
	var dirs := [-1.0, 1.0] if double else [-1.0]
	for dz in dirs:
		s.rod("metal", STEEL, Vector3(0, h - 0.3, 0), Vector3(0, h + 0.2, dz * 1.8), 0.05, Geo.SEG_SMALL)
		s.box("satin", Color("#4a4e52"), Vector3(0, h + 0.18, dz * 2.1), Vector3(0.4, 0.16, 0.8))
		s.box("glow", Color("#fff3d6"), Vector3(0, h + 0.09, dz * 2.1), Vector3(0.3, 0.03, 0.6))
		s.anchor("lamp", Transform3D(Basis.IDENTITY, Vector3(0, h + 0.05, dz * 2.1)), {"h": h, "dz": dz})


## Signal post with three lamps facing -Z; lit: "red", "amber" or "green". Optional mast arm over the road (+X).
static func signal_post(s: Geo.Sink, lit: String, arm := 0.0) -> void:
	s.cyl("metal", Color("#2b2e30"), Vector3(0, 2.4, 0), 0.09, 4.8, Geo.SEG_SMALL)
	_signal_head(s, Vector3(0, 3.6, -0.2), lit)
	if arm != 0.0:
		s.rod("metal", Color("#2b2e30"), Vector3(0, 5.6, 0), Vector3(arm, 5.9, 0), 0.08, Geo.SEG_SMALL)
		s.cyl("metal", Color("#2b2e30"), Vector3(0, 5.2, 0), 0.1, 1.0, Geo.SEG_SMALL)
		_signal_head(s, Vector3(arm * 0.85, 5.2, -0.2), lit)


static func _signal_head(s: Geo.Sink, c: Vector3, lit: String) -> void:
	s.box("satin", Color("#1a1a1a"), c, Vector3(0.42, 1.2, 0.3))
	var lamps := {"red": [Color("#ff2a1a"), 0.38], "amber": [Color("#ffb020"), 0.0], "green": [Color("#25d366"), -0.38]}
	var basis := Basis(Vector3.RIGHT, PI * 0.5)
	for k in lamps:
		var on: bool = k == lit
		var lc: Color = lamps[k][0] if on else shade(lamps[k][0], 0.18)
		var pos := c + Vector3(0, lamps[k][1], -0.16)
		s.put("glow" if on else "satin", Geo.unit_cyl(Geo.SEG_MID), Transform3D(basis * Basis.from_scale(Vector3(0.13, 0.03, 0.13)), pos), lc)
		s.box("satin", Color("#111111"), pos + Vector3(0, 0.15, -0.07), Vector3(0.32, 0.03, 0.18))


## Bus shelter facing -Z (riders face -Z): curved roof, back panel with an ad, bench.
static func bus_stop(s: Geo.Sink, w := 7.0) -> Dictionary:
	for x in [-w * 0.5 + 0.2, w * 0.5 - 0.2]:
		s.cyl("metal", STEEL, Vector3(x, 1.45, 0.9), 0.06, 2.9, Geo.SEG_SMALL)
		s.cyl("metal", STEEL, Vector3(x, 1.45, -0.6), 0.06, 2.9, Geo.SEG_SMALL)
	# roof: shell arc in the (z, y) plane extruded along x
	var shell := Geo.arc_shell(Vector2(0, 0), 4.0, 0.06, deg_to_rad(68), deg_to_rad(112))
	var xf := Transform3D(Geo.side(), Vector3(w * 0.5, -1.0, 0.2))
	s.ext("metal", Color("#c8ccce"), shell, w, xf)
	s.box("satin", Color("#d0d4d6"), Vector3(0, 1.4, 0.95), Vector3(w - 0.4, 1.9, 0.05))
	s.box("satin", Color("#1f5fa8"), Vector3(w * 0.25, 1.5, 0.92), Vector3(2.2, 1.4, 0.03))
	s.box("metal", STEEL, Vector3(0, 0.48, 0.55), Vector3(w - 1.0, 0.06, 0.45))
	for x in [-w * 0.3, 0.0, w * 0.3]:
		s.box("metal", STEEL, Vector3(x, 0.24, 0.55), Vector3(0.06, 0.48, 0.4))
	return {"ad": Vector3(w * 0.25, 1.5, 0.905)}


## Steel railing along local Z from z0 to z1 (median and footpath edges).
static func railing(s: Geo.Sink, z0: float, z1: float, h := 1.0, step := 2.5) -> void:
	var n := int(absf(z1 - z0) / step)
	for i in n + 1:
		var z := lerpf(z0, z1, float(i) / n)
		s.cyl("metal", Color("#6b7073"), Vector3(0, h * 0.5, z), 0.035, h, Geo.SEG_SMALL)
	for y in [h * 0.45, h]:
		s.rod("metal", Color("#6b7073"), Vector3(0, y, z0), Vector3(0, y, z1), 0.03, Geo.SEG_SMALL)


## Black and yellow painted kerb stones along local Z (median kerbs), stone length 1 m.
static func painted_kerb(s: Geo.Sink, z0: float, z1: float, h: float) -> void:
	var n := int(absf(z1 - z0))
	for i in n:
		var z := lerpf(z0, z1, (i + 0.5) / n)
		s.box("satin", Color("#1e1e1e") if i % 2 == 0 else Color("#f0c419"), Vector3(0, h * 0.5, z), Vector3(0.2, h, absf(z1 - z0) / n))


# ------------------------------------------------------------------ vehicles


## A car facing -Z, origin on the ground at its centre. Side profile extruded across its width.
static func car(s: Geo.Sink, col: Color, kind := "hatch") -> void:
	var L := 4.2 if kind != "sedan" else 4.6
	var W := 1.74
	var hl := L * 0.5
	var body := PackedVector2Array([Vector2(-hl, 0.32), Vector2(-hl - 0.04, 0.55), Vector2(-hl + 0.04, 0.78),
		Vector2(-hl + 0.3, 0.88), Vector2(-hl + 1.15, 0.98), Vector2(-hl + 1.75, 1.42), Vector2(hl - 1.25, 1.46),
		Vector2(hl - 0.55, 1.05), Vector2(hl - 0.08, 0.98), Vector2(hl + 0.02, 0.72), Vector2(hl - 0.02, 0.32)])
	if kind == "suv":
		body = PackedVector2Array([Vector2(-hl, 0.4), Vector2(-hl - 0.04, 0.65), Vector2(-hl + 0.05, 0.98),
			Vector2(-hl + 0.4, 1.08), Vector2(-hl + 1.05, 1.15), Vector2(-hl + 1.55, 1.68), Vector2(hl - 0.3, 1.72),
			Vector2(hl - 0.05, 1.5), Vector2(hl + 0.02, 0.8), Vector2(hl - 0.02, 0.4)])
	# profile is in (z, y): x of the outline = local z. Geo.side() maps outline x -> +Z, y -> +Y, extrusion -> -X.
	# Lower body up to the belt line at full width; the cabin (glass with a paint roof and pillars) is narrower,
	# like a real car's tumblehome, so the car does not read as one box from behind.
	var side := Geo.side()
	var lower := body.slice(0, 5)
	lower.append_array(body.slice(7))
	s.ext("paint", col, lower, W, Transform3D(side, Vector3(W * 0.5, 0, 0)))
	var top := body.slice(4, 8)
	var cw := W * 0.86
	var cab := PackedVector2Array([top[0] + Vector2(0.02, -0.08), top[0], top[1], top[2], top[3], top[3] + Vector2(-0.02, -0.08)])
	s.ext("glass", GLASS, cab, cw, Transform3D(side, Vector3(cw * 0.5, 0, 0)))
	var roof := PackedVector2Array([top[1] + Vector2(-0.03, 0.03), top[2] + Vector2(0.03, 0.03),
		top[2] + Vector2(0.08, -0.07), top[1] + Vector2(-0.08, -0.07)])
	s.ext("paint", col, roof, cw + 0.03, Transform3D(side, Vector3(cw * 0.5 + 0.015, 0, 0)))
	var mid := (top[1] + top[2]) * 0.5
	var belt := (top[0] + top[3]) * 0.5
	for xs in [-1.0, 1.0]:
		s.rod("paint", col, Vector3(xs * (cw * 0.5 + 0.005), belt.y, belt.x), Vector3(xs * (cw * 0.5 + 0.005), mid.y, mid.x - 0.05), 0.05, Geo.SEG_SMALL)
	for zf in [-1.0, 1.0]:
		for xs in [-1.0, 1.0]:
			_wheel(s, Vector3(xs * (W * 0.5 - 0.06), 0.33, zf * (hl - 0.82)), 0.33, 0.22)
	for xs in [-1.0, 1.0]:
		s.box("glow", Color("#fff6dc"), Vector3(xs * 0.6, 0.75, -hl - 0.0), Vector3(0.32, 0.12, 0.06))
		s.box("glow", Color("#c81e1e"), Vector3(xs * 0.62, 0.82, hl + 0.01), Vector3(0.28, 0.12, 0.05))
	s.box("satin", Color("#202020"), Vector3(0, 0.4, -hl - 0.03), Vector3(W * 0.9, 0.16, 0.1))
	s.box("satin", Color("#202020"), Vector3(0, 0.4, hl + 0.03), Vector3(W * 0.9, 0.16, 0.1))


static func _wheel(s: Geo.Sink, c: Vector3, r: float, w: float) -> void:
	var b := Basis(Vector3.BACK, PI * 0.5)
	s.put("satin", Geo.unit_cyl(Geo.SEG_ROUND), Transform3D(b * Basis.from_scale(Vector3(r, w, r)), c), Color("#1b1b1b"))
	s.put("metal", Geo.unit_cyl(Geo.SEG_ROUND), Transform3D(b * Basis.from_scale(Vector3(r * 0.58, w + 0.02, r * 0.58)), c), Color("#9da3a6"))


## CNG auto-rickshaw facing -Z: green body, yellow canopy, three wheels (wheels false: the body only, for a vehicle
## that draws its own turning wheels).
static func auto_rickshaw(s: Geo.Sink, wheels := true) -> void:
	var side := Geo.side()
	var W := 1.32
	# lower tub and front fairing (profile in z, y)
	var tub := PackedVector2Array([Vector2(-1.3, 0.3), Vector2(-1.42, 0.55), Vector2(-1.38, 0.95), Vector2(-1.2, 1.12),
		Vector2(-1.05, 1.1), Vector2(-0.95, 0.62), Vector2(0.35, 0.6), Vector2(0.45, 0.9), Vector2(1.2, 0.92),
		Vector2(1.3, 0.7), Vector2(1.25, 0.3)])
	s.ext("paint", AUTO_GREEN, tub, W, Transform3D(side, Vector3(W * 0.5, 0, 0)))
	# canopy: a bent plate from the windscreen top over to the back (black), yellow roof skin on top
	var canopy := PackedVector2Array([Vector2(-1.08, 1.6), Vector2(-1.0, 1.72), Vector2(-0.8, 1.78), Vector2(-0.2, 1.8),
		Vector2(0.5, 1.79), Vector2(0.95, 1.72), Vector2(1.2, 1.55), Vector2(1.3, 1.3), Vector2(1.32, 0.95)])
	s.ext("satin", Color("#1d1d1d"), Geo.strip(canopy, 0.05), W + 0.04, Transform3D(side, Vector3(W * 0.5 + 0.02, 0, 0)))
	var skin := PackedVector2Array()
	for p in canopy.slice(0, 7):
		skin.append(p + Vector2(0, 0.025))
	s.ext("paint", AUTO_YELLOW, Geo.strip(skin, 0.03), W + 0.07, Transform3D(side, Vector3(W * 0.5 + 0.035, 0, 0)))
	# windscreen and pillars
	s.box("glass", GLASS, Vector3(0, 1.4, -1.0), Vector3(W * 0.9, 0.55, 0.03), 0.0)
	for xs in [-1.0, 1.0]:
		s.rod("metal", BLACK, Vector3(xs * W * 0.47, 1.1, -1.05), Vector3(xs * W * 0.47, 1.72, -0.98), 0.025, Geo.SEG_SMALL)
	s.box("satin", Color("#2b2b2b"), Vector3(0, 0.95, 0.75), Vector3(W * 0.92, 0.12, 0.6))
	s.box("satin", Color("#2b2b2b"), Vector3(0, 1.25, 1.05), Vector3(W * 0.92, 0.55, 0.1))
	if wheels:
		_wheel(s, Vector3(0, 0.23, -1.05), 0.23, 0.14)
		for xs in [-1.0, 1.0]:
			_wheel(s, Vector3(xs * (W * 0.5 - 0.02), 0.23, 0.85), 0.23, 0.14)
	s.box("glow", Color("#fff6dc"), Vector3(0, 0.85, -1.42), Vector3(0.22, 0.14, 0.05))


## City bus facing -Z (invented green and cream livery).
static func bus(s: Geo.Sink) -> void:
	var side := Geo.side()
	var W := 2.55
	var L := 12.0
	var prof := Geo.rounded_rect(-L * 0.5, 0.35, L * 0.5, 3.2, 0.3)
	s.ext("paint", Color("#3c8d4f"), prof, W, Transform3D(side, Vector3(W * 0.5, 0, 0)))
	s.box("paint", Color("#ece4c8"), Vector3(0, 2.75, 0), Vector3(W + 0.02, 0.5, L - 0.5))
	s.box("glass", GLASS, Vector3(0, 2.0, 0.3), Vector3(W + 0.03, 0.95, L - 1.6))
	s.box("glass", GLASS, Vector3(0, 1.9, -L * 0.5 - 0.01), Vector3(W - 0.3, 1.5, 0.04))
	s.box("satin", Color("#2a2a2a"), Vector3(W * 0.5 + 0.02, 1.4, -L * 0.5 + 1.6), Vector3(0.03, 2.3, 1.1))
	s.box("satin", Color("#2a2a2a"), Vector3(W * 0.5 + 0.02, 1.4, 1.5), Vector3(0.03, 2.3, 1.1))
	for zf in [-L * 0.5 + 2.4, L * 0.5 - 2.8]:
		for xs in [-1.0, 1.0]:
			_wheel(s, Vector3(xs * (W * 0.5 - 0.15), 0.5, zf), 0.5, 0.32)
	for xs in [-1.0, 1.0]:
		s.box("glow", Color("#fff6dc"), Vector3(xs * 0.9, 0.7, -L * 0.5 - 0.02), Vector3(0.3, 0.16, 0.04))
	s.box("glow", Color("#ffb020"), Vector3(0, 3.0, -L * 0.5 - 0.02), Vector3(1.6, 0.25, 0.04))
	s.box("glass", GLASS, Vector3(0, 2.15, L * 0.5 + 0.01), Vector3(W - 0.5, 0.9, 0.04))
	for xs in [-1.0, 1.0]:
		s.box("glow", Color("#c81e1e"), Vector3(xs * 1.0, 0.8, L * 0.5 + 0.02), Vector3(0.25, 0.3, 0.04))
	s.box("satin", Color("#2a2a2a"), Vector3(0, 0.45, L * 0.5 + 0.04), Vector3(W - 0.1, 0.22, 0.1))


## Scooter facing -Z (parked or ridden; wheels false: the body only).
static func scooter(s: Geo.Sink, col: Color, wheels := true) -> void:
	if wheels:
		_wheel(s, Vector3(0, 0.25, -0.6), 0.25, 0.1)
		_wheel(s, Vector3(0, 0.25, 0.6), 0.25, 0.1)
	s.box("paint", col, Vector3(0, 0.5, 0.25), Vector3(0.36, 0.45, 1.0))
	s.box("satin", BLACK, Vector3(0, 0.78, 0.3), Vector3(0.3, 0.1, 0.7))
	s.rod("paint", col, Vector3(0, 0.3, -0.6), Vector3(0, 1.0, -0.5), 0.12, Geo.SEG_SMALL)
	s.rod("metal", BLACK, Vector3(-0.32, 1.05, -0.5), Vector3(0.32, 1.05, -0.5), 0.02, Geo.SEG_SMALL)


## The player's auto body (P1-021): the auto without wheels and the driver at the handlebar (Bittu's stand-in colours).
static func driven_auto(s: Geo.Sink) -> void:
	auto_rickshaw(s, false)
	seated_rider(s, {"hips": Vector3(0, 0.9, -0.38), "lean": 0.06, "hands": Vector3(0.27, 1.17, -0.86),
		"knee": Vector3(0.15, 0.98, -0.72), "foot": Vector3(0.13, 0.63, -0.86), "top": Color("#8a8d86"),
		"bottom": Color("#3b3a36"), "skin": Color("#8d5a3b"), "head": Color("#1b1714")})


## The player's scooter body (P1-021): the scooter without wheels, a footboard and a seated rider with a helmet (the
## fixer's stand-in colours: maroon jacket).
static func ridden_scooter(s: Geo.Sink, col: Color) -> void:
	scooter(s, col, false)
	s.box("satin", BLACK, Vector3(0, 0.34, -0.36), Vector3(0.34, 0.06, 0.32))
	seated_rider(s, {"hips": Vector3(0, 0.88, 0.32), "lean": 0.18, "hands": Vector3(0.3, 1.06, -0.5),
		"knee": Vector3(0.16, 0.94, -0.1), "foot": Vector3(0.13, 0.4, -0.32), "top": Color("#7a2430"),
		"bottom": Color("#2c2f36"), "skin": Color("#a86b45"), "head": Color("#202326")})


## A seated rider in the local frame of the vehicle (faces -Z): hips at o.hips, the torso leaning forward by o.lean
## radians, hands, knees and feet given for the right side (mirrored in x by position only, never by scale).
static func seated_rider(s: Geo.Sink, o: Dictionary) -> void:
	var hips: Vector3 = o.hips
	var lean: float = o.get("lean", 0.0)
	var top: Color = o.top
	var bottom: Color = o.bottom
	var skin: Color = o.skin
	var up := Vector3(0, cos(lean), -sin(lean))
	var chest := hips + up * 0.5
	var neck := hips + up * 0.6
	for xs in [-1.0, 1.0]:
		var m := Vector3(xs, 1, 1)
		var knee: Vector3 = o.knee * m
		var foot: Vector3 = o.foot * m
		var hip := hips + Vector3(xs * 0.1, 0, 0)
		s.rod("satin", bottom, hip, knee, 0.075, Geo.SEG_SMALL, 0.9)
		s.rod("satin", bottom, knee, foot, 0.06, Geo.SEG_SMALL, 0.85)
		s.box("satin", Color("#2a211c"), foot + Vector3(0, -0.02, -0.06), Vector3(0.1, 0.07, 0.24))
		var shoulder := chest + Vector3(xs * 0.2, 0.0, 0.0)
		var hand: Vector3 = o.hands * m
		var elbow := (shoulder + hand) * 0.5 + Vector3(xs * 0.06, -0.1, 0.04)
		s.rod("satin", top, shoulder, elbow, 0.05, Geo.SEG_SMALL, 0.9)
		s.rod("satin", skin, elbow, hand, 0.04, Geo.SEG_SMALL, 0.85)
	s.rod("satin", top, hips + Vector3(0, 0.02, 0), chest, 0.17, Geo.SEG_MID, 1.2)
	s.ball("satin", top, chest, Vector3(0.21, 0.08, 0.13), Geo.SEG_MID)
	s.rod("satin", skin, chest, neck, 0.05, Geo.SEG_SMALL)
	var head := neck + up * 0.13
	s.ball("satin", skin, head, Vector3(0.1, 0.125, 0.11), Geo.SEG_MID)
	s.dome("satin", o.get("head", Color("#1b1714")), head + Vector3(0, 0.03, 0.01), 0.112, 0.11, Geo.SEG_MID)


## Vendor handcart facing -Z with a heap of goods.
static func handcart(s: Geo.Sink, rng: RandomNumberGenerator) -> void:
	s.box("matte", Color("#6e4b2f"), Vector3(0, 0.85, 0), Vector3(1.1, 0.08, 2.0))
	for xs in [-1.0, 1.0]:
		_wheel(s, Vector3(xs * 0.62, 0.45, 0.1), 0.45, 0.06)
		s.rod("matte", Color("#6e4b2f"), Vector3(xs * 0.45, 0.85, -1.0), Vector3(xs * 0.4, 0.75, -1.6), 0.03, Geo.SEG_SMALL)
	for i in 10:
		var gc: Color = pick(rng, [Color("#e74c3c"), Color("#f39c12"), Color("#27ae60"), Color("#f1c40f"), Color("#d35400")])
		s.ball("satin", gc, Vector3(rng.randf_range(-0.4, 0.4), 0.98 + rng.randf_range(0, 0.1), rng.randf_range(-0.8, 0.8)), Vector3.ONE * 0.16, Geo.SEG_SMALL)
	s.box("satin", Color("#d9c9a0"), Vector3(0, 1.0, 0), Vector3(1.0, 0.12, 1.9))


## A person stand-in (smooth mannequin) facing -Z, feet at the origin. o: height, skin, top, bottom, saree.
static func person(s: Geo.Sink, rng: RandomNumberGenerator, o := {}) -> void:
	var h: float = o.get("height", rng.randf_range(1.55, 1.8))
	var k := h / 1.7
	var skin: Color = o.get("skin", pick(rng, SKIN))
	var top: Color = o.get("top", pick(rng, CLOTHES))
	var bottom: Color = o.get("bottom", pick(rng, [Color("#2c2f36"), Color("#4a4e58"), Color("#e9e2d0"), Color("#6b5a48"), top]))
	var saree: bool = o.get("saree", rng.randf() < 0.3)
	if saree:
		s.cyl("satin", bottom, Vector3(0, 0.45 * k, 0), 0.26 * k, 0.9 * k, Geo.SEG_MID, 0.62)
		s.cyl("satin", top, Vector3(0, 0.98 * k, 0), 0.18 * k, 0.36 * k, Geo.SEG_MID, 1.0)
	else:
		for xs in [-1.0, 1.0]:
			s.rod("satin", bottom, Vector3(xs * 0.09 * k, 0.04, 0), Vector3(xs * 0.1 * k, 0.86 * k, 0), 0.075 * k, Geo.SEG_SMALL, 1.25)
			s.box("satin", Color("#2a211c"), Vector3(xs * 0.09 * k, 0.04, -0.05), Vector3(0.11 * k, 0.08, 0.26 * k))
	# torso: tapered cylinder plus rounded shoulders
	s.cyl("satin", top, Vector3(0, 1.12 * k, 0), 0.17 * k, 0.56 * k, Geo.SEG_MID, 1.22)
	s.ball("satin", top, Vector3(0, 1.38 * k, 0), Vector3(0.21, 0.08, 0.13) * k, Geo.SEG_MID)
	for xs in [-1.0, 1.0]:
		s.rod("satin", top, Vector3(xs * 0.2 * k, 1.38 * k, 0), Vector3(xs * 0.24 * k, 1.1 * k, 0.02), 0.05 * k, Geo.SEG_SMALL, 0.9)
		s.rod("satin", skin, Vector3(xs * 0.24 * k, 1.1 * k, 0.02), Vector3(xs * 0.25 * k, 0.86 * k, -0.03), 0.04 * k, Geo.SEG_SMALL, 0.85)
	s.cyl("satin", skin, Vector3(0, 1.47 * k, 0), 0.05 * k, 0.1 * k, Geo.SEG_SMALL)
	s.ball("satin", skin, Vector3(0, 1.6 * k, -0.01), Vector3(0.1, 0.125, 0.11) * k, Geo.SEG_MID)
	s.dome("satin", Color("#1b1714"), Vector3(0, 1.63 * k, 0.01), 0.108 * k, 0.11 * k, Geo.SEG_MID)


## The third person character stand-in (the auto driver: grey shirt, gamchha over the shoulder). Same frame as person.
static func hero_character(s: Geo.Sink) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	person(s, rng, {"height": 1.74, "skin": Color("#8d5a3b"), "top": Color("#8a8d86"), "bottom": Color("#3b3a36"), "saree": false})
	# gamchha over the left shoulder, hanging down the chest and the back
	for zs in [-1.0, 1.0]:
		s.rod("satin", Color("#c0392b"), Vector3(-0.15, 1.43, zs * 0.06), Vector3(-0.12, 1.36, zs * 0.17), 0.04, Geo.SEG_SMALL)
		s.rod("satin", Color("#c0392b"), Vector3(-0.12, 1.36, zs * 0.17), Vector3(-0.1, 1.02, zs * 0.21), 0.045, Geo.SEG_SMALL)
