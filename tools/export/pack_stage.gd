## Writes a map stage's tile folder as one data pack (TECH.md "Verify harness and shipping", game/core/data_packs.gd).
## Run by harness/bin/export.mjs: godot --headless --path game --script <this> -- <tile folder> <out.pck>
## Every file of the folder goes in at res://world/tiles/<name>, the place the game reads the full tile set from.
extends SceneTree

const TARGET := "res://world/tiles/"


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() != 2:
		printerr("usage: pack_stage.gd -- <tile folder> <out.pck>")
		quit(2)
		return
	var src := args[0]
	var out := args[1]
	var files := DirAccess.get_files_at(src)
	if files.is_empty() or not files.has("index.json"):
		printerr("pack_stage: %s has no index.json (bake it first: npm run bake -- pilot)" % src)
		quit(1)
		return
	var packer := PCKPacker.new()
	if packer.pck_start(out) != OK:
		printerr("pack_stage: cannot start %s" % out)
		quit(1)
		return
	var bytes := 0
	for f in files:
		if packer.add_file(TARGET + f, src.path_join(f)) != OK:
			printerr("pack_stage: cannot add %s" % f)
			quit(1)
			return
		bytes += FileAccess.get_file_as_bytes(src.path_join(f)).size()
	if packer.flush() != OK:
		printerr("pack_stage: cannot write %s" % out)
		quit(1)
		return
	print("pack_stage: %d files, %d bytes into %s" % [files.size(), bytes, out])
	quit(0)
