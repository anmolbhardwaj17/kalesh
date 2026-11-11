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


## P0-037: stylised B runs the lean path (no volumetric fog, calm surfaces, night fill, dawn contrast); realistic keeps
## the P0-034 setup.
func test_stylised_b_lean_path_for_the_performance_target() -> void:
	var weights := {}
	for light in ["dawn", "afternoon", "golden", "night"]:
		var st := _style("stylised_b", light)
		t.ok(st._lean(), "stylised_b %s is lean" % light)
		t.ok(not st.environment().volumetric_fog_enabled, "no volumetric fog pass (%s)" % light)
		t.near(st.material_for(Kit.materials()["road"]).get_shader_parameter("calm"), 1.0, 1e-6, "calm surfaces on (%s)" % light)
		weights[light] = st._dawn_weight()
	t.near(weights.dawn, 1.0, 1e-6, "dawn gets the full contrast lift")
	t.ok(weights.afternoon == 0.0 and weights.golden == 0.0 and weights.night == 0.0, "only dawn gets the contrast lift")
	var night := _style("stylised_b", "night")
	t.ok(night.environment().ambient_light_sky_contribution < 1.0, "moonlit fill colour at night")
	var real := _style("realistic", "night")
	t.ok(not real._lean(), "realistic keeps the P0-034 setup")
	t.ok(real.material_for(Kit.materials()["road"]).get_shader_parameter("calm") == null, "realistic leaves calm unset")
	var p34 := _style("stylised_b", "golden")
	p34.set_off(PackedStringArray(["p34"]))
	t.ok(not p34._lean(), "--style-off=p34 measures the old setup")


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


# ---------------------------------------------------------------- default look and the day clock (P1-002)

const DayClockScript := preload("res://core/day_clock.gd")
const SimClockScript := preload("res://core/sim_clock.gd")
const RUNNER := "res://render/style_runner.gd"


func test_no_style_arg_is_stylised_b_and_none_loads_no_runner() -> void:
	t.ok(GameArgs.style_id(GameArgs.parse(PackedStringArray()).style) == "stylised_b", "no --style gives stylised_b")
	t.ok(GameArgs.style_id("none") == "none" and GameArgs.style_id("stylised") == "stylised", "--style=<id> is kept")
	t.ok(GameArgs.style_id("", "render") == "none", "an architecture bench sets up its own look")
	var keep: String = GameArgs.style
	GameArgs.style = GameArgs.style_id("")
	var r: RefCounted = GameArgs.make_style_runner(tree)
	t.ok(r != null and r.style_id == "stylised_b" and r.style != null, "the default args make a stylised_b runner")
	if r != null:
		t.near(r.hour, 15.0, 1e-9, "the default look starts at 15:00")
		t.near(r.style.light.sun_elevation_deg, DayCycle.key("afternoon").sun_elevation_deg, 1e-9,
			"15:00 is the afternoon preset itself")
		r.stop()
	GameArgs.style = "none"
	t.ok(GameArgs.make_style_runner(tree) == null, "--style=none loads no style runner")
	GameArgs.style = keep


func test_day_clock_start_from_args() -> void:
	var s: Dictionary = DayClockScript.start("", "")
	t.ok(s.hour == 15.0 and not s.pinned, "no args: 15:00, running")
	s = DayClockScript.start("golden", "")
	t.ok(s.hour == 17.75 and s.pinned, "--light=golden pins 17.75")
	s = DayClockScript.start("night", "9.5")
	t.ok(s.hour == 9.5 and s.pinned, "--time wins over --light and pins")
	s = DayClockScript.start("", "25")
	t.near(s.hour, 1.0, 1e-9, "--time wraps into 0..24")
	t.ok(DayClockScript.label(17.75) == "17:45" and DayClockScript.label(23.999) == "00:00", "clock labels")
	# the exact key hour is the preset itself, so --time=17.75 is the approved --light=golden look
	var g: Resource = DayCycle.at(17.75)
	var k: Resource = DayCycle.key("golden")
	t.ok(g.sun_color == k.sun_color and g.exposure == k.exposure and g.fog_density == k.fog_density,
		"--time=17.75 is exactly the golden preset")


func test_day_clock_advances_one_game_hour_on_the_sim_clock() -> void:
	var sim: Node = SimClockScript.new()
	var day: Node = DayClockScript.new()
	sim.sim_tick.connect(day.advance)
	var before: Resource = DayCycle.at(day.hour)
	sim.advance(1.0 / DayClockScript.DEFAULT_RATE) # one game hour of sim seconds, in fixed ticks
	t.near(day.hour, 16.0, 1e-6, "one game hour after %.0f sim seconds" % (1.0 / DayClockScript.DEFAULT_RATE))
	var after: Resource = DayCycle.at(day.hour)
	t.ok(absf(after.sun_elevation_deg - before.sun_elevation_deg) > 1.0 and after.sun_color != before.sun_color,
		"the blended light changes: sun %.1f to %.1f degrees" % [before.sun_elevation_deg, after.sun_elevation_deg])
	sim.set_scale(2.0)
	sim.advance(60.0)
	t.near(day.hour, 17.0, 1e-6, "time scale 2 runs the day twice as fast")
	sim.set_scale(1.0)
	sim.hold({"at": sim.t})
	sim.advance(60.0)
	t.near(day.hour, 17.0, 1e-6, "a held sim holds the day")
	sim.hold({"release": true})
	day.set_time({"pin": true})
	sim.advance(60.0)
	t.near(day.hour, 17.0, 1e-6, "a pinned clock stands still")
	day.set_time({"hour": 23.9, "pin": false})
	sim.advance(24.0)
	t.near(day.hour, 0.1, 1e-6, "midnight wraps")
	sim.free()
	day.free()


func test_scene_load_follows_the_day_clock() -> void:
	var clock: Node = tree.root.get_node("DayClock")
	var keep: Dictionary = clock.state()
	var r: RefCounted = load(RUNNER).new(tree, "stylised_b", "", "", "")
	var afternoon: float = r.style.light.sun_elevation_deg
	clock.set_time({"hour": 15.0 + 0.5 / 60.0})
	t.ok(not r.follow_clock(), "under a game minute: the light is kept")
	clock.set_time({"hour": 16.0})
	t.ok(r.follow_clock(), "a game hour later a scene load builds the light again")
	t.near(r.hour, 16.0, 1e-9, "the look's hour is the clock's")
	t.ok(absf(r.style.light.sun_elevation_deg - afternoon) > 1.0, "the new light is the 16:00 blend")
	r.stop()
	clock.set_time({"hour": keep.hour, "rate": keep.rate, "pin": keep.pinned})


func test_time_of_day_is_in_state() -> void:
	var keep_port: int = GameArgs.debug_port
	GameArgs.debug_port = 47181 + 613
	var server: Node = load(GameArgs.DEBUG_SERVER_PATH).new()
	tree.root.add_child(server)
	var st: Dictionary = server.state()
	t.ok(st.has("time") and st.time.hour is float and st.time.clock is String and st.time.pinned is bool
		and st.time.rate is float, "state().time has hour, clock, rate and pinned: %s" % [st.get("time")])
	t.ok("timeOfDay" in server.METHODS, "timeOfDay is a debug server method")
	tree.root.remove_child(server)
	server.free()
	GameArgs.debug_port = keep_port
