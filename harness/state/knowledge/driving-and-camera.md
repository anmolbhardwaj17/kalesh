# driving-and-camera

One line per gotcha.

- The scaffold car turns 1.6 rad/s at full lock, so 3 s of throttle plus steer passes heading PI; scenarios that check "x positive, z negative" after a turn use 1.5 s.
- Verify pages always have debug=1: to test the no-debug page, open the game URL minus the query in a same-origin iframe (harness/verify/scripts/hooks_no_debug.js).
