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
