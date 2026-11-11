## Autoload DayClock: the game time of day (hours 0..24) on the sim clock. It starts at 15:00, the hot hazy afternoon
## the slice opens in, and advances `rate` game hours per sim second on SimClock.sim_tick, so the time scale and the
## sim hold reach it like every other system. The look follows it: the style runner (game/render/style_runner.gd)
## builds the light from the day curve (game/render/day_cycle.gd) at this hour whenever a scene loads.
## Pinned (game args --time=<h> or --light=<preset>, or the debug hook timeOfDay({pin: true})): the hour stands still,
## so look proofs and verify shots are the same every run.
## Pure parts (start, advance) are tested in game/tests/test_style.gd.
extends Node

const DayCycle := preload("res://render/day_cycle.gd")
const START_HOUR := 15.0
## Game hours per sim second: one game hour in two minutes, a 48 minute day (decisions.md "Day clock").
const DEFAULT_RATE := 1.0 / 120.0

var hour := START_HOUR
var rate := DEFAULT_RATE
var pinned := false


## The start {hour, pinned} for the game args: --time=<h> pins that hour, --light=<preset> pins the preset's hour
## (day_cycle.gd PRESET_HOURS; an unknown preset is the afternoon the style runner falls back to), neither starts
## at START_HOUR and runs. Pure.
static func start(light: String, time: String) -> Dictionary:
	if time != "" and time.is_valid_float():
		return {"hour": fposmod(float(time), 24.0), "pinned": true}
	if light != "":
		return {"hour": float(DayCycle.PRESET_HOURS.get(light, START_HOUR)), "pinned": true}
	return {"hour": START_HOUR, "pinned": false}


## The hour after dt sim seconds at rate (wrapped into 0..24). Pure.
static func advanced(h: float, dt: float, r: float) -> float:
	return fposmod(h + dt * r, 24.0)


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	var args := get_node_or_null("/root/GameArgs")
	if args != null:
		var s := start(args.light, args.time)
		hour = s.hour
		pinned = s.pinned
	var clock := get_node_or_null("/root/SimClock")
	if clock != null:
		clock.sim_tick.connect(advance)


## One sim tick of dt seconds (a pinned clock stands still).
func advance(dt: float) -> void:
	if not pinned:
		hour = advanced(hour, dt, rate)


## Sets any of {hour, rate, pin} (pin true stops the clock, false lets it run). Returns state().
func set_time(opts: Dictionary) -> Dictionary:
	if opts.has("hour") and opts.hour != null:
		hour = fposmod(float(opts.hour), 24.0)
	if opts.has("rate") and opts.rate != null:
		rate = maxf(0.0, float(opts.rate))
	if opts.has("pin") and opts.pin != null:
		pinned = bool(opts.pin)
	return state()


## "15:00" for an hour of the day.
static func label(h: float) -> String:
	var m := int(round(fposmod(h, 24.0) * 60.0)) % (24 * 60)
	return "%02d:%02d" % [floori(m / 60.0), m % 60]


func state() -> Dictionary:
	return {"hour": hour, "clock": label(hour), "rate": rate, "pinned": pinned}
