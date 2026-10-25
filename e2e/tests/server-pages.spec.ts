import { expect, test } from "@playwright/test";

// What any server of the game answers, the public one or one hosted elsewhere.

test("reports its build on /healthz", async ({ request }) => {
  const health = await request.get("healthz");
  expect(health.status()).toBe(200);
  expect(await health.text()).toBe("ok");
  expect(health.headers()["x-frontfall-version"]).toBeTruthy();
});

test("shows its status page", async ({ request }) => {
  const status = await request.get("status");
  expect(status.status()).toBe(200);
  expect(status.headers()["content-type"]).toContain("text/html");
});

test("serves the page under a policy that keeps it out of frames", async ({ request }) => {
  test.skip(test.info().project.name === "prefix", "the test proxy sets a policy of its own");
  const page = await request.get("./");
  const policy = page.headers()["content-security-policy"] ?? "";
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("frame-ancestors 'none'");
});
