import { expect, test, type Page } from "@playwright/test";

/**
 * A point of the page in the middle of a patch of `color` ("rgb(r, g, b)"),
 * give or take the relief shading; undefined if there is none.
 */
async function findColor(page: Page, color: string): Promise<{ x: number; y: number } | undefined> {
  const png = (await page.screenshot({ scale: "css" })).toString("base64");
  const [r, g, b] = (color.match(/\d+/g) ?? []).map(Number);
  // The suite has no DOM types: the search runs in the page, as a string.
  return page.evaluate<{ x: number; y: number } | undefined>(`(async (png, r, g, b) => {
    const image = new Image();
    image.src = "data:image/png;base64," + png;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const { data, width, height } = context.getImageData(0, 0, image.width, image.height);
    const near = (x, y) => {
      const i = (y * width + x) * 4;
      return Math.abs(data[i] - r) + Math.abs(data[i + 1] - g) + Math.abs(data[i + 2] - b) < 60;
    };
    for (let y = 4; y < height - 4; y += 2) {
      for (let x = 4; x < width - 4; x += 2) {
        if (!near(x, y) || !near(x - 4, y) || !near(x + 4, y) || !near(x, y - 4) || !near(x, y + 4)) {
          continue;
        }
        // The map, not the same colour in a panel over it.
        if (document.elementFromPoint(x, y)?.closest("#map")) return { x, y };
      }
    }
    return undefined;
  })(${JSON.stringify(png)}, ${String(r)}, ${String(g)}, ${String(b)})`);
}

/** Waits for the page to draw `count` frames. */
async function frames(page: Page, count: number): Promise<void> {
  await page.evaluate(`new Promise((resolve) => {
    let left = ${String(count)};
    const next = () => (--left > 0 ? requestAnimationFrame(next) : resolve());
    requestAnimationFrame(next);
  })`);
}

/** The land of the player at this screen, in % of the map, as the HUD shows it. */
async function landShare(page: Page): Promise<number> {
  const text =
    (await page.locator(".stats .stat").nth(2).locator(".stat-value").textContent()) ?? "";
  return Number.parseFloat(text.replace(",", ".")) || 0;
}

/** Starts a solo game on the skirmish map against `bots` bots and spawns near the middle. */
async function startGame(page: Page, bots = 2, extra = ""): Promise<void> {
  await page.goto(`./?map=skirmish&bots=${String(bots)}&difficulty=easy&nations=0&speed=5${extra}`);
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();
  const box = await page.locator("#map").boundingBox();
  if (!box) throw new Error("the map has no size");
  // Spawn on the first land tile a spiral from the middle finds.
  for (let i = 0; i < 96; i++) {
    const angle = ((i % 8) / 8) * 2 * Math.PI;
    const radius = 20 + Math.floor(i / 8) * 25;
    await page.mouse.click(
      box.x + box.width / 2 + Math.cos(angle) * radius,
      box.y + box.height / 2 + Math.sin(angle) * radius,
    );
    const spawned = await expect
      .poll(() => landShare(page), { timeout: 1000 })
      .toBeGreaterThan(0)
      .then(
        () => true,
        () => false,
      );
    if (spawned) break;
  }
  await expect(page.locator(".banner")).toContainText("to expand", { timeout: 30_000 });
}

test("asks a bot for an alliance from the leaderboard, then betrays it (R-DIPLO)", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  // One bot, which grows while the player stays put: it accepts a smaller player (R-BOT-10).
  await startGame(page, 1);
  const menu = page.locator("#player-menu");
  const ally = page.locator(".leader-button .badge-ally");
  await page.locator(".leader-button").click();
  const ask = menu.locator(".menu-action.ask");
  await expect(ask).toBeEnabled();
  await ask.click();
  await expect(ask).toBeDisabled();
  // The bot answers at its next decision, within B-BOT-INTERVAL (5 s of game time).
  await expect(ally).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".event-feed")).toContainText("are now allies");

  // Betraying asks once more first.
  await expect(menu).toBeVisible();
  await menu.locator(".menu-action.betray").click();
  await expect(menu.locator(".menu-action.betray")).toContainText("Confirm");
  await menu.locator(".menu-action.betray").click();
  await expect(menu).toBeHidden();
  await expect(page.locator(".event-feed")).toContainText("betrayed");
  await expect(page.locator(".leader.you .badge-traitor")).toBeVisible();
  await expect(page.locator(".leader .badge-ally:visible")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("sends a bot a gift of gold, in a game without silos (R-DIPLO-06, R-MODE-03)", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await startGame(page, 1, "&off=silo&gold=500");
  await expect(page.locator("#build-city")).toBeVisible();
  await expect(page.locator("#build-silo")).toBeHidden();
  await expect(page.locator("#build-missile")).toBeHidden();
  await page.keyboard.press("KeyL");
  await expect(page.locator("#build-silo")).toHaveAttribute("aria-pressed", "false");
  await page.locator(".leader-button").click();
  const menu = page.locator("#player-menu");
  const gold = menu.locator(".menu-action.gift-gold");
  await expect(gold).toContainText("of your gold");
  await expect(gold).toBeEnabled({ timeout: 10_000 });
  await gold.click();
  await expect(page.locator(".event-feed")).toContainText("sent a gift to");
  expect(pageErrors).toEqual([]);
});

test("closes the player menu with Esc before pausing", async ({ page }) => {
  await startGame(page);
  await page.locator(".leader-button").first().click();
  const menu = page.locator("#player-menu");
  await expect(menu).toBeVisible();
  await expect(menu.locator(".menu-action").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(page.locator(".overlay.paused")).toHaveCount(0);
});

test.describe("on a touch screen", () => {
  // Synthetic pointer events need no touch support from the browser.
  test.use({ viewport: { width: 400, height: 760 } });

  test("opens a player's menu with a long press, and does not attack (R-DIPLO-01)", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await startGame(page);
    const menu = page.locator("#player-menu");
    // Zoomed out, the bots' land is in view.
    const box = await page.locator("#map").boundingBox();
    if (!box) throw new Error("the map has no size");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 400);
    // A bot's land, either bot's, found on screen by its colour in the leaderboard.
    const bots = await page.evaluate<{ name: string; color: string }[]>(
      `[...document.querySelectorAll(".leader-button")].map((button) => ({
        name: button.querySelector(".leader-name").textContent,
        color: getComputedStyle(button.querySelector(".swatch")).backgroundColor,
      }))`,
    );
    const search = async () => {
      for (const bot of bots) {
        const point = await findColor(page, bot.color);
        if (point) return { ...point, name: bot.name };
      }
      return undefined;
    };
    // A tall screen shows the map's whole height but not its width: pan east, then west.
    // Keys move the camera while held.
    let at = await search();
    for (let i = 0; i < 24 && !at; i++) {
      const key = i < 8 ? "ArrowRight" : "ArrowLeft";
      await page.keyboard.down(key);
      await frames(page, 24);
      await page.keyboard.up(key);
      // Searched once the camera stands still, so that the press lands on what was found.
      at = await search();
    }
    if (!at) throw new Error("no bot's land on screen");
    const { name } = at;
    const { x, y } = at;
    // Synthetic pointer events carry their own time; a string, as the tests are not compiled for the DOM.
    await page.evaluate(`(async () => {
      const map = document.querySelector("#map");
      const init = { pointerId: 7, pointerType: "touch", clientX: ${String(x)}, clientY: ${String(y)}, bubbles: true };
      map.dispatchEvent(new PointerEvent("pointerdown", init));
      await new Promise((resolve) => setTimeout(resolve, 600));
      map.dispatchEvent(new PointerEvent("pointerup", init));
    })()`);
    await expect(menu.locator("h2")).toHaveText(name);
    // An attack would show up with the next update, which brings more troops.
    const troops = page.locator(".stats .stat").first().locator(".stat-value");
    const before = await troops.textContent();
    await expect(troops).not.toHaveText(before ?? "");
    await expect(page.locator(".attacks")).toBeHidden();
    await expect(menu).toBeVisible();
    await expect(menu.locator(".menu-action.ask")).toBeVisible();
    // The menu stays on screen on a phone.
    const rect = await menu.boundingBox();
    expect(rect && rect.x >= 0 && rect.x + rect.width <= 400).toBe(true);
  });
});
