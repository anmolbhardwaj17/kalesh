## Converts an .fbx to a binary glTF (.glb) headless: godot --headless --path game -s <this file> -- <in.fbx> <out.glb>
## Godot 4.7 reads FBX through ufbx (FBXDocument) and writes glTF through GLTFDocument. Skeleton, skin weights, materials
## and textures survive; textures are embedded in the .glb. Prints one line "FBX2GLB OK <bones> <meshes>" or "FBX2GLB FAIL <why>".
## Run through harness/bin/fbx2glb.mjs (it finds the pinned engine). Not part of the game.
extends SceneTree


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() < 2:
		_fail("usage: -- <in.fbx> <out.glb>")
		return
	var src := args[0]
	var dst := args[1]
	var fbx := FBXDocument.new()
	var fstate := FBXState.new()
	var err := fbx.append_from_file(src, fstate, 0, src.get_base_dir())
	if err != OK:
		_fail("Godot could not read the FBX (error %d)" % err)
		return
	var scene := fbx.generate_scene(fstate)
	if scene == null:
		_fail("the FBX has no scene")
		return
	var skels := scene.find_children("*", "Skeleton3D", true, false)
	var bones := 0
	for s in skels:
		bones += (s as Skeleton3D).get_bone_count()
	var meshes := scene.find_children("*", "MeshInstance3D", true, false).size()
	var gdoc := GLTFDocument.new()
	var gstate := GLTFState.new()
	err = gdoc.append_from_scene(scene, gstate, 0)
	if err != OK:
		_fail("could not build glTF from the scene (error %d)" % err)
		return
	err = gdoc.write_to_filesystem(gstate, dst)
	if err != OK:
		_fail("could not write the .glb (error %d)" % err)
		return
	print("FBX2GLB OK bones=%d meshes=%d" % [bones, meshes])
	scene.free()
	quit(0)


func _fail(why: String) -> void:
	print("FBX2GLB FAIL ", why)
	quit(1)
