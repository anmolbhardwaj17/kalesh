## Builds the procedural stand-in scenes for style tests and benches (P0-009). Layouts:
##   street:    about 300 m of a 6 lane arterial running north (-Z), with a raised median and painted kerbs, a service
##              lane on the east side, footpaths, a signal junction with a cross road at z = 0, a stub flyover ramp
##              in the centre lanes from z = -75 north, a bus stop, shop houses with sign boards, trees, street
##              lights, static traffic queued at the red light and people. Player car at (-5.85, 0, 75).
##   landmarks: a road at x = 0 with one stand-in per landmark tier to the east (landmarks.gd).
##   areas:     two 100 m area kit blocks side by side: an old city bazaar strip around x = -45 and a Lutyens
##              bungalow road around x = +45, plus the third person character stand-in in the bazaar.
## Everything is seeded (same scene every run). Static geometry is merged per block and material (geo.gd Sink), so
## each block is a few draw calls. Returns counts, also stored as root metadata "standin" (tests read them).
extends RefCounted

const Geo := preload("res://scenes/standin/geo.gd")
const Kit := preload("res://scenes/standin/kit.gd")
const Landmarks := preload("res://scenes/standin/landmarks.gd")
const CarScript := preload("res://scripts/car.gd")
const ChaseCamera := preload("res://scripts/chase_camera.gd")
const Hud := preload("res://ui/standin_hud.gd")

## Main road cross section (x, metres): lanes of 3.5 m, median 1.2 m.
const MEDIAN := 0.6
const CARRIAGE := 11.1
const SERVICE0 := 12.6
const SERVICE1 := 18.1
const EAST_PATH := 21.6
const WEST_PATH := -15.1
const ROAD_TOP := 0.0
const PATH_TOP := 0.17
const LANES := [2.35, 5.85, 9.35]
const STREET_HALF := 150.0
const JUNCTION := 11.0

var root: Node3D
var rng := RandomNumberGenerator.new()
var mats := Kit.materials()
var stats := {"buildings": 0, "vehicles": 0, "people": 0, "trees": 0, "lights": 0, "signs": 0, "landmarks": [],
	"areas": [], "characters": 0, "chunks": 0, "vertices": 0}
var _signs: Node3D


func build(into: Node3D, layout: String) -> Dictionary:
	root = into
	rng.seed = 20261110
	_signs = Node3D.new()
	_signs.name = "Signs"
	root.add_child(_signs)
	_environment()
	match layout:
		"street":
			_street()
		"landmarks":
			_landmarks()
		"areas":
			_areas()
	root.set_meta("standin", stats)
	return stats


# ------------------------------------------------------------------ shared


func _environment() -> void:
	var env := Environment.new()
	var sky := Sky.new()
	var sm := ProceduralSkyMaterial.new()
	sm.sky_top_color = Color("#7f9fbf")
	sm.sky_horizon_color = Color("#d9c9a6")
	sm.ground_horizon_color = Color("#c9b994")
	sm.ground_bottom_color = Color("#6f6350")
	sm.sun_angle_max = 30.0
	sky.sky_material = sm
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.9
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 1.0
	env.fog_enabled = true
	env.fog_light_color = Color("#d9c9a6")
	env.fog_density = 0.0022
	env.fog_aerial_perspective = 0.4
	env.fog_sky_affect = 0.3
	var we := WorldEnvironment.new()
	we.name = "Environment"
	we.environment = env
	root.add_child(we)
	var sun := DirectionalLight3D.new()
	sun.name = "Sun"
	# hot hazy afternoon: high sun from the south west (CITY_BRIEF.md "Weather, light and time of day")
	sun.rotation = Vector3(deg_to_rad(-58), deg_to_rad(-35), 0)
	sun.light_color = Color("#fff1d8")
	sun.light_energy = 1.35
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 220.0
	root.add_child(sun)


func _commit(s: Geo.Sink, name: String) -> void:
	if s.batches.is_empty():
		return
	var mi := MeshInstance3D.new()
	mi.name = name
	mi.mesh = s.to_mesh(mats)
	root.add_child(mi)
	stats.chunks += 1
	stats.vertices += s.vertex_count()


## A label on a sign board. pos and size in the frame xf (board face facing local -Z).
func _sign(xf: Transform3D, pos: Vector3, size: Vector2, bg: Color, text: String) -> void:
	var l := Label3D.new()
	l.text = text
	l.font_size = 48
	var chars := maxf(4.0, text.length())
	l.pixel_size = minf(0.0105, size.x * 0.86 / (chars * 0.56 * l.font_size))
	l.modulate = Color("#1a1a1a") if bg.get_luminance() > 0.55 else Color("#fbf7ea")
	l.outline_size = 0
	l.double_sided = false
	l.shaded = true
	l.alpha_cut = Label3D.ALPHA_CUT_DISCARD
	l.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	# a Label3D faces +Z; the board faces local -Z, so turn it half a turn about Y
	l.transform = xf * Transform3D(Basis(Vector3.UP, PI), pos)
	_signs.add_child(l)
	stats.signs += 1


func _shop_row(s: Geo.Sink, front: Vector3, yaw: float, along: float, length: float, o: Dictionary) -> void:
	## A row of shop houses whose fronts stand on a line starting at front, running along the frame's local +X.
	var u := 0.0
	var wmin: float = o.get("wmin", 6.0)
	var wmax: float = o.get("wmax", 12.0)
	while u < length - wmin * 0.6:
		var w := minf(rng.randf_range(wmin, wmax), length - u)
		var floors := rng.randi_range(o.get("fmin", 2), o.get("fmax", 5))
		var d := rng.randf_range(o.get("dmin", 12.0), o.get("dmax", 16.0))
		var xf := Kit.at(front, yaw) * Transform3D(Basis.IDENTITY, Vector3(along * (u + w * 0.5), 0, 0))
		var opts := o.duplicate()
		opts["floors"] = floors
		if o.has("palette"):
			opts["color"] = Kit.pick(rng, o.palette)
		s.push(xf)
		var board = Kit.shop_house(s, rng, w - 0.05, d, opts)
		s.pop()
		if board != null:
			_sign(s.stack[-1] * xf, board.pos, board.size, board.color, Kit.pick(rng, Kit.SHOP_NAMES))
		stats.buildings += 1
		u += w


func _vehicle(s: Geo.Sink, kind: String, p: Vector3, yaw: float) -> void:
	s.push(Kit.at(p, yaw))
	match kind:
		"car":
			Kit.car(s, Kit.pick(rng, Kit.CAR_PAINT), Kit.pick(rng, ["hatch", "hatch", "sedan", "suv"]))
		"auto":
			Kit.auto_rickshaw(s)
		"bus":
			Kit.bus(s)
		"scooter":
			Kit.scooter(s, Kit.pick(rng, Kit.BOARDS))
	s.pop()
	stats.vehicles += 1


func _person(s: Geo.Sink, p: Vector3, yaw: float, o := {}) -> void:
	s.push(Kit.at(p, yaw))
	Kit.person(s, rng, o)
	s.pop()
	stats.people += 1


func _tree(s: Geo.Sink, p: Vector3, scale := 1.0) -> void:
	s.push(Kit.at(p, rng.randf_range(0, TAU)))
	Kit.tree(s, rng, scale)
	s.pop()
	stats.trees += 1


func _light(s: Geo.Sink, p: Vector3, yaw: float, h := 9.0, double := false) -> void:
	s.push(Kit.at(p, yaw))
	Kit.street_light(s, h, double)
	s.pop()
	stats.lights += 1


## The player car (car.gd on the sim tick), its smooth stand-in body, the chase camera and the HUD stand-in.
func _player(p: Vector3, heading := 0.0) -> void:
	var car := Node3D.new()
	car.name = "Car"
	car.set_script(CarScript)
	car.position = p
	car.rotation = Vector3(0, -heading, 0)
	var s := Geo.Sink.new()
	Kit.car(s, Color("#d4a017"), "hatch")
	var mi := MeshInstance3D.new()
	mi.name = "Body"
	mi.mesh = s.to_mesh(mats)
	car.add_child(mi)
	root.add_child(car)
	var cam := Camera3D.new()
	cam.name = "ChaseCamera"
	cam.set_script(ChaseCamera)
	cam.fov = 65.0
	cam.near = 0.1
	cam.far = 1500.0
	cam.set("target_path", NodePath("../Car"))
	cam.set("back", 7.5)
	cam.set("height", 3.0)
	root.add_child(cam)
	var hud := CanvasLayer.new()
	hud.name = "Hud"
	hud.set_script(Hud)
	root.add_child(hud)


func _character(p: Vector3, yaw: float) -> void:
	var s := Geo.Sink.new()
	Kit.hero_character(s)
	var mi := MeshInstance3D.new()
	mi.name = "Character"
	mi.mesh = s.to_mesh(mats)
	mi.transform = Kit.at(p, yaw)
	mi.add_to_group("character")
	root.add_child(mi)
	stats.characters += 1


func _ground(color: Color, size := 4000.0) -> void:
	var s := Geo.Sink.new()
	s.box("road", color, Vector3(0, -0.19, 0), Vector3(size, 0.3, size))
	_commit(s, "Ground")


# ------------------------------------------------------------------ street


func _street() -> void:
	_ground(Color("#9c8f78"))
	var road := Geo.Sink.new()
	var z_s := 400.0
	# carriageways split at the junction; the cross road fills the junction box
	for zr in [[JUNCTION - 3.5, z_s], [-z_s, -JUNCTION + 3.5]]:
		var zc: float = (zr[0] + zr[1]) * 0.5
		var zl: float = zr[1] - zr[0]
		for xs in [-1.0, 1.0]:
			road.box("road", Kit.ASPHALT, Vector3(xs * (MEDIAN + CARRIAGE) * 0.5, ROAD_TOP - 0.15, zc), Vector3(CARRIAGE - MEDIAN, 0.3, zl))
		road.box("road", Kit.shade(Kit.ASPHALT, 1.06), Vector3((SERVICE0 + SERVICE1) * 0.5, ROAD_TOP - 0.15, zc), Vector3(SERVICE1 - SERVICE0, 0.3, zl))
	road.box("road", Kit.shade(Kit.ASPHALT, 1.03), Vector3(0, ROAD_TOP - 0.15, 0), Vector3(2 * z_s, 0.3, 2 * (JUNCTION - 3.5)))
	_markings(road, z_s)
	_median(road)
	_paths(road)
	_commit(road, "Road")
	_ramp()
	var north := Geo.Sink.new()
	var south := Geo.Sink.new()
	# shop rows: west side faces +X, east side faces -X; north (z < 0) and south (z > 0) of the junction
	var o := {"awning": false, "balcony": 0.3}
	_shop_row(south, Vector3(WEST_PATH - 0.4, 0, STREET_HALF), -PI * 0.5, -1.0, STREET_HALF - JUNCTION - 4, o)
	_shop_row(north, Vector3(WEST_PATH - 0.4, 0, -JUNCTION - 4), -PI * 0.5, -1.0, STREET_HALF - JUNCTION - 4, o)
	_shop_row(south, Vector3(EAST_PATH + 0.4, 0, JUNCTION + 4), PI * 0.5, -1.0, STREET_HALF - JUNCTION - 4, o)
	_shop_row(north, Vector3(EAST_PATH + 0.4, 0, -STREET_HALF), PI * 0.5, -1.0, STREET_HALF - JUNCTION - 4, o)
	# corner rows along the cross road (fronts face the cross road)
	var oc := {"fmin": 2, "fmax": 4}
	# (they start past the depth of the main rows: x beyond -33 and 40)
	_shop_row(south, Vector3(-80, 0, JUNCTION + 0.4), 0.0, 1.0, 47.0, oc)
	_shop_row(south, Vector3(40, 0, JUNCTION + 0.4), 0.0, 1.0, 40.0, oc)
	_shop_row(north, Vector3(-33, 0, -JUNCTION - 0.4), PI, 1.0, 47.0, oc)
	_shop_row(north, Vector3(80, 0, -JUNCTION - 0.4), PI, 1.0, 40.0, oc)
	_far_city(north, south)
	_street_trees_and_lights(north, south)
	_junction_signals(south)
	_bus_stop(south)
	_traffic(north, south)
	_people(north, south)
	_commit(north, "BlocksNorth")
	_commit(south, "BlocksSouth")
	_player(Vector3(-LANES[1], 0, 75))


func _markings(s: Geo.Sink, z_s: float) -> void:
	var y := ROAD_TOP + 0.006
	for xs in [-1.0, 1.0]:
		# lane dashes (3 m dash, 6 m gap), the inner separator stops where the ramp starts
		for lx in [MEDIAN + 3.5, MEDIAN + 7.0]:
			var z := -z_s
			while z < z_s:
				var inner: bool = lx < MEDIAN + 4.0
				if absf(z) > JUNCTION + 2.0 and not (inner and z < -70.0):
					s.box("satin", Kit.MARK, Vector3(xs * lx, y, z), Vector3(0.12, 0.012, 3.0))
				z += 9.0
		# edge lines
		for zr in [[JUNCTION + 1.0, z_s], [-z_s, -JUNCTION - 1.0]]:
			s.box("satin", Kit.MARK, Vector3(xs * (CARRIAGE - 0.25), y, (zr[0] + zr[1]) * 0.5), Vector3(0.15, 0.012, zr[1] - zr[0]))
	# stop lines and zebra crossings across the main road, zebras across the cross road
	s.box("satin", Kit.MARK, Vector3(-(MEDIAN + CARRIAGE) * 0.5, y, JUNCTION + 1.0), Vector3(CARRIAGE - MEDIAN, 0.012, 0.4))
	s.box("satin", Kit.MARK, Vector3((MEDIAN + CARRIAGE) * 0.5, y, -JUNCTION - 1.0), Vector3(CARRIAGE - MEDIAN, 0.012, 0.4))
	for zs in [-1.0, 1.0]:
		var x := -CARRIAGE + 0.4
		while x < CARRIAGE:
			if absf(x) > MEDIAN + 0.2:
				s.box("satin", Kit.MARK, Vector3(x, y, zs * (JUNCTION - 1.5)), Vector3(0.5, 0.012, 3.0))
			x += 1.0
	for xs in [-1.0, 1.0]:
		var z := -JUNCTION + 4.0
		while z < JUNCTION - 3.5:
			s.box("satin", Kit.MARK, Vector3(xs * (CARRIAGE + 3.0), y, z), Vector3(3.0, 0.012, 0.5))
			z += 1.0
	# gore chevrons in front of the ramp nose
	for i in 4:
		s.box("satin", Kit.MARK, Vector3(0, y, -66.0 - i * 2.2), Vector3(0.35, 0.012, 3.0), deg_to_rad(35))
		s.box("satin", Kit.MARK, Vector3(0, y, -66.0 - i * 2.2), Vector3(0.35, 0.012, 3.0), deg_to_rad(-35))
	s.box("satin", Kit.MARK, Vector3(-MEDIAN - 3.5, y, -72.0), Vector3(0.15, 0.012, 12.0), deg_to_rad(-3.0))
	s.box("satin", Kit.MARK, Vector3(MEDIAN + 3.5, y, -72.0), Vector3(0.15, 0.012, 12.0), deg_to_rad(3.0))


func _median(s: Geo.Sink) -> void:
	var top := 0.25
	for zr in [[JUNCTION + 1.0, STREET_HALF + 60.0], [-62.0, -JUNCTION - 1.0]]:
		var z0: float = zr[0]
		var z1: float = zr[1]
		s.box("matte", Kit.CEMENT, Vector3(0, top * 0.5, (z0 + z1) * 0.5), Vector3(MEDIAN * 2 - 0.4, top, z1 - z0))
		for xs in [-1.0, 1.0]:
			s.push(Transform3D(Basis.IDENTITY, Vector3(xs * (MEDIAN - 0.1), 0, 0)))
			Kit.painted_kerb(s, z0, z1, top + 0.02)
			s.pop()
		# low hedge and a steel railing on the median
		var z := z0 + 1.5
		while z < z1 - 1.5:
			s.ball("leaf", Kit.shade(Kit.LEAF, rng.randf_range(0.9, 1.15)), Vector3(0, top + 0.25, z), Vector3(0.38, 0.35, 1.1), Geo.SEG_MID)
			z += 2.0
		s.push(Transform3D(Basis.IDENTITY, Vector3(0, top, 0)))
		Kit.railing(s, z0 + 0.5, z1 - 0.5, 0.9, 3.0)
		s.pop()


func _paths(s: Geo.Sink) -> void:
	for zr in [[JUNCTION, STREET_HALF + 60.0], [-STREET_HALF - 60.0, -JUNCTION]]:
		var zc: float = (zr[0] + zr[1]) * 0.5
		var zl: float = zr[1] - zr[0]
		# west footpath, east verge, east footpath, each with a kerb
		s.box("matte", Kit.PAVER, Vector3((WEST_PATH - 0.4 - CARRIAGE) * 0.5, PATH_TOP * 0.5, zc), Vector3(-CARRIAGE - WEST_PATH + 0.4, PATH_TOP, zl))
		s.box("matte", Kit.KERB, Vector3(-CARRIAGE - 0.1, PATH_TOP * 0.5 + 0.01, zc), Vector3(0.22, PATH_TOP + 0.02, zl))
		s.box("leaf", Kit.shade(Kit.GRASS, 0.9), Vector3((CARRIAGE + SERVICE0) * 0.5, PATH_TOP * 0.5, zc), Vector3(SERVICE0 - CARRIAGE, PATH_TOP, zl))
		for x in [CARRIAGE + 0.1, SERVICE0 - 0.1, SERVICE1 + 0.1]:
			s.box("matte", Kit.KERB, Vector3(x, PATH_TOP * 0.5 + 0.01, zc), Vector3(0.22, PATH_TOP + 0.02, zl))
		s.box("matte", Kit.PAVER, Vector3((SERVICE1 + EAST_PATH) * 0.5 + 0.2, PATH_TOP * 0.5, zc), Vector3(EAST_PATH - SERVICE1 + 0.4, PATH_TOP, zl))
	# footpaths along the cross road (both sides, both halves)
	for zs in [-1.0, 1.0]:
		for xr in [[-80.0, -CARRIAGE], [CARRIAGE, 80.0]]:
			var xc: float = (xr[0] + xr[1]) * 0.5
			s.box("matte", Kit.PAVER, Vector3(xc, PATH_TOP * 0.5, zs * (JUNCTION - 1.75)), Vector3(xr[1] - xr[0], PATH_TOP, 3.5))
			s.box("matte", Kit.KERB, Vector3(xc, PATH_TOP * 0.5 + 0.01, zs * (JUNCTION - 3.5)), Vector3(xr[1] - xr[0], PATH_TOP + 0.02, 0.22))


## Stub flyover: the centre lanes climb from z = -75 (a filled ramp between retaining walls), then a deck on piers.
func _ramp() -> void:
	var s := Geo.Sink.new()
	var half := 4.3
	var z0 := -75.0
	var run := 85.0
	var rise := 6.4
	var along := Basis(Vector3(0, 0, -1), Vector3(0, 1, 0), Vector3(1, 0, 0))
	var wedge := PackedVector2Array([Vector2(0, ROAD_TOP), Vector2(run, rise), Vector2(run, 0)])
	s.ext("matte", Color("#a7a399"), wedge, half * 2.0, Transform3D(along, Vector3(-half, 0, z0)))
	var slope := atan2(rise, run)
	var len := sqrt(run * run + rise * rise)
	# the road surface follows the slope (a box turned about X)
	s.put("road", Geo.unit_box(), Transform3D(Basis(Vector3.RIGHT, slope) * Basis.from_scale(Vector3(half * 2 - 0.7, 0.05, len)),
		Vector3(0, rise * 0.5 + 0.03, z0 - run * 0.5)), Kit.shade(Kit.ASPHALT, 1.1))
	# parapets (crash barriers) on both edges, panel joints on the retaining walls
	var par := PackedVector2Array([Vector2(0, ROAD_TOP), Vector2(run, rise), Vector2(run, rise + 0.9), Vector2(0, ROAD_TOP + 0.9)])
	for x in [-half, half - 0.35]:
		s.ext("matte", Color("#c9c5bb"), par, 0.35, Transform3D(along, Vector3(x, 0, z0)))
	for i in range(1, 17):
		var u := i * 5.0
		var h := rise * u / run
		for xs in [-1.0, 1.0]:
			s.box("matte", Color("#8f8b82"), Vector3(xs * (half + 0.01), h * 0.5, z0 - u), Vector3(0.03, h, 0.08))
	# deck on piers from the top of the ramp into the fog
	var zt := z0 - run
	var deck_len := 240.0
	s.box("matte", Color("#b3afa5"), Vector3(0, rise - 0.6, zt - deck_len * 0.5), Vector3(half * 2, 1.2, deck_len))
	s.box("road", Kit.shade(Kit.ASPHALT, 1.1), Vector3(0, rise + 0.015, zt - deck_len * 0.5), Vector3(half * 2 - 0.7, 0.05, deck_len))
	for x in [-half + 0.175, half - 0.175]:
		s.box("matte", Color("#c9c5bb"), Vector3(x, rise + 0.45, zt - deck_len * 0.5), Vector3(0.35, 0.9, deck_len))
	var z := zt - 18.0
	while z > zt - deck_len:
		s.cyl("matte", Color("#a7a399"), Vector3(0, (rise - 1.2) * 0.5, z), 0.9, rise - 1.2, Geo.SEG_ROUND)
		s.box("matte", Color("#a7a399"), Vector3(0, rise - 1.6, z), Vector3(half * 2 - 1.0, 0.8, 1.8))
		z -= 32.0
	# lights on the ramp parapet
	z = z0 - 20.0
	while z > zt - deck_len:
		var h2 := rise * clampf((z0 - z) / run, 0.0, 1.0)
		_light(s, Vector3(-half + 0.17, h2 + 0.9, z), -PI * 0.5, 7.0)
		z -= 35.0
	_commit(s, "Flyover")


func _far_city(north: Geo.Sink, south: Geo.Sink) -> void:
	for side in [-1.0, 1.0]:
		for zs in [-1.0, 1.0]:
			var z := STREET_HALF + 4.0
			while z < 330.0:
				var w := rng.randf_range(12, 26)
				var x := WEST_PATH - 0.4 if side < 0 else EAST_PATH + 0.4
				var sink := north if zs < 0 else south
				sink.push(Kit.at(Vector3(x, 0, zs * (z + w * 0.5)), side * PI * 0.5))
				Kit.far_block(sink, rng, w, 18.0, rng.randf_range(8, 22))
				sink.pop()
				z += w + 1.0
	# blocks behind the street rows (seen from 40 m up)
	for i in 26:
		var sx := -1.0 if i % 2 == 0 else 1.0
		var z := -STREET_HALF + floorf(i / 2.0) * 23.0 + 6.0
		if absf(z) < 32.0:
			continue
		var sink := north if z < 0 else south
		var x0 := WEST_PATH - 18.0 if sx < 0 else EAST_PATH + 18.0
		sink.push(Kit.at(Vector3(x0, 0, z), sx * PI * 0.5))
		Kit.far_block(sink, rng, rng.randf_range(14, 22), 16.0, rng.randf_range(6, 15))
		sink.pop()


func _street_trees_and_lights(north: Geo.Sink, south: Geo.Sink) -> void:
	var z := -STREET_HALF + 6.0
	while z < STREET_HALF:
		if absf(z) > JUNCTION + 4.0:
			var sink := north if z < 0 else south
			_tree(sink, Vector3((CARRIAGE + SERVICE0) * 0.5, PATH_TOP, z + rng.randf_range(-1.5, 1.5)))
			if int(z) % 2 == 0:
				_tree(sink, Vector3(WEST_PATH + 1.0, PATH_TOP, z + 7.0), 0.9)
		z += 15.0
	z = -60.0
	while z < STREET_HALF:
		if absf(z) > JUNCTION + 6.0:
			_light(north if z < 0 else south, Vector3(0, 0.25, z), PI * 0.5, 10.0, true)
		z += 30.0
	z = -STREET_HALF + 15.0
	while z < STREET_HALF:
		if absf(z) > JUNCTION + 6.0:
			_light(north if z < 0 else south, Vector3(SERVICE1 + 0.6, PATH_TOP, z), PI * 0.5, 8.0)
			_light(north if z < 0 else south, Vector3(WEST_PATH + 0.5, PATH_TOP, z + 17.0), -PI * 0.5, 8.0)
		z += 36.0


func _junction_signals(s: Geo.Sink) -> void:
	# main road waits at red; the cross road has green
	var posts := [
		[Vector3(-CARRIAGE - 1.2, PATH_TOP, JUNCTION + 1.2), PI, "red", -8.0],
		[Vector3(CARRIAGE + 1.2, PATH_TOP, -JUNCTION - 1.2), 0.0, "red", -8.0],
		[Vector3(-CARRIAGE - 2.0, PATH_TOP, -JUNCTION + 2.0), PI * 0.5, "green", -5.0],
		[Vector3(SERVICE1 + 1.0, PATH_TOP, JUNCTION - 2.0), -PI * 0.5, "green", -5.0],
		[Vector3(-MEDIAN + 0.1, 0.25, JUNCTION + 1.6), PI, "red", 0.0],
		[Vector3(MEDIAN - 0.1, 0.25, -JUNCTION - 1.6), 0.0, "red", 0.0],
	]
	for p in posts:
		s.push(Kit.at(p[0], p[1]))
		Kit.signal_post(s, p[2], p[3])
		s.pop()


func _bus_stop(s: Geo.Sink) -> void:
	var xf := Kit.at(Vector3(WEST_PATH + 1.6, PATH_TOP, 55.0), -PI * 0.5)
	s.push(xf)
	var bs := Kit.bus_stop(s, 7.0)
	s.pop()
	_sign(xf, bs.ad + Vector3(0, 0, -0.03), Vector2(2.0, 1.2), Color("#1f5fa8"), "Kalesh Coaching")


func _traffic(north: Geo.Sink, south: Geo.Sink) -> void:
	# northbound queue at the red light (vehicles face -Z, yaw 0), kerb lane bus at the bus stop
	var nb := [["car", 0, 14.5], ["auto", 0, 20.0], ["car", 0, 25.0], ["bus", 1, 20.5], ["car", 1, 30.0],
		["auto", 2, 14.0], ["car", 2, 19.0], ["auto", 2, 24.0], ["bus", 2, 55.0]]
	for v in nb:
		_vehicle(south, v[0], Vector3(-LANES[v[1]], ROAD_TOP, v[2]), 0.0)
	# southbound queue (vehicles face +Z, yaw PI)
	var sb := [["car", 0, -14.5], ["auto", 0, -19.5], ["car", 0, -25.0], ["car", 1, -15.0], ["car", 1, -20.5],
		["auto", 1, -25.5], ["auto", 2, -14.0], ["car", 2, -19.0]]
	for v in sb:
		_vehicle(north, v[0], Vector3(LANES[v[1]], ROAD_TOP, v[2]), PI)
	# cross traffic on green (drive on the left: eastbound on the north half)
	_vehicle(north, "car", Vector3(-3.0, ROAD_TOP, -2.0), -PI * 0.5)
	_vehicle(south, "auto", Vector3(5.0, ROAD_TOP, 2.0), PI * 0.5)
	# service lane: parked car, auto
	_vehicle(south, "car", Vector3(16.6, ROAD_TOP, 42.0), 0.0)
	_vehicle(north, "auto", Vector3(14.4, ROAD_TOP, -48.0), PI)


func _people(north: Geo.Sink, south: Geo.Sink) -> void:
	# waiting at the bus stop
	for i in 5:
		_person(south, Vector3(WEST_PATH + 2.2 + rng.randf_range(-0.4, 0.6), PATH_TOP, 52.5 + i * 1.3), -PI * 0.5 + rng.randf_range(-0.4, 0.4))
	# walking on the footpaths
	for i in 8:
		var z := -130.0 + i * 33.0 + rng.randf_range(-4, 4)
		if absf(z) < JUNCTION + 2.0:
			z += 12.0
		_person(north if z < 0 else south, Vector3(WEST_PATH + rng.randf_range(1.0, 3.2), PATH_TOP, z), 0.0 if i % 2 == 0 else PI)
		var z2 := -140.0 + i * 35.0 + rng.randf_range(-4, 4)
		if absf(z2) < JUNCTION + 2.0:
			z2 -= 12.0
		_person(north if z2 < 0 else south, Vector3(rng.randf_range(SERVICE1 + 0.8, EAST_PATH - 0.5), PATH_TOP, z2), PI if i % 2 == 0 else 0.0)
	# crossing the main road on the zebra while it is red
	for x in [-8.5, -3.5, 2.5, 7.0]:
		_person(south, Vector3(x, ROAD_TOP, JUNCTION - 1.5 + rng.randf_range(-0.8, 0.8)), PI * 0.5 if x < 0 else -PI * 0.5)
	# chai stall on the east footpath: counter, kettle, awning, vendor and two customers
	var c := Vector3(SERVICE1 + 2.0, PATH_TOP, 30.0)
	south.box("matte", Color("#7a5a3a"), c + Vector3(0.6, 0.5, 0), Vector3(0.8, 1.0, 2.0))
	south.cyl("metal", Color("#b0b4b6"), c + Vector3(0.6, 1.15, -0.4), 0.15, 0.3, Geo.SEG_MID)
	south.box("satin", Color("#2e6fb5"), c + Vector3(0.8, 2.4, 0), Vector3(2.4, 0.04, 2.8))
	for p in [Vector3(0.6, 0, -1.6), Vector3(0.6, 0, 1.6)]:
		south.cyl("metal", Kit.STEEL, c + p + Vector3(0, 1.2, 0), 0.03, 2.4, Geo.SEG_SMALL)
	_person(south, c + Vector3(1.4, 0, 0.2), PI * 0.5)
	_person(south, c + Vector3(-0.4, 0, -0.5), -PI * 0.5)
	_person(south, c + Vector3(-0.5, 0, 0.7), -PI * 0.5)


# ------------------------------------------------------------------ landmarks


func _landmarks() -> void:
	_ground(Color("#9c8f78"))
	var road := Geo.Sink.new()
	road.box("road", Kit.ASPHALT, Vector3(0, ROAD_TOP - 0.15, 0), Vector3(15, 0.3, 800))
	var z := -400.0
	while z < 400.0:
		road.box("satin", Kit.MARK, Vector3(0, ROAD_TOP + 0.006, z), Vector3(0.12, 0.012, 3.0))
		z += 9.0
	for xs in [-1.0, 1.0]:
		road.box("matte", Kit.PAVER, Vector3(xs * 9.25, PATH_TOP * 0.5, 0), Vector3(3.5, PATH_TOP, 800))
		road.box("matte", Kit.KERB, Vector3(xs * 7.6, PATH_TOP * 0.5 + 0.01, 0), Vector3(0.22, PATH_TOP + 0.02, 800))
	z = -300.0
	while z < 300.0:
		_tree(road, Vector3(-9.5, PATH_TOP, z), 1.1)
		_light(road, Vector3(8.0, PATH_TOP, z + 15.0), PI * 0.5, 9.0)
		z += 30.0
	# lawns between the road and the landmarks (a Rajpath like setting), kept off the marker's plot
	road.box("leaf", Kit.shade(Kit.GRASS, 1.05), Vector3(38.5, 0.025, 3.0), Vector3(53, 0.05, 82))
	road.box("leaf", Kit.shade(Kit.GRASS, 1.05), Vector3(105, 0.025, 30.0), Vector3(40, 0.05, 10))
	for i in 40:
		road.ball("leaf", Kit.shade(Kit.LEAF, 1.1), Vector3(12.5, 0.4, -36.0 + i * 2.0), Vector3(0.5, 0.45, 1.1), Geo.SEG_MID)
	_commit(road, "Road")
	# each landmark faces the road (local -Z turned to -X: yaw +90 degrees)
	var places := {"hero": Vector3(100, 0, -10), "signature": Vector3(130, 0, 85), "marker": Vector3(50, 0, -60)}
	for tier in ["hero", "signature", "marker"]:
		var s := Geo.Sink.new()
		s.push(Kit.at(places[tier], PI * 0.5))
		match tier:
			"hero":
				Landmarks.hero(s, rng)
				for i in 6:
					_person(s, Vector3(rng.randf_range(-20, 20), 0.1, rng.randf_range(-24, -8)), rng.randf_range(0, TAU))
			"signature":
				Landmarks.signature(s, rng)
				for i in 4:
					_person(s, Vector3(rng.randf_range(-3, 3), 0.1, -30 - i * 3.0), rng.randf_range(0, TAU))
			"marker":
				var bays: Array = Landmarks.marker(s, rng)
				for i in 5:
					_vehicle(s, "car", bays[i * 2], PI)
		s.pop()
		_commit(s, "Landmark_" + tier)
		stats.landmarks.append(tier)
	_player(Vector3(-3.5, 0, 80))


# ------------------------------------------------------------------ area kits


func _areas() -> void:
	_ground(Color("#9a8a70"))
	_bazaar(-45.0)
	_lutyens(45.0)
	var s := Geo.Sink.new()
	# a road along the south edge joining both blocks
	s.box("road", Kit.ASPHALT, Vector3(0, ROAD_TOP - 0.15, 62.0), Vector3(300, 0.3, 12))
	for i in 30:
		s.box("satin", Kit.MARK, Vector3(-140.0 + i * 9.5, ROAD_TOP + 0.006, 62.0), Vector3(3.0, 0.012, 0.12))
	_commit(s, "Link")
	_player(Vector3(-20.0, 0, 64.0), PI * 0.5)
	_character(Vector3(-44.6, 0.06, 40.5), 0.0)


func _bazaar(cx: float) -> void:
	var s := Geo.Sink.new()
	var hw := 3.5
	var z0 := -50.0
	var z1 := 50.0
	# worn street: patched concrete, drains with covers along both edges
	s.box("road", Color("#6b665d"), Vector3(cx, 0.03, 0), Vector3(hw * 2, 0.06, z1 - z0 + 8))
	for i in 14:
		s.box("road", Color("#57534c"), Vector3(cx + rng.randf_range(-2.5, 2.5), 0.065, rng.randf_range(z0, z1)), Vector3(rng.randf_range(1, 2.5), 0.01, rng.randf_range(1, 3)), rng.randf_range(0, PI))
	for xs in [-1.0, 1.0]:
		s.box("matte", Color("#4a4640"), Vector3(cx + xs * (hw - 0.3), 0.07, 0), Vector3(0.5, 0.02, z1 - z0))
	var palette := [Kit.BRICK, Kit.LIME, Kit.MINT, Kit.PINK, Kit.OCHRE, Color("#c98f6b"), Color("#b9a48a")]
	var o := {"tight": true, "awning": true, "balcony": 0.6, "wmin": 3.4, "wmax": 5.4, "fmin": 3, "fmax": 5, "dmin": 9.0,
		"dmax": 11.0, "palette": palette}
	_shop_row(s, Vector3(cx - hw, 0, z1), -PI * 0.5, -1.0, z1 - z0, o)
	_shop_row(s, Vector3(cx + hw, 0, z0), PI * 0.5, -1.0, z1 - z0, o)
	# back blocks behind both rows
	for xs in [-1.0, 1.0]:
		var z := z0
		while z < z1:
			var w := rng.randf_range(8, 14)
			s.push(Kit.at(Vector3(cx + xs * (hw + 11.0), 0, z + w * 0.5), xs * PI * 0.5))
			Kit.far_block(s, rng, w, 14.0, rng.randf_range(5, 8))
			s.pop()
			z += w + 0.5
	# wires: bundles across the street and along both sides, electric poles with boxes
	var z := z0 + 2.0
	while z < z1:
		for k in rng.randi_range(1, 3):
			# between the second floor balconies (top 7.7 m) and the third floor slab (10 m)
			var ya := rng.randf_range(8.3, 9.4)
			var yb := ya + rng.randf_range(-0.4, 0.4)
			s.wire("satin", Kit.BLACK, Vector3(cx - hw + 0.1, ya, z + rng.randf_range(-1, 1)), Vector3(cx + hw - 0.1, yb, z + rng.randf_range(-1, 1)), rng.randf_range(0.3, 0.9))
		z += 3.5
	for xs in [-1.0, 1.0]:
		var pz := z0 + 8.0
		while pz < z1:
			var base := Vector3(cx + xs * (hw - 0.55), 0, pz)
			s.cyl("matte", Kit.CEMENT, base + Vector3(0, 5.0, 0), 0.14, 10.0, Geo.SEG_SMALL, 0.7)
			s.box("metal", Color("#6a6e70"), base + Vector3(0, 4.2, 0), Vector3(0.5, 0.7, 0.35))
			for k in 4:
				var y := 8.5 + k * 0.3
				s.wire("satin", Kit.BLACK, base + Vector3(0, y, 0), base + Vector3(0, y + rng.randf_range(-0.2, 0.2), 16.0), 0.4)
			pz += 16.0
	# vendors, scooters, people (dense)
	# keep the on foot view clear: the character and the camera behind it
	var taken: Array = [[Vector2(cx + 0.4, 41.5), 3.0]]
	for i in 5:
		var p := _free(taken, Vector2(cx + rng.randf_range(-1.6, 1.6), z0 + 8 + i * 19.0), 1.4, hw - 1.2)
		_vehicle_cart(s, Vector3(p.x, 0.06, p.y), rng.randf_range(-0.3, 0.3) + (PI if i % 2 == 0 else 0.0))
	for i in 6:
		var xs := -1.0 if i % 2 == 0 else 1.0
		var p := _free(taken, Vector2(cx + xs * (hw - 0.9), z0 + 6 + i * 15.0), 1.0, hw - 0.6)
		_vehicle(s, "scooter", Vector3(p.x, 0.06, p.y), rng.randf_range(-0.3, 0.3))
	for i in 26:
		var p := _free(taken, Vector2(cx + rng.randf_range(-hw + 0.9, hw - 0.9), rng.randf_range(z0 + 2, z1 - 2)), 0.45, hw - 0.9)
		_person(s, Vector3(p.x, 0.06, p.y), rng.randf_range(0, TAU))
	_commit(s, "Bazaar")
	stats.areas.append("bazaar")


## A spot near want (x, z) at least r from every taken circle, inside |x - centre| <= lim of the bazaar street.
func _free(taken: Array, want: Vector2, r: float, lim: float) -> Vector2:
	var cx := -45.0
	var p := want
	for attempt in 40:
		var ok := true
		for t in taken:
			if p.distance_to(t[0]) < r + t[1]:
				ok = false
				break
		if ok:
			taken.append([p, r])
			return p
		p = Vector2(cx + rng.randf_range(-lim, lim), want.y + rng.randf_range(-6, 6))
	taken.append([p, r])
	return p


func _vehicle_cart(s: Geo.Sink, p: Vector3, yaw: float) -> void:
	s.push(Kit.at(p, yaw))
	Kit.handcart(s, rng)
	s.pop()
	stats.vehicles += 1


func _lutyens(cx: float) -> void:
	var s := Geo.Sink.new()
	var hw := 6.0
	var z0 := -50.0
	var z1 := 50.0
	s.box("road", Kit.ASPHALT, Vector3(cx, ROAD_TOP - 0.15, 0), Vector3(hw * 2, 0.3, z1 - z0 + 8))
	var z := z0
	while z < z1:
		s.box("satin", Kit.MARK, Vector3(cx, ROAD_TOP + 0.006, z), Vector3(0.12, 0.012, 3.0))
		z += 9.0
	for xs in [-1.0, 1.0]:
		# black and white kerb, red gravel shoulder, grass verge with big trees, ornate lamps
		s.push(Transform3D(Basis.IDENTITY, Vector3(cx + xs * (hw + 0.1), 0, 0)))
		for i in int(z1 - z0):
			s.box("satin", Kit.BLACK if i % 2 == 0 else Kit.WHITE, Vector3(0, 0.1, z0 + i + 0.5), Vector3(0.2, 0.2, 1.0))
		s.pop()
		s.box("matte", Color("#a0624a"), Vector3(cx + xs * (hw + 1.0), 0.04, 0), Vector3(1.6, 0.08, z1 - z0 + 8))
		s.box("leaf", Kit.GRASS, Vector3(cx + xs * (hw + 4.0), 0.06, 0), Vector3(4.4, 0.12, z1 - z0 + 8))
		var tz := z0 + 4.0
		while tz < z1:
			_tree(s, Vector3(cx + xs * (hw + 3.6), 0.1, tz + rng.randf_range(-1, 1)), 1.45)
			tz += 12.0
		var lz := z0 + 10.0
		while lz < z1:
			var lp := Vector3(cx + xs * (hw + 1.9), 0.08, lz)
			s.cyl("metal", Kit.BLACK, lp + Vector3(0, 2.0, 0), 0.08, 4.0, Geo.SEG_SMALL, 0.7)
			s.cyl("metal", Kit.BLACK, lp + Vector3(0, 0.3, 0), 0.18, 0.6, Geo.SEG_MID)
			s.ball("glow", Color("#fff3d6"), lp + Vector3(0, 4.3, 0), Vector3(0.28, 0.36, 0.28), Geo.SEG_MID)
			s.dome("metal", Kit.BLACK, lp + Vector3(0, 4.62, 0), 0.32, 0.18, Geo.SEG_MID)
			stats.lights += 1
			lz += 25.0
		# plots: boundary wall with gate, lawn, bungalow set back from the wall
		var wall_x: float = cx + xs * (hw + 6.4)
		var pz := z0
		for k in 3:
			var plot_len := (z1 - z0) / 3.0
			var pc := pz + plot_len * 0.5
			var depth := 30.0
			var lawn_c: float = wall_x + xs * depth * 0.5
			s.box("leaf", Kit.shade(Kit.GRASS, 1.05), Vector3(lawn_c, 0.05, pc), Vector3(depth, 0.1, plot_len - 0.6))
			for seg in [[pz + 0.3, pc - 2.5], [pc + 2.5, pz + plot_len - 0.3]]:
				var sc: float = (seg[0] + seg[1]) * 0.5
				s.box("matte", Kit.PLASTER, Vector3(wall_x, 1.1, sc), Vector3(0.35, 2.2, seg[1] - seg[0]))
				s.box("matte", Kit.SAND_BUFF, Vector3(wall_x, 2.27, sc), Vector3(0.5, 0.14, seg[1] - seg[0]))
			for gz in [pc - 2.7, pc + 2.7]:
				s.box("matte", Kit.SAND_BUFF, Vector3(wall_x, 1.4, gz), Vector3(0.7, 2.8, 0.7))
				s.ball("matte", Kit.PLASTER, Vector3(wall_x, 2.95, gz), Vector3.ONE * 0.3, Geo.SEG_MID)
			for gi in 9:
				s.cyl("metal", Kit.BLACK, Vector3(wall_x, 0.95, pc - 2.0 + gi * 0.5), 0.025, 1.8, Geo.SEG_THIN)
			s.box("metal", Kit.BLACK, Vector3(wall_x, 1.7, pc), Vector3(0.05, 0.06, 4.6))
			s.box("matte", Color("#b07a5a"), Vector3(wall_x + xs * 7.5, 0.11, pc), Vector3(15, 0.03, 3.6))
			# hedge inside the wall
			var hz := pz + 2.0
			while hz < pz + plot_len - 2.0:
				if absf(hz - pc) > 3.0:
					s.ball("leaf", Kit.shade(Kit.LEAF, 1.1), Vector3(wall_x + xs * 0.9, 0.6, hz), Vector3(0.6, 0.6, 1.0), Geo.SEG_MID)
				hz += 1.6
			s.push(Kit.at(Vector3(wall_x + xs * 15.0, 0.1, pc), xs * PI * 0.5))
			_bungalow(s, k)
			s.pop()
			stats.buildings += 1
			pz += plot_len
	# a guard at one gate, a few walkers, one parked white car
	_person(s, Vector3(cx - hw - 5.5, 0.1, z0 + 100.0 / 3.0 * 0.5 + 3.8), -PI * 0.5, {"top": Color("#b09a6a"), "bottom": Color("#b09a6a"), "saree": false})
	for i in 3:
		_person(s, Vector3(cx + (hw + 1.0) * (1.0 if i % 2 == 0 else -1.0), 0.1, -30.0 + i * 25.0), 0.0 if i % 2 == 0 else PI)
	_vehicle(s, "car", Vector3(cx - hw + 1.3, ROAD_TOP, 10.0), 0.0)
	_commit(s, "Lutyens")
	stats.areas.append("lutyens")


## A low white bungalow in the local frame (front on z = 0 facing -Z): verandah colonnade, porch, flat roof.
func _bungalow(s: Geo.Sink, k: int) -> void:
	var w := 22.0
	var d := 13.0
	var h := 5.2 if k != 1 else 4.6
	var col := Kit.PLASTER if k != 2 else Color("#e4d9bf")
	s.box("matte", Kit.shade(col, 0.9), Vector3(0, 0.3, d * 0.5 - 1.0), Vector3(w + 1, 0.6, d + 2))
	s.box("matte", col, Vector3(0, h * 0.5 + 0.6, d * 0.5 + 1.5), Vector3(w, h, d - 3.0))
	s.box("matte", Kit.shade(col, 0.97), Vector3(0, h + 0.6 + 0.4, d * 0.5 + 1.5), Vector3(w + 0.2, 0.8, d - 2.8))
	# verandah roof, chhajja and colonnade
	s.box("matte", col, Vector3(0, h + 0.35, 0.6), Vector3(w, 0.5, 3.4))
	s.box("matte", Kit.shade(col, 0.85), Vector3(0, h + 0.05, -1.2), Vector3(w + 0.6, 0.12, 0.8))
	for i in 9:
		var x := -w * 0.5 + 1.0 + i * (w - 2.0) / 8.0
		s.cyl("matte", Kit.PLASTER, Vector3(x, 0.6 + (h - 0.4) * 0.5, -0.7), 0.24, h - 0.4, Geo.SEG_ROUND)
		s.box("matte", Kit.shade(col, 0.95), Vector3(x, 0.7, -0.7), Vector3(0.6, 0.2, 0.6))
	# doors and windows behind the verandah
	for i in 5:
		var x := -w * 0.5 + 2.2 + i * (w - 4.4) / 4.0
		s.box("matte", Color("#5a3e2b") if i == 2 else Kit.GLASS, Vector3(x, 2.1, 2.98), Vector3(1.3, 2.4, 0.06))
	# porch in front of the door
	s.box("matte", col, Vector3(0, h - 0.2, -3.4), Vector3(6.0, 0.4, 4.0))
	for x in [-2.6, 2.6]:
		s.cyl("matte", Kit.PLASTER, Vector3(x, (h - 0.4) * 0.5 + 0.1, -5.0), 0.26, h - 0.6, Geo.SEG_ROUND)
	if k == 0:
		s.box("matte", col, Vector3(4.0, h + 0.6 + 1.6 + 0.8, d * 0.5 + 2.5), Vector3(9.0, 3.2, 6.0))
