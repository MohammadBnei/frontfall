import { expect, test, type Page } from "@playwright/test";

/** The player's share of the land, as the HUD shows it, in percent. */
async function landShare(page: Page): Promise<number> {
  const text =
    (await page.locator(".stats .stat").nth(2).locator(".stat-value").textContent()) ?? "";
  return Number.parseFloat(text.replace(",", ".")) || 0;
}

/** Clicks in a widening spiral around a point until `done` holds; returns the last point clicked. */
async function clickAround(
  page: Page,
  center: { x: number; y: number },
  done: () => Promise<boolean>,
): Promise<{ x: number; y: number }> {
  let last = center;
  for (let ring = 0; ring < 12; ring++) {
    for (let step = 0; step < 8; step++) {
      const angle = (step / 8) * 2 * Math.PI;
      const radius = 20 + ring * 25;
      last = { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
      await page.mouse.click(last.x, last.y);
      await page.waitForTimeout(150);
      if (await done()) return last;
    }
  }
  return last;
}

test("plays a solo game from the menu: spawn, then expand", async ({ page }) => {
  test.setTimeout(90_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.goto("./?map=skirmish&bots=2&difficulty=easy");
  await expect(page.locator("#menu")).toBeVisible();
  await expect(page.locator('input[name="map"][value="skirmish"]')).toBeChecked();
  await expect(page.locator("#bot-count")).toHaveValue("2");
  await page.locator("#player-name").fill("Tester");
  await page.locator("#play").click();

  await expect(page.locator("#menu")).toHaveCount(0);
  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator(".banner")).toContainText("choose where you start");

  const box = await page.locator("#map").boundingBox();
  if (!box) throw new Error("the map has no size");
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  // Spawn on the first land tile the spiral finds.
  await clickAround(page, center, async () => (await landShare(page)) > 0);
  expect(await landShare(page)).toBeGreaterThan(0);
  await expect(page.locator(".leaderboard")).toContainText("Tester");
  // Player colours show even where the server forbids inline styles, as in production.
  await expect(page.locator(".leaderboard-list .swatch").first()).not.toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );

  // Attacks open when the spawn phase ends.
  await expect(page.locator(".banner")).toContainText("to expand", { timeout: 30_000 });
  const before = await landShare(page);
  await page.keyboard.press("Digit5");
  await expect(page.locator("#attack-ratio")).toHaveValue("50");
  await clickAround(page, center, async () => (await landShare(page)) > before);
  await expect.poll(() => landShare(page), { timeout: 10_000 }).toBeGreaterThan(before);

  // With all its troops, an attack lasts long enough to be called back.
  await page.keyboard.press("Digit0");
  await expect(page.locator("#attack-ratio")).toHaveValue("100");
  const retreat = page.locator(".attack-retreat");
  await clickAround(page, center, async () => (await retreat.count()) > 0);
  while ((await retreat.count()) > 0) {
    await retreat
      .first()
      .click({ timeout: 2_000 })
      .catch(() => undefined);
    await page.waitForTimeout(300);
  }
  await expect(page.locator(".attacks")).toBeHidden();

  expect(pageErrors).toEqual([]);
});

/** Pixels of the light fill structures are drawn with, around a point of the page. */
async function structurePixels(page: Page, at: { x: number; y: number }): Promise<number> {
  const clip = { x: at.x - 40, y: at.y - 40, width: 80, height: 80 };
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
      if (data[i] > 225 && data[i + 1] > 220 && data[i + 2] > 210) count++;
    }
    return count;
  })(${JSON.stringify(png)})`);
}

test("builds a city once the gold allows it (R-BUILD-01)", async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.goto("./?map=skirmish&bots=2&difficulty=easy&speed=5");
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();
  const box = await page.locator("#map").boundingBox();
  if (!box) throw new Error("the map has no size");
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  // The tile clicked to start on stays the player's: the city goes there.
  const start = await clickAround(page, center, async () => (await landShare(page)) > 0);
  expect(await landShare(page)).toBeGreaterThan(0);

  // Grow, so the gold comes in faster.
  await expect(page.locator(".banner")).toContainText("to expand", { timeout: 30_000 });
  await page.keyboard.press("Digit3");
  const city = page.locator("#build-city");
  // Clicks walk a spiral out from the start: those next to free land expand.
  for (let i = 0; i < 400 && (await city.getAttribute("class"))?.includes("unaffordable"); i++) {
    const angle = ((i % 8) / 8) * 2 * Math.PI;
    const radius = 20 + (Math.floor(i / 8) % 12) * 25;
    await page.mouse.click(
      center.x + Math.cos(angle) * radius,
      center.y + Math.sin(angle) * radius,
    );
    await page.waitForTimeout(250);
  }
  await expect(city).not.toHaveClass(/unaffordable/, { timeout: 60_000 });

  const before = await structurePixels(page, start);
  await page.keyboard.press("KeyC");
  await expect(city).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".banner")).toContainText("build a city");
  await page.mouse.click(start.x, start.y);
  await expect(page.locator("#build-city .build-count")).toContainText("1 of", { timeout: 5_000 });
  await expect(city).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(() => structurePixels(page, start), { timeout: 10_000 })
    .toBeGreaterThan(before);
  expect(pageErrors).toEqual([]);
});

test("pauses and shows the controls", async ({ page }) => {
  await page.goto("./?map=skirmish&bots=1");
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();
  await page.keyboard.press("KeyH");
  await expect(page.getByRole("dialog")).toContainText("Controls");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("goes back to the menu from a game, never going online", async ({ page }) => {
  const sockets: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  await page.goto("./?map=skirmish&bots=1");
  await expect(page.locator("#status")).toBeHidden();
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();
  // No start picked yet: nothing to lose, so no confirmation.
  await page.locator("#leave").click();
  await expect(page.locator("#menu")).toBeVisible();
  await expect(page.locator("#map")).toHaveCount(0);
  expect(sockets).toEqual([]);
});

test("offers the World first and starts a game on it", async ({ page }) => {
  test.setTimeout(60_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.goto("./");
  await expect(page.locator('input[name="map"]').first()).toHaveValue("world");
  await page.locator('input[name="map"][value="world"]').check({ force: true });
  await page.locator("#play").click();
  await expect(page.locator(".banner")).toContainText("choose where you start", {
    timeout: 30_000,
  });
  await expect(page.locator("#map canvas")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("plays a World game against 8 bots to its end screen", async ({ page }, testInfo) => {
  // The page under a prefix adds nothing here, and the game takes a while.
  test.skip(testInfo.project.name === "prefix", "played once, at the root");
  test.setTimeout(240_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  // Thirty ticks per beat and a 3-minute limit: the 1,800 ticks of a whole
  // game run in well under a minute, every one of them simulated and drawn.
  await page.goto("./?map=world&bots=8&difficulty=hard&speed=30&minutes=3");
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();
  await expect(page.locator(".goal-clock")).toContainText("of 3:00", { timeout: 30_000 });

  const end = page.locator(".end-screen");
  await expect(end).toBeVisible({ timeout: 200_000 });
  await expect(end.locator(".end-winner")).toContainText("wins the game");
  // The player, placed by the game and never moving, cannot be the winner.
  await expect(end).toContainText("Defeat");
  await end.getByRole("button", { name: "Keep watching" }).click();
  await expect(end).toHaveCount(0);
  await expect(page.locator(".leaderboard")).toBeVisible();

  expect(pageErrors).toEqual([]);
});
