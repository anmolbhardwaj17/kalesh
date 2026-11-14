## The three leads' fixed looks. Since P2-063 each lead with an owner model (rig/lead_<id>.scn, built from
## public/assets/models/model_lead_<id>.glb by tools/characters/lead_build.mjs) is drawn on that model at its height;
## the rest of this file is the stand-in that remains for a lead without one: stand-in colours (P1-023, STYLE_BIBLE.md "Characters", GAME.md "The three
## characters"), until their models arrive (art requests model_lead_bittu, model_lead_meera, model_lead_danny). One
## mannequin of the Universal Animation Library serves all three (the female mannequin of the same rig for Meera); the
## look is the uniforms of rig/lead_look.gdshader plus the body's height. Respect rule: real proportions, everyday
## clothes in the cloth palette, no caricature; skin tones from the palette's five.
## Each look: mesh "m" or "f", height (m), and the shader uniforms (colours as hex, features 0 or 1).
extends RefCounted

const LOOKS := {
	# Bittu, the auto driver: khaki uniform shirt with rolled sleeves worn loose, dark trousers, sandals, a red and
	# white checked gamchha over the left shoulder.
	"bittu": {
		"mesh": "m", "height": 1.72,
		"skin": "#8d5a3b", "hair": "#1f1b1a", "shirt": "#a8946a", "sleeve_col": "#a8946a", "trousers": "#3b3a3c",
		"shoes": "#4a3328", "accent_a": "#b03a2e", "accent_b": "#f2f0ea",
		"sleeve": 0.48, "hem": 0.95, "hair_front": 1.765, "hair_back": 1.61, "gamchha": 1.0, "sandals": 1.0,
		"moustache": 1.0,
	},
	# SI Meera Rana, the cop: the khaki police uniform, full sleeves tucked in, a plain dark belt with a holster on the
	# right hip, black shoes, hair in a bun.
	"meera": {
		"mesh": "f", "height": 1.64,
		"skin": "#a86b45", "hair": "#1c1a1a", "shirt": "#857247", "sleeve_col": "#857247", "trousers": "#76653f",
		"shoes": "#232325", "belt_col": "#33261c", "metal": "#c9a24a",
		"sleeve": 0.97, "hem": 1.0, "hair_front": 1.755, "hair_back": 1.56, "belt": 1.0, "bun": 1.0,
		"uniform_marks": 1.0, "eye_y": 1.685,
	},
	# Danny, the fixer: a maroon jacket open over a printed shirt, a gold chain, sunglasses pushed up into his hair,
	# black trousers, white trainers.
	"danny": {
		"mesh": "m", "height": 1.78,
		"skin": "#c68a5e", "hair": "#2a201b", "shirt": "#6e1f2b", "sleeve_col": "#6e1f2b", "trousers": "#262628",
		"shoes": "#e8e3d5", "inner_a": "#d9a92a", "inner_b": "#1f6f8b", "metal": "#d4a537",
		"sleeve": 1.2, "hem": 0.96, "hair_front": 1.775, "hair_back": 1.6, "jacket": 1.0, "glasses": 1.0,
	},
}

## The built lead model of a look, or "" when there is none (the stand-in mannequin is drawn then).
const MODEL_PATH := "res://characters/rig/lead_%s.scn"


static func model_path(id: String) -> String:
	var p := MODEL_PATH % id
	return p if LOOKS.has(id) and ResourceLoader.exists(p) else ""


## The uniform scale that gives a built lead model its height: the look's height over the model's rest height (soles
## to the top of the head, from the model's "lead" metadata).
static func model_scale(id: String, meta: Dictionary) -> float:
	return float(look(id)["height"]) / maxf(float(meta.get("rest_height", 1.0)), 1e-3)


## Height of the rig's mannequins in the rest pose (top of the head over the soles, m): mannequin_m and mannequin_f.
const REST_HEIGHT := {"m": 1.829, "f": 1.806}


static func look(id: String) -> Dictionary:
	return LOOKS.get(id, LOOKS["bittu"])


## The uniform scale that gives the stand-in mannequin the look's height.
static func scale_of(id: String) -> float:
	var l := look(id)
	return float(l["height"]) / float(REST_HEIGHT[l["mesh"]])


## A ShaderMaterial of the look (one per character; the mesh is shared).
static func material(id: String, shader: Shader) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = shader
	var l := look(id)
	for k in l:
		if k in ["mesh", "height", "bun"]:
			continue
		var v: Variant = l[k]
		if v is String:
			m.set_shader_parameter(k, Color.html(v))
		else:
			m.set_shader_parameter(k, float(v))
	return m
