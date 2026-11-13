# ui-and-input

One line per gotcha. None yet.
- FPS counter (P1-049): autoload game/ui/fps_counter.gd, not in group hud; off under --verify unless --fps=on or F3; new autoloads and input actions need one import (shoot/test) before a windowed run sees them. Test builds show it via export feature test_build in export_presets.cfg (drop it from a release preset).
