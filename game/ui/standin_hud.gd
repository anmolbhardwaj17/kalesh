## HUD stand-in for the stand-in scenes (P0-009): an objective line top left, a round minimap bottom left and the
## speed bottom right. Layout only, no final UI art (STYLE_BIBLE "UI" decides that later). In the group "hud", so the
## debug hook hud(false) hides it. Nothing sits in the centre of the screen, where the player is.
extends CanvasLayer

var _speed: Label
## Scale from the 720 p layout to the window height, so the HUD keeps its share of the screen at 1080 p.
var k := 1.0


func _ready() -> void:
	add_to_group("hud")
	layer = 5
	k = maxf(0.5, get_viewport().get_visible_rect().size.y / 720.0)
	var top := _panel(Vector2(24, 20) * k, Vector2(420, 58) * k)
	var obj := _label("Pick up the passenger at the bus stop", 20, Color("#fbf7ea"))
	obj.position = Vector2(16, 6) * k
	top.add_child(obj)
	var sub := _label("Fare  Rs 80", 15, Color("#f2c230"))
	sub.position = Vector2(16, 32) * k
	top.add_child(sub)
	var map := Panel.new()
	var ms := StyleBoxFlat.new()
	ms.bg_color = Color(0.08, 0.09, 0.1, 0.72)
	ms.set_corner_radius_all(int(90 * k))
	ms.border_color = Color(0.95, 0.93, 0.86, 0.8)
	ms.set_border_width_all(int(3 * k))
	map.add_theme_stylebox_override("panel", ms)
	map.anchor_top = 1.0
	map.anchor_bottom = 1.0
	map.offset_left = 24 * k
	map.offset_top = -204 * k
	map.offset_right = 204 * k
	map.offset_bottom = -24 * k
	add_child(map)
	var road := ColorRect.new()
	road.color = Color(0.55, 0.55, 0.52, 0.9)
	road.position = Vector2(80, 14) * k
	road.size = Vector2(20, 152) * k
	map.add_child(road)
	var cross := ColorRect.new()
	cross.color = Color(0.55, 0.55, 0.52, 0.9)
	cross.position = Vector2(14, 70) * k
	cross.size = Vector2(152, 14) * k
	map.add_child(cross)
	var me := _label("^", 28, Color("#f2c230"))
	me.position = Vector2(80, 100) * k
	map.add_child(me)
	var sp := _panel(Vector2(0, 0) * k, Vector2(170, 78) * k)
	sp.anchor_left = 1.0
	sp.anchor_right = 1.0
	sp.anchor_top = 1.0
	sp.anchor_bottom = 1.0
	sp.offset_left = -194 * k
	sp.offset_right = -24 * k
	sp.offset_top = -102 * k
	sp.offset_bottom = -24 * k
	_speed = _label("0", 40, Color("#fbf7ea"))
	_speed.position = Vector2(18, 6) * k
	sp.add_child(_speed)
	var unit := _label("km/h", 16, Color("#d8cdb4"))
	unit.position = Vector2(104, 42) * k
	sp.add_child(unit)


func _panel(pos: Vector2, size: Vector2) -> Panel:
	var p := Panel.new()
	var st := StyleBoxFlat.new()
	st.bg_color = Color(0.08, 0.09, 0.1, 0.66)
	st.set_corner_radius_all(int(10 * k))
	p.add_theme_stylebox_override("panel", st)
	p.position = pos
	p.size = size
	add_child(p)
	return p


func _label(text: String, size: int, col: Color) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", int(size * k))
	l.add_theme_color_override("font_color", col)
	return l


func _process(_delta: float) -> void:
	var p := get_tree().get_first_node_in_group("player")
	if p != null and "speed" in p:
		var ms: float = p.speed
		_speed.text = "%d" % roundi(absf(ms) * 3.6)
