import { expect, test, type Page } from "@playwright/test";

/** Cloudflare Web Analytics, injected by the proxy in front of the public server. */
const PROXY_INJECTED = process.env.E2E_BASE_URL
  ? ["https://static.cloudflareinsights.com/", "https://cloudflareinsights.com/"]
  : [];

/** The map loads, then the server starts the game. */
const GAME_START_TIMEOUT = 60_000;

/** Seconds of play the HUD clock shows, as "m:ss of …". */
const clockOf = async (page: Page): Promise<number> => {
  const text = (await page.locator(".goal-clock").textContent()) ?? "";
  const [minutes, seconds] = text.split(" ")[0]?.split(":").map(Number) ?? [];
  return (minutes ?? 0) * 60 + (seconds ?? 0);
};

test("two players meet in a private game without leaving the base path", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(GAME_START_TIMEOUT + 30_000);
  if (!baseURL) throw new Error("baseURL is not configured");
  const host = await browser.newPage();
  const guest = await browser.newPage();
  const requested: string[] = [];
  const sockets: string[] = [];
  const pageErrors: Error[] = [];
  for (const page of [host, guest]) {
    page.on("request", (request) => requested.push(request.url()));
    page.on("websocket", (socket) => sockets.push(socket.url()));
    page.on("pageerror", (error) => pageErrors.push(error));
  }

  // A private game: the smoke test after a deployment never sits in the public queue.
  await host.goto(baseURL);
  await host.locator("#player-name").fill("Host");
  await host.locator("#online-create").click();
  const invite = host.locator("#invite-link");
  await expect(invite).toHaveValue(/[?&]game=/, { timeout: 15_000 });
  const link = await invite.inputValue();
  expect(link.startsWith(baseURL)).toBe(true);

  await guest.goto(link);
  await expect(host.locator("#lobby-players li")).toHaveCount(2, { timeout: 15_000 });
  await expect(guest.locator("#lobby-start")).toBeHidden();
  await host.locator("#lobby-start").click();

  for (const page of [host, guest]) {
    await expect(page.locator("#map canvas")).toBeVisible({ timeout: GAME_START_TIMEOUT });
    await expect(page.locator(".leaderboard")).toContainText("Host");
  }
  // Both clocks run on the server's turns.
  const start = await clockOf(guest);
  await expect.poll(() => clockOf(guest), { timeout: 10_000 }).toBeGreaterThan(start);
  await expect.poll(() => clockOf(host), { timeout: 10_000 }).toBeGreaterThan(start);

  expect(pageErrors).toEqual([]);
  const socketUrl = new URL("ws", baseURL).href.replace(/^http/, "ws");
  expect(sockets).toEqual([socketUrl, socketUrl]);
  const outside = requested.filter(
    (url) =>
      !url.startsWith(baseURL) &&
      !url.startsWith("data:") &&
      !PROXY_INJECTED.some((prefix) => url.startsWith(prefix)),
  );
  expect(outside).toEqual([]);
});

test("two players join a public game from the menu", async ({ browser, baseURL }) => {
  // Never against the public server: real players could join the test's game.
  test.skip(Boolean(process.env.E2E_BASE_URL), "local server only");
  test.setTimeout(GAME_START_TIMEOUT + 30_000);
  if (!baseURL) throw new Error("baseURL is not configured");
  const pages = [await browser.newPage(), await browser.newPage()];
  for (const page of pages) {
    await page.goto(baseURL);
    await page.locator("#online-play").click();
    await expect(page.locator("#lobby-status")).toHaveText(/^(Waiting for players|Starting in)/);
  }
  for (const page of pages) {
    await expect(page.locator("#map canvas")).toBeVisible({ timeout: GAME_START_TIMEOUT });
  }
});

test("says when an invitation leads nowhere", async ({ page }) => {
  await page.goto("./?game=AAAAAAAAAAAA");
  await expect(page.locator("#lobby-status")).toContainText("No game has this invitation link");
  await page.locator("#lobby-leave").click();
  await expect(page.locator("#menu")).toBeVisible();
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
