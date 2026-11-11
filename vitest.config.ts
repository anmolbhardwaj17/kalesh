import { defineConfig } from 'vitest/config';

// Unit tests: the offline bake tooling in tools/ (TypeScript) and the harness scripts. The game itself is Godot: its
// tests run through npm run test:godot (game/tests/).
export default defineConfig({
  test: { testTimeout: 30000, include: ['tools/**/*.test.ts', 'tools/**/*.test.mjs', 'harness/bin/**/*.test.mjs', 'harness/bench/**/*.test.mjs'] },
});
