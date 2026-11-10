import { describe, expect, it } from 'vitest';
import { installHooks, SimClock } from './hooks';

describe('SimClock', () => {
  it('advances by dt times scale', () => {
    const c = new SimClock();
    c.scale = 2;
    c.advance(0.5);
    expect(c.t).toBeCloseTo(1);
  });
  it('holds exactly at the requested time and stays held', () => {
    const c = new SimClock();
    c.holdAt = 0.25;
    for (let i = 0; i < 10; i++) c.advance(0.1);
    expect(c.t).toBe(0.25);
    expect(c.paused).toBe(true);
    c.paused = false;
    c.advance(0.1);
    expect(c.t).toBeCloseTo(0.35);
  });
});

describe('installHooks without ?debug=1', () => {
  const stubRenderer = { info: { render: { calls: 0, triangles: 0 }, memory: { textures: 0, geometries: 0 } } };
  const deps = {
    version: 'test',
    renderer: stubRenderer as never,
    scene: () => 'test',
    player: () => ({ pos: [0, 0, 0] as [number, number, number], heading: 0, speed: 0 }),
    setInput: () => {},
    load: () => {},
    teleport: () => {},
    setCamera: () => {},
    setHud: () => {},
  };
  const open = (search: string) => {
    const g = globalThis as unknown as Record<string, unknown>;
    g.location = { search };
    g.window = {};
    installHooks(deps);
    return (g.window as { __game: { ready: boolean; version: string; debug?: unknown } }).__game;
  };
  it('exposes ready and version but no debug part', () => {
    const game = open('');
    expect(game.version).toBe('test');
    expect(game.ready).toBe(false);
    expect('debug' in game).toBe(false);
    expect(game.debug).toBeUndefined();
  });
  it('the harness params verify=1 or quality=low alone do not turn debug on', () => {
    expect(open('?verify=1&quality=low').debug).toBeUndefined();
  });
  it('exposes the debug part with debug=1', () => {
    expect(typeof (open('?debug=1&verify=1').debug as { state: unknown }).state).toBe('function');
  });
});
