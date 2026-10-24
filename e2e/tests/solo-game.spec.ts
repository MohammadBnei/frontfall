import { expect, test, type Page } from "@playwright/test";

/** The player's share of the land, as the HUD shows it, in percent. */
async function landShare(page: Page): Promise<number> {
  const text =
    (await page.locator(".stats .stat").nth(2).locator(".stat-value").textContent()) ?? "";
  return Number.parseFloat(text.replace(",", ".")) || 0;
}

/** Clicks in a widening spiral around a point until `done` holds. */
async function clickAround(
  page: Page,
  center: { x: number; y: number },
  done: () => Promise<boolean>,
): Promise<void> {
  for (let ring = 0; ring < 12; ring++) {
    for (let step = 0; step < 8; step++) {
      const angle = (step / 8) * 2 * Math.PI;
      const radius = 20 + ring * 25;
      await page.mouse.click(
        center.x + Math.cos(angle) * radius,
        center.y + Math.sin(angle) * radius,
      );
      await page.waitForTimeout(150);
      if (await done()) return;
    }
  }
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
    await retreat.first().click({ timeout: 2_000 }).catch(() => undefined);
    await page.waitForTimeout(300);
  }
  await expect(page.locator(".attacks")).toBeHidden();

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
