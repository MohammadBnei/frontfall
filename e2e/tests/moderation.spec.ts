import { expect, test, type Browser, type Page } from "@playwright/test";

/** The map loads, then the server starts the game. */
const GAME_START_TIMEOUT = 60_000;

/** A private game with its host and one guest, who joined from the invitation. */
async function privateGame(
  browser: Browser,
  baseURL: string,
): Promise<{ host: Page; guest: Page; link: string }> {
  const host = await browser.newPage();
  const guest = await browser.newPage();
  await host.goto(baseURL);
  await host.locator("#player-name").fill("Host");
  await host.locator("#online-create").click();
  const invite = host.locator("#invite-link");
  await expect(invite).toHaveValue(/[?&]game=/, { timeout: 15_000 });
  const link = await invite.inputValue();
  await guest.goto(link);
  await guest.locator("#join-name").fill("Guest");
  await guest.locator("#join-submit").click();
  await expect(host.locator("#lobby-players li")).toHaveCount(2, { timeout: 15_000 });
  return { host, guest, link };
}

test("the host removes a player, who cannot join that game again (R-MODE-05)", async ({
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error("baseURL is not configured");
  const { host, guest, link } = await privateGame(browser, baseURL);
  // Only the host removes, and never themself.
  await expect(guest.locator(".lobby-remove")).toHaveCount(0);
  await expect(host.locator(".lobby-remove")).toHaveCount(1);
  await host.getByRole("button", { name: "Remove Guest from the game" }).click();
  await expect(host.locator("#lobby-players li")).toHaveCount(1);
  await expect(guest.locator("#lobby-status")).toHaveText("The host removed you from this game.");

  await guest.goto(link);
  await guest.locator("#join-submit").click();
  await expect(guest.locator("#lobby-status")).toContainText("you cannot join it again");
  await expect(host.locator("#lobby-players li")).toHaveCount(1);
});

test("a player hides another one, whose name and messages leave their screen (R-DIPLO-08)", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(GAME_START_TIMEOUT + 60_000);
  if (!baseURL) throw new Error("baseURL is not configured");
  const { host, guest } = await privateGame(browser, baseURL);
  await host.locator("#lobby-bots").fill("0");
  await expect(host.locator("#lobby-bots")).toHaveValue("0");
  // Two players alone: the leaderboard lists both all game long.
  await host.locator("#lobby-nations").uncheck();
  await host.locator("#lobby-start").click();
  for (const page of [host, guest]) {
    await expect(page.locator("#map canvas")).toBeVisible({ timeout: GAME_START_TIMEOUT });
    await expect(page.locator(".leaderboard")).toContainText("Guest");
  }

  await host.getByRole("button", { name: "Diplomacy with Guest" }).click();
  const menu = host.locator("#player-menu");
  await menu.locator(".menu-action.hide").click();
  await expect(menu).toContainText("Hidden");
  await expect(host.locator(".leaderboard")).toContainText("Player 2");
  await expect(host.locator(".leaderboard")).not.toContainText("Guest");
  await expect(host.locator(".labels")).not.toContainText("Guest");
  await host.keyboard.press("Escape");

  // The guest's quick message, once play begins, never shows on the host's screen.
  await guest.getByRole("button", { name: "Diplomacy with Host" }).click();
  const messages = guest.locator("#player-menu .menu-action.messages");
  await expect(messages).toBeEnabled({ timeout: 60_000 });
  await messages.click();
  await guest.locator("#player-menu .quick-phrase").first().click();
  await expect(guest.locator(".event-feed")).toContainText("Hello!");
  await host.waitForTimeout(1_000);
  await expect(host.locator(".event-feed")).not.toContainText("Hello!");

  // Shown again, the guest has their name back.
  await host.getByRole("button", { name: "Diplomacy with Player 2" }).click();
  await menu.locator(".menu-action.hide").click();
  await expect(host.locator(".leaderboard")).toContainText("Guest");
});
