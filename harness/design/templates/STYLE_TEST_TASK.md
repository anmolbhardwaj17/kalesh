# Style test task (Phase 0)

The planner adds one task per candidate style (or one task for 2 or 3 cheap candidates). Template:

```json
{
  "phase": "P0",
  "title": "Style test: <candidate name>",
  "agent": "builder",
  "priority": 2,
  "kind": "feature",
  "desc": "Render the existing game in candidate <X> (STYLE_OPTIONS.md 'Candidates') behind the page param ?style=<x>, so the real scenes show in that style. Touch only render setup, materials, shaders, post passes, lights and a few stand-in assets (procedural or registered with assets.mjs); no gameplay, camera or UI logic change. Without the param the game looks exactly as before. Keep the switch in one module (for example src/render/styles/<x>.ts) so it can be removed or promoted after sign-off. Time box: one build round and one fix round; if the style cannot be shown in that time, report what it would need.",
  "accept": [
    "node harness/bin/lookproof.mjs --set style_<x> --query \"style=<x>\" --perf --no-build writes every view of poses.json and harness/look_proof/style_<x>/perf.json (frame time p95, fps, draw calls, triangles, load time per view, judged against the draft perf_budgets.json)",
    "node harness/bin/lookproof.mjs --sheet baseline,style_<x>[,other candidates] --out style_options writes harness/reports/look/style_options.jpg and the builder read it",
    "the default look is unchanged: lookproof.mjs --set baseline_check --no-build then --compare baseline_check --against baseline passes",
    "verify --quick passes with no console errors",
    "STYLE_OPTIONS.md has the measured numbers for <x> in place of the estimates, and every estimate that was wrong is marked"
  ]
}
```

What the shots must show (poses.json views, chosen in ADOPT): the hero or main object up close, a typical play space wide, the darkest scene, the HUD over play, and the busiest scene (the perf worst case). Same camera, same moment (hold the sim) for every candidate, so the sheet compares like with like.

Measurements are taken on the target machine when possible. If the build machine is stronger, say so in STYLE_OPTIONS.md and scale the estimate with the baseline ratio, marked as scaled.
