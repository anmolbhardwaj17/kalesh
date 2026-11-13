## Which LOD slot each placed landmark shows from a view point (P2-006; the data is the landmark file of the tile
## folder, landmarks.json, read by game/world/streaming/tile_index.gd). A landmark has its slots by distance
## (lod.slots: level, fromM, toM) and, for a hero, a far silhouette (lod.far: fromM, toM). At most
## limits.heroesAtFullDetailInView heroes show level 0 at once: the nearest keep it, the others drop to level 1
## (perf_budgets.json world.landmarks). The streamed landmark system (P2-007) draws what this picks; it builds
## nothing itself and holds no state.
extends RefCounted

## The level of a landmark that shows its far silhouette, and of one that shows nothing.
const FAR := -1
const HIDDEN := -2


## The cap on heroes at full detail (2 when the file gives none).
static func cap(limits: Dictionary) -> int:
	return int(limits.get("heroesAtFullDetailInView", 2))


## The level by distance alone: the slot whose range holds `d`, the far silhouette past the last slot, else hidden.
static func level_at(lod: Dictionary, d: float) -> int:
	for s: Dictionary in lod.get("slots", []):
		if d >= float(s.fromM) and d < float(s.toM):
			return int(s.level)
	var far: Variant = lod.get("far")
	if far is Dictionary and d >= float(far.fromM) and d < float(far.toM):
		return FAR
	return HIDDEN


## The plan from a view point: [{id, tier, level, distance}] for every landmark that shows something, nearest
## first. `eye` is in world metres; the distance is in the ground plane.
static func plan(landmarks: Array, limits: Dictionary, eye: Vector3) -> Array:
	var out := []
	for lm: Dictionary in landmarks:
		var pos: Array = lm.pos
		var d := Vector2(float(pos[0]) - eye.x, float(pos[2]) - eye.z).length()
		var level := level_at(lm.get("lod", {}), d)
		if level == HIDDEN:
			continue
		out.append({"id": str(lm.id), "tier": str(lm.get("tier", "")), "level": level, "distance": d})
	out.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return a.distance < b.distance or (a.distance == b.distance and a.id < b.id))
	var full := 0
	var most := cap(limits)
	for e: Dictionary in out:
		if e.tier != "hero" or e.level != 0:
			continue
		full += 1
		if full > most:
			e.level = 1
	return out


## How many heroes of a plan show level 0.
static func heroes_at_full_detail(plan_out: Array) -> int:
	var n := 0
	for e: Dictionary in plan_out:
		if e.tier == "hero" and e.level == 0:
			n += 1
	return n
