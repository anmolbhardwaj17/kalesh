## The light inside a roofed tunnel (P2-032 attempt 2): the two continuous LED strip lines on the soffit are the only
## light there (no sun, no sky ambient, no point lights, no ReflectionProbe). For every vertex of the inside surfaces
## this pass finds the two strip lines that light it and writes the vector from the vertex to the nearest point of
## each (CUSTOM0 and CUSTOM1: xyz, w 1 when there is a strip). The nearest point of a line is an affine function of the
## position, so the vectors interpolate exactly across a triangle and tunnel_light.gdshaderinc shades every pixel
## from them: diffuse from a line source (cos over distance; a face along the tunnel, a pillar's side, gets only the
## bounce), a glossy streak of each strip on the road and the paint, the glow round a strip on the soffit, and the
## surface's own bump. Nothing changes along the tunnel: the strips are continuous, so the light is even end to end.
## Pure (packed arrays of a KitMesh), so it runs on the tile's worker thread.
extends RefCounted

const KitMesh := preload("res://world/landmarks/kit_mesh.gd")
const Tunnel := preload("res://world/infra/kit_tunnel.gd")

## The materials whose vertices carry the strip vectors.
const KEYS := ["tunnel_lit", "tunnel_road", "tunnel_road_petals", "tunnel_wall", "tunnel_soffit", "mural_wave", "mural_pillar"]
## Plan cell of the strip segment grid (m) and how far a strip lights.
const CELL := 8.0
const REACH_M := 14.0


## The strip lines of a tile's ceiling records, in the sink's frame: [{a, b, line}] per segment.
static func strips(tceils: Array, to_local: Transform3D) -> Array:
	var out := []
	var line := 0
	for c: Dictionary in tceils:
		var flat: Array = c.p
		var n := flat.size() / 6
		if n < 2:
			continue
		var v := str(c.v)
		for side in 2:
			for i in n - 1:
				var l0 := Vector3(float(flat[i * 6]), float(flat[i * 6 + 1]), float(flat[i * 6 + 2]))
				var r0 := Vector3(float(flat[i * 6 + 3]), float(flat[i * 6 + 4]), float(flat[i * 6 + 5]))
				var l1 := Vector3(float(flat[i * 6 + 6]), float(flat[i * 6 + 7]), float(flat[i * 6 + 8]))
				var r1 := Vector3(float(flat[i * 6 + 9]), float(flat[i * 6 + 10]), float(flat[i * 6 + 11]))
				var f0: float = Tunnel.strip_offset((l0 - r0).length(), v) / maxf((l0 - r0).length(), 0.01)
				var f1: float = Tunnel.strip_offset((l1 - r1).length(), v) / maxf((l1 - r1).length(), 0.01)
				var a := l0.lerp(r0, f0 if side == 0 else 1.0 - f0) + Vector3(0, -0.06, 0)
				var b := l1.lerp(r1, f1 if side == 0 else 1.0 - f1) + Vector3(0, -0.06, 0)
				out.append({"a": to_local * a, "b": to_local * b, "line": line})
			line += 1
	return out


## The plan grid of strip segments: cell -> indices of the segments that reach it.
static func grid_of(segs: Array) -> Dictionary:
	var grid := {}
	for k in segs.size():
		var s: Dictionary = segs[k]
		var a: Vector3 = s.a
		var b: Vector3 = s.b
		var x0 := floori((minf(a.x, b.x) - REACH_M) / CELL)
		var x1 := floori((maxf(a.x, b.x) + REACH_M) / CELL)
		var z0 := floori((minf(a.z, b.z) - REACH_M) / CELL)
		var z1 := floori((maxf(a.z, b.z) + REACH_M) / CELL)
		for cz in range(z0, z1 + 1):
			for cx in range(x0, x1 + 1):
				var cell := Vector2i(cx, cz)
				if not grid.has(cell):
					grid[cell] = []
				grid[cell].append(k)
	return grid


## True when the point p is under a roof: a strip line runs within 8 m of it in plan, 2 m or more over it (lane
## lines and drains inside take the tunnel's light, the ones on an open ramp the sky's).
static func under(p: Vector3, segs: Array, grid: Dictionary) -> bool:
	for k: int in grid.get(Vector2i(floori(p.x / CELL), floori(p.z / CELL)), []):
		var s: Dictionary = segs[k]
		var a: Vector3 = s.a
		var b: Vector3 = s.b
		var d := Vector2(b.x - a.x, b.z - a.z)
		var l2 := d.length_squared()
		var t := 0.0 if l2 < 1e-8 else clampf((Vector2(p.x - a.x, p.z - a.z)).dot(d) / l2, 0.0, 1.0)
		var q := a.lerp(b, t)
		if q.y > p.y + 2.0 and Vector2(q.x - p.x, q.z - p.z).length() < 8.0:
			return true
	return false


## Writes the strip vectors of every vertex of the KEYS surfaces of a sink. The two strip lines are chosen once per
## primitive (a quad, a triangle, a lathe: its vertices lie together in the surface) from its middle, and every vertex
## of it takes its own vector to those same two lines: where more than two strips are near (a merge, two carriageways
## side by side) vertices that each chose their own pair interpolated a vector to one line into a vector to another,
## and the road showed its triangles. Built for speed (a tunnel tile has some 300,000 vertices): the choice is kept per
## metre cell and facing, a small primitive takes the segment nearest its middle for all its vertices, and only a
## primitive over 2 m looks for each vertex's own segment.
static func apply(m: KitMesh, segs: Array) -> void:
	var grid := grid_of(segs)
	var ns := segs.size()
	var A := PackedVector3Array()
	var D := PackedVector3Array()
	var LINE := PackedInt32Array()
	A.resize(ns)
	D.resize(ns)
	LINE.resize(ns)
	for k in ns:
		var sg: Dictionary = segs[k]
		A[k] = sg.a
		D[k] = sg.b - sg.a
		LINE[k] = int(sg.line)
	var picks := {}
	for part: String in m.parts:
		for key: String in m.parts[part]:
			if not KEYS.has(key):
				continue
			var s: KitMesh.Surf = m.parts[part][key]
			var nv := s.v.size()
			s.cu0.resize(nv * 4)
			s.cu1.resize(nv * 4)
			s.cu0.fill(0.0)
			s.cu1.fill(0.0)
			# the primitives: runs of vertices joined by triangles (each primitive's vertices are appended together)
			var lo := -1
			var hi := -1
			var nt := s.i.size() / 3
			for t in nt + 1:
				var a := nv
				var b := nv
				if t < nt:
					a = mini(s.i[t * 3], mini(s.i[t * 3 + 1], s.i[t * 3 + 2]))
					b = maxi(s.i[t * 3], maxi(s.i[t * 3 + 1], s.i[t * 3 + 2]))
				if lo >= 0 and a <= hi and t < nt:
					lo = mini(lo, a)
					hi = maxi(hi, b)
					continue
				if lo >= 0:
					_light_run(s, lo, hi, grid, A, D, LINE, picks)
				lo = a
				hi = b


## The strip vectors of the vertices lo to hi of a surface (one primitive): the two lines from its middle.
static func _light_run(s: KitMesh.Surf, lo: int, hi: int, grid: Dictionary, A: PackedVector3Array, D: PackedVector3Array, LINE: PackedInt32Array, picks: Dictionary) -> void:
	var mid := Vector3.ZERO
	var nrm := Vector3.ZERO
	for i in range(lo, hi + 1):
		mid += s.v[i]
		nrm += s.n[i]
	mid /= float(hi - lo + 1)
	nrm = nrm.normalized() if nrm.length() > 1e-4 else Vector3.UP
	var size := 0.0
	for i in range(lo, hi + 1):
		size = maxf(size, (s.v[i] - mid).length_squared())
	# the choice for this metre cell and facing: [line, segment, line, segment] (-1: none)
	var ax := nrm.abs().max_axis_index()
	var pk := Vector4i(floori(mid.x), floori(mid.y), floori(mid.z), ax * 2 + (1 if nrm[ax] > 0.0 else 0))
	var pick: PackedInt32Array
	if picks.has(pk):
		pick = picks[pk]
	else:
		pick = _pick(mid, nrm, grid.get(Vector2i(floori(mid.x / CELL), floori(mid.z / CELL)), []), A, D, LINE)
		picks[pk] = pick
	for j in 2:
		var line := pick[j * 2]
		var seg := pick[j * 2 + 1]
		if line < 0:
			continue
		for i in range(lo, hi + 1):
			var p := s.v[i]
			var k := seg
			if size > 1.0:
				# a primitive over 2 m across: each vertex its own nearest segment of the line
				var best := INF
				for c: int in grid.get(Vector2i(floori(p.x / CELL), floori(p.z / CELL)), []):
					if LINE[c] != line:
						continue
					var dc := D[c]
					var l2c := dc.length_squared()
					var uc := 0.0 if l2c < 1e-8 else clampf((p - A[c]).dot(dc) / l2c, 0.0, 1.0)
					var rc := (A[c] + dc * uc - p).length_squared()
					if rc < best:
						best = rc
						k = c
			var d := D[k]
			var l2 := d.length_squared()
			# the nearest point of the segment's line (not clamped past its ends by more than a little)
			var u := 0.0 if l2 < 1e-8 else clampf((p - A[k]).dot(d) / l2, -0.5, 1.5)
			var to := A[k] + d * u - p
			if j == 0:
				s.cu0[i * 4] = to.x
				s.cu0[i * 4 + 1] = to.y
				s.cu0[i * 4 + 2] = to.z
				s.cu0[i * 4 + 3] = 1.0
			else:
				s.cu1[i * 4] = to.x
				s.cu1[i * 4 + 1] = to.y
				s.cu1[i * 4 + 2] = to.z
				s.cu1[i * 4 + 3] = 1.0


## The two strip lines that light a point with normal n most (cos over distance, a little for a face turned away so a
## pillar's side still knows its strips), in id order, each with its segment nearest the point: [line, segment, line,
## segment], -1 where fewer are in reach over the point.
static func _pick(p: Vector3, n: Vector3, cand: Array, A: PackedVector3Array, D: PackedVector3Array, LINE: PackedInt32Array) -> PackedInt32Array:
	# line -> [distance, weight, segment]
	var best := {}
	for k: int in cand:
		var d := D[k]
		var l2 := d.length_squared()
		var t := 0.0 if l2 < 1e-8 else clampf((p - A[k]).dot(d) / l2, 0.0, 1.0)
		var v := A[k] + d * t - p
		var r := v.length()
		if r > REACH_M or v.y < -0.4:
			continue
		var line := LINE[k]
		if not best.has(line) or r < float(best[line][0]):
			var rr := maxf(r, 0.05)
			best[line] = [r, maxf(0.05, n.dot(v / rr)) / rr, k]
	var first := -1
	var second := -1
	for line: int in best:
		var w := float(best[line][1])
		if first < 0 or w > float(best[first][1]):
			second = first
			first = line
		elif second < 0 or w > float(best[second][1]):
			second = line
	# in the order of their ids, so every primitive that sees the same two strips puts each in the same channel
	if second >= 0 and second < first:
		var x := first
		first = second
		second = x
	return PackedInt32Array([first, int(best[first][2]) if first >= 0 else -1, second, int(best[second][2]) if second >= 0 else -1])
