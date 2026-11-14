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
const KEYS := ["tunnel_lit", "tunnel_road", "mural_wave", "mural_pillar"]
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


## Writes the strip vectors of every vertex of the KEYS surfaces of a sink.
static func apply(m: KitMesh, segs: Array) -> void:
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
	for part: String in m.parts:
		for key: String in m.parts[part]:
			if not KEYS.has(key):
				continue
			var s: KitMesh.Surf = m.parts[part][key]
			var nv := s.v.size()
			s.cu0.resize(nv * 4)
			s.cu1.resize(nv * 4)
			for i in nv:
				var two := lights_at(s.v[i], s.n[i], segs, grid.get(Vector2i(floori(s.v[i].x / CELL), floori(s.v[i].z / CELL)), []))
				for j in 4:
					s.cu0[i * 4 + j] = two[0][j]
					s.cu1[i * 4 + j] = two[1][j]


## The two strips that light a point with normal n: [Vector4(to the strip xyz, 1), ...], Vector4.ZERO for none.
## Per strip line its nearest segment; the two lines that give the most light (cos over distance, a little for a
## face turned away so a pillar's side still knows its strips).
static func lights_at(p: Vector3, n: Vector3, segs: Array, cand: Array) -> Array:
	var best := {}
	for k: int in cand:
		var s: Dictionary = segs[k]
		var a: Vector3 = s.a
		var b: Vector3 = s.b
		var d := b - a
		var L2 := d.length_squared()
		var t := 0.0 if L2 < 1e-8 else clampf((p - a).dot(d) / L2, 0.0, 1.0)
		# the nearest point of the segment's line (not clamped past the run's ends by more than a little)
		var tl := 0.0 if L2 < 1e-8 else clampf((p - a).dot(d) / L2, -0.5, 1.5)
		var q := a + d * tl
		var r := (a + d * t - p).length()
		if r > REACH_M or q.y < p.y - 0.4:
			continue
		var line: int = s.line
		if not best.has(line) or r < float(best[line][0]):
			best[line] = [r, q - p]
	var picks := []
	for line: int in best:
		var v: Vector3 = best[line][1]
		var r := maxf(v.length(), 0.05)
		picks.append([maxf(0.05, n.dot(v / r)) / r, v, line])
	picks.sort_custom(func(x: Array, y: Array) -> bool: return float(x[0]) > float(y[0]))
	# the two kept in the order of their line ids, so the vertices of a triangle that see the same two strips put
	# each in the same channel (a swapped pair would interpolate one strip into the other)
	var two := picks.slice(0, 2)
	two.sort_custom(func(x: Array, y: Array) -> bool: return int(x[2]) < int(y[2]))
	var out := [Vector4.ZERO, Vector4.ZERO]
	for j in two.size():
		var v: Vector3 = two[j][1]
		out[j] = Vector4(v.x, v.y, v.z, 1.0)
	return out
