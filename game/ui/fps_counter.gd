## Autoload FpsCounter (P1-049): a small frames-per-second and frame-time readout in the top left corner, in the HUD
## glass style. The value is averaged over about a quarter second and the text changes 4 times a second; between
## refreshes a frame costs two float adds and a compare. Hidden, it does not process at all.
## Shown by default in development play (the editor binary, `npm run play`) and in test builds (export feature
## `test_build`, set on the export presets in game/export_presets.cfg); off in a release build. F3 (the action
## `toggle_fps`, remappable) toggles it and the choice is kept in user://settings.cfg [display] fps_counter.
## Harness runs (--verify) start it off so shots do not change; `--fps=on` or F3 brings it up for a scenario that asks.
## Not in the group `hud`: it is a tool, the debug hook hud(false) leaves it alone.
extends CanvasLayer

const WINDOW := 0.25
const SETTINGS_PATH := "user://settings.cfg"
const ACTION := "toggle_fps"

var shown := false
var _label: Label
var _panel: Panel
var _t0 := 0
var _frames := 0
var _k := 1.0


## Whether the counter starts on. `arg` is the --fps value ("on", "off" or ""), `saved` the stored setting (-1 none,
## 0 off, 1 on). The arg wins; a harness run (`verify`) ignores the stored setting and the build default.
## Pure, unit tested.
static func start_on(arg: String, saved: int, verify: bool, dev_build: bool) -> bool:
	if arg in ["on", "1", "true", "yes"]:
		return true
	if arg in ["off", "0", "false", "no"]:
		return false
	if verify:
		return false
	if saved >= 0:
		return saved == 1
	return dev_build


## The two lines of the readout for a window of `frames` drawn frames that took `usec` microseconds. Pure, unit tested.
static func format(frames: int, usec: int) -> String:
	if frames <= 0 or usec <= 0:
		return "-- fps  -- ms"
	var ms := float(usec) / 1000.0 / float(frames)
	return "%3d fps  %4.1f ms" % [roundi(1000.0 / ms), ms]


func _ready() -> void:
	layer = 100
	process_mode = Node.PROCESS_MODE_ALWAYS
	_panel = Panel.new()
	var st := StyleBoxFlat.new()
	st.bg_color = Color(0.08, 0.09, 0.1, 0.66)
	st.set_corner_radius_all(6)
	_panel.add_theme_stylebox_override("panel", st)
	_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_panel)
	_label = Label.new()
	_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_label.add_theme_color_override("font_color", Color("#fbf7ea"))
	_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_panel.add_child(_label)
	get_viewport().size_changed.connect(_layout)
	var args := get_node_or_null("/root/GameArgs")
	var verify: bool = args != null and args.verify
	var arg: String = args.fps if args != null else ""
	var dev := OS.has_feature("editor") or OS.has_feature("test_build")
	set_shown(start_on(arg, _saved(), verify, dev), false)


func _unhandled_input(event: InputEvent) -> void:
	if InputMap.has_action(ACTION) and event.is_action_pressed(ACTION):
		set_shown(not shown, true)


func set_shown(on: bool, save: bool) -> void:
	shown = on
	visible = on
	set_process(on)
	if on:
		_layout()
		_label.text = format(0, 0)
		_t0 = Time.get_ticks_usec()
		_frames = 0
	if save:
		var args := get_node_or_null("/root/GameArgs")
		if args == null or not args.verify:
			var cfg := ConfigFile.new()
			cfg.load(SETTINGS_PATH)
			cfg.set_value("display", "fps_counter", on)
			cfg.save(SETTINGS_PATH)


func _process(_delta: float) -> void:
	_frames += 1
	var now := Time.get_ticks_usec()
	if now - _t0 >= int(WINDOW * 1000000.0):
		_label.text = format(_frames, now - _t0)
		_t0 = now
		_frames = 0


func _saved() -> int:
	var cfg := ConfigFile.new()
	if cfg.load(SETTINGS_PATH) != OK or not cfg.has_section_key("display", "fps_counter"):
		return -1
	return 1 if bool(cfg.get_value("display", "fps_counter")) else 0


## Top left, in the HUD's margin; under the stand-in HUD's objective box when a scene has one.
func _layout() -> void:
	_k = maxf(0.5, get_viewport().get_visible_rect().size.y / 720.0)
	var y := 86.0 if get_tree().get_first_node_in_group("hud") != null else 20.0
	_panel.position = Vector2(24, y) * _k
	_panel.size = Vector2(150, 26) * _k
	_label.size = _panel.size
	_label.add_theme_font_size_override("font_size", int(15 * _k))
