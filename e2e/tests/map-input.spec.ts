import { devices, expect, test } from "@playwright/test";

// Touch, screen size and user agent of an iPad, in the Chromium build the suite already uses.
const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["iPad Pro 11"];
test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

test("pinch zooms the map, not the page", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.goto("./?map=skirmish&bots=1");
  await page.locator("#play").tap();
  const canvas = page.locator("#map");
  await expect(canvas).toBeVisible();
  await expect(page.locator(".notice")).toHaveCount(0);
  // Let a few frames draw before the reference shot.
  await page.waitForTimeout(500);
  const before = await canvas.screenshot();

  const box = await canvas.boundingBox();
  if (!box) throw new Error("the map has no size");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const fingers = (spread: number) => [
    { x: x - spread, y, id: 1 },
    { x: x + spread, y, id: 2 },
  ];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: fingers(40) });
  for (let spread = 60; spread <= 200; spread += 20) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: fingers(spread) });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

  // The suite has no DOM types, hence the expression as a string.
  expect(await page.evaluate<number>("window.visualViewport.scale")).toBe(1);
  // Screenshots are slow in software rendering, all the more with other tests running.
  await expect
    .poll(async () => (await canvas.screenshot()).equals(before), { timeout: 30_000 })
    .toBe(false);
  expect(pageErrors).toEqual([]);
});
