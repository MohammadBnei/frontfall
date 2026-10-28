import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

/** One group of files of the client build with a ceiling on what it costs to download. */
export interface SizeBudget {
  readonly name: string;
  /** Matched against the path in the build, with forward slashes. */
  readonly files: string;
  /** Files matched by `files` that do not count. */
  readonly except?: string;
  /**
   * Also counts every script and style that index.html loads up front
   * (scripts, stylesheets, modulepreload), whatever its name: a chunk the
   * bundler splits off the entry is still part of the first visit.
   */
  readonly loadedByPage?: boolean;
  /** Ceiling on the bytes sent, gzip-compressed where the server compresses, in kB (1,000 bytes). */
  readonly kB: number;
}

export interface SizeResult {
  readonly name: string;
  readonly files: number;
  readonly raw: number;
  /** As the game server sends it: gzip for text and map files, as is otherwise. */
  readonly sent: number;
  /** With Brotli (quality 9) instead of gzip, as a CDN in front of the server may send it. */
  readonly brotli: number;
  readonly budget: number;
}

/** File types the game server compresses (apps/server/src/static-files.ts). */
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
/** Same as the server: below this size, a file is sent as is. */
const MIN_COMPRESSED_SIZE = 1024;

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

/** Scripts and styles of the build that the page loads before anything else. */
export function loadedByPage(html: string): Set<string> {
  return new Set(
    [...html.matchAll(/\s(?:src|href)="(?:\.\/)?([^":?#]+\.(?:js|css))"/g)].map(
      (match) => match[1] as string,
    ),
  );
}

/** What each budget's files cost in the build in `dist`. */
export function measureSizes(dist: string, budgets: readonly SizeBudget[]): SizeResult[] {
  const files = listFiles(dist).map((path) => {
    const body = readFileSync(path);
    const compress = COMPRESSIBLE.has(extname(path)) && body.length >= MIN_COMPRESSED_SIZE;
    return {
      path: relative(dist, path).split("\\").join("/"),
      raw: body.length,
      sent: compress ? gzipSync(body).length : body.length,
      brotli: compress
        ? brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }).length
        : body.length,
    };
  });
  return budgets.map((budget) => {
    const include = new RegExp(budget.files);
    const exclude = budget.except === undefined ? undefined : new RegExp(budget.except);
    const loaded = budget.loadedByPage
      ? loadedByPage(readFileSync(join(dist, "index.html"), "utf8"))
      : new Set<string>();
    const matched = files.filter(
      (f) => (include.test(f.path) || loaded.has(f.path)) && !exclude?.test(f.path),
    );
    if (matched.length === 0)
      throw new Error(`no file of the build matches the budget "${budget.name}"`);
    const sum = (key: "raw" | "sent" | "brotli") => matched.reduce((total, f) => total + f[key], 0);
    return {
      name: budget.name,
      files: matched.length,
      raw: sum("raw"),
      sent: sum("sent"),
      brotli: sum("brotli"),
      budget: budget.kB * 1000,
    };
  });
}
