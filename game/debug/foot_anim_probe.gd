## Debug probes of the humanoid body (P1-023), commands of the hook foot(cmd, opts) (docs/GAME_HOOKS.md), called by
## foot_probe.gd. Input only for the movement: the gait keys are pressed through the InputMap like a player's.
##   anim {gait}        walk, jog or sprint from rest on the open pad: after 1 s at the gait, three cycles of the clip
##                      are sampled every tick: foot slide (foot_contact.gd: the stance foot's mean backward speed in
##                      the body frame against the ground speed), the clip, its rate, and the
##                      animation cost per tick (advance and bone update, median)
##   animcost {n}       n characters (the three looks in turn) walk on the pad beside the course: the animation cost
##                      per character per tick (each one's median over 2 s, advance and bone update; the median of those)
##   lineup {x, z, h}   the three leads side by side on the pad: the player (Bittu) at x, z facing h degrees, SI Meera
##                      Rana on his right and Danny on his left (two characters that are not the player, standing),
##                      and the on-foot camera turned to face them, as a player turns it with the mouse;
##                      {clear: true} takes the two away
extends RefCounted

const Contact := preload("res://characters/foot_contact.gd")
const Motor := preload("res://characters/foot_motor.gd")
const OnFoot := preload("res://characters/on_foot.gd")

const PAD_X := -290.0
const PAD_Z := 40.0
const DT := 1.0 / 60.0
const GAITS := ["walk", "jog", "sprint"]
const CYCLES := 3


static func anim(p: Node, gait: String) -> Dictionary:
	if not gait in GAITS:
		return {"error": "foot(anim): gait %s (walk, jog, sprint)" % gait}
	await p.stage(PAD_X, PAD_Z, 0.0)
	var c: CharacterBody3D = p.character()
	var h: Node3D = c.humanoid
	if h == null:
		return {"error": "foot(anim): the character has no humanoid (rig files missing: tools/characters/ual_build.mjs)"}
	p.press("move_forward", 1.0)
	p.press("walk", 1.0 if gait == "walk" else 0.0)
	p.press("sprint", 1.0 if gait == "sprint" else 0.0)
	await p.ticks(60)
	var st: String = h.state
	var rate: float = h.rate
	var clip: Animation = h.clips().get_animation(h.STATES[st])
	# three cycles: a sprint cycle is only 21 ticks, too few to place the foot switches alone
	var n := int(ceil(CYCLES * clip.length / maxf(rate, 0.01) / DT)) + 1
	var rl := PackedVector3Array()
	var rr := PackedVector3Array()
	var body := PackedVector3Array()
	var states := {}
	for i in n:
		await p.tick()
		var b: Array = h.balls()
		var pos := c.global_position
		rl.append(b[0] - pos)
		rr.append(b[1] - pos)
		body.append(pos)
		states[h.state] = true
	var a := body[0]
	var z := body[body.size() - 1]
	var ground := Vector2(z.x - a.x, z.z - a.z).length() / ((body.size() - 1) * DT)
	var res := Contact.slide(rl, rr, body, DT, Motor.forward(c.heading), ground)
	var cost: float = h.cost_ms()
	p.release()
	await p.ticks(30)
	return {
		"gait": gait, "state": st, "states": states.keys(), "clip": h.STATES[st],
		"rate": snappedf(rate, 0.0001), "sampleTicks": n, "groundMs": snappedf(ground, 0.0001),
		"footMs": snappedf(float(res.footSpeed), 0.0001), "slidePct": snappedf(100.0 * float(res.slide), 0.01),
		"switches": res.switches, "animMsPerTick": cost,
		"look": h.look_id, "scale": snappedf(h.body_scale, 0.0001),
	}


static func lineup(p: Node, o: Dictionary) -> Dictionary:
	var c: CharacterBody3D = p.character()
	var world := c.get_parent()
	for n in ["LeadMeera", "LeadDanny"]:
		var old := world.get_node_or_null(n)
		if old != null:
			old.queue_free()
	if bool(o.get("clear", false)):
		await p.ticks(2)
		return {"cleared": true}
	var x := float(o.get("x", PAD_X))
	var z := float(o.get("z", PAD_Z))
	var hd := deg_to_rad(float(o.get("h", 180.0)))
	await p.stage(x, z, hd)
	var right := Vector3(-Motor.forward(hd).z, 0.0, Motor.forward(hd).x)
	var gap := float(o.get("gap", 0.95))
	var out := {"player": c.humanoid.info() if c.humanoid != null else {}}
	for pair in [["LeadMeera", "meera", 1.0], ["LeadDanny", "danny", -1.0]]:
		var n := OnFoot.new()
		n.name = pair[0]
		n.is_player = false
		n.look = pair[1]
		world.add_child(n)
		var at := Vector3(x, 0.0, z) + right * gap * float(pair[2])
		n.place(at.x, at.z, hd)
		out[pair[1]] = n.humanoid.info() if n.humanoid != null else {}
	var cam = p.mode_node().foot_camera
	cam.snap_behind(wrapf(hd + PI, -PI, PI))
	await p.ticks(int(float(o.get("settle", 1.0)) * 60.0))
	for n in ["LeadMeera", "LeadDanny"]:
		var c2 := world.get_node(n)
		out[c2.look] = c2.humanoid.info() if c2.humanoid != null else {}
	return out


static func animcost(p: Node, count: int) -> Dictionary:
	await p.stage(PAD_X, PAD_Z + 80.0, 0.0)
	var world := (p.character() as Node).get_parent()
	var list: Array = []
	for i in count:
		var c := OnFoot.new()
		c.is_player = false
		c.look = ["bittu", "meera", "danny"][i % 3]
		c.name = "AnimCost%d" % i
		world.add_child(c)
		c.place(PAD_X - 2.0 + 2.0 * (i % 8), PAD_Z + 70.0 - 3.0 * int(i / 8), 0.0)
		list.append(c)
	await p.ticks(10)
	for i in count:
		list[i].controls(Vector3(sin(i * 0.7), 0.0, -cos(i * 0.7)) * (0.4 if i % 2 == 0 else 1.0), false)
	await p.ticks(30)
	for c in list:
		c.humanoid.us_ring.clear()
	await p.ticks(120)
	var each := []
	for c in list:
		if c.humanoid != null:
			each.append(c.humanoid.cost_ms())
		c.queue_free()
	await p.tick()
	each.sort()
	var med: float = each[each.size() / 2] if not each.is_empty() else NAN
	return {"characters": count, "msPerCharacter": med, "maxMs": each.max() if not each.is_empty() else NAN}
