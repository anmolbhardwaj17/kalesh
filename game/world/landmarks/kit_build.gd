## Builds one landmark from the parts kit (P2-007): its recipe at every level (0, 1, 2 and the far silhouette, 3)
## into packed arrays per part and material, the collision shapes of level 0, the built height and the counts.
## Runs on a worker thread (game/world/systems/landmarks.gd): no nodes, no resources, no shared state.
extends RefCounted

const KitMesh := preload("res://world/landmarks/kit_mesh.gd")
const RECIPES := {
	"india_gate": preload("res://world/landmarks/recipes/india_gate.gd"),
	"canopy": preload("res://world/landmarks/recipes/canopy.gd"),
	"red_fort": preload("res://world/landmarks/recipes/red_fort.gd"),
	"cp_circle": preload("res://world/landmarks/recipes/cp_circle.gd"),
	"jama_masjid": preload("res://world/landmarks/recipes/jama_masjid.gd"),
}
## Levels built per landmark: 0 to 2 near, 3 the far silhouette.
const LEVELS := 4
## A far silhouette stays under this many triangles (perf_budgets.json world.landmarks.farSilhouetteTriangles).
const FAR_TRIANGLES := 2000


static func has_recipe(lm: Dictionary) -> bool:
	return lm.get("kit") is Dictionary and RECIPES.has(str(lm.kit.get("recipe", "")))


## {id, recipe, levels: [{parts: {name: {material: arrays}}, triangles, partTriangles: {name: n}}], colliders,
##  heightM, heightPart, topM, ms}. Empty `levels` and an `error` when the landmark has no recipe.
static func build(lm: Dictionary) -> Dictionary:
	var t0 := Time.get_ticks_usec()
	var out := {"id": str(lm.get("id", "")), "recipe": "", "levels": [], "colliders": [], "heightM": 0.0, "heightPart": "", "topM": 0.0}
	if not has_recipe(lm):
		out["error"] = "no kit recipe"
		return out
	var recipe: String = str(lm.kit.recipe)
	out.recipe = recipe
	var script: Script = RECIPES[recipe]
	for lod in LEVELS:
		var m := KitMesh.new()
		m.collide = lod == 0
		var r: Dictionary = script.call("build", m, lm.kit, lm, lod)
		var parts := {}
		var per := {}
		for name: String in m.part_names():
			parts[name] = m.arrays_of(name)
			var n := 0
			for k: String in parts[name]:
				n += (parts[name][k][Mesh.ARRAY_INDEX] as PackedInt32Array).size() / 3
			per[name] = n
		out.levels.append({"parts": parts, "triangles": m.triangles, "partTriangles": per})
		if lod == 0:
			out.colliders = m.colliders
			out.heightM = float(r.get("heightM", m.top))
			out.heightPart = str(r.get("heightPart", ""))
			out.topM = m.top
	out["ms"] = (Time.get_ticks_usec() - t0) / 1000.0
	return out
