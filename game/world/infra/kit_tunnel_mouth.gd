## The mouths of the tunnel and underpass kits (P2-032, game/world/infra/kit_tunnel.gd): the headwall across every
## mouth with its lip, name band and floodlights, the name label's place, and the drain gratings. Kit inputs are world
## metres. Pure.
extends RefCounted

const KitMesh := preload("res://world/landmarks/kit_mesh.gd")
const K := preload("res://world/infra/infra_kit.gd")
const T := preload("res://world/infra/kit_tunnel.gd")


## A headwall (theads): the face across the mouth from the ceiling up, a protruding lip, the name band, lights at the
## mouth, and the cap and back over the ground. The name itself is a label the system adds (infra.gd).
static func head(base: KitMesh, near: KitMesh, h: Dictionary) -> void:
	var f: Dictionary = T.finish(str(h.v))
	var a := Vector3(float(h.a[0]), float(h.y0), float(h.a[1]))
	var b := Vector3(float(h.b[0]), float(h.y0), float(h.b[1]))
	var nrm := Vector3(float(h.n[0]), 0.0, float(h.n[1]))
	var y1 := float(h.y1)
	var top := Vector3(0, y1 - float(h.y0), 0)
	var d := (b - a)
	var along := Vector3(d.x, 0, d.z).normalized()
	base.use("main", "matte")
	K.oquad(base, a, b, b + top, a + top, nrm, f.wall)
	var road := int(h.get("road", 0)) == 1
	if not road:
		K.oquad(base, a + top, b + top, b + top - nrm * 0.25, a + top - nrm * 0.25, Vector3.UP, T.PALE)
	# the lip: a frame band over the opening, 0.35 m proud of the face, and the name band on it
	var lip := minf(1.4, y1 - float(h.y0) - 0.05)
	if lip > 0.2:
		var o := nrm * 0.35
		var ext := along * 0.3
		K.oquad(base, a - ext + o, b + ext + o, b + ext + o + Vector3(0, lip, 0), a - ext + o + Vector3(0, lip, 0), nrm, T.PALE)
		K.oquad(base, a - ext, b + ext, b + ext + o, a - ext + o, Vector3.DOWN, T.PALE)
		K.oquad(base, a - ext + Vector3(0, lip, 0), b + ext + Vector3(0, lip, 0), b + ext + o + Vector3(0, lip, 0), a - ext + o + Vector3(0, lip, 0), Vector3.UP, T.PALE)
		var band: Color = T.TEAL if str(h.v) == "TUN-T1" else (T.NAVY if str(h.v) == "TUN-T2" else (T.YELLOW if str(h.v) == "TUN-T3" else T.GREY_DARK))
		base.use("main", "paint")
		var bo := o + nrm * 0.02
		K.oquad(base, a + bo + Vector3(0, lip * 0.18, 0), b + bo + Vector3(0, lip * 0.18, 0), b + bo + Vector3(0, lip * 0.82, 0), a + bo + Vector3(0, lip * 0.82, 0), nrm, band)
		if str(h.v) == "TUN-T1":
			# the knot panel colours at the mouth: a pink and green border over the teal band
			K.oquad(base, a + bo + Vector3(0, lip * 0.82, 0), b + bo + Vector3(0, lip * 0.82, 0), b + bo + Vector3(0, lip * 0.92, 0), a + bo + Vector3(0, lip * 0.92, 0), nrm, T.PINK)
			K.oquad(base, a + bo + Vector3(0, lip * 0.08, 0), b + bo + Vector3(0, lip * 0.08, 0), b + bo + Vector3(0, lip * 0.18, 0), a + bo + Vector3(0, lip * 0.18, 0), nrm, T.LEAF)
		# floodlights under the lip, facing down the ramp, every 3 m
		base.use("main", "glow")
		var w := d.length()
		var k := maxi(2, int(w / 3.0))
		for i in k:
			var p := a.lerp(b, (i + 0.5) / k) + o * 0.6 - Vector3(0, 0.12, 0)
			K.post(base, p, Vector3(0.6, 0.1, 0.3), Vector2(along.x, along.z), f.lamp)
		base.use("main", "matte")
	# the back of the headwall over the slab, under the ground
	if not road:
		K.oquad(base, a + top - nrm * 0.25, b + top - nrm * 0.25, b - nrm * 0.25 + Vector3(0, 0.4, 0), a - nrm * 0.25 + Vector3(0, 0.4, 0), -nrm, f.wall)


## Where a headwall's name label goes: {text, xf} (a Label3D on the lip, facing out of the mouth), or {} when none.
static func head_label(h: Dictionary) -> Dictionary:
	var name := str(h.get("name", ""))
	if name == "":
		return {}
	var a := Vector3(float(h.a[0]), float(h.y0), float(h.a[1]))
	var b := Vector3(float(h.b[0]), float(h.y0), float(h.b[1]))
	var nrm := Vector3(float(h.n[0]), 0.0, float(h.n[1]))
	var lip := minf(1.4, float(h.y1) - float(h.y0) - 0.05)
	if lip < 0.5:
		return {}
	var c := (a + b) * 0.5 + nrm * 0.4 + Vector3(0, lip * 0.5, 0)
	# the label reads from its +Z side: turn +Z onto the mouth's outward normal (the side a driver comes from)
	var basis := Basis(Vector3.UP, atan2(nrm.x, nrm.z) + PI)
	return {"text": name.to_upper(), "xf": Transform3D(basis, c), "size": lip * 0.6}


## A drain grating across the carriageway (tdrains): a dark frame and bars, flush with the road, 1.2 cm over it under
## a roof (over the tunnel's road finish).
static func drain(base: KitMesh, d: Dictionary, roofed := false) -> void:
	var a := Vector3(float(d.a[0]), float(d.a[1]), float(d.a[2]))
	var b := Vector3(float(d.b[0]), float(d.b[1]), float(d.b[2]))
	var across := Vector3(b.x - a.x, 0, b.z - a.z)
	var w := across.length()
	if w < 0.5:
		return
	across /= w
	var t := Vector3(-across.z, 0, across.x) * 0.3
	# (under a roof: lit by the tunnel's strips, not by the sky)
	base.use("main", "tunnel_lit" if roofed else "metal")
	if roofed:
		a.y += 0.012
		b.y += 0.012
	K.oquad(base, a - t, b - t, b + t, a + t, Vector3.UP, Color("#2a2a2c"))
	var k := int(w / 0.25)
	for i in k:
		var p := a.lerp(b, (i + 0.5) / k) + Vector3(0, 0.004, 0)
		K.oquad(base, p - t * 0.9 - across * 0.03, p + t * 0.9 - across * 0.03, p + t * 0.9 + across * 0.03, p - t * 0.9 + across * 0.03, Vector3.UP, T.GALV)
	base.use("main", "matte")
