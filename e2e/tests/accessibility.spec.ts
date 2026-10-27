import { expect, test } from "@playwright/test";

test("a game can be played from the keyboard, and the menu settings are kept", async ({ page }) => {
  await page.goto("./?map=skirmish&bots=2&difficulty=easy");

  await page.locator("#open-accessibility").click();
  await page.locator("#ui-scale").selectOption("125");
  await page.locator("#reduce-motion").check();
  await expect(page.locator("html")).toHaveAttribute("data-reduce-motion", "");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-reduce-motion", "");

  await page.locator("#play").click();
  const map = page.locator("#map");
  await expect(map).toBeVisible();
  await map.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(map).toBeFocused();
  await expect(page.locator("#help")).toBeVisible();
});
