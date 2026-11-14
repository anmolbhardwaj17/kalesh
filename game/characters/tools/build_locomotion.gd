## Offline build of the game's locomotion clips (P2-041), run by tools/characters/loco_build.mjs (never by the game):
##   godot --headless --path game -s res://characters/tools/build_locomotion.gd
## Why: the library's walk, jog and sprint are in-place cycles whose feet do not fit the game's speeds. Its walk is a
## 0.86 m/s stroll, its jog and sprint bound (26 and 15 cm of hip travel, feet on the ground a quarter of the time and
## moving back at 4.9 and 8.2 m/s there). Played fast enough to cover ground they looked quick and bouncy (P1-023: 1.86x
## and 1.95x). This build makes one clip per gait whose feet are planted at the game's speed at rate 1:
##   - the cycle gets the cadence a person has at that speed (steps a minute), and the stance of each foot its share of
##     the cycle; each leg takes the library pose of the same point of its own stance or swing (a smooth time map), the
##     body the pose between both legs' times;
##   - on the ground the ankle is solved from a point of the sole that does not move over the ground (the heel, then
##     the ball: leg_ik.gd), going back at the gait's speed; in the air the library's path, eased onto both ends;
##   - the hips keep the library's bob scaled to a person's (GAITS.bob) and drop where a leg could not reach.
## It also builds the start, stop and plant-and-turn clips (build_moves.gd). Reads rig/ual_clips.res and
## rig/mannequin_m.scn (both mannequins share the skeleton), writes rig/loco_clips.res with metadata:
##   "gaits": {clip: {speed (m/s of the game), model_speed (skeleton metres a second at rate 1), cycle_s, spm, step_m,
##            duty, source, source_rate (cycle of the library clip over the built cycle), slide (share), miss_m}}
##   "moves": {clip: {len, out_phase (the gait phase its last pose has), ...}} (build_moves.gd)
##   "ground": the height of the clips' ground plane in skeleton space, "ref_scale": the body scale the speeds fit,
##   "sole": the heel and ball sole points in each foot bone's frame, the foot's length (body_feel.gd).
extends SceneTree

const Kit := preload("res://characters/tools/loco_kit.gd")
const Moves := preload("res://characters/tools/build_moves.gd")
const SRC := "res://characters/rig/ual_clips.res"
const MESH := "res://characters/rig/mannequin_m.scn"
const OUT := "res://characters/rig/loco_clips.res"
const OUT_LEAD := "res://characters/rig/loco_%s.res"
## The body scale the clips' speeds are exact for (the stand-in Bittu 0.940; Danny 0.973 and Meera 0.908 play 3.5
## percent off). A lead model's build (`-- lead <id>`, P2-063) uses that model's own scale and writes rig/loco_<id>.res.
const REF_SCALE := 0.94
const Leads := preload("res://characters/leads.gd")
## A sole point within this of the ground counts as on it (source clips; they sink up to 2.6 cm).
const TOL := 0.02
## A sole point of a built clip within this of the ground is on it; a swinging foot clears the ground by CLEAR.
const ON_GROUND := 0.004
const CLEAR := 0.02
## speed: the game's gait speed (foot_motor.gd). spm: steps a minute of a person at that speed. duty or contact_s: how
## long a foot stays down (share of the cycle, or seconds). bob: the library's hip travel kept. trunk: how much of the
## spine's, chest's, neck's and head's swing about their mean pose is kept (the library's jog nods the chest 10 degrees
## in 1/60 s at every landing). lift: the swing foot's height kept. shift: the stance moved forward (m). drop: the hips lowered (m).
const GAITS := {
	"Walk_K": {"src": "Walk", "speed": 1.6, "spm": 130.0, "duty": 0.56, "bob": 0.4, "trunk": 1.0, "lift": 1.0, "shift": 0.0, "drop": 0.0},
	"Jog_K": {"src": "Jog_Fwd", "speed": 3.8, "spm": 166.0, "contact_s": 0.2, "bob": 0.32, "trunk": 0.45, "lift": 0.85, "shift": 0.0, "drop": 0.02},
	"Sprint_K": {"src": "Sprint", "speed": 6.5, "spm": 204.0, "contact_s": 0.125, "bob": 0.5, "trunk": 0.6, "lift": 0.95, "shift": 0.0, "drop": 0.02},
	"Crouch_K": {"src": "Crouch_Fwd", "speed": 1.2, "spm": 100.0, "duty": 0.6, "bob": 1.0, "trunk": 1.0, "lift": 1.0, "shift": 0.0, "drop": 0.0, "ground_of": "Crouch_Idle"},
}

var _ran := false


func _process(_d: float) -> bool:
	if _ran:
		return false
	_ran = true
	var err := _build()
	if err != "":
		printerr("build_locomotion: ", err)
		quit(1)
	else:
		print("build_locomotion: ok")
		quit(0)
	return false


func _build() -> String:
	var args := OS.get_cmdline_user_args()
	var mesh := MESH
	var out_path := OUT
	var ref := REF_SCALE
	var lead_id := ""
	if args.size() >= 2 and args[0] == "lead":
		lead_id = args[1]
		mesh = Leads.MODEL_PATH % lead_id
		out_path = OUT_LEAD % lead_id
	var src := load(SRC) as AnimationLibrary
	var ps := load(mesh) as PackedScene
	if src == null or ps == null:
		return "missing %s or %s (run tools/characters/ual_build.mjs or lead_build.mjs first)" % [SRC, mesh]
	var body := ps.instantiate() as Node3D
	if lead_id != "":
		ref = Leads.model_scale(lead_id, body.get_meta("lead", {}))
	var k := Kit.new()
	k.ref_scale = ref
	if lead_id != "":
		k.fps = 240.0
		k.forward_knee = true
	k.setup(root, body, src)
	var out := AnimationLibrary.new()
	k.ap.add_animation_library("k", out)
	var meta := {}
	for name in GAITS:
		var g := gait(k, name, GAITS[name])
		out.add_animation(name, g.anim)
		var m: Dictionary = g.meta
		m.merge(measure(k, "k/" + name, float(m.model_speed)))
		meta[name] = m
		print("gait %s: %s" % [name, JSON.stringify(m)])
	var moves := Moves.build(k, out, meta)
	if moves.has("error"):
		return str(moves.error)
	out.set_meta("gaits", meta)
	out.set_meta("moves", moves)
	out.set_meta("ground", k.ground)
	out.set_meta("sole", {"LeftHeel": k.heel["Left"], "LeftBall": k.ball["Left"], "RightHeel": k.heel["Right"], "RightBall": k.ball["Right"],
		"len": k.foot_len, "ankle": k.ankle_flat})
	out.set_meta("ref_scale", ref)
	out.set_meta("source", "Built by characters/tools/build_locomotion.gd from the Universal Animation Library 1 (Quaternius, CC0)")
	if lead_id != "":
		out.set_meta("lead", lead_id)
	var e := ResourceSaver.save(out, out_path, ResourceSaver.FLAG_COMPRESS)
	if e != OK:
		return "save %s: %d" % [out_path, e]
	print("ground ", snappedf(k.ground, 0.0001), " reach ", snappedf(k.reach, 0.0001), " foot ", snappedf(k.foot_len, 0.0001))
	return ""


## The longest run of true in a looped list of flags, as phases [from, to] (from in -0.5..0.5, to above it).
static func longest_run(flags: Array) -> Array:
	var n := flags.size()
	var best := 0
	var best_at := 0
	for i in n:
		if not flags[i] or flags[(i + n - 1) % n]:
			continue
		var len := 0
		while len < n and flags[(i + len) % n]:
			len += 1
		if len > best:
			best = len
			best_at = i
	var s0 := float(best_at) / n
	if s0 >= 0.5:
		s0 -= 1.0
	return [s0, s0 + float(best) / n]


## The source phase a leg takes at built phase `f` (0 at its own contact): the stance [0, d] maps onto the source
## stance [s0, s1] at a steady rate, the swing onto the source swing by a cubic that leaves and arrives at that rate.
static func leg_time(f: float, s0: float, s1: float, d: float) -> float:
	var cyc := floorf(f)
	f -= cyc
	if f < d:
		return cyc + s0 + (s1 - s0) * f / d
	var u := (f - d) / (1.0 - d)
	var m := (s1 - s0) / d * (1.0 - d)
	var u2 := u * u
	var u3 := u2 * u
	return cyc + (2.0 * u3 - 3.0 * u2 + 1.0) * s1 + (u3 - 2.0 * u2 + u) * m + (-2.0 * u3 + 3.0 * u2) * (1.0 + s0) + (u3 - u2) * m


## One gait clip. Answers {anim, meta}.
static func gait(k: Kit, name: String, c: Dictionary) -> Dictionary:
	var src: String = c.src
	var ts := k.lib.get_animation(src).length
	# some library clips stand at another height than the idle (the crouch set 3.7 cm lower): `raise` lifts them
	var src_ground := k.ground
	if c.has("ground_of"):
		src_ground = k.clip_ground(str(c.ground_of))
	var raise := k.ground - src_ground
	# the source: when each foot is on the ground
	var flags := {"Left": [], "Right": []}
	var ns := 240
	for i in ns:
		k.pose(src, ts * i / ns)
		for side in Kit.SIDES:
			var pts := k.sole_points(side, k.sk.get_bone_global_pose(k.legs[side][2]))
			flags[side].append(minf(pts[0].y, pts[1].y) <= src_ground + TOL)
	var st := {"Left": longest_run(flags["Left"]), "Right": longest_run(flags["Right"])}
	# the right foot's stance as the one half a cycle after the left's
	while st["Right"][0] < st["Left"][0]:
		st["Right"] = [st["Right"][0] + 1.0, st["Right"][1] + 1.0]
	var t_cycle := 120.0 / float(c.spm)
	var duty: float = float(c.duty) if c.has("duty") else float(c.contact_s) / t_cycle
	var v := float(c.speed) / k.ref_scale
	var n := roundi(t_cycle * k.fps)
	var lead := {"Left": 0.0, "Right": 0.5}
	# pass A: the source poses each built frame takes
	var body := []
	var leg := {"Left": [], "Right": []}
	var mean_y := 0.0
	for i in n:
		var phi := float(i) / n
		var tl := leg_time(phi - 0.0, st["Left"][0], st["Left"][1], duty)
		var tr := leg_time(phi - 0.5, st["Right"][0], st["Right"][1], duty)
		tr += roundf(tl - tr)
		k.pose(src, ts * (tl + tr) * 0.5)
		body.append(k.body_sample())
		mean_y += body[i].pos.y
		k.pose(src, ts * tl)
		leg["Left"].append(_raised(k.leg_sample("Left"), raise))
		k.pose(src, ts * tr)
		leg["Right"].append(_raised(k.leg_sample("Right"), raise))
	mean_y /= n
	k.calm_trunk(body, float(c.trunk))
	# pass B: ankle targets and the hips. The stance sits around the source's own stance centre, moved to where the
	# legs reach best (the least the hips must drop)
	var travel := v * duty * t_cycle
	var hips_pos := []
	for i in n:
		var p: Vector3 = body[i].pos
		p.y = mean_y + raise - float(c.drop) + float(c.bob) * (p.y - mean_y)
		hips_pos.append(p)
	var target := {}
	var need := PackedFloat32Array()
	var shift := 0.0
	var best := 1e9
	for cand in range(-6, 7):
		var sh := float(c.shift) + 0.02 * cand
		var t := _targets(k, c, st, leg, n, duty, v * t_cycle, travel, sh, raise)
		var nd := _need(k, t, hips_pos, body)
		var worst := 0.0
		for x in nd:
			worst = maxf(worst, x)
		if worst < best - 0.004 or (worst < best + 0.004 and absf(sh) < absf(shift)):
			best = minf(best, worst)
			shift = sh
			target = t
			need = nd
	var drop := _smooth_cover(need, maxi(1, roundi(k.fps / Kit.FPS)))
	# pass C: pose, plant, record
	var frames := []
	var miss := 0.0
	var max_drop := 0.0
	for i in n:
		var b: Dictionary = body[i]
		b.pos = hips_pos[i] - Vector3(0.0, drop[i], 0.0)
		max_drop = maxf(max_drop, drop[i])
		k.apply_body(b)
		for side in Kit.SIDES:
			k.apply_leg(side, leg[side][i])
		miss = maxf(miss, k.plant({"Left": target["Left"][i], "Right": target["Right"][i]},
			{"Left": leg["Left"][i].basis, "Right": leg["Right"][i].basis}))
		frames.append(k.snap())
	var meta := {"speed": float(c.speed), "model_speed": snappedf(v, 0.0001), "cycle_s": snappedf(t_cycle, 0.0001), "spm": float(c.spm),
		"step_m": snappedf(float(c.speed) * t_cycle * 0.5, 0.001), "duty": snappedf(duty, 0.001), "source": src,
		"source_rate": snappedf(ts / t_cycle, 0.001), "source_duty": snappedf(st["Left"][1] - st["Left"][0], 0.001),
		"miss_m": snappedf(miss, 0.0001), "reach_drop_m": snappedf(max_drop, 0.001), "shift_m": snappedf(shift, 0.001)}
	return {"anim": k.bake(frames, t_cycle, true), "meta": meta}


## A leg sample of a clip that stands `raise` lower than the idle.
static func _raised(ls: Dictionary, raise: float) -> Dictionary:
	ls.ankle = (ls.ankle as Vector3) + Vector3(0.0, raise, 0.0)
	return ls


## Ankle targets of every built frame, per side: planted on the ground through the stance, the source's path eased onto
## both ends through the swing. `cycle_m` is the ground covered in a cycle, `shift` moves the stance forward.
static func _targets(k: Kit, c: Dictionary, st: Dictionary, leg: Dictionary, n: int, duty: float, cycle_m: float, travel: float,
		shift: float, raise: float) -> Dictionary:
	var src: String = c.src
	var ts := k.lib.get_animation(src).length
	var lead := {"Left": 0.0, "Right": 0.5}
	var out := {}
	for side in Kit.SIDES:
		var s: Array = st[side]
		k.pose(src, ts * s[0])
		var p0 := k.sole_points(side, k.sk.get_bone_global_pose(k.legs[side][2]))
		var g_in: float = (p0[0].z + k.foot_len) if p0[0].y < p0[1].y - 0.01 else p0[1].z
		k.pose(src, ts * s[1])
		var g_out: float = k.sole_points(side, k.sk.get_bone_global_pose(k.legs[side][2]))[1].z
		var g0 := (g_in + g_out) * 0.5 + shift + travel * 0.5
		k.pose(src, ts * (s[0] + s[1]) * 0.5)
		var x := k.sk.get_bone_global_pose(k.legs[side][2]).origin.x
		# the leg at both ends of its swing, as built and as the source has it
		var ends := []
		for at in [duty, 1.0]:
			k.pose(src, ts * leg_time(at, s[0], s[1], duty))
			var e := _raised(k.leg_sample(side), raise)
			var q := k.planted_ankle(side, e.basis, x, g0 - cycle_m * (at if at < 1.0 else 0.0))
			ends.append(q - _lifted(k, e.ankle, float(c.lift)))
		var list := []
		for i in n:
			var f := fposmod(float(i) / n - float(lead[side]), 1.0)
			var ls: Dictionary = leg[side][i]
			var p: Vector3
			if f < duty:
				p = k.planted_ankle(side, ls.basis, x, g0 - cycle_m * f)
			else:
				var u := smoothstep(0.0, 1.0, (f - duty) / (1.0 - duty))
				p = _lifted(k, ls.ankle, float(c.lift)) + (ends[0] as Vector3).lerp(ends[1], u)
				p.y = maxf(p.y, k.ankle_floor(side, ls.basis) + CLEAR * sin(PI * (f - duty) / (1.0 - duty)))
			list.append(p)
		out[side] = list
	return out


## How far the hips must drop in each frame for both legs to reach their targets.
static func _need(k: Kit, target: Dictionary, hips_pos: Array, body: Array) -> PackedFloat32Array:
	var need := PackedFloat32Array()
	var max_r := k.reach * 0.992
	for i in hips_pos.size():
		var over := 0.0
		for side in Kit.SIDES:
			var j := k.hip_joint(side, hips_pos[i], body[i].hips_basis)
			var t: Vector3 = target[side][i]
			var flat := Vector2(t.x - j.x, t.z - j.z).length_squared()
			var room := sqrt(maxf(0.0, max_r * max_r - flat))
			over = maxf(over, (j.y - t.y) - room)
		need.append(maxf(0.0, over))
	return need


## The source ankle with its height over a flat foot's scaled by `lift`.
static func _lifted(k: Kit, p: Vector3, lift: float) -> Vector3:
	var flat := k.ground + k.ankle_flat
	return Vector3(p.x, flat + lift * (p.y - flat), p.z)


## A smooth looped curve that is nowhere under `need`: widened by two frames, blurred, then lifted back over it.
## `per`: frames per frame of a 120 keys a second build (2 at a lead build's 240), so the smoothing spans the same time.
static func _smooth_cover(need: PackedFloat32Array, per := 1) -> PackedFloat32Array:
	var n := need.size()
	var wide := PackedFloat32Array()
	wide.resize(n)
	for i in n:
		var m := 0.0
		for d in range(-2 * per, 2 * per + 1):
			m = maxf(m, need[(i + d + n) % n])
		wide[i] = m
	var out := wide
	for pass_i in 3 * per * per:
		var next := PackedFloat32Array()
		next.resize(n)
		for i in n:
			next[i] = 0.25 * out[(i + n - 1) % n] + 0.5 * out[i] + 0.25 * out[(i + 1) % n]
		out = next
	for i in n:
		out[i] = maxf(out[i], need[i])
	return out


## Plays a built clip and measures its feet against the speed it was built for, at the game's tick (1/60 s, four
## offsets): the share of the cycle a foot is down, the slide (how far a sole point on the ground strays from going
## back at `v`, over the distance covered), the deepest a sole goes under the ground and the hips' travel.
static func measure(k: Kit, clip: String, v: float) -> Dictionary:
	var a := k.ap.get_animation(clip)
	var dt := 1.0 / 60.0
	var ns := int(ceil(a.length / dt))
	var slid := 0.0
	var covered := 0.0
	var down := 0
	var all := 0
	var deepest := 0.0
	var hip_lo := 1e9
	var hip_hi := -1e9
	for off in 4:
		var prev := {}
		for i in ns + 1:
			k.pose(clip, dt * (i + off * 0.25))
			var hy := k.sk.get_bone_global_pose(k.hips).origin.y
			hip_lo = minf(hip_lo, hy)
			hip_hi = maxf(hip_hi, hy)
			for side in Kit.SIDES:
				var pts := k.sole_points(side, k.sk.get_bone_global_pose(k.legs[side][2]))
				deepest = maxf(deepest, k.ground - minf(pts[0].y, pts[1].y))
				var on := [pts[0].y <= k.ground + ON_GROUND, pts[1].y <= k.ground + ON_GROUND]
				if prev.has(side):
					var was: Array = prev[side]
					if side == "Left":
						all += 1
					for q in [1, 0]:
						if on[q] and was[1][q]:
							slid += absf((was[0][q].z - pts[q].z) - v * dt)
							covered += v * dt
							if side == "Left":
								down += 1
							break
				prev[side] = [pts, on]
	return {"slide": snappedf(slid / maxf(covered, 1e-6), 0.0001), "down_share": snappedf(float(down) / maxf(1.0, all), 0.001),
		"deepest_m": snappedf(deepest, 0.0001), "hip_travel_m": snappedf(hip_hi - hip_lo, 0.001)}
