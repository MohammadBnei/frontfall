import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/*", "tools", "bench"],
    coverage: {
      provider: "v8",
      include: [
        "packages/*/src/**",
        "apps/server/src/**",
        "apps/client/src/connection.ts",
        "apps/client/src/palette.ts",
        "tools/src/clean-room.ts",
        "apps/client/src/render/**",
        "apps/client/src/input/**",
      ],
      // Entry points and the WebGL glue, which only a browser can run (covered end to end).
      exclude: ["**/index.ts", "apps/server/src/main.ts", "apps/client/src/render/map-view.ts"],
      reporter: ["text", "lcov"],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
