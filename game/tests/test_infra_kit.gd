## The infrastructure kits (P2-034, game/world/infra/): every record kind of infra.json builds in its group, every
## vertex is finite, a pier's sides face away from its centre, a deck's underside faces down, the near level holds
## the small parts, and a tile of the test block builds inside its budget.
extends RefCounted

const InfraKit := preload("res://world/infra/infra_kit.gd")

var t
var tree: SceneTree


static func records() -> Dictionary:
	var edge := []
	var soffit := []
	var track := []
	var metro := []
	var twall := []
	var topen := []
	var tceil := []
	for k in 6:
		var x := 100.0 + k * 10.0
		edge.append_array([x, 210.0, 50.0, 210.9, 208.8, 0.0, 1.0])
		soffit.append_array([x, 208.8, 50.0, x, 208.8, 39.0])
		track.append_array([x, 200.3, 80.0, 200.0, 0])
		metro.append_array([x, 212.0, 120.0, 200.0])
		# a tunnel 7 m under the ground: the left wall (outward +z), its ceiling; an open ramp wall beside it
		twall.append_array([x, 200.0, 210.0, 205.5, 207.2, 0.0, 1.0])
		topen.append_array([x, 200.0 + k * 0.3, 230.0, 207.3, 206.4, 0.0, 1.0])
		tceil.append_array([x, 205.5, 210.0, x, 205.5, 200.0])
	return {
		"edges": [{"v": "FLY-T1", "k": "d", "p": edge}, {"v": "FLY-B1", "k": "d", "p": edge}, {"v": "FLY-R1", "k": "f", "p": edge}, {"v": "BRI-Y1", "k": "d", "p": edge}, {"v": "FOB-B4", "k": "d", "p": edge}],
		"soffits": [{"v": "FLY-T1", "p": soffit}, {"v": "FLY-B1", "p": soffit}],
		"faces": [{"v": "FLY-T1", "p": [100, 210, 50, 100, 210, 39, 100, 200, 39, 100, 200, 50]}],
		"piers": [
			{"v": "FLY-T1", "x": 120.0, "z": 45.0, "y0": 199.0, "y1": 208.8, "dx": 1.0, "dz": 0.0, "w": 6.6, "d": 11.0, "s": "twin"},
			{"v": "FLY-B1", "x": 130.0, "z": 45.0, "y0": 199.0, "y1": 208.8, "dx": 1.0, "dz": 0.0, "w": 6.6, "d": 11.0, "s": "single"},
			{"v": "FLY-R1", "x": 140.0, "z": 45.0, "y0": 199.0, "y1": 208.8, "dx": 1.0, "dz": 0.0, "w": 3.0, "d": 5.0, "s": "round"},
			{"v": "BRI-Y1", "x": 150.0, "z": 45.0, "y0": 199.0, "y1": 208.8, "dx": 1.0, "dz": 0.0, "w": 6.6, "d": 11.0, "s": "wall"},
			{"v": "MET-VB1", "x": 110.0, "z": 120.0, "y0": 199.0, "y1": 209.45, "dx": 1.0, "dz": 0.0, "w": 1.6, "d": 9.5, "s": "round", "r": 0.8},
			{"v": "FOB-B4", "x": 110.0, "z": 140.0, "y0": 199.5, "y1": 205.5, "dx": 1.0, "dz": 0.0, "w": 0.7, "d": 3.2, "s": "round", "r": 0.35},
			{"v": "RBR-U1", "x": 110.0, "z": 160.0, "y0": 199.0, "y1": 203.0, "dx": 1.0, "dz": 0.0, "w": 5.0, "d": 5.5, "s": "wall"},
		],
		"tracks": [{"v": "RAIL-BG", "b": 0, "p": track}, {"v": "RBR-Y1", "b": 1, "p": track}],
		"masts": [{"x": 110.0, "y": 200.0, "z": 83.1, "dx": 1.0, "dz": 0.0, "reach": -3.1, "wire": 206.2}],
		"platforms": [{"v": "RAIL-PLAT", "r": [100.0, 90.0, 180.0, 90.0, 180.0, 96.0, 100.0, 96.0], "a": [100.0, 93.0, 180.0, 93.0], "h": 201.1, "g": 199.7, "roof": 1}],
		"metro": [{"v": "MET-VB1", "twin": 1, "p": metro}],
		"fobs": [{"v": "FOB-B3", "w": 5.0, "h": 206.5, "p": [100.0, 140.0, 140.0, 140.0], "stairs": [[100.0, 140.0, -1.0, 0.0, 6.5]]}],
		"twalls": [{"v": "TUN-T1", "r": 1, "pp": 0, "s0": 0.0, "p": twall}, {"v": "TUN-T1", "r": 0, "pp": 1, "s0": 0.0, "p": topen}, {"v": "UND-U1", "r": 1, "pp": 0, "s0": 12.0, "p": twall}],
		"tceils": [{"v": "TUN-T1", "s0": 0.0, "p": tceil}, {"v": "TUN-T3", "s0": 0.0, "p": tceil}],
		"theads": [{"v": "TUN-T1", "a": [100.0, 210.0], "b": [100.0, 200.0], "y0": 205.5, "y1": 207.3, "road": 0, "n": [-1.0, 0.0], "name": "Pragati Maidan Tunnel", "floor": 200.0}],
		"tdrains": [{"v": "TUN-T1", "a": [104.0, 200.01, 210.0], "b": [104.0, 200.01, 200.0]}],
	}


func test_every_kind_builds_in_its_group_with_finite_vertices() -> void:
	var out := InfraKit.build(records(), Vector3(0, 195, 0))
	for g: String in InfraKit.GROUPS:
		var n := int(out[g].base.triangles)
		t.ok(n > 0, "group %s builds a base level (%d triangles)" % [g, n])
		t.ok(int(out[g].near.triangles) > 0, "group %s builds a near level" % g)
		for level: String in ["base", "near"]:
			for k: String in out[g][level].arrays_of("main"):
				var v: PackedVector3Array = out[g][level].arrays_of("main")[k][Mesh.ARRAY_VERTEX]
				var bad := 0
				for p in v:
					if not (is_finite(p.x) and is_finite(p.y) and is_finite(p.z)):
						bad += 1
				t.ok(bad == 0, "%s %s %s: every vertex is finite (%d bad)" % [g, level, k, bad])
	t.ok(int(out.triangles) < 200000, "the sample builds in under 200,000 triangles (%d)" % int(out.triangles))


func test_a_piers_sides_face_away_from_it_and_a_soffit_faces_down() -> void:
	var recs := {"piers": [{"v": "FLY-B1", "x": 0.0, "z": 0.0, "y0": 0.0, "y1": 10.0, "dx": 1.0, "dz": 0.0, "w": 6.6, "d": 11.0, "s": "single"}]}
	var out := InfraKit.build(recs, Vector3.ZERO)
	var a: Array = out.road.base.arrays_of("main")["matte"]
	var v: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
	var n: PackedVector3Array = a[Mesh.ARRAY_NORMAL]
	var away := 0
	var sides := 0
	for i in v.size():
		if absf(n[i].y) > 0.5 or v[i].y > 8.0:
			continue
		sides += 1
		if Vector2(v[i].x, v[i].z).dot(Vector2(n[i].x, n[i].z)) > 0.0:
			away += 1
	t.ok(sides > 0 and away == sides, "the column's sides face away from it (%d of %d)" % [away, sides])
	var soffit := []
	for k in 3:
		soffit.append_array([k * 10.0, 5.0, 0.0, k * 10.0, 5.0, 10.0])
	out = InfraKit.build({"soffits": [{"v": "FLY-B1", "p": soffit}]}, Vector3.ZERO)
	a = out.road.base.arrays_of("main")["matte"]
	n = a[Mesh.ARRAY_NORMAL]
	var down := 0
	for q in n:
		if q.y < 0.0:
			down += 1
	t.ok(down * 10 >= n.size() * 6, "the box soffit faces down or out, never into the deck (%d of %d normals down)" % [down, n.size()])


## P2-032: a tunnel's ceiling faces down, its walls face the road, its lamps glow, and its mouth carries the name.
func test_a_tunnel_ceiling_faces_down_its_walls_face_the_road_and_the_mouth_has_its_name() -> void:
	var out := InfraKit.build(records(), Vector3.ZERO)
	var base: Dictionary = out.tunnel.base.arrays_of("main")
	t.ok(base.has("glow"), "the lamps at the mouth are in the glow material")
	t.ok(base.has("tunnel_glow"), "the strip lines inside are in the tunnel's own glow material")
	# the inside of a roofed stretch is lit by the strip lines (tunnel_lit.gdshader: the walls, the soffit, the road
	# and the fittings each on their surface), the open walls satin or matte
	for key: String in ["tunnel_wall", "tunnel_soffit"]:
		t.ok(base.has(key), "the inside of the tunnel has its %s surface" % key)
		if base.has(key):
			t.ok(base[key][Mesh.ARRAY_TEX_UV] != null and base[key][Mesh.ARRAY_CUSTOM0] != null, "%s carries the shader's UV and the strip vectors" % key)
	var v := PackedVector3Array()
	var nrm := PackedVector3Array()
	for key: String in ["matte", "satin", "tunnel_lit", "tunnel_wall", "tunnel_soffit"]:
		if not base.has(key):
			continue
		var arr: Array = base[key]
		v.append_array(arr[Mesh.ARRAY_VERTEX])
		nrm.append_array(arr[Mesh.ARRAY_NORMAL])
	var ceiling_down := 0
	var ceiling_up := 0
	var wall_in := 0
	var wall_out := 0
	for i in v.size():
		var p := v[i]
		var nn := nrm[i]
		# the ceiling: flat at 205.5 between z 200 and 210, x 100 to 150
		if absf(p.y - 205.5) < 0.01 and p.z > 199.9 and p.z < 210.1 and absf(nn.y) > 0.9:
			if nn.y < 0.0:
				ceiling_down += 1
			else:
				ceiling_up += 1
		# the roofed left wall at z 210 (outward +z): its face looks into the road (-z)
		if absf(p.z - 210.0) < 0.001 and p.y > 199.9 and p.y < 205.6 and absf(nn.z) > 0.9:
			if nn.z < 0.0:
				wall_in += 1
			else:
				wall_out += 1
	t.ok(ceiling_down > 0 and ceiling_up == 0, "the ceiling faces down (%d down, %d up)" % [ceiling_down, ceiling_up])
	t.ok(wall_in > 0 and wall_out == 0, "the tunnel wall faces the road (%d in, %d out)" % [wall_in, wall_out])
	var labels: Array = out.labels
	t.ok(labels.size() == 1 and str(labels[0].text) == "PRAGATI MAIDAN TUNNEL", "the mouth carries the tunnel's name (%s)" % str(labels))
	t.ok(int(out.tunnel.near.triangles) > 500, "the mural, trays, fans and fittings are in the near level (%d triangles)" % int(out.tunnel.near.triangles))


func test_a_tile_of_the_test_block_builds_inside_its_budget() -> void:
	var f := "res://world/test_tiles/infra.json"
	if not FileAccess.file_exists(f):
		t.ok(true, "no infra.json in the test block (skipped)")
		return
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(f))
	var tiles: Dictionary = parsed.tiles
	t.ok(tiles.has("9_-5"), "the test block's ITO tile has kit records")
	var t0 := Time.get_ticks_msec()
	var out := InfraKit.build(tiles.get("9_-5", {}), Vector3(2250, 200, -1250))
	var ms := Time.get_ticks_msec() - t0
	t.ok(int(out.triangles) > 1000 and int(out.triangles) < 400000, "the ITO tile builds %d triangles (1,000 to 400,000)" % int(out.triangles))
	t.less(float(ms), 1500.0, "the ITO tile builds in under 1.5 s on one thread (%d ms)" % ms)
