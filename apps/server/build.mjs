import { readFileSync } from "node:fs";
import { simulationBuild } from "../../tools/simulation-build.mjs";

// The release is the version of the repository's root package.json, like the client's.
const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);

// One self-contained file for the container image, run by Bun: no node_modules at runtime.
const result = await Bun.build({
  entrypoints: ["src/main.ts"],
  outdir: "dist",
  naming: "server.mjs",
  target: "bun",
  format: "esm",
  define: {
    __FRONTFALL_RELEASE__: JSON.stringify(version),
    __FRONTFALL_SIMULATION__: JSON.stringify(simulationBuild()),
  },
});
if (!result.success) {
  for (const message of result.logs) console.error(message);
  process.exit(1);
}
