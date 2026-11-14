## Offline build of a lead's Mixamo set (P2-072), run by build_mixamo.gd -- leads (tools/characters/mixamo_build.mjs):
## writes rig/mx_<id>.res, which humanoid_anim.gd plays for that lead in place of rig/loco_<id>.res.
## It starts from the lead's built locomotion set (loco_<id>.res: the crouch, the start, stop and turn moves fitted to
## the motor, their metadata) and puts the lead's Mixamo picks (data/mixamo_picks.json) over it:
##   Idle, Walk_K, Jog_K, Sprint_K   the picked clips, the limbs aimed at the source skeleton (mixamo.gd aims()), the
##            hips scaled to the lead's hip height and lowered or raised onto the built set's ground plane; each gait
##            cut at its left foot's contact so all three start with the left foot down (the blend space plays them on
##            one shared timeline), resampled at FPS, root motion dropped (the motor moves the body). The gait metadata
##            (model_speed: how fast the planted foot goes back, skeleton metres a second at rate 1) lets humanoid_anim
##            play each cycle at the cadence that holds the planted foot still at the game's speed.
##   Mx_*     the other picks as named clips (start, stops, turns, the right turn mirrored from the left).
##   Up_*     upper body clips for the bone masked layer (pistol, phone, texting, gestures, carrying).
##   Add_*    additive flinches (each key relative to the clip's first pose).
extends RefCounted

const Mixamo := preload("res://characters/mixamo.gd")
const Kit := preload("res://characters/tools/loco_kit.gd")
const LeadLooks := preload("res://characters/leads.gd")
const Layers := preload("res://characters/anim_layers.gd")
const LegIK := preload("res://characters/leg_ik.gd")
const ClipOps := preload("res://characters/tools/clip_ops.gd")
## Share of a stance at each end over which the planted foot hands over from the clip's path to the held one.
const PLANT_EASE := 0.15
const PICKS := "res://data/mixamo_picks.json"
const BASE := "res://characters/rig/loco_%s.res"
const OUT := "res://characters/rig/mx_%s.res"
const MODEL := "res://characters/rig/lead_%s.scn"
const P := "%GeneralSkeleton:"
const FPS := 60.0
## Keys a second of the clips that are not re-timed (the source's own rate: more keys add nothing).
const SRC_FPS := 30.0
## A sole point within this of the clip's lowest counts as on the ground.
const TOL := 0.02
const GAIT_SPEED := {"Walk_K": 1.6, "Jog_K": 3.8, "Sprint_K": 6.5}


static func build_all(root: Node, ids: Array) -> String:
	if not ids.is_empty() and ids[0] == "measure":
		return measure(root, str(ids[1]), ids.slice(2))
	if not FileAccess.file_exists(PICKS):
		return "no " + PICKS
	var picks: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(PICKS))
	var leads: Dictionary = picks.get("leads", {})
	for id in (ids if not ids.is_empty() else leads.keys()):
		if not leads.has(id):
			return "no picks for " + str(id)
		var err := build(root, str(id), leads[id], picks.get("shared", {}))
		if err != "":
			return "%s: %s" % [id, err]
	return ""


static func build(root: Node, id: String, pick: Dictionary, shared: Dictionary) -> String:
	var base := load(BASE % id) as AnimationLibrary
	var ps := load(MODEL % id) as PackedScene
	if base == null or ps == null:
		return "missing %s or %s (lead_build.mjs first)" % [BASE % id, MODEL % id]
	var body := ps.instantiate() as Node3D
	var sk := body.get_node("GeneralSkeleton") as Skeleton3D
	var aims := Mixamo.aims(sk)
	print("aim %s (degrees): %s" % [id, JSON.stringify(aims.deg)])
	var hip_h := sk.get_bone_rest(sk.find_bone("Hips")).origin.y
	# every picked clip fitted to this skeleton
	var want := {}
	for role in pick:
		if pick[role] is Dictionary:
			for part in pick[role]:
				if pick[role][part] is String:
					want[str(pick[role][part])] = true
		else:
			want[str(pick[role])] = true
	for role in shared:
		want[_clip_of(shared[role])] = true
	var fitted := {}
	for name in want:
		var a := Mixamo.clip(name)
		if a == null:
			return "no clip " + name
		var one := AnimationLibrary.new()
		one.add_animation("c", a)
		var f := Mixamo.for_skeleton(one, sk).get_animation("c")
		f.loop_mode = a.loop_mode
		fitted[name] = f
	# measure on the lead: a work library with the picked idle as "Idle" (the kit's ground plane)
	var work := AnimationLibrary.new()
	work.add_animation("Idle", no_root(fitted[str(pick.idle)]))
	for name in fitted:
		work.add_animation(StringName(name), no_root(fitted[name]))
	var k := Kit.new()
	k.fps = FPS
	k.setup(root, body, work)
	var base_ground := float(base.get_meta("ground", 0.0))
	var lift := base_ground - k.ground
	print("lead %s: hips %.4f, mixamo idle ground %.4f, built ground %.4f (lift %.4f)" % [id, hip_h, k.ground, base_ground, lift])
	var out := AnimationLibrary.new()
	for n in base.get_animation_list():
		out.add_animation(n, base.get_animation(n))
	for m in base.get_meta_list():
		out.set_meta(m, base.get_meta(m))
	var gaits: Dictionary = (base.get_meta("gaits", {}) as Dictionary).duplicate(true)
	out.add_animation("Idle", resample(fitted[str(pick.idle)], 0.0, lift, true, false, 0.0, SRC_FPS))
	var roles := {"Walk_K": "walk", "Jog_K": "jog", "Sprint_K": "run"}
	for g in roles:
		# a gait is one clip, or {legs, upper}: the legs and hips of one clip with the spine, arms and head of another
		# (its cycle stretched onto the legs' cycle, both from the left foot's contact): a character walk whose own
		# pace is far under the game's walk keeps its upper body on legs that fit the speed
		var spec: Variant = pick[roles[g]]
		var name := str(spec.legs) if spec is Dictionary else str(spec)
		var m := gait_numbers(k, name)
		if m.has("error"):
			return "%s: %s" % [name, m.error]
		var cyc := resample(fitted[name], float(m.contact_t), lift, true, false, float(m.cycle_s))
		var src_names := name
		if spec is Dictionary and spec.has("mix"):
			# two gaits blended into one cycle (both from the left foot's contact, a weight `w` of the second): a pace
			# between two clips' own (Mixamo's jog is slower than the game's, its run faster)
			var mx := str(spec.mix)
			var mm := gait_numbers(k, mx)
			if mm.has("error"):
				return "%s: %s" % [mx, mm.error]
			var other := resample(fitted[mx], float(mm.contact_t), lift, true, false, float(mm.cycle_s))
			cyc = mix(cyc, other, float(spec.get("w", 0.5)))
			src_names += "+" + mx
			work.add_animation(StringName("_" + g), cyc)
			m = gait_numbers(k, "_" + g, false, true)
			if m.has("error"):
				return "%s mix: %s" % [g, m.error]
			if float(m.contact_t) > 0.02 and float(m.contact_t) < float(m.cycle_s) - 0.02:
				cyc = resample(cyc, float(m.contact_t), 0.0, true)
		if spec is Dictionary and spec.has("upper"):
			var up_name := str(spec.upper)
			var mu := gait_numbers(k, up_name)
			if mu.has("error"):
				return "%s: %s" % [up_name, mu.error]
			var up := resample(fitted[up_name], float(mu.contact_t), lift, true, false, float(mu.cycle_s))
			cyc = graft_upper(cyc, up)
			m["upper"] = "mixamo:" + up_name
			m["upper_rate"] = snappedf(float(mu.cycle_s) / float(m.cycle_s), 0.001)
		name = src_names
		# the planted feet held on a straight path going back at the gait's speed (a Mixamo cycle's planted foot
		# wobbles 5 to 8 percent of the ground it covers; the motor needs it still)
		# (`plant` in the pick: measured in game it helps the sprints of Bittu and Meera and hurts the jog, P2-072)
		if spec is Dictionary and bool(spec.get("plant", false)):
			work.add_animation(StringName("_p" + g), cyc)
			cyc = plant(k, "_p" + g, float(m.model_speed))
			work.add_animation(StringName("_q" + g), cyc)
			var mp := gait_numbers(k, "_q" + g, false, true)
			m["slide_unplanted"] = m.get("slide", 0.0)
			m["slide"] = mp.get("slide", m.get("slide", 0.0))
			m["planted"] = true
		out.add_animation(g, cyc)
		m["speed"] = GAIT_SPEED[g]
		m["source"] = "mixamo:" + name
		m["rate_at_speed"] = snappedf(float(GAIT_SPEED[g]) / (float(m.model_speed) * LeadLooks.model_scale(id, body.get_meta("lead", {}))), 0.001)
		gaits[g] = m
		print("gait %s %s: %s" % [id, g, JSON.stringify(m)])
	out.set_meta("gaits", gaits)
	# the named extras: Mx_<role> for each other pick, the right turns mirrored from the left ones
	for role in pick:
		if role in ["idle", "walk", "jog", "run"]:
			continue
		var clip_name := "Mx_" + str(role).capitalize().replace(" ", "_")
		out.add_animation(clip_name, resample(fitted[str(pick[role])], 0.0, lift, false, true, 0.0, SRC_FPS))
		if str(role).ends_with("_l"):
			var r_name := clip_name.trim_suffix("_L") + "_R"
			out.add_animation(r_name, ClipOps.mirror(out.get_animation(clip_name), sk))
	for role in shared:
		# a layer clip is a clip name, or {clip, from, to} (a looped part of a long clip: the phone at the ear) or
		# {clip, at} (one pose held: the carrying arms)
		var spec: Variant = shared[role]
		var src: Animation = fitted[_clip_of(spec)]
		if str(role).begins_with("up_"):
			var held: Animation
			if spec is Dictionary and spec.has("at"):
				held = ClipOps.still(src, float(spec.at))
			elif spec is Dictionary and spec.has("from"):
				held = resample(src, float(spec.from), lift, true, true, float(spec.to) - float(spec.from), SRC_FPS)
			else:
				held = resample(src, 0.0, lift, src.loop_mode == Animation.LOOP_LINEAR, true, 0.0, SRC_FPS)
			out.add_animation("Up_" + str(role).trim_prefix("up_").capitalize().replace(" ", "_"), held)
		elif str(role).begins_with("add_"):
			out.add_animation("Add_" + str(role).trim_prefix("add_").capitalize().replace(" ", "_"), ClipOps.additive(resample(src, 0.0, 0.0, false, true, 0.0, SRC_FPS), sk))
	out.set_meta("mixamo", {"picks": pick, "shared": shared, "aimed": aims.deg, "lift": snappedf(lift, 0.0001)})
	out.set_meta("source", "Mixamo clips (owner's account) fitted to the lead by characters/tools/mixamo_lead.gd, over loco_%s.res" % id)
	var e := ResourceSaver.save(out, OUT % id, ResourceSaver.FLAG_COMPRESS)
	if e != OK:
		return "save %s: %d" % [OUT % id, e]
	print("lead %s: %s, %d clips, %.2f MB" % [id, OUT % id, out.get_animation_list().size(), FileAccess.get_file_as_bytes(OUT % id).size() / 1e6])
	body.queue_free()
	return ""


## Prints the gait numbers of clips on a lead (`-- leads measure <id> <clip>...`): picking gaits by natural speed.
static func measure(root: Node, id: String, names: Array) -> String:
	var body := (load(MODEL % id) as PackedScene).instantiate() as Node3D
	var sk := body.get_node("GeneralSkeleton") as Skeleton3D
	var work := AnimationLibrary.new()
	for name in names:
		var a := Mixamo.clip(str(name))
		if a == null:
			return "no clip " + str(name)
		var one := AnimationLibrary.new()
		one.add_animation("c", a)
		var f := Mixamo.for_skeleton(one, sk).get_animation("c")
		f.loop_mode = a.loop_mode
		work.add_animation(StringName(name), no_root(f))
		if not work.has_animation("Idle"):
			work.add_animation("Idle", no_root(f))
	var k := Kit.new()
	k.setup(root, body, work)
	var sc := LeadLooks.model_scale(id, body.get_meta("lead", {}))
	for name in names:
		var m := gait_numbers(k, str(name), true)
		print("gait %s %s: natural %.2f m/s %s" % [id, name, float(m.get("model_speed", 0.0)) * sc, JSON.stringify(m)])
	return ""


static func _clip_of(spec: Variant) -> String:
	return str(spec.clip) if spec is Dictionary else str(spec)


## A copy of `a` without its root motion (the Root track): an in-place cycle to measure.
static func no_root(a: Animation) -> Animation:
	var c := a.duplicate(true) as Animation
	var t := c.find_track(NodePath(P + "Root"), Animation.TYPE_POSITION_3D)
	if t >= 0:
		c.remove_track(t)
	return c


## The gait numbers of an in-place cycle on the kit's body: when the left foot comes down (contact_t, s), the right's
## (as a share of the cycle after the left's), how long each foot is down (duty), and model_speed, the median speed
## at which a planted foot goes back (skeleton m/s at rate 1), cycle_s and the planted foot's wobble (slide: the spread
## of that speed over its median).
static func gait_numbers(k: Kit, clip: String, verbose := false, one_cycle := false) -> Dictionary:
	var a := k.lib.get_animation(clip)
	var L := a.length
	var n := 240
	var h := {"Left": [], "Right": []}
	var z := {"Left": [], "Right": []}
	for i in n:
		k.pose(clip, L * i / n)
		for side in Kit.SIDES:
			var pts := k.sole_points(side, k.sk.get_bone_global_pose(k.legs[side][2]))
			h[side].append(minf(pts[0].y, pts[1].y))
			z[side].append((pts[0].z + pts[1].z) * 0.5)
	var lo := 1e9
	for side in Kit.SIDES:
		for v in h[side]:
			lo = minf(lo, v)
	var runs := {}
	var speeds := []
	var cycles := 1
	for side in Kit.SIDES:
		var flags := []
		for v in h[side]:
			flags.append(v <= lo + TOL)
		# a foot that lifts or touches for a few samples (a heel roll, a toe scuff) is not a step
		flags = debounce(debounce(flags, false), true)
		runs[side] = longest_run(flags)
		if side == "Left" and not one_cycle:
			cycles = maxi(1, contacts(flags))
		if verbose:
			var line := ""
			for i in range(0, n, 4):
				line += "#" if flags[i] else "."
			print("  %s %s lo %.3f %s" % [clip, side, lo, line])
		var r: Array = runs[side]
		# the middle 60 percent of the stance: the planted foot's speed back
		var i0 := int(round((r[0] + (r[1] - r[0]) * 0.2) * n))
		var i1 := int(round((r[0] + (r[1] - r[0]) * 0.8) * n))
		for i in range(i0, i1):
			var dz: float = z[side][posmod(i + 1, n)] - z[side][posmod(i, n)]
			speeds.append(-dz / (L / n))
	if speeds.size() < 4:
		return {"error": "no stance found"}
	speeds.sort()
	var med: float = speeds[speeds.size() / 2]
	if med <= 0.05:
		return {"error": "the planted foot does not go back (%.3f m/s): not an in-place forward cycle" % med}
	var q1: float = speeds[speeds.size() / 4]
	var q3: float = speeds[speeds.size() * 3 / 4]
	# a clip of several cycles (Mixamo's jogging has three) is cut to one: the period from a left contact
	var per := L / cycles
	var l0: float = fposmod(float(runs["Left"][0]), 1.0)
	var r0: float = fposmod((float(runs["Right"][0]) - l0) * cycles, 1.0)
	return {"contact_t": snappedf(l0 * L, 0.0001), "right_at": snappedf(r0, 0.001), "cycles_in_clip": cycles,
		"duty": snappedf((float(runs["Left"][1]) - float(runs["Left"][0]) + float(runs["Right"][1]) - float(runs["Right"][0])) * 0.5 * cycles, 0.001),
		"model_speed": snappedf(med, 0.0001), "cycle_s": snappedf(per, 0.0001), "spm": snappedf(120.0 / per, 0.1),
		"step_m": snappedf(med * per * 0.5, 0.001), "slide": snappedf((q3 - q1) / med, 0.001)}


## A looped list of flags with every run of `value` shorter than DEBOUNCE samples turned to the other value.
const DEBOUNCE := 7
static func debounce(flags: Array, value: bool) -> Array:
	var n := flags.size()
	var out := flags.duplicate()
	for i in n:
		if flags[i] != value or flags[(i + n - 1) % n] == value:
			continue
		var len := 0
		while len < n and flags[(i + len) % n] == value:
			len += 1
		if len < DEBOUNCE:
			for j in len:
				out[(i + j) % n] = not value
	return out


## How many times a looped list of flags turns true (a foot's contacts in a clip).
static func contacts(flags: Array) -> int:
	var n := flags.size()
	var c := 0
	for i in n:
		if flags[i] and not flags[(i + n - 1) % n]:
			c += 1
	return c


## The longest run of true in a looped list of flags, as phases [from, to] (build_locomotion.gd's).
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
	return [float(best_at) / n, float(best_at + best) / n]


## `a` resampled at FPS from time `t0` (a loop wraps round, so its first key is the pose at t0), the hips raised by
## `lift`; root motion dropped (the Root track) unless `keep_root`. The result loops when `loop`.
## `period` (a loop of several cycles cut to one): the keys span t0 to t0 + period, and the gap between the pose there
## and the pose at t0 is spread over the cycle so it closes.
static func resample(a: Animation, t0: float, lift: float, loop: bool, keep_root := false, period := 0.0, fps := FPS) -> Animation:
	var src := a.duplicate(true) as Animation
	src.loop_mode = Animation.LOOP_LINEAR if loop else Animation.LOOP_NONE
	var L := src.length
	var cut := period > 0.0 and period < L - 1e-3
	if cut:
		L = period
	var out := Animation.new()
	out.length = L
	out.loop_mode = src.loop_mode
	var nk := int(round(L * fps))
	for t in src.get_track_count():
		var path := String(src.track_get_path(t))
		var ty := src.track_get_type(t)
		if path == P + "Root" and not keep_root:
			continue
		if ty != Animation.TYPE_ROTATION_3D and ty != Animation.TYPE_POSITION_3D:
			continue
		var o := out.add_track(ty)
		out.track_set_path(o, NodePath(path))
		# a bone that never moves keeps one key
		var still_track := src.track_get_key_count(t) <= 1
		for i in (1 if still_track else nk + 1):
			var tm := minf(float(i) / fps, L)
			var at := fposmod(t0 + tm, src.length) if loop and (t0 > 0.0 or cut) else tm
			if loop and t0 > 0.0 and i == nk and not cut:
				at = t0
			var u := tm / L
			var a_end := fposmod(t0 + L, src.length)
			if ty == Animation.TYPE_ROTATION_3D:
				var q := src.rotation_track_interpolate(t, at)
				if cut:
					var fix := src.rotation_track_interpolate(t, a_end).inverse() * src.rotation_track_interpolate(t, t0)
					q = q * Quaternion.IDENTITY.slerp(fix, u)
				out.rotation_track_insert_key(o, tm, q.normalized())
			else:
				var v := src.position_track_interpolate(t, at)
				if cut:
					v += (src.position_track_interpolate(t, t0) - src.position_track_interpolate(t, a_end)) * u
				if path == P + "Hips":
					v.y += lift
				out.position_track_insert_key(o, tm, v)
	return out


## `clip` (a looping gait cycle in the kit's library) with each planted foot held: through every stance the ball of the
## foot goes straight back at `v` (skeleton m/s) from where it is mid-stance (its height as the clip has it), eased in
## and out over PLANT_EASE of the stance; the ankle is moved by leg IK, the foot keeping its turn. Only the leg bones'
## keys change.
static func plant(k: Kit, clip: String, v: float) -> Animation:
	var a := k.lib.get_animation(clip)
	var L := a.length
	var n := int(round(L * FPS))
	var h := {"Left": [], "Right": []}
	var gz := {"Left": [], "Right": []}
	var ax := {"Left": [], "Right": []}
	for i in n:
		k.pose(clip, L * i / n)
		for side in Kit.SIDES:
			var f := k.sk.get_bone_global_pose(k.legs[side][2])
			var pts := k.sole_points(side, f)
			h[side].append(minf(pts[0].y, pts[1].y))
			gz[side].append((f * (k.ball[side] as Vector3)).z)
			ax[side].append(f.origin.x)
	var lo := 1e9
	for side in Kit.SIDES:
		for y in h[side]:
			lo = minf(lo, y)
	# per frame and side: [weight, x, ground z] of the held foot
	var hold := {"Left": {}, "Right": {}}
	for side in Kit.SIDES:
		var flags := []
		for y in h[side]:
			flags.append(y <= lo + TOL)
		flags = debounce(debounce(flags, false), true)
		for i in n:
			if not flags[i] or flags[(i + n - 1) % n]:
				continue
			var len := 0
			while len < n and flags[(i + len) % n]:
				len += 1
			var mid := (i + len / 2) % n
			for q in len:
				var u := (float(q) + 0.5) / len
				var w := smoothstep(0.0, PLANT_EASE, u) * smoothstep(0.0, PLANT_EASE, 1.0 - u)
				var dt := (float(q) - len / 2.0) / n * L
				hold[side][(i + q) % n] = [w, float(ax[side][mid]), float(gz[side][mid]) - v * dt]
	var keys := {}
	for side in Kit.SIDES:
		for b in k.legs[side]:
			keys[b] = []
	for i in n:
		k.pose(clip, L * i / n)
		for side in Kit.SIDES:
			if hold[side].has(i):
				var hv: Array = hold[side][i]
				var f := k.sk.get_bone_global_pose(k.legs[side][2])
				# the ball (the contact point the game's foot contact reads) moved onto the held line, along z only
				var ball := f * (k.ball[side] as Vector3)
				var target := f.origin + Vector3(0.0, 0.0, float(hv[2]) - ball.z)
				LegIK.solve(k.sk, k.legs[side], f.origin.lerp(target, float(hv[0])), f.basis.orthonormalized(), true, true)
			for b in k.legs[side]:
				keys[b].append(k.sk.get_bone_pose_rotation(b))
	var out := a.duplicate(true) as Animation
	for b in keys:
		var path := NodePath(P + String(k.sk.get_bone_name(b)))
		var t := out.find_track(path, Animation.TYPE_ROTATION_3D)
		if t < 0:
			t = out.add_track(Animation.TYPE_ROTATION_3D)
			out.track_set_path(t, path)
		while out.track_get_key_count(t) > 0:
			out.track_remove_key(t, 0)
		for i in n + 1:
			out.rotation_track_insert_key(t, minf(float(i) / FPS, L), (keys[b][i % n] as Quaternion).normalized())
	return out


## `a` and `b` (looping cycles that start at the left foot's contact) blended into one cycle: the length in between,
## each sampled at the same share of its own cycle, rotations slerped and positions lerped by `w` (of `b`).
static func mix(a: Animation, b: Animation, w: float) -> Animation:
	var out := Animation.new()
	out.length = lerpf(a.length, b.length, w)
	out.loop_mode = Animation.LOOP_LINEAR
	var nk := int(round(out.length * FPS))
	for t in a.get_track_count():
		var path := a.track_get_path(t)
		var ty := a.track_get_type(t)
		var tb := b.find_track(path, ty)
		var o := out.add_track(ty)
		out.track_set_path(o, path)
		for i in nk + 1:
			var u := float(i) / nk
			var tm := u * out.length
			if ty == Animation.TYPE_ROTATION_3D:
				var qa := a.rotation_track_interpolate(t, u * a.length)
				var qb := b.rotation_track_interpolate(tb, u * b.length) if tb >= 0 else qa
				out.rotation_track_insert_key(o, tm, qa.slerp(qb, w).normalized())
			elif ty == Animation.TYPE_POSITION_3D:
				var pa := a.position_track_interpolate(t, u * a.length)
				var pb := b.position_track_interpolate(tb, u * b.length) if tb >= 0 else pa
				out.position_track_insert_key(o, tm, pa.lerp(pb, w))
	return out


## `legs` with the spine and every upper body bone (anim_layers.gd) taken from `upper`, whose cycle is stretched onto
## the legs' (both start at the left foot's contact).
static func graft_upper(legs: Animation, upper: Animation) -> Animation:
	var out := legs.duplicate(true) as Animation
	var r := upper.length / legs.length
	for t in upper.get_track_count():
		if upper.track_get_type(t) != Animation.TYPE_ROTATION_3D:
			continue
		var path := upper.track_get_path(t)
		var bone := String(path).trim_prefix(P)
		if bone != "Spine" and not Layers._is_upper(bone):
			continue
		var o := out.find_track(path, Animation.TYPE_ROTATION_3D)
		if o < 0:
			o = out.add_track(Animation.TYPE_ROTATION_3D)
			out.track_set_path(o, path)
		while out.track_get_key_count(o) > 0:
			out.track_remove_key(o, 0)
		var nk := int(round(legs.length * FPS))
		for i in nk + 1:
			var tm := minf(float(i) / FPS, legs.length)
			out.rotation_track_insert_key(o, tm, upper.rotation_track_interpolate(t, minf(tm * r, upper.length)))
	return out
