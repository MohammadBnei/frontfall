import { expect, test } from "@playwright/test";

/** Cloudflare Web Analytics, injected by the proxy in front of the public server. */
const PROXY_INJECTED = process.env.E2E_BASE_URL
  ? ["https://static.cloudflareinsights.com/", "https://cloudflareinsights.com/"]
  : [];

test("loads the game and joins a lobby without leaving its base path", async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error("baseURL is not configured");
  const requested: string[] = [];
  const sockets: string[] = [];
  page.on("request", (request) => requested.push(request.url()));
  page.on("websocket", (socket) => sockets.push(socket.url()));
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.goto("./");
  await expect(page.locator("#status")).toHaveText(/^(Connected as p\d+|Turn \d+)$/, {
    timeout: 15_000,
  });

  expect(pageErrors).toEqual([]);
  expect(sockets).toEqual([new URL("ws", baseURL).href.replace(/^http/, "ws")]);
  const outside = requested.filter(
    (url) =>
      !url.startsWith(baseURL) &&
      !url.startsWith("data:") &&
      !PROXY_INJECTED.some((host) => url.startsWith(host)),
  );
  expect(outside).toEqual([]);
});

test("keeps receiving turns from the server", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator("#status")).toHaveText(/^Turn \d+$/, { timeout: 15_000 });
  const first = Number((await page.locator("#status").textContent())?.split(" ")[1]);
  await expect
    .poll(async () => Number((await page.locator("#status").textContent())?.split(" ")[1]))
    .toBeGreaterThan(first);
});
