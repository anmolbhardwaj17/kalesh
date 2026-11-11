## The day-night curve (STYLE_OPTIONS.md batch B, the signed look's lights): one continuous sun, sky, fog, exposure and
## night-lights curve through the hours, built from the light presets as keys (game/render/styles/light_<id>.tres).
## The game's day clock (game/core/day_clock.gd) picks the hour; --time=<0..24> pins one. --light=<id> is the key
## itself, so a preset and its hour look the same.
## The directional light is the sun by day and a faint moon by night; the change happens at dusk and before dawn,
## where the light is nearly off. Pure (no nodes): tested in game/tests/test_style.gd.
extends RefCounted

const DIR := "res://render/styles/"
## [hour, light preset id] in order; the first and last hours wrap round midnight.
const KEYS := [[0.0, "night"], [4.6, "night"], [6.3, "dawn"], [15.0, "afternoon"], [17.75, "golden"], [19.0, "dusk"],
	[20.5, "night"], [24.0, "night"]]
## The hour each --light preset stands for.
const PRESET_HOURS := {"dawn": 6.3, "afternoon": 15.0, "golden": 17.75, "night": 22.0}

static var _cache := {}


static func key(id: String) -> Resource:
	if not _cache.has(id):
		_cache[id] = load(DIR + "light_" + id + ".tres")
	return _cache[id]


## The light preset for an hour of the day (wrapped into 0..24).
static func at(hour: float) -> Resource:
	var h := fposmod(hour, 24.0)
	for i in KEYS.size() - 1:
		var a: Array = KEYS[i]
		var b: Array = KEYS[i + 1]
		if h >= a[0] and h <= b[0]:
			var t: float = 0.0 if b[0] == a[0] else (h - a[0]) / (b[0] - a[0])
			# on a key hour the preset itself (a blend at 0 or 1 can be one float step off it): --time=17.75 and
			# --light=golden, and the day clock's 15:00 start and the afternoon preset, are the same look
			if t <= 0.0:
				return key(a[1]).duplicate()
			if t >= 1.0:
				return key(b[1]).duplicate()
			return blend(key(a[1]), key(b[1]), smoothstep(0.0, 1.0, t))
	return key("night").duplicate()


## A new preset between a (t = 0) and b (t = 1): numbers, colours and vectors blend, the sun azimuth takes the short
## way round the compass.
static func blend(a: Resource, b: Resource, t: float) -> Resource:
	var out: Resource = a.duplicate()
	for p in a.get_property_list():
		if not (p.usage & PROPERTY_USAGE_SCRIPT_VARIABLE):
			continue
		var n: String = p.name
		var va: Variant = a.get(n)
		var vb: Variant = b.get(n)
		if n == "sun_azimuth_deg":
			out.set(n, fposmod(rad_to_deg(lerp_angle(deg_to_rad(va), deg_to_rad(vb), t)), 360.0))
		elif va is float:
			out.set(n, lerpf(va, vb, t))
		elif va is Color:
			out.set(n, (va as Color).lerp(vb, t))
		elif va is Vector3:
			out.set(n, (va as Vector3).lerp(vb, t))
	return out
