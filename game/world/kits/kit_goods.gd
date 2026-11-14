## Goods stacked in front of a shop (P2-048 fix round 3; kit_modules.gd PIECES, slot "spill"): drums, pipe racks, taped
## cartons and jute sacks as real shapes with their own shading, in the module frame and paint codes of module_mesh.gd.
extends RefCounted

const M := preload("res://world/kits/module_mesh.gd")


## An upright drum or a lying pipe: n sides.
static func _cyl(m: M, c: Vector3, r: float, h: float, n: int, lid := true) -> void:
	for i in n:
		var a0 := TAU * float(i) / n
		var a1 := TAU * float(i + 1) / n
		var p0 := Vector3(c.x + cos(a0) * r, c.y, c.z + sin(a0) * r)
		var p1 := Vector3(c.x + cos(a1) * r, c.y, c.z + sin(a1) * r)
		m.quad(p1, p0, p0 + Vector3(0, h, 0), p1 + Vector3(0, h, 0))
		if lid:
			m.quad(Vector3(c.x, c.y + h, c.z), Vector3(c.x, c.y + h, c.z), p1 + Vector3(0, h, 0), p0 + Vector3(0, h, 0))


static func _pipe(m: M, x0: float, x1: float, y: float, z: float, r: float, n := 6) -> void:
	for i in n:
		var a0 := TAU * float(i) / n
		var a1 := TAU * float(i + 1) / n
		var d0 := Vector3(0, cos(a0) * r, sin(a0) * r)
		var d1 := Vector3(0, cos(a1) * r, sin(a1) * r)
		m.quad(Vector3(x0, y, z) + d0, Vector3(x1, y, z) + d0, Vector3(x1, y, z) + d1, Vector3(x0, y, z) + d1)
		# the open ends: a dark bore
		m.quad(Vector3(x0, y, z), Vector3(x0, y, z), Vector3(x0, y, z) + d0, Vector3(x0, y, z) + d1)
		m.quad(Vector3(x1, y, z), Vector3(x1, y, z), Vector3(x1, y, z) + d1, Vector3(x1, y, z) + d0)


## Goods stacked on the shop step and the pavement edge in front of a shop (fix round 3: the plain cubes read as toys):
## real shapes with their own shading. `kind`: drums (oil and grease drums, a bucket stack), pipes (a rack of pipe
## lengths on two bearers, coils leaning on it), cartons (taped cartons stacked off square), sacks (jute sacks lying
## in a pile, one standing open).
static func goods(m: M, kind: String) -> void:
	match kind:
		"drums":
			m.paint(M.IRON, M.OWN, Color(0.1, 0.27, 0.5))
			_cyl(m, Vector3(-0.98, 0.18, 0.72), 0.29, 0.88, 10)
			m.paint(M.IRON, M.OWN, Color(0.5, 0.12, 0.09))
			_cyl(m, Vector3(-0.4, 0.18, 0.76), 0.29, 0.88, 10)
			# rolled hoops round each drum, a bung on the lid (fine detail: gone past 80 m)
			m.fine = true
			m.paint(M.IRON, M.OWN, Color(0.07, 0.17, 0.33))
			for y in [0.47, 0.76]:
				_cyl(m, Vector3(-0.98, y, 0.72), 0.3, 0.035, 10, false)
			m.paint(M.IRON, M.OWN, Color(0.33, 0.08, 0.06))
			for y in [0.47, 0.76]:
				_cyl(m, Vector3(-0.4, y, 0.76), 0.3, 0.035, 10, false)
			m.paint(M.IRON, M.OWN, Color(0.75, 0.72, 0.62))
			_cyl(m, Vector3(-1.08, 1.06, 0.66), 0.045, 0.03, 6)
			_cyl(m, Vector3(-0.5, 1.06, 0.7), 0.045, 0.03, 6)
			m.fine = false
			# a stack of buckets and a small grease tin on the red drum
			m.paint(M.IRON, M.OWN, Color(0.78, 0.6, 0.12))
			_cyl(m, Vector3(0.82, 0.18, 0.74), 0.17, 0.3, 8)
			_cyl(m, Vector3(0.82, 0.48, 0.74), 0.175, 0.1, 8)
			_cyl(m, Vector3(0.82, 0.58, 0.74), 0.18, 0.1, 8)
			m.paint(M.IRON, M.OWN, Color(0.62, 0.64, 0.66))
			_cyl(m, Vector3(-0.36, 1.06, 0.82), 0.1, 0.14, 8)
		"pipes":
			# two timber bearers, then pipe lengths laid in rows: grey GI, white and blue PVC
			m.paint(M.WOOD, M.OWN, Color(0.75, 0.7, 0.62))
			m.box(Vector3(-0.95, 0.18, 0.42), Vector3(-0.85, 0.26, 0.98), false, false)
			m.box(Vector3(0.75, 0.18, 0.42), Vector3(0.85, 0.26, 0.98), false, false)
			var cols := [Color(0.5, 0.52, 0.54), Color(0.8, 0.8, 0.77), Color(0.2, 0.36, 0.6), Color(0.74, 0.7, 0.5)]
			var k := 0
			for row in 3:
				var n := 5 - row
				for i in n:
					m.paint(M.IRON, M.OWN, cols[(k * 3 + row) % 4])
					var z := 0.5 + (float(i) + float(row) * 0.5) * 0.105
					var jut := 0.06 * float((k * 5) % 4)
					_pipe(m, -1.25 + jut, 1.15 + jut * 0.6, 0.31 + float(row) * 0.092, z, 0.05)
					k += 1
			# a coil of hose standing against the rack
			m.fine = true
			m.paint(M.IRON, M.OWN, Color(0.08, 0.08, 0.09))
			for x in [1.02]:
				for i in 8:
					var a0 := TAU * float(i) / 8.0
					var a1 := TAU * float(i + 1) / 8.0
					var c := Vector3(x, 0.52, 0.95)
					var p0 := c + Vector3(0, cos(a0), sin(a0)) * 0.3
					var p1 := c + Vector3(0, cos(a1), sin(a1)) * 0.3
					var q0 := c + Vector3(0, cos(a0), sin(a0)) * 0.2
					var q1 := c + Vector3(0, cos(a1), sin(a1)) * 0.2
					m.both(p0 + Vector3(0.03, 0, 0), p1 + Vector3(0.03, 0, 0), q1 + Vector3(0.03, 0, 0), q0 + Vector3(0.03, 0, 0))
					m.quad(p0 - Vector3(0.03, 0, 0), p0 + Vector3(0.03, 0, 0), p1 + Vector3(0.03, 0, 0), p1 - Vector3(0.03, 0, 0))
			m.fine = false
		"cartons":
			# taped cartons, each a little off the one under it, a loose one on the step
			var cc := [Color(0.62, 0.47, 0.3), Color(0.68, 0.53, 0.35), Color(0.56, 0.42, 0.27)]
			var boxes := [[-1.2, 0.18, 0.5, 0.62, 0.42, 0.44], [-1.15, 0.6, 0.53, 0.52, 0.36, 0.4], [-1.22, 0.96, 0.5, 0.44, 0.3, 0.36],
				[-0.54, 0.18, 0.56, 0.5, 0.36, 0.4], [-0.5, 0.54, 0.6, 0.46, 0.3, 0.34], [0.62, 0.18, 0.62, 0.56, 0.4, 0.36]]
			var bi := 0
			for b: Array in boxes:
				# (the plain matte code: cardboard takes no plaster stains or wall grime)
				m.paint(M.INTERIOR, M.OWN, cc[bi % 3])
				var lo := Vector3(b[0], b[1], b[2])
				var hi := lo + Vector3(b[3], b[4], b[5])
				m.box(lo, hi, false, false)
				# the tape along the top seam and down the front, a label
				m.fine = true
				m.paint(M.IRON, M.OWN, Color(0.78, 0.7, 0.5))
				m.quad(Vector3(lo.x, hi.y + 0.003, (lo.z + hi.z) * 0.5 - 0.03), Vector3(lo.x, hi.y + 0.003, (lo.z + hi.z) * 0.5 + 0.03), Vector3(hi.x, hi.y + 0.003, (lo.z + hi.z) * 0.5 + 0.03), Vector3(hi.x, hi.y + 0.003, (lo.z + hi.z) * 0.5 - 0.03))
				m.front((lo.x + hi.x) * 0.5 - 0.03, lo.y, (lo.x + hi.x) * 0.5 + 0.03, hi.y, hi.z + 0.003)
				m.paint(M.IRON, M.OWN, Color(0.86, 0.84, 0.78))
				m.front(lo.x + 0.05, lo.y + b[4] * 0.45, lo.x + 0.05 + b[3] * 0.3, lo.y + b[4] * 0.8, hi.z + 0.004)
				m.fine = false
				bi += 1
		"sacks":
			# jute sacks lying flat in a pile, each sagging at its ends, and one standing with its mouth rolled down
			var lay := [[-1.22, 0.18, 0.46, 0.8], [-0.4, 0.18, 0.5, 0.76], [-0.84, 0.39, 0.5, 0.8], [-0.02, 0.39, 0.52, 0.7], [-0.46, 0.6, 0.52, 0.78]]
			var si := 0
			for sk: Array in lay:
				var j := Color(0.66, 0.55, 0.38) if si % 2 == 0 else Color(0.6, 0.5, 0.35)
				m.paint(M.CLOTH, M.OWN, j)
				var x0: float = sk[0]
				var y0: float = sk[1]
				var z0: float = sk[2]
				var ln: float = sk[3]
				m.box(Vector3(x0 + 0.1, y0, z0), Vector3(x0 + ln - 0.1, y0 + 0.21, z0 + 0.44), false, false)
				# the sagging ends: lower and narrower
				m.box(Vector3(x0, y0, z0 + 0.04), Vector3(x0 + 0.1, y0 + 0.15, z0 + 0.4), false, false)
				m.box(Vector3(x0 + ln - 0.1, y0, z0 + 0.04), Vector3(x0 + ln, y0 + 0.15, z0 + 0.4), false, false)
				# the stitched seam
				m.paint(M.IRON, M.OWN, Color(0.42, 0.34, 0.22))
				m.front(x0 + 0.1, y0 + 0.1, x0 + ln - 0.1, y0 + 0.115, z0 + 0.443)
				si += 1
			m.paint(M.CLOTH, M.OWN, Color(0.64, 0.53, 0.36))
			_cyl(m, Vector3(0.95, 0.18, 0.72), 0.24, 0.5, 8, false)
			m.paint(M.CLOTH, M.OWN, Color(0.72, 0.62, 0.44))
			_cyl(m, Vector3(0.95, 0.62, 0.72), 0.27, 0.07, 8, false)
			# what it holds: a heap of red chillies or turmeric
			m.paint(M.IRON, M.OWN, Color(0.6, 0.14, 0.08))
			_cyl(m, Vector3(0.95, 0.6, 0.72), 0.23, 0.1, 8)
