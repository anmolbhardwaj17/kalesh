// The few Node modules the bake driver and its source readers use (P1-007). The repo has no @types/node on purpose
// (tsconfig `types: []`): only tools/bake/main.ts and tools/bake/sources/ may touch files and the network, and
// tools/bake/purity.test.ts fails any other bake file that imports these modules or calls fetch.
declare module 'node:fs' {
  interface Stats {
    size: number;
    isFile(): boolean;
    isDirectory(): boolean;
  }
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function writeFileSync(path: string, data: string | Uint8Array): void;
  export function mkdirSync(path: string, opts?: { recursive?: boolean }): void;
  export function mkdtempSync(prefix: string): string;
  export function rmSync(path: string, opts?: { recursive?: boolean; force?: boolean }): void;
  export function renameSync(from: string, to: string): void;
  export function statSync(path: string): Stats;
  export function openSync(path: string, flags: string): number;
  export function readSync(fd: number, buf: Uint8Array, offset: number, length: number, position: number | null): number;
  export function closeSync(fd: number): void;
  export function readdirSync(path: string): string[];
  const fs: {
    existsSync: typeof existsSync;
    readFileSync: typeof readFileSync;
    writeFileSync: typeof writeFileSync;
    mkdirSync: typeof mkdirSync;
    mkdtempSync: typeof mkdtempSync;
    rmSync: typeof rmSync;
    renameSync: typeof renameSync;
    statSync: typeof statSync;
    openSync: typeof openSync;
    readSync: typeof readSync;
    closeSync: typeof closeSync;
    readdirSync: typeof readdirSync;
  };
  export default fs;
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export function dirname(p: string): string;
  export function relative(from: string, to: string): string;
  export function isAbsolute(p: string): boolean;
  const path: { join: typeof join; resolve: typeof resolve; dirname: typeof dirname; relative: typeof relative; isAbsolute: typeof isAbsolute };
  export default path;
}

declare module 'node:crypto' {
  interface Hash {
    update(data: string | Uint8Array): Hash;
    digest(encoding: 'hex'): string;
  }
  export function createHash(algorithm: 'sha256'): Hash;
}

declare module 'node:os' {
  export function tmpdir(): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string): string;
}

/** Node and vite both give modules their own URL. */
interface ImportMeta {
  url: string;
}
