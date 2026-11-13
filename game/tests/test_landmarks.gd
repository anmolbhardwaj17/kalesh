## Landmark LOD slots (P2-006; game/world/landmark_slots.gd, the landmark file read by tile_index.gd): the level a
## landmark shows by distance, the far silhouette of a hero, the cap of 2 heroes at full detail, and the landmark
## file and pins of the committed test block.
extends RefCounted

const LandmarkSlots := preload("res://world/landmark_slots.gd")
const TileIndex := preload("res://world/streaming/tile_index.gd")
const TileReader := preload("res://world/streaming/tile_reader.gd")
const TEST_TILES := "res://world/test_tiles/"

var t
var tree: SceneTree


func _hero(id: String, x: float, z: float) -> Dictionary:
	return {
		"id": id, "tier": "hero", "pos": [x, 210.0, z],
		"lod": {"slots": [{"level": 0, "fromM": 0, "toM": 350}, {"level": 1, "fromM": 350, "toM": 900}, {"level": 2, "fromM": 900, "toM": 1800}], "far": {"fromM": 1800, "toM": 6000}},
	}


func _marker(id: String, x: float, z: float) -> Dictionary:
	return {"id": id, "tier": "marker", "pos": [x, 210.0, z], "lod": {"slots": [{"level": 0, "fromM": 0, "toM": 700}], "far": null}}


func test_level_by_distance() -> void:
	var lod: Dictionary = _hero("a", 0.0, 0.0).lod
	t.ok(LandmarkSlots.level_at(lod, 0.0) == 0 and LandmarkSlots.level_at(lod, 349.9) == 0, "full detail to 350 m")
	t.ok(LandmarkSlots.level_at(lod, 350.0) == 1 and LandmarkSlots.level_at(lod, 1000.0) == 2, "the lower levels follow, each from where the last ends")
	t.ok(LandmarkSlots.level_at(lod, 1800.0) == LandmarkSlots.FAR and LandmarkSlots.level_at(lod, 5999.0) == LandmarkSlots.FAR, "past the last level a hero shows its far silhouette")
	t.ok(LandmarkSlots.level_at(lod, 6000.0) == LandmarkSlots.HIDDEN, "past its visibility distance it shows nothing")
	t.ok(LandmarkSlots.level_at(_marker("m", 0.0, 0.0).lod, 800.0) == LandmarkSlots.HIDDEN, "a marker has no far silhouette")


func test_at_most_two_heroes_at_full_detail() -> void:
	var lms := [_hero("near", 100.0, 0.0), _hero("mid", 0.0, 200.0), _hero("third", -300.0, 0.0), _hero("far", 0.0, -3000.0), _marker("m1", 50.0, 50.0), _marker("m2", 5000.0, 0.0)]
	var limits := {"heroesAtFullDetailInView": 2}
	var plan: Array = LandmarkSlots.plan(lms, limits, Vector3(0.0, 0.0, 0.0))
	t.ok(LandmarkSlots.heroes_at_full_detail(plan) == 2, "three heroes within 350 m, two at full detail")
	var by := {}
	for e: Dictionary in plan:
		by[e.id] = e
	t.ok(by.near.level == 0 and by.mid.level == 0 and by.third.level == 1, "the two nearest keep level 0, the third drops to level 1")
	t.ok(by.far.level == LandmarkSlots.FAR and by.m1.level == 0 and not by.has("m2"), "a hero 3 km off shows its silhouette, a marker 5 km off nothing")
	t.ok(plan[0].id == "m1" and plan[1].id == "near", "the plan is nearest first")
	t.ok(LandmarkSlots.heroes_at_full_detail(LandmarkSlots.plan(lms, {"heroesAtFullDetailInView": 1}, Vector3.ZERO)) == 1 and LandmarkSlots.cap({}) == 2, "the cap comes from the file, 2 without one")
	# the height of the eye does not count: distances are in the ground plane
	t.ok(LandmarkSlots.plan(lms, limits, Vector3(0.0, 500.0, 0.0))[1].level == 0, "the eye's height does not change the plan")


func test_the_landmark_file_and_pins_of_the_test_block() -> void:
	var index: RefCounted = TileIndex.open(TEST_TILES)
	t.ok(index.error == "", "the test block opens")
	t.ok(index.landmarks.size() > 100 and index.far_landmarks.size() == 5, "the landmark file lists the placed landmarks (%d) and the 5 far ones" % index.landmarks.size())
	t.ok(LandmarkSlots.cap(index.landmark_limits) == 2 and int(index.landmark_limits.get("farSilhouetteTriangles", 0)) == 2000, "the limits: 2 heroes at full detail, 2,000 triangles a far silhouette")
	var heroes := []
	for lm: Dictionary in index.landmarks:
		if lm.tier == "hero":
			heroes.append(lm)
	t.ok(heroes.size() == 3, "three heroes in the pilot (%d)" % heroes.size())
	for h: Dictionary in heroes:
		var s: Variant = h.get("silhouette")
		t.ok(s != null and int(index.silhouettes[int(s)].triangles) <= 2000 and int(index.silhouettes[int(s)].triangles) > 0, "hero %s has a far silhouette under 2,000 triangles" % h.id)
		t.ok(h.lod.slots.size() == 3 and h.lod.far is Dictionary, "hero %s has a chain of 3 levels and a far slot" % h.id)
	for f: Dictionary in index.far_landmarks:
		t.ok(not bool(f.reachable) and not bool(f.nav) and not index.has(Vector2i(floori(float(f.pos[0]) / 250.0), floori(float(f.pos[2]) / 250.0))), "far landmark %s is in no tile and is no map destination" % f.id)
	# from the middle of the pilot no more than two heroes are ever at full detail
	for lm: Dictionary in heroes:
		var plan: Array = LandmarkSlots.plan(index.landmarks, index.landmark_limits, Vector3(float(lm.pos[0]), 0.0, float(lm.pos[2])))
		t.ok(LandmarkSlots.heroes_at_full_detail(plan) <= 2 and LandmarkSlots.heroes_at_full_detail(plan) >= 1, "standing at %s: 1 or 2 heroes at full detail" % lm.id)
	# a landmark pin of a test block tile carries its tier and its front
	var found := 0
	for key: Vector2i in index.tiles:
		var tile: Dictionary = TileReader.read(index.path(key))
		if not tile.get("ok", false):
			continue
		for p: Dictionary in tile.pins:
			if p.kind == "landmark":
				found += 1
				t.ok(str(p.id).begins_with("lm:") and p.has("tier") and p.has("mode"), "landmark pin %s has its tier and mode" % p.id)
	t.ok(found > 0, "the test block has landmark pins (%d)" % found)
