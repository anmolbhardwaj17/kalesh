## The Red Fort (hero, P2-007): the red sandstone rampart on the map's wall line (open where a road passes), 18 m on
## the river side to 33 m on the city side (en.wikipedia 'Red Fort', registry edit lm_0003), with its batter, a
## soot-darkened foot, a string course, a row of blind arches under the parapet, merlons (kanguras), round bastions
## along it (a chhatri on the corner ones), and the gates the map draws (the Lahori Gate on Netaji Subhash Marg, the
## Delhi Gate): an iwan with a pointed arch between two octagonal towers crowned with chhatris, the gallery of small
## white domed chhatris between them, two slender pinnacles and the national flag (the area sheet
## harness/design/areas/red_fort_surroundings.md, board photos 1, 5, 9, 13, 14, 16). The fort's own buildings stay in
## the tile massing (they are behind the walls). Parts: the wall in six stretches of about the same length, one per gate with the buildings round it (8 at most).
extends RefCounted

const KitMesh := preload("res://world/landmarks/kit_mesh.gd")
const Parts := preload("res://world/landmarks/parts.gd")

const SECTORS := 6
## Wall thickness at the foot and at the top (m): the outer face leans back (the batter), the inner face is upright.
const OUT_FOOT := 4.0
const OUT_TOP := 2.0
const IN_FACE := 2.2
## A bastion every this many metres of wall, and at every turn sharper than CORNER_DEG.
const BASTION_EVERY_M := 95.0
const CORNER_DEG := 25.0


static func build(m: KitMesh, kit: Dictionary, lm: Dictionary, lod: int) -> Dictionary:
	var gates := _gates(kit)
	var city_h := 0.0
	# the wall goes into SECTORS parts of about the same length (the parts stay under the hero rule's 25,000 triangles)
	var total := 0.0
	for run: Dictionary in kit.get("walls", []):
		total += _length(run)
	var walked := {"m": 0.0, "total": maxf(1.0, total)}
	for run: Dictionary in kit.get("walls", []):
		_run(m, run, gates, lod, walked)
		for h in run.h:
			city_h = maxf(city_h, float(h))
	for k in gates.size():
		m.use("gate%d" % k)
		_gate(m, gates[k], lod)
	# the fort's own buildings round its gates and outside its wall go into the lightest part so far (each part stays
	# under the hero rule's 25,000 triangles)
	var names: Array = m.part_names()
	for b: Dictionary in kit.get("blocks", []):
		var best := ""
		for n: String in names:
			if best == "" or m.count(n) < m.count(best):
				best = n
		m.use(best if best != "" else "blocks")
		_block(m, b, lod)
	return {"heightM": city_h, "heightPart": "the crest of the city side wall (merlons excluded)"}


## The gates: centre on the wall line, the wall's direction and outward normal there, its ground and wall height.
static func _gates(kit: Dictionary) -> Array:
	var out := []
	for g: Dictionary in kit.get("gates", []):
		var ring: Array = g.ring
		var cx := 0.0
		var cz := 0.0
		for q: Array in ring:
			cx += float(q[0])
			cz += float(q[1])
		var gc := Vector2(cx, cz) / maxf(1.0, ring.size())
		var best := INF
		var hit := {}
		for run: Dictionary in kit.get("walls", []):
			var pts: Array = run.pts
			for i in pts.size() - 1:
				var a := Vector2(float(pts[i][0]), float(pts[i][2]))
				var b := Vector2(float(pts[i + 1][0]), float(pts[i + 1][2]))
				var q := Geometry2D.get_closest_point_to_segment(gc, a, b)
				var d := q.distance_to(gc)
				if d < best:
					best = d
					hit = {"at": q, "dir": (b - a).normalized(), "h": float(run.h[i]), "y": float(pts[i][1])}
		if hit.is_empty() or best > 40.0:
			continue
		var dir: Vector2 = hit.dir
		var n := Vector2(dir.y, -dir.x)
		var at: Vector2 = hit.at
		if n.dot(at) < 0.0:
			n = -n
		var big := str(g.get("name", "")).contains("Lahori")
		var s := 1.0 if big else 0.85
		out.append({"at": at, "dir": dir, "out": n, "h": hit.h, "y": float(g.get("base", hit.y)), "scale": s, "half": 17.0 * s + 2.0, "name": str(g.get("name", ""))})
	return out


static func _near_gate(p: Vector2, gates: Array) -> bool:
	for g: Dictionary in gates:
		if p.distance_to(g.at) < float(g.half):
			return true
	return false


## One wall run: pieces from point to point, bastions at turns and along straight stretches.
static func _length(run: Dictionary) -> float:
	var pts: Array = run.pts
	var d := 0.0
	for i in pts.size() - 1:
		d += Vector2(float(pts[i][0]), float(pts[i][2])).distance_to(Vector2(float(pts[i + 1][0]), float(pts[i + 1][2])))
	return d


static func _run(m: KitMesh, run: Dictionary, gates: Array, lod: int, walked: Dictionary) -> void:
	var pts: Array = run.pts
	var hs: Array = run.h
	if lod >= 3:
		# the far silhouette: every third point of the line (60 m pieces), no bastions
		var p2 := []
		var h2 := []
		for k in pts.size():
			if k % 3 == 0 or k == pts.size() - 1:
				p2.append(pts[k])
				h2.append(hs[k])
		pts = p2
		hs = h2
	var n := pts.size()
	var since := BASTION_EVERY_M * 0.5
	for i in n - 1:
		var a3 := Vector3(float(pts[i][0]), float(pts[i][1]), float(pts[i][2]))
		var b3 := Vector3(float(pts[i + 1][0]), float(pts[i + 1][1]), float(pts[i + 1][2]))
		var a := Vector2(a3.x, a3.z)
		var b := Vector2(b3.x, b3.z)
		var mid := (a + b) * 0.5
		walked.m += a.distance_to(b)
		if _near_gate(mid, gates):
			since = 0.0
			continue
		m.use("wall%d" % mini(SECTORS - 1, int(floor(float(walked.m) / float(walked.total) * SECTORS))))
		var dir := (b - a).normalized()
		var out := Vector2(dir.y, -dir.x)
		if out.dot(mid) < 0.0:
			out = -out
		var first := i == 0 or _near_gate((Vector2(float(pts[i - 1][0]), float(pts[i - 1][2])) + a) * 0.5, gates)
		var last := i == n - 2 or _near_gate((Vector2(float(pts[i + 2][0]), float(pts[i + 2][2])) + b) * 0.5, gates)
		_piece(m, a3, b3, float(hs[i]), float(hs[i + 1]), out, first, last, lod)
		since += a.distance_to(b)
		# a bastion at a corner (the turn to the next piece) or after a long straight stretch
		if i < n - 2:
			var c := Vector2(float(pts[i + 2][0]), float(pts[i + 2][2]))
			var turn := rad_to_deg(absf(dir.angle_to((c - b).normalized())))
			if turn > CORNER_DEG or since >= BASTION_EVERY_M:
				if not _near_gate(b, gates):
					var o2 := (out + Vector2((c - b).normalized().y, -(c - b).normalized().x) * signf(out.dot(Vector2(dir.y, -dir.x)))).normalized()
					_bastion(m, Vector3(b.x, b3.y, b.y), float(hs[i + 1]), o2 if o2.length() > 0.1 else out, turn > CORNER_DEG, lod)
				since = 0.0


## One piece of rampart from a to b (ground points) with heights ha, hb above the ground there.
static func _piece(m: KitMesh, a: Vector3, b: Vector3, ha: float, hb: float, out2: Vector2, first: bool, last: bool, lod: int) -> void:
	var o := Vector3(out2.x, 0, out2.y)
	var sink := 0.6
	var fa := a.y - sink
	var fb := b.y - sink
	var ta := a.y + ha
	var tb := b.y + hb
	var dark := Parts.RED_DARK
	var red := Parts.RED
	# the outer face: the soot-darkened foot, then the face leaning back to the top
	var foot := 4.0 if lod <= 1 else 0.0
	var oa0 := a + o * OUT_FOOT
	var ob0 := b + o * OUT_FOOT
	var lean := func(p: Vector3, h: float, t: float) -> Vector3:
		return p + o * (OUT_FOOT + (OUT_TOP - OUT_FOOT) * t / maxf(1.0, h))
	var oa1: Vector3 = lean.call(a, ha, foot)
	var ob1: Vector3 = lean.call(b, hb, foot)
	var oat: Vector3 = lean.call(a, ha, ha)
	var obt: Vector3 = lean.call(b, hb, hb)
	var lower := dark if foot > 0.0 else red
	_wall_quad(m, Vector3(oa0.x, fa, oa0.z), Vector3(ob0.x, fb, ob0.z), Vector3(ob1.x, b.y + foot, ob1.z), Vector3(oa1.x, a.y + foot, oa1.z), o, lower)
	if foot > 0.0:
		_wall_quad(m, Vector3(oa1.x, a.y + foot, oa1.z), Vector3(ob1.x, b.y + foot, ob1.z), Vector3(obt.x, tb, obt.z), Vector3(oat.x, ta, oat.z), o, red)
	# inner face, top walk, the ends where the run stops at a road
	var ia := a - o * IN_FACE
	var ib := b - o * IN_FACE
	var top_a := Vector3(oat.x, ta, oat.z)
	var top_b := Vector3(obt.x, tb, obt.z)
	var in_ta := Vector3(ia.x, ta, ia.z)
	var in_tb := Vector3(ib.x, tb, ib.z)
	_wall_quad(m, Vector3(ia.x, fa, ia.z), Vector3(ib.x, fb, ib.z), in_tb, in_ta, -o, Parts.RED_LIGHT.darkened(0.08))
	_wall_quad(m, in_ta, in_tb, top_b, top_a, Vector3.UP, Parts.RED_LIGHT.darkened(0.12))
	var along := (b - a).normalized()
	if first:
		_wall_quad(m, Vector3(ia.x, fa, ia.z), Vector3(oa0.x, fa, oa0.z), top_a, in_ta, -along, red)
	if last:
		_wall_quad(m, Vector3(ob0.x, fb, ob0.z), Vector3(ib.x, fb, ib.z), in_tb, top_b, along, red)
	if m.collide:
		var len := Vector2(b.x - a.x, b.z - a.z).length()
		var c := (a + b) * 0.5
		var h := maxf(ha, hb)
		var yaw := atan2(-(b.z - a.z), b.x - a.x)
		m.solid(Vector3(c.x, minf(fa, fb) + (h + sink) * 0.5, c.z) + o * ((OUT_FOOT - IN_FACE) * 0.25), Vector3(len + 1.0, h + sink, (OUT_FOOT + IN_FACE) * 0.85), yaw)
	if lod >= 3:
		return
	# merlons on the outer edge, a low parapet on the inner one
	var inset := o * 0.5
	Parts.merlons(m, top_a - inset, top_b - inset, o, 1.5, 2.2, 0.9, lod, red)
	if lod <= 1:
		var ya := ta + 0.5
		var yb := tb + 0.5
		_wall_quad(m, Vector3(ia.x, ta, ia.z), Vector3(ib.x, tb, ib.z), Vector3(ib.x, yb, ib.z), Vector3(ia.x, ya, ia.z), -o, Parts.RED_LIGHT)
	if lod <= 1:
		# the string course two thirds up the face
		var t := 0.66
		var sa: Vector3 = lean.call(a, ha, ha * t) + Vector3(0, a.y + ha * t, 0) - Vector3(0, a.y, 0)
		var sb: Vector3 = lean.call(b, hb, hb * t) + Vector3(0, b.y + hb * t, 0) - Vector3(0, b.y, 0)
		var yaw2 := atan2(-(b.z - a.z), b.x - a.x)
		var len2 := Vector2(b.x - a.x, b.z - a.z).length()
		m.box((sa + sb) * 0.5 + o * 0.15, Vector3(len2 + 0.3, 0.45, 0.4), Parts.RED_LIGHT, yaw2, false, false)
	if lod == 0:
		# blind arches in a row under the parapet
		var len3 := Vector2(b.x - a.x, b.z - a.z).length()
		var count := int(floor(len3 / 6.0))
		var yaw3 := atan2(-(b.z - a.z), b.x - a.x)
		var face_basis := Basis(Vector3.UP, yaw3)
		# the panel frame faces -z: turn it so -z is the outward normal
		if (face_basis * Vector3(0, 0, -1)).dot(o) < 0.0:
			face_basis = Basis(Vector3.UP, yaw3 + PI)
		for k in count:
			var t0 := (k + 0.5) / float(count)
			var hh := lerpf(ha, hb, t0)
			var base: Vector3 = a.lerp(b, t0)
			var y := base.y + hh - 6.2
			var p: Vector3 = lean.call(base, hh, hh - 6.2)
			m.push(Transform3D(face_basis, Vector3(p.x, y, p.z)))
			Parts.blind_arch(m, 0.0, 0.0, 2.6, 2.2, 1.4, lod, Parts.RED_LIGHT, Parts.RED_DARK, 0.1)
			m.pop()


## A quad a b c d whose facing must be `n`: the order is flipped when the corners run the other way.
static func _wall_quad(m: KitMesh, a: Vector3, b: Vector3, c: Vector3, d: Vector3, n: Vector3, col: Color) -> void:
	if (b - a).cross(c - a).dot(n) >= 0.0:
		m.quad(a, b, c, d, col)
	else:
		m.quad(d, c, b, a, col)


## A round bastion standing out from the wall at p, a little higher than the wall, merlons round its top; a corner one
## carries a chhatri.
static func _bastion(m: KitMesh, p: Vector3, h: float, out2: Vector2, corner: bool, lod: int) -> void:
	var r := 9.0 if corner else 7.0
	var c := p + Vector3(out2.x, 0, out2.y) * (OUT_FOOT - 0.5)
	var top := h + 1.2
	if lod >= 3:
		return
	var s := Parts.seg(lod, 20)
	m.lathe(PackedVector2Array([Vector2(r, -0.6), Vector2(r, 3.4), Vector2(r, 3.4), Vector2(r * 0.9, top), Vector2(r * 0.9, top), Vector2(0, top)]), s, c,
		Parts.RED, PackedColorArray([Parts.RED_DARK, Parts.RED_DARK, Parts.RED, Parts.RED, Parts.RED_LIGHT.darkened(0.12), Parts.RED_LIGHT.darkened(0.12)]))
	if m.collide:
		m.solid(c + Vector3(0, top * 0.5 - 0.3, 0), Vector3(r * 1.6, top + 0.6, r * 1.6))
	if lod >= 3:
		return
	if lod <= 1:
		m.cyl(c + Vector3(0, top * 0.62, 0), r * 0.97, 0.45, s, Parts.RED_LIGHT, 1.0, false)
	var count := 18 if corner else 14
	for k in count:
		var a0 := TAU * k / count
		var a1 := TAU * (k + 0.55) / count
		var pa := c + Vector3(cos(a0) * r * 0.86, top, sin(a0) * r * 0.86)
		var pb := c + Vector3(cos(a1) * r * 0.86, top, sin(a1) * r * 0.86)
		var o := Vector3(cos((a0 + a1) * 0.5), 0, sin((a0 + a1) * 0.5))
		Parts.merlons(m, pa, pb, o, minf(1.4, pa.distance_to(pb)), 2.0, 0.8, maxi(lod, 1), Parts.RED)
	if corner:
		Parts.chhatri(m, c + Vector3(0, top, 0), 3.8, 8.5, lod, Parts.RED, Parts.RED_LIGHT, 8, true)


## A gate of the fort: the iwan between two octagonal towers with chhatris, the gallery of small white domes, two
## pinnacles and the flag. Built in a frame whose -z is the outward normal and x runs along the wall.
static func _gate(m: KitMesh, g: Dictionary, lod: int) -> void:
	var s: float = g.scale
	var out: Vector2 = g.out
	var at: Vector2 = g.at
	var yaw := atan2(-out.x, -out.y)
	m.push(Transform3D(Basis(Vector3.UP, yaw), Vector3(at.x, float(g.y), at.y) + Vector3(out.x, 0, out.y) * 2.0))
	var H: float = float(g.h) + 1.0
	var W := 30.0 * s
	var D := 22.0 * s
	var red := Parts.RED
	# the gate block with the passage through it (a pointed arch) and its foot
	var passage := Parts.pointed_arch(7.0 * s, 8.0 * s, 4.0 * s, 8 if lod <= 1 else 4)
	var was := m.collide
	m.collide = false
	m.push(Transform3D(Basis.IDENTITY, Vector3(0, -0.6, -D * 0.5)))
	m.extrude(Parts.wall_with_opening(W, H + 0.6, passage), D, red)
	m.pop()
	m.collide = was
	for xs in [-1.0, 1.0]:
		m.solid(Vector3(xs * (W * 0.25 + 1.75 * s), H * 0.5, 0), Vector3(W * 0.5 - 3.5 * s, H, D))
	m.solid(Vector3(0, (H + 12.0 * s) * 0.5, 0), Vector3(7.0 * s, H - 12.0 * s, D))
	if lod <= 2:
		# the iwan: a tall recessed pointed arch round the passage, with a white marble edge
		m.push(Transform3D(Basis.IDENTITY, Vector3(0, 0, -D * 0.5)))
		Parts.blind_arch(m, 0.0, 0.0, 13.0 * s, 14.0 * s, 6.5 * s, mini(lod, 1), Parts.MARBLE_SHADE, Parts.RED_DARK, 0.25)
		m.pop()
		m.push(Transform3D(Basis.IDENTITY, Vector3(0, 0, -D * 0.5 - 0.06)))
		m.extrude(passage, 0.02, Color("#2a1f1a"), true)
		m.pop()
	if lod <= 1:
		# merlons along the front top edge between the towers
		Parts.merlons(m, Vector3(-W * 0.5 + 6.0 * s, H, -D * 0.5 + 0.6), Vector3(W * 0.5 - 6.0 * s, H, -D * 0.5 + 0.6), Vector3(0, 0, -1), 1.3, 1.9, 0.8, lod, red)
	# the two octagonal towers, standing forward of the face, each crowned with a chhatri
	var tr := 6.2 * s
	var th := H + 4.0 * s
	for xs in [-1.0, 1.0]:
		var tc := Vector3(xs * (W * 0.5 - tr * 0.55), 0, -D * 0.5 - tr * 0.35)
		m.ngon(tc + Vector3(0, -0.6, 0), tr, 8, 0.0, 3.6, Parts.RED_DARK, PI / 8.0)
		m.ngon(tc + Vector3(0, -0.6, 0), tr * 0.97, 8, 3.6, th + 0.6, red, PI / 8.0)
		if m.collide:
			m.solid(tc + Vector3(0, th * 0.5, 0), Vector3(tr * 1.6, th, tr * 1.6))
		if lod <= 1:
			for f in [0.45, 0.8]:
				m.ngon(tc + Vector3(0, th * f, 0), tr * 1.02, 8, 0.0, 0.5, Parts.RED_LIGHT, PI / 8.0)
			for k in 3:
				# blind arches on the three outward faces of the octagon
				var a := -PI * 0.5 + (k - 1) * PI / 4.0
				var fb := Basis(Vector3.UP, -a - PI * 0.5)
				var fp := tc + Vector3(cos(a), 0, sin(a)) * tr * 0.92
				m.push(Transform3D(fb, fp + Vector3(0, th * 0.55, 0)))
				Parts.blind_arch(m, 0.0, 0.0, 2.6 * s, 3.4 * s, 1.6 * s, lod, Parts.RED_LIGHT, Parts.RED_DARK, 0.12)
				m.pop()
		Parts.chhatri(m, tc + Vector3(0, th, 0), 4.8 * s, 10.0 * s, lod, red, Parts.RED_LIGHT, 8, true)
	# the gallery of small white domed chhatris over the iwan, the two pinnacles and the flag
	var gy := H
	m.box(Vector3(0, gy + 1.3 * s, -D * 0.5 + 2.4 * s), Vector3(15.0 * s, 2.6 * s, 4.0 * s), red)
	var count := 7 if lod <= 1 else (4 if lod == 2 else 0)
	for k in count:
		var x := -6.6 * s + 13.2 * s * k / float(count - 1)
		Parts.chhatri(m, Vector3(x, gy + 2.6 * s, -D * 0.5 + 2.4 * s), 1.15 * s, 4.4 * s, maxi(lod, 1), Parts.RED_LIGHT, Parts.MARBLE, 4, true)
	for xs in ([-1.0, 1.0] if lod <= 2 else []):
		var pc := Vector3(xs * 8.4 * s, gy, -D * 0.5 + 2.0 * s)
		m.cyl(pc, 0.7 * s, 8.5 * s, Parts.seg(lod, 12), Parts.MARBLE_SHADE, 0.75)
		Parts.onion_dome(m, pc + Vector3(0, 8.5 * s, 0), 0.75 * s, 1.6 * s, maxi(lod, 1), Parts.MARBLE)
	if g.name.contains("Lahori"):
		Parts.flag(m, Vector3(0, gy + 2.6 * s, -D * 0.5 + 5.5 * s), 13.0, 4.5, lod, PI * 0.5)
	m.pop()


## A building of the fort round a gate (the barbican, a guard room): its footprint in the fort's stone to its height,
## the soot-dark foot, a string course, merlons along the top edges and blind arches on the long faces.
static func _block(m: KitMesh, b: Dictionary, lod: int) -> void:
	var poly := PackedVector2Array()
	for q: Array in b.ring:
		poly.append(Vector2(float(q[0]), float(q[1])))
	if poly.size() < 3:
		return
	# the far silhouette keeps the large ones only
	if lod >= 3 and absf(KitMesh._area(poly)) < 1500.0:
		return
	var y0 := float(b.base) - 0.6
	var top := float(b.top) + maxf(8.0, float(b.get("height", 10.0)))
	if lod <= 1:
		m.prism(poly, y0, float(b.base) + 3.0, Parts.RED_DARK, Color(0, 0, 0, 0), false)
		m.prism(poly, float(b.base) + 3.0, top, Parts.RED, Parts.RED_LIGHT.darkened(0.12))
	else:
		m.prism(poly, y0, top, Parts.RED, Parts.RED_LIGHT.darkened(0.12))
	if lod >= 3:
		return
	var area := KitMesh._area(poly)
	for k in poly.size():
		var a2 := poly[k]
		var b2 := poly[(k + 1) % poly.size()]
		var len := a2.distance_to(b2)
		if len < 3.0:
			continue
		var d := (b2 - a2) / len
		# outward: a positive shoelace area in x, z runs clockwise seen from above (z south)
		var o2 := Vector2(d.y, -d.x) if area > 0.0 else Vector2(-d.y, d.x)
		var o := Vector3(o2.x, 0, o2.y)
		Parts.merlons(m, Vector3(a2.x, top, a2.y) - o * 0.45, Vector3(b2.x, top, b2.y) - o * 0.45, o, 1.4, 2.0, 0.8, lod, Parts.RED)
		if lod <= 1:
			var yaw := atan2(-d.y, d.x)
			m.box(Vector3((a2.x + b2.x) * 0.5, top - 4.0, (a2.y + b2.y) * 0.5) + o * 0.12, Vector3(len, 0.4, 0.3), Parts.RED_LIGHT, yaw, false, false)
		if lod == 0 and len > 8.0:
			var basis := Basis(Vector3.UP, atan2(-d.y, d.x))
			if (basis * Vector3(0, 0, -1)).dot(o) < 0.0:
				basis = Basis(Vector3.UP, atan2(-d.y, d.x) + PI)
			var n := int(len / 5.0)
			for i in n:
				var t := (i + 0.5) / float(n)
				var p := a2.lerp(b2, t)
				m.push(Transform3D(basis, Vector3(p.x, top - 8.0, p.y)))
				Parts.blind_arch(m, 0.0, 0.0, 2.4, 2.4, 1.4, lod, Parts.RED_LIGHT, Parts.RED_DARK, 0.08)
				m.pop()
