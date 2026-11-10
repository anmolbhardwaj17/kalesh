# driving-and-camera

One line per gotcha.

- The scaffold car turns 1.6 rad/s at full lock, so 3 s of throttle plus steer passes heading PI; scenarios that check "x positive, z negative" after a turn use 1.5 s.
- Verify pages always have debug=1: to test the no-debug page, open the game URL minus the query in a same-origin iframe (harness/verify/scripts/hooks_no_debug.js).
- Godot car port: a Node3D faces -Z at rotation 0, so `rotation.y = -heading` makes `-basis.z == forward(heading)` (tested in game/tests/test_scene.gd). The chase camera runs after the car with `process_physics_priority = 10`.
