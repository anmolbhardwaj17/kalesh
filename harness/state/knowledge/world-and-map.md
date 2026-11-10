# world-and-map

One line per gotcha.

- src/geo/projection.ts: z is metres SOUTH of the origin (north is -Z), so `geoToWorld` returns negative z for anything north of India Gate; landmarks: Connaught Place park about (-1246, -2062), Red Fort about (+1130, -4800).
- The series projection round trip is about 0.4 mm, not exact: assert round trips under 1 cm / 1e-7 degrees, not 1e-9.
- Godot `Vector2`/`Vector3` are 32 bit floats in the standard build (0.4 mm error at 25 km); `game/geo/projection.gd` returns plain float Dictionaries. Do geo maths in floats, convert to Vector3 only to place nodes.
- `Projection` is a Godot builtin type: a preload const named Projection fails to parse. The port is preloaded as `Geo`.
- Stand-in scenes (game/scenes/standin/): GDScript inner classes cannot call the outer script's static funcs, so the Sink (geo.gd) reaches primitives through `const P := preload("prims.gd")`; geo.gd extends prims.gd so `Geo.extrude()` and `Geo.SEG_ROUND` work outside.
- Godot front faces are clockwise: for an outward face (b - a).cross(c - a) points inward, and a closed outward solid has negative signed volume (checked against BoxMesh in test_standin.gd). prims.gd tri() winds from the normal, so pass the outward normal, never hand-order vertices.
- A Kit.at(p, yaw) frame faces -Z at yaw 0; to face +X use yaw -PI/2, to face -X use +PI/2 (rotating -Z by yaw gives (-sin, 0, -cos)).
