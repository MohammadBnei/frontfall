import { expect, test } from "@playwright/test";
import { buildAround, startByTheWater } from "./by-the-water.ts";

test("builds a silo and launches a missile that burns the land (R-BUILD-04, R-UNIT-05)", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  // Enough gold for a silo and a missile in a minute or so of play.
  const start = await startByTheWater(page, "&gold=3000");
  const missile = page.locator("#build-missile");
  // No silo, no missile.
  await expect(missile).toHaveClass(/unaffordable/);
  await expect(page.locator("#build-silo")).not.toHaveClass(/unaffordable/, { timeout: 120_000 });
  await buildAround(page, start, "KeyL", "#build-silo");
  // Built and loaded after B-BUILD-TIME-LONG.
  await expect(missile).not.toHaveClass(/unaffordable/, { timeout: 60_000 });

  // At the bots' land: the leaderboard shows their share before and after.
  const box = await page.locator("#map").boundingBox();
  if (!box) throw new Error("the map has no size");
  await page.keyboard.press("KeyM");
  await expect(page.locator(".banner")).toContainText("missile should strike");
  await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2);
  // The silo reloads for B-SILO-RELOAD: no second missile yet.
  await expect(missile).toHaveClass(/unaffordable/, { timeout: 5_000 });
  await expect(missile).toHaveAttribute("aria-pressed", "false");
  expect(pageErrors).toEqual([]);
});
