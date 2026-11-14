## The fittings of a roofed tunnel at their real size (P2-032 attempt 2, owner feedback 2026-11-14, tunnels.md):
## jet fans flush under the soffit in pairs, variable message signs flush under it, fire point cabinets set into the
## wall. All in tunnel_lit (shaded by the strip lines), the sign's text in glow. Kit inputs are world metres. Pure.
extends RefCounted

const KitMesh := preload("res://world/landmarks/kit_mesh.gd")
const K := preload("res://world/infra/infra_kit.gd")

const FAN_R := 0.5
const FAN_HALF := 0.95
## The gap between a fan's top and the soffit (its brackets).
const FAN_GAP := 0.12
const BODY := Color("#b9bcbf")
const SILENCER := Color("#a3a7ab")
const SEAM := Color("#5b5f63")
const RIM := Color("#7b7f84")
const DUCT := Color("#1f2124")
const HUB := Color("#8b8f94")
const BRACKET := Color("#6f7378")
const CAB_RED := Color("#b3242a")
const DOOR_RED := Color("#cf3a35")
const SIGN_WHITE := Color("#eeeee8")
const SIGN_TEXT := Color("#ffb000")
const SIGN_FACE := Color("#16171a")
const SIGN_FRAME := Color("#4b4e52")


## A jet fan hung flush under the soffit at `top` (a point on the soffit), its axis along `d` (plan, unit): a 1 m
## drum 1.9 m long with silencer sections, rims, the dark duct and hub at both ends, a guard and two brackets.
static func jet_fan(m: KitMesh, top: Vector3, d: Vector3) -> void:
	var c := top + Vector3(0, -(FAN_R + FAN_GAP), 0)
	var y := d.normalized()
	var x := y.cross(Vector3.UP).normalized()
	var z := x.cross(y)
	var h := FAN_HALF
	var r := FAN_R
	# the profile (radius, metres along the axis), front to back; a point given twice is a colour crease
	var prof := PackedVector2Array()
	var cols := PackedColorArray()
	var front := [[0.0, -h - 0.03, HUB], [0.13, -h + 0.02, HUB], [0.13, -h + 0.09, HUB], [0.13, -h + 0.09, DUCT], [r - 0.04, -h + 0.09, DUCT],
		[r - 0.04, -h + 0.09, RIM], [r - 0.04, -h - 0.02, RIM], [r + 0.03, -h - 0.02, RIM], [r + 0.03, -h + 0.05, RIM], [r + 0.03, -h + 0.05, SILENCER],
		[r + 0.03, -0.62, SILENCER], [r + 0.03, -0.62, SEAM], [r, -0.6, SEAM], [r, -0.6, BODY]]
	for e: Array in front:
		prof.append(Vector2(float(e[0]), float(e[1])))
		cols.append(e[2])
	for k in range(front.size() - 1, -1, -1):
		var e: Array = front[k]
		prof.append(Vector2(float(e[0]), -float(e[1])))
		cols.append(e[2])
	m.use("main", "tunnel_lit")
	m.push(Transform3D(Basis(x, y, z), c))
	m.lathe(prof, 16, Vector3.ZERO, BODY, cols)
	m.pop()
	# the guard over each end: two bars across and one up
	for sg in [-1.0, 1.0]:
		var face: Vector3 = c + y * (sg * (h + 0.04))
		K.beam_box(m, face - x * (r - 0.02) + Vector3(0, 0.18, 0), face + x * (r - 0.02) + Vector3(0, 0.18, 0), 0.03, 0.03, SEAM, true)
		K.beam_box(m, face - x * (r - 0.02) - Vector3(0, 0.2, 0), face + x * (r - 0.02) - Vector3(0, 0.2, 0), 0.03, 0.03, SEAM, true)
		K.post(m, face - Vector3(0, r - 0.03, 0), Vector3(0.03, 2.0 * r - 0.06, 0.03), Vector2(y.x, y.z), SEAM)
	# the brackets to the soffit
	for sg in [-0.55, 0.55]:
		K.post(m, c + y * sg + Vector3(0, r - 0.08, 0), Vector3(0.62, FAN_GAP + 0.1, 0.08), Vector2(y.x, y.z), BRACKET)
	m.use("main", "matte")


## A variable message sign flush under the soffit at `top`, facing both ways along `d`: a grey framed black panel
## w wide and 0.7 m tall on two hangers, two amber lines of text on each face; its underside about 1 m under the soffit.
static func message_sign(m: KitMesh, top: Vector3, d: Vector3, w: float) -> void:
	var along := Vector2(d.x, d.z)
	var across := Vector3(-d.z, 0, d.x)
	var c := top + Vector3(0, -0.98, 0)
	m.use("main", "tunnel_lit")
	K.post(m, c, Vector3(w + 0.12, 0.78, 0.34), along, SIGN_FRAME)
	for sg in [-1.0, 1.0]:
		K.post(m, c + Vector3(0, 0.05, 0) + d * (sg * 0.172), Vector3(w - 0.08, 0.66, 0.01), along, SIGN_FACE)
	for sg in [-0.35, 0.35]:
		K.post(m, c + across * (w * sg) + Vector3(0, 0.78, 0), Vector3(0.06, 0.2, 0.06), along, SIGN_FRAME)
	m.use("main", "tunnel_glow")
	for sg in [-1.0, 1.0]:
		for row in 2:
			K.post(m, c + Vector3(0, 0.18 + row * 0.26, 0) + d * (sg * 0.18), Vector3(w * (0.7 - 0.2 * row), 0.11, 0.01), along, Color(SIGN_TEXT, 0.45))
	m.use("main", "matte")


## A fire point cabinet set into a roofed wall at the wall's foot `foot` (on the walkway or kerb top), facing `inw`:
## a red cabinet 0.6 m wide and 0.8 m tall standing 6 cm proud of the wall, a lighter door with its handle and a white
## sign over it with a red mark, the cabinet's bottom 0.85 m over the foot.
static func fire_point(m: KitMesh, foot: Vector3, inw: Vector3, d: Vector3) -> void:
	var along := Vector2(d.x, d.z)
	var base := foot + Vector3(0, 0.85, 0)
	m.use("main", "tunnel_lit")
	K.post(m, base + inw * 0.03, Vector3(0.06, 0.8, 0.6), along, CAB_RED)
	K.post(m, base + inw * 0.065 + Vector3(0, 0.04, 0), Vector3(0.012, 0.72, 0.52), along, DOOR_RED)
	K.post(m, base + inw * 0.075 + Vector3(0, 0.36, 0) + d * 0.2, Vector3(0.025, 0.1, 0.03), along, SEAM)
	var sign := base + Vector3(0, 0.92, 0) + inw * 0.012
	K.post(m, sign, Vector3(0.025, 0.18, 0.5), along, SIGN_WHITE)
	K.post(m, sign + inw * 0.014 + Vector3(0, 0.04, 0) - d * 0.16, Vector3(0.006, 0.1, 0.1), along, CAB_RED)
	K.post(m, sign + inw * 0.014 + Vector3(0, 0.07, 0) + d * 0.06, Vector3(0.006, 0.04, 0.28), along, CAB_RED)
	m.use("main", "matte")
