import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "client", include: ["test/**/*.test.ts"], setupFiles: ["test/setup.ts"] },
});
