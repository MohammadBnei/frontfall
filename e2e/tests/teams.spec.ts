import { expect, test } from "@playwright/test";

test("plays a team game: a teammate is an ally for the whole game (R-MODE-02)", async ({
  page,
}) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.goto("./?map=skirmish&bots=3&difficulty=easy&nations=0&teams=2");
  await expect(page.locator('input[name="teams"][value="2"]')).toBeChecked();
  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();

  // Dealt in turn: the player and the second bot are team 1, the other two team 2.
  const teammate = page.locator(".leader-button", { has: page.locator(".badge-ally:visible") });
  await expect(teammate).toHaveCount(1);
  await expect(teammate.locator(".badge-ally")).toHaveText("Team");
  await teammate.click();
  const menu = page.locator("#player-menu");
  await expect(menu).toContainText("teammate");
  await expect(menu.locator(".menu-action.ask, .menu-action.betray")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // A player of the other team can be asked as usual.
  await page
    .locator(".leader-button", { hasNot: page.locator(".badge-ally:visible") })
    .first()
    .click();
  await expect(menu.locator(".menu-action.ask")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("offers the mode in the menu, and keeps a free-for-all link as it was", async ({ page }) => {
  await page.goto("./?map=skirmish");
  await expect(page.locator('input[name="teams"][value="0"]')).toBeChecked();
  await page.locator("#menu-options > summary").click();
  await page.locator('input[name="teams"][value="3"]').check({ force: true });
  await page.locator("#play").click();
  await expect(page).toHaveURL(/teams=3/);
});
