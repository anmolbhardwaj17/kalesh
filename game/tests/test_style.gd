## Phase 0 style tests (P0-011): the --light arg, the sun direction maths in the game frame (east +X, north -Z),
## the grade, the material swap by key and the wear data that drives the Old Delhi grime.
extends RefCounted

const Stylised := preload("res://render/styles/stylised.gd")
const Kit := preload("res://scenes/standin/kit.gd")
const Builder := preload("res://scenes/standin/builder.gd")
const DIR := "res://render/styles/"

var t
var tree: SceneTree


func _style(id: String, light: String) -> RefCounted:
	return load(DIR + id + ".gd").new(load(DIR + id + ".tres"), load(DIR + "light_" + light + ".tres"))


func test_light_arg() -> void:
	var d := GameArgs.parse(PackedStringArray(["--style=stylised", "--light=golden"]))
	t.ok(d.style == "stylised" and d.light == "golden" and d.unknown.is_empty(), "--light is a known value arg")
	t.ok(GameArgs.parse(PackedStringArray()).light == "", "no light by default")


func test_sun_vector_axes() -> void:
	var n: Vector3 = Stylised.sun_vector(0.0, 0.0)
	t.near(n.z, -1.0, 1e-6, "azimuth 0 is north, which is -Z")
	var e: Vector3 = Stylised.sun_vector(90.0, 0.0)
	t.near(e.x, 1.0, 1e-6, "azimuth 90 is east, which is +X")
	var up: Vector3 = Stylised.sun_vector(123.0, 90.0)
	t.near(up.y, 1.0, 1e-6, "elevation 90 is straight up")
	var w: Vector3 = Stylised.sun_vector(270.0, 12.0)
	t.ok(w.x < -0.9 and w.y > 0.2 and w.y < 0.21, "a low western sun is -X and a little up")


func test_sun_node_shines_away_from_the_sun() -> void:
	var root := Node3D.new()
	tree.root.add_child(root)
	var sun := DirectionalLight3D.new()
	root.add_child(sun)
	var st := _style("stylised", "golden")
	st.setup_sun(sun)
	var to_sun: Vector3 = Stylised.sun_vector(st.light.sun_azimuth_deg, st.light.sun_elevation_deg)
	t.near((-sun.global_basis.z).dot(-to_sun), 1.0, 1e-4, "the light travels along its -Z, away from the sun")
	t.ok(sun.global_basis.determinant() > 0.0, "no mirrored sun basis")
	root.free()


func test_grade() -> void:
	var z := Vector3.ZERO
	var g: Vector3 = Stylised.grade(Vector3(0.5, 0.5, 0.5), z, z, 1.4)
	t.near(g.distance_to(Vector3(0.5, 0.5, 0.5)), 0.0, 1e-6, "saturation leaves greys alone")
	var warm: Vector3 = Stylised.grade(Vector3(0.9, 0.9, 0.9), z, Vector3(0.05, 0.0, -0.05), 1.0)
	t.ok(warm.x > warm.z, "a warm highlight tint makes bright greys warm")
	var c: Vector3 = Stylised.grade(Vector3(1, 1, 1), Vector3(0.1, 0.1, 0.1), Vector3(0.1, 0.1, 0.1), 2.0)
	t.ok(c.x <= 1.0 and c.y <= 1.0 and c.z <= 1.0, "clamped to 0..1")


func test_every_kit_material_has_a_styled_twin() -> void:
	for id in ["stylised", "stylised_grime"]:
		var st := _style(id, "afternoon")
		var mats := Kit.materials()
		for k in mats:
			t.ok(st.material_for(mats[k]) != null, "%s styles kit material %s" % [id, k])
		t.ok(st.material_for(StandardMaterial3D.new()) == null, "%s leaves unknown materials alone" % id)
	var b := _style("stylised", "afternoon")
	var g := _style("stylised_grime", "afternoon")
	var mats := Kit.materials()
	t.near(b.material_for(mats["matte"]).get_shader_parameter("wear_scale"), 0.0, 1e-6, "look B has no grime")
	t.near(g.material_for(mats["matte"]).get_shader_parameter("wear_scale"), 1.0, 1e-6, "B+D turns the grime layer on")
	t.ok(g.material_for(mats["satin"]) is StandardMaterial3D, "people and signs (satin) get no grime shader")


func test_wear_follows_the_area() -> void:
	t.ok(Builder.AREA_WEAR.get("Bazaar", 0.0) > 0.5, "the old city bazaar is worn")
	t.ok(Builder.AREA_WEAR.get("Lutyens", 0.0) < 0.1, "the Lutyens block is near clean")
	var root := Node3D.new()
	tree.root.add_child(root)
	Builder.new().build(root, "areas")
	var bazaar := root.get_node("Bazaar")
	t.ok(bazaar.get_meta("wear") > 0.5 and bazaar.get_meta("facades").size() == 2, "bazaar mesh carries wear and its shop fronts")
	t.ok(bazaar.get_meta("facades")[0][3].size() > 10, "west shop front lists its wall piers")
	t.ok(root.get_node("Lutyens").get_meta("wear") < 0.1, "lutyens mesh is near clean")
	root.free()


func test_environment_settings() -> void:
	var env: Environment = _style("stylised", "golden").environment()
	t.ok(env.ssao_enabled and env.glow_enabled and env.fog_enabled, "SSAO, glow and haze on")
	t.ok(env.adjustment_color_correction is ImageTexture3D, "a 3D LUT grade")


# ---------------------------------------------------------------- batch B (P0-034)

const DayCycle := preload("res://render/day_cycle.gd")


func test_time_and_style_off_args() -> void:
	var d := GameArgs.parse(PackedStringArray(["--style=stylised_b", "--time=21.5", "--style-off=volfog,lights"]))
	t.ok(d.time == "21.5" and d.style_off == "volfog,lights" and d.unknown.is_empty(), "--time and --style-off are value args")


func test_day_cycle_keys_are_the_presets() -> void:
	for id in DayCycle.PRESET_HOURS:
		var at: Resource = DayCycle.at(DayCycle.PRESET_HOURS[id])
		var p: Resource = DayCycle.key(id)
		t.near(at.sun_elevation_deg, p.sun_elevation_deg, 1e-4, "--time at the %s hour is the %s preset (sun)" % [id, id])
		t.near(at.exposure, p.exposure, 1e-4, "--time at the %s hour is the %s preset (exposure)" % [id, id])


func test_day_cycle_is_continuous_and_wraps() -> void:
	var worst := 0.0
	var prev: Resource = DayCycle.at(0.0)
	var h := 0.05
	while h <= 24.0:
		var cur: Resource = DayCycle.at(h)
		worst = maxf(worst, absf(cur.sun_energy - prev.sun_energy))
		prev = cur
		h += 0.05
	t.ok(worst < 0.25, "sun energy changes smoothly through the day (largest 3 minute step %.3f)" % worst)
	t.near(DayCycle.at(24.0).night, DayCycle.at(0.0).night, 1e-6, "midnight wraps")
	t.ok(DayCycle.at(13.0).night < 0.05 and DayCycle.at(23.0).night > 0.95, "lights off at noon, on at night")
	t.ok(DayCycle.at(14.0).heat > 0.5 and DayCycle.at(3.0).heat == 0.0, "heat shimmer only by day")
	var mid: float = DayCycle.blend(DayCycle.key("dusk"), DayCycle.key("night"), 0.5).sun_azimuth_deg
	t.ok(mid > 140.0 and mid < 290.0, "the azimuth blends the short way round (%.1f)" % mid)


func test_stylised_b_materials_and_presets() -> void:
	for light in ["dawn", "afternoon", "golden", "night"]:
		var st := _style("stylised_b", light)
		var mats := Kit.materials()
		for k in mats:
			t.ok(st.material_for(mats[k]) != null, "stylised_b %s styles kit material %s" % [light, k])
		t.ok(st.material_for(mats["satin"]) is StandardMaterial3D, "people stay on a clean material (%s)" % light)
		var tiles: Texture2DArray = st.material_for(mats["matte"]).get_shader_parameter("tiles")
		t.ok(tiles != null and tiles.get_layers() == 6 and tiles.get_width() == 512, "six generated tiling layers load")
	t.ok(load(DIR + "light_night.tres").night == 1.0 and load(DIR + "light_afternoon.tres").night == 0.0, "night flag on the presets")


# ---------------------------------------------------------------- realistic reference (P0-038)


func test_realistic_turns_on_the_pbr_layer_and_the_render_features() -> void:
	t.ok("realistic" in load("res://render/style_runner.gd").STYLES, "realistic is a known style id")
	for light in ["dawn", "afternoon", "golden", "night"]:
		var st := _style("realistic", light)
		var mats := Kit.materials()
		for k in mats:
			t.ok(st.material_for(mats[k]) != null, "realistic %s styles kit material %s" % [light, k])
		t.ok(st.material_for(mats["satin"]) is StandardMaterial3D, "people stay on a clean material (%s)" % light)
		var road: ShaderMaterial = st.material_for(mats["road"])
		t.near(road.get_shader_parameter("pbr"), 1.0, 1e-6, "PBR layer on (%s)" % light)
		var env: Environment = st.environment()
		t.ok(env.ssr_enabled and env.ssil_enabled and env.volumetric_fog_enabled and not env.sdfgi_enabled, "SSR, SSIL and volumetric fog on, SDFGI opt-in (%s)" % light)
		t.ok(env.tonemap_mode == Environment.TONE_MAPPER_FILMIC, "filmic tonemap (%s)" % light)
		t.ok((env.sky.sky_material is PhysicalSkyMaterial) == (light != "night"), "physical sky by day only (%s)" % light)
	var b := _style("stylised_b", "dawn")
	var bp: Variant = b.material_for(Kit.materials()["road"]).get_shader_parameter("pbr")
	t.ok(bp == null or float(bp) == 0.0, "stylised_b keeps the PBR layer off")
	t.ok(load(DIR + "light_dawn.tres").wet > load(DIR + "light_afternoon.tres").wet, "dawn streets are wetter than the afternoon")
	t.ok(load(DIR + "light_afternoon.tres").dust > load(DIR + "light_dawn.tres").dust, "the afternoon is dustier than dawn")


func test_builder_records_dressing_anchors_without_geometry() -> void:
	var root := Node3D.new()
	tree.root.add_child(root)
	Builder.new().build(root, "areas")
	var kinds := {}
	for a in root.get_node("Bazaar").get_meta("anchors", []):
		kinds[a[0]] = kinds.get(a[0], 0) + 1
	for k in ["shop", "window", "balcony", "tank", "roof", "lane", "pole", "person"]:
		t.ok(kinds.get(k, 0) > 0, "bazaar records %s anchors (%d)" % [k, kinds.get(k, 0)])
	t.ok(not root.get_node("Bazaar").has_node("Dressing"), "the default look adds no dressing")
	root.free()
