import { readFileSync } from "node:fs";
import { build } from "esbuild";

// The release is the version of the repository's root package.json, like the client's.
const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);

// One self-contained file for the container image: no node_modules at runtime.
await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  // ws is CommonJS and requires Node built-ins; give the ESM bundle a require.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  // Optional native accelerators of ws, absent on purpose.
  external: ["bufferutil", "utf-8-validate"],
  define: { __FRONTFALL_RELEASE__: JSON.stringify(version) },
});
