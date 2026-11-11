## Small helpers of the physics bench (P0-017): statistics over timing samples and rounding for the report.
extends RefCounted


## {p50, p95, max, mean, n} of the samples times `scale` (for example 0.001 turns microseconds into ms).
static func stats(samples: PackedFloat64Array, scale: float = 1.0, digits: int = 4) -> Dictionary:
	var n := samples.size()
	if n == 0:
		return {"n": 0, "p50": null, "p95": null, "max": null, "mean": null}
	var s := samples.duplicate()
	s.sort()
	var sum := 0.0
	for v in s:
		sum += v
	return {
		"n": n,
		"p50": r(s[int((n - 1) * 0.5)] * scale, digits),
		"p95": r(s[int((n - 1) * 0.95)] * scale, digits),
		"max": r(s[n - 1] * scale, digits),
		"mean": r(sum / n * scale, digits),
	}


## {mean, std, p2p} of a series (wheel contact noise, position jitter), in the unit of the samples.
static func spread(samples: PackedFloat64Array, digits: int = 6) -> Dictionary:
	var n := samples.size()
	if n == 0:
		return {"n": 0, "mean": null, "std": null, "p2p": null}
	var sum := 0.0
	var lo := samples[0]
	var hi := samples[0]
	for v in samples:
		sum += v
		lo = minf(lo, v)
		hi = maxf(hi, v)
	var mean := sum / n
	var sq := 0.0
	for v in samples:
		sq += (v - mean) * (v - mean)
	return {"n": n, "mean": r(mean, digits), "std": r(sqrt(sq / n), digits), "p2p": r(hi - lo, digits)}


static func r(v: float, digits: int = 3) -> float:
	var m := pow(10.0, digits)
	return roundf(v * m) / m


static func v3(v: Vector3, digits: int = 4) -> Array:
	return [r(v.x, digits), r(v.y, digits), r(v.z, digits)]
