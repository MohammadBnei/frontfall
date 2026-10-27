import { expect, test } from "@playwright/test";

test("the menu keeps a name, a colour and the last games on the device, until they are forgotten", async ({
  page,
}) => {
  await page.goto("./?map=skirmish&bots=2&difficulty=easy&nations=0");
  await page.locator("#player-name").fill("Ada");
  await page.locator("#menu-profile summary").click();
  await expect(page.locator("#recent-games")).toBeEmpty();
  await page.getByLabel("Jade").check({ force: true });

  await page.locator("#play").click();
  await expect(page.locator("#map")).toBeVisible();
  await page.locator("#leave").click();

  // Back in the menu, the game just left is the first of the list.
  await page.locator("#menu-profile summary").click();
  const games = page.locator("#recent-games li");
  await expect(games).toHaveCount(1);
  await expect(games.first()).toContainText("Solo");
  await expect(games.first()).toContainText("Left");

  // A new visit finds all of it again.
  await page.goto("./");
  await expect(page.locator("#player-name")).toHaveValue("Ada");
  await page.locator("#menu-profile summary").click();
  await expect(page.getByLabel("Jade")).toBeChecked();
  await expect(page.locator("#recent-games li")).toHaveCount(1);

  await page.locator("#profile-forget").click();
  await expect(page.locator("#player-name")).toHaveValue("");
  await expect(page.locator("#recent-games li")).toHaveCount(0);
  await page.goto("./");
  await expect(page.locator("#player-name")).toHaveValue("");
  await page.locator("#menu-profile summary").click();
  await expect(page.getByLabel("Sky")).toBeChecked();
});
