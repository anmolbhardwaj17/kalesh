## World of the render architecture bench (P0-016, ARCH_OPTIONS.md rows I, LD, OC, KT). Two layouts built from the
## P0-009 stand-in kit (game/scenes/standin/kit.gd), cut into reusable modules:
##   city: about 2 km by 2 km, a 125 m street grid with dense, row, sparse and park blocks (3000 or more buildings,
##         parked vehicles, trees, street lights, people).
##   kit:  a 500 m by 500 m dense old city block (5 m lanes, tight 3 to 5 floor houses, poles and wires).
## A building is a unique shell (boxes) plus facade modules (windows, shop bays, boards, AC units, balconies, tanks).
## The same world data is drawn three ways (ARCH_OPTIONS.md "Instancing"):
##   i1: one MeshInstance3D per building and per prop.
##   i2: everything merged into one mesh per tile and material.
##   i3: shells and ground merged per tile; every module as one MultiMesh per module per 125 m cell.
## LOD (LD1, i3 only): modules to R1, a merged mid shell per cell from R1 to R2, a district skyline beyond R2, through
## visibility ranges; module meshes carry LOD index buffers (ImporterMesh.generate_lods, passed to
## ArrayMesh.add_surface_from_arrays). Occluders (OC1): one ArrayOccluder3D per tile from the building boxes.
## Everything is seeded. Bench only: never loaded by the default game.
extends RefCounted

const Geo := preload("res://scenes/standin/geo.gd")
const Kit := preload("res://scenes/standin/kit.gd")

const CELL := 125.0
const BAY := 3.0
const FLOOR_H := 3.2
const R1 := 180.0
const R2 := 700.0
const SEED := 20261116

## One reusable mesh: its surfaces as raw arrays (for merging) and as an ArrayMesh (for instancing).
class Module:
	var id := 0
	var name := ""
	var keys: Array[String] = []
	## per surface: [verts, normals, colours, indices]
	var arrays: Array = []
	var mesh: ArrayMesh
	var tris := 0
	var shadow := true
	## what the mid LOD draws instead: "" nothing, "tree" a low blob, "box" a plain box
	var mid := ""
	var size := Vector3.ONE


## Growing vertex buffers of one material.
class Buf:
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	var c := PackedColorArray()
	var i := PackedInt32Array()

	func add(a: Array, xf: Transform3D) -> void:
		var base := v.size()
		var av: PackedVector3Array = a[0]
		var an: PackedVector3Array = a[1]
		v.append_array(xf * av)
		n.append_array(Transform3D(xf.basis, Vector3.ZERO) * an)
		c.append_array(a[2])
		var src: PackedInt32Array = a[3]
		var ib := i.size()
		var cnt := src.size()
		i.resize(ib + cnt)
		for k in cnt:
			i[ib + k] = src[k] + base

	func arrays() -> Array:
		var a := []
		a.resize(Mesh.ARRAY_MAX)
		a[Mesh.ARRAY_VERTEX] = v
		a[Mesh.ARRAY_NORMAL] = n
		a[Mesh.ARRAY_COLOR] = c
		a[Mesh.ARRAY_INDEX] = i
		return a


## Buffers per material key; becomes one ArrayMesh with a surface per key.
class Merge:
	var bufs := {}

	func buf(key: String) -> Buf:
		if not bufs.has(key):
			bufs[key] = Buf.new()
		return bufs[key]

	func add_module(m: Module, xf: Transform3D) -> void:
		for k in m.keys.size():
			buf(m.keys[k]).add(m.arrays[k], xf)

	func add_sink(s: Geo.Sink) -> void:
		for key in s.batches:
			var b = s.batches[key]
			buf(key).add([b.verts, b.norms, b.cols, b.idx], Transform3D.IDENTITY)

	func is_empty() -> bool:
		return bufs.is_empty()

	func tris() -> int:
		var t := 0
		for key in bufs:
			t += (bufs[key] as Buf).i.size() / 3
		return t

	func to_mesh(mats: Dictionary) -> ArrayMesh:
		var mesh := ArrayMesh.new()
		var keys := bufs.keys()
		keys.sort()
		for key in keys:
			var b: Buf = bufs[key]
			if b.v.is_empty():
				continue
			mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, b.arrays())
			mesh.surface_set_material(mesh.get_surface_count() - 1, mats.get(key))
		return mesh


class Building:
	var xf: Transform3D
	var w := 6.0
	var d := 12.0
	var floors := 3
	var col: Color
	var board: Color
	var cabin := false
	var cell: Vector2i
	## [module id, local transform]
	var mods: Array = []


var layout := "city"
var half := 1000.0
var cells_per_tile := 2
var cells_per_district := 4
var mats := {}
var modules: Array[Module] = []
var by_name := {}
var buildings: Array[Building] = []
## props: [module id, world transform, cell]
var props: Array = []
## ground boxes: [cell, material key, colour, centre, size]
var ground: Array = []
var rng := RandomNumberGenerator.new()
var stats := {}


func _init(look_mats: Dictionary) -> void:
	mats = look_mats


# ------------------------------------------------------------------ modules


func _module(name: String, s: Geo.Sink, shadow := true, mid := "") -> Module:
	var m := Module.new()
	m.id = modules.size()
	m.name = name
	m.shadow = shadow
	m.mid = mid
	var keys := s.batches.keys()
	keys.sort()
	var lo := Vector3(INF, INF, INF)
	var hi := Vector3(-INF, -INF, -INF)
	for key in keys:
		var b = s.batches[key]
		m.keys.append(key)
		m.arrays.append([b.verts, b.norms, b.cols, b.idx])
		m.tris += b.idx.size() / 3
		for p in b.verts:
			lo = lo.min(p)
			hi = hi.max(p)
	m.size = hi - lo
	m.mesh = _mesh_with_lods(m)
	modules.append(m)
	by_name[name] = m
	return m


## The module as an ArrayMesh. Surfaces with more than 150 triangles get LOD index buffers from ImporterMesh
## (meshoptimizer inside the engine, the stand-in for the bake's meshoptimizer pass).
func _mesh_with_lods(m: Module) -> ArrayMesh:
	var mesh := ArrayMesh.new()
	for k in m.keys.size():
		var a := []
		a.resize(Mesh.ARRAY_MAX)
		a[Mesh.ARRAY_VERTEX] = m.arrays[k][0]
		a[Mesh.ARRAY_NORMAL] = m.arrays[k][1]
		a[Mesh.ARRAY_COLOR] = m.arrays[k][2]
		a[Mesh.ARRAY_INDEX] = m.arrays[k][3]
		var lods := {}
		if (m.arrays[k][3] as PackedInt32Array).size() > 450:
			var im := ImporterMesh.new()
			im.add_surface(Mesh.PRIMITIVE_TRIANGLES, a)
			im.generate_lods(25.0, 60.0, [])
			for l in im.get_surface_lod_count(0):
				lods[im.get_surface_lod_size(0, l)] = im.get_surface_lod_indices(0, l)
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, a, [], lods)
		mesh.surface_set_material(k, mats.get(m.keys[k]))
	return mesh


func _sink() -> Geo.Sink:
	return Geo.Sink.new()


func _build_modules() -> void:
	var frame_cols := [Color("#e8e4d8"), Color("#2f5d50"), Color("#6b4a2e"), Color("#3c5a8a")]
	for i in frame_cols.size():
		var s := _sink()
		s.box("matte", frame_cols[i], Vector3(0, 0, -0.025), Vector3(1.3, 1.7, 0.05))
		s.box("glass", Kit.GLASS, Vector3(0, 0, -0.04), Vector3(1.05, 1.45, 0.04))
		s.box("matte", Kit.shade(frame_cols[i], 0.8), Vector3(0, -0.9, -0.08), Vector3(1.4, 0.08, 0.16))
		_module("win_%d" % i, s, false)
	for i in 6:
		var s := _sink()
		var ow := BAY - 0.4
		s.box("matte", Color("#4a3a2c"), Vector3(0, 1.45, -0.02), Vector3(ow, 2.7, 0.05))
		s.box("matte", Color("#6a5848"), Vector3(0, 1.3, -0.03), Vector3(ow - 0.4, 1.2, 0.04))
		for bx in [-0.6, 0.6]:
			s.ball("glow", Color("#ffe2a8"), Vector3(bx, 2.15, -0.12), Vector3.ONE * 0.06, Geo.SEG_THIN)
		s.box("metal", Kit.shade(Kit.SHUTTER, rng.randf_range(0.8, 1.1)), Vector3(0, 2.55, -0.05), Vector3(ow, 0.5, 0.06))
		s.box("matte", Color("#5b4636"), Vector3(0, 0.35, -0.25), Vector3(ow - 0.2, 0.7, 0.45))
		for g in 3:
			var gx := -0.8 + g * 0.8
			var gc: Color = Kit.shade(Kit.pick(rng, Kit.CLOTHES) if rng.randf() < 0.6 else Kit.pick(rng, Kit.BOARDS), rng.randf_range(0.6, 0.85))
			if rng.randf() < 0.5:
				s.ball("satin", gc, Vector3(gx, 0.86, -0.28), Vector3(0.28, 0.17, 0.2), Geo.SEG_SMALL)
			else:
				var gh := rng.randf_range(0.2, 0.45)
				s.box("satin", gc, Vector3(gx, 0.7 + gh * 0.5, -0.28), Vector3(0.5, gh, 0.32))
		_module("bay_%d" % i, s, false)
	for i in 6:
		var s := _sink()
		s.box("satin", Kit.BOARDS[i], Vector3(0, 3.35, -0.12), Vector3(BAY - 0.1, 0.95, 0.12))
		_module("board_%d" % i, s, false)
	for i in 3:
		var s := _sink()
		s.box("satin", Kit.BOARDS[i + 6], Vector3(0, 5.1, -0.1), Vector3(2.0, 0.8, 0.1))
		_module("board2_%d" % i, s, false)
	var ac := _sink()
	ac.box("satin", Color("#d9d9d4"), Vector3(0, 0, -0.3), Vector3(0.8, 0.55, 0.5))
	ac.box("metal", Color("#8a8d8e"), Vector3(0, 0, -0.56), Vector3(0.6, 0.4, 0.02))
	_module("ac", ac, false)
	var tank := _sink()
	tank.cyl("satin", Color("#202224"), Vector3(0, 0.6, 0), 0.55, 1.2, Geo.SEG_MID)
	tank.cyl("satin", Color("#202224"), Vector3(0, 1.25, 0), 0.2, 0.12, Geo.SEG_SMALL)
	_module("tank", tank)
	for i in 2:
		var s := _sink()
		var bw := BAY - 0.4
		s.box("matte", Color("#cfc8b8"), Vector3(0, 0.05, -0.55), Vector3(bw, 0.15, 1.1))
		s.box("metal", Color("#3a3f44"), Vector3(0, 0.6, -1.08), Vector3(bw, 0.9, 0.04))
		if i == 1:
			for k in 4:
				s.box("satin", Kit.pick(rng, Kit.CLOTHES), Vector3(-bw * 0.4 + k * bw * 0.25, 1.05, -1.0), Vector3(0.5, 0.6, 0.02))
		_module("balcony_%d" % i, s)
	for i in 3:
		var s := _sink()
		s.put("satin", Geo.unit_box(), Transform3D(Basis(Vector3.RIGHT, deg_to_rad(-14)) * Basis.from_scale(Vector3(BAY - 0.3, 0.04, 1.5)),
			Vector3(0, 2.92, -0.73)), Kit.BOARDS[i * 2])
		_module("awning_%d" % i, s)
	for i in 3:
		var s := _sink()
		Kit.tree(s, rng, 0.9 + 0.15 * i)
		_module("tree_%d" % i, s, true, "tree")
	var light := _sink()
	Kit.street_light(light, 9.0, false)
	_module("light", light)
	var kinds := ["hatch", "hatch", "sedan", "suv", "hatch", "sedan"]
	for i in 6:
		var s := _sink()
		Kit.car(s, Kit.CAR_PAINT[i + 1], kinds[i])
		_module("car_%d" % i, s, true, "box")
	var auto := _sink()
	Kit.auto_rickshaw(auto)
	_module("auto", auto, true, "box")
	var bus := _sink()
	Kit.bus(bus)
	_module("bus", bus, true, "box")
	for i in 2:
		var s := _sink()
		Kit.scooter(s, Kit.BOARDS[i * 3])
		_module("scooter_%d" % i, s)
	for i in 2:
		var s := _sink()
		Kit.handcart(s, rng)
		_module("cart_%d" % i, s)
	for i in 8:
		var s := _sink()
		Kit.person(s, rng, {})
		_module("person_%d" % i, s)
	var stop := _sink()
	Kit.bus_stop(stop)
	_module("busstop", stop)
	var pole := _sink()
	pole.cyl("matte", Color("#8c8a84"), Vector3(0, 4.0, 0), 0.13, 8.0, Geo.SEG_SMALL, 0.7)
	pole.box("metal", Color("#3a3f44"), Vector3(0, 7.3, 0), Vector3(1.4, 0.08, 0.08))
	pole.box("satin", Color("#6b6f72"), Vector3(0.3, 5.6, 0), Vector3(0.5, 0.7, 0.4))
	_module("pole", pole)
	var wire := _sink()
	for k in 3:
		wire.wire("metal", Color("#141414"), Vector3(0, 7.3 - k * 0.25, -0.5 + k * 0.5), Vector3(25.0, 7.3 - k * 0.25, -0.5 + k * 0.5), 0.45 + 0.1 * k)
	_module("wire", wire, false)


func _mod(name: String) -> int:
	return (by_name[name] as Module).id


# ------------------------------------------------------------------ world data


func build_data(which: String) -> void:
	layout = which
	rng.seed = SEED
	_build_modules()
	if which == "kit":
		half = 250.0
		cells_per_tile = 1
		cells_per_district = 4
		_kit_block()
	else:
		half = 1000.0
		cells_per_tile = 2
		cells_per_district = 4
		_city()
	var inst := props.size()
	var tris := 0
	for b in buildings:
		inst += b.mods.size()
		tris += 12 * (5 + b.floors)
		for m in b.mods:
			tris += modules[m[0]].tris
	var counts := {}
	var used := {}
	for b in buildings:
		for m in b.mods:
			used[m[0]] = true
	for p in props:
		used[p[0]] = true
		tris += modules[p[0]].tris
		var base: String = modules[p[0]].name.get_slice("_", 0)
		counts[base] = int(counts.get(base, 0)) + 1
	var vehicles := 0
	for k in ["car", "auto", "bus", "scooter", "cart"]:
		vehicles += int(counts.get(k, 0))
	stats = {
		"layout": layout, "sizeM": half * 2.0, "buildings": buildings.size(), "vehicles": vehicles,
		"props": props.size(), "trees": int(counts.get("tree", 0)), "lights": int(counts.get("light", 0)),
		"people": int(counts.get("person", 0)), "modules": modules.size(), "moduleInstances": inst,
		"worldTriangles": tris, "cells": int(pow(half * 2.0 / CELL, 2)), "modulesUsed": used.size(),
	}


func cell_of(p: Vector3) -> Vector2i:
	var n := int(half * 2.0 / CELL)
	return Vector2i(clampi(int(floor((p.x + half) / CELL)), 0, n - 1), clampi(int(floor((p.z + half) / CELL)), 0, n - 1))


func _prop(name: String, p: Vector3, yaw: float) -> void:
	props.append([_mod(name), Kit.at(p, yaw), cell_of(p)])


func _ground_box(cell: Vector2i, key: String, col: Color, c: Vector3, sz: Vector3) -> void:
	ground.append([cell, key, col, c, sz])


## A row of buildings: fronts on a line from start along the frame's local +X (the frame faces -Z at yaw 0).
func _row(start: Vector3, yaw: float, length: float, o: Dictionary) -> void:
	var u := 0.0
	var frame := Kit.at(start, yaw)
	while true:
		var bays := rng.randi_range(o.get("bmin", 2), o.get("bmax", 4))
		var w := bays * BAY
		if u + w > length:
			bays = int((length - u) / BAY)
			w = bays * BAY
			if bays < 1:
				break
		var b := Building.new()
		b.w = w
		b.d = rng.randf_range(o.get("dmin", 12.0), o.get("dmax", 16.0))
		b.floors = rng.randi_range(o.get("fmin", 2), o.get("fmax", 5))
		b.col = Kit.pick(rng, Kit.FACADES)
		b.board = Kit.pick(rng, Kit.BOARDS)
		b.cabin = rng.randf() < 0.4
		b.xf = frame * Transform3D(Basis.IDENTITY, Vector3(u + w * 0.5, 0, 0))
		b.cell = cell_of(b.xf * Vector3(0, 0, b.d * 0.5))
		_facade(b, bays, o)
		buildings.append(b)
		u += w


func _facade(b: Building, bays: int, o: Dictionary) -> void:
	var tight: bool = o.get("tight", false)
	var h := b.floors * FLOOR_H + 0.4
	var board := rng.randi_range(0, 5)
	for k in bays:
		var x := -b.w * 0.5 + BAY * (k + 0.5)
		if o.get("shops", true):
			b.mods.append([_mod("bay_%d" % rng.randi_range(0, 5)), Transform3D(Basis.IDENTITY, Vector3(x, 0, 0))])
			b.mods.append([_mod("board_%d" % board), Transform3D(Basis.IDENTITY, Vector3(x, 0, 0))])
			if rng.randf() < o.get("awning", 0.2):
				b.mods.append([_mod("awning_%d" % rng.randi_range(0, 2)), Transform3D(Basis.IDENTITY, Vector3(x, 0, 0))])
	var win := rng.randi_range(0, 3)
	for f in range(1 if o.get("shops", true) else 0, b.floors):
		var y := f * FLOOR_H + 0.4
		for k in bays:
			var x := -b.w * 0.5 + BAY * (k + 0.5)
			b.mods.append([_mod("win_%d" % win), Transform3D(Basis.IDENTITY, Vector3(x, y + 1.5, 0))])
			if rng.randf() < 0.25:
				b.mods.append([_mod("ac"), Transform3D(Basis.IDENTITY, Vector3(x + 0.95, y + 1.0, 0))])
		if rng.randf() < o.get("balcony", 0.35):
			var bx := -b.w * 0.5 + BAY * (rng.randi_range(0, bays - 1) + 0.5)
			var lau := 1 if tight and rng.randf() < 0.5 else 0
			b.mods.append([_mod("balcony_%d" % lau), Transform3D(Basis.IDENTITY, Vector3(bx, y, 0))])
	if tight and b.floors > 2 and rng.randf() < 0.6:
		b.mods.append([_mod("board2_%d" % rng.randi_range(0, 2)), Transform3D(Basis.IDENTITY, Vector3(rng.randf_range(-0.3, 0.3), 0, 0))])
	if rng.randf() < 0.7:
		b.mods.append([_mod("tank"), Transform3D(Basis.IDENTITY, Vector3(rng.randf_range(-b.w * 0.3, b.w * 0.3), h + 0.15, b.d * 0.6))])


## The shell of one building into a sink (world coordinates): body, plinth, floor bands, parapets, stair cabin.
func _shell(s: Geo.Sink, b: Building) -> void:
	var h := b.floors * FLOOR_H + 0.4
	s.push(b.xf)
	s.box("matte", b.col, Vector3(0, h * 0.5, b.d * 0.5), Vector3(b.w - 0.05, h, b.d))
	s.box("matte", Kit.shade(b.col, 0.62), Vector3(0, 0.25, -0.02), Vector3(b.w - 0.05, 0.5, 0.06))
	for f in range(1, b.floors):
		s.box("matte", Kit.shade(b.col, 0.85), Vector3(0, f * FLOOR_H + 0.4, -0.06), Vector3(b.w + 0.05, 0.18, 0.14))
	s.box("matte", Kit.shade(b.col, 0.92), Vector3(0, h + 0.45, 0.1), Vector3(b.w - 0.05, 0.9, 0.2))
	s.box("matte", Kit.shade(b.col, 0.92), Vector3(0, h + 0.45, b.d - 0.1), Vector3(b.w - 0.05, 0.9, 0.2))
	if b.cabin:
		s.box("matte", Kit.shade(b.col, 0.95), Vector3(-b.w * 0.2, h + 1.2, b.d * 0.75), Vector3(2.2, 2.4, 2.4))
	s.pop()


## Mid LOD of one building: dark window strips per floor, the board strip and the shop strip.
func _shell_mid(s: Geo.Sink, b: Building) -> void:
	s.push(b.xf)
	s.box("matte", Color("#4a3a2c"), Vector3(0, 1.45, -0.03), Vector3(b.w - 0.5, 2.7, 0.05))
	s.box("satin", b.board, Vector3(0, 3.35, -0.1), Vector3(b.w - 0.25, 0.95, 0.12))
	for f in range(1, b.floors):
		s.box("glass", Kit.GLASS, Vector3(0, f * FLOOR_H + 1.9, -0.03), Vector3(b.w - 0.9, 1.45, 0.05))
	s.pop()


## Far LOD of one building: the body box only.
func _shell_far(s: Geo.Sink, b: Building) -> void:
	var h := b.floors * FLOOR_H + 0.4
	s.push(b.xf)
	s.box("matte", b.col, Vector3(0, h * 0.5, b.d * 0.5), Vector3(b.w - 0.05, h, b.d))
	s.pop()


func _city() -> void:
	var n := int(half * 2.0 / CELL)
	var road_half := 5.5
	var edge := 8.5
	for j in n:
		for i in n:
			var x0 := -half + i * CELL + edge
			var z0 := -half + j * CELL + edge
			var x1 := x0 + CELL - 2.0 * edge
			var z1 := z0 + CELL - 2.0 * edge
			var cell := Vector2i(i, j)
			var ring := maxi(absi(2 * i - n + 1), absi(2 * j - n + 1)) / 2
			var kind := "dense" if ring < 3 else ("row" if ring < 5 else ("sparse" if rng.randf() < 0.6 else "park"))
			var cx := (x0 + x1) * 0.5
			var cz := (z0 + z1) * 0.5
			# asphalt under the whole cell, the raised block (footpath and interior) and the street centre lines
			_ground_box(cell, "road", Kit.ASPHALT, Vector3(cx, -0.1, cz), Vector3(CELL, 0.2, CELL))
			var top: Color = Kit.PAVER if kind in ["dense", "row"] else (Kit.GRASS if kind == "park" else Kit.DIRT)
			_ground_box(cell, "matte", top, Vector3(cx, 0.085, cz), Vector3(CELL - 2.0 * road_half, 0.17, CELL - 2.0 * road_half))
			_ground_box(cell, "road", Kit.MARK, Vector3(cx, 0.005, z0 - edge), Vector3(CELL - 24.0, 0.01, 0.15))
			_ground_box(cell, "road", Kit.MARK, Vector3(x0 - edge, 0.005, cz), Vector3(0.15, 0.01, CELL - 24.0))
			var len_x := x1 - x0
			var len_z := z1 - z0
			match kind:
				"dense":
					var o := {"fmin": 3, "fmax": 5, "awning": 0.35}
					_row(Vector3(x0, 0.17, z0), 0.0, len_x, o)
					_row(Vector3(x1, 0.17, z1), PI, len_x, o)
					_row(Vector3(x1, 0.17, z0 + 16.0), -PI * 0.5, len_z - 32.0, o)
					_row(Vector3(x0, 0.17, z1 - 16.0), PI * 0.5, len_z - 32.0, o)
				"row":
					var o := {"fmin": 2, "fmax": 4}
					_row(Vector3(x0, 0.17, z0), 0.0, len_x, o)
					_row(Vector3(x1, 0.17, z1), PI, len_x, o)
				"sparse":
					var o := {"bmin": 6, "bmax": 9, "fmin": 3, "fmax": 8, "dmin": 18.0, "dmax": 26.0, "shops": false, "balcony": 0.1}
					_row(Vector3(x0 + 10.0, 0.17, z0 + 8.0), 0.0, len_x - 20.0, o)
					_row(Vector3(x1 - 10.0, 0.17, z1 - 8.0), PI, len_x - 20.0, o)
			_street_props(kind, x0, z0, x1, z1)


func _street_props(kind: String, x0: float, z0: float, x1: float, z1: float) -> void:
	var len_x := x1 - x0
	# street lights at the kerb of the north and south footpaths
	for k in 3:
		var x := x0 + len_x * (k + 0.5) / 3.0
		_prop("light", Vector3(x, 0.17, z0 - 2.6), 0.0)
		_prop("light", Vector3(x + 18.0, 0.17, z1 + 2.6), PI)
	var trees := 4 if kind == "dense" else (10 if kind != "park" else 6)
	for k in trees:
		var t := (k + 0.5) / trees
		if k % 2 == 0:
			_prop("tree_%d" % rng.randi_range(0, 2), Vector3(x1 + 1.6, 0.17, lerpf(z0, z1, t)), rng.randf_range(0, TAU))
		else:
			_prop("tree_%d" % rng.randi_range(0, 2), Vector3(x0 - 1.6, 0.17, lerpf(z0, z1, t)), rng.randf_range(0, TAU))
	if kind == "park":
		for k in 26:
			_prop("tree_%d" % rng.randi_range(0, 2), Vector3(rng.randf_range(x0 + 6, x1 - 6), 0.17, rng.randf_range(z0 + 6, z1 - 6)), rng.randf_range(0, TAU))
	var cars := 5 if kind in ["dense", "row"] else (2 if kind == "sparse" else 1)
	for k in cars:
		var t := (k + rng.randf_range(0.2, 0.8)) / cars
		_prop("car_%d" % rng.randi_range(0, 5), Vector3(lerpf(x0, x1, t), 0.0, z0 - 4.1), PI * 0.5)
		_prop("car_%d" % rng.randi_range(0, 5), Vector3(lerpf(x0, x1, t) + 3.0, 0.0, z1 + 4.1), -PI * 0.5)
	if kind in ["dense", "row"]:
		_prop("auto", Vector3(x1 + 4.0, 0.0, lerpf(z0, z1, rng.randf_range(0.2, 0.8))), 0.0)
		for k in 4:
			_prop("scooter_%d" % rng.randi_range(0, 1), Vector3(lerpf(x0, x1, rng.randf()), 0.17, z0 - 2.2), rng.randf_range(-0.3, 0.3))
		var people := 12 if kind == "dense" else 6
		for k in people:
			var north := rng.randf() < 0.5
			_prop("person_%d" % rng.randi_range(0, 7), Vector3(lerpf(x0, x1, rng.randf()), 0.17, (z0 - rng.randf_range(0.6, 2.0)) if north else (z1 + rng.randf_range(0.6, 2.0))),
				rng.randf_range(0, TAU))
	if kind == "dense":
		for k in 2:
			_prop("cart_%d" % rng.randi_range(0, 1), Vector3(lerpf(x0, x1, rng.randf()), 0.0, z1 + 3.6), PI * 0.5)
	if kind == "row" and rng.randf() < 0.3:
		_prop("bus", Vector3(x0 + 30.0, 0.0, z0 - 4.6), PI * 0.5)
		_prop("busstop", Vector3(x0 + 40.0, 0.17, z0 - 1.6), PI)


## The dense old city block: east-west lanes every 25 m (5 m wide), cross lanes every 62.5 m, houses back to back.
func _kit_block() -> void:
	var n := int(half * 2.0 / CELL)
	for j in n:
		for i in n:
			var c := Vector3(-half + (i + 0.5) * CELL, 0, -half + (j + 0.5) * CELL)
			_ground_box(Vector2i(i, j), "road", Kit.shade(Kit.ASPHALT, 1.15), c + Vector3(0, -0.1, 0), Vector3(CELL, 0.2, CELL))
	var lanes := int(half * 2.0 / 25.0)
	var o := {"bmin": 1, "bmax": 2, "fmin": 3, "fmax": 5, "dmin": 9.6, "dmax": 10.0, "tight": true, "awning": 0.45, "balcony": 0.55}
	for l in lanes:
		var zc := -half + 12.5 + l * 25.0
		var x := -half
		while x < half - 1.0:
			var x_end := minf(x + 62.5 - 4.0, half)
			# north side of the lane faces south (+Z), south side faces north
			_row(Vector3(x_end, 0.0, zc - 2.5), PI, x_end - x, o)
			_row(Vector3(x, 0.0, zc + 2.5), 0.0, x_end - x, o)
			# poles, wires, scooters, carts and people along this piece of lane
			for k in 2:
				var px := x + 4.0 + k * 25.0
				_prop("pole", Vector3(px, 0.0, zc - 2.2), 0.0)
				_prop("wire", Vector3(px, 0.0, zc - 2.2), 0.0)
			for k in 3:
				_prop("scooter_%d" % rng.randi_range(0, 1), Vector3(rng.randf_range(x, x_end), 0.0, zc + rng.randf_range(1.5, 2.0)), rng.randf_range(1.2, 1.9))
			if rng.randf() < 0.6:
				_prop("cart_%d" % rng.randi_range(0, 1), Vector3(rng.randf_range(x, x_end), 0.0, zc - 1.3), PI * 0.5)
			for k in 7:
				_prop("person_%d" % rng.randi_range(0, 7), Vector3(rng.randf_range(x, x_end), 0.0, zc + rng.randf_range(-1.6, 1.6)), rng.randf_range(0, TAU))
			x += 62.5


# ------------------------------------------------------------------ drawing


## Adds the world under root in the given mode ("i1", "i2", "i3"), with or without LOD ranges. Returns node counts.
## The grime value `wear` is a per-instance shader uniform of the look's surface shader, and the engine has room for
## about 4096 instances that use one (rendering/limits/global_shader_variables/buffer_size 65536, 16 slots each).
## Measured here: setting it on the 5615 module MultiMeshes of i3 overflows the buffer ("Too many instances using
## shader instance variables"), and so do the 12000 MeshInstance3D nodes of i1 whether they set it or not. So only
## ground, shells, LOD meshes and merged tiles set it; module MultiMeshes draw with wear 0 (no grime), and the i1
## row carries the engine error. The real game needs another carrier for wear on instanced modules.
func realise(root: Node3D, mode: String, lod: bool, wear: float) -> Dictionary:
	var out := {"mode": mode, "lod": lod, "nodes": 0, "meshInstances": 0, "multiMeshes": 0, "uniqueMeshes": 0}
	var tile_of := func(c: Vector2i) -> Vector2i: return Vector2i(c.x / cells_per_tile, c.y / cells_per_tile)
	# ground, always per tile and always visible
	var g := {}
	for e in ground:
		var t: Vector2i = tile_of.call(e[0])
		if not g.has(t):
			g[t] = _sink()
		(g[t] as Geo.Sink).box(e[1], e[2], e[3], e[4])
	for t in g:
		var m := Merge.new()
		m.add_sink(g[t])
		_add_mesh(root, "Ground_%d_%d" % [t.x, t.y], m.to_mesh(mats), wear, out, false)
	match mode:
		"i1":
			_realise_i1(root, wear, out)
		"i2":
			_realise_i2(root, wear, out, tile_of)
		_:
			_realise_i3(root, wear, out, tile_of, lod)
	return out


func _add_mesh(root: Node3D, name: String, mesh: ArrayMesh, wear: float, out: Dictionary, shadow := true) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.name = name
	mi.mesh = mesh
	mi.set_instance_shader_parameter("wear", wear)
	if not shadow:
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(mi)
	out.nodes += 1
	out.meshInstances += 1
	out.uniqueMeshes += 1
	return mi


func _realise_i1(root: Node3D, wear: float, out: Dictionary) -> void:
	var k := 0
	for b in buildings:
		var s := _sink()
		_shell(s, b)
		var m := Merge.new()
		m.add_sink(s)
		for e in b.mods:
			m.add_module(modules[e[0]], b.xf * (e[1] as Transform3D))
		_add_mesh(root, "B%d" % k, m.to_mesh(mats), wear, out)
		k += 1
	for p in props:
		var mi := MeshInstance3D.new()
		mi.mesh = modules[p[0]].mesh
		mi.transform = p[1]
		root.add_child(mi)
		out.nodes += 1
		out.meshInstances += 1


func _realise_i2(root: Node3D, wear: float, out: Dictionary, tile_of: Callable) -> void:
	# two meshes per tile: shadow casters, and flat facade parts that cast none (the same split i3 uses)
	var cast := {}
	var flat := {}
	for b in buildings:
		var t: Vector2i = tile_of.call(b.cell)
		if not cast.has(t):
			cast[t] = [Merge.new(), _sink()]
			flat[t] = Merge.new()
		_shell(cast[t][1], b)
		for e in b.mods:
			var mod := modules[e[0]]
			((cast[t][0] if mod.shadow else flat[t]) as Merge).add_module(mod, b.xf * (e[1] as Transform3D))
	for p in props:
		var t: Vector2i = tile_of.call(p[2])
		if not cast.has(t):
			cast[t] = [Merge.new(), _sink()]
			flat[t] = Merge.new()
		var mod := modules[p[0]]
		((cast[t][0] if mod.shadow else flat[t]) as Merge).add_module(mod, p[1])
	for t in cast:
		var m: Merge = cast[t][0]
		m.add_sink(cast[t][1])
		_add_mesh(root, "Tile_%d_%d" % [t.x, t.y], m.to_mesh(mats), wear, out)
		if not (flat[t] as Merge).is_empty():
			_add_mesh(root, "TileFlat_%d_%d" % [t.x, t.y], (flat[t] as Merge).to_mesh(mats), wear, out, false)


func _realise_i3(root: Node3D, wear: float, out: Dictionary, tile_of: Callable, lod: bool) -> void:
	var shells := {}
	var cells := {}
	var mids := {}
	var fars := {}
	for b in buildings:
		var t: Vector2i = tile_of.call(b.cell)
		if not shells.has(t):
			shells[t] = _sink()
		_shell(shells[t], b)
		if not cells.has(b.cell):
			cells[b.cell] = {}
		for e in b.mods:
			var list: Array = cells[b.cell].get_or_add(e[0], [])
			list.append(b.xf * (e[1] as Transform3D))
		if lod:
			if not mids.has(b.cell):
				mids[b.cell] = _sink()
			_shell_mid(mids[b.cell], b)
			var d := Vector2i(b.cell.x / cells_per_district, b.cell.y / cells_per_district)
			if not fars.has(d):
				fars[d] = _sink()
			_shell_far(fars[d], b)
	for p in props:
		var cell: Vector2i = p[2]
		if not cells.has(cell):
			cells[cell] = {}
		var list: Array = cells[cell].get_or_add(p[0], [])
		list.append(p[1])
		var mod := modules[p[0]]
		if lod and mod.mid != "":
			if not mids.has(cell):
				mids[cell] = _sink()
			var s: Geo.Sink = mids[cell]
			s.push(p[1])
			if mod.mid == "tree":
				s.ball("leaf", Kit.LEAF, Vector3(0, mod.size.y * 0.72, 0), Vector3(mod.size.x * 0.42, mod.size.y * 0.3, mod.size.z * 0.42), Geo.SEG_THIN)
				s.box("matte", Kit.TRUNK, Vector3(0, mod.size.y * 0.25, 0), Vector3(0.3, mod.size.y * 0.5, 0.3))
			else:
				s.box("paint", Color("#8e9294"), Vector3(0, mod.size.y * 0.5, 0), Vector3(mod.size.x, mod.size.y * 0.9, mod.size.z))
			s.pop()
	for t in shells:
		var m := Merge.new()
		m.add_sink(shells[t])
		var mi := _add_mesh(root, "Shell_%d_%d" % [t.x, t.y], m.to_mesh(mats), wear, out)
		if lod:
			mi.visibility_range_end = R2
			mi.visibility_range_end_margin = 20.0
	for cell in cells:
		for id in cells[cell]:
			var mod := modules[id]
			var xfs: Array = cells[cell][id]
			var mm := MultiMesh.new()
			mm.transform_format = MultiMesh.TRANSFORM_3D
			mm.mesh = mod.mesh
			mm.instance_count = xfs.size()
			for k in xfs.size():
				mm.set_instance_transform(k, xfs[k])
			var mmi := MultiMeshInstance3D.new()
			mmi.name = "C%d_%d_%s" % [cell.x, cell.y, mod.name]
			mmi.multimesh = mm
			if not mod.shadow:
				mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			if lod:
				mmi.visibility_range_end = R1
				mmi.visibility_range_end_margin = 10.0
			root.add_child(mmi)
			out.nodes += 1
			out.multiMeshes += 1
	for cell in mids:
		var m := Merge.new()
		m.add_sink(mids[cell])
		var mi := _add_mesh(root, "Mid_%d_%d" % [cell.x, cell.y], m.to_mesh(mats), wear, out, false)
		mi.visibility_range_begin = R1
		mi.visibility_range_begin_margin = 10.0
		mi.visibility_range_end = R2
		mi.visibility_range_end_margin = 20.0
	for d in fars:
		var m := Merge.new()
		m.add_sink(fars[d])
		var mi := _add_mesh(root, "Far_%d_%d" % [d.x, d.y], m.to_mesh(mats), wear, out, false)
		mi.visibility_range_begin = R2
		mi.visibility_range_begin_margin = 20.0


## OC1: one occluder per tile made from the building body boxes (8 corners, 12 triangles each).
func add_occluders(root: Node3D) -> int:
	var per := {}
	for b in buildings:
		var t := Vector2i(b.cell.x / cells_per_tile, b.cell.y / cells_per_tile)
		if not per.has(t):
			per[t] = [PackedVector3Array(), PackedInt32Array()]
		var v: PackedVector3Array = per[t][0]
		var idx: PackedInt32Array = per[t][1]
		var h := b.floors * FLOOR_H + 0.4
		var base := v.size()
		for y in [0.0, h]:
			for c in [Vector3(-0.5, 0, 0), Vector3(0.5, 0, 0), Vector3(0.5, 0, 1), Vector3(-0.5, 0, 1)]:
				v.append(b.xf * Vector3(c.x * (b.w - 0.05), y, c.z * b.d))
		for q in [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]]:
			for k in [0, 1, 2, 0, 2, 3]:
				idx.append(base + q[k])
		per[t] = [v, idx]
	for t in per:
		var occ := ArrayOccluder3D.new()
		occ.set_arrays(per[t][0], per[t][1])
		var oi := OccluderInstance3D.new()
		oi.name = "Occluder_%d_%d" % [t.x, t.y]
		oi.occluder = occ
		root.add_child(oi)
	return per.size()
