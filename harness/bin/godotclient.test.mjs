import { describe, it, expect } from 'vitest';
import net from 'node:net';
import { lineSplitter, gameArgs, freePort, portOpen, GodotDebugClient } from './godotclient.mjs';

describe('godotclient', () => {
  it('splits a stream into JSON lines across chunk borders', () => {
    const lines = [];
    const push = lineSplitter((l) => lines.push(l));
    push('{"a":1}\n{"b"');
    push(':2}\r\n\n{"c":3}');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    push('\n');
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it('puts engine args before -- and game args after it', () => {
    const a = gameArgs({ project: '/p', port: 5000, quitAfter: 100, extra: ['--style=toon'] });
    const sep = a.indexOf('--');
    expect(a.slice(0, sep)).toEqual(['--path', '/p', '--quit-after', '100', '--resolution', '1280x720']);
    expect(a.slice(sep + 1)).toEqual(['--debug', '--debug-port=5000', '--verify', '--style=toon']);
    const h = gameArgs({ project: '/p', debug: false, verify: false, headless: true, quitAfter: 5 });
    expect(h[0]).toBe('--headless');
    expect(h.slice(h.indexOf('--') + 1)).toEqual([]);
  });

  it('answers requests by id and keeps the latest snapshot (fake game server)', async () => {
    const port = await freePort();
    const server = net.createServer((sock) => {
      sock.on('error', () => {}); // the portOpen probe hangs up at once
      sock.write(JSON.stringify({ type: 'hello', protocol: 1, methods: ['state'] }) + '\n');
      sock.write(JSON.stringify({ type: 'snapshot', frame: 1, clock: { t: 0, scale: 1, paused: false }, hold: { at: null }, events: [{ seq: 1, t: 0, w: 1, type: 'x' }] }) + '\n');
      sock.on('data', lineSplitter((l) => {
        const m = JSON.parse(l);
        const reply = m.method === 'state'
          ? { type: 'response', id: m.id, ok: true, result: { scene: 'scaffold' } }
          : { type: 'response', id: m.id, ok: false, error: `unknown method '${m.method}'` };
        sock.write(JSON.stringify(reply) + '\n');
      }));
    });
    await new Promise((r) => server.listen(port, '127.0.0.1', r));
    expect(await portOpen(port)).toBe(true);
    const c = new GodotDebugClient();
    const hello = await c.connect(port, { timeoutMs: 5000 });
    expect(hello.protocol).toBe(1);
    expect(await c.call('state')).toEqual({ scene: 'scaffold' });
    await expect(c.call('nope')).rejects.toThrow(/unknown method/);
    expect(c.snapshot.frame).toBe(1);
    expect(c.events.map((e) => e.type)).toEqual(['x']);
    c.close();
    await new Promise((r) => server.close(r));
    expect(await portOpen(port, 200)).toBe(false);
  });
});
