// The network side of the bake (P1-007): every request of every source reader goes through one `Net`, so a test can
// hand in a fake and count requests. Only this folder and tools/bake/main.ts may touch the network.
//
// No project or personal detail is sent to outside services: the client name is a plain string.
export const USER_AGENT = 'map-bake-fetch/1.0';

/** The part of a fetch Response the readers use. */
export interface NetResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface NetRequest {
  method?: 'GET' | 'POST' | 'HEAD';
  headers?: Record<string, string>;
  /** Form body (application/x-www-form-urlencoded). */
  form?: Record<string, string>;
  timeoutMs?: number;
}

/** A window of a remote GeoTIFF: raw values, row 0 north. */
export interface TiffWindow {
  west: number;
  north: number;
  dLon: number;
  dLat: number;
  width: number;
  height: number;
  values: number[];
  scale: number;
  offset: number;
  noData: number | null;
  /** True when a value belongs to the cell corner (GeoTIFF PixelIsPoint). */
  pixelIsPoint: boolean;
  meta: Record<string, unknown>;
}

export interface Net {
  /** One HTTP request (the caller retries through `withRetry`). */
  request(url: string, req?: NetRequest): Promise<NetResponse>;
  /** Reads a window (degrees) of a cloud optimised GeoTIFF with range requests. */
  tiffWindow(url: string, box: { south: number; west: number; north: number; east: number }): Promise<TiffWindow>;
  /** Runs DuckDB statements (httpfs and spatial loaded) that write their result to `outFile`. */
  duckdb(statements: string[], outFile: string): Promise<void>;
  /** The pause between tries (tests pass one that does not wait). */
  pause?: (ms: number) => Promise<void>;
}

const timers = globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown };
const sleep = (ms: number): Promise<void> => new Promise((r) => timers.setTimeout(r, ms));

/** An error that no retry can fix (the network is switched off): withRetry gives up at once and the stage does not
 * mark the source unreachable. */
export class OfflineError extends Error {
  readonly offline = true;
}
export const isOffline = (e: unknown): boolean => e instanceof Error && (e as { offline?: boolean }).offline === true;

/** Calls `fn` up to `tries` times with a growing pause; an HTTP 429 or 5xx counts as a failure. Throws the last error. */
export async function withRetry<T>(what: string, fn: () => Promise<T>, tries = 3, pauseMs = 3000, pause: (ms: number) => Promise<void> = sleep): Promise<T> {
  let last: unknown = null;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (isOffline(e)) throw e;
      if (i < tries - 1) await pause(pauseMs * (i + 1));
    }
  }
  throw new Error(`${what}: ${last instanceof Error ? last.message : String(last)} (after ${tries} tries)`);
}

/** A response that is not 2xx becomes an error (so withRetry tries again on 429 and 5xx). */
export function okOrThrow(res: NetResponse, url: string): NetResponse {
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res;
}

type FetchFn = (url: string, init: Record<string, unknown>) => Promise<NetResponse>;
interface Globals {
  fetch: FetchFn;
  AbortSignal: { timeout(ms: number): unknown };
  URLSearchParams: new (init: Record<string, string>) => { toString(): string };
}
const g = globalThis as unknown as Globals;

interface GeoTiffImage {
  getOrigin(): number[];
  getResolution(): number[];
  getWidth(): number;
  getHeight(): number;
  getGDALNoData(): number | null;
  getGDALMetadata(sample?: number): Record<string, unknown> | null;
  getGeoKeys(): Record<string, unknown> | null;
  readRasters(opts: { window: number[] }): Promise<ArrayLike<number>[]>;
}

/** The real network: Node's fetch, geotiff.js over HTTP ranges, DuckDB for Node. */
export function realNet(): Net {
  return {
    async request(url, req = {}) {
      const headers: Record<string, string> = { 'User-Agent': USER_AGENT, ...(req.headers ?? {}) };
      let body: string | undefined;
      if (req.form) {
        body = new g.URLSearchParams(req.form).toString();
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
      }
      return g.fetch(url, { method: req.method ?? (body ? 'POST' : 'GET'), headers, body, signal: g.AbortSignal.timeout(req.timeoutMs ?? 120_000) });
    },
    async tiffWindow(url, box) {
      const geotiff = (await import('geotiff')) as unknown as { fromUrl(u: string, o: Record<string, unknown>): Promise<{ getImage(): Promise<GeoTiffImage> }> };
      const tiff = await geotiff.fromUrl(url, { headers: { 'User-Agent': USER_AGENT } });
      return readWindow(await tiff.getImage(), box);
    },
    async duckdb(statements, outFile) {
      const { DuckDBInstance } = await import('@duckdb/node-api');
      const db = await DuckDBInstance.create(':memory:');
      const con = await db.connect();
      await con.run("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2';");
      for (const s of statements) await con.run(s.replaceAll('$OUT', outFile.replaceAll("'", "''")));
      con.closeSync();
      db.closeSync();
    },
  };
}

/** Reads the window of an opened GeoTIFF image that covers a box (degrees), clamped to the image. */
export async function readWindow(image: GeoTiffImage, box: { south: number; west: number; north: number; east: number }): Promise<TiffWindow> {
  const [ox = 0, oy = 0] = image.getOrigin();
  const [rx = 1, ry = -1] = image.getResolution();
  const x0 = Math.max(0, Math.floor((box.west - ox) / rx));
  const x1 = Math.min(image.getWidth(), Math.ceil((box.east - ox) / rx));
  const y0 = Math.max(0, Math.floor((box.north - oy) / ry));
  const y1 = Math.min(image.getHeight(), Math.ceil((box.south - oy) / ry));
  if (x1 <= x0 || y1 <= y0) throw new Error('the box is outside the GeoTIFF');
  const rasters = await image.readRasters({ window: [x0, y0, x1, y1] });
  const meta = image.getGDALMetadata(0) ?? {};
  const band = rasters[0];
  if (!band) throw new Error('the GeoTIFF window has no band');
  return {
    west: ox + x0 * rx, north: oy + y0 * ry, dLon: rx, dLat: ry, width: x1 - x0, height: y1 - y0, values: Array.from(band),
    scale: Number(meta['SCALE'] ?? 1), offset: Number(meta['OFFSET'] ?? 0), noData: image.getGDALNoData(),
    pixelIsPoint: image.getGeoKeys()?.['GTRasterTypeGeoKey'] === 2, meta,
  };
}
