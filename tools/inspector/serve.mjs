#!/usr/bin/env node
// Runs the map inspector alone (the dashboard mounts the same handler on its port 4488). Used by the tests and for
// working on the page:  node tools/inspector/serve.mjs [--port 4490] [--data <dir>] [--overrides <dir>] [--inbox <file>] [--game-port N]
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectorHandler } from './server.mjs';

/** Starts the inspector on 127.0.0.1. port 0 picks a free one. Resolves with { server, port, url, close }. */
export function startInspector(options = {}) {
  const handle = inspectorHandler(options);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (!(await handle(req, res, url))) { res.writeHead(404); res.end('not found'); }
  });
  return new Promise((resolve) => {
    server.listen(options.port ?? 0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port, url: `http://localhost:${port}/inspector/`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  const s = await startInspector({ port: Number(arg('--port') ?? 4490), dataDir: arg('--data'), overridesDir: arg('--overrides'), accessFile: arg('--access'), inboxFile: arg('--inbox'), gamePort: arg('--game-port') ? Number(arg('--game-port')) : undefined });
  console.log(`map inspector: ${s.url}`);
}
