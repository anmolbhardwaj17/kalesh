## The debug layer without a running server: user arg parsing, the sim clock (fixed tick, time scale, hold), the
## event ring, perf stats, and that a normal run (no --debug) has no debug node and never loads the debug server.
## The live server is checked end to end by harness/bin/godotsmoke.mjs.
extends RefCounted

const GameArgs := preload("res://core/game_args.gd")
const SimClockScript := preload("res://core/sim_clock.gd")
const GameEventsScript := preload("res://core/game_events.gd")
const Stats := preload("res://debug/perf_stats.gd")
const DebugPeer := preload("res://debug/debug_peer.gd")

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
	# outside the tree: the clock never touches the engine rates or the physics server
	return SimClockScript.new()


func test_clock_one_tick_per_physics_frame_at_any_scale() -> void:
	var c := _clock()
	var dts: Array[float] = []
	c.sim_tick.connect(func(dt: float) -> void: dts.append(dt))
	t.ok(c.run_frames(60) == 60, "60 physics frames run 60 ticks")
	t.ok(c.ticks == 60, "ticks counted (got %d)" % c.ticks)
	t.near(c.t, 1.0, 1e-9, "t after 60 ticks")
	t.ok(dts.all(func(d: float) -> bool: return d == 1.0 / 60.0), "every tick dt is exactly 1/60 s")
	c.set_scale(4.0)
	t.ok(c.physics_frame() == 1, "scale 4 still runs one tick per physics frame (the engine runs more frames)")
	c.set_scale(0.25)
	t.ok(c.physics_frame() == 1, "scale 0.25 still runs one tick per physics frame (the engine runs fewer frames)")
	c.set_scale(0.0)
	t.ok(c.physics_frame() == 0, "scale 0 runs nothing")
	t.ok(c.state().scale == 0.0 and not c.state().paused, "scale 0 is not a hold")
	c.set_scale(1.0)
	t.ok(c.physics_frame() == 1, "back to scale 1")
	c.free()


func test_clock_c1_rates() -> void:
	for s in [0.25, 0.5, 1.0, 2.0, 4.0, 8.0]:
		var r: Dictionary = SimClockScript.c1_rates(s)
		t.near(r.step, 1.0 / 60.0, 1e-12, "the step stays 1/60 s at time scale %s" % s)
		t.near(float(r.timeScale) * 60.0, float(r.ticksPerSecond), 1e-9, "time scale and ticks per second move together at %s" % s)
	t.ok(int(SimClockScript.c1_rates(0.25).ticksPerSecond) == 15 and int(SimClockScript.c1_rates(4.0).ticksPerSecond) == 240,
		"15 and 240 physics frames per second at scale 0.25 and 4")


func test_clock_hold_at_release_cancel() -> void:
	var c := _clock()
	var tick: float = c.tick
	var h: Dictionary = c.hold({"at": 0.5041})
	t.ok(h.paused == false and is_equal_approx(float(h.at), 0.5041), "hold({at}) answers {paused, t, at}")
	c.run_frames(120)
	t.ok(c.paused, "paused after passing at")
	t.ok(c.t <= 0.5041 + 1e-9 and 0.5041 - c.t < tick, "held at t %.5f, within one tick of 0.5041" % c.t)
	var held_t: float = c.t
	t.ok(c.run_frames(30) == 0, "a held clock runs no ticks")
	t.near(c.t, held_t, 0.0, "a held clock does not move")
	t.ok(c.hold({}).at == null, "the hold point is cleared once reached")
	c.hold({"release": true})
	c.physics_frame()
	t.ok(not c.paused and c.t > held_t, "release resumes")
	c.hold({"at": c.t + 10.0})
	c.hold({"cancel": true})
	c.run_frames(900)
	t.ok(not c.paused, "cancel clears a pending hold")
	var now: float = c.t
	c.hold({"at": now - 1.0})
	t.ok(c.paused and c.t == now, "a hold in the past pauses at once without moving")
	c.free()


func test_clock_hold_on_exact_tick_boundary() -> void:
	var c := _clock()
	c.hold({"at": 30.0 / 60.0})
	c.run_frames(60)
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


## P1-040: the out queue of a debug client. Snapshots stop queueing while the client is behind; responses never do.
func test_debug_peer_skips_snapshots_while_behind() -> void:
	var c := DebugPeer.new()
	var big := "x".repeat(4000)
	var queued := 0
	while c.backlog() <= DebugPeer.SNAPSHOT_BACKLOG and queued < 1000:
		t.ok(c.enqueue({"type": "snapshot", "pad": big}, true), "a snapshot queues while the backlog is small")
		queued += 1
	var before := c.backlog()
	t.ok(not c.enqueue({"type": "snapshot", "pad": big}, true), "a snapshot is skipped once over %d bytes" % DebugPeer.SNAPSHOT_BACKLOG)
	t.ok(c.skipped == 1 and c.backlog() == before, "skipping queues nothing (skipped %d)" % c.skipped)
	t.ok(c.enqueue({"type": "response", "id": 1, "ok": true}), "a response always queues")
	t.ok(c.backlog() > before, "the response is in the queue")
	t.ok(not c.alive(), "a client with no socket is not alive")
	c.flush() # no socket: does nothing, no error
	t.ok(c.backlog() > before, "flush without a socket keeps the queue")
