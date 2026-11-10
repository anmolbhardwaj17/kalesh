// window.__game hook contract (docs/GAME_HOOKS.md). The debug part exists only with ?debug=1.
import type * as THREE from 'three';

export interface GameEvent { t: number; w: number; type: string; data?: unknown }

export interface HookDeps {
  version: string;
  renderer: THREE.WebGLRenderer;
  scene: () => string;
  player: () => { pos: [number, number, number]; heading: number; speed: number };
  setInput: (action: string, value: number | boolean | [number, number]) => void;
  load: (id: string) => void;
  teleport: (p: [number, number, number]) => void;
  setCamera: (pose: { pos: [number, number, number]; target: [number, number, number] } | null) => void;
  setHud: (on: boolean) => void;
}

interface Stats { p50: number; p95: number; max: number }
const stats = (a: number[]): Stats => {
  if (!a.length) return { p50: 0, p95: 0, max: 0 };
  const s = [...a].sort((x, y) => x - y);
  const q = (f: number) => s[Math.min(s.length - 1, Math.floor(f * s.length))] ?? 0;
  return { p50: q(0.5), p95: q(0.95), max: s[s.length - 1] ?? 0 };
};

/** Sim clock with time scale and the exact-time sim hold. The game loop calls advance(dt) each frame. */
export class SimClock {
  t = 0;
  scale = 1;
  paused = false;
  holdAt: number | null = null;
  /** Returns the sim dt to use this frame (0 while held). */
  advance(dt: number): number {
    if (this.paused) return 0;
    let d = dt * this.scale;
    if (this.holdAt !== null && this.t + d >= this.holdAt) {
      d = Math.max(0, this.holdAt - this.t);
      this.t = this.holdAt;
      this.paused = true;
      this.holdAt = null;
      return d;
    }
    this.t += d;
    return d;
  }
}

export interface HookRuntime {
  clock: SimClock;
  /** Call after each rendered frame with the CPU ms spent in update + render. */
  frameDone(cpuMs: number): void;
  emit(type: string, data?: unknown): void;
}

export function installHooks(deps: HookDeps): HookRuntime {
  const params = new URLSearchParams(location.search);
  const clock = new SimClock();
  const waiters: Array<() => void> = [];
  const ring: GameEvent[] = [];
  let sampler: { cpu: number[]; frame: number[]; calls: number[]; tris: number[]; last: number } | null = null;
  const g = { ready: false, version: deps.version } as Record<string, unknown>;
  (window as unknown as { __game: unknown }).__game = g;

  const runtime: HookRuntime = {
    clock,
    frameDone(cpuMs) {
      if (sampler) {
        const now = performance.now();
        sampler.cpu.push(cpuMs);
        sampler.frame.push(now - sampler.last);
        sampler.last = now;
        sampler.calls.push(deps.renderer.info.render.calls);
        sampler.tris.push(deps.renderer.info.render.triangles);
      }
      waiters.splice(0).forEach((f) => f());
      if (!g.ready) g.ready = true;
    },
    emit(type, data) {
      ring.push({ t: clock.t, w: performance.now(), type, data });
      if (ring.length > 200) ring.shift();
    },
  };

  if (params.get('debug') !== '1') return runtime;

  const frames = (n: number) =>
    new Promise<void>((resolve) => {
      let k = Math.max(1, n);
      const tick = () => (--k <= 0 ? resolve() : waiters.push(tick));
      waiters.push(tick);
    });

  g.debug = {
    state: () => ({ scene: deps.scene(), level: deps.scene(), milestone: null, player: deps.player() }),
    clock: () => ({ t: clock.t, scale: clock.scale, paused: clock.paused }),
    frames,
    input: (action: string, value: number | boolean | [number, number]) => deps.setInput(action, value),
    perf: async (ms: number) => {
      sampler = { cpu: [], frame: [], calls: [], tris: [], last: performance.now() };
      await new Promise((r) => setTimeout(r, ms));
      const s = sampler;
      sampler = null;
      const avgFrame = s.frame.length ? s.frame.reduce((a, b) => a + b, 0) / s.frame.length : 0;
      const mem = deps.renderer.info.memory;
      return {
        cpuMs: stats(s.cpu),
        gpuNote: 'no GPU timer in the scaffold',
        p95FrameMs: stats(s.frame).p95,
        avgFps: avgFrame > 0 ? 1000 / avgFrame : 0,
        drawCalls: Math.max(0, ...s.calls),
        triangles: Math.max(0, ...s.tris),
        textures: mem.textures,
        geometries: mem.geometries,
      };
    },
    load: async (id: string) => {
      deps.load(id);
      await frames(2);
    },
    teleport: (where: [number, number, number] | string) => {
      if (!Array.isArray(where)) return false;
      deps.teleport(where);
      return true;
    },
    setCamera: deps.setCamera,
    timeScale: (n: number) => {
      clock.scale = n;
    },
    hold: (o: { at?: number; release?: boolean; cancel?: boolean } = {}) => {
      if (o.cancel) clock.holdAt = null;
      if (o.release) clock.paused = false;
      if (o.at !== undefined) clock.holdAt = o.at;
      return { paused: clock.paused, t: clock.t, at: clock.holdAt };
    },
    events: () => ring.slice(),
    hud: (on: boolean) => deps.setHud(on),
  };
  return runtime;
}
