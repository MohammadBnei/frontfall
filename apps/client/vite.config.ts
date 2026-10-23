import { defineConfig } from "vite";

export default defineConfig({
  // Relative URLs: the same build works at / and behind a path prefix such as /frontfall/.
  base: "./",
  define: {
    // Commit the image is built from; see src/net/build.ts.
    __FRONTFALL_BUILD__: JSON.stringify(process.env.FRONTFALL_VERSION ?? "dev"),
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
