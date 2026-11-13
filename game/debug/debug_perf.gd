## The perf hooks of the debug server (docs/GAME_HOOKS.md): perf(ms), a window of per frame numbers, and
## bench('ballast', {n}) / bench('blank', {on}), the GPU ballast for honest GPU readings under this Mac's 120 fps cap
## (harness/bin/ballast.mjs). A child of the debug server; owns the frame probe pair that times the game logic.
extends Node

const Stats := preload("res://debug/perf_stats.gd")
const FrameProbe := preload("res://debug/frame_probe.gd")
const GpuBallast := preload("res://debug/gpu_ballast.gd")

var headless := false
var _ballast: Node = null
var _probe_start: Node = null


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_probe_start = FrameProbe.new()
	var probe_end := FrameProbe.new()
	_probe_start.setup(true, null)
	probe_end.setup(false, _probe_start)
	add_child(_probe_start)
	add_child(probe_end)


## bench('ballast', {n}) and bench('blank', {on}): {ok, result} or {ok: false, error}.
func bench(cmd: String, o: Dictionary) -> Dictionary:
	if cmd == "blank":
		# on: the root viewport draws no 3D, so a perf window measures the ballast alone
		get_viewport().disable_3d = bool(o.get("on", false))
		return {"ok": true, "result": {"blank": get_viewport().disable_3d}}
	if headless:
		return {"ok": false, "error": "bench(ballast): a headless run renders nothing"}
	if _ballast == null:
		_ballast = GpuBallast.new()
		_ballast.name = "GpuBallast"
		add_child(_ballast)
	return {"ok": true, "result": {"n": _ballast.set_load(int(o.get("n", 0)))}}


## A window of ms of drawn frames: frame intervals, CPU (game logic plus render CPU), GPU, draw calls, triangles, memory.
func perf(ms: float) -> Dictionary:
	var vp := get_viewport().get_viewport_rid()
	RenderingServer.viewport_set_measure_render_time(vp, true)
	await RenderingServer.frame_post_draw
	var cpu: Array[float] = []
	var gpu: Array[float] = []
	var frame: Array[float] = []
	var calls: Array[float] = []
	var tris: Array[float] = []
	var start := Time.get_ticks_usec()
	var last := start
	while float(Time.get_ticks_usec() - start) < ms * 1000.0:
		await RenderingServer.frame_post_draw
		var now := Time.get_ticks_usec()
		frame.append((now - last) / 1000.0)
		last = now
		var render_cpu := RenderingServer.viewport_get_measured_render_time_cpu(vp) + RenderingServer.get_frame_setup_time_cpu()
		cpu.append(render_cpu + float(_probe_start.logic_ms))
		gpu.append(RenderingServer.viewport_get_measured_render_time_gpu(vp))
		calls.append(RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME))
		tris.append(RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME))
	var avg_frame := Stats.mean(frame)
	var mb := 1024.0 * 1024.0
	var out := {
		"windowMs": ms, "frames": frame.size(),
		"cpuMs": Stats.stats(cpu),
		"p95FrameMs": Stats.stats(frame).p95,
		"frameMs": Stats.stats(frame),
		"avgFps": 1000.0 / avg_frame if avg_frame > 0.0 else 0.0,
		"drawCalls": Stats.stats(calls).max, "drawCallsAvg": Stats.mean(calls),
		"triangles": Stats.stats(tris).max, "trianglesAvg": Stats.mean(tris),
		"gpuMB": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_VIDEO_MEM_USED) / mb,
		"textureMB": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TEXTURE_MEM_USED) / mb,
		"bufferMB": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_BUFFER_MEM_USED) / mb,
		"renderer": RenderingServer.get_video_adapter_name(),
	}
	if Stats.stats(gpu).max > 0.0:
		out["gpuMs"] = Stats.stats(gpu)
	else:
		out["gpuNote"] = "the renderer reported no GPU time: the Metal driver gives no timestamp queries in Godot 4.7 (run with the engine arg --rendering-driver vulkan for gpuMs), or the game runs headless"
	return out
