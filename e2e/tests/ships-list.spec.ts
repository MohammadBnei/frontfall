import { expect, test } from "@playwright/test";
import { landShare, startByTheWater } from "./by-the-water.ts";

test("lists a ship while it sails and drops it once it has landed", async ({ page }) => {
  test.setTimeout(180_000);
  const start = await startByTheWater(page, "&bots=0&speed=1");
  const before = await landShare(page);
  // A ship still lands quickly: a watcher records every line of the list the moment it is
  // written (a mutation observer and a short timer, since browsers batch differently), so the
  // test never races the landing. The game runs at its normal pace to give it more time.
  await page.evaluate(() => {
    const seen: string[] = [];
    Object.assign(window, { seenShips: seen });
    const record = (): void => {
      for (const row of document.querySelectorAll(".threat-boatOut")) {
        const text = row.textContent;
        if (text !== "" && !seen.includes(text)) seen.push(text);
      }
    };
    new MutationObserver(record).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    window.setInterval(record, 20);
  });
  const seen = (): Promise<string[]> =>
    page.evaluate(() => (window as unknown as { seenShips: string[] }).seenShips);
  // The far bank of the channel: land the player's start does not touch, across the water.
  // The map is searched in a grid laid on its own box, nearest points first, so the search
  // does not depend on the size of the window a browser opens; it stops at the first line.
  const box = await page.locator("#map").boundingBox();
  if (!box) throw new Error("the map has no size");
  const points: { x: number; y: number }[] = [];
  for (let x = box.x + 20; x < box.x + box.width - 20; x += 30) {
    for (let y = box.y + 20; y < box.y + box.height - 20; y += 30) {
      if (Math.hypot(x - start.x, y - start.y) > 110) points.push({ x, y });
    }
  }
  points.sort(
    (a, b) => Math.hypot(a.x - start.x, a.y - start.y) - Math.hypot(b.x - start.x, b.y - start.y),
  );
  for (const point of points) {
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(60);
    if ((await seen()).length > 0) break;
  }
  // Where it is bound, what it carries and the time left.
  expect((await seen())[0]).toMatch(/^Ship to .+: [\d,]+, \d+:\d\d$/);
  // It lands: the line goes and the player holds more land than before.
  await expect(page.locator(".threat-boatOut")).toHaveCount(0, { timeout: 60_000 });
  await expect.poll(() => landShare(page), { timeout: 30_000 }).toBeGreaterThan(before);
});
