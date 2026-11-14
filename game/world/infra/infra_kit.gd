## The infrastructure kits (P2-034, STYLE_BIBLE.md "Infrastructure", harness/design/reference/infrastructure/): builds
## one tile's flyovers, bridges, rail track, metro viaduct and foot over bridges from the kit inputs of infra.json
## (tools/bake/infra/build.ts lists every record) in the signed stylised B look: the stand-in kit's materials
## ("matte" takes the concrete, plaster and brick textures and the wear mask of the look; "road" the ballast; "satin",
## "metal" and "paint" the steel), palette colours from STYLE_BIBLE.md and the reference files. Pure data in, packed
## arrays out (game/world/landmarks/kit_mesh.gd), so it runs on a worker thread.
##
## Two levels per group: `base` (the shapes that read from far: decks, piers, barriers, rails, masts, roofs) and
## `near` (the small parts: sleepers, paint blocks, posts, bearings, wires, stair treads), shown within NEAR_M.
## Groups: road (flyovers and bridges), rail, metro, fob, tunnel (cuts, tunnels and underpasses, P2-032, kit_tunnel.gd),
## each with its own wear (the look's grime mask).
extends RefCounted

const KitMesh := preload("res://world/landmarks/kit_mesh.gd")
const Road := preload("res://world/infra/kit_road.gd")
const Rail := preload("res://world/infra/kit_rail.gd")
const Elevated := preload("res://world/infra/kit_elevated.gd")
const Tunnel := preload("res://world/infra/kit_tunnel.gd")
const TunnelMouth := preload("res://world/infra/kit_tunnel_mouth.gd")
const TunnelPaint := preload("res://world/infra/kit_tunnel_paint.gd")
const TunnelLight := preload("res://world/infra/kit_tunnel_light.gd")

## Distance to which the near level shows (m), measured to the middle of a tile's mesh.
const NEAR_M := 260.0
## Wear per group (STYLE_BIBLE.md "Materials": grime is data): older flyovers sooty, the railway dirty, the metro clean.
## The tunnels (P2-032) are new and clean (the Pragati Maidan tunnel opened in 2022; tunnels.md wear 0.1 to 0.2).
const WEAR := {"road": 0.15, "rail": 0.45, "metro": 0.08, "fob": 0.2, "tunnel": 0.12}
const GROUPS := ["road", "rail", "metro", "fob", "tunnel"]


## Builds a tile's records. `origin` is the tile origin (world metres): every point is drawn relative to it.
## Returns {group: {"base": KitMesh, "near": KitMesh}} for the groups the tile has, "triangles", and "labels" (the
## tunnel names on the headwalls: [{text, xf, size}] in world metres).
static func build(recs: Dictionary, origin: Vector3) -> Dictionary:
	var out := {}
	var tris := 0
	for g: String in GROUPS:
		out[g] = {"base": KitMesh.new(), "near": KitMesh.new()}
	var to_local := Transform3D(Basis.IDENTITY, -origin)
	for g: String in GROUPS:
		out[g].base.xf = to_local
		out[g].near.xf = to_local
	var road: Dictionary = out.road
	for e: Dictionary in recs.get("edges", []):
		Road.edge(road.base, road.near, e)
	for s: Dictionary in recs.get("soffits", []):
		Road.soffit(road.base, road.near, s)
	for f: Dictionary in recs.get("faces", []):
		Road.end_wall(road.base, f)
	for b: Dictionary in recs.get("beams", []):
		Road.beam(road.base, b)
	for p: Dictionary in recs.get("piers", []):
		var v := str(p.v)
		if v.begins_with("MET"):
			Elevated.metro_pier(out.metro.base, out.metro.near, p)
		elif v.begins_with("FOB"):
			Elevated.fob_column(out.fob.base, p)
		elif v.begins_with("RBR") or v.begins_with("RAIL"):
			Rail.bridge_pier(out.rail.base, p)
		else:
			Road.pier(road.base, road.near, p)
	for t: Dictionary in recs.get("tracks", []):
		Rail.track(out.rail.base, out.rail.near, t)
	for p: Dictionary in recs.get("platforms", []):
		Rail.platform(out.rail.base, out.rail.near, p)
	for m: Dictionary in recs.get("masts", []):
		Rail.mast(out.rail.base, out.rail.near, m)
	for d: Dictionary in recs.get("metro", []):
		Elevated.metro_deck(out.metro.base, out.metro.near, d)
	for f: Dictionary in recs.get("fobs", []):
		Elevated.fob(out.fob.base, out.fob.near, f)
	var tun: Dictionary = out.tunnel
	var twalls: Array = recs.get("twalls", [])
	var med := TunnelPaint.median_flags(twalls)
	for wi in twalls.size():
		Tunnel.wall(tun.base, tun.near, twalls[wi], med[wi])
	var tlines: Array = recs.get("tlines", [])
	for c: Dictionary in recs.get("tceils", []):
		Tunnel.ceiling(tun.base, tun.near, c, tlines)
	var labels := []
	for h: Dictionary in recs.get("theads", []):
		TunnelMouth.head(tun.base, tun.near, h)
		var lab := TunnelMouth.head_label(h)
		if not lab.is_empty():
			labels.append(lab)
	# what lies on the road is lit by the strips under a roof and by the sky on an open ramp
	var tceils: Array = recs.get("tceils", [])
	var wsegs := TunnelLight.strips(tceils, Transform3D.IDENTITY)
	var wgrid := TunnelLight.grid_of(wsegs)
	for d: Dictionary in recs.get("tdrains", []):
		var mid := Vector3((float(d.a[0]) + float(d.b[0])) * 0.5, (float(d.a[1]) + float(d.b[1])) * 0.5, (float(d.a[2]) + float(d.b[2])) * 0.5)
		TunnelMouth.drain(tun.base, d, TunnelLight.under(mid, wsegs, wgrid))
	for l: Dictionary in recs.get("tlines", []):
		Tunnel.line(tun.base, l, func(p: Vector3) -> bool: return TunnelLight.under(p, wsegs, wgrid))
	# the light of the two LED strip lines inside every roofed stretch, per vertex (kit_tunnel_light.gd)
	if not tceils.is_empty():
		var segs := TunnelLight.strips(tceils, to_local)
		TunnelLight.apply(tun.base, segs)
		TunnelLight.apply(tun.near, segs)
	out["labels"] = labels
	for g: String in GROUPS:
		tris += int(out[g].base.triangles) + int(out[g].near.triangles)
	out["triangles"] = tris
	return out


# ---------------------------------------------------------------- shared helpers


## Points of a flat record array: `stride` numbers per point.
static func points(flat: Array, stride: int) -> Array:
	var out := []
	var n := flat.size() / stride
	for k in n:
		out.append(flat.slice(k * stride, k * stride + stride))
	return out


## A swept section: at each frame [origin, u, v] the profile points p (x along u, y along v) make a ring; quads join
## consecutive rings. Faces point away from `inside` (a point of the profile's plane) so the winding never depends on
## the profile's order. `closed` joins the last profile point to the first.
static func sweep(m: KitMesh, frames: Array, prof: PackedVector2Array, inside: Vector2, col: Color, closed := false) -> void:
	var n := prof.size()
	var edges := n if closed else n - 1
	for i in frames.size() - 1:
		var f0: Array = frames[i]
		var f1: Array = frames[i + 1]
		for k in edges:
			var p := prof[k]
			var q := prof[(k + 1) % n]
			var a: Vector3 = f0[0] + f0[1] * p.x + f0[2] * p.y
			var b: Vector3 = f1[0] + f1[1] * p.x + f1[2] * p.y
			var c: Vector3 = f1[0] + f1[1] * q.x + f1[2] * q.y
			var d: Vector3 = f0[0] + f0[1] * q.x + f0[2] * q.y
			var mid := (p + q) * 0.5
			var away := mid - inside
			var want: Vector3 = f0[1] * away.x + f0[2] * away.y
			var nrm := (b - a).cross(c - a) + (c - a).cross(d - a)
			if nrm.dot(want) >= 0.0:
				m.quad(a, b, c, d, col)
			else:
				m.quad(a, d, c, b, col)


## A quad turned to face `want` (whatever the order of its corners).
static func oquad(m: KitMesh, a: Vector3, b: Vector3, c: Vector3, d: Vector3, want: Vector3, col: Color) -> void:
	var nrm := (b - a).cross(c - a) + (c - a).cross(d - a)
	if nrm.dot(want) >= 0.0:
		m.quad(a, b, c, d, col)
	else:
		m.quad(a, d, c, b, col)


## A box between two points a and b (its long axis), w wide across (plan) and h tall, bottom at the points' height.
static func beam_box(m: KitMesh, a: Vector3, b: Vector3, w: float, h: float, col: Color, bottom := true) -> void:
	var d := b - a
	var len := Vector2(d.x, d.z).length()
	if len < 1e-3:
		return
	var t := Vector3(d.x, 0, d.z) / len
	var u := Vector3(-t.z, 0, t.x)
	var hw := w * 0.5
	var up := Vector3.UP * h
	oquad(m, a - u * hw, b - u * hw, b - u * hw + up, a - u * hw + up, -u, col)
	oquad(m, a + u * hw, b + u * hw, b + u * hw + up, a + u * hw + up, u, col)
	oquad(m, a - u * hw + up, b - u * hw + up, b + u * hw + up, a + u * hw + up, Vector3.UP, col)
	oquad(m, a - u * hw, a + u * hw, a + u * hw + up, a - u * hw + up, -t, col)
	oquad(m, b - u * hw, b + u * hw, b + u * hw + up, b - u * hw + up, t, col)
	if bottom:
		oquad(m, a - u * hw, b - u * hw, b + u * hw, a + u * hw, Vector3.DOWN, col)


## An upright box with its base centre at c, size (across x, height y, along z), its along axis on the plan direction d.
static func post(m: KitMesh, c: Vector3, size: Vector3, d: Vector2, col: Color) -> void:
	m.box(c + Vector3(0, size.y * 0.5, 0), size, col, atan2(d.x, d.y))


## A flat ring of points (x, z) as an upright prism from y0 to y1 (the kit sink's prism, no collider).
static func prism(m: KitMesh, ring: PackedVector2Array, y0: float, y1: float, col: Color, roof := Color(0, 0, 0, 0)) -> void:
	m.prism(ring, y0, y1, col, roof, false)


## A plan rectangle about c: half sizes along the unit direction d and across it.
static func rect(c: Vector2, d: Vector2, along: float, across: float) -> PackedVector2Array:
	var n := Vector2(-d.y, d.x)
	return PackedVector2Array([c + d * along + n * across, c - d * along + n * across, c - d * along - n * across, c + d * along - n * across])
