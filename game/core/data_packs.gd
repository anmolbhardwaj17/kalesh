## Data packs of an exported build (TECH.md "Verify harness and shipping"): the map stage tiles are not in the main
## pack, they ship beside it as `stage_<name>.pck` (made by `node harness/bin/export.mjs`, one per map stage) and are
## mounted at start with ProjectSettings.load_resource_pack, before any scene looks for res://world/tiles/. A project
## run from the editor or from game/ has no packs to mount. Later districts ship as one more stage pack, no code change.
extends RefCounted

const PREFIX := "stage_"
const SUFFIX := ".pck"


## The pack file names (not paths) among `names`: `stage_<name>.pck`, sorted. Pure, unit tested.
static func pack_names(names: PackedStringArray) -> PackedStringArray:
	var out := PackedStringArray()
	for n in names:
		if n.begins_with(PREFIX) and n.ends_with(SUFFIX) and n.length() > PREFIX.length() + SUFFIX.length():
			out.append(n)
	out.sort()
	return out


## The folders an exported build looks in for packs: next to the executable and, in a macOS app bundle, the bundle's
## Resources folder (`Kalesh.app/Contents/MacOS/Kalesh` has them in `../Resources`).
static func search_dirs(exe_path: String) -> PackedStringArray:
	var base := exe_path.get_base_dir()
	return PackedStringArray([base, base.path_join("../Resources").simplify_path()])


## Mounts every stage pack found; returns the pack paths that mounted. Nothing in the editor (the engine folder has no
## packs) and nothing when a folder is missing.
static func mount_all(exe_path := OS.get_executable_path()) -> PackedStringArray:
	var mounted := PackedStringArray()
	if OS.has_feature("editor"):
		return mounted
	for dir in search_dirs(exe_path):
		for n in pack_names(DirAccess.get_files_at(dir)):
			var p := dir.path_join(n)
			if ProjectSettings.load_resource_pack(p, true):
				mounted.append(p)
				print("game: data pack %s" % p)
			else:
				print("game: data pack %s could not be mounted" % p)
	return mounted
