## The spawn pins of the city scene (game/data/spawn_pins.json, P1-024): named WGS84 points with a compass heading and
## the vehicle the player starts in. `pick(id)` resolves the --spawn arg: "" is the file's default, an unknown id is
## reported (a log line) and falls back to the default. Pure apart from reading the file, so it is unit tested.
extends RefCounted

const PATH := "res://data/spawn_pins.json"
## Vehicle names of a pin to their tune files (game/data/vehicles/).
const VEHICLES := {
	"car": "res://data/vehicles/car.tres",
	"auto": "res://data/vehicles/auto.tres",
	"scooter": "res://data/vehicles/scooter.tres",
	"patrol_car": "res://data/vehicles/patrol_car.tres",
}


## The parsed file: {default, pins: {id: {name, lat, lon, headingDeg, vehicle}}}, or {} when it cannot be read.
static func load_all(path := PATH) -> Dictionary:
	var text := FileAccess.get_file_as_string(path)
	if text == "":
		return {}
	var data: Variant = JSON.parse_string(text)
	return data if data is Dictionary and (data as Dictionary).get("pins") is Dictionary else {}


## The pin for a --spawn value: {id, name, lat, lon, heading (compass radians), tune (res:// path)}, or {} when the file
## has no such pin and no default.
static func pick(id: String, data: Dictionary = {}) -> Dictionary:
	var all := data if not data.is_empty() else load_all()
	if all.is_empty():
		return {}
	var pins: Dictionary = all.pins
	var want := id if id != "" else str(all.get("default", ""))
	if not pins.has(want):
		if id != "":
			print("game: unknown --spawn=%s (pins: %s), using %s" % [id, ", ".join(pins.keys()), all.get("default", "")])
		want = str(all.get("default", ""))
		if not pins.has(want):
			return {}
	var p: Dictionary = pins[want]
	return {
		"id": want, "name": str(p.get("name", want)), "lat": float(p.lat), "lon": float(p.lon),
		"heading": deg_to_rad(float(p.get("headingDeg", 0.0))),
		"tune": VEHICLES.get(str(p.get("vehicle", "")), ""),
	}
