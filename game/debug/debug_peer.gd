## One client of the debug server (docs/GAME_HOOKS.md "Godot transport"): its socket, the bytes read so far and the
## bytes still to send. Writes never block a frame (P1-040): every message goes into an out queue that `flush()` hands
## to the socket with put_partial_data, as much as the socket takes now. A client that stops reading for a while (a
## busy harness process) only grows its queue. Snapshots are skippable: while more than SNAPSHOT_BACKLOG bytes wait,
## a snapshot is not queued (the next one carries the events since the last one sent, and the newest state); responses
## and the hello are always queued. A queue over MAX_BACKLOG means the client is gone for good: it is dropped.
extends RefCounted

const MAX_LINE_BYTES := 1 << 20
const SNAPSHOT_BACKLOG := 256 * 1024
const MAX_BACKLOG := 64 * 1024 * 1024

var peer: StreamPeerTCP = null
## The event sequence number of the last snapshot queued for this client.
var last_seq := 0
var _in := PackedByteArray()
var _out := PackedByteArray()
var _dropped := false
## Snapshots not queued because the client was behind (for tests and the report).
var skipped := 0


func _init(p: StreamPeerTCP = null, seq := 0) -> void:
	peer = p
	last_seq = seq


## Bytes queued and not yet taken by the socket.
func backlog() -> int:
	return _out.size()


## True while the socket is connected and the client was not dropped.
func alive() -> bool:
	if _dropped or peer == null:
		return false
	return peer.get_status() == StreamPeerTCP.STATUS_CONNECTED


## True while the connection is still opening (keep it, nothing to read yet).
func connecting() -> bool:
	return not _dropped and peer != null and peer.get_status() == StreamPeerTCP.STATUS_CONNECTING


## Queues one message line. droppable (snapshots): not queued while the client is behind; answers whether it was queued.
func enqueue(msg: Dictionary, droppable := false) -> bool:
	if droppable and _out.size() > SNAPSHOT_BACKLOG:
		skipped += 1
		return false
	_out.append_array((JSON.stringify(msg) + "\n").to_utf8_buffer())
	if _out.size() > MAX_BACKLOG:
		_drop()
	return true


## Hands the queue to the socket without waiting: put_partial_data sends what fits in the socket buffer now.
func flush() -> void:
	if _out.is_empty() or not alive():
		return
	var r: Array = peer.put_partial_data(_out)
	if r[0] != OK:
		_drop()
		return
	var sent: int = r[1]
	if sent >= _out.size():
		_out.clear()
	elif sent > 0:
		_out = _out.slice(sent)


## Reads what the socket has and answers the complete request lines. A line over MAX_LINE_BYTES is dropped with an
## error response (the caller sends it: the line text is "" and too_long is true).
func read_lines() -> Array[String]:
	var lines: Array[String] = []
	var n := peer.get_available_bytes()
	if n > 0:
		var got: Array = peer.get_data(n)
		if got[0] == OK:
			_in.append_array(got[1])
	var i: int = _in.find(10)
	while i >= 0:
		var line: String = _in.slice(0, i).get_string_from_utf8()
		_in = _in.slice(i + 1)
		if line.strip_edges() != "":
			lines.append(line)
		i = _in.find(10)
	if _in.size() > MAX_LINE_BYTES:
		_in = PackedByteArray()
		enqueue({"type": "response", "id": null, "ok": false, "error": "line over %d bytes dropped" % MAX_LINE_BYTES})
	return lines


func close() -> void:
	if peer != null:
		peer.disconnect_from_host()


func _drop() -> void:
	_dropped = true
	_out = PackedByteArray()
	if peer != null:
		peer.disconnect_from_host()
