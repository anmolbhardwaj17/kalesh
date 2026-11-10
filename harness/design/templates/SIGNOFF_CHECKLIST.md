# Style sign-off checklist (Phase 0)

Work through this list after the owner's explicit yes, before the style task is marked done. Each line is checked with a command or a file.

## The sign-off itself
- [ ] The owner said yes in his own words to a named style, after seeing the side by side sheet and the measured numbers.
- [ ] `node harness/bin/task.mjs signoff "<his exact words>"` ran; `task.mjs status` no longer prints "style sign-off: not yet".
- [ ] decisions.md has the entry with the quote, the date and the chosen candidate.

## Documents
- [ ] STYLE_OPTIONS.md: the chosen column marked, the decision log ends with the quote, every estimate replaced or marked.
- [ ] STYLE_BIBLE.md written from its template: one-line look, palette with hex, lighting presets, readability floor with numbers, materials and shading, scale and camera, shapes, characters, effects, UI, performance budget of the look, approved shots, AI image prompts (anchors and tails per asset kind), audio prompt style. Status line says signed with the date.
- [ ] VERIFY.md: rubric lines for this style added (14 and on), each checkable on a shot.
- [ ] TECH.md "Render pipeline" says how the style is built and what each preset turns off.

## Numbers
- [ ] `harness/verify/perf_budgets.json` status "signed", target machine filled, numbers the owner agreed.
- [ ] `harness/verify/look_rules.json` tolerances set just above the run to run noise (two `--set` runs of the same build compared).
- [ ] `node harness/bin/lookproof.mjs --approve style_<chosen>` ran; `harness/look_proof/approved.json` names it.

## Code
- [ ] The chosen style is the default look (the `?style=` switch promoted or kept), or a task exists to make it so as the first task of the next phase.
- [ ] Rejected candidates' code removed or left behind the param with a decisions.md line.
- [ ] `verify --quick` green.

## Planning
- [ ] The planner planned the next phases from the game's current state (`task.mjs phase-add`), with style adoption across the existing content first.
- [ ] `node harness/bin/task.mjs gate P0` passes after `verify --all`.
- [ ] From here on: never wait for the owner.
