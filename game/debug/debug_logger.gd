## Catches engine and script errors while the debug server runs, so unexpected ones also reach the harness as an
## 'error' event. Godot may call a Logger from any thread: it only queues under a mutex, and the debug server drains
## the queue on the main thread. Warnings are not forwarded. Never prints (that would log again).
extends Logger

const MAX_QUEUE := 100

var _mutex := Mutex.new()
var _queue: Array[Dictionary] = []


func _log_error(function: String, file: String, line: int, code: String, rationale: String, _editor_notify: bool,
		error_type: int, _script_backtraces: Array[ScriptBacktrace]) -> void:
	if error_type == Logger.ERROR_TYPE_WARNING:
		return
	var kinds := ["error", "warning", "script", "shader"]
	var e := {
		"kind": kinds[error_type] if error_type >= 0 and error_type < kinds.size() else "error",
		"message": rationale if rationale != "" else code,
		"code": code, "function": function, "file": file, "line": line,
	}
	_mutex.lock()
	if _queue.size() < MAX_QUEUE:
		_queue.append(e)
	_mutex.unlock()


func _log_message(_message: String, _error: bool) -> void:
	pass


func drain() -> Array[Dictionary]:
	_mutex.lock()
	var out := _queue.duplicate()
	_queue.clear()
	_mutex.unlock()
	return out
