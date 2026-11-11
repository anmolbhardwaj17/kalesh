// vitest (vite) reads many files at once with import.meta.glob; this is the one form the tests use (eager, raw text).
interface ImportMeta {
  glob(patterns: string | string[], options: { query: '?raw'; import: 'default'; eager: true }): Record<string, string>;
}
