import { expect, test, type Page } from "@playwright/test";

/** Cloudflare Web Analytics, injected by the proxy in front of the public server. */
const PROXY_INJECTED = process.env.E2E_BASE_URL
  ? ["https://static.cloudflareinsights.com/", "https://cloudflareinsights.com/"]
  : [];

/** Public games wait for a second player, then count down (30 s in production). */
const GAME_START_TIMEOUT = 60_000;

const turnOf = async (page: Page): Promise<number> =>
  Number((await page.locator("#status").textContent())?.split(" ")[1]);

test("two players meet in a public game without leaving the base path", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(GAME_START_TIMEOUT + 30_000);
  if (!baseURL) throw new Error("baseURL is not configured");
  const first = await browser.newPage();
  const second = await browser.newPage();
  const requested: string[] = [];
  const sockets: string[] = [];
  const pageErrors: Error[] = [];
  for (const page of [first, second]) {
    page.on("request", (request) => requested.push(request.url()));
    page.on("websocket", (socket) => sockets.push(socket.url()));
    page.on("pageerror", (error) => pageErrors.push(error));
  }

  // Solo players stay offline: ?online asks for the next public game.
  const lobby = new URL("?online", baseURL).href;
  await first.goto(lobby);
  await expect(first.locator("#status")).toHaveText(/^(Waiting for players|Starting in)/, {
    timeout: 15_000,
  });
  await second.goto(lobby);

  for (const page of [first, second]) {
    await expect(page.locator("#status")).toHaveText(/^Turn \d+$/, {
      timeout: GAME_START_TIMEOUT,
    });
  }
  const turn = await turnOf(second);
  await expect.poll(() => turnOf(second)).toBeGreaterThan(turn);

  expect(pageErrors).toEqual([]);
  const socketUrl = new URL("ws", baseURL).href.replace(/^http/, "ws");
  expect(sockets).toEqual([socketUrl, socketUrl]);
  const outside = requested.filter(
    (url) =>
      !url.startsWith(baseURL) &&
      !url.startsWith("data:") &&
      !PROXY_INJECTED.some((host) => url.startsWith(host)),
  );
  expect(outside).toEqual([]);
});

test("lists public games as JSON", async ({ request, baseURL }) => {
  const response = await request.get(new URL("api/games", baseURL).href);
  expect(response.ok()).toBe(true);
  // The server sends no-store; the production proxy rewrites it to no-cache, which is as good.
  expect(response.headers()["cache-control"]).toMatch(/^no-(store|cache)$/);
  expect(await response.json()).toHaveProperty("games");
});

test("keeps the metrics private behind the proxy", async ({ request, baseURL }) => {
  test.skip(!baseURL?.endsWith("/frontfall/"), "only a proxied server hides its metrics");
  const response = await request.get(new URL("metrics", baseURL).href);
  expect(response.status()).toBe(404);
});
