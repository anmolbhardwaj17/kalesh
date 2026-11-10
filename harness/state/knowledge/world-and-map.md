# world-and-map

One line per gotcha.

- src/geo/projection.ts: z is metres SOUTH of the origin (north is -Z), so `geoToWorld` returns negative z for anything north of India Gate; landmarks: Connaught Place park about (-1246, -2062), Red Fort about (+1130, -4800).
- The series projection round trip is about 0.4 mm, not exact: assert round trips under 1 cm / 1e-7 degrees, not 1e-9.
- Godot `Vector2`/`Vector3` are 32 bit floats in the standard build (0.4 mm error at 25 km); `game/geo/projection.gd` returns plain float Dictionaries. Do geo maths in floats, convert to Vector3 only to place nodes.
- `Projection` is a Godot builtin type: a preload const named Projection fails to parse. The port is preloaded as `Geo`.
