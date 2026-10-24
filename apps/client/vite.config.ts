import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

const { version } = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  // Relative URLs: the same build works at / and behind a path prefix such as /frontfall/.
  base: "./",
  define: {
    // Commit the image is built from; see src/net/build.ts.
    __FRONTFALL_BUILD__: JSON.stringify(process.env.FRONTFALL_VERSION ?? "dev"),
    // Release of the game, from package.json; see src/release.ts.
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
