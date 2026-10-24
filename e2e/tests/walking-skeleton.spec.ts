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

/**
 * Pixels in the second player colour (#E69F00, give or take the relief's
 * shading) in the middle of the map, away from the HUD and its swatches.
 */
async function amberPixels(page: Page): Promise<number> {
  const size = page.viewportSize() ?? { width: 1280, height: 720 };
  const clip = { x: size.width / 2 - 200, y: size.height / 2 - 150, width: 400, height: 300 };
  const png = (await page.screenshot({ scale: "css", clip })).toString("base64");
  // The suite has no DOM types: the counting runs in the page, as a string.
  return page.evaluate<number>(`(async (png) => {
    const image = new Image();
    image.src = "data:image/png;base64," + png;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const data = context.getImageData(0, 0, image.width, image.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
      if (r > 170 && g > 105 && g < 200 && b < 60 && r - g > 40) count++;
    }
    return count;
  })("${png}")`);
}

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
  const menuBots = await host.locator("#bot-count").inputValue();
  await host.locator("#online-create").click();
  const invite = host.locator("#invite-link");
  await expect(invite).toHaveValue(/[?&]game=/, { timeout: 15_000 });
  const link = await invite.inputValue();
  expect(link.startsWith(baseURL)).toBe(true);

  // The game takes the menu's choices; the host changes them in the lobby.
  await expect(host.locator("#lobby-bots")).toHaveValue(menuBots);
  await host.locator("#lobby-map").selectOption("world");
  await host.locator("#lobby-bots").fill("0");
  await host.locator("#lobby-difficulty").selectOption("hard");
  await expect(host.locator("#lobby-bots")).toHaveValue("0");

  await guest.goto(link);
  await expect(host.locator("#lobby-players li")).toHaveCount(2, { timeout: 15_000 });
  await expect(guest.locator("#lobby-start")).toBeHidden();
  await expect(guest.locator("#lobby-map")).toBeHidden();
  await expect(guest.locator("#lobby-summary")).toHaveText("World · 0 bots · Hard");
  await host.locator("#lobby-start").click();

  for (const page of [host, guest]) {
    await expect(page.locator("#map canvas")).toBeVisible({ timeout: GAME_START_TIMEOUT });
    await expect(page.locator(".leaderboard")).toContainText("Host");
  }
  // The guest picks a start, and their map closes in on it, drawn in their
  // colour: amber, the second of the palette, as for any player after the first.
  await guest.locator("#map").click({ position: { x: 300, y: 300 } });
  // The ring of the order waits for its turn, then lets go well before it gives up.
  await expect(guest.locator(".click-mark.pending")).toHaveCount(0, { timeout: 2_000 });
  await expect(guest.locator(".stats .stat-value").nth(2)).not.toHaveText("0%", {
    timeout: 10_000,
  });
  await expect.poll(() => amberPixels(guest), { timeout: 15_000 }).toBeGreaterThan(100);

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

test("four players see the same game, without a desync", async ({ browser, baseURL }) => {
  // The local server only: its metrics count desyncs, and four pages are heavy.
  test.skip(Boolean(process.env.E2E_BASE_URL), "local server only");
  test.skip(test.info().project.name !== "root", "one browser is enough");
  test.setTimeout(GAME_START_TIMEOUT + 60_000);
  if (!baseURL) throw new Error("baseURL is not configured");
  const names = ["Host", "Ana", "Bea", "Cyd"];
  const pages = await Promise.all(names.map(() => browser.newPage()));
  const [host, ...guests] = pages;
  if (!host) throw new Error("no host page");
  const pageErrors: Error[] = [];
  for (const page of pages) page.on("pageerror", (error) => pageErrors.push(error));

  await host.goto(baseURL);
  await host.locator("#player-name").fill("Host");
  await host.locator("#online-create").click();
  const invite = host.locator("#invite-link");
  await expect(invite).toHaveValue(/[?&]game=/, { timeout: 15_000 });
  const link = await invite.inputValue();
  // Humans only: the game takes the menu's bots otherwise.
  await host.locator("#lobby-bots").fill("0");
  for (const [index, guest] of guests.entries()) {
    const invited = new URL(link);
    invited.searchParams.set("name", names[index + 1] ?? "");
    await guest.goto(invited.href);
  }
  await expect(host.locator("#lobby-players li")).toHaveCount(4, { timeout: 15_000 });
  // The guests read the host's settings.
  await expect((guests[0] ?? host).locator("#lobby-summary")).toContainText(" 0 bots ");
  await host.locator("#lobby-start").click();

  // Every page lists the same four players with the same colours.
  const leaders = async (page: Page) => {
    const rows = await Promise.all(
      (await page.locator(".leaderboard-list li").all()).map(async (row) => ({
        name: (await row.locator(".leader-name").textContent()) ?? "",
        color: (await row.locator(".swatch").getAttribute("style")) ?? "",
      })),
    );
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  };
  for (const page of pages) {
    await expect(page.locator(".leaderboard-list li")).toHaveCount(4, {
      timeout: GAME_START_TIMEOUT,
    });
  }
  const seen = await Promise.all(pages.map(leaders));
  expect(seen[0]?.map((row) => row.name)).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  expect(new Set(seen[0]?.map((row) => row.color)).size).toBe(4);
  for (const rows of seen) expect(rows).toEqual(seen[0]);

  // Clients hash their state every 5 seconds; let two rounds be compared.
  await expect.poll(() => clockOf(host), { timeout: 30_000 }).toBeGreaterThan(12);
  for (const page of pages) await expect.poll(() => clockOf(page)).toBeGreaterThan(11);
  const metrics = await (await fetch(new URL("metrics", baseURL))).text();
  expect(metrics).toMatch(/^frontfall_desyncs_total 0$/m);
  expect(pageErrors).toEqual([]);
  // The server takes eight connections per address, and every test runs from this one.
  await Promise.all(pages.map((page) => page.close()));
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
