import { expect, type Page } from "@playwright/test";

/** The player's share of the land, as the HUD shows it, in percent. */
export async function landShare(page: Page): Promise<number> {
  const text =
    (await page.locator(".stats .stat").nth(2).locator(".stat-value").textContent()) ?? "";
  return Number.parseFloat(text.replace(",", ".")) || 0;
}

/** Points in a widening spiral around `center`, `step` pixels apart. */
export function* spiral(
  center: { x: number; y: number },
  rings: number,
  step: number,
): Generator<{ x: number; y: number }> {
  for (let ring = 0; ring < rings; ring++) {
    const radius = step * (ring + 1);
    const points = 8 + ring * 2;
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * 2 * Math.PI;
      yield { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
    }
  }
}

/**
 * Starts a solo game on the Strait, whose middle is the channel between its two
 * lands, and spawns on the first land a spiral from the middle finds: by the water.
 */
export async function startByTheWater(
  page: Page,
  query: string,
): Promise<{ x: number; y: number }> {
  await page.goto(`./?map=strait&bots=1&difficulty=easy&nations=0&speed=5${query}`);
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();
  const box = await page.locator("#map").boundingBox();
  if (!box) throw new Error("the map has no size");
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  for (const point of spiral(center, 24, 8)) {
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(150);
    if ((await landShare(page)) > 0) {
      await expect(page.locator(".banner")).toContainText("to expand", { timeout: 30_000 });
      return point;
    }
  }
  throw new Error("no land near the middle of the map");
}

/**
 * Clicks around `start` with `key`'s build mode on until the cost in
 * `button` changes: the structure went up on a tile of the player's.
 * Returns the point that took it.
 */
export async function buildAround(
  page: Page,
  start: { x: number; y: number },
  key: string,
  button: string,
): Promise<{ x: number; y: number }> {
  const mode = page.locator(button);
  const cost = mode.locator(".build-cost");
  const first = await cost.textContent();
  for (const point of spiral(start, 8, 4)) {
    if ((await mode.getAttribute("aria-pressed")) !== "true") await page.keyboard.press(key);
    await expect(mode).toHaveAttribute("aria-pressed", "true");
    await page.mouse.click(point.x, point.y);
    await page.waitForTimeout(250);
    if ((await cost.textContent()) !== first) return point;
  }
  throw new Error(`nothing built with ${key} around the start`);
}
