## The procedural modules of the area kits (P2-010, DELHI_WORLD.md "Area kits"): one builder per design, each a few
## dozen quads in the module frame of module_mesh.gd, its options read from the kit's area sheet (RECIPES). Designs are
## stand-ins in the signed stylised B look: real proportions (storey 3.2 m authored, scaled to the floor), detail from
## the kit's layers and atlas, and the railings Delhi houses have (Anmol 2026-11-13): balcony railings, roof parapet
## railings, front gates, window grilles and outside stairs with railings. A module is replaced by id through ingest
## later (module_library.gd); the ids and the placements never change.
extends RefCounted

const M := preload("res://world/kits/module_mesh.gd")
const P := preload("res://world/kits/kit_pieces.gd")

## atlas cells (tools/kits/make_textures.mjs): lower half, 256 px each
const A_POSTERS := Rect2(0.0, 0.5, 0.25, 0.25)
const A_DOOR := Rect2(0.25, 0.5, 0.25, 0.25)
const A_GATE := Rect2(0.5, 0.5, 0.25, 0.25)
const A_JALI := Rect2(0.75, 0.5, 0.25, 0.25)
const A_AC := Rect2(0.0, 0.75, 0.25, 0.25)
const A_GOODS := [Rect2(0.25, 0.75, 0.25, 0.25), Rect2(0.5, 0.75, 0.25, 0.25)]
const A_SIGN := Rect2(0.75, 0.75, 0.25, 0.25)

const WHITE := Color(1, 1, 1)
const SHADE := Color(0.86, 0.86, 0.86)
const DARK_GLASS := Color(0.16, 0.19, 0.21)
const COPING := Color(0.62, 0.6, 0.56)
const BLACK := Color(0.11, 0.11, 0.12)

## kit -> part (the bake's part names) -> [design, options]. A building type's module `<type>.<part>` takes the recipe
## of its kit (kits.json types); a part a kit has no recipe for takes DEFAULT's.
const DEFAULT := {
	"gf_shop": ["shop", {}], "gf_door": ["door", {}], "gf_plain": ["plain", {}], "gf_gate": ["gate", {}],
	"gf_colonnade": ["colonnade", {}], "gf_arcade": ["arcade", {}],
	"up_window": ["window", {}], "up_balcony": ["balcony", {}], "up_jharokha": ["jharokha", {}], "up_blank": ["blank", {}],
	"up_strip": ["strip", {}], "up_glass": ["glass", {}], "roof_parapet": ["parapet", {}],
}
const RECIPES := {
	"colonnade": {
		"gf_colonnade": ["colonnade", {"z": 2.0, "shop": true}], "gf_arcade": ["arcade", {}], "gf_door": ["door", {"glass": true}],
		"gf_shop": ["shop", {"glass": true, "awning": false}], "gf_plain": ["plain", {"cornice": true}],
		"up_window": ["window", {"shutters": true, "cornice": true}], "up_blank": ["blank", {"cornice": true}],
		"up_balcony": ["balcony", {"solid": true}], "roof_parapet": ["parapet", {"balustrade": true}],
	},
	"bazaar": {
		"gf_shop": ["shop", {"awning": true, "shutter": 0.22, "goods": 0}], "gf_door": ["door", {"studs": true}],
		"up_window": ["window", {"chhajja": true, "grille": true}], "up_balcony": ["balcony", {"railing": true}],
		"up_blank": ["blank", {"pipe": true, "wires": true}], "roof_parapet": ["parapet", {}],
	},
	"gali": {
		"gf_shop": ["shop", {"chhajja": true, "shutter": 0.4, "goods": 1, "narrow": true}], "gf_door": ["door", {"studs": true, "arch": true}],
		"gf_plain": ["plain", {"plinth": true}], "gf_gate": ["gate", {}],
		"up_window": ["window", {"chhajja": true, "grille": true, "arch": true}], "up_balcony": ["balcony", {"railing": true}],
		"up_blank": ["blank", {"pipe": true, "wires": true}], "roof_parapet": ["parapet", {"jali": true}],
	},
	"hotel": {
		"gf_shop": ["shop", {"awning": true, "shutter": 0.15, "goods": 1}], "gf_door": ["door", {"glass": true, "canopy": true}],
		"up_window": ["window", {"grille": true}], "up_balcony": ["balcony", {"cage": true}], "up_blank": ["blank", {"pipe": true}],
		"roof_parapet": ["parapet", {}],
	},
	"office": {
		"gf_plain": ["plain", {"band": true}], "gf_door": ["door", {"glass": true, "canopy": true}], "gf_shop": ["shop", {"glass": true, "awning": false}],
		"gf_gate": ["gate", {}], "up_window": ["window", {"fins": true}], "up_strip": ["strip", {}], "up_glass": ["glass", {}],
		"up_blank": ["blank", {"concrete": true}], "up_balcony": ["balcony", {"solid": true}], "roof_parapet": ["parapet", {"concrete": true}],
	},
	"lutyens": {
		"gf_plain": ["window", {"shutters": true, "tall": true, "cornice": true}], "gf_door": ["door", {"portico": true}],
		"gf_colonnade": ["colonnade", {"z": 1.4, "shop": false}], "up_window": ["window", {"shutters": true, "cornice": true}],
		"up_blank": ["blank", {"cornice": true}], "roof_parapet": ["parapet", {"balustrade": true}],
	},
	"market": {
		"gf_shop": ["shop", {"awning": false, "shutter": 0.1, "goods": 0, "chhajja": true}], "gf_door": ["door", {}],
		"up_window": ["window", {"chhajja": true}], "up_blank": ["blank", {"pipe": true}], "roof_parapet": ["parapet", {}],
	},
	"hardware": {
		"gf_shop": ["shop", {"awning": true, "shutter": 0.12, "goods": 0, "spill": true}], "gf_door": ["door", {"studs": true}],
		"gf_gate": ["gate", {}], "gf_plain": ["plain", {"plinth": true}], "up_window": ["window", {"grille": true, "chhajja": true}],
		"up_balcony": ["balcony", {"railing": true}], "up_blank": ["blank", {"pipe": true, "wires": true}], "roof_parapet": ["parapet", {}],
	},
}
## Pieces a kit adds to some bays (`<kit>.<piece>` ids), from which part, and the kits.json share that decides how
## often. A stair and a roof tank are decided per wall column (every floor of a blank column carries the stair, so it
## climbs from the street to the top floor); the rest per bay.
const PIECES := {
	"board": {"from": ["gf_shop", "gf_colonnade", "gf_arcade"], "share": "board", "column": false},
	"stair": {"from": ["up_blank"], "share": "stair", "column": true},
	"tank": {"from": ["roof_parapet"], "share": "tank", "column": true},
	"rail": {"from": ["roof_parapet"], "share": "roof_rail", "column": true},
	"ac": {"from": ["up_window", "up_strip"], "share": "ac", "column": false},
	"awning": {"from": ["gf_shop"], "share": "awning", "column": false},
	"vsign": {"from": ["gf_door"], "share": "vsign", "column": false},
}
## Pieces a kit has beyond kits.json shares (kit id -> piece -> share).
const EXTRA_SHARES := {"market": {"awning": 1.0}, "hotel": {"vsign": 0.6}}
## Modules of a kit no bake placement uses yet (the Lutyens boundary wall and gate pier; DELHI_WORLD.md "Area kits").
const UNPLACED := {"lutyens": ["wall", "gate_pier"]}


## The mesh of one design with its options.
static func build(design: String, o: Dictionary, kit: String) -> ArrayMesh:
	var m := M.new()
	match design:
		"shop": _shop(m, o)
		"door": _door(m, o)
		"plain": _plain(m, o)
		"gate": _gate(m, o)
		"colonnade": _colonnade(m, o)
		"arcade": _arcade(m, o)
		"window": _window(m, o)
		"balcony": _balcony(m, o)
		"jharokha": _jharokha(m, o)
		"blank": _blank(m, o)
		"strip": _strip(m, o)
		"glass": _glass(m, o)
		"parapet": _parapet(m, o)
		"board": P._board(m, kit)
		"stair": P._stair(m, o)
		"tank": P._tank(m, o)
		"rail": P._rail(m, o)
		"ac": P._ac(m, o)
		"awning": P._awning(m, o)
		"vsign": P._vsign(m, o)
		"wall": P._wall(m, o)
		"gate_pier": P._gate_pier(m, o)
		_:
			_blank(m, o)
	return m.mesh()


# ------------------------------------------------------------------ shared bits


static func _band(m: M, y0: float, y1: float, z: float) -> void:
	m.paint(M.RENDER, M.WALL, SHADE)
	m.box(Vector3(-1.5, y0, 0.0), Vector3(1.5, y1, z), false, true)


static func _chhajja(m: M, y: float, depth: float) -> void:
	m.paint(M.CONCRETE, M.WALL, Color(0.82, 0.82, 0.82))
	m.box(Vector3(-1.5, y, 0.0), Vector3(1.5, y + 0.1, depth), false, true)


static func _grille(m: M, r: Rect2, z: float, step := 0.17) -> void:
	m.paint(M.IRON, M.ACCENT, WHITE)
	m.fine = true
	var x := r.position.x + step * 0.5
	while x < r.end.x:
		m.front(x - 0.012, r.position.y, x + 0.012, r.end.y, z)
		x += step
	for f in [0.08, 0.5, 0.92]:
		var y: float = r.position.y + r.size.y * f
		m.front(r.position.x, y - 0.015, r.end.x, y + 0.015, z + 0.005)
	m.fine = false


## Front-only bars of a railing (module_mesh.gd railing).
static func _railing(m: M, x0: float, x1: float, y: float, h: float, z: float, step := 0.16) -> void:
	m.railing(x0, x1, y, h, z, step)


## A railing along x (constant x) from z0 to z1 (the side of a balcony), facing +x or -x.
static func _side_railing(m: M, x: float, z0: float, z1: float, y: float, h: float, facing: float) -> void:
	m.paint(M.IRON, M.ACCENT, WHITE)
	m.bar(Vector3(x, y + h, z0), Vector3(x, y + h, z1), 0.04)
	var z := z0 + 0.12
	m.fine = true
	while z < z1:
		var a := Vector3(x, y, z - 0.01)
		var b := Vector3(x, y, z + 0.01)
		if facing < 0.0:
			m.quad(a, b, b + Vector3(0, h, 0), a + Vector3(0, h, 0))
		else:
			m.quad(b, a, a + Vector3(0, h, 0), b + Vector3(0, h, 0))
		z += 0.16
	m.fine = false


static func _opening(m: M, r: Rect2, depth: float, inner_code: int, inner_mode: int, inner: Color, atlas := Rect2()) -> void:
	m.paint(M.RENDER, M.WALL, Color(0.9, 0.9, 0.9))
	m.reveal(r, depth)
	m.paint(inner_code, inner_mode, inner)
	m.face = true
	m.front(r.position.x, r.position.y, r.end.x, r.end.y, M.SKIN + 0.004, atlas)
	m.face = false


## Columns as eight-sided shafts with a base block and a capital.
static func _column(m: M, x: float, z: float, y0: float, y1: float, r: float) -> void:
	m.paint(M.STONE, M.OWN, Color(0.95, 0.94, 0.9))
	m.box(Vector3(x - r * 1.35, y0, z - r * 1.35), Vector3(x + r * 1.35, y0 + 0.35, z + r * 1.35), true, false)
	m.paint(M.RENDER, M.WALL, WHITE)
	var n := 8
	for i in n:
		var a0 := TAU * float(i) / n
		var a1 := TAU * float(i + 1) / n
		var p0 := Vector3(x + cos(a0) * r, 0, z + sin(a0) * r)
		var p1 := Vector3(x + cos(a1) * r, 0, z + sin(a1) * r)
		m.quad(Vector3(p1.x, y0 + 0.35, p1.z), Vector3(p0.x, y0 + 0.35, p0.z), Vector3(p0.x, y1 - 0.2, p0.z), Vector3(p1.x, y1 - 0.2, p1.z))
	m.box(Vector3(x - r * 1.3, y1 - 0.2, z - r * 1.3), Vector3(x + r * 1.3, y1, z + r * 1.3), true, true)


# ------------------------------------------------------------------ ground floor


static func _shop(m: M, o: Dictionary) -> void:
	var w := 1.15 if o.get("narrow", false) else 1.3
	var top := 2.55
	var r := Rect2(-w, 0.0, w * 2.0, top)
	m.paint(M.RENDER, M.WALL, WHITE)
	m.skin(0.0, M.MODULE_H, [r])
	if o.get("glass", false):
		# a glass shop front with a door and a fascia (Connaught Place, offices)
		m.paint(M.RENDER, M.WALL, Color(0.92, 0.92, 0.92))
		m.reveal(r, 0.18)
		m.paint(M.ATLAS, M.OWN, WHITE)
		m.front(-w, 0.0, w, top, M.SKIN + 0.004, A_GOODS[int(o.get("goods", 0))])
		m.paint(M.GLASS, M.OWN, Color(0.55, 0.62, 0.66))
		m.front(-w, 0.0, w, top, 0.12)
		m.paint(M.IRON, M.OWN, BLACK)
		for x in [-w, -0.4, 0.4, w]:
			m.front(x - 0.03, 0.0, x + 0.03, top, 0.13)
		m.front(-w, top - 0.35, w, top - 0.3, 0.13)
		return
	m.paint(M.RENDER, M.WALL, Color(0.9, 0.9, 0.9))
	m.reveal(r, 0.35)
	m.paint(M.ATLAS, M.OWN, WHITE)
	m.front(-w, 0.0, w, top, M.SKIN + 0.004, A_GOODS[int(o.get("goods", 0)) % 2])
	# the rolled shutter: its drum under the lintel and the part left down
	var down: float = o.get("shutter", 0.2)
	m.paint(M.SHUTTER, M.ACCENT, WHITE)
	m.box(Vector3(-w, top - 0.22, 0.12), Vector3(w, top, 0.34), false, true)
	if down > 0.0:
		m.front(-w + 0.02, top - 0.22 - top * down, w - 0.02, top - 0.22, 0.3)
	# a step and the counter at the front (shop spill)
	m.paint(M.STONE, M.OWN, Color(0.62, 0.6, 0.56))
	m.box(Vector3(-1.5, 0.0, 0.0), Vector3(1.5, 0.18, 0.55), false, false)
	if o.get("spill", false):
		# goods stacked out front: sacks and bundles under a cloth
		m.paint(M.CLOTH, M.ACCENT2, Color(0.8, 0.8, 0.8))
		m.box(Vector3(-w + 0.1, 0.18, 0.4), Vector3(-w + 0.9, 0.95, 0.9), false, false)
		m.paint(M.SHUTTER, M.ACCENT, Color(0.9, 0.9, 0.9))
		m.box(Vector3(w - 0.8, 0.18, 0.45), Vector3(w - 0.15, 0.7, 0.95), false, false)
	if o.get("chhajja", false):
		_chhajja(m, top + 0.05, 0.6)
	if o.get("awning", false):
		m.paint(M.CLOTH, M.ACCENT2, WHITE)
		m.both(Vector3(-1.5, top + 0.15, 0.42), Vector3(1.5, top + 0.15, 0.42), Vector3(1.5, top - 0.3, 1.35), Vector3(-1.5, top - 0.3, 1.35))
	_band(m, M.MODULE_H - 0.1, M.MODULE_H, 0.06)


static func _door(m: M, o: Dictionary) -> void:
	var r := Rect2(-0.6, 0.15, 1.2, 2.3)
	if o.get("portico", false):
		r = Rect2(-0.75, 0.15, 1.5, 2.6)
	m.paint(M.RENDER, M.WALL, WHITE)
	m.skin(0.0, M.MODULE_H, [r])
	if o.get("glass", false):
		_opening(m, r, 0.2, M.GLASS, M.OWN, Color(0.45, 0.52, 0.56))
		m.paint(M.IRON, M.OWN, BLACK)
		m.front(-0.02, r.position.y, 0.02, r.end.y, M.SKIN + 0.02)
	else:
		_opening(m, r, 0.22, M.ATLAS, M.ACCENT, WHITE, A_DOOR)
	if o.get("arch", false):
		# a pointed head over the haveli door, in lime against the wall colour
		m.paint(M.STONE, M.OWN, Color(0.85, 0.8, 0.7))
		m.box(Vector3(r.position.x - 0.15, r.end.y, 0.0), Vector3(r.end.x + 0.15, r.end.y + 0.35, 0.18), false, true)
		m.box(Vector3(r.position.x - 0.18, r.position.y, 0.0), Vector3(r.position.x, r.end.y, 0.18), false, false)
		m.box(Vector3(r.end.x, r.position.y, 0.0), Vector3(r.end.x + 0.18, r.end.y, 0.18), false, false)
	if o.get("canopy", false) or o.get("portico", false):
		m.paint(M.CONCRETE, M.WALL, Color(0.85, 0.85, 0.85))
		m.box(Vector3(-1.1, r.end.y + 0.1, 0.0), Vector3(1.1, r.end.y + 0.25, 1.2), false, true)
		if o.get("portico", false):
			_column(m, -0.95, 1.05, 0.0, r.end.y + 0.1, 0.12)
			_column(m, 0.95, 1.05, 0.0, r.end.y + 0.1, 0.12)
	m.paint(M.STONE, M.OWN, Color(0.6, 0.58, 0.55))
	m.box(Vector3(-0.8, 0.0, 0.0), Vector3(0.8, 0.15, 0.4), false, false)
	_band(m, M.MODULE_H - 0.1, M.MODULE_H, 0.06)


static func _plain(m: M, o: Dictionary) -> void:
	var holes := [Rect2(-0.45, 1.9, 0.9, 0.6)]
	if o.get("band", false):
		holes = [Rect2(-1.35, 1.1, 2.7, 1.3)]
	m.paint(M.RENDER, M.WALL, WHITE)
	m.skin(0.0, M.MODULE_H, holes)
	for h: Rect2 in holes:
		_opening(m, h, 0.1, M.GLASS, M.OWN, DARK_GLASS)
		if not o.get("band", false):
			_grille(m, h, M.SKIN + 0.12, 0.12)
	if o.get("plinth", false) or o.get("band", false):
		m.paint(M.STONE, M.OWN, Color(0.66, 0.64, 0.6) if o.get("band", false) else Color(0.55, 0.53, 0.5))
		m.box(Vector3(-1.5, 0.0, 0.0), Vector3(1.5, 0.6, 0.12), false, false)
	if o.get("cornice", false):
		_band(m, M.MODULE_H - 0.25, M.MODULE_H, 0.18)
	else:
		_band(m, M.MODULE_H - 0.1, M.MODULE_H, 0.06)
	# a drain pipe down the bay edge
	m.paint(M.CONCRETE, M.OWN, Color(0.42, 0.42, 0.4))
	m.box(Vector3(1.32, 0.0, 0.05), Vector3(1.4, M.MODULE_H, 0.13), false, false)


static func _gate(m: M, _o: Dictionary) -> void:
	var r := Rect2(-1.15, 0.0, 2.3, 2.35)
	m.paint(M.RENDER, M.WALL, WHITE)
	m.skin(0.0, M.MODULE_H, [r])
	_opening(m, r, 0.25, M.INTERIOR, M.OWN, Color(0.16, 0.14, 0.12))
	# the gate: painted iron bars, a mid rail and rings (front gates of Delhi houses)
	m.paint(M.IRON, M.ACCENT, WHITE)
	m.box(Vector3(-1.15, 0.0, 0.12), Vector3(-1.08, 2.25, 0.2), false, false)
	m.box(Vector3(1.08, 0.0, 0.12), Vector3(1.15, 2.25, 0.2), false, false)
	m.box(Vector3(-1.15, 2.18, 0.12), Vector3(1.15, 2.25, 0.2), false, true)
	m.box(Vector3(-1.15, 1.1, 0.12), Vector3(1.15, 1.16, 0.2), false, true)
	var x := -1.0
	m.fine = true
	while x < 1.05:
		m.front(x - 0.015, 0.05, x + 0.015, 2.2, 0.2)
		x += 0.13
	m.fine = false
	m.paint(M.RENDER, M.WALL, Color(0.85, 0.85, 0.85))
	m.box(Vector3(-1.5, 0.0, 0.0), Vector3(-1.15, 2.6, 0.3), false, false)
	m.box(Vector3(1.15, 0.0, 0.0), Vector3(1.5, 2.6, 0.3), false, false)
	_band(m, M.MODULE_H - 0.1, M.MODULE_H, 0.06)


static func _colonnade(m: M, o: Dictionary) -> void:
	# Connaught Place: a walk under the upper floor between the shop fronts and a row of Tuscan columns
	var z: float = o.get("z", 2.0)
	var r := Rect2(-1.25, 0.0, 2.5, 2.7)
	m.paint(M.RENDER, M.WALL, WHITE)
	m.skin(0.0, M.MODULE_H, [r] if o.get("shop", true) else [Rect2(-0.65, 0.3, 1.3, 2.2)])
	if o.get("shop", true):
		m.paint(M.ATLAS, M.OWN, WHITE)
		m.front(-1.25, 0.0, 1.25, 2.7, M.SKIN + 0.004, A_GOODS[0])
		m.paint(M.GLASS, M.OWN, Color(0.55, 0.62, 0.66))
		m.front(-1.25, 0.0, 1.25, 2.4, 0.1)
		m.paint(M.IRON, M.OWN, BLACK)
		m.front(-1.25, 2.4, 1.25, 2.45, 0.11)
	else:
		_opening(m, Rect2(-0.65, 0.3, 1.3, 2.2), 0.12, M.GLASS, M.OWN, DARK_GLASS)
		m.paint(M.WOOD, M.ACCENT, WHITE)
		m.front(-1.2, 0.3, -0.68, 2.5, M.SKIN + 0.03)
		m.front(0.68, 0.3, 1.2, 2.5, M.SKIN + 0.03)
	_column(m, -1.5, z, 0.0, 3.0, 0.24)
	# the beam over the columns and the ceiling of the walk
	m.paint(M.RENDER, M.WALL, Color(0.95, 0.95, 0.95))
	m.box(Vector3(-1.5, 3.0, z - 0.3), Vector3(1.5, M.MODULE_H, z + 0.3), false, true)
	m.paint(M.RENDER, M.WALL, Color(0.8, 0.8, 0.8))
	m.box(Vector3(-1.5, 3.05, 0.0), Vector3(1.5, 3.15, z - 0.3), false, true)
	# the floor of the walk: cream stone
	m.paint(M.STONE, M.OWN, Color(0.93, 0.9, 0.84))
	m.box(Vector3(-1.5, 0.0, 0.0), Vector3(1.5, 0.12, z + 0.35), false, false)


static func _arch_fill(m: M, x0: float, x1: float, spring: float, top: float, z: float) -> void:
	var n := 8
	var cx := (x0 + x1) * 0.5
	var rx := (x1 - x0) * 0.5
	var ry := minf(rx, top - spring)
	for i in n:
		var a0 := PI * float(i) / n
		var a1 := PI * float(i + 1) / n
		var p0 := Vector2(cx - cos(a0) * rx, spring + sin(a0) * ry)
		var p1 := Vector2(cx - cos(a1) * rx, spring + sin(a1) * ry)
		m.quad(Vector3(p0.x, p0.y, z), Vector3(p1.x, p1.y, z), Vector3(p1.x, top, z), Vector3(p0.x, top, z))


static func _arcade(m: M, _o: Dictionary) -> void:
	var r := Rect2(-1.05, 0.0, 2.1, 2.9)
	m.paint(M.RENDER, M.WALL, WHITE)
	m.skin(0.0, M.MODULE_H, [r])
	m.paint(M.INTERIOR, M.OWN, Color(0.3, 0.27, 0.24))
	m.front(-1.05, 0.0, 1.05, 2.9, M.SKIN + 0.002)
	m.paint(M.ATLAS, M.OWN, WHITE)
	m.front(-0.8, 0.0, 0.8, 2.1, M.SKIN + 0.006, A_GOODS[0])
	m.paint(M.RENDER, M.WALL, WHITE)
	_arch_fill(m, -1.05, 1.05, 1.95, 2.9, M.SKIN + 0.01)
	m.paint(M.RENDER, M.WALL, Color(0.94, 0.94, 0.94))
	m.box(Vector3(-1.5, 0.0, 0.0), Vector3(-1.05, 2.9, 0.3), false, false)
	m.box(Vector3(1.05, 0.0, 0.0), Vector3(1.5, 2.9, 0.3), false, false)
	_band(m, 2.9, M.MODULE_H, 0.3)


# ------------------------------------------------------------------ upper floors


static func _window(m: M, o: Dictionary) -> void:
	var tall: bool = o.get("tall", false)
	var r := Rect2(-0.6, 0.8, 1.2, 1.6) if not tall else Rect2(-0.6, 0.35, 1.2, 2.35)
	m.paint(M.RENDER, M.WALL, WHITE)
	m.skin(0.0, M.MODULE_H, [r])
	_opening(m, r, 0.12, M.GLASS, M.OWN, DARK_GLASS)
	# frame: a mullion and a transom
	m.paint(M.WOOD, M.ACCENT, WHITE)
	m.front(-0.03, r.position.y, 0.03, r.end.y, M.SKIN + 0.01)
	m.front(r.position.x, r.end.y - 0.5, r.end.x, r.end.y - 0.45, M.SKIN + 0.01)
	if o.get("arch", false):
		m.paint(M.RENDER, M.WALL, Color(0.88, 0.88, 0.88))
		_arch_fill(m, r.position.x, r.end.x, r.end.y - 0.45, r.end.y, M.SKIN + 0.02)
	# sill
	m.paint(M.STONE, M.OWN, Color(0.7, 0.68, 0.64))
	m.box(Vector3(r.position.x - 0.12, r.position.y - 0.08, 0.0), Vector3(r.end.x + 0.12, r.position.y, 0.2), false, true)
	if o.get("shutters", false):
		m.paint(M.WOOD, M.ACCENT, WHITE)
		m.front(r.position.x - 0.62, r.position.y, r.position.x - 0.04, r.end.y, M.SKIN + 0.03)
		m.front(r.end.x + 0.04, r.position.y, r.end.x + 0.62, r.end.y, M.SKIN + 0.03)
	if o.get("grille", false):
		_grille(m, r, M.SKIN + 0.16)
		m.paint(M.IRON, M.ACCENT, WHITE)
		m.box(Vector3(r.position.x, r.position.y, M.SKIN), Vector3(r.end.x, r.position.y + 0.03, M.SKIN + 0.17), false, false)
	if o.get("chhajja", false):
		_chhajja(m, r.end.y + 0.12, 0.5)
	if o.get("fins", false):
		m.paint(M.CONCRETE, M.WALL, Color(0.85, 0.85, 0.85))
		m.box(Vector3(-1.5, r.end.y + 0.1, 0.0), Vector3(1.5, r.end.y + 0.2, 0.55), false, true)
		m.box(Vector3(-0.85, r.position.y, 0.0), Vector3(-0.75, r.end.y + 0.1, 0.45), false, true)
		m.box(Vector3(0.75, r.position.y, 0.0), Vector3(0.85, r.end.y + 0.1, 0.45), false, true)
	if o.get("cornice", false):
		_band(m, M.MODULE_H - 0.22, M.MODULE_H, 0.16)
	else:
		_band(m, M.MODULE_H - 0.1, M.MODULE_H, 0.05)


static func _balcony(m: M, o: Dictionary) -> void:
	var door := Rect2(-0.55, 0.12, 1.1, 2.25)
	m.paint(M.RENDER, M.WALL, WHITE)
	m.skin(0.0, M.MODULE_H, [door])
	_opening(m, door, 0.08, M.WOOD, M.ACCENT, WHITE)
	m.paint(M.GLASS, M.OWN, DARK_GLASS)
	m.front(-0.45, 1.2, 0.45, 2.2, M.SKIN + 0.09)
	var d := 0.95
	# the slab, cantilevered out of the floor
	m.paint(M.CONCRETE, M.WALL, Color(0.86, 0.86, 0.86))
	m.box(Vector3(-1.45, 0.0, 0.0), Vector3(1.45, 0.12, d), false, true)
	if o.get("solid", false):
		m.paint(M.RENDER, M.WALL, Color(0.93, 0.93, 0.93))
		m.box(Vector3(-1.45, 0.12, d - 0.12), Vector3(1.45, 1.0, d), false, false)
		m.box(Vector3(-1.45, 0.12, 0.0), Vector3(-1.33, 1.0, d - 0.12), false, false)
		m.box(Vector3(1.33, 0.12, 0.0), Vector3(1.45, 1.0, d - 0.12), false, false)
	else:
		_railing(m, -1.45, 1.45, 0.12, 0.95, d - 0.02)
		_side_railing(m, -1.44, 0.05, d, 0.12, 0.95, -1.0)
		_side_railing(m, 1.44, 0.05, d, 0.12, 0.95, 1.0)
		if o.get("cage", false):
			# a full-height grille cage (lodges and flats keep pigeons and thieves out)
			m.paint(M.IRON, M.ACCENT, WHITE)
			var x := -1.4
			m.fine = true
			while x < 1.45:
				m.front(x - 0.01, 1.07, x + 0.01, 2.7, d - 0.02)
				x += 0.15
			m.fine = false
			m.bar(Vector3(-1.45, 2.7, d - 0.02), Vector3(1.45, 2.7, d - 0.02), 0.04)
	_chhajja(m, 2.75, d + 0.1)


static func _jharokha(m: M, _o: Dictionary) -> void:
	m.paint(M.RENDER, M.WALL, WHITE)
	m.skin(0.0, M.MODULE_H, [])
	var d := 0.7
	# a closed balcony on stone brackets, three small openings and a curved hood (the haveli jharokha)
	m.paint(M.STONE, M.OWN, Color(0.82, 0.76, 0.66))
	for x in [-0.95, 0.0, 0.95]:
		m.box(Vector3(x - 0.08, 0.15, 0.0), Vector3(x + 0.08, 0.55, d * 0.8), false, true)
	m.paint(M.RENDER, M.WALL, Color(0.95, 0.95, 0.95))
	m.box(Vector3(-1.2, 0.55, 0.0), Vector3(1.2, 2.55, d), false, true)
	for x in [-0.75, 0.0, 0.75]:
		m.paint(M.GLASS, M.OWN, DARK_GLASS)
		m.front(x - 0.25, 1.15, x + 0.25, 2.2, d + 0.005)
		m.paint(M.ATLAS, M.OWN, WHITE)
		m.front(x - 0.25, 0.7, x + 0.25, 1.1, d + 0.005, A_JALI)
		m.paint(M.WOOD, M.ACCENT, WHITE)
		m.front(x - 0.02, 1.15, x + 0.02, 2.2, d + 0.01)
	m.paint(M.STONE, M.OWN, Color(0.85, 0.79, 0.69))
	m.box(Vector3(-1.4, 2.55, -0.0), Vector3(1.4, 2.7, d + 0.25), false, true)
	m.box(Vector3(-1.2, 2.7, 0.0), Vector3(1.2, 2.85, d + 0.05), false, false)
	_band(m, M.MODULE_H - 0.1, M.MODULE_H, 0.05)


static func _blank(m: M, o: Dictionary) -> void:
	m.paint(M.CONCRETE if o.get("concrete", false) else M.RENDER, M.WALL, WHITE)
	m.skin(0.0, M.MODULE_H, [Rect2(-0.25, 2.15, 0.5, 0.4)])
	_opening(m, Rect2(-0.25, 2.15, 0.5, 0.4), 0.06, M.INTERIOR, M.OWN, Color(0.15, 0.14, 0.13))
	if o.get("pipe", false):
		m.paint(M.CONCRETE, M.OWN, Color(0.4, 0.4, 0.38))
		m.box(Vector3(1.1, 0.0, 0.05), Vector3(1.18, M.MODULE_H, 0.13), false, false)
	if o.get("wires", false):
		# a bunch of cables along the bay (old city facades carry their wiring outside)
		m.paint(M.IRON, M.OWN, BLACK)
		m.box(Vector3(-1.5, 2.85, 0.1), Vector3(1.5, 2.88, 0.14), false, true)
		m.box(Vector3(-1.5, 2.92, 0.16), Vector3(1.5, 2.94, 0.19), false, true)
	if o.get("cornice", false):
		_band(m, M.MODULE_H - 0.22, M.MODULE_H, 0.16)
	else:
		_band(m, M.MODULE_H - 0.1, M.MODULE_H, 0.05)


static func _strip(m: M, _o: Dictionary) -> void:
	var r := Rect2(-1.5, 0.9, 3.0, 1.55)
	m.paint(M.CONCRETE, M.WALL, WHITE)
	m.skin(0.0, M.MODULE_H, [r])
	m.paint(M.GLASS, M.OWN, Color(0.3, 0.36, 0.4))
	m.front(-1.5, 0.9, 1.5, 2.45, M.SKIN + 0.002)
	m.paint(M.IRON, M.OWN, Color(0.3, 0.3, 0.32))
	for x in [-1.5, -0.5, 0.5]:
		m.box(Vector3(x - 0.03, 0.9, M.SKIN), Vector3(x + 0.03, 2.45, M.SKIN + 0.08), false, false)
	m.paint(M.CONCRETE, M.WALL, Color(0.88, 0.88, 0.88))
	m.box(Vector3(-1.5, 2.45, 0.0), Vector3(1.5, 2.6, 0.6), false, true)


static func _glass(m: M, _o: Dictionary) -> void:
	m.paint(M.GLASS, M.OWN, Color(0.36, 0.44, 0.5))
	m.front(-1.5, 0.0, 1.5, M.MODULE_H, M.SKIN)
	m.paint(M.IRON, M.OWN, Color(0.55, 0.57, 0.6))
	for x in [-1.5, 0.0]:
		m.box(Vector3(x - 0.03, 0.0, M.SKIN), Vector3(x + 0.03, M.MODULE_H, M.SKIN + 0.07), false, false)
	m.box(Vector3(-1.5, 0.0, M.SKIN), Vector3(1.5, 0.35, M.SKIN + 0.04), false, true)


static func _parapet(m: M, o: Dictionary) -> void:
	var h := M.PARAPET_H
	if o.get("balustrade", false):
		# a balustrade between plinth and coping (Connaught Place, Lutyens)
		m.paint(M.RENDER, M.WALL, WHITE)
		m.box(Vector3(-1.5, 0.0, 0.0), Vector3(1.5, 0.25, 0.22), true, false)
		m.box(Vector3(-1.5, 0.25, 0.0), Vector3(-1.32, h, 0.22), true, false)
		m.paint(M.INTERIOR, M.OWN, Color(0.35, 0.36, 0.38))
		m.front(-1.32, 0.25, 1.5, h - 0.1, 0.02)
		m.paint(M.RENDER, M.WALL, Color(0.96, 0.96, 0.96))
		var x := -1.15
		while x < 1.45:
			m.box(Vector3(x - 0.06, 0.25, 0.04), Vector3(x + 0.06, h - 0.1, 0.18), false, false)
			x += 0.3
	elif o.get("jali", false):
		m.paint(M.RENDER, M.WALL, WHITE)
		m.skin(0.0, h, [Rect2(-1.2, 0.25, 2.4, 0.55)])
		m.paint(M.ATLAS, M.WALL, WHITE)
		m.front(-1.2, 0.25, 1.2, 0.8, M.SKIN + 0.004, A_JALI)
	else:
		m.paint(M.CONCRETE if o.get("concrete", false) else M.RENDER, M.WALL, WHITE)
		m.skin(0.0, h, [])
	m.paint(M.CONCRETE, M.OWN, COPING)
	m.box(Vector3(-1.5, h - 0.1, -0.08), Vector3(1.5, h, 0.28), false, true)
