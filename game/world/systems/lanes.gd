## Streamed system: the lane graph of the loaded tiles, held as data for the later traffic and pursuit (TECH.md "Tile
## format": lane pieces `<lane>:<k>` cut at the tile lines, with `next` and `back` ids that cross tiles). It draws
## nothing and has no physics. Points are world metres. A piece whose `next` id is not here yet belongs to a tile
## that is not loaded.
## Budget: one data step a tile, off the mesh and collider lanes.
extends RefCounted

const TileReader := preload("res://world/streaming/tile_reader.gd")

## Every mode, for pieces of tiles baked before P2-042.
const ALL_MODES := ["car", "auto", "two_wheeler", "cycle", "foot", "emergency"]
## Side of a cell of the piece grid (near(), closest()), metres.
const CELL := 32.0

var id := "lanes"
var lane := "data"
var exclusive := false
var per_frame := 0
var budget_ms := 0.3
## Piece id -> {id, of, kind, cls, layer, width, next, back, modes, private, tile: Vector2i, pts: PackedVector3Array, length,
## cells (the grid cells it passes through)}.
## `modes` (P2-042): who may use the piece (car, auto, two_wheeler, cycle, foot, emergency); tiles baked before have
## none and allow every vehicle mode.
var pieces := {}
## A coarse grid over the loaded pieces (P2-045): cell key -> the ids of the pieces that pass through it, so a lookup
## near a point (the access watch, the route line, traffic spawns) reads a few cells, not every piece.
var _grid := {}


## Worker thread: the tile's pieces with their points moved to world metres (a few hundred points a tile).
func prepare(tile: Dictionary) -> Variant:
	var out: Array[Dictionary] = []
	var head: Variant = tile.header.get("lanes")
	if typeof(head) != TYPE_DICTIONARY or not (head as Dictionary).has("list"):
		return {"pieces": out, "on": false}
	var points := TileReader.lane_points(tile)
	var origin: Vector3 = tile.origin
	for l: Dictionary in head.list:
		var pts := points.slice(int(l.start), int(l.start) + int(l.count))
		var length := 0.0
		for i in pts.size():
			pts[i] += origin
			if i > 0:
				length += pts[i - 1].distance_to(pts[i])
		out.append({
			"id": str(l.id), "of": str(l.get("of", "")), "kind": str(l.get("kind", "lane")), "cls": str(l.get("cls", "")),
			"layer": int(l.get("layer", 0)), "width": float(l.get("widthM", 0.0)), "next": l.get("next", []), "back": l.get("back", []),
			"modes": l.get("modes", ALL_MODES), "private": bool(l.get("private", false)),
			"tile": tile.key, "pts": pts, "length": length, "cells": _cells_of(pts),
		})
	return {"pieces": out, "on": false}


func attach(_tile: Dictionary, part: Variant) -> bool:
	for p: Dictionary in part.pieces:
		if pieces.has(p.id):
			_grid_drop(pieces[p.id])
		pieces[p.id] = p
		_grid_add(p)
	part.on = true
	return true


func dispose(tile: Dictionary, part: Variant) -> bool:
	if part.on:
		for p: Dictionary in part.pieces:
			if pieces.has(p.id) and pieces[p.id].tile == tile.key:
				_grid_drop(pieces[p.id])
				pieces.erase(p.id)
	part.on = false
	part.pieces = [] as Array[Dictionary]
	return true


## True when `mode` (car, auto, two_wheeler, cycle, foot, emergency) may use the piece of this id (P2-042): traffic,
## the route line and missions keep to the pieces their mode may use.
func allows(piece_id: String, mode: String) -> bool:
	var p: Dictionary = pieces.get(piece_id, {})
	return not p.is_empty() and mode in (p.get("modes", ALL_MODES) as Array)


## The piece of an id, or {} when its tile is not loaded.
func piece(piece_id: String) -> Dictionary:
	return pieces.get(piece_id, {})


## Where a vehicle can start: the first point of the longest lane piece at grade (layer 0, a lane, not a junction
## path) with at least 2 points, in `tile` when given, heading along it. {pos, heading (compass radians, 0 north),
## lane, length_m}, or {} when there is none.
func spawn(tile: Variant = null) -> Dictionary:
	var best := {}
	for key: String in pieces:
		var p: Dictionary = pieces[key]
		if p.layer != 0 or p.kind != "lane" or (p.pts as PackedVector3Array).size() < 2 or (tile != null and p.tile != tile):
			continue
		if best.is_empty() or p.length > best.length or (is_equal_approx(p.length, best.length) and str(p.id) < str(best.id)):
			best = p
	if best.is_empty():
		return {}
	var pts: PackedVector3Array = best.pts
	var d := pts[mini(pts.size() - 1, 3)] - pts[0]
	return {"pos": pts[0], "heading": atan2(d.x, -d.z), "lane": str(best.id), "length_m": float(best.length)}


## Where a vehicle can start near a point (a spawn pin, P1-024): the nearest point on a lane piece at grade (layer 0,
## a lane, not a junction path) within `reach` metres whose direction there is within `max_turn` radians of `heading`
## (compass radians; NAN takes any direction). {pos, heading (along the lane there), lane, off_m}, or {} when none.
func snap(x: float, z: float, heading := NAN, reach := 60.0, max_turn := PI / 3.0) -> Dictionary:
	var best := {}
	var best_d := reach
	var at := Vector2(x, z)
	for key: String in pieces:
		var p: Dictionary = pieces[key]
		var pts: PackedVector3Array = p.pts
		if p.layer != 0 or p.kind != "lane" or pts.size() < 2:
			continue
		for i in pts.size() - 1:
			var a := Vector2(pts[i].x, pts[i].z)
			var b := Vector2(pts[i + 1].x, pts[i + 1].z)
			var ab := b - a
			if ab.length_squared() < 1e-6:
				continue
			var t := clampf((at - a).dot(ab) / ab.length_squared(), 0.0, 1.0)
			var d := at.distance_to(a + ab * t)
			if d >= best_d:
				continue
			var h := atan2(ab.x, -ab.y)
			if not is_nan(heading) and absf(wrapf(h - heading, -PI, PI)) > max_turn:
				continue
			best_d = d
			best = {"pos": pts[i].lerp(pts[i + 1], t), "heading": h, "lane": str(p.id), "off_m": d}
	return best


## The ids of the loaded pieces that pass within about `reach` metres of (x, z) (whole grid cells: a superset).
func near(x: float, z: float, reach: float) -> PackedStringArray:
	var out := PackedStringArray()
	var seen := {}
	var c0 := Vector2i(floori((x - reach) / CELL), floori((z - reach) / CELL))
	var c1 := Vector2i(floori((x + reach) / CELL), floori((z + reach) / CELL))
	for cx in range(c0.x, c1.x + 1):
		for cz in range(c0.y, c1.y + 1):
			for id: String in _grid.get(Vector2i(cx, cz), []):
				if not seen.has(id):
					seen[id] = true
					out.append(id)
	return out


## The nearest point on a loaded piece to (x, y, z) within `reach` metres (in plan), for which `accept(piece)` is true
## (an empty Callable takes every piece); a point more than `max_dy` above or below is left out (a deck over a road).
## {id, pos, d, i (segment start), heading (compass radians along the piece there), t (metres from the piece start)},
## or {} when none.
func closest(x: float, y: float, z: float, reach: float, accept := Callable(), max_dy := INF) -> Dictionary:
	var best := {}
	for id: String in near(x, z, reach):
		var p: Dictionary = pieces[id]
		if accept.is_valid() and not accept.call(p):
			continue
		var c := closest_on(id, x, y, z, max_dy)
		if not c.is_empty() and float(c.d) < reach and (best.is_empty() or float(c.d) < float(best.d)):
			best = c
	return best


## The nearest point of one piece to (x, y, z) in plan, the same fields as closest(); {} when the piece is not loaded
## or no point of it lies within `max_dy` in height.
func closest_on(id: String, x: float, y: float, z: float, max_dy := INF) -> Dictionary:
	var p: Dictionary = pieces.get(id, {})
	if p.is_empty():
		return {}
	var best := {}
	var best_d := INF
	var at := Vector2(x, z)
	var pts: PackedVector3Array = p.pts
	var run := 0.0
	for i in pts.size() - 1:
		var a := Vector2(pts[i].x, pts[i].z)
		var ab := Vector2(pts[i + 1].x, pts[i + 1].z) - a
		var l2 := ab.length_squared()
		var seg := sqrt(l2)
		if l2 > 1e-6:
			var f := clampf((at - a).dot(ab) / l2, 0.0, 1.0)
			var q := pts[i].lerp(pts[i + 1], f)
			var d := at.distance_to(Vector2(q.x, q.z))
			if d < best_d and absf(q.y - y) <= max_dy:
				best_d = d
				best = {"id": id, "pos": q, "d": d, "i": i, "heading": atan2(ab.x, -ab.y), "t": run + seg * f}
		run += seg
	return best


func info() -> Dictionary:
	return {"pieces": pieces.size()}


## The grid cells a piece passes through (worked out on the worker thread in prepare()).
static func _cells_of(pts: PackedVector3Array) -> Array[Vector2i]:
	var out: Array[Vector2i] = []
	var seen := {}
	for i in pts.size():
		var a := pts[i]
		var b := pts[mini(i + 1, pts.size() - 1)]
		for cx in range(floori(minf(a.x, b.x) / CELL), floori(maxf(a.x, b.x) / CELL) + 1):
			for cz in range(floori(minf(a.z, b.z) / CELL), floori(maxf(a.z, b.z) / CELL) + 1):
				var k := Vector2i(cx, cz)
				if not seen.has(k):
					seen[k] = true
					out.append(k)
	return out


func _grid_add(p: Dictionary) -> void:
	for k: Vector2i in p.cells:
		if not _grid.has(k):
			_grid[k] = []
		(_grid[k] as Array).append(p.id)


func _grid_drop(p: Dictionary) -> void:
	for k: Vector2i in p.cells:
		var ids: Array = _grid.get(k, [])
		ids.erase(p.id)
		if ids.is_empty():
			_grid.erase(k)
