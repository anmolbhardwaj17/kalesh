## Assert helper for the headless test runner. Records failures instead of stopping, so one run reports them all.
extends RefCounted

var failures: Array[String] = []
var checks := 0


func ok(cond: bool, msg: String) -> void:
	checks += 1
	if not cond:
		failures.append(msg)


func near(got: float, want: float, tol: float, msg: String) -> void:
	checks += 1
	if not (absf(got - want) <= tol):
		failures.append("%s: got %.9f, want %.9f +/- %s" % [msg, got, want, tol])


func less(got: float, limit: float, msg: String) -> void:
	checks += 1
	if not (got < limit):
		failures.append("%s: got %.9f, want under %.9f" % [msg, got, limit])
