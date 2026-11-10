## Percentile stats for the debug perf(ms) hook. Pure, unit tested in game/tests/test_debug.gd.
extends RefCounted


## {p50, p95, max} of a list of numbers (all 0 for an empty list). Nearest rank: index floor(f * n), clamped.
static func stats(values: Array) -> Dictionary:
	if values.is_empty():
		return {"p50": 0.0, "p95": 0.0, "max": 0.0}
	var s := values.duplicate()
	s.sort()
	var q := func(f: float) -> float: return float(s[mini(s.size() - 1, int(floor(f * s.size())))])
	return {"p50": q.call(0.5), "p95": q.call(0.95), "max": float(s[s.size() - 1])}


static func mean(values: Array) -> float:
	if values.is_empty():
		return 0.0
	var sum := 0.0
	for v in values:
		sum += float(v)
	return sum / values.size()
