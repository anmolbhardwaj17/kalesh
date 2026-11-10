# rendering-and-look

One line per gotcha.
- Style tests restyle scenes from outside: game/render/style_runner.gd hooks SceneTree.node_added (connected in the GameArgs autoload _ready, before the main scene loads). Anything a style reads (mesh, metadata like "wear" or "facades") must be set on a node before add_child, and a style adds children with call_deferred (the node is mid-enter).
- Stand-in materials are matched by key: kit.gd materials() sets resource_name = key ("matte", "road", "satin", ...). People, signs and goods are all "satin", so grime only on "matte" and "road" keeps characters clean.
- Custom spatial shaders get raw vertex COLOR: convert sRGB to linear yourself (StandardMaterial3D does it via vertex_color_is_srgb). Per block values go in an `instance uniform` set with set_instance_shader_parameter.
- AgX (Godot 4.7) made the warm stand-ins grey and flat; Filmic plus a 3D LUT (ImageTexture3D, 33^3, built in code) and adjustment saturation gave "rich and warm". Golden light turns pink when an orange fog sits over a blue sky top: keep the golden sky top grey-warm.
- A Decal projects along its local -Y: for a wall with outward normal n use Basis(UP.cross(n), n, UP.cross(n).cross(n)) so texture rows run downward.
- Godot Metal reports no GPU time: style perf numbers from a plain lookproof --perf are CPU only (0.4 ms). Compare looks with HARNESS_GODOT_ARGS="--rendering-driver vulkan --disable-vsync".
