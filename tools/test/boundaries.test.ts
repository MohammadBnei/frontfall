import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => join(entry.parentPath, entry.name));
}

/** Every module a package's sources import, as written, with the importing file. */
function imports(packageDir: string): { file: string; specifier: string }[] {
  return sourceFiles(join(root, packageDir, "src")).flatMap((file) =>
    ts
      .preProcessFile(readFileSync(file, "utf8"), true, true)
      .importedFiles.map(({ fileName }) => ({ file, specifier: fileName })),
  );
}

function escapes(file: string, specifier: string, packageDir: string): boolean {
  const target = relative(join(root, packageDir), resolve(dirname(file), specifier));
  return target.startsWith("..") || target.startsWith(sep);
}

/** Whether an allow list names a module: exactly, or by a prefix ending in `*` such as `node:*`. */
function allows(allowed: string[], specifier: string): boolean {
  return allowed.some((entry) =>
    entry.endsWith("*") ? specifier.startsWith(entry.slice(0, -1)) : entry === specifier,
  );
}

/** Imports that leave the package and are not in its allow list of bare modules. */
function violations(packageDir: string, allowed: string[]): string[] {
  return imports(packageDir)
    .filter(({ file, specifier }) =>
      specifier.startsWith(".")
        ? escapes(file, specifier, packageDir)
        : !allows(allowed, specifier),
    )
    .map(({ file, specifier }) => `${relative(root, file)} imports ${specifier}`);
}

describe("package boundaries", () => {
  it("lets the engine depend on the contracts only", () => {
    expect(violations("packages/engine", ["@frontfall/contracts"])).toEqual([]);
    const manifest = JSON.parse(
      readFileSync(join(root, "packages/engine/package.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(manifest.dependencies).toEqual({ "@frontfall/contracts": "workspace:*" });
  });

  it("lets the protocol depend on zod and the contracts only", () => {
    expect(violations("packages/protocol", ["zod", "@frontfall/contracts"])).toEqual([]);
  });

  it("keeps the contracts free of any dependency", () => {
    expect(violations("packages/contracts", [])).toEqual([]);
    const manifest = JSON.parse(
      readFileSync(join(root, "packages/contracts/package.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(manifest.dependencies).toBeUndefined();
  });

  it("detects an import that reaches into an app", () => {
    const file = join(root, "packages/engine/src/x.ts");
    expect(escapes(file, "../../../apps/client/src/main.ts", "packages/engine")).toBe(true);
    expect(escapes(file, "./random.ts", "packages/engine")).toBe(false);
  });
});

/**
 * The modules a source file needs at run time, as written: `import type`,
 * imports of types only and `export type` are left out, since they are
 * erased and cannot make a cycle when the code runs.
 */
function runtimeSpecifiers(source: string): string[] {
  const file = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, false);
  const found: string[] = [];
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      const bindings = clause?.namedBindings;
      const typesOnly =
        clause !== undefined &&
        (clause.phaseModifier === ts.SyntaxKind.TypeKeyword ||
          (clause.name === undefined &&
            bindings !== undefined &&
            ts.isNamedImports(bindings) &&
            bindings.elements.length > 0 &&
            bindings.elements.every((element) => element.isTypeOnly)));
      if (!typesOnly && ts.isStringLiteral(statement.moduleSpecifier)) {
        found.push(statement.moduleSpecifier.text);
      }
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      const clause = statement.exportClause;
      const typesOnly =
        statement.isTypeOnly ||
        (clause !== undefined &&
          ts.isNamedExports(clause) &&
          clause.elements.length > 0 &&
          clause.elements.every((element) => element.isTypeOnly));
      if (!typesOnly && ts.isStringLiteral(statement.moduleSpecifier)) {
        found.push(statement.moduleSpecifier.text);
      }
    }
  }
  return found;
}

/** Each source file of a package, with the files of the same package it imports at run time. */
function runtimeGraph(packageDir: string): Map<string, string[]> {
  const files = sourceFiles(join(root, packageDir, "src"));
  const known = new Set(files);
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const targets = runtimeSpecifiers(readFileSync(file, "utf8"))
      .filter((specifier) => specifier.startsWith("."))
      .map((specifier) => resolve(dirname(file), specifier))
      .filter((target) => known.has(target));
    graph.set(
      relative(root, file),
      [...new Set(targets)].map((target) => relative(root, target)),
    );
  }
  return graph;
}

/** Every import cycle of a graph, once each, as the files along it from its first file in sort order. */
function cycles(graph: ReadonlyMap<string, readonly string[]>): string[][] {
  const found = new Map<string, string[]>();
  const state = new Map<string, "open" | "done">();
  const path: string[] = [];
  const visit = (file: string): void => {
    state.set(file, "open");
    path.push(file);
    for (const next of graph.get(file) ?? []) {
      if (state.get(next) === "open") {
        const cycle = path.slice(path.indexOf(next));
        const first = cycle.indexOf([...cycle].sort()[0] as string);
        const rotated = [...cycle.slice(first), ...cycle.slice(0, first)];
        found.set(rotated.join(" -> "), rotated);
      } else if (state.get(next) === undefined) {
        visit(next);
      }
    }
    path.pop();
    state.set(file, "done");
  };
  for (const file of [...graph.keys()].sort()) if (state.get(file) === undefined) visit(file);
  return [...found.values()];
}

/** The workspaces whose sources the cycle rule covers. */
const WORKSPACES = ["packages", "apps"].flatMap((group) =>
  readdirSync(join(root, group), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${group}/${entry.name}`),
);

describe("package rules (ADR 0014)", () => {
  it("lets the server use the protocol, zod, its mail and socket modules and the runtime only", () => {
    expect(
      violations("apps/server", [
        "@frontfall/protocol",
        "zod",
        "nodemailer",
        "ws",
        "node:*",
        "bun:*",
      ]),
    ).toEqual([]);
  });

  it("matches allow list entries exactly or by prefix", () => {
    expect(allows(["node:*", "zod"], "node:fs/promises")).toBe(true);
    expect(allows(["node:*", "zod"], "zod")).toBe(true);
    expect(allows(["node:*", "zod"], "zod/mini")).toBe(false);
    expect(allows(["node:*"], "nodemailer")).toBe(false);
  });

  it.each(WORKSPACES)("finds no import cycle at run time in %s", (workspace) => {
    expect(cycles(runtimeGraph(workspace)).map((cycle) => cycle.join(" -> "))).toEqual([]);
  });

  it("reads what a file needs at run time, leaving out types", () => {
    const source = [
      'import type { A } from "./a.ts";',
      'import { type B, type C } from "./b.ts";',
      'import { D, type E } from "./d.ts";',
      'import F from "./f.ts";',
      'import * as G from "./g.ts";',
      'import "./h.ts";',
      'export type { I } from "./i.ts";',
      'export { type J } from "./j.ts";',
      'export { K } from "./k.ts";',
      'export * from "./l.ts";',
    ].join("\n");
    expect(runtimeSpecifiers(source)).toEqual([
      "./d.ts",
      "./f.ts",
      "./g.ts",
      "./h.ts",
      "./k.ts",
      "./l.ts",
    ]);
  });

  it("names each cycle once, from its first file", () => {
    const graph = new Map([
      ["b.ts", ["c.ts"]],
      ["c.ts", ["a.ts", "d.ts"]],
      ["a.ts", ["b.ts"]],
      ["d.ts", ["d.ts"]],
      ["e.ts", ["a.ts"]],
    ]);
    expect(cycles(graph)).toEqual([["a.ts", "b.ts", "c.ts"], ["d.ts"]]);
  });
});
