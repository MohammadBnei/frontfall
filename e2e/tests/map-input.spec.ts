import { devices, expect, test } from "@playwright/test";

// Touch, screen size and user agent of an iPad, in the Chromium build the suite already uses.
const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["iPad Pro 11"];
test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

test("pinch zooms the map, not the page", async ({ page, browserName }) => {
  // Playwright emulates mobile touch screens in Chromium only.
  test.skip(browserName === "firefox", "no touch emulation in Firefox");
  test.setTimeout(60_000);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.goto("./?map=skirmish&bots=1");
  await page.locator("#play").tap();
  const canvas = page.locator("#map");
  await expect(canvas).toBeVisible();
  // The map is drawn once the worker has loaded it.
  await expect(canvas.locator("canvas")).toBeVisible();
  await expect(page.locator(".notice")).toHaveCount(0);
  const box = await canvas.boundingBox();
  if (!box) throw new Error("the map has no size");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  // The whole view at one pixel per CSS pixel: a shot at the device's density
  // takes seconds in software rendering. Not a square around the pinch: it
  // stays still under the fingers, and may show nothing but plain land.
  const shot = () => page.screenshot({ scale: "css" });
  // Let a few frames draw before the reference shot.
  await page.waitForTimeout(500);
  const before = await shot();
  const fingers = (spread: number) => [
    { x: x - spread, y, id: 1 },
    { x: x + spread, y, id: 2 },
  ];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: fingers(40) });
  for (let spread = 60; spread <= 200; spread += 20) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: fingers(spread) });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });

  // The suite has no DOM types, hence the expression as a string.
  expect(await page.evaluate<number>("window.visualViewport.scale")).toBe(1);
  // A frame of this view takes seconds in software rendering: allow a few.
  await expect.poll(async () => (await shot()).equals(before), { timeout: 20_000 }).toBe(false);
  expect(pageErrors).toEqual([]);
});
