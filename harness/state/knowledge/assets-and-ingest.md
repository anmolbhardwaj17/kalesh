# assets-and-ingest

One line per gotcha.
- FBX uploads (P2-062): ingest converts .fbx to .glb with Godot headless (harness/bin/fbx2glb.gd via fbx2glb.mjs, runs against the checkout's game/ project, not HARNESS_ROOT); the note only warns on triangle, material and skeleton limits, the card says upload anyway; the original FBX stays in assets_inbox/_processed/ (gitignored).
