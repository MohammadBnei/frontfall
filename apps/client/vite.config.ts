import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { simulationBuild } from "../../tools/simulation-build.mjs";

// The release is the version of the repository's root package.json, for the client and the server alike.
const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as {
  version: string;
};

export default defineConfig({
  // Relative URLs: the same build works at / and behind a path prefix such as /frontfall/.
  base: "./",
  define: {
    // Simulation build of the sources, not the commit; see src/net/build.ts.
    __FRONTFALL_SIMULATION__: JSON.stringify(simulationBuild()),
    // Release of the game, from the root package.json; see src/release.ts.
    __FRONTFALL_RELEASE__: JSON.stringify(version),
  },
  build: {
    // Three.js alone is about 500 kB minified; it is cached across releases.
    chunkSizeWarningLimit: 700,
  },
  server: {
    proxy: {
      "/ws": { target: "ws://localhost:8080", ws: true },
    },
  },
});
