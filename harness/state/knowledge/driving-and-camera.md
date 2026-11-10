# driving-and-camera

One line per gotcha.

- The scaffold car turns 1.6 rad/s at full lock, so 3 s of throttle plus steer passes heading PI; scenarios that check "x positive, z negative" after a turn use 1.5 s.
- Verify pages always have debug=1: to test the no-debug page, open the game URL minus the query in a same-origin iframe (harness/verify/scripts/hooks_no_debug.js).
- Godot car port: a Node3D faces -Z at rotation 0, so `rotation.y = -heading` makes `-basis.z == forward(heading)` (tested in game/tests/test_scene.gd). The chase camera runs after the car with `process_physics_priority = 10`.
- Godot: the car steps on `SimClock.sim_tick(dt)`, not `_physics_process`, so time scale and the sim hold reach it. New stepping systems (physics, AI, missions) connect to `sim_tick` the same way.
- Godot 4.7.2 `PhysicsServer3D` has `set_active` but no manual space step (probed 2026-11-10), so game code cannot step physics by hand. The sim clock choice is ARCH_OPTIONS.md decision C (C1: one engine physics frame is one sim tick; time scale sets `Engine.time_scale` and `Engine.physics_ticks_per_second` together); P0-017 proves it.
