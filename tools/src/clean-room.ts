import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import ts from "typescript";

/**
 * Clean-room scan: finds code or files in Frontfall that also appear in a
 * reference codebase. Code is compared as token sequences, so whitespace,
 * comments and formatting changes do not hide a copy. Other files are compared
 * by content hash, which catches copied images, maps and data.
 */

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "dist", "coverage"]);

export interface ScanOptions {
  /** Length of the shortest token run reported as a copy. */
  minTokens: number;
  /** Files smaller than this are too generic to compare by hash. */
  minFileBytes: number;
}

export const DEFAULT_OPTIONS: ScanOptions = { minTokens: 60, minFileBytes: 512 };

export interface CopiedCode {
  kind: "code";
  file: string;
  startLine: number;
  endLine: number;
  tokens: number;
}

export interface CopiedFile {
  kind: "file";
  file: string;
}

export type Finding = CopiedCode | CopiedFile;

interface Token {
  text: string;
  line: number;
}

export function tokenize(source: string, fileName: string): Token[] {
  const variant = /\.[jt]sx$/.test(fileName) ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard;
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, variant, source);
  const tokens: Token[] = [];
  // Tokens come in source order, so lines are counted once, from one token to the next.
  let line = 1;
  let counted = 0;
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    const position = scanner.getTokenStart();
    for (; counted < position; counted++) if (source.charCodeAt(counted) === 10) line++;
    tokens.push({ text: scanner.getTokenText(), line });
  }
  return tokens;
}

// Two independent polynomial hashes modulo a 31-bit prime, packed into one
// 53-bit number. Token values have 21 bits and bases 20 bits, so every
// intermediate product stays below 2^53 and floating-point maths is exact.
const MODULUS = 2_147_483_647;
const BASES = [1_000_003, 999_983] as const;

function tokenHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash & 0x1fffff;
}

function power(base: number, exponent: number): number {
  let result = 1;
  for (let i = 0; i < exponent; i++) result = (result * base) % MODULUS;
  return result;
}

/** Hash of every run of `length` consecutive tokens, by starting position. */
export function windowHashes(tokens: readonly Token[], length: number): number[] {
  if (tokens.length < length) return [];
  const values = tokens.map((token) => tokenHash(token.text));
  const [b1, b2] = BASES;
  const top1 = power(b1, length - 1);
  const top2 = power(b2, length - 1);
  let h1 = 0;
  let h2 = 0;
  const hashes: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i >= length) {
      const outgoing = values[i - length] ?? 0;
      h1 = (h1 - ((outgoing * top1) % MODULUS) + MODULUS) % MODULUS;
      h2 = (h2 - ((outgoing * top2) % MODULUS) + MODULUS) % MODULUS;
    }
    const incoming = values[i] ?? 0;
    h1 = (h1 * b1 + incoming) % MODULUS;
    h2 = (h2 * b2 + incoming) % MODULUS;
    if (i >= length - 1) hashes.push(h1 * 2 ** 22 + (h2 % 2 ** 22));
  }
  return hashes;
}

export function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRECTORIES.has(entry.name) ? [] : listFiles(path);
    return entry.isFile() ? [path] : [];
  });
}

function isCode(file: string): boolean {
  return CODE_EXTENSIONS.has(extname(file));
}

function contentHash(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

export interface Reference {
  windows: Set<number>;
  files: Set<string>;
}

export function indexReference(
  directory: string,
  options: ScanOptions = DEFAULT_OPTIONS,
): Reference {
  const reference: Reference = { windows: new Set(), files: new Set() };
  for (const file of listFiles(directory)) {
    if (statSync(file).size >= options.minFileBytes) reference.files.add(contentHash(file));
    if (!isCode(file)) continue;
    const tokens = tokenize(readFileSync(file, "utf8"), file);
    for (const hash of windowHashes(tokens, options.minTokens)) reference.windows.add(hash);
  }
  return reference;
}

/** Token runs of `file` found in the reference, merged into line ranges. */
function copiedCode(file: string, reference: Reference, options: ScanOptions): CopiedCode[] {
  const tokens = tokenize(readFileSync(file, "utf8"), file);
  const copied = new Uint8Array(tokens.length);
  windowHashes(tokens, options.minTokens).forEach((hash, start) => {
    if (reference.windows.has(hash)) copied.fill(1, start, start + options.minTokens);
  });

  const findings: CopiedCode[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!copied[i]) continue;
    let end = i;
    while (end + 1 < tokens.length && copied[end + 1]) end++;
    findings.push({
      kind: "code",
      file,
      startLine: tokens[i]?.line ?? 0,
      endLine: tokens[end]?.line ?? 0,
      tokens: end - i + 1,
    });
    i = end;
  }
  return findings;
}

export function scan(
  files: readonly string[],
  reference: Reference,
  options: ScanOptions = DEFAULT_OPTIONS,
): Finding[] {
  return files.flatMap((file): Finding[] => {
    const findings: Finding[] = [];
    if (statSync(file).size >= options.minFileBytes && reference.files.has(contentHash(file))) {
      findings.push({ kind: "file", file });
    }
    if (isCode(file)) findings.push(...copiedCode(file, reference, options));
    return findings;
  });
}
