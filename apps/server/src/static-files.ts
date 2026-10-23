import { readFile, stat } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { extname, join, normalize, sep } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
};

/** Types worth compressing. Images and fonts are compressed already. */
const COMPRESSIBLE = new Set([
  ".html",
  ".js",
  ".css",
  ".json",
  ".webmanifest",
  ".svg",
  ".bin",
  ".wasm",
]);

/** Below this size, gzip headers cost more than they save. */
const MIN_COMPRESSED_SIZE = 1024;

export interface StaticFile {
  body: Buffer;
  contentType: string;
  /** Gzip version of the body, when compressing is worth it. */
  gzip?: Buffer;
}

/**
 * Compressed bodies, by path and modification time. Built files only change
 * with a new image, so each one is compressed once per process.
 */
const gzipCache = new Map<string, Buffer>();

function compressed(path: string, modified: number, body: Buffer): Buffer | undefined {
  if (!COMPRESSIBLE.has(extname(path)) || body.length < MIN_COMPRESSED_SIZE) return undefined;
  const key = `${path}:${String(modified)}`;
  let gzip = gzipCache.get(key);
  if (!gzip) {
    gzip = gzipSync(body, { level: 9 });
    gzipCache.set(key, gzip);
  }
  return gzip.length < body.length ? gzip : undefined;
}

/**
 * Resolves a request path to a file inside `root`, or undefined when the file
 * does not exist or the path tries to leave the root. "/" serves index.html.
 */
export async function loadStaticFile(
  root: string,
  requestPath: string,
): Promise<StaticFile | undefined> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0")) return undefined;

  const relative = normalize(decoded === "/" ? "/index.html" : decoded);
  const absolute = join(root, relative);
  if (!absolute.startsWith(root.endsWith(sep) ? root : root + sep)) return undefined;

  try {
    const info = await stat(absolute);
    if (!info.isFile()) return undefined;
    const body = await readFile(absolute);
    const gzip = compressed(absolute, info.mtimeMs, body);
    return {
      body,
      contentType: CONTENT_TYPES[extname(absolute)] ?? "application/octet-stream",
      ...(gzip && { gzip }),
    };
  } catch {
    return undefined;
  }
}
