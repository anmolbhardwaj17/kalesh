## The FPS counter (P1-049): start rules, the readout text, the F3 action, the per frame cost, and that the debug hook
## hud(false) leaves it alone.
extends RefCounted

const Fps := preload("res://ui/fps_counter.gd")

var t
var tree: SceneTree


func test_start_rules() -> void:
	t.ok(Fps.start_on("", -1, false, true), "development play starts it on")
	t.ok(not Fps.start_on("", -1, false, false), "a release build starts it off")
	t.ok(not Fps.start_on("", 1, true, true), "a harness run (--verify) ignores the build default and the saved setting")
	t.ok(Fps.start_on("on", -1, true, false), "--fps=on shows it under --verify")
	t.ok(not Fps.start_on("off", 1, false, true), "--fps=off wins over a saved on")
	t.ok(Fps.start_on("", 1, false, false), "the saved setting turns it on in a release build")
	t.ok(not Fps.start_on("", 0, false, true), "the saved setting turns it off in development")


func test_format() -> void:
	t.ok(Fps.format(0, 0) == "-- fps  -- ms", "no frames yet")
	t.ok(Fps.format(15, 250000) == " 60 fps  16.7 ms", "15 frames in a quarter second is 60 fps")
	t.ok(Fps.format(30, 250000).begins_with("120 fps"), "30 frames in a quarter second is 120 fps")


func test_args_and_input() -> void:
	var d: Dictionary = load("res://core/game_args.gd").parse(PackedStringArray(["--fps=on"]))
	t.ok(d.fps == "on", "--fps is a value arg")
	t.ok(d.unknown.is_empty(), "and is understood")
	t.ok(InputMap.has_action("toggle_fps"), "the action toggle_fps exists (remappable)")
	var has_f3 := false
	for e in InputMap.action_get_events("toggle_fps"):
		if e is InputEventKey and e.physical_keycode == KEY_F3:
			has_f3 = true
	t.ok(has_f3, "it is bound to F3")


func test_cost_and_hud_hook() -> void:
	var c: CanvasLayer = Fps.new()
	tree.root.add_child(c)
	c.set_shown(true, false)
	var n := 100000
	var t0 := Time.get_ticks_usec()
	for i in n:
		c._process(0.016)
	var per_ms := float(Time.get_ticks_usec() - t0) / 1000.0 / float(n)
	t.ok(per_ms < 0.02, "a frame costs %.5f ms (under 0.02)" % per_ms)
	var ev := InputEventAction.new()
	ev.action = "toggle_fps"
	ev.pressed = true
	c._unhandled_input(ev)
	t.ok(not c.shown and not c.visible, "the toggle_fps action (F3) hides it")
	c._unhandled_input(ev)
	t.ok(c.shown and c.visible and c.is_processing(), "and shows it again")
	c.set_shown(false, false)
	t.ok(not c.is_processing(), "hidden, it does not process")
	t.ok(not c.is_in_group("hud"), "not in the group hud")
	c.queue_free()
