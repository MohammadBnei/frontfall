import { expect, test } from "@playwright/test";
import { startByTheWater } from "./by-the-water.ts";

const KEY = "frontfall.achievements";

test("lists the achievements in the menu, the earned ones lit", async ({ page }) => {
  await page.addInitScript(
    ([key]) => {
      if (!localStorage.getItem(key as string)) {
        localStorage.setItem(
          key as string,
          JSON.stringify({ v: 1, earned: { conqueror: { at: Date.UTC(2026, 9, 27), level: 2 } } }),
        );
      }
    },
    [KEY],
  );
  await page.goto("./");
  await expect(page.locator("#achievements-open")).toHaveAttribute(
    "aria-label",
    "Achievements 1/20",
  );
  await page.locator("#achievements-open").click();
  await expect(page.locator("#achievements-count")).toContainText("1 of 20");
  await expect(page.locator(".achievement-list li")).toHaveCount(20);
  await expect(page.locator('li[data-achievement="conqueror"]')).toHaveClass(/earned/);
  await expect(page.locator('li[data-achievement="conqueror"]')).toHaveAttribute("data-level", "2");
  await expect(page.locator('li[data-achievement="ally"]')).toHaveClass(/locked/);
  await page.screenshot({ path: process.env.SHOT ?? "/tmp/achievements.png" });
  await page.keyboard.press("Escape");
  await expect(page.locator("#achievements")).toHaveCount(0);
});

test("keeps an achievement earned in a game, and shows it in the menu", async ({ page }) => {
  test.setTimeout(150_000);
  const start = await startByTheWater(page, "&gold=500");
  const port = page.locator("#build-port");
  await expect(port).not.toHaveClass(/unaffordable/, { timeout: 90_000 });
  await page.keyboard.press("KeyO");
  await page.mouse.click(start.x, start.y);
  // Earned once the port is finished.
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), KEY), { timeout: 60_000 })
    .toContain("harbor");
  await page.reload();
  await expect(page.locator("#achievements-open")).toHaveAttribute(
    "aria-label",
    /Achievements [1-9]\/20/,
  );
});
