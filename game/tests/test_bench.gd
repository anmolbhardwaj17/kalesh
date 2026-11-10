## The render bench world and crowd (game/bench/render/, P0-016): the city and the old city block have the counts the
## bench asks for, are seeded, stay inside their bounds, are never mirrored, and the walk cycle is a loop.
extends RefCounted

const World := preload("res://bench/render/world.gd")
const Crowd := preload("res://bench/render/crowd.gd")
const Kit := preload("res://scenes/standin/kit.gd")

var t
var tree: SceneTree


func _world(layout: String) -> RefCounted:
	var w := World.new(Kit.materials())
	w.build_data(layout)
	return w


func test_city_has_the_counts_the_bench_asks_for() -> void:
	var w := _world("city")
	t.ok(w.stats.sizeM == 2000.0, "the city is 2 km wide (%s)" % w.stats.sizeM)
	t.ok(w.stats.buildings >= 2000, "2000 or more buildings (%d)" % w.stats.buildings)
	t.ok(w.stats.vehicles + w.stats.props >= 500 and w.stats.vehicles >= 500, "500 or more vehicles and props (%d vehicles, %d props)" % [w.stats.vehicles, w.stats.props])
	var inside := true
	var mirrored := false
	for b in w.buildings:
		var p: Vector3 = b.xf.origin
		inside = inside and absf(p.x) <= w.half and absf(p.z) <= w.half
		mirrored = mirrored or b.xf.basis.determinant() < 0.0
	t.ok(inside, "every building stands inside the 2 km square")
	t.ok(not mirrored, "no building frame is mirrored")
	for p in w.props:
		mirrored = mirrored or (p[1] as Transform3D).basis.determinant() < 0.0
	t.ok(not mirrored, "no prop frame is mirrored")


func test_kit_block_uses_20_to_40_modules() -> void:
	var w := _world("kit")
	t.ok(w.stats.sizeM == 500.0, "the old city block is 500 m wide")
	t.ok(w.stats.modulesUsed >= 20 and w.stats.modulesUsed <= 40, "20 to 40 facade and prop modules in use (%d)" % w.stats.modulesUsed)
	t.ok(w.stats.buildings >= 2000, "a dense block (%d buildings)" % w.stats.buildings)


func test_world_is_seeded() -> void:
	var a := _world("kit")
	var b := _world("kit")
	t.ok(a.stats == b.stats, "two builds have the same counts")
	t.ok(a.buildings[100].xf == b.buildings[100].xf and a.buildings[100].mods.size() == b.buildings[100].mods.size(), "and the same building 100")


func test_hybrid_draw_sets_lod_ranges_and_mirrors_nothing() -> void:
	var w := _world("kit")
	var root := Node3D.new()
	var out: Dictionary = w.realise(root, "i3", true, 0.9)
	t.ok(out.multiMeshes > 0 and out.meshInstances > 0, "MultiMeshes and merged meshes (%s)" % [out])
	var ranged := 0
	var mirrored := false
	var shader_instances := 0
	for n in root.get_children():
		var g := n as GeometryInstance3D
		if g == null:
			continue
		if g.visibility_range_end > 0.0 or g.visibility_range_begin > 0.0:
			ranged += 1
		mirrored = mirrored or g.transform.basis.determinant() < 0.0
		if g is MeshInstance3D:
			shader_instances += 1
	t.ok(ranged > 0, "LOD levels use visibility ranges (%d nodes)" % ranged)
	t.ok(not mirrored, "no node is mirrored")
	t.ok(shader_instances < 4096, "nodes that set the wear instance uniform stay under the engine's 4096 (%d)" % shader_instances)
	root.free()


func test_walk_cycle_loops_and_legs_alternate() -> void:
	var a: Dictionary = Crowd.walk_pose(0.0)
	var b: Dictionary = Crowd.walk_pose(1.0)
	var same := true
	for bone in a:
		same = same and (a[bone] as Quaternion).is_equal_approx(b[bone])
	t.ok(same, "phase 1 is phase 0")
	var q: Dictionary = Crowd.walk_pose(0.25)
	var left: Quaternion = q[14]
	var right: Quaternion = q[17]
	t.ok(left.is_equal_approx(right.inverse()), "the thighs swing against each other")
	t.ok(Crowd.BONES.size() == 20, "the stand-in skeleton has 20 bones")
