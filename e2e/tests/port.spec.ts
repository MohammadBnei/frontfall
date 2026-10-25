import { expect, test } from "@playwright/test";
import { startByTheWater } from "./by-the-water.ts";

test("keeps the port mode on through a refused click, and builds with the next one (R-BUILD-02)", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  // A hundred times the usual gold, so the first port is paid for in seconds of play.
  const start = await startByTheWater(page, "&gold=500");
  const port = page.locator("#build-port");
  await expect(port).not.toHaveClass(/unaffordable/, { timeout: 90_000 });
  const cost = port.locator(".build-cost");
  const first = await cost.textContent();
  const box = await page.locator("#map").boundingBox();
  if (!box) throw new Error("the map has no size");

  await page.keyboard.press("KeyO");
  await expect(port).toHaveAttribute("aria-pressed", "true");
  // Far from any land of the player's: refused, with the reason.
  await page.mouse.click(box.x + 4, box.y + 4);
  // At once, before the answer: by the water where the player started, close
  // enough to their coast for the port to go there.
  await page.mouse.click(start.x, start.y);
  await expect(cost).not.toHaveText(first ?? "", { timeout: 5_000 });
  await expect(port).toHaveAttribute("aria-pressed", "false");
  expect(pageErrors).toEqual([]);
});
