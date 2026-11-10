// Picks the game driver from kit.config.json "target" (P0-026): "godot" runs the Godot game (godotdriver.mjs), "web"
// runs the built page in Chromium (browser.mjs, kept for the later web demo). verify.mjs and shoot.mjs use the driver
// they get here and never import a driver directly.
import { config } from './lib.mjs';

export const TARGETS = ['godot', 'web'];

/** The target name: kit.config.json "target", or HARNESS_TARGET to override it for one run. */
export function targetName(cfg = config(), env = process.env) {
  const t = String(env.HARNESS_TARGET || cfg.target || 'web');
  if (!TARGETS.includes(t)) throw new Error(`unknown target "${t}" in kit.config.json (targets: ${TARGETS.join(', ')})`);
  return t;
}

export async function loadDriver(cfg = config(), env = process.env) {
  const t = targetName(cfg, env);
  const mod = t === 'godot' ? await import('./godotdriver.mjs') : await import('./browser.mjs');
  return { target: t, ...mod, kind: t };
}
