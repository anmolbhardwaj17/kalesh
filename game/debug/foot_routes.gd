## The on-foot feel probes of the foot hook (P1-022, beside foot_probe.gd): each stages the character, presses the
## InputMap actions the way a player's keys do and measures in sim ticks. The camera stays where staging put it, so
## W runs the way the character was staged to face and S runs back toward the camera.
extends RefCounted

const Motor := preload("res://characters/foot_motor.gd")
const Area := preload("res://scenes/course/foot_area.gd")

## Open pad west of the course features: the flat probes run north from here.
const PAD_X := -290.0
const PAD_Z := 40.0
const DT := 1.0 / 60.0


static func run(p: Node, test: String, o: Dictionary) -> Dictionary:
	match test:
		"speeds":
			return await speeds(p)
		"stamina":
			return await stamina(p)
		"jump":
			return await jump(p, bool(o.get("running", false)))
		"vault":
			return await vault(p, str(o.get("wall", "1.2")))
		"turn":
			return await turn(p)
		"kerbs":
			return await kerbs(p, str(o.get("gait", "jog")), str(o.get("run", "")))
	return {"error": "unknown test '%s' (speeds, stamina, jump, vault, turn, kerbs)" % test}


static func _gait_keys(p: Node, gait: String, on: bool) -> void:
	p.press("move_forward", 1.0 if on else 0.0)
	p.press("walk", 1.0 if on and gait == "walk" else 0.0)
	p.press("sprint", 1.0 if on and gait == "sprint" else 0.0)


static func _flat(c: Node3D) -> Vector2:
	return Vector2(c.global_position.x, c.global_position.z)


## Each gait from rest on the open pad: 1 s to get going, then the ground speed over 2 s (distance over time).
static func speeds(p: Node) -> Dictionary:
	var out := {}
	for g in ["walk", "jog", "sprint", "crouch"]:
		await p.stage(PAD_X, PAD_Z, 0.0)
		var c: Node3D = p.character()
		if g == "crouch":
			p.press("crouch", 1.0)
			await p.ticks(3)
			p.press("crouch", 0.0)
			await p.ticks(2)
		_gait_keys(p, g, true)
		await p.ticks(60)
		var a := _flat(c)
		var gaits := {}
		for i in 120:
			await p.tick()
			gaits[c.motor.gait] = true
		var ms := (_flat(c) - a).length() / (120.0 * DT)
		_gait_keys(p, g, false)
		var want := Motor.gait_speed(g)
		out[g] = {"targetMs": want, "measuredMs": snappedf(ms, 0.0001), "errorPct": snappedf(100.0 * (ms - want) / want, 0.01),
			"gaits": gaits.keys(), "crouched": c.motor.crouched}
		if g == "crouch":
			p.press("crouch", 1.0)
			await p.ticks(3)
			p.press("crouch", 0.0)
	await p.ticks(10)
	return out


## Sprint from full stamina until it runs out (the ticks the gait is sprint), then stand and time the bar back to full.
static func stamina(p: Node) -> Dictionary:
	await p.stage(PAD_X, PAD_Z, 0.0)
	var c: Node3D = p.character()
	_gait_keys(p, "sprint", true)
	var sprint_ticks := 0
	var started := false
	var t := 0
	while t < 60 * 12:
		await p.tick()
		t += 1
		if c.motor.gait == "sprint":
			started = true
			sprint_ticks += 1
		elif started:
			break
	_gait_keys(p, "sprint", false)
	var empty_at: float = c.motor.stamina
	var regen := 0
	while c.motor.stamina < 1.0 and regen < 60 * 10:
		await p.tick()
		regen += 1
	# after the bar empties the sprint key gives a jog until the bar is back to Motor.RESPRINT
	return {"sprintS": snappedf(sprint_ticks * DT, 0.001), "sprintTicks": sprint_ticks, "staminaAtEnd": snappedf(empty_at, 0.0001),
		"regenS": snappedf(regen * DT, 0.001), "regenTicks": regen}


## A jump from standing (or while jogging): the feet's height over the start each tick; apex and the time to it.
static func jump(p: Node, running: bool) -> Dictionary:
	await p.stage(PAD_X, PAD_Z, 0.0)
	var c: Node3D = p.character()
	if running:
		_gait_keys(p, "jog", true)
		await p.ticks(60)
	var y0: float = c.global_position.y
	p.press("jump", 1.0)
	var top := 0.0
	var top_t := 0
	var land_t := -1
	var airborne := false
	for i in 90:
		await p.tick()
		if i == 5:
			p.press("jump", 0.0)
		var h: float = c.global_position.y - y0
		if h > top + 1e-6:
			top = h
			top_t = i + 1
		if c.state == "air":
			airborne = true
		elif airborne and land_t < 0:
			land_t = i + 1
	_gait_keys(p, "jog", false)
	p.press("jump", 0.0)
	return {"apexM": snappedf(top, 0.0001), "apexS": snappedf(top_t * DT, 0.001), "landS": snappedf(land_t * DT, 0.001) if land_t > 0 else null,
		"running": running, "jumps": c.jumps}


## Jog north at a wall of the vault lane and press jump 0.75 m before its face (a player who sees the wall coming).
## Vaulted: the feet end past the far face. The time runs from the press to the end of the vault.
static func vault(p: Node, which: String) -> Dictionary:
	var wall: Array = Area.VAULT_WALLS[1] if which == "1.3" else Area.VAULT_WALLS[0]
	var s: float = wall[0]
	var depth: float = wall[2]
	var top: float = wall[1]
	if which == "rail":
		s = Area.RAIL_S
		depth = 0.06
		top = Area.RAIL_H
	var x := (Area.VX0 + Area.VX1) * 0.5
	var face_z := Area.z_at(s)
	var far_z := face_z - depth
	await p.stage(x, face_z + 5.0, 0.0)
	var c: Node3D = p.character()
	var vaults0: int = c.vaults
	_gait_keys(p, "jog", true)
	var t := 0
	while t < 300 and c.global_position.z - face_z > 0.75:
		await p.tick()
		t += 1
	var press_z: float = c.global_position.z
	p.press("jump", 1.0)
	var started := -1
	var ended := -1
	var max_y: float = c.global_position.y
	for i in 120:
		await p.tick()
		if i == 5:
			p.press("jump", 0.0)
		max_y = maxf(max_y, c.global_position.y)
		if c.state == "vault" and started < 0:
			started = i + 1
		if started >= 0 and ended < 0 and c.state != "vault":
			ended = i + 1
			break
	_gait_keys(p, "jog", false)
	await p.ticks(20)
	var end_z: float = c.global_position.z
	return {"wall": which, "topM": top, "vaulted": c.vaults > vaults0 and end_z < far_z, "vaultS": snappedf(ended * DT, 0.001) if ended > 0 else null,
		"pressZ": snappedf(press_z, 0.001), "faceZ": face_z, "endZ": snappedf(end_z, 0.001), "pastFarFaceM": snappedf(far_z - end_z, 0.001),
		"maxFeetY": snappedf(max_y, 0.001), "overlap": p.overlap(c), "state": c.state}


## Jog north for 1 s, then let go of W and hold S (back toward the camera): the ticks until the body faces south
## within 1 degree.
static func turn(p: Node) -> Dictionary:
	await p.stage(PAD_X, PAD_Z, 0.0)
	var c: Node3D = p.character()
	_gait_keys(p, "jog", true)
	await p.ticks(60)
	var v0: float = c.motor.speed
	p.press("move_forward", 0.0)
	p.press("move_back", 1.0)
	var n := 0
	while n < 120:
		await p.tick()
		n += 1
		if absf(Motor.angle_to(c.motor.heading, PI)) < deg_to_rad(1.0):
			break
	p.press("move_back", 0.0)
	await p.ticks(10)
	return {"turnS": snappedf(n * DT, 0.001), "turnTicks": n, "speedBeforeMs": snappedf(v0, 0.001)}


## The kerb and stair lane at one gait: kerbs north and south, stairs and ramp north and south, each from three start
## offsets (so the steps are met at every phase). Speed: the distance along the lane inside the window over the time;
## a snag is any 0.2 s with a mean speed under 80 percent of the gait's. `only` runs one of them (a hook call has 60 s).
static func kerbs(p: Node, gait: String, only: String = "") -> Dictionary:
	var want := Motor.gait_speed(gait)
	var x := (Area.KX0 + Area.KX1) * 0.5
	var ramp_end := Area.ramp_end_s()
	var kerbs_end := Area.SLAB_S0 + (Area.SLAB_LEN + Area.SLAB_GAP) * Area.SLABS - Area.SLAB_GAP
	# [name, start s, window from s, window to s] (s grows north)
	var runs := [["kerbs_north", 2.0, 8.0, kerbs_end + 2.0], ["kerbs_south", Area.STAIRS_S - 1.0, kerbs_end + 2.0, 8.0],
		["stairs_north", Area.STAIRS_S - 5.0, Area.STAIRS_S - 2.0, ramp_end + 2.0], ["stairs_south", ramp_end + 6.0, ramp_end + 2.0, Area.STAIRS_S - 2.0]]
	var out := []
	var worst_loss := 0.0
	var snags := 0
	var unfinished := 0
	for r in runs:
		if only != "" and r[0] != only:
			continue
		for off in [0.0, 0.11, 0.23]:
			var north: bool = float(r[3]) > float(r[2])
			var s0: float = float(r[1]) + (off if north else -off)
			await p.stage(x, Area.z_at(s0), 0.0 if north else PI)
			var res: Dictionary = await _lane_run(p, gait, float(r[2]), float(r[3]), want)
			res["name"] = r[0]
			res["offset"] = off
			worst_loss = maxf(worst_loss, res.lossPct)
			snags += int(res.snags)
			if not res.finished:
				unfinished += 1
			out.append(res)
	return {"gait": gait, "targetMs": want, "worstLossPct": snappedf(worst_loss, 0.01), "snags": snags, "unfinished": unfinished, "runs": out}


static func _lane_run(p: Node, gait: String, s_in: float, s_out: float, want: float) -> Dictionary:
	var c: Node3D = p.character()
	var north := s_out > s_in
	var steps0: int = c.steps_taken
	_gait_keys(p, gait, true)
	var t := 0
	var inside := 0
	var dist := 0.0
	var window := PackedFloat32Array()
	var slow := 0
	var min_win := 1e9
	var finished := false
	var last_s := -(c.global_position.z - Area.Z0)
	var max_y := 0.0
	var trace := []
	while t < 60 * 30:
		await p.tick()
		t += 1
		var s := -(c.global_position.z - Area.Z0)
		trace.append([snappedf(s, 0.001), snappedf(c.global_position.y, 0.001), c.state, snappedf(c.motor.speed, 0.01), c.steps_taken])
		if trace.size() > 16:
			trace.remove_at(0)
		var ds := (s - last_s) if north else (last_s - s)
		last_s = s
		max_y = maxf(max_y, c.global_position.y)
		var in_win := (s >= s_in and s <= s_out) if north else (s <= s_in and s >= s_out)
		if not in_win:
			if inside > 0:
				finished = true
				break
			continue
		inside += 1
		dist += ds
		window.append(ds / DT)
		if window.size() > 12:
			window.remove_at(0)
		if window.size() == 12:
			var m := 0.0
			for v in window:
				m += v
			m /= 12.0
			min_win = minf(min_win, m)
			if m < want * 0.8:
				slow += 1
	_gait_keys(p, gait, false)
	var mean := dist / maxf(1.0, inside) / DT
	return {"meanMs": snappedf(mean, 0.0001), "lossPct": snappedf(100.0 * (1.0 - mean / want), 0.01), "slowestWindowMs": snappedf(min_win, 0.001),
		"snags": 1 if slow > 0 else 0, "slowTicks": slow, "finished": finished, "ticks": inside, "steps": c.steps_taken - steps0,
		"maxY": snappedf(max_y, 0.001), "gaits": c.motor.gait, "trace": trace if not finished else []}
