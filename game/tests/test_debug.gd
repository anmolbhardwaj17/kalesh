## The debug layer without a running server: user arg parsing, the sim clock (fixed tick, time scale, hold), the
## event ring, perf stats, and that a normal run (no --debug) has no debug node and never loads the debug server.
## The live server is checked end to end by harness/bin/godotsmoke.mjs.
extends RefCounted

const GameArgs := preload("res://core/game_args.gd")
const SimClockScript := preload("res://core/sim_clock.gd")
const GameEventsScript := preload("res://core/game_events.gd")
const Stats := preload("res://debug/perf_stats.gd")

var t
var tree: SceneTree


func test_without_debug_no_debug_node_and_server_not_loaded() -> void:
	var args := tree.root.get_node_or_null("GameArgs")
	t.ok(args != null, "GameArgs autoload exists")
	t.ok(args != null and args.debug == false, "a run without --debug has debug false")
	t.ok(tree.root.get_node_or_null("DebugServer") == null, "no DebugServer node under /root")
	t.ok(tree.get_nodes_in_group("debug_overlay").is_empty(), "no debug overlay node")
	t.ok(not ResourceLoader.has_cached(GameArgs.DEBUG_SERVER_PATH), "debug_server.gd was never loaded")


func test_parse_user_args() -> void:
	var d := GameArgs.parse(PackedStringArray())
	t.ok(d.debug == false and d.verify == false and d.lockstep == false and d.mute == false, "defaults are all off")
	t.ok(d.debug_port == GameArgs.DEFAULT_DEBUG_PORT, "default port")
	t.ok(d.quality == "medium" and d.scene == "" and d.unknown.is_empty(), "default quality, no scene, nothing unknown")
	d = GameArgs.parse(PackedStringArray(["--debug", "--debug-port=5005", "--verify", "--quality=low", "--style", "toon",
		"--scene=scaffold", "--arch=b1", "--lockstep", "--mute"]))
	t.ok(d.debug and d.verify and d.lockstep and d.mute, "flags on")
	t.ok(d.debug_port == 5005, "port from --debug-port=5005 (got %s)" % d.debug_port)
	t.ok(d.quality == "low" and d.style == "toon" and d.scene == "scaffold" and d.arch == "b1", "values, both forms")
	t.ok(d.unknown.is_empty(), "nothing unknown: %s" % [d.unknown])
	d = GameArgs.parse(PackedStringArray(["--debug-port=abc", "--wat", "stray", "--debug=0"]))
	t.ok(d.debug_port == GameArgs.DEFAULT_DEBUG_PORT, "bad port keeps the default")
	t.ok(d.debug == false, "--debug=0 is off")
	t.ok(d.unknown.size() == 3, "bad port, unknown flag and stray word are reported (%s)" % [d.unknown])


func test_arch_name_and_setup() -> void:
	t.ok(GameArgs.split_arch("render:city+i3+lod") == PackedStringArray(["render", "city+i3+lod"]), "name and setup split at the first colon")
	t.ok(GameArgs.split_arch("render") == PackedStringArray(["render", ""]), "no setup")
	t.ok(GameArgs.split_arch("") == PackedStringArray(["", ""]), "no bench")
	for id in GameArgs.ARCH_SCENES:
		t.ok(ResourceLoader.exists(GameArgs.ARCH_SCENES[id]), "bench scene %s exists" % id)


func test_default_port_matches_kit_config() -> void:
	var path := ProjectSettings.globalize_path("res://").path_join("../harness/kit.config.json")
	var cfg = JSON.parse_string(FileAccess.get_file_as_string(path))
	t.ok(cfg is Dictionary, "kit.config.json parses")
	if cfg is Dictionary:
		t.ok(int(cfg.godot.debugPort) == GameArgs.DEFAULT_DEBUG_PORT, "kit.config.json godot.debugPort %s == DEFAULT_DEBUG_PORT %d" % [cfg.godot.debugPort, GameArgs.DEFAULT_DEBUG_PORT])


func _clock() -> Node:
	var c: Node = SimClockScript.new()
	c.tick = 1.0 / 60.0
	return c


func test_clock_fixed_tick_and_scale() -> void:
	var c := _clock()
	var dts: Array[float] = []
	c.sim_tick.connect(func(dt: float) -> void: dts.append(dt))
	for i in 60:
		c.advance(1.0 / 60.0)
	t.ok(c.ticks == 60, "60 frames at scale 1 run 60 ticks (got %d)" % c.ticks)
	t.near(c.t, 1.0, 1e-9, "t after 60 ticks")
	t.ok(dts.all(func(d: float) -> bool: return is_equal_approx(d, 1.0 / 60.0)), "every tick dt is the fixed tick")
	c.set_scale(2.0)
	t.ok(c.advance(1.0 / 60.0) == 2, "scale 2 runs two ticks per frame")
	c.set_scale(0.5)
	var steps := 0
	for i in 4:
		steps += c.advance(1.0 / 60.0)
	t.ok(steps == 2, "scale 0.5 runs one tick every other frame (got %d in 4 frames)" % steps)
	c.set_scale(0.0)
	t.ok(c.advance(1.0 / 60.0) == 0, "scale 0 runs nothing")
	c.free()


func test_clock_hold_at_release_cancel() -> void:
	var c := _clock()
	var tick: float = c.tick
	var h: Dictionary = c.hold({"at": 0.5041})
	t.ok(h.paused == false and is_equal_approx(float(h.at), 0.5041), "hold({at}) answers {paused, t, at}")
	for i in 120:
		c.advance(1.0 / 60.0)
	t.ok(c.paused, "paused after passing at")
	t.ok(c.t <= 0.5041 + 1e-9 and 0.5041 - c.t < tick, "held at t %.5f, within one tick of 0.5041" % c.t)
	var held_t: float = c.t
	for i in 30:
		c.advance(1.0 / 60.0)
	t.near(c.t, held_t, 0.0, "a held clock does not move")
	t.ok(c.hold({}).at == null, "the hold point is cleared once reached")
	c.hold({"release": true})
	c.advance(1.0 / 60.0)
	t.ok(not c.paused and c.t > held_t, "release resumes")
	c.hold({"at": c.t + 10.0})
	c.hold({"cancel": true})
	for i in 900:
		c.advance(1.0 / 60.0)
	t.ok(not c.paused, "cancel clears a pending hold")
	var now: float = c.t
	c.hold({"at": now - 1.0})
	t.ok(c.paused and c.t == now, "a hold in the past pauses at once without moving")
	c.free()


func test_clock_hold_on_exact_tick_boundary() -> void:
	var c := _clock()
	c.hold({"at": 30.0 / 60.0})
	for i in 60:
		c.advance(1.0 / 60.0)
	t.ok(c.paused and c.ticks == 30, "hold on a tick boundary stops on that tick (ticks %d)" % c.ticks)
	c.free()


func test_event_ring() -> void:
	var e: Node = GameEventsScript.new()
	for i in GameEventsScript.RING + 5:
		e.emit_event("x", {"i": i})
	t.ok(e.ring.size() == GameEventsScript.RING, "ring keeps the newest %d" % GameEventsScript.RING)
	t.ok(int(e.ring[0].seq) == 6, "oldest left is seq 6")
	var newer: Array = e.since(e.seq - 3)
	t.ok(newer.size() == 3 and int(newer[0].seq) == e.seq - 2, "since(seq) returns only newer events")
	var ev: Dictionary = e.ring[0]
	t.ok(ev.has("t") and ev.has("w") and ev.type == "x" and ev.has("data"), "event has t, w, type, data")
	e.free()


func test_perf_stats() -> void:
	var s := Stats.stats([])
	t.ok(s.p50 == 0.0 and s.p95 == 0.0 and s.max == 0.0, "empty list gives zeros")
	var a := []
	for i in range(100, 0, -1):
		a.append(float(i))
	s = Stats.stats(a)
	t.near(s.p50, 51.0, 1e-9, "p50 of 1..100 (nearest rank, index 50)")
	t.near(s.p95, 96.0, 1e-9, "p95 of 1..100")
	t.near(s.max, 100.0, 1e-9, "max")
	t.near(Stats.mean([1.0, 2.0, 3.0]), 2.0, 1e-9, "mean")
