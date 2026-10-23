import { defineConfig, devices } from "@playwright/test";

const SERVER_PORT = 8090;
const PROXY_PORT = 8091;

/** A deployed game to test instead of the local build, such as https://nclsmgr.com/frontfall/. */
const remote = process.env.E2E_BASE_URL;

const local = {
  projects: [
    {
      name: "root",
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${String(SERVER_PORT)}/` },
    },
    {
      name: "prefix",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${String(PROXY_PORT)}/frontfall/`,
      },
    },
  ],
  webServer: [
    {
      command: "node ../apps/server/dist/server.mjs",
      env: {
        PORT: String(SERVER_PORT),
        FRONTFALL_STATIC: "../apps/client/dist",
        FRONTFALL_COUNTDOWN_SECONDS: "2",
      },
      url: `http://127.0.0.1:${String(SERVER_PORT)}/healthz`,
      reuseExistingServer: false,
    },
    {
      command: "node src/prefix-proxy.ts",
      env: { PROXY_PORT: String(PROXY_PORT), UPSTREAM_PORT: String(SERVER_PORT) },
      url: `http://127.0.0.1:${String(PROXY_PORT)}/frontfall/healthz`,
      reuseExistingServer: false,
    },
  ],
};

/** Runs against the production build (`pnpm build` first), or against E2E_BASE_URL. */
export default defineConfig({
  testDir: "tests",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { trace: "retain-on-failure" },
  ...(remote
    ? { projects: [{ name: "remote", use: { ...devices["Desktop Chrome"], baseURL: remote } }] }
    : local),
});
