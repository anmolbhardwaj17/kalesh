## A constant, tunable GPU load for honest GPU readings (debug hook bench('ballast', {n}) and bench('blank', {on})).
## A window on this Mac is capped at 120 fps even with vsync off, and under the cap the GPU clocks down, so a light
## scene reads about 6.5 ms of GPU time whatever it costs. With this load in its own offscreen viewport the frame is GPU
## bound and longer than the display's refresh, the GPU runs at full clock, and the root viewport's own GPU time is the
## scene's cost (harness/bin/ballast.mjs does the calibration and the arithmetic). Added under the DebugServer on first use.
extends Node

const SHADER := preload("res://debug/ballast.gdshader")

var _vp: SubViewport
var _mat: ShaderMaterial


## n > 0: n shader iterations per pixel every frame; 0 switches the load off. Returns n.
func set_load(n: int) -> int:
	if _vp == null:
		_vp = SubViewport.new()
		_vp.name = "Ballast"
		_vp.size = Vector2i(1024, 1024)
		_vp.disable_3d = true
		var rect := ColorRect.new()
		rect.size = Vector2(1024, 1024)
		_mat = ShaderMaterial.new()
		_mat.shader = SHADER
		rect.material = _mat
		_vp.add_child(rect)
		add_child(_vp)
	_mat.set_shader_parameter("iterations", maxi(n, 1))
	_vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS if n > 0 else SubViewport.UPDATE_DISABLED
	return maxi(n, 0)
