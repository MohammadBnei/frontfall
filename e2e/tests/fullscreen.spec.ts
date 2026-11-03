import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 900 } });

test("the full-screen button enters and leaves full screen, and follows the browser", async ({
  page,
}) => {
  await page.goto("./?map=skirmish&bots=2&difficulty=easy");
  await page.locator("#play").click();
  const button = page.locator(".toolbar .icon-fullscreen");
  await expect(button).toBeVisible();
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await expect(button).toHaveAccessibleName("Full screen");

  await button.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(button).toHaveAccessibleName("Leave full screen");

  // The browser leaves full screen on its own (Esc): the button follows.
  await page.evaluate(() => document.exitFullscreen());
  await expect(button).toHaveAttribute("aria-pressed", "false");
});

test("the button is hidden where the browser has no full screen", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "fullscreenEnabled", { value: false });
  });
  await page.goto("./?map=skirmish&bots=2&difficulty=easy");
  await page.locator("#play").click();
  await expect(page.locator("#help")).toBeVisible();
  await expect(page.locator(".icon-fullscreen")).toHaveCount(0);
});
